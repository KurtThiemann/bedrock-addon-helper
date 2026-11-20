import { join } from "node:path";
import type { PackConfig, PackType, ScriptsConfig } from "../project/project-config.ts";
import { pathExists } from "../util/fs.ts";
import { type Manifest, readManifest, writeManifest } from "./manifest.ts";

export const MANIFEST_FILE = "manifest.json";

/** A pack in the project, with `bah.json` defaults resolved and absolute paths. */
export class Pack {
    readonly name: string;
    readonly type: PackType;
    /** Absolute path of the pack directory. */
    readonly directory: string;
    readonly bundle: boolean;
    /** Names of other project packs this pack depends on. */
    readonly dependencies: readonly string[];
    readonly scripts: ScriptsConfig | null;

    constructor(projectRoot: string, config: PackConfig) {
        this.name = config.name;
        this.type = config.type;
        this.directory = join(projectRoot, config.path);
        this.bundle = config.bundle ?? true;
        this.dependencies = config.dependencies ?? [];
        this.scripts = config.scripts ?? null;
    }

    get manifestPath(): string {
        return join(this.directory, MANIFEST_FILE);
    }

    hasManifest(): Promise<boolean> {
        return pathExists(this.manifestPath);
    }

    readManifest(): Promise<Manifest> {
        return readManifest(this.manifestPath);
    }

    writeManifest(manifest: Manifest): Promise<void> {
        return writeManifest(this.manifestPath, manifest);
    }
}
