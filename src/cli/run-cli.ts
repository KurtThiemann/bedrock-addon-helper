import { Command, CommanderError } from "commander";
import { BahError } from "../util/errors.ts";
import { registerBuildCommand } from "./commands/build-command.ts";
import { registerInitCommand } from "./commands/init-command.ts";
import { registerModuleCommands } from "./commands/module-commands.ts";
import { registerPackCommands } from "./commands/pack-commands.ts";
import { registerServerCommands } from "./commands/server-commands.ts";
import { registerTestCommand } from "./commands/test-command.ts";
import { registerWatchCommand } from "./commands/watch-command.ts";
import { type CliContext, defaultCliContext } from "./context.ts";
import { readPackageInfo } from "./package-info.ts";

export async function createProgram(context: CliContext): Promise<Command> {
    const { version } = await readPackageInfo();
    const { io } = context;

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

    registerInitCommand(program, context);
    registerPackCommands(program, context);
    registerModuleCommands(program, context);
    registerBuildCommand(program, context);
    registerServerCommands(program, context);
    registerWatchCommand(program, context);
    registerTestCommand(program, context);

    return program;
}

/**
 * Runs the CLI with the given arguments (without the node/script prefix)
 * and returns the process exit code instead of exiting.
 */
export async function runCli(argv: readonly string[], overrides: Partial<CliContext> = {}): Promise<number> {
    const context = { ...defaultCliContext(), ...overrides };
    const { io } = context;
    const program = await createProgram(context);
    try {
        await program.parseAsync([...argv], { from: "user" });
        return 0;
    } catch (error) {
        if (error instanceof CommanderError) {
            return error.exitCode;
        }
        if (error instanceof BahError) {
            io.stderr(`Error: ${error.message}\n`);
            return error.exitCode;
        } else {
            // Unexpected: include the stack trace to make bug reports useful.
            io.stderr(`Unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        }
        return 1;
    }
}
