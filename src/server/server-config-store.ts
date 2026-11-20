import { join } from "node:path";
import { BahError } from "../util/errors.ts";
import { readJsonFileOrDefault, writeJsonFile } from "../util/json-file.ts";
import {
    LOCAL_SERVERS_CONFIG_FILE,
    type LocalServerConfig,
    type LocalServersConfig,
    localServersConfigSchema,
    SERVERS_CONFIG_FILE,
    type ServerConfig,
    type ServersConfig,
    serversConfigSchema,
} from "./server-config.ts";

/** A server's shared config together with this machine's local settings. */
export interface ServerEntry {
    readonly name: string;
    readonly config: ServerConfig;
    readonly local: LocalServerConfig;
    /** Resolved advertise host (server-specific, then global), if any. */
    readonly advertiseHost: string | null;
}

/**
 * Reads and writes `.bah/servers.json` and `.bah/servers.local.json`.
 * Missing files are treated as empty.
 */
export class ServerConfigStore {
    readonly sharedPath: string;
    readonly localPath: string;
    #shared: ServersConfig;
    #local: LocalServersConfig;

    static async load(stateDir: string): Promise<ServerConfigStore> {
        const sharedPath = join(stateDir, SERVERS_CONFIG_FILE);
        const localPath = join(stateDir, LOCAL_SERVERS_CONFIG_FILE);
        const shared = await readJsonFileOrDefault(sharedPath, serversConfigSchema, { servers: {} });
        const local = await readJsonFileOrDefault(localPath, localServersConfigSchema, { servers: {} });
        return new ServerConfigStore(sharedPath, localPath, shared, local);
    }

    constructor(sharedPath: string, localPath: string, shared: ServersConfig, local: LocalServersConfig) {
        this.sharedPath = sharedPath;
        this.localPath = localPath;
        this.#shared = shared;
        this.#local = local;
    }

    get names(): string[] {
        return Object.keys(this.#shared.servers);
    }

    get entries(): ServerEntry[] {
        return this.names.map((name) => this.get(name));
    }

    /** All configs, e.g. for allocating free ports. */
    get configs(): readonly ServerConfig[] {
        return Object.values(this.#shared.servers);
    }

    has(name: string): boolean {
        return Object.hasOwn(this.#shared.servers, name);
    }

    get(name: string): ServerEntry {
        const config = this.#shared.servers[name];
        if (config === undefined) {
            throw new BahError(`Server "${name}" does not exist.`);
        }
        const local = this.#local.servers[name] ?? {};
        return {
            name,
            config,
            local,
            advertiseHost: local.advertiseHost ?? this.#local.advertiseHost ?? null,
        };
    }

    /** Adds or replaces a server's shared config (in memory). Validated on save. */
    set(name: string, config: ServerConfig): void {
        this.#shared = { ...this.#shared, servers: { ...this.#shared.servers, [name]: config } };
    }

    /** Sets a server's local config (in memory). */
    setLocal(name: string, local: LocalServerConfig): void {
        if (!this.has(name)) {
            throw new BahError(`Server "${name}" does not exist.`);
        }
        this.#local = { ...this.#local, servers: { ...this.#local.servers, [name]: local } };
    }

    /** Removes a server from both files (in memory). */
    remove(name: string): void {
        if (!this.has(name)) {
            throw new BahError(`Server "${name}" does not exist.`);
        }
        const { [name]: _shared, ...servers } = this.#shared.servers;
        const { [name]: _local, ...localServers } = this.#local.servers;
        this.#shared = { ...this.#shared, servers };
        this.#local = { ...this.#local, servers: localServers };
    }

    /** Validates and writes both files. */
    async save(): Promise<void> {
        await writeJsonFile(this.sharedPath, serversConfigSchema, this.#shared);
        await writeJsonFile(this.localPath, localServersConfigSchema, this.#local);
    }
}
