import { relative } from "node:path";
import { Argument, type Command, Option } from "commander";
import { z } from "zod";
import { toEngineVersion } from "../../bedrock/version.ts";
import { BedrockVersionResolver } from "../../bedrock/version-resolver.ts";
import { addPack, linkPacks, removePack, unlinkPacks } from "../../pack/pack-operations.ts";
import { packTypeSchema } from "../../project/project-config.ts";
import { bedrockVersionSpecSchema } from "../../server/server-config.ts";
import { type CliContext, createLogger, loadProject, parseOptions } from "../context.ts";
import { formatTable } from "../table.ts";

const addOptionsSchema = z.object({
    path: z.string().optional(),
    description: z.string().optional(),
    minEngineVersion: bedrockVersionSpecSchema,
    scripts: z.enum(["js", "ts"]).optional(),
    dependsOn: z.array(z.string()).optional(),
    bundle: z.boolean(),
});

const removeOptionsSchema = z.object({
    deleteFiles: z.boolean().optional(),
});

export function registerPackCommands(program: Command, context: CliContext): void {
    const pack = program.command("pack").description("Manage the behavior and resource packs of the project");

    pack.command("add")
        .description("Create a new pack, or register an existing pack directory that has a manifest.json")
        .addArgument(new Argument("<type>", "pack type").choices(packTypeSchema.options))
        .argument("<name>", "pack name")
        .option("--path <path>", "pack directory relative to the project root (default: packs/<name>)")
        .option("-d, --description <text>", "pack description")
        .option(
            "--min-engine-version <version>",
            "min_engine_version for new packs: latest, preview or a version",
            "latest",
        )
        .addOption(new Option("--scripts <language>", "add a script entry point").choices(["js", "ts"]))
        .option("--depends-on <packs...>", "other packs of this project this pack depends on")
        .option("--no-bundle", "leave the pack out of the .mcaddon bundle")
        .action(async (type: string, name: string, _options: unknown, command: Command) => {
            const options = parseOptions(addOptionsSchema, command);
            const packType = packTypeSchema.parse(type);
            const logger = createLogger(context);
            const project = await loadProject(context);

            const resolver = new BedrockVersionResolver(context.fetch);

            const result = await addPack(project, {
                name,
                type: packType,
                minEngineVersion: async () => toEngineVersion(await resolver.resolve(options.minEngineVersion)),
                bundle: options.bundle,
                ...(options.path !== undefined && { path: options.path }),
                ...(options.description !== undefined && { description: options.description }),
                ...(options.scripts !== undefined && { scripts: options.scripts }),
                ...(options.dependsOn !== undefined && { dependencies: options.dependsOn }),
            });

            for (const file of result.created) {
                logger.info(`Created ${file}`);
            }
            const where = relative(project.paths.root, result.pack.directory);
            logger.info(
                result.imported
                    ? `Registered existing ${packType} pack "${name}" (${where}).`
                    : `Added ${packType} pack "${name}" (${where}).`,
            );
        });

    pack.command("list")
        .description("List the packs of the project")
        .action(async () => {
            const project = await loadProject(context);
            const packs = project.packs;
            if (packs.length === 0) {
                context.io.stdout('No packs yet. Add one with "bah pack add".\n');
                return;
            }
            const rows = packs.map((item) => [
                item.name,
                item.type,
                relative(project.paths.root, item.directory),
                item.bundle ? "yes" : "no",
                item.scripts?.entry ?? "-",
                item.dependencies.join(", ") || "-",
            ]);
            context.io.stdout(formatTable(["NAME", "TYPE", "PATH", "BUNDLE", "SCRIPTS", "DEPENDS ON"], rows));
        });

    pack.command("remove")
        .description("Remove a pack from the project")
        .argument("<name>", "pack name")
        .option("--delete-files", "also delete the pack directory")
        .action(async (name: string, _options: unknown, command: Command) => {
            const options = parseOptions(removeOptionsSchema, command);
            const logger = createLogger(context);
            const project = await loadProject(context);

            await removePack(project, name, { deleteFiles: options.deleteFiles ?? false });

            logger.info(
                options.deleteFiles
                    ? `Removed pack "${name}" and deleted its files.`
                    : `Removed pack "${name}" from the project; its files were kept.`,
            );
        });

    pack.command("link")
        .description("Make a pack depend on another pack of the project")
        .argument("<pack>", "the pack that gets the dependency")
        .argument("<dependency>", "the pack it depends on")
        .action(async (name: string, dependency: string) => {
            const logger = createLogger(context);
            const project = await loadProject(context);

            const changed = await linkPacks(project, name, dependency);

            logger.info(
                changed ? `"${name}" now depends on "${dependency}".` : `"${name}" already depends on "${dependency}".`,
            );
        });

    pack.command("unlink")
        .description("Remove a dependency between two packs of the project")
        .argument("<pack>", "the pack that has the dependency")
        .argument("<dependency>", "the pack it depends on")
        .action(async (name: string, dependency: string) => {
            const logger = createLogger(context);
            const project = await loadProject(context);

            const changed = await unlinkPacks(project, name, dependency);

            logger.info(
                changed
                    ? `"${name}" no longer depends on "${dependency}".`
                    : `"${name}" does not depend on "${dependency}".`,
            );
        });
}
