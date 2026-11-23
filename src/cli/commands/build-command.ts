import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { buildProject } from "../../build/build-project.ts";
import { type CliContext, createLogger, loadProject, parseOptions } from "../context.ts";
import { createServerManager, deployBuild } from "../servers.ts";

const optionsSchema = z.object({
    debug: z.boolean().optional(),
    typecheck: z.boolean().optional(),
    pack: z.array(z.string()).optional(),
    output: z.string().optional(),
    server: z.array(z.string()).optional(),
    deploy: z.boolean(),
});

export function registerBuildCommand(program: Command, context: CliContext): void {
    program
        .command("build")
        .description("Build all packs into .mcpack files and an .mcaddon, then update the test servers")
        .option("-d, --debug", "skip minification and embed source maps")
        .option("-t, --typecheck", "type-check TypeScript packs with tsc first")
        .option("-p, --pack <names...>", "only build these packs (skips the .mcaddon)")
        .option("-o, --output <file>", "where to write the .mcaddon")
        .option("-s, --server <names...>", "only update these servers (default: all)")
        .option("--no-deploy", "don't install the packs into the test servers")
        .action(async (_options: unknown, command: Command) => {
            const options = parseOptions(optionsSchema, command);
            const logger = createLogger(context);
            const project = await loadProject(context);
            const started = performance.now();

            const result = await buildProject(
                project,
                {
                    debug: options.debug,
                    typecheck: options.typecheck,
                    packs: options.pack,
                    output: options.output === undefined ? undefined : resolve(context.cwd, options.output),
                },
                { logger, runner: context.runner },
            );

            const display = (path: string) => relative(context.cwd, path) || path;
            for (const pack of result.packs) {
                logger.info(`  ${display(pack.mcpackPath)} (${await fileSize(pack.mcpackPath)})`);
            }
            if (result.mcaddonPath !== null) {
                logger.info(`  ${display(result.mcaddonPath)} (${await fileSize(result.mcaddonPath)})`);
            }
            logger.info(`Build finished in ${Math.round(performance.now() - started)} ms.`);

            if (options.deploy) {
                const manager = await createServerManager(context, project, logger);
                await deployBuild(manager, result, { servers: options.server, logger, signal: context.interrupt() });
            }
        });
}

async function fileSize(path: string): Promise<string> {
    const { size } = await stat(path);
    return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KiB`;
}
