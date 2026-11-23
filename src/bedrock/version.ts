import type { VersionTuple } from "../pack/manifest.ts";
import { BahError } from "../util/errors.ts";

/** A Bedrock version such as `1.26.70` or `1.26.70.26`, as numeric parts. */
export type BedrockVersion = readonly number[];

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\.\d+)?$/;

export function parseBedrockVersion(text: string): BedrockVersion {
    if (!VERSION_PATTERN.test(text)) {
        throw new BahError(`Invalid Bedrock version "${text}", expected something like 1.26.70`);
    }
    return text.split(".").map(Number);
}

export function formatBedrockVersion(version: BedrockVersion): string {
    return version.join(".");
}

/** Compares two versions; missing trailing parts count as 0. */
export function compareBedrockVersions(a: BedrockVersion, b: BedrockVersion): number {
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) {
            return Math.sign(diff);
        }
    }
    return 0;
}

/** The `[major, minor, patch]` form used for `min_engine_version`. */
export function toEngineVersion(version: BedrockVersion): VersionTuple {
    const [major = 0, minor = 0, patch = 0] = version;
    return [major, minor, patch];
}
