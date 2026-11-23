import { cp, rm } from "node:fs/promises";
import { basename, join, posix, relative, sep } from "node:path";
import type { Manifest, PackVersion } from "../pack/manifest.ts";
import { manifestSchema } from "../pack/manifest.ts";
import { MANIFEST_FILE, type Pack } from "../pack/pack.ts";
import { syncPackDependencies } from "../pack/pack-dependencies.ts";
import type { Project } from "../project/project.ts";
import { BahError } from "../util/errors.ts";
import { writeJsonFile } from "../util/json-file.ts";
import { bundleScripts } from "./bundle-scripts.ts";
import { zipDirectory } from "./zip.ts";

export interface PackBuildResult {
    readonly pack: Pack;
    readonly uuid: string;
    readonly version: PackVersion;
    /** Unpacked build output, ready to copy into a server. */
    readonly outputDirectory: string;
    readonly mcpackPath: string;
    readonly warnings: readonly string[];
}

/** OS and editor clutter that never belongs in a pack. */
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export function packOutputDirectory(project: Project, pack: Pack): string {
    return join(project.paths.buildDir, "packs", pack.name);
}

export function mcpackPath(project: Project, pack: Pack): string {
    return join(project.paths.artifactsDir, `${project.name}-${pack.name}.mcpack`);
}

/**
 * Builds one pack: syncs its pack dependencies, copies its files (without
 * script sources), bundles its scripts, writes the output manifest and
 * zips the result into an .mcpack.
 */
export async function buildPack(project: Project, pack: Pack, options: { debug: boolean }): Promise<PackBuildResult> {
    if (!(await pack.hasManifest())) {
        throw new BahError(`Pack "${pack.name}" has no ${MANIFEST_FILE} (${pack.manifestPath}).`);
    }
    await syncPackDependencies(project, pack);
    const manifest = await pack.readManifest();

    const outputDirectory = packOutputDirectory(project, pack);
    await rm(outputDirectory, { recursive: true, force: true });

    const scriptSources = pack.scripts ? scriptSourcePath(pack.scripts.entry) : null;
    await cp(pack.directory, outputDirectory, {
        recursive: true,
        filter: (source) => {
            const path = relative(pack.directory, source).split(sep).join(posix.sep);
            if (path === "") {
                return true;
            }
            const name = basename(source);
            if (IGNORED_NAMES.has(name) || name.startsWith(".")) {
                return false;
            }
            return scriptSources === null || (path !== scriptSources && !path.startsWith(`${scriptSources}/`));
        },
    });

    const warnings: string[] = [];
    let outputManifest: Manifest = manifest;
    if (pack.scripts) {
        const builtEntry = pack.scripts.entry.replace(/\.ts$/, ".js");
        outputManifest = withScriptEntry(pack, manifest, builtEntry);
        const result = await bundleScripts({
            entry: join(pack.directory, pack.scripts.entry),
            outfile: join(outputDirectory, builtEntry),
            workingDirectory: project.paths.root,
            debug: options.debug,
        });
        warnings.push(...result.warnings);
    }
    await writeJsonFile(join(outputDirectory, MANIFEST_FILE), manifestSchema, outputManifest);

    const mcpack = mcpackPath(project, pack);
    await zipDirectory(outputDirectory, mcpack);

    return {
        pack,
        uuid: manifest.header.uuid,
        version: manifest.header.version,
        outputDirectory,
        mcpackPath: mcpack,
        warnings,
    };
}

/**
 * The part of the pack holding script sources, which is left out of the
 * output: the top-level directory of the entry (`scripts/main.ts` ->
 * `scripts`), or the entry file itself if it sits in the pack root.
 */
function scriptSourcePath(entry: string): string {
    return posix.normalize(entry).split("/")[0] ?? entry;
}

function withScriptEntry(pack: Pack, manifest: Manifest, entry: string): Manifest {
    const scriptModules = manifest.modules.filter((module) => module.type === "script");
    if (scriptModules.length === 0) {
        throw new BahError(
            `Pack "${pack.name}" has a script entry in bah.json, but its manifest has no "script" module.`,
        );
    }
    if (scriptModules.length > 1) {
        throw new BahError(`Pack "${pack.name}" has more than one "script" module in its manifest.`);
    }
    return {
        ...manifest,
        modules: manifest.modules.map((module) => (module.type === "script" ? { ...module, entry } : module)),
    };
}
