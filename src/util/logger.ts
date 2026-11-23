import type { CliIo } from "../cli/io.ts";

/** Progress output for long-running operations (build, server management). */
export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

export interface IoLoggerOptions {
    verbose?: boolean;
}

/** Logs info to stdout and warnings/errors to stderr; debug only when verbose. */
export function createIoLogger(io: CliIo, options: IoLoggerOptions = {}): Logger {
    return {
        info: (message) => io.stdout(`${message}\n`),
        warn: (message) => io.stderr(`Warning: ${message}\n`),
        error: (message) => io.stderr(`Error: ${message}\n`),
        debug: (message) => {
            if (options.verbose) {
                io.stdout(`${message}\n`);
            }
        },
    };
}

export const silentLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
};
