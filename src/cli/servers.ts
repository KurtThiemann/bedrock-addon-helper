import { BedrockVersionResolver } from "../bedrock/version-resolver.ts";
import type { BuildResult } from "../build/build-project.ts";
import type { Project } from "../project/project.ts";
import { toDeployable } from "../server/deploy.ts";
import { ServerConfigStore } from "../server/server-config-store.ts";
import { type ReloadAction, ServerManager } from "../server/server-manager.ts";
import { BahError } from "../util/errors.ts";
import type { Logger } from "../util/logger.ts";
import type { CliContext } from "./context.ts";

export async function createServerManager(
    context: CliContext,
    project: Project,
    logger: Logger,
): Promise<ServerManager> {
    const store = await ServerConfigStore.load(project.paths.stateDir);
    return new ServerManager(project, store, {
        runtime: context.containers,
        fetch: context.fetch,
        versions: new BedrockVersionResolver(context.fetch),
        logger,
    });
}

const ACTION_TEXT: Record<ReloadAction, string> = {
    "not-running": "installed (not running)",
    none: "installed (reload disabled)",
    command: "installed and reloaded",
    restart: "installed and restarted",
};

/**
 * Installs the packs of a build into the given servers (default: all
 * except test servers) and
 * reloads or restarts the running ones. Every server is attempted; failures
 * are reported together at the end.
 */
export async function deployBuild(
    manager: ServerManager,
    result: BuildResult,
    options: { servers?: readonly string[] | undefined; logger: Logger; signal?: AbortSignal | undefined },
): Promise<void> {
    const names = options.servers?.length
        ? [...options.servers]
        : manager.store.entries.filter((entry) => !entry.config.test).map((entry) => entry.name);
    for (const name of names) {
        manager.store.get(name);
    }
    if (names.length === 0) {
        return;
    }

    const packs = result.packs.map(toDeployable);
    const failures: string[] = [];
    for (const name of names) {
        try {
            const deployed = await manager.deploy(name, packs, { signal: options.signal });
            const removed = deployed.deploy.removed.length > 0 ? `, removed ${deployed.deploy.removed.join(", ")}` : "";
            options.logger.info(`Server "${name}": ${ACTION_TEXT[deployed.action]}${removed}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            options.logger.error(`Server "${name}": ${message}`);
            failures.push(name);
        }
    }
    if (failures.length > 0) {
        throw new BahError(`Deploying failed for ${failures.map((name) => `"${name}"`).join(", ")}.`);
    }
}
