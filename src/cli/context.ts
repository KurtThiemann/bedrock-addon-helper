import type { Command } from "commander";
import { z } from "zod";
import type { Fetch } from "../bedrock/version-resolver.ts";
import { Project } from "../project/project.ts";
import type { ContainerRuntime } from "../server/container-runtime.ts";
import { DockerCli } from "../server/docker-cli.ts";
import { type CommandRunner, spawnCommandRunner } from "../util/command-runner.ts";
import { BahError } from "../util/errors.ts";
import { createIoLogger, type Logger } from "../util/logger.ts";
import { type CliIo, processIo } from "./io.ts";

/** Everything a command needs from the outside world; replaced in tests. */
export interface CliContext {
    readonly io: CliIo;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly fetch: Fetch;
    readonly runner: CommandRunner;
    readonly containers: ContainerRuntime;
    /** Aborted when the user presses Ctrl+C during long-running commands. */
    readonly interrupt: () => AbortSignal;
}

export function defaultCliContext(): CliContext {
    return {
        io: processIo,
        cwd: process.cwd(),
        env: process.env,
        fetch: globalThis.fetch,
        runner: spawnCommandRunner,
        containers: new DockerCli(),
        interrupt: () => {
            const controller = new AbortController();
            process.once("SIGINT", () => controller.abort());
            return controller.signal;
        },
    };
}

export function createLogger(context: CliContext): Logger {
    return createIoLogger(context.io);
}

export function loadProject(context: CliContext): Promise<Project> {
    return Project.load({ cwd: context.cwd, env: context.env });
}

/** Validates a command's options (commander leaves them untyped). */
export function parseOptions<T extends z.ZodType>(schema: T, command: Command): z.output<T> {
    const result = schema.safeParse(command.opts());
    if (!result.success) {
        throw new BahError(`Invalid options:\n${z.prettifyError(result.error)}`, { cause: result.error });
    }
    return result.data;
}
