import type { BedrockVersionResolver } from "../bedrock/version-resolver.ts";
import { isModuleDependency, type Manifest } from "../pack/manifest.ts";
import type { Pack } from "../pack/pack.ts";
import { type PackageJson, readPackageJson, writePackageJson } from "../project/package-json.ts";
import type { Project } from "../project/project.ts";
import type { BedrockVersionSpec } from "../server/server-config.ts";
import { BahError } from "../util/errors.ts";
import { isMinecraftModule, type ModuleKind, moduleKindOf } from "./module-catalog.ts";
import {
    type GameTarget,
    gameTargetFromSpec,
    gameTargetOf,
    type ResolvedModule,
    resolveModule,
} from "./module-resolver.ts";
import { describeGameVersion, manifestVersionOf, parseModuleVersion } from "./module-version.ts";
import type { NpmRegistry } from "./npm-registry.ts";

export interface ModuleServices {
    readonly registry: NpmRegistry;
    readonly versions: BedrockVersionResolver;
}

/* ------------------------------------------------------------------ add */

export interface AddModuleOptions {
    readonly name: string;
    readonly version?: string | undefined;
    readonly beta?: boolean | undefined;
    /** Game version for beta modules. Default: the one already used by the project's betas, else latest. */
    readonly gameVersion?: BedrockVersionSpec | undefined;
    /** Target behavior pack; required if the project has more than one. Ignored for library modules. */
    readonly pack?: string | undefined;
}

export interface AddModuleResult {
    readonly module: ResolvedModule;
    /** The pack whose manifest was changed; null for library modules. */
    readonly pack: Pack | null;
    readonly warnings: string[];
}

/**
 * Adds a module: engine modules go into the pack manifest and devDependencies,
 * library modules into dependencies. One npm version per module is used
 * project-wide, so adding a module that other packs already use reuses their
 * version unless a different one is requested (which is refused; use update).
 */
export async function addModule(
    project: Project,
    services: ModuleServices,
    options: AddModuleOptions,
): Promise<AddModuleResult> {
    const kind = moduleKindOf(options.name);
    const pack = kind === "engine" ? selectBehaviorPack(project, options.pack) : null;
    const warnings: string[] = [];
    if (kind === "library" && options.pack !== undefined) {
        warnings.push(`${options.name} is a library bundled into every pack that imports it; --pack is ignored.`);
    }

    const packageJson = await readPackageJson(project.paths.root);
    const installed = installedModules(packageJson).get(options.name);
    const wantsSpecific = options.version !== undefined || options.beta || options.gameVersion !== undefined;

    let module: ResolvedModule;
    if (installed !== undefined && !wantsSpecific) {
        module = installedAsResolved(options.name, kind, installed.version);
    } else {
        module = await resolveModule(services.registry, {
            name: options.name,
            version: options.version,
            beta: options.beta,
            gameTarget: () => gameTargetFor(packageJson, services, options.gameVersion),
        });
    }

    if (installed !== undefined && installed.version !== module.npmVersion && kind === "engine") {
        const users = (await packsUsingModule(project, options.name)).filter((user) => user.name !== pack?.name);
        if (users.length > 0) {
            const names = users.map((user) => `"${user.name}"`).join(", ");
            const command = ["bah module update", options.name, options.version].filter(Boolean).join(" ");
            throw new BahError(
                `${options.name}@${installed.version} is already used by ${names}. All packs share one version; change it for all of them with "${command}".`,
            );
        }
    }

    await writePackageJson(project.paths.root, withModule(packageJson, module));
    if (pack !== null && module.manifestVersion !== null) {
        const manifest = await pack.readManifest();
        await pack.writeManifest(withManifestModule(manifest, module.name, module.manifestVersion));
        if (pack.scripts === null) {
            warnings.push(`Pack "${pack.name}" has no script entry in bah.json, so the module won't be used yet.`);
        }
    }

    return { module, pack, warnings };
}

/* --------------------------------------------------------------- remove */

export interface RemoveModuleOptions {
    readonly name: string;
    readonly pack?: string | undefined;
}

export interface RemoveModuleResult {
    readonly pack: Pack | null;
    /** True if the module was also removed from package.json. */
    readonly removedFromPackageJson: boolean;
}

/**
 * Removes an engine module from a pack manifest (and from package.json once
 * no pack uses it), or a library module from package.json.
 */
export async function removeModule(project: Project, options: RemoveModuleOptions): Promise<RemoveModuleResult> {
    const kind = moduleKindOf(options.name);
    const packageJson = await readPackageJson(project.paths.root);
    const installed = installedModules(packageJson).has(options.name);

    if (kind === "library") {
        if (!installed) {
            throw new BahError(`${options.name} is not installed.`);
        }
        await writePackageJson(project.paths.root, withoutModule(packageJson, options.name));
        return { pack: null, removedFromPackageJson: true };
    }

    const pack = selectBehaviorPack(project, options.pack);
    const manifest = await pack.readManifest();
    if (!manifestModules(manifest).has(options.name)) {
        throw new BahError(`Pack "${pack.name}" does not use ${options.name}.`);
    }
    await pack.writeManifest(withoutManifestModule(manifest, options.name));

    const stillUsed = (await packsUsingModule(project, options.name)).length > 0;
    if (!stillUsed && installed) {
        await writePackageJson(project.paths.root, withoutModule(packageJson, options.name));
    }
    return { pack, removedFromPackageJson: !stillUsed && installed };
}

