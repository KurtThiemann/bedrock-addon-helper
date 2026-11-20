import { spawn } from "node:child_process";
import { BahError } from "../util/errors.ts";
import type { ContainerRuntime, ContainerSpec, ContainerState } from "./container-runtime.ts";

interface CaptureResult {
    code: number;
    stdout: string;
    stderr: string;
}

/**
 * ContainerRuntime using the `docker` command, so the user's Docker
 * context and configuration (Docker Desktop, colima, remote hosts) apply.
 */
export class DockerCli implements ContainerRuntime {
    readonly #command: string;

    constructor(command = "docker") {
        this.#command = command;
    }

    async state(name: string): Promise<ContainerState | null> {
        const result = await this.#capture(["container", "inspect", "--format", "{{.State.Status}}", name]);
        if (result.code !== 0) {
            if (/no such (container|object)/i.test(result.stderr)) {
                return null;
            }
            throw this.#error("inspect", result);
        }
        const status = result.stdout.trim();
        return status === "running" || status === "restarting" ? "running" : "stopped";
    }

    async run(spec: ContainerSpec): Promise<void> {
        const state = await this.state(spec.name);
        if (state === "running") {
            throw new BahError(`Container ${spec.name} is already running.`);
        }
        if (state === "stopped") {
            await this.remove(spec.name);
        }
        await this.#ensureImage(spec.image);

        const args = ["run", "--detach", "--interactive", "--name", spec.name];
        for (const [key, value] of Object.entries(spec.labels)) {
            args.push("--label", `${key}=${value}`);
        }
        for (const [key, value] of Object.entries(spec.env)) {
            args.push("--env", `${key}=${value}`);
        }
        for (const { port, protocol } of spec.ports) {
            args.push("--publish", `${port}:${port}/${protocol}`);
        }
        for (const { host, container } of spec.volumes) {
            args.push("--volume", `${host}:${container}`);
        }
        if (spec.user !== undefined) {
            args.push("--user", spec.user);
        }
        args.push(spec.image);

        const result = await this.#capture(args);
        if (result.code !== 0) {
            throw this.#error("run", result);
        }
    }

    async stop(name: string, timeoutSeconds: number): Promise<void> {
        const result = await this.#capture(["stop", "--time", String(timeoutSeconds), name]);
        if (result.code !== 0) {
            throw this.#error("stop", result);
        }
    }

    async remove(name: string): Promise<void> {
        const result = await this.#capture(["rm", "--force", name]);
        if (result.code !== 0 && !/no such container/i.test(result.stderr)) {
            throw this.#error("rm", result);
        }
    }

    async exec(name: string, command: readonly string[]): Promise<void> {
        const result = await this.#capture(["exec", name, ...command]);
        if (result.code !== 0) {
            throw this.#error("exec", result);
        }
    }

    attach(name: string): Promise<void> {
        // --sig-proxy=false: Ctrl+C ends the attach instead of stopping the server.
        return this.#interactive(["attach", "--sig-proxy=false", name]);
    }

    logs(name: string, options: { follow: boolean; tail?: number | undefined }): Promise<void> {
        const args = ["logs"];
        if (options.follow) {
            args.push("--follow");
        }
        if (options.tail !== undefined) {
            args.push("--tail", String(options.tail));
        }
        return this.#interactive([...args, name]);
    }

    async #ensureImage(image: string): Promise<void> {
        const inspect = await this.#capture(["image", "inspect", "--format", "{{.Id}}", image]);
        if (inspect.code === 0) {
            return;
        }
        // Not present yet: pull with visible progress, it can take a while.
        await this.#interactive(["pull", image]);
    }

    #interactive(args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.#command, args, { stdio: "inherit" });
            child.on("error", (error) => reject(this.#unavailable(error)));
            child.on("close", (code, signal) => {
                if (code === 0 || signal === "SIGINT" || code === 130) {
                    resolve();
                } else {
                    reject(new BahError(`docker ${args[0]} exited with code ${code}.`));
                }
            });
        });
    }

    #capture(args: string[]): Promise<CaptureResult> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.#command, args, { stdio: ["ignore", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
            });
            child.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
            });
            child.on("error", (error) => reject(this.#unavailable(error)));
            child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        });
    }

    #error(action: string, result: CaptureResult): BahError {
        const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
        if (/cannot connect to the docker daemon|is the docker daemon running/i.test(detail)) {
            return new BahError(`Docker is not running. Start Docker and try again.\n${detail}`);
        }
        return new BahError(`docker ${action} failed: ${detail}`);
    }

    #unavailable(error: Error): BahError {
        return new BahError(`Could not run "${this.#command}". Is Docker installed? (${error.message})`, {
            cause: error,
        });
    }
}
