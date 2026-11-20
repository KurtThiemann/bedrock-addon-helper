import type { Command } from "commander";
import { z } from "zod";
import { buildProject } from "../../build/build-project.ts";
import { watchFiles, watchProject } from "../../build/watch.ts";
import { type CliContext, createLogger, loadProject, parseOptions } from "../context.ts";
import { createServerManager, deployBuild } from "../servers.ts";

const optionsSchema = z.object({
    debug: z.boolean().optional(),
    typecheck: z.boolean().optional(),
    server: z.array(z.string()).optional(),
    deploy: z.boolean(),
});

export function registerWatchCommand(program: Command, context: CliContext): void {
    program
        .command("watch")
        .description("Build, update the test servers, and repeat whenever files change (Ctrl+C to stop)")
        .option("-d, --debug", "skip minification and embed source maps")
        .option("-t, --typecheck", "type-check TypeScript packs with tsc before each build")
        .option("-s, --server <names...>", "only update these servers (default: all)")
        .option("--no-deploy", "only build, don't update the test servers")
        .action(async (_options: unknown, command: Command) => {
            const options = parseOptions(optionsSchema, command);
            const logger = createLogger(context);
            const signal = context.interrupt();

            await watchProject({
                loadProject: () => loadProject(context),
                rebuild: async (project) => {
                    const started = performance.now();
                    const result = await buildProject(
                        project,
                        { debug: options.debug, typecheck: options.typecheck },
                        { logger, runner: context.runner },
                    );
                    logger.info(
                        `Built ${result.packs.length} pack(s) in ${Math.round(performance.now() - started)} ms.`,
                    );
                    if (options.deploy) {
                        const manager = await createServerManager(context, project, logger);
                        await deployBuild(manager, result, { servers: options.server, logger, signal });
                    }
                },
                watchFiles,
                logger,
                signal,
            });
            logger.info("Stopped watching.");
        });
}