/* --------------------------------------------------------------- update */

export interface UpdateModulesOptions {
    /** Only update this module. Default: all installed @minecraft modules. */
    readonly name?: string | undefined;
    /** Exact or partial version; requires `name`. */
    readonly version?: string | undefined;
    /** Switch stable modules to beta. Modules already on beta stay on beta. */
    readonly beta?: boolean | undefined;
    /** Game version for beta modules. Default: latest release. */
    readonly gameVersion?: BedrockVersionSpec | undefined;
}

export interface ModuleUpdate {
    readonly name: string;
    readonly from: string;
    readonly to: string;
    readonly note: string | null;
}

/** Moves installed modules to newer versions in package.json and every manifest that uses them. */
export async function updateModules(
    project: Project,
    services: ModuleServices,
    options: UpdateModulesOptions,
): Promise<ModuleUpdate[]> {
    if (options.version !== undefined && options.name === undefined) {
        throw new BahError("A version can only be given together with a module name.");
    }
    let packageJson = await readPackageJson(project.paths.root);
    const installed = installedModules(packageJson);
    const names = options.name === undefined ? [...installed.keys()] : [options.name];
    if (options.name !== undefined && !installed.has(options.name)) {
        throw new BahError(`${options.name} is not installed; add it with "bah module add".`);
    }

    let target: Promise<GameTarget> | null = null;
    const gameTarget = () => {
        target ??= gameTargetFromSpec(options.gameVersion ?? "latest", services.versions);
        return target;
    };

    const updates: ModuleUpdate[] = [];
    for (const name of names) {
        const current = installed.get(name);
        if (current === undefined) {
            continue;
        }
        const module = await resolveModule(services.registry, {
            name,
            version: options.version,
            beta: options.beta || parseModuleVersion(current.version).kind === "beta",
            gameTarget,
        });
        if (module.npmVersion === current.version) {
            continue;
        }
        packageJson = withModule(packageJson, module);
        if (module.manifestVersion !== null) {
            for (const pack of await packsUsingModule(project, name)) {
                const manifest = await pack.readManifest();
                await pack.writeManifest(withManifestModule(manifest, name, module.manifestVersion));
            }
        }
        updates.push({ name, from: current.version, to: module.npmVersion, note: module.note });
    }

    if (updates.length > 0) {
        await writePackageJson(project.paths.root, packageJson);
    }
    return updates;
}

/* ----------------------------------------------------------------- list */

export interface ModuleListEntry {
    readonly name: string;
    readonly kind: ModuleKind;
    /** Version in package.json, or null if missing there. */
    readonly npmVersion: string | null;
    /** Manifest version per behavior pack that lists the module. */
    readonly packs: ReadonlyMap<string, string>;
    /** Problems found, e.g. manifest and package.json disagreeing. */
    readonly problems: readonly string[];
}

export async function listModules(project: Project): Promise<ModuleListEntry[]> {
    const packageJson = await readPackageJson(project.paths.root);
    const installed = installedModules(packageJson);

    const usage = new Map<string, Map<string, string>>();
    for (const pack of project.behaviorPacks) {
        for (const [name, version] of manifestModules(await pack.readManifest())) {
            const packs = usage.get(name) ?? new Map<string, string>();
            packs.set(pack.name, version);
            usage.set(name, packs);
        }
    }

    // Beta APIs only load on the game version they were made for, so all betas must agree.
    const betaTargets = new Map<string, string>();
    for (const [name, module] of installed) {
        const parsed = parseModuleVersion(module.version);
        if (parsed.kind === "beta") {
            betaTargets.set(name, describeGameVersion(parsed));
        }
    }
    const mixedBetas = new Set(betaTargets.values()).size > 1;

    const names = [...new Set([...installed.keys(), ...usage.keys()])].sort();
    return names.map((name) => {
        const kind = isKnownKind(name);
        const npmVersion = installed.get(name)?.version ?? null;
        const packs = usage.get(name) ?? new Map<string, string>();
        const problems: string[] = [];
        if (npmVersion === null) {
            problems.push("missing from package.json");
        } else if (kind === "engine") {
            const expected = installedAsResolved(name, kind, npmVersion).manifestVersion;
            for (const [pack, version] of packs) {
                if (expected !== null && version !== expected) {
                    problems.push(`pack "${pack}" uses ${version}, package.json has ${npmVersion}`);
                }
            }
            if (packs.size === 0) {
                problems.push("not used by any pack");
            }
        }
        const target = betaTargets.get(name);
        if (mixedBetas && target !== undefined) {
            problems.push(
                `beta for game ${target}, but other beta modules target a different game version (fix with "bah module update")`,
            );
        }
        return { name, kind, npmVersion, packs, problems };
    });
}

