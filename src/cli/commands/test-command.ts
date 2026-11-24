import type { Command } from "commander";
import { z } from "zod";
import { type BedrockVersion, formatBedrockVersion } from "../../bedrock/version.ts";
import { BedrockVersionResolver } from "../../bedrock/version-resolver.ts";
import { parseModuleVersion } from "../../modules/module-version.ts";
import { NpmRegistry } from "../../modules/npm-registry.ts";
import type { ServerManager } from "../../server/server-manager.ts";
import { GAMETEST_MODULE, TEST_TAG } from "../../testing/gametest-bundle.ts";
import { createStackRemapper } from "../../testing/stack-remap.ts";
import { buildTests } from "../../testing/test-build.ts";
import { initTests } from "../../testing/test-init.ts";
import { GameTestEvents, runGameTests, type TestRunReport, type TestSelection } from "../../testing/test-runner.ts";
import { BahError } from "../../util/errors.ts";
import type { Logger } from "../../util/logger.ts";
import { type CliContext, createLogger, loadProject, parseOptions } from "../context.ts";
import { runNpmInstall } from "../npm.ts";
import { createServerManager } from "../servers.ts";

/** Tests failed or were not found: exit code 1. Other errors (build, server, timeout) exit with 2. */
class TestsFailedError extends BahError {}
const ERROR_EXIT_CODE = 2;

/** Name of the test server `bah test` creates when the project has none. */
const DEFAULT_TEST_SERVER = "test";

/** Run before the tests so nothing random gets in their way. */
const SETUP_COMMANDS = [
    "gamerule domobspawning false",
    "gamerule dodaylightcycle false",
    "gamerule doweathercycle false",
];

const runOptionsSchema = z.object({
    tag: z.array(z.string().min(1)).optional(),
    server: z.string().optional(),
    timeout: z.coerce.number({ error: "must be a number" }).positive(),
    keepRunning: z.boolean().optional(),
    typecheck: z.boolean().optional(),
});

const initOptionsSchema = z.object({
    pack: z.string().optional(),
    install: z.boolean(),
});

export function registerTestCommand(program: Command, context: CliContext): void {
    const test = program
        .command("test")
        .description("Run the GameTests of the project on a test server")
        .argument("[tests...]", "tests to run, as Class:name (default: all)")
        .option("--tag <tags...>", "run the tests with these tags instead")
        .option("-s, --server <name>", "test server to use (default: the only one, created if missing)")
        .option("--timeout <seconds>", "give up after this long", "300")
        .option("--keep-running", "leave the server running afterwards, e.g. to look at the test area")
        .option("-t, --typecheck", "type-check TypeScript packs with tsc first")
        .action(async (tests: string[], _options: unknown, command: Command) => {
            const options = parseOptions(runOptionsSchema, command);
            try {
                await runTests(context, tests, options);
            } catch (error) {
                if (error instanceof TestsFailedError) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : String(error);
                throw new BahError(message, { cause: error, exitCode: ERROR_EXIT_CODE });
            }
        });

    test.command("init")
        .description("Install the GameTest types and create an example test")
        .option("-p, --pack <name>", "behavior pack for the tests (required if there are several)")
        .option("--no-install", "don't run npm install afterwards")
        .action(async (_options: unknown, command: Command) => {
            const options = parseOptions(initOptionsSchema, command);
            const logger = createLogger(context);
            const project = await loadProject(context);
            const services = {
                registry: NpmRegistry.fromEnv(context.fetch, context.env),
                versions: new BedrockVersionResolver(context.fetch),
            };

            const result = await initTests(project, services, { pack: options.pack });

            if (result.addedModule) {
                logger.info(`Added ${result.module.name}@${result.module.npmVersion} to package.json.`);
                if (result.module.note) {
                    logger.info(result.module.note);
                }
            }
            logger.info(
                result.example === null
                    ? `Pack "${result.pack.name}" already has tests.`
                    : `Created ${result.example}. Run the tests with "bah test".`,
            );
            if (result.addedModule) {
                await runNpmInstall(context, project, logger, options.install);
            }
        });
}

