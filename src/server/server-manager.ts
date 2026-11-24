import { randomBytes } from "node:crypto";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type BedrockVersion, compareBedrockVersions, formatBedrockVersion } from "../bedrock/version.ts";
import type { BedrockVersionResolver, Fetch } from "../bedrock/version-resolver.ts";
import { moduleKindOf } from "../modules/module-catalog.ts";
import { isModuleDependency } from "../pack/manifest.ts";
import type { Project } from "../project/project.ts";
import { BahError } from "../util/errors.ts";
import { pathExists } from "../util/fs.ts";
import type { Logger } from "../util/logger.ts";
import type { ContainerRuntime, ContainerSpec, ContainerState, PortMapping } from "./container-runtime.ts";
import { type DeployablePack, type DeployResult, deployPacks, findBuiltPacks } from "./deploy.ts";
import { resolveExperimentName, setExperiments } from "./level-dat.ts";
import {
    allocatePorts,
    assertSupportedVersion,
    detectLanAddress,
    isPortFree,
    type PortChecker,
    requiredUdpPorts,
    udpPortCount,
} from "./network.ts";
import { queryServer, type ServerInfo, waitUntilReady } from "./readiness.ts";
import type { BedrockVersionSpec, ReloadStrategy, ServerConfig } from "./server-config.ts";
import type { ServerConfigStore, ServerEntry } from "./server-config-store.ts";
import { levelDatPath, worldDirectory, writeServerFiles } from "./server-files.ts";

export const SERVER_IMAGE = "itzg/minecraft-bedrock-server:latest";
/** Experiment needed for beta script APIs. */
export const BETA_APIS_EXPERIMENT = "gametest";

const STOP_TIMEOUT_SECONDS = 30;
const START_TIMEOUT_MS = 3 * 60_000;
/** The first start downloads the server, which takes longer. */
const FIRST_START_TIMEOUT_MS = 6 * 60_000;
const LOCALHOST = "127.0.0.1";
/** Copy of a test server's freshly created world, restored before every start. */
const WORLD_TEMPLATE_DIR = ".bah-world-template";

export interface ServerManagerDeps {
    readonly runtime: ContainerRuntime;
    readonly fetch: Fetch;
    readonly versions: BedrockVersionResolver;
    readonly logger: Logger;
    readonly isPortFree?: PortChecker;
    readonly lanAddress?: () => string | null;
    /** Poll interval while waiting for servers; lowered in tests. */
    readonly pollIntervalMs?: number;
}

export interface CreateServerOptions {
    readonly version?: BedrockVersionSpec | undefined;
    readonly port?: number | undefined;
    readonly experiments?: readonly string[] | undefined;
    readonly reload?: ReloadStrategy | undefined;
    /** Create a test server for `bah test`. */
    readonly test?: boolean | undefined;
}

export interface ServerStatus {
    readonly name: string;
    readonly config: ServerConfig;
    readonly state: ContainerState | "missing";
    /** Live status from the server, if it is running and answering. */
    readonly info: ServerInfo | null;
    readonly address: string;
}

/** What happened to a server after a deploy. */
export type ReloadAction = "not-running" | "none" | "command" | "restart";

export interface ServerDeployResult {
    readonly name: string;
    readonly deploy: DeployResult;
    readonly action: ReloadAction;
}

export interface StartResult {
    readonly info: ServerInfo;
    readonly address: string;
    readonly version: BedrockVersion;
}

export class ServerManager {
    readonly #project: Project;
    readonly #store: ServerConfigStore;
    readonly #deps: ServerManagerDeps;

    constructor(project: Project, store: ServerConfigStore, deps: ServerManagerDeps) {
        this.#project = project;
        this.#store = store;
        this.#deps = deps;
    }

    get store(): ServerConfigStore {
        return this.#store;
    }

    containerName(entry: ServerEntry): string {
        return `bah-${this.#project.name}-${entry.name}-${entry.config.id.slice(0, 8)}`.toLowerCase();
    }

