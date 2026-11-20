import { isDeepStrictEqual } from "node:util";
import type { Project } from "../project/project.ts";
import { BahError } from "../util/errors.ts";
import { isPackDependency, type ManifestDependency, type PackDependency } from "./manifest.ts";
import type { Pack } from "./pack.ts";

/**
 * Makes the pack dependencies in `pack`'s manifest match its `dependencies`
 * in bah.json: adds or updates entries for the listed project packs (UUID and
 * current version) and removes entries for project packs no longer listed.
 * Module dependencies and dependencies on packs outside the project are kept.
 *
 * Returns true if the manifest was changed.
 */
export async function syncPackDependencies(project: Project, pack: Pack): Promise<boolean> {
    const projectPackHeaders = new Map<string, { name: string; dependency: PackDependency }>();
    for (const other of project.packs) {
        if (other.name === pack.name || !(await other.hasManifest())) {
            continue;
        }
        const { header } = await other.readManifest();
        projectPackHeaders.set(header.uuid, {
            name: other.name,
            dependency: { uuid: header.uuid, version: header.version },
        });
    }

    const wanted = new Map<string, PackDependency>();
    for (const name of pack.dependencies) {
        const entry = [...projectPackHeaders.values()].find((header) => header.name === name);
        if (entry === undefined) {
            throw new BahError(`Pack "${pack.name}" depends on "${name}", which has no manifest.json.`);
        }
        wanted.set(entry.dependency.uuid, entry.dependency);
    }

    const manifest = await pack.readManifest();
    const current = manifest.dependencies ?? [];
    const next: ManifestDependency[] = [];
    for (const dependency of current) {
        if (!isPackDependency(dependency) || !projectPackHeaders.has(dependency.uuid)) {
            next.push(dependency);
            continue;
        }
        const wantedDependency = wanted.get(dependency.uuid);
        if (wantedDependency !== undefined) {
            next.push({ ...dependency, version: wantedDependency.version });
            wanted.delete(dependency.uuid);
        }
    }
    next.push(...wanted.values());

    if (isDeepStrictEqual(current, next)) {
        return false;
    }
    if (next.length === 0) {
        delete manifest.dependencies;
    } else {
        manifest.dependencies = next;
    }
    await pack.writeManifest(manifest);
    return true;
}
