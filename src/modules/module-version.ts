import { type BedrockVersion, compareBedrockVersions, formatBedrockVersion } from "../bedrock/version.ts";

/*
 * npm versions of @minecraft script modules come in a few shapes:
 *   2.11.0                            stable API
 *   2.12.0-beta.1.26.66-stable        beta API for game release 1.26.66
 *   2.13.0-beta.1.26.70-preview.26    beta API for game preview 1.26.70.26
 *   2.12.0-rc.1.26.70-preview.26      release candidate, internal tags, ...
 * Beta APIs only work on the game version they were published for.
 */

export type ModuleVersion =
    | { readonly kind: "stable"; readonly npm: string; readonly base: BedrockVersion }
    | {
          readonly kind: "beta";
          readonly npm: string;
          readonly base: BedrockVersion;
          readonly channel: "stable" | "preview";
          /** e.g. `[1, 26, 66]` (release) or `[1, 26, 70, 26]` (preview). */
          readonly game: BedrockVersion;
      }
    | { readonly kind: "other"; readonly npm: string };

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const BETA = /^(\d+\.\d+\.\d+)-beta\.(\d+\.\d+\.\d+)-(stable|preview)(?:\.(\d+))?$/;

export function parseModuleVersion(npm: string): ModuleVersion {
    if (STABLE.test(npm)) {
        return { kind: "stable", npm, base: splitVersion(npm) };
    }
    const beta = BETA.exec(npm);
    if (beta?.[1] && beta[2] && (beta[3] === "stable" || beta[3] === "preview")) {
        const channel = beta[3];
        const game = splitVersion(beta[2]);
        if (channel === "preview" && beta[4] !== undefined) {
            return { kind: "beta", npm, base: splitVersion(beta[1]), channel, game: [...game, Number(beta[4])] };
        }
        if (channel === "stable" && beta[4] === undefined) {
            return { kind: "beta", npm, base: splitVersion(beta[1]), channel, game };
        }
    }
    return { kind: "other", npm };
}

/** The version string used in manifest.json, e.g. `2.11.0` or `2.12.0-beta`. Null if not usable. */
export function manifestVersionOf(version: ModuleVersion): string | null {
    switch (version.kind) {
        case "stable":
            return formatBedrockVersion(version.base);
        case "beta":
            return `${formatBedrockVersion(version.base)}-beta`;
        case "other":
            return null;
    }
}

/** Game version a beta module targets, as text (`1.26.66` or `1.26.70.26`). */
export function describeGameVersion(version: ModuleVersion & { kind: "beta" }): string {
    return `${formatBedrockVersion(version.game)}${version.channel === "preview" ? " (preview)" : ""}`;
}

/** The newest stable version, or null if the module has none. */
export function newestStable(versions: readonly ModuleVersion[]): ModuleVersion | null {
    const stable = versions.filter((version) => version.kind === "stable");
    return stable.sort((a, b) => compareBedrockVersions(b.base, a.base))[0] ?? null;
}

/**
 * The best beta for a game version: an exact match on the game version
 * (release: major.minor.patch, preview: all four parts) if there is one,
 * otherwise the newest beta published for an older game version of the same
 * channel. Among equal game versions the highest API version wins.
 */
export function bestBetaFor(
    versions: readonly ModuleVersion[],
    game: BedrockVersion,
    channel: "stable" | "preview",
    base?: BedrockVersion,
): (ModuleVersion & { kind: "beta" }) | null {
    const target = channel === "stable" ? game.slice(0, 3) : game;
    const candidates = versions
        .filter((version) => version.kind === "beta")
        .filter((version) => version.channel === channel)
        .filter((version) => base === undefined || compareBedrockVersions(version.base, base) === 0)
        .filter((version) => compareBedrockVersions(version.game, target) <= 0);

    candidates.sort((a, b) => compareBedrockVersions(b.game, a.game) || compareBedrockVersions(b.base, a.base));
    return candidates[0] ?? null;
}

function splitVersion(text: string): BedrockVersion {
    return text.split(".").map(Number);
}
