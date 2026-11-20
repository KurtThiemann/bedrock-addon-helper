import type { Command } from "commander";
import { z } from "zod";
import { BedrockVersionResolver } from "../../bedrock/version-resolver.ts";
import {
    addModule,
    listModules,
    type ModuleServices,
    removeModule,
    updateModules,
} from "../../modules/module-operations.ts";
import { NpmRegistry } from "../../modules/npm-registry.ts";
import type { Project } from "../../project/project.ts";
import { bedrockVersionSpecSchema } from "../../server/server-config.ts";
import type { Logger } from "../../util/logger.ts";
import { type CliContext, createLogger, loadProject, parseOptions } from "../context.ts";
import { formatTable } from "../table.ts";

const installOption = { install: z.boolean() };

const addOptionsSchema = z.object({
    pack: z.string().optional(),
    beta: z.boolean().optional(),
    gameVersion: bedrockVersionSpecSchema.optional(),
    ...installOption,
});

const removeOptionsSchema = z.object({
    pack: z.string().optional(),
    ...installOption,
});

const updateOptionsSchema = z.object({
    beta: z.boolean().optional(),
    gameVersion: bedrockVersionSpecSchema.optional(),
    ...installOption,
});

const GAME_VERSION_HELP = "game version for beta modules: latest, preview or a release like 1.26.60";

export function registerModuleCommands(program: Command, context: CliContext): void {
    const services = (): ModuleServices => ({
        registry: NpmRegistry.fromEnv(context.fetch, context.env),
        versions: new BedrockVersionResolver(context.fetch),
    });

    const module = program
        .command("module")
        .description("Manage @minecraft script modules (manifest dependencies and npm packages)");

    module
        .command("add")
        .description("Add a script module to a behavior pack, or a library module to the project")
        .argument("<module>", "module name, e.g. @minecraft/server")
        .argument("[version]", "stable version (2.11.0, 2.11), beta API version (2.12.0-beta) or exact npm version")
        .option("-p, --pack <name>", "behavior pack to add the module to (required if there are several)")
        .option("--beta", "use the beta API")
        .option("--game-version <version>", GAME_VERSION_HELP)
        .option("--no-install", "don't run npm install afterwards")
        .action(async (name: string, version: string | undefined, _options: unknown, command: Command) => {
            const options = parseOptions(addOptionsSchema, command);
            const logger = createLogger(context);
            const project = await loadProject(context);

            const result = await addModule(project, services(), { name, version, ...options });

            const { module: added } = result;
            const target = result.pack ? ` to pack "${result.pack.name}"` : "";
            const manifest = added.manifestVersion ? ` (manifest version ${added.manifestVersion})` : "";
            logger.info(`Added ${added.name}@${added.npmVersion}${target}${manifest}.`);
            if (added.note) {
                logger.info(added.note);
            }
            result.warnings.forEach((warning) => {
                logger.warn(warning);
            });
            await install(context, project, logger, options.install);
        });

    module
        .command("remove")
        .description("Remove a script module from a behavior pack, or a library module from the project")
        .argument("<module>", "module name")
        .option("-p, --pack <name>", "behavior pack to remove the module from (required if there are several)")
        .option("--no-install", "don't run npm install afterwards")
        .action(async (name: string, _options: unknown, command: Command) => {
            const options = parseOptions(removeOptionsSchema, command);
            const logger = createLogger(context);
            const project = await loadProject(context);

            const result = await removeModule(project, { name, pack: options.pack });

            if (result.pack) {
                logger.info(`Removed ${name} from pack "${result.pack.name}".`);
            }
            if (result.removedFromPackageJson) {
                logger.info(`Removed ${name} from package.json.`);
                await install(context, project, logger, options.install);
            }
        });

    module
        .command("update")
        .description("Update script modules to newer versions in package.json and all pack manifests")
        .argument("[module]", "module to update (default: all)")
        .argument("[version]", "version to update to (requires a module)")
        .option("--beta", "switch stable modules to the beta API")
        .option("--game-version <version>", `${GAME_VERSION_HELP} (default: latest)`)
        .option("--no-install", "don't run npm install afterwards")
        .action(async (name: string | undefined, version: string | undefined, _options: unknown, command: Command) => {
            const options = parseOptions(updateOptionsSchema, command);
            const logger = createLogger(context);
            const project = await loadProject(context);

            const updates = await updateModules(project, services(), { name, version, ...options });

            if (updates.length === 0) {
                logger.info("All modules are up to date.");
                return;
            }
            for (const update of updates) {
                logger.info(`Updated ${update.name}: ${update.from} -> ${update.to}`);
                if (update.note) {
                    logger.info(`  ${update.note}`);
                }
            }
            await install(context, project, logger, options.install);
        });

    module
        .command("list")
        .description("List the script modules of the project and the packs using them")
        .action(async () => {
            const project = await loadProject(context);
            const modules = await listModules(project);
            if (modules.length === 0) {
                context.io.stdout('No script modules yet. Add one with "bah module add @minecraft/server".\n');
                return;
            }
            const rows = modules.map((entry) => [
                entry.name,
                entry.kind,
                entry.npmVersion ?? "-",
                [...entry.packs].map(([pack, version]) => `${pack} (${version})`).join(", ") || "-",
            ]);
            context.io.stdout(formatTable(["MODULE", "KIND", "NPM VERSION", "PACKS"], rows));

            const problems = modules.flatMap((entry) => entry.problems.map((problem) => `${entry.name}: ${problem}`));
            if (problems.length > 0) {
                context.io.stdout(`\nProblems:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`);
            }
        });
}

async function install(context: CliContext, project: Project, logger: Logger, enabled: boolean): Promise<void> {
    if (!enabled) {
        logger.info("Skipped npm install; run it yourself to update node_modules.");
        return;
    }
    logger.info("Running npm install...");
    await context.runner.run("npm", ["install"], { cwd: project.paths.root });
}
