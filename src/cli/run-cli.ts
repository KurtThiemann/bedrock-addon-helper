import { Command, CommanderError } from "commander";
import { BahError } from "../util/errors.ts";
import { type CliIo, processIo } from "./io.ts";
import { readPackageInfo } from "./package-info.ts";

export async function createProgram(io: CliIo): Promise<Command> {
    const { version } = await readPackageInfo();

    const program = new Command()
        .name("bah")
        .description("Build and test Minecraft Bedrock Edition add-ons")
        .version(version)
        .showHelpAfterError()
        .configureOutput({
            writeOut: (text) => io.stdout(text),
            writeErr: (text) => io.stderr(text),
        })
        .exitOverride();

    // Commands are registered here as they are implemented.

    return program;
}

/**
 * Runs the CLI with the given arguments (without the node/script prefix)
 * and returns the process exit code instead of exiting.
 */
export async function runCli(argv: readonly string[], io: CliIo = processIo): Promise<number> {
    const program = await createProgram(io);
    try {
        await program.parseAsync([...argv], { from: "user" });
        return 0;
    } catch (error) {
        if (error instanceof CommanderError) {
            return error.exitCode;
        }
        if (error instanceof BahError) {
            io.stderr(`Error: ${error.message}\n`);
        } else {
            // Unexpected: include the stack trace to make bug reports useful.
            io.stderr(`Unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        }
        return 1;
    }
}
