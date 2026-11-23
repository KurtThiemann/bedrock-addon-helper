import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { mcpackPath, type PackBuildResult, packOutputDirectory } from "../build/build-pack.ts";
import { type PackVersion, packVersionSchema, readManifest } from "../pack/manifest.ts";
import { MANIFEST_FILE } from "../pack/pack.ts";
import type { Project } from "../project/project.ts";
import { type PackType, packTypeSchema } from "../project/project-config.ts";
import { pathExists } from "../util/fs.ts";
import { readJsonFileOrDefault, writeJsonFile } from "../util/json-file.ts";
import { identifierSchema, uuidSchema } from "../util/schemas.ts";
import { LEVEL_NAME } from "./server-files.ts";

/** A built pack ready to be copied into a server. */
export interface DeployablePack {
    readonly name: string;
    readonly type: PackType;
    readonly uuid: string;
    readonly version: PackVersion;
    /** Unpacked build output. */
    readonly directory: string;
}

/** Records which packs bah put into a server, so removed packs can be cleaned up. */
export const DEPLOY_STATE_FILE = ".bah-deployed.json";

const deployStateSchema = z.strictObject({
    packs: z.array(
        z.strictObject({
            name: identifierSchema,
            type: packTypeSchema,
            uuid: uuidSchema,
            /** Directory name inside development_<type>_packs. */
            directory: z.string().min(1),
        }),
    ),
});
type DeployState = z.infer<typeof deployStateSchema>;

/** `worlds/<level>/world_behavior_packs.json` and `world_resource_packs.json`. */
const worldPacksSchema = z.array(z.looseObject({ pack_id: uuidSchema, version: packVersionSchema }));
type WorldPacks = z.infer<typeof worldPacksSchema>;

export interface DeployResult {
    readonly installed: readonly string[];
    readonly removed: readonly string[];
    /**
     * True if packs were added, removed or changed version. A script reload
     * doesn't pick that up; the server needs a restart.
     */
    readonly packListChanged: boolean;
}

export function toDeployable(result: PackBuildResult): DeployablePack {
    return {
        name: result.pack.name,
        type: result.pack.type,
        uuid: result.uuid,
        version: result.version,
        directory: result.outputDirectory,
    };
}

/** Packs of the project that have been built before (for deploying on server start). */
export async function findBuiltPacks(project: Project): Promise<DeployablePack[]> {
    const packs: DeployablePack[] = [];
    for (const pack of project.packs) {
        const directory = packOutputDirectory(project, pack);
        // The .mcpack is written last, so its presence means the build finished.
        if (!(await pathExists(mcpackPath(project, pack))) || !(await pathExists(join(directory, MANIFEST_FILE)))) {
            continue;
        }
        const { header } = await readManifest(join(directory, MANIFEST_FILE));
        packs.push({ name: pack.name, type: pack.type, uuid: header.uuid, version: header.version, directory });
    }
    return packs;
}

/**
 * Copies packs into a server's data directory and registers them in the
 * world. Packs deployed earlier whose name is no longer in `projectPacks`
 * are removed. Works whether or not the server is running.
 */
export async function deployPacks(
    dataDir: string,
    projectName: string,
    packs: readonly DeployablePack[],
    projectPacks: ReadonlySet<string>,
): Promise<DeployResult> {
    const statePath = join(dataDir, DEPLOY_STATE_FILE);
    const state = await readJsonFileOrDefault(statePath, deployStateSchema, { packs: [] });
    const worldDir = join(dataDir, "worlds", LEVEL_NAME);
    const worldPacksPath = (type: PackType) => join(worldDir, `world_${type}_packs.json`);
    const before: Record<PackType, WorldPacks> = {
        behavior: await readJsonFileOrDefault(worldPacksPath("behavior"), worldPacksSchema, []),
        resource: await readJsonFileOrDefault(worldPacksPath("resource"), worldPacksSchema, []),
    };
    const world = structuredClone(before);
    const nextState: DeployState["packs"] = [];
    const removed: string[] = [];

    const unregister = (type: PackType, uuid: string) => {
        world[type] = world[type].filter((entry) => entry.pack_id !== uuid);
    };

    // Clean up packs that left the project, or whose UUID changed.
    for (const old of state.packs) {
        const current = packs.find((pack) => pack.name === old.name);
        const stillInProject = projectPacks.has(old.name);
        if (!stillInProject || (current !== undefined && (current.uuid !== old.uuid || current.type !== old.type))) {
            unregister(old.type, old.uuid);
            await rm(join(dataDir, packsDirectory(old.type), old.directory), { recursive: true, force: true });
            if (!stillInProject) {
                removed.push(old.name);
            }
        } else if (current === undefined) {
            nextState.push(old);
        }
    }

    for (const pack of packs) {
        const directory = `${projectName}-${pack.name}`;
        const target = join(dataDir, packsDirectory(pack.type), directory);
        await rm(target, { recursive: true, force: true });
        await mkdir(join(dataDir, packsDirectory(pack.type)), { recursive: true });
        await cp(pack.directory, target, { recursive: true });

        const entry = world[pack.type].find((item) => item.pack_id === pack.uuid);
        if (entry) {
            entry.version = pack.version;
        } else {
            world[pack.type].push({ pack_id: pack.uuid, version: pack.version });
        }
        nextState.push({ name: pack.name, type: pack.type, uuid: pack.uuid, directory });
    }

    await mkdir(worldDir, { recursive: true });
    for (const type of packTypeSchema.options) {
        await writeJsonFile(worldPacksPath(type), worldPacksSchema, world[type]);
    }
    await writeJsonFile(statePath, deployStateSchema, { packs: nextState });

    return {
        installed: packs.map((pack) => pack.name),
        removed,
        packListChanged: !isDeepStrictEqual(before, world),
    };
}

function packsDirectory(type: PackType): string {
    return `development_${type}_packs`;
}