/* -------------------------------------------------------------- helpers */

/** The behavior pack to change: the named one, or the only one. */
export function selectBehaviorPack(project: Project, name: string | undefined): Pack {
    if (name !== undefined) {
        const pack = project.getPack(name);
        if (pack.type !== "behavior") {
            throw new BahError(`Pack "${name}" is a resource pack; script modules belong in behavior packs.`);
        }
        return pack;
    }
    const packs = project.behaviorPacks;
    const [only] = packs;
    if (only === undefined) {
        throw new BahError('This project has no behavior pack. Add one with "bah pack add behavior <name>".');
    }
    if (packs.length > 1) {
        const names = packs.map((pack) => pack.name).join(", ");
        throw new BahError(`This project has several behavior packs (${names}); choose one with --pack <name>.`);
    }
    return only;
}

interface InstalledModule {
    readonly version: string;
    readonly field: "dependencies" | "devDependencies";
}

function installedModules(packageJson: PackageJson): Map<string, InstalledModule> {
    const result = new Map<string, InstalledModule>();
    for (const field of ["dependencies", "devDependencies"] as const) {
        for (const [name, version] of Object.entries(packageJson[field] ?? {})) {
            if (isMinecraftModule(name) && name !== "@minecraft/common") {
                result.set(name, { version, field });
            }
        }
    }
    return result;
}

function installedAsResolved(name: string, kind: ModuleKind, npmVersion: string): ResolvedModule {
    if (kind === "library") {
        return { name, kind, npmVersion, manifestVersion: null, note: null };
    }
    const manifestVersion = manifestVersionOf(parseModuleVersion(npmVersion));
    if (manifestVersion === null) {
        throw new BahError(
            `package.json has ${name}@${npmVersion}, which is not an exact stable or beta version. Fix it with "bah module update ${name}".`,
        );
    }
    return { name, kind, npmVersion, manifestVersion, note: null };
}

async function gameTargetFor(
    packageJson: PackageJson,
    services: ModuleServices,
    spec: BedrockVersionSpec | undefined,
): Promise<GameTarget> {
    if (spec !== undefined) {
        return gameTargetFromSpec(spec, services.versions);
    }
    // Keep all beta modules of a project on the same game version.
    for (const module of installedModules(packageJson).values()) {
        const target = gameTargetOf(module.version);
        if (target !== null) {
            return target;
        }
    }
    return gameTargetFromSpec("latest", services.versions);
}

async function packsUsingModule(project: Project, name: string): Promise<Pack[]> {
    const users: Pack[] = [];
    for (const pack of project.behaviorPacks) {
        if (manifestModules(await pack.readManifest()).has(name)) {
            users.push(pack);
        }
    }
    return users;
}

function manifestModules(manifest: Manifest): Map<string, string> {
    return new Map(
        (manifest.dependencies ?? []).filter(isModuleDependency).map((dep) => [dep.module_name, dep.version]),
    );
}

function withManifestModule(manifest: Manifest, name: string, version: string): Manifest {
    const dependencies = manifest.dependencies ?? [];
    const exists = dependencies.some((dep) => isModuleDependency(dep) && dep.module_name === name);
    return {
        ...manifest,
        dependencies: exists
            ? dependencies.map((dep) =>
                  isModuleDependency(dep) && dep.module_name === name ? { ...dep, version } : dep,
              )
            : [...dependencies, { module_name: name, version }],
    };
}

function withoutManifestModule(manifest: Manifest, name: string): Manifest {
    const { dependencies, ...rest } = manifest;
    const remaining = (dependencies ?? []).filter((dep) => !(isModuleDependency(dep) && dep.module_name === name));
    return remaining.length > 0 ? { ...rest, dependencies: remaining } : rest;
}

/** Puts the module in the right dependency field with an exact version, keeping keys sorted. */
function withModule(packageJson: PackageJson, module: ResolvedModule): PackageJson {
    const field = module.kind === "engine" ? "devDependencies" : "dependencies";
    const cleaned = withoutModule(packageJson, module.name);
    return { ...cleaned, [field]: sortKeys({ ...cleaned[field], [module.name]: module.npmVersion }) };
}

function withoutModule(packageJson: PackageJson, name: string): PackageJson {
    const result: PackageJson = { ...packageJson };
    for (const field of ["dependencies", "devDependencies"] as const) {
        const deps = result[field];
        if (deps !== undefined && name in deps) {
            const { [name]: _removed, ...rest } = deps;
            if (Object.keys(rest).length > 0) {
                result[field] = rest;
            } else {
                delete result[field];
            }
        }
    }
    return result;
}

function sortKeys(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function isKnownKind(name: string): ModuleKind {
    try {
        return moduleKindOf(name);
    } catch {
        return "engine";
    }
}
