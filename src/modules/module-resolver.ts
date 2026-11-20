import { type BedrockVersion, formatBedrockVersion, parseBedrockVersion } from "../bedrock/version.ts";
import type { BedrockVersionResolver } from "../bedrock/version-resolver.ts";
import type { BedrockVersionSpec } from "../server/server-config.ts";
import { BahError } from "../util/errors.ts";
import { type ModuleKind, moduleKindOf } from "./module-catalog.ts";
import {
    bestBetaFor,
    describeGameVersion,
    type ModuleVersion,
    manifestVersionOf,
    newestStable,
    parseModuleVersion,
} from "./module-version.ts";
import type { NpmRegistry } from "./npm-registry.ts";

/** The game version beta modules are chosen for. */
export interface GameTarget {
    readonly version: BedrockVersion;
    readonly channel: "stable" | "preview";
}

export interface ModuleRequest {
    readonly name: string;
    /**
     * Exact npm version, a stable prefix (`2`, `2.11`, `2.11.0`) or a beta
     * API version (`2.12.0-beta`). Omit for the newest stable version.
     */
    readonly version?: string | undefined;
    /** Prefer the beta API. Implied for modules without stable releases. */
    readonly beta?: boolean | undefined;
    /** Game version for beta modules; only called when a beta is needed. */
    readonly gameTarget: () => Promise<GameTarget>;
}

export interface ResolvedModule {
    readonly name: string;
    readonly kind: ModuleKind;
    readonly npmVersion: string;
    /** Version for manifest.json; null for library modules. */
    readonly manifestVersion: string | null;
    /** Human-readable explanation of the choice, if worth mentioning. */
    readonly note: string | null;
}

export async function resolveModule(registry: NpmRegistry, request: ModuleRequest): Promise<ResolvedModule> {
    const kind = moduleKindOf(request.name);
    const { versions, distTags } = await registry.getVersions(request.name);

    if (kind === "library") {
        const npmVersion = request.version ?? distTags.latest;
        if (npmVersion === undefined) {
            throw new BahError(`${request.name} has no "latest" version on npm.`);
        }
        const chosen = versions.includes(npmVersion) ? npmVersion : pickStablePrefix(versions, npmVersion)?.npm;
        if (chosen === undefined) {
            throw new BahError(`${request.name} has no version matching "${npmVersion}".`);
        }
        return { name: request.name, kind, npmVersion: chosen, manifestVersion: null, note: null };
    }

    const parsed = versions.map(parseModuleVersion);
    const chosen = await pickEngineVersion(request, parsed, distTags);
    const manifestVersion = manifestVersionOf(chosen.version);
    if (manifestVersion === null) {
        throw new BahError(`${request.name}@${chosen.version.npm} is neither a stable nor a beta release.`);
    }
    return { name: request.name, kind, npmVersion: chosen.version.npm, manifestVersion, note: chosen.note };
}

/** Turns a `--game-version` value into a target (explicit versions count as releases). */
export async function gameTargetFromSpec(
    spec: BedrockVersionSpec,
    resolver: BedrockVersionResolver,
): Promise<GameTarget> {
    if (spec === "preview") {
        return { version: await resolver.latest("preview"), channel: "preview" };
    }
    if (spec === "latest") {
        return { version: await resolver.latest("latest"), channel: "stable" };
    }
    return { version: parseBedrockVersion(spec), channel: "stable" };
}

/** The game target of an installed beta module, e.g. from package.json. */
export function gameTargetOf(npmVersion: string): GameTarget | null {
    const parsed = parseModuleVersion(npmVersion);
    return parsed.kind === "beta" ? { version: parsed.game, channel: parsed.channel } : null;
}

/**
 * The current stable release of an engine module. Mojang tags it as
 * `latest` on npm; for beta-only modules `latest` points to a beta (or old
 * leftovers like server-gametest 0.1.0 exist), so then there is none.
 */
function currentStable(
    versions: readonly ModuleVersion[],
    distTags: Readonly<Record<string, string>>,
): ModuleVersion | null {
    const latest = versions.find((version) => version.npm === distTags.latest);
    return latest?.kind === "stable" ? latest : null;
}

async function pickEngineVersion(
    request: ModuleRequest,
    versions: readonly ModuleVersion[],
    distTags: Readonly<Record<string, string>>,
): Promise<{ version: ModuleVersion; note: string | null }> {
    const { name } = request;
    const spec = request.version;

    if (spec !== undefined) {
        const exact = versions.find((version) => version.npm === spec);
        if (exact) {
            return { version: exact, note: null };
        }
        const betaBase = /^(\d+\.\d+\.\d+)-beta$/.exec(spec)?.[1];
        if (betaBase !== undefined) {
            return pickBeta(request, versions, parseBedrockVersion(betaBase));
        }
        const stable = pickStablePrefix(
            versions.map((version) => version.npm),
            spec,
        );
        if (stable) {
            return { version: stable, note: null };
        }
        throw new BahError(
            `${name} has no version matching "${spec}". Use a stable version like 2.11.0, a beta like 2.12.0-beta, or an exact npm version.`,
        );
    }

    const stable = currentStable(versions, distTags);
    if (request.beta || stable === null) {
        const result = await pickBeta(request, versions);
        if (stable === null && !request.beta) {
            return { ...result, note: `${name} has no stable release; using the beta. ${result.note ?? ""}`.trim() };
        }
        return result;
    }
    return { version: stable, note: null };
}

async function pickBeta(
    request: ModuleRequest,
    versions: readonly ModuleVersion[],
    base?: BedrockVersion,
): Promise<{ version: ModuleVersion; note: string | null }> {
    const target = await request.gameTarget();
    const beta = bestBetaFor(versions, target.version, target.channel, base);
    const wanted = `${base ? `${formatBedrockVersion(base)}-beta` : "beta"} for game ${formatBedrockVersion(target.version)}${target.channel === "preview" ? " (preview)" : ""}`;
    if (beta === null) {
        throw new BahError(`${request.name} has no ${wanted}.`);
    }
    return { version: beta, note: `Beta API for game version ${describeGameVersion(beta)}.` };
}

/** Newest stable version starting with the given prefix (`2`, `2.11`, `2.11.0`). */
function pickStablePrefix(npmVersions: readonly string[], prefix: string): (ModuleVersion & { kind: "stable" }) | null {
    if (!/^\d+(?:\.\d+){0,2}$/.test(prefix)) {
        return null;
    }
    const matches = npmVersions
        .map(parseModuleVersion)
        .filter((version) => version.kind === "stable")
        .filter((version) => version.npm === prefix || version.npm.startsWith(`${prefix}.`));
    const newest = newestStable(matches);
    return newest?.kind === "stable" ? newest : null;
}
