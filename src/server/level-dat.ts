import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type * as Nbt from "prismarine-nbt";
import { BahError } from "../util/errors.ts";

// prismarine-nbt is CommonJS; load it the way its typings describe it.
const nbt = createRequire(import.meta.url)("prismarine-nbt") as typeof Nbt;

/** Flags the game stores next to the experiment toggles. */
const EXPERIMENT_META_FLAGS = ["experiments_ever_used", "saved_with_toggled_experiments"];

/** Friendlier names for experiment toggles. */
export const EXPERIMENT_ALIASES: Readonly<Record<string, string>> = {
    "beta-apis": "gametest",
};

export function resolveExperimentName(name: string): string {
    return EXPERIMENT_ALIASES[name] ?? name;
}

/*
 * Bedrock level.dat: 4-byte little-endian storage version, 4-byte
 * little-endian length, then an uncompressed little-endian NBT compound.
 */

export async function readLevelDat(path: string): Promise<{ version: number; root: Nbt.NBT }> {
    const content = await readFile(path);
    if (content.length < 8) {
        throw new BahError(`${path} is not a valid level.dat.`);
    }
    const version = content.readUInt32LE(0);
    const root = nbt.parseUncompressed(content.subarray(8), "little");
    return { version, root };
}

export async function writeLevelDat(path: string, version: number, root: Nbt.NBT): Promise<void> {
    const body = nbt.writeUncompressed(root, "little");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(version, 0);
    header.writeUInt32LE(body.length, 4);
    await writeFile(path, Buffer.concat([header, body]));
}

/** The experiment toggles that are enabled in a level.dat. */
export async function readExperiments(path: string): Promise<string[]> {
    const { root } = await readLevelDat(path);
    const experiments = root.value.experiments;
    if (experiments?.type !== "compound") {
        return [];
    }
    return Object.entries(experiments.value)
        .filter(([name, tag]) => !EXPERIMENT_META_FLAGS.includes(name) && tag?.type === "byte" && tag.value === 1)
        .map(([name]) => name)
        .sort();
}

/**
 * Enables exactly the given experiment toggles (other toggles are removed).
 * Returns true if the file changed. The server must be stopped.
 */
export async function setExperiments(path: string, experiments: readonly string[]): Promise<boolean> {
    const wanted = [...new Set(experiments.map(resolveExperimentName))].sort();
    if (JSON.stringify(await readExperiments(path)) === JSON.stringify(wanted)) {
        return false;
    }

    const { version, root } = await readLevelDat(path);
    const previous = root.value.experiments?.type === "compound" ? root.value.experiments.value : {};
    const value: Nbt.Compound["value"] = {};
    for (const name of wanted) {
        value[name] = nbt.byte(1);
    }
    for (const flag of EXPERIMENT_META_FLAGS) {
        // Keep the game's bookkeeping; mark experiments as used when any are on.
        const old = previous[flag];
        value[flag] = wanted.length > 0 ? nbt.byte(1) : (old ?? nbt.byte(0));
    }
    root.value.experiments = nbt.comp(value);
    await writeLevelDat(path, version, root);
    return true;
}
