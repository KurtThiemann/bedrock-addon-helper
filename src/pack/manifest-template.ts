import { randomUUID } from "node:crypto";
import type { PackType } from "../project/project-config.ts";
import type { Manifest, ManifestModule, VersionTuple } from "./manifest.ts";

export interface ManifestTemplateOptions {
    type: PackType;
    name: string;
    description: string;
    minEngineVersion: VersionTuple;
    /** Path of the built script entry inside the pack, e.g. `scripts/main.js`. */
    scriptEntry?: string;
}

const INITIAL_VERSION: VersionTuple = [1, 0, 0];

/** A fresh format 2 manifest with new UUIDs. */
export function createManifest(options: ManifestTemplateOptions): Manifest {
    const modules: ManifestModule[] =
        options.type === "behavior" ? [module("data", "Behavior data")] : [module("resources", "Resources")];

    if (options.scriptEntry !== undefined) {
        modules.push({
            ...module("script", "Scripts"),
            language: "javascript",
            entry: options.scriptEntry,
        });
    }

    return {
        format_version: 2,
        header: {
            name: options.name,
            description: options.description,
            uuid: randomUUID(),
            version: INITIAL_VERSION,
            min_engine_version: options.minEngineVersion,
        },
        modules,
    };
}

function module(type: string, description: string): ManifestModule {
    return { type, uuid: randomUUID(), version: INITIAL_VERSION, description };
}
