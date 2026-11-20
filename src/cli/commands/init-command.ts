import { resolve } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { initProject } from "../../project/init-project.ts";
import { type CliContext, createLogger, parseOptions } from "../context.ts";

const optionsSchema = z.object({
    name: z.string().optional(),
});

export function registerInitCommand(program: Command, context: CliContext): void {
    program
        .command("init")
        .description("Create a new add-on project (bah.json) in the given or current directory")
        .argument("[directory]", "project directory", ".")
        .option("-n, --name <name>", "project name (default: from package.json or the directory name)")
        .action(async (directory: string, _options: unknown, command: Command) => {
            const options = parseOptions(optionsSchema, command);
            const logger = createLogger(context);
            const root = resolve(context.cwd, directory);

            const result = await initProject({ root, ...options });

            for (const file of result.created) {
                logger.info(`Created ${file}`);
            }
            for (const file of result.updated) {
                logger.info(`Updated ${file}`);
            }
            logger.info(`Initialized project "${result.project.name}" in ${root}`);
            logger.info('Next: add a pack with "bah pack add behavior <name>" or "bah pack add resource <name>".');
        });
}
