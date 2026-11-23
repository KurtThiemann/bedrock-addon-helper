import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import type { Project } from "../project/project.ts";
import type { PackConfig, PackType } from "../project/project-config.ts";
import { BahError } from "../util/errors.ts";
import { pathExists } from "../util/fs.ts";
import type { VersionTuple } from "./manifest.ts";
import { createManifest } from "./manifest-template.ts";
import type { Pack } from "./pack.ts";
import { syncPackDependencies } from "./pack-dependencies.ts";

export type ScriptLanguage = "js" | "ts";

export const PACKS_DIR = "packs";
export const TSCONFIG_FILE = "tsconfig.json";
export const ENV_DECLARATIONS_FILE = "bedrock-env.d.ts";

export interface AddPackOptions {
    name: string;
    type: PackType;
    /** Pack directory relative to the project root. Default: `packs/<name>`. */
    path?: string;
    description?: string;
    /**
     * `min_engine_version` for a new manifest. Called only when a manifest is
     * created, so registering an existing pack needs no network access.
     */
    minEngineVersion: () => Promise<VersionTuple>;
    /** Create a script entry point (behavior packs only). */
    scripts?: ScriptLanguage;
    dependencies?: string[];
    bundle?: boolean;
}

export interface AddPackResult {
    pack: Pack;
    /** True if an existing manifest.json was found and registered as-is. */
    imported: boolean;
    /** Created files, relative to the project root. */
    created: string[];
}

/**
 * Adds a pack to the project. If the pack directory already contains a
 * manifest.json, the pack is registered without changing its files;
 * otherwise a new manifest (and script entry, if requested) is created.
 * Saves bah.json.
 */
export async function addPack(project: Project, options: AddPackOptions): Promise<AddPackResult> {
    if (options.scripts !== undefined && options.type !== "behavior") {
        throw new BahError("Only behavior packs can have scripts.");
    }

    const path = options.path ?? posix.join(PACKS_DIR, options.name);
    const directory = join(project.paths.root, path);
    const manifestExists = await pathExists(join(directory, "manifest.json"));

    if (manifestExists && options.scripts !== undefined) {
        throw new BahError(
            `${path} already contains a manifest.json; its script entry is taken from the manifest, so --scripts can't be used.`,
        );
    }
    if (!manifestExists && (await isNonEmptyDirectory(directory))) {
        throw new BahError(`${path} exists, is not empty and has no manifest.json.`);
    }

    const config: PackConfig = { name: options.name, type: options.type, path };
    if (options.bundle === false) {
        config.bundle = false;
    }
    if (options.dependencies !== undefined && options.dependencies.length > 0) {
        config.dependencies = options.dependencies;
    }
    const scriptEntry = options.scripts === undefined ? undefined : `scripts/main.${options.scripts}`;
    if (scriptEntry !== undefined) {
        config.scripts = { entry: scriptEntry };
    }

    for (const dependency of options.dependencies ?? []) {
        project.getPack(dependency);
    }
    // Validates the config (names, paths, dependencies) before touching any files.
    let pack = project.addPack(config);
    const created: string[] = [];

    if (manifestExists) {
        const manifest = await pack.readManifest();
        const entry = manifest.modules.find((module) => module.type === "script")?.entry;
        if (entry !== undefined && pack.type === "behavior") {
            pack = project.updatePack(pack.name, (current) => ({ ...current, scripts: { entry } }));
        }
    } else {
        await pack.writeManifest(
            createManifest({
                type: options.type,
                name: manifestName(project.name, options.name),
                description: options.description ?? "",
                minEngineVersion: await options.minEngineVersion(),
                // The manifest points at the built file, which is always .js.
                ...(scriptEntry !== undefined && { scriptEntry: scriptEntry.replace(/\.ts$/, ".js") }),
            }),
        );
        created.push(relative(project.paths.root, pack.manifestPath));

        if (scriptEntry !== undefined) {
            const entryPath = join(pack.directory, scriptEntry);
            await mkdir(dirname(entryPath), { recursive: true });
            await writeFile(entryPath, scriptTemplate(pack.name), "utf8");
            created.push(relative(project.paths.root, entryPath));
        }
    }

    if (options.scripts === "ts") {
        created.push(...(await ensureTypeScriptConfig(project)));
    }

    await syncPackDependencies(project, pack);
    await project.save();
    return { pack, imported: manifestExists, created };
}

