import type { Project } from "../project/project.ts";
import type { Logger } from "../util/logger.ts";
import type { CliContext } from "./context.ts";

/** Runs `npm install` in the project, unless disabled (--no-install). */
export async function runNpmInstall(
    context: CliContext,
    project: Project,
    logger: Logger,
    enabled: boolean,
): Promise<void> {
    if (!enabled) {
        logger.info("Skipped npm install; run it yourself to update node_modules.");
        return;
    }
    logger.info("Running npm install...");
    await context.runner.run("npm", ["install"], { cwd: project.paths.root });
}
