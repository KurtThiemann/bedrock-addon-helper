import { type Command, Option } from "commander";
import { z } from "zod";
import { formatBedrockVersion } from "../../bedrock/version.ts";
import { BedrockVersionResolver } from "../../bedrock/version-resolver.ts";
import { formatUdpPorts } from "../../server/network.ts";
import { bedrockVersionSpecSchema, type ReloadStrategy } from "../../server/server-config.ts";
import { ServerConfigStore } from "../../server/server-config-store.ts";
import { ServerManager } from "../../server/server-manager.ts";
import { BahError } from "../../util/errors.ts";
import { portSchema } from "../../util/schemas.ts";
import { type CliContext, createLogger, loadProject, parseOptions } from "../context.ts";
import { formatTable } from "../table.ts";

const createOptionsSchema = z.object({
    gameVersion: bedrockVersionSpecSchema,
    port: z.coerce.number().pipe(portSchema).optional(),
    experiment: z.array(z.string().min(1)).optional(),
    reload: z.enum(["command", "restart", "none"]),
    reloadCommand: z.string().min(1),
});

const removeOptionsSchema = z.object({ purge: z.boolean().optional() });

const logsOptionsSchema = z.object({
    follow: z.boolean().optional(),
    tail: z.coerce.number().int().min(0).optional(),
});

export function registerServerCommands(program: Command, context: CliContext): void {
    const createManager = async () => {
        const logger = createLogger(context);
        const project = await loadProject(context);
        const store = await ServerConfigStore.load(project.paths.stateDir);
        const manager = new ServerManager(project, store, {
            runtime: context.containers,
            fetch: context.fetch,
            versions: new BedrockVersionResolver(context.fetch),
            logger,
        });
        return { manager, logger };
    };

    const server = program.command("server").description("Manage local test servers (Docker)");

    server
        .command("create")
        .description("Add a test server to the project")
        .argument("<name>", "server name")
        .option("--game-version <version>", "Bedrock version: latest, preview or e.g. 1.26.66", "latest")
        .option("--port <port>", "TCP port (default: the first free one from 19132); UDP ports follow it")
        .option("--experiment <names...>", "experiments to enable, e.g. beta-apis")
        .addOption(
            new Option("--reload <mode>", "what to do after a deploy: send a command, restart or nothing")
                .choices(["command", "restart", "none"])
                .default("command"),
        )
        .option("--reload-command <command>", "console command for --reload command", "reload")
        .action(async (name: string, _options: unknown, command: Command) => {
            const options = parseOptions(createOptionsSchema, command);
            const { manager, logger } = await createManager();
            const reload: ReloadStrategy =
                options.reload === "command"
                    ? { mode: "command", command: options.reloadCommand }
                    : { mode: options.reload };

            const entry = await manager.create(name, {
                version: options.gameVersion,
                port: options.port,
                experiments: options.experiment,
                reload,
            });

            logger.info(
                `Created server "${name}" (Bedrock ${entry.config.version}, port ${entry.config.port}, UDP ${formatUdpPorts(entry.config.udpPorts)}).`,
            );
            logger.info(`Start it with "bah server start ${name}". Settings are in .bah/servers.json.`);
        });

    server
        .command("list")
        .description("Show the project's servers and their state")
        .action(async () => {
            const { manager } = await createManager();
            const names = manager.store.names;
            if (names.length === 0) {
                context.io.stdout('No servers yet. Create one with "bah server create <name>".\n');
                return;
            }
            const rows: string[][] = [];
            for (const name of names) {
                const status = await manager.status(name);
                rows.push([
                    name,
                    status.state === "running" && status.info === null ? "starting" : status.state,
                    status.info?.version ?? status.config.version,
                    `${status.config.port}/tcp ${formatUdpPorts(status.config.udpPorts)}/udp`,
                    status.address,
                    status.info ? `${status.info.players}/${status.info.maxPlayers}` : "-",
                ]);
            }
            context.io.stdout(formatTable(["NAME", "STATE", "VERSION", "PORTS", "ADDRESS", "PLAYERS"], rows));
        });

    server
        .command("start")
        .description("Start servers (default: all)")
        .argument("[names...]", "servers to start")
        .action(async (names: string[]) => {
            const { manager, logger } = await createManager();
            const signal = context.interrupt();
            for (const name of selectServers(manager, names)) {
                if ((await manager.state(name)) === "running") {
                    logger.info(`Server "${name}" is already running.`);
                    continue;
                }
                logger.info(`Starting "${name}"...`);
                const result = await manager.start(name, { signal });
                logger.info(
                    `Server "${name}" is running Bedrock ${formatBedrockVersion(result.version)} at ${result.address}`,
                );
            }
        });

    server
        .command("stop")
        .description("Stop servers (default: all)")
        .argument("[names...]", "servers to stop")
        .action(async (names: string[]) => {
            const { manager, logger } = await createManager();
            for (const name of selectServers(manager, names)) {
                logger.info((await manager.stop(name)) ? `Stopped "${name}".` : `Server "${name}" is not running.`);
            }
        });

    server
        .command("restart")
        .description("Restart servers (default: all)")
        .argument("[names...]", "servers to restart")
        .action(async (names: string[]) => {
            const { manager, logger } = await createManager();
            const signal = context.interrupt();
            for (const name of selectServers(manager, names)) {
                logger.info(`Restarting "${name}"...`);
                const result = await manager.restart(name, { signal });
                logger.info(`Server "${name}" is running at ${result.address}`);
            }
        });

    server
        .command("remove")
        .description("Remove a server from the project (stops it)")
        .argument("<name>", "server name")
        .option("--purge", "also delete the server's data (world, downloaded server)")
        .action(async (name: string, _options: unknown, command: Command) => {
            const options = parseOptions(removeOptionsSchema, command);
            const { manager, logger } = await createManager();
            await manager.remove(name, { purge: options.purge ?? false });
            logger.info(
                options.purge
                    ? `Removed server "${name}" and its data.`
                    : `Removed server "${name}". Its data is kept in .bah/servers/${name}/.`,
            );
        });

    server
        .command("attach")
        .description("Connect to a server console; reattaches after restarts until Ctrl+C")
        .argument("<name>", "server name")
        .action(async (name: string) => {
            const { manager } = await createManager();
            await manager.attach(name, context.interrupt());
        });

    server
        .command("logs")
        .description("Show a server's output")
        .argument("<name>", "server name")
        .option("-f, --follow", "keep printing new output")
        .option("-n, --tail <lines>", "only show the last lines")
        .action(async (name: string, _options: unknown, command: Command) => {
            const options = parseOptions(logsOptionsSchema, command);
            const { manager } = await createManager();
            await manager.logs(name, { follow: options.follow ?? false, tail: options.tail });
        });

    server
        .command("command")
        .description("Send a console command to a running server")
        .argument("<name>", "server name")
        .argument("<command...>", "the command, e.g. reload or say hi")
        .action(async (name: string, words: string[]) => {
            const { manager, logger } = await createManager();
            await manager.command(name, words.join(" "));
            logger.info(`Sent "${words.join(" ")}" to "${name}".`);
        });
}

function selectServers(manager: ServerManager, names: readonly string[]): string[] {
    if (names.length > 0) {
        for (const name of names) {
            manager.store.get(name);
        }
        return [...names];
    }
    const all = manager.store.names;
    if (all.length === 0) {
        throw new BahError('This project has no servers. Create one with "bah server create <name>".');
    }
    return all;
}
