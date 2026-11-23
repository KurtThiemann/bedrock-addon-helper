import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type * as Nbt from "prismarine-nbt";
import type { Fetch } from "../bedrock/version-resolver.ts";
import type { ContainerRuntime, ContainerSpec, ContainerState } from "../server/container-runtime.ts";
import { writeLevelDat } from "../server/level-dat.ts";
import { pathExists } from "../util/fs.ts";
import { fakeNpmFetch } from "./fake-npm.ts";

const nbt = createRequire(import.meta.url)("prismarine-nbt") as typeof Nbt;

/** In-memory containers. `run` creates the world like a real first start would. */
export class FakeRuntime implements ContainerRuntime {
    readonly containers = new Map<string, { spec: ContainerSpec; state: ContainerState }>();
    readonly calls: string[] = [];
    /** Called by `attach`; lets tests simulate a server stopping while attached. */
    onAttach: (name: string) => void = () => {};

    async state(name: string): Promise<ContainerState | null> {
        return this.containers.get(name)?.state ?? null;
    }

    async run(spec: ContainerSpec): Promise<void> {
        this.calls.push(`run ${spec.name}`);
        if (this.containers.get(spec.name)?.state === "running") {
            throw new Error("already running");
        }
        this.containers.set(spec.name, { spec, state: "running" });
        const data = spec.volumes.find((volume) => volume.container === "/data")?.host;
        if (data !== undefined) {
            const world = join(data, "worlds", "world");
            await mkdir(world, { recursive: true });
            const levelDat = join(world, "level.dat");
            if (!(await pathExists(levelDat))) {
                await writeLevelDat(levelDat, 10, {
                    type: "compound",
                    name: "",
                    value: { LevelName: nbt.string("world"), experiments: nbt.comp({}) },
                });
            }
        }
    }

    async stop(name: string): Promise<void> {
        this.calls.push(`stop ${name}`);
        const container = this.containers.get(name);
        if (container) {
            container.state = "stopped";
        }
    }

    async remove(name: string): Promise<void> {
        this.calls.push(`remove ${name}`);
        this.containers.delete(name);
    }

    async exec(name: string, command: readonly string[]): Promise<void> {
        this.calls.push(`exec ${name} ${command.join(" ")}`);
    }

    async attach(name: string): Promise<void> {
        this.calls.push(`attach ${name}`);
        this.onAttach(name);
    }

    async logs(name: string, options: { follow: boolean; tail?: number | undefined }): Promise<void> {
        this.calls.push(`logs ${name} follow=${options.follow} tail=${options.tail ?? "-"}`);
    }

    /** Whether a running container publishes this TCP port. */
    servesPort(port: number): boolean {
        return [...this.containers.values()].some(
            (container) =>
                container.state === "running" &&
                container.spec.ports.some((mapping) => mapping.protocol === "tcp" && mapping.port === port),
        );
    }
}

/**
 * Fetch for server tests: npm and Bedrock download links (release 1.26.66.1,
 * preview 1.26.70.26), plus `/v1/join` for ports a running fake container serves.
 */
export function fakeServerFetch(runtime: FakeRuntime): Fetch {
    const npm = fakeNpmFetch();
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === "/v1/join") {
            if (!runtime.servesPort(Number(url.port))) {
                throw new TypeError("fetch failed: connection refused");
            }
            return Response.json({
                name: "Dedicated Server",
                protocol: 2225,
                version: "1.26.66",
                level: "world",
                players: 0,
                maxPlayers: 10,
                gameType: 0,
            });
        }
        return npm.fetch(input, init);
    };
}