export interface RemovePackOptions {
    /** Also delete the pack directory. */
    deleteFiles?: boolean;
}

/** Removes a pack from bah.json and optionally deletes its files. Saves bah.json. */
export async function removePack(project: Project, name: string, options: RemovePackOptions = {}): Promise<void> {
    const pack = project.getPack(name);
    project.removePack(name);
    await project.save();
    if (options.deleteFiles) {
        await rm(pack.directory, { recursive: true, force: true });
    }
}

/** Makes `name` depend on `dependency`, in bah.json and the manifest. */
export async function linkPacks(project: Project, name: string, dependency: string): Promise<boolean> {
    const pack = project.getPack(name);
    project.getPack(dependency);
    if (pack.dependencies.includes(dependency)) {
        return false;
    }
    const updated = project.updatePack(name, (config) => ({
        ...config,
        dependencies: [...(config.dependencies ?? []), dependency],
    }));
    await syncPackDependencies(project, updated);
    await project.save();
    return true;
}

/** Removes the dependency of `name` on `dependency`, in bah.json and the manifest. */
export async function unlinkPacks(project: Project, name: string, dependency: string): Promise<boolean> {
    const pack = project.getPack(name);
    if (!pack.dependencies.includes(dependency)) {
        return false;
    }
    const updated = project.updatePack(name, (config) => {
        const { dependencies, ...rest } = config;
        const remaining = (dependencies ?? []).filter((item) => item !== dependency);
        return remaining.length > 0 ? { ...rest, dependencies: remaining } : rest;
    });
    await syncPackDependencies(project, updated);
    await project.save();
    return true;
}

/**
 * Files for type-checking TypeScript pack scripts with `tsc`: tsconfig.json
 * and a declaration of the globals the game provides. Each is only written
 * if missing. Returns the created file names.
 */
async function ensureTypeScriptConfig(project: Project): Promise<string[]> {
    const created: string[] = [];
    const tsconfig = {
        compilerOptions: {
            target: "es2023",
            lib: ["es2023"],
            module: "es2022",
            moduleResolution: "bundler",
            // No Node or DOM types; the game's globals come from bedrock-env.d.ts.
            types: [],
            strict: true,
            noEmit: true,
            isolatedModules: true,
            verbatimModuleSyntax: true,
            // Scripts import each other with .ts extensions; esbuild resolves them.
            allowImportingTsExtensions: true,
            skipLibCheck: true,
        },
        exclude: ["node_modules", "build", ".bah"],
    };
    if (await writeIfMissing(join(project.paths.root, TSCONFIG_FILE), `${JSON.stringify(tsconfig, null, 2)}\n`)) {
        created.push(TSCONFIG_FILE);
    }
    if (await writeIfMissing(join(project.paths.root, ENV_DECLARATIONS_FILE), ENV_DECLARATIONS)) {
        created.push(ENV_DECLARATIONS_FILE);
    }
    return created;
}

/** Globals of the game's script engine that no type package declares. */
const ENV_DECLARATIONS = `/** Console of the Minecraft script engine (output goes to the content log). */
declare const console: {
    log(...data: unknown[]): void;
    info(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
};
`;

async function writeIfMissing(path: string, content: string): Promise<boolean> {
    if (await pathExists(path)) {
        return false;
    }
    await writeFile(path, content, "utf8");
    return true;
}

/**
 * Name for a new pack's manifest header, shown in the game and in server
 * logs: `<project>-<pack>` (e.g. "bans-bp"), unless the pack name already
 * starts with the project name.
 */
export function manifestName(projectName: string, packName: string): string {
    const prefixed = packName === projectName || packName.startsWith(`${projectName}-`);
    return prefixed ? packName : `${projectName}-${packName}`;
}

function scriptTemplate(packName: string): string {
    return [
        `// Script entry point of the "${packName}" behavior pack.`,
        `// Add script modules with: bah module add @minecraft/server --pack ${packName}`,
        "",
    ].join("\n");
}

async function isNonEmptyDirectory(path: string): Promise<boolean> {
    try {
        return (await readdir(path)).length > 0;
    } catch {
        return false;
    }
}