async function runTests(
    context: CliContext,
    tests: readonly string[],
    options: z.output<typeof runOptionsSchema>,
): Promise<void> {
    const logger = createLogger(context);
    const project = await loadProject(context);
    const started = performance.now();
    const signal = context.interrupt();

    const build = await buildTests(project, { typecheck: options.typecheck }, { logger, runner: context.runner });
    const manager = await createServerManager(context, project, logger);
    const server = await testServer(manager, options.server, logger);

    if ((await manager.state(server)) === "running") {
        await manager.stop(server);
    }
    logger.info(`Starting test server "${server}"...`);
    const { version } = await manager.start(server, { signal });
    warnOnBetaMismatch(logger, build.gametestNpmVersion, version);

    const remap = await createStackRemapper(
        build.packs.flatMap((pack) => (pack.testScript === null ? [] : [pack.testScript])),
        project.paths.root,
    );
    const events = new GameTestEvents();
    const stopFollowing = new AbortController();
    const following = manager
        .followLogs(server, (line) => events.pushLine(line), stopFollowing.signal)
        .then(() => events.end(new BahError(`Server "${server}" stopped. See "bah server logs ${server}".`)));

    let report: TestRunReport;
    try {
        for (const command of SETUP_COMMANDS) {
            await manager.command(server, command);
        }
        report = await runGameTests({
            selections: selectionsOf(tests, options.tag),
            send: (command) => manager.command(server, command),
            events,
            timeoutMs: options.timeout * 1000,
            signal,
            onResult: (result) => {
                logger.info(`${result.passed ? "PASS" : "FAIL"}  ${result.id}`);
                if (result.message !== null) {
                    logger.info(indent(formatMessage(remap(result.message)), 6));
                }
            },
            onScriptOutput: (level, message) => logger.info(indent(`[${level}] ${formatMessage(remap(message))}`, 2)),
        });
    } finally {
        stopFollowing.abort();
        await following;
        if (options.keepRunning) {
            logger.info(`Server "${server}" keeps running; stop it with "bah server stop ${server}".`);
        } else {
            await manager.stop(server);
        }
    }

    reportSummary(logger, report, performance.now() - started);
}

/** The test server to use: the given one, the only one, or a new one called "test". */
async function testServer(manager: ServerManager, name: string | undefined, logger: Logger): Promise<string> {
    if (name !== undefined) {
        if (!manager.store.get(name).config.test) {
            throw new BahError(
                `Server "${name}" is not a test server. Create one with "bah server create <name> --test".`,
            );
        }
        return name;
    }
    const servers = manager.store.entries.filter((entry) => entry.config.test).map((entry) => entry.name);
    if (servers.length > 1) {
        throw new BahError(`This project has several test servers (${servers.join(", ")}); choose one with --server.`);
    }
    if (servers[0] !== undefined) {
        return servers[0];
    }
    if (manager.store.has(DEFAULT_TEST_SERVER)) {
        throw new BahError(
            `Server "${DEFAULT_TEST_SERVER}" is not a test server. Create one with "bah server create <name> --test".`,
        );
    }
    const entry = await manager.create(DEFAULT_TEST_SERVER, { test: true });
    logger.info(
        `Created test server "${DEFAULT_TEST_SERVER}" (port ${entry.config.port}). Settings are in .bah/servers.json.`,
    );
    return DEFAULT_TEST_SERVER;
}

function selectionsOf(tests: readonly string[], tags: readonly string[] | undefined): TestSelection[] {
    const selections: TestSelection[] = [...tests.map((test) => ({ test })), ...(tags ?? []).map((tag) => ({ tag }))];
    return selections.length > 0 ? selections : [{ tag: TEST_TAG }];
}

/** Beta modules only load on the game version they were made for. */
function warnOnBetaMismatch(logger: Logger, npmVersion: string, server: BedrockVersion): void {
    const parsed = parseModuleVersion(npmVersion);
    if (parsed.kind !== "beta") {
        return;
    }
    const game = formatBedrockVersion(parsed.game.slice(0, 3));
    const running = formatBedrockVersion(server.slice(0, 3));
    if (game !== running) {
        logger.warn(
            `${GAMETEST_MODULE}@${npmVersion} is the beta API for Bedrock ${game}, but the test server runs ${running}. Beta modules only load on their own version; update them with "bah module update".`,
        );
    }
}

function reportSummary(logger: Logger, report: TestRunReport, elapsedMs: number): void {
    const failed = report.results.filter((result) => !result.passed).length;
    const passed = report.results.length - failed;
    const seconds = (elapsedMs / 1000).toFixed(1);
    logger.info(`\n${report.results.length} test(s): ${passed} passed, ${failed} failed (${seconds} s)`);
    for (const problem of report.problems) {
        logger.warn(problem);
    }
    if (failed > 0 || report.problems.length > 0 || report.results.length === 0) {
        const reason =
            failed > 0
                ? `${failed} test(s) failed.`
                : report.results.length === 0
                  ? "No tests ran."
                  : "Some tests were not found.";
        throw new TestsFailedError(reason);
    }
}

/** The server puts the first stack frame on the message line; give every frame its own line. */
function formatMessage(message: string): string {
    return message.replace(/\s{2,}at /g, "\n  at ");
}

function indent(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text
        .split("\n")
        .map((line) => `${prefix}${line.trimEnd()}`)
        .join("\n");
}
