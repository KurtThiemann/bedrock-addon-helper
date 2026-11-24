import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { pathExists } from "../util/fs.ts";
import { writeJsonFile } from "../util/json-file.ts";
import { formatUdpPorts } from "./network.ts";
import type { LocalServerConfig, ServerConfig, ServerPropertyValue } from "./server-config.ts";
import { updateServerProperties } from "./server-properties.ts";

/** World folder name inside `worlds/`; fixed so the tool always knows where the world is. */
export const LEVEL_NAME = "world";

/** Development-friendly defaults; a server's `properties` override them. */
export const DEFAULT_SERVER_PROPERTIES: Readonly<Record<string, ServerPropertyValue>> = {
    "allow-list": false,
    "allow-cheats": true,
    "default-player-permission-level": "operator",
    "texturepack-required": true,
    "content-log-console-output-enabled": true,
};

/** Script modules allowed by default (same as v1), plus the ones the packs use. */
export const DEFAULT_ALLOWED_MODULES: readonly string[] = [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-gametest",
    "@minecraft/server-admin",
    "@minecraft/server-net",
    "@minecraft/server-editor",
    "@minecraft/debug-utilities",
];

export interface ServerFilesInput {
    readonly config: ServerConfig;
    readonly local: LocalServerConfig;
    readonly serverName: string;
    /** `server-public-ip`; null leaves it unset. */
    readonly advertiseHost: string | null;
    /** Engine modules the project's packs use. */
    readonly projectModules: readonly string[];
}

/** server.properties defaults of test servers, applied when their world is created. */
export const TEST_SERVER_PROPERTIES: Readonly<Record<string, ServerPropertyValue>> = {
    "level-type": "FLAT",
};

export function worldDirectory(dataDir: string): string {
    return join(dataDir, "worlds", LEVEL_NAME);
}

export function levelDatPath(dataDir: string): string {
    return join(worldDirectory(dataDir), "level.dat");
}

/**
 * Writes the files the server reads at startup: server.properties, the
 * script config (permissions, variables, secrets) and the identity key.
 */
export async function writeServerFiles(dataDir: string, input: ServerFilesInput): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    await writeProperties(dataDir, input);

    const scriptConfig = join(dataDir, "config", "default");
    const allowedModules = [
        ...new Set([...DEFAULT_ALLOWED_MODULES, ...input.projectModules, ...(input.config.allowedModules ?? [])]),
    ].sort();
    await writeJsonFile(join(scriptConfig, "permissions.json"), z.unknown(), { allowed_modules: allowedModules });
    await writeJsonFile(join(scriptConfig, "variables.json"), z.unknown(), input.config.variables);
    await writeJsonFile(join(scriptConfig, "secrets.json"), z.unknown(), input.local.secrets ?? {});

    await ensureIdentityKey(dataDir);
}

async function writeProperties(dataDir: string, input: ServerFilesInput): Promise<void> {
    const path = join(dataDir, "server.properties");
    const current = (await pathExists(path)) ? await readFile(path, "utf8") : "";
    const managed: Record<string, ServerPropertyValue> = {
        "server-name": input.serverName,
        "level-name": LEVEL_NAME,
        "server-port": input.config.port,
        "server-udp-ports": formatUdpPorts(input.config.udpPorts),
    };
    if (input.advertiseHost !== null) {
        managed["server-public-ip"] = input.advertiseHost;
    }
    const defaults = input.config.test
        ? { ...DEFAULT_SERVER_PROPERTIES, ...TEST_SERVER_PROPERTIES }
        : DEFAULT_SERVER_PROPERTIES;
    const values = { ...defaults, ...input.config.properties, ...managed };
    await writeFile(path, updateServerProperties(current, values), "utf8");
}

/**
 * Without a saved key the server makes up a new identity on every start, and
 * players have to accept the server again each time. Generate one once.
 */
async function ensureIdentityKey(dataDir: string): Promise<void> {
    const path = join(dataDir, "keys", "server_identity_key.pem");
    if (await pathExists(path)) {
        return;
    }
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    await mkdir(join(dataDir, "keys"), { recursive: true });
    await writeFile(path, privateKey.export({ type: "sec1", format: "pem" }), { mode: 0o600 });
}
