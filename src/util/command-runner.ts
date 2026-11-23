import { spawn } from "node:child_process";
import { BahError } from "./errors.ts";

/** Runs external programs; replaced in tests. */
export interface CommandRunner {
    run(command: string, args: readonly string[], options: { cwd: string }): Promise<void>;
}

/** Runs the command with the terminal attached (output goes straight to the user). */
export const spawnCommandRunner: CommandRunner = {
    run(command, args, { cwd }) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                cwd,
                stdio: "inherit",
                // npm is a .cmd script on Windows, which needs a shell.
                shell: process.platform === "win32",
            });
            child.on("error", (error) => {
                reject(new BahError(`Could not run ${command}: ${error.message}`, { cause: error }));
            });
            child.on("close", (code, signal) => {
                if (code === 0) {
                    resolve();
                } else {
                    const reason = signal ? `was killed by ${signal}` : `exited with code ${code}`;
                    reject(new BahError(`${[command, ...args].join(" ")} ${reason}.`));
                }
            });
        });
    },
};
