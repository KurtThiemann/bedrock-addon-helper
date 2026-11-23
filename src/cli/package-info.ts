import { readFile } from "node:fs/promises";

export interface PackageInfo {
    name: string;
    version: string;
}

/**
 * Reads this tool's own package.json. The relative path is the same from
 * `src/cli/` (dev) and `dist/cli/` (built).
 */
export async function readPackageInfo(): Promise<PackageInfo> {
    const raw: unknown = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    if (typeof raw !== "object" || raw === null) {
        throw new Error("Invalid package.json");
    }
    const { name, version } = raw as Record<string, unknown>;
    if (typeof name !== "string" || typeof version !== "string") {
        throw new Error("package.json is missing name or version");
    }
    return { name, version };
}
