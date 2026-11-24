import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import type { Manifest, PackVersion } from "../pack/manifest.ts";
import { isModuleDependency, manifestSchema } from "../pack/manifest.ts";
import { MANIFEST_FILE, type Pack } from "../pack/pack.ts";
import { syncPackDependencies } from "../pack/pack-dependencies.ts";
import type { Project } from "../project/project.ts";
import { GAMETEST_MODULE, gametestWrapperPlugin, testEntrySource } from "../testing/gametest-bundle.ts";
import {
    createPlatformStructure,
    DEFAULT_TEST_STRUCTURE,
    DEFAULT_TEST_STRUCTURE_SIZE,
    structurePath,
} from "../testing/structures.ts";
import { TEST_STRUCTURES_DIR, TESTS_DIR } from "../testing/test-files.ts";
import { BahError } from "../util/errors.ts";
import { pathExists } from "../util/fs.ts";
import { writeJsonFile } from "../util/json-file.ts";
import { bundleScripts, type GeneratedEntry } from "./bundle-scripts.ts";
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

export interface TestPackBuildResult {
    readonly pack: Pack;
    readonly uuid: string;
    readonly version: PackVersion;
    readonly outputDirectory: string;
    /** Bundled script with an inline source map, if the pack has tests. */
    readonly testScript: string | null;
    readonly warnings: readonly string[];
}

export interface TestPackOptions {
    /** Test files relative to the pack; empty for packs without tests. */
    readonly testFiles: readonly string[];
    /** Manifest version of @minecraft/server-gametest, e.g. `1.0.0-beta`. */
    readonly gametestVersion: string;
}

/** OS and editor clutter that never belongs in a pack. */
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export function packOutputDirectory(project: Project, pack: Pack): string {
    return join(project.paths.buildDir, "packs", pack.name);
}

export function testPackOutputDirectory(project: Project, pack: Pack): string {
    return join(project.paths.buildDir, "test", "packs", pack.name);
}

export function mcpackPath(project: Project, pack: Pack): string {
    return join(project.paths.artifactsDir, `${project.name}-${pack.name}.mcpack`);
}

/**
 * Builds one pack: syncs its pack dependencies, copies its files (without
 * script sources and tests), bundles its scripts, writes the output
 * manifest and zips the result into an .mcpack.
 */