    dataDirectory(name: string): string {
        return join(this.#project.paths.serversDataDir, name);
    }

    /** The address players connect to. */
    address(entry: ServerEntry): string {
        return `${this.#advertiseHost(entry) ?? "localhost"}:${entry.config.port}`;
    }

    /* ------------------------------------------------------------ config */

    async create(name: string, options: CreateServerOptions = {}): Promise<ServerEntry> {
        if (this.#store.has(name)) {
            throw new BahError(`Server "${name}" already exists.`);
        }
        const versionSpec = options.version ?? "latest";
        const version = await this.#deps.versions.resolve(versionSpec);
        assertSupportedVersion(version);
        const udpCount = requiredUdpPorts(version);

        const checker = this.#deps.isPortFree ?? isPortFree;
        let ports: { port: number; udpPorts: { start: number; end: number } };
        if (options.port !== undefined) {
            ports = { port: options.port, udpPorts: { start: options.port + 1, end: options.port + udpCount } };
        } else {
            ports = await allocatePorts(this.#store.configs, udpCount, checker);
        }

        const config: ServerConfig = {
            id: randomBytes(6).toString("hex"),
            version: versionSpec,
            ...ports,
            experiments: [...new Set((options.experiments ?? []).map(resolveExperimentName))],
            variables: {},
            properties: {},
            reload: options.test ? { mode: "none" } : (options.reload ?? { mode: "command", command: "reload" }),
            ...(options.test ? { test: true } : {}),
        };
        this.#store.set(name, config);
        await this.#store.save();
        return this.#store.get(name);
    }

    async remove(name: string, options: { purge?: boolean } = {}): Promise<void> {
        const entry = this.#store.get(name);
        await this.#deps.runtime.remove(this.containerName(entry));
        this.#store.remove(name);
        await this.#store.save();
        if (options.purge) {
            await rm(this.dataDirectory(name), { recursive: true, force: true });
        }
    }

    /* --------------------------------------------------------- lifecycle */

    async state(name: string): Promise<ContainerState | null> {
        return this.#deps.runtime.state(this.containerName(this.#store.get(name)));
    }

    async start(name: string, options: { signal?: AbortSignal } = {}): Promise<StartResult> {
        const entry = this.#store.get(name);
        const container = this.containerName(entry);
        if ((await this.#deps.runtime.state(container)) === "running") {
            throw new BahError(`Server "${name}" is already running. Use "bah server restart ${name}" to restart it.`);
        }

        const version = await this.#deps.versions.resolve(entry.config.version);
        assertSupportedVersion(version);
        const needed = requiredUdpPorts(version);
        if (udpPortCount(entry.config.udpPorts) < needed) {
            throw new BahError(
                `Bedrock ${formatBedrockVersion(version)} needs ${needed} UDP ports, but server "${name}" has ${udpPortCount(entry.config.udpPorts)}. Widen "udpPorts" in .bah/servers.json.`,
            );
        }
        await this.#assertPortsFree(entry);

        const dataDir = this.dataDirectory(name);
        const usage = await this.#writeServerFiles(entry);

        const spec = await this.#containerSpec(entry, version);
        const levelDat = levelDatPath(dataDir);
        const isTest = entry.config.test === true;
        if (isTest) {
            await this.#resetWorld(entry, spec, options.signal);
        } else if (!(await pathExists(levelDat))) {
            await this.#createWorld(entry, spec, options.signal);
        }

        // Install the latest build, so a new server has the packs right away.
        const packs = await findBuiltPacks(this.#project, isTest ? "test" : "release");
        await deployPacks(dataDir, this.#project.name, packs, this.#projectPackNames());

        const experiments = [...entry.config.experiments.map(resolveExperimentName)];
        if ((usage.beta || isTest) && !experiments.includes(BETA_APIS_EXPERIMENT)) {
            experiments.push(BETA_APIS_EXPERIMENT);
        }
        await setExperiments(levelDat, experiments);

        const info = await this.#runUntilReady(entry, spec, START_TIMEOUT_MS, options.signal);
        return { info, address: this.address(entry), version };
    }

    /**
     * Installs built packs into a server and, if it is running, applies its
     * reload strategy. Added, removed or re-versioned packs always need a
     * restart, since a reload command only reloads scripts and functions.
     */
    async deploy(
        name: string,
        packs: readonly DeployablePack[],
        options: { signal?: AbortSignal } = {},
    ): Promise<ServerDeployResult> {
        const entry = this.#store.get(name);
        if (entry.config.test) {
            throw new BahError(`"${name}" is a test server; it only runs test builds from "bah test".`);
        }
        await this.#writeServerFiles(entry);
        const deploy = await deployPacks(this.dataDirectory(name), this.#project.name, packs, this.#projectPackNames());

        if ((await this.#deps.runtime.state(this.containerName(entry))) !== "running") {
            return { name, deploy, action: "not-running" };
        }
        const { reload } = entry.config;
        if (reload.mode === "none") {
            return { name, deploy, action: "none" };
        }
        if (reload.mode === "restart" || deploy.packListChanged) {
            await this.restart(name, options);
            return { name, deploy, action: "restart" };
        }
        await this.command(name, reload.command);
        return { name, deploy, action: "command" };
    }

    async stop(name: string): Promise<boolean> {
        const entry = this.#store.get(name);
        const container = this.containerName(entry);
        if ((await this.#deps.runtime.state(container)) !== "running") {
            return false;
        }
        await this.#deps.runtime.stop(container, STOP_TIMEOUT_SECONDS);
        return true;
    }

    async restart(name: string, options: { signal?: AbortSignal } = {}): Promise<StartResult> {
        await this.stop(name);
        return this.start(name, options);
    }

    async status(name: string): Promise<ServerStatus> {
        const entry = this.#store.get(name);
        const state = (await this.#deps.runtime.state(this.containerName(entry))) ?? "missing";
        const info = state === "running" ? await queryServer(this.#deps.fetch, LOCALHOST, entry.config.port) : null;
        return { name, config: entry.config, state, info, address: this.address(entry) };
    }

    /* ----------------------------------------------------------- console */

    /** Sends a console command to a running server. */
    async command(name: string, command: string): Promise<void> {
        const container = await this.#runningContainer(name);
        await this.#deps.runtime.exec(container, ["send-command", ...command.split(/\s+/).filter(Boolean)]);
    }

    async logs(name: string, options: { follow: boolean; tail?: number | undefined }): Promise<void> {
        const entry = this.#store.get(name);
        const container = this.containerName(entry);
        if ((await this.#deps.runtime.state(container)) === null) {
            throw new BahError(`Server "${name}" has not been started yet.`);
        }
        await this.#deps.runtime.logs(container, options);
    }

    /**
     * Passes the server's output, from its start on, to `onLine` until the
     * server stops or `signal` is aborted.
     */
    async followLogs(name: string, onLine: (line: string) => void, signal: AbortSignal): Promise<void> {
        await this.#deps.runtime.followLogs(await this.#runningContainer(name), onLine, signal);
    }

    /**
     * Attaches the terminal to the server console. When the server stops
     * (e.g. a restart after a build), waits for it and attaches again, until
     * `signal` is aborted.
     */
    async attach(name: string, signal: AbortSignal): Promise<void> {
        const container = await this.#runningContainer(name);
        const interval = this.#deps.pollIntervalMs ?? 2000;
        let waiting = false;
        while (!signal.aborted) {
            if ((await this.#deps.runtime.state(container)) === "running") {
                this.#deps.logger.info(`Attached to "${name}". Type commands; press Ctrl+C to detach.`);
                waiting = false;
                await this.#deps.runtime.attach(container);
                if ((await this.#deps.runtime.state(container)) === "running") {
                    // Detached (or input ended) while the server keeps running: we're done.
                    return;
                }
                continue;
            }
            if (!waiting) {
                this.#deps.logger.info(`Server "${name}" is not running; waiting for it to start...`);
                waiting = true;
            }
            await sleep(interval, undefined, { signal }).catch(() => undefined);
        }
    }

    /* ----------------------------------------------------------- helpers */

    /** First start: the server downloads itself and generates the world; then it is stopped again. */
    async #createWorld(entry: ServerEntry, spec: ContainerSpec, signal: AbortSignal | undefined): Promise<void> {
        this.#deps.logger.info(`Creating the world for "${entry.name}" (first start downloads the server)...`);
        await this.#runUntilReady(entry, spec, FIRST_START_TIMEOUT_MS, signal);
        await this.#deps.runtime.stop(spec.name, STOP_TIMEOUT_SECONDS);
    }

    /**
     * Gives a test server a fresh world: a copy of the world it generated on
     * its first start, which is kept as a template.
     */
    async #resetWorld(entry: ServerEntry, spec: ContainerSpec, signal: AbortSignal | undefined): Promise<void> {
        const dataDir = this.dataDirectory(entry.name);
        const world = worldDirectory(dataDir);
        const template = join(dataDir, WORLD_TEMPLATE_DIR);
        if (!(await pathExists(template))) {
            await rm(world, { recursive: true, force: true });
            await this.#createWorld(entry, spec, signal);
            await cp(world, template, { recursive: true });
        }
        await rm(world, { recursive: true, force: true });
        await cp(template, world, { recursive: true });
    }

    /** Writes server.properties and script config; returns the project's module usage. */
    async #writeServerFiles(entry: ServerEntry): Promise<{ modules: string[]; beta: boolean }> {
        const usage = await this.#projectModuleUsage();
        await writeServerFiles(this.dataDirectory(entry.name), {
            config: entry.config,
            local: entry.local,
            serverName: `${this.#project.name} ${entry.name}`,
            advertiseHost: this.#advertiseHost(entry),
            projectModules: usage.modules,
        });
        return usage;
    }

    #projectPackNames(): Set<string> {
        return new Set(this.#project.packs.map((pack) => pack.name));
    }

    async #runningContainer(name: string): Promise<string> {
        const container = this.containerName(this.#store.get(name));
        if ((await this.#deps.runtime.state(container)) !== "running") {
            throw new BahError(`Server "${name}" is not running.`);
        }
        return container;
    }

    #advertiseHost(entry: ServerEntry): string | null {
        return entry.advertiseHost ?? (this.#deps.lanAddress ?? detectLanAddress)();
    }

    async #assertPortsFree(entry: ServerEntry): Promise<void> {
        const checker = this.#deps.isPortFree ?? isPortFree;
        const { port, udpPorts } = entry.config;
        const busy: string[] = [];
        if (!(await checker(port, "tcp"))) {
            busy.push(`${port}/tcp`);
        }
        for (let udp = udpPorts.start; udp <= udpPorts.end; udp++) {
            if (!(await checker(udp, "udp"))) {
                busy.push(`${udp}/udp`);
            }
        }
        if (busy.length > 0) {
            throw new BahError(
                `Port(s) ${busy.join(", ")} of server "${entry.name}" are in use by another program. Change "port"/"udpPorts" in .bah/servers.json.`,
            );
        }
    }

    async #containerSpec(entry: ServerEntry, version: BedrockVersion): Promise<ContainerSpec> {
        const { port, udpPorts } = entry.config;
        const env: Record<string, string> = {
            EULA: "TRUE",
            VERSION: formatBedrockVersion(version),
            // The image defaults these to 19132/19133 and would overwrite server.properties.
            SERVER_PORT: String(port),
            SERVER_PORT_V6: String(port),
        };
        if (await this.#isPreview(entry.config.version, version)) {
            env.PREVIEW = "TRUE";
        }
        const ports: PortMapping[] = [{ port, protocol: "tcp" }];
        for (let udp = udpPorts.start; udp <= udpPorts.end; udp++) {
            ports.push({ port: udp, protocol: "udp" });
        }
        const uid = process.getuid?.();
        const gid = process.getgid?.();
        return {
            name: this.containerName(entry),
            image: SERVER_IMAGE,
            env,
            ports,
            volumes: [{ host: this.dataDirectory(entry.name), container: "/data" }],
            labels: { "bah.project": this.#project.name, "bah.server": entry.name },
            user: uid !== undefined && gid !== undefined ? `${uid}:${gid}` : undefined,
        };
    }

    async #isPreview(spec: BedrockVersionSpec, version: BedrockVersion): Promise<boolean> {
        if (spec === "preview") {
            return true;
        }
        if (spec === "latest") {
            return false;
        }
        return compareBedrockVersions(version, await this.#deps.versions.latest("latest")) > 0;
    }

    async #runUntilReady(
        entry: ServerEntry,
        spec: ContainerSpec,
        timeoutMs: number,
        signal: AbortSignal | undefined,
    ): Promise<ServerInfo> {
        await this.#deps.runtime.run(spec);
        return waitUntilReady(this.#deps.fetch, {
            host: LOCALHOST,
            port: entry.config.port,
            timeoutMs,
            intervalMs: this.#deps.pollIntervalMs,
            isRunning: async () => (await this.#deps.runtime.state(spec.name)) === "running",
            signal,
        });
    }

    /** Engine modules used by the project's behavior packs, and whether any is a beta. */
    async #projectModuleUsage(): Promise<{ modules: string[]; beta: boolean }> {
        const modules = new Set<string>();
        let beta = false;
        for (const pack of this.#project.behaviorPacks) {
            if (!(await pack.hasManifest())) {
                continue;
            }
            for (const dependency of (await pack.readManifest()).dependencies ?? []) {
                if (!isModuleDependency(dependency) || !isEngineModule(dependency.module_name)) {
                    continue;
                }
                modules.add(dependency.module_name);
                beta ||= dependency.version.endsWith("-beta");
            }
        }
        return { modules: [...modules].sort(), beta };
    }
}

function isEngineModule(name: string): boolean {
    try {
        return moduleKindOf(name) === "engine";
    } catch {
        return false;
    }
}