export async function buildPack(project: Project, pack: Pack, options: { debug: boolean }): Promise<PackBuildResult> {
    const manifest = await prepareManifest(project, pack);
    const outputDirectory = packOutputDirectory(project, pack);
    const script = pack.scripts
        ? {
              entry: join(pack.directory, pack.scripts.entry),
              outputEntry: builtEntry(pack.scripts.entry),
              debug: options.debug,
          }
        : null;
    const warnings = await writePackOutput(project, pack, outputDirectory, manifest, script);

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
 * Builds a pack for `bah test` into `build/test/`. Scripts are never
 * minified. If the pack has tests, they are bundled together with the
 * pack's entry through the GameTest wrapper, the manifest gets the
 * @minecraft/server-gametest dependency, and the test structures (plus
 * bah's default structure) are added.
 */
export async function buildTestPack(
    project: Project,
    pack: Pack,
    options: TestPackOptions,
): Promise<TestPackBuildResult> {
    let manifest = await prepareManifest(project, pack);
    const outputDirectory = testPackOutputDirectory(project, pack);
    const hasTests = options.testFiles.length > 0;

    let script: ScriptBuild | null = null;
    if (pack.scripts && !hasTests) {
        script = {
            entry: join(pack.directory, pack.scripts.entry),
            outputEntry: builtEntry(pack.scripts.entry),
            debug: true,
        };
    } else if (hasTests) {
        if (!pack.scripts) {
            throw new BahError(
                `Pack "${pack.name}" has tests but no script entry. Tests run together with the pack's scripts; add an entry under "scripts" in bah.json.`,
            );
        }
        const entry: GeneratedEntry = {
            contents: testEntrySource(pack.scripts.entry, options.testFiles),
            resolveDir: pack.directory,
            sourcefile: `${pack.name}-tests.ts`,
        };
        // A name of its own, so stack traces can be traced back to this pack.
        const outputEntry = posix.join(posix.dirname(builtEntry(pack.scripts.entry)), `${pack.name}-tests.js`);
        script = { entry, outputEntry, debug: true, plugins: [gametestWrapperPlugin] };
        manifest = withModuleDependency(manifest, GAMETEST_MODULE, options.gametestVersion);
    }

    const warnings = await writePackOutput(project, pack, outputDirectory, manifest, script);
    if (hasTests) {
        await addTestStructures(pack, outputDirectory);
    }

    return {
        pack,
        uuid: manifest.header.uuid,
        version: manifest.header.version,
        outputDirectory,
        testScript: hasTests && script ? join(outputDirectory, script.outputEntry) : null,
        warnings,
    };
}

interface ScriptBuild {
    readonly entry: string | GeneratedEntry;
    /** Path of the bundle inside the pack. */
    readonly outputEntry: string;
    readonly debug: boolean;
    readonly plugins?: Parameters<typeof bundleScripts>[0]["plugins"];
}

async function prepareManifest(project: Project, pack: Pack): Promise<Manifest> {
    if (!(await pack.hasManifest())) {
        throw new BahError(`Pack "${pack.name}" has no ${MANIFEST_FILE} (${pack.manifestPath}).`);
    }
    await syncPackDependencies(project, pack);
    return pack.readManifest();
}

/**
 * Replaces `outputDirectory` with the pack's files (without script sources
 * and tests), the bundled script and the output manifest. Returns warnings.
 */
async function writePackOutput(
    project: Project,
    pack: Pack,
    outputDirectory: string,
    manifest: Manifest,
    script: ScriptBuild | null,
): Promise<string[]> {
    await rm(outputDirectory, { recursive: true, force: true });

    const excluded = [TESTS_DIR];
    if (pack.scripts) {
        excluded.push(scriptSourcePath(pack.scripts.entry));
    }
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
            return !excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
        },
    });

    const warnings: string[] = [];
    let outputManifest = manifest;
    if (script) {
        outputManifest = withScriptEntry(pack, manifest, script.outputEntry);
        const result = await bundleScripts({
            entry: script.entry,
            outfile: join(outputDirectory, script.outputEntry),
            workingDirectory: project.paths.root,
            debug: script.debug,
            plugins: script.plugins,
        });
        warnings.push(...result.warnings);
    }
    await writeJsonFile(join(outputDirectory, MANIFEST_FILE), manifestSchema, outputManifest);
    return warnings;
}

/** Copies `tests/structures` into the output and adds bah's default structure unless the pack has its own. */
async function addTestStructures(pack: Pack, outputDirectory: string): Promise<void> {
    const testStructures = join(pack.directory, TEST_STRUCTURES_DIR);
    if (await pathExists(testStructures)) {
        await cp(testStructures, join(outputDirectory, "structures"), { recursive: true });
    }
    const defaultStructure = join(outputDirectory, structurePath(DEFAULT_TEST_STRUCTURE));
    if (!(await pathExists(defaultStructure))) {
        await mkdir(dirname(defaultStructure), { recursive: true });
        await writeFile(defaultStructure, createPlatformStructure(DEFAULT_TEST_STRUCTURE_SIZE));
    }
}

/** `scripts/main.ts` -> `scripts/main.js` */
function builtEntry(entry: string): string {
    return entry.replace(/\.ts$/, ".js");
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

/** Adds a script module dependency unless the manifest already has one for it. */
function withModuleDependency(manifest: Manifest, name: string, version: string): Manifest {
    const dependencies = manifest.dependencies ?? [];
    if (dependencies.some((dependency) => isModuleDependency(dependency) && dependency.module_name === name)) {
        return manifest;
    }
    return { ...manifest, dependencies: [...dependencies, { module_name: name, version }] };
}
