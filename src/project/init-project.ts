import { basename, join, posix } from "node:path";
import { BahError } from "../util/errors.ts";
import { pathExists } from "../util/fs.ts";
import { ensureGitignoreEntries } from "../util/gitignore.ts";
import { readJsonFile } from "../util/json-file.ts";
import { identifierSchema } from "../util/schemas.ts";
import { packageJsonPath, packageJsonSchema, writePackageJson } from "./package-json.ts";
import { Project } from "./project.ts";
import { BUILD_DIR, PROJECT_CONFIG_FILE, STATE_DIR } from "./project-config.ts";

export const GITIGNORE_ENTRIES = [
    "node_modules/",
    `${BUILD_DIR}/`,
    `${posix.join(STATE_DIR, "servers")}/`,
    posix.join(STATE_DIR, "servers.local.json"),
] as const;

export interface InitProjectOptions {
    /** Directory to create the project in. */
    root: string;
    /** Project name; derived from package.json or the directory name if omitted. */
    name?: string;
}

export interface InitProjectResult {
    project: Project;
    /** Paths (relative to the root) of files that were created or changed. */
    created: string[];
    updated: string[];
}

/**
 * Creates `bah.json` (with no packs), a package.json if there is none, and
 * the .gitignore entries the tool needs.
 */
export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
    const { root } = options;
    if (await pathExists(join(root, PROJECT_CONFIG_FILE))) {
        throw new BahError(`${PROJECT_CONFIG_FILE} already exists in ${root}.`);
    }

    const created: string[] = [];
    const updated: string[] = [];

    const existingPackageJson = (await pathExists(packageJsonPath(root)))
        ? await readJsonFile(packageJsonPath(root), packageJsonSchema)
        : null;

    const name = options.name ?? deriveProjectName(existingPackageJson?.name ?? basename(root));
    const nameResult = identifierSchema.safeParse(name);
    if (!nameResult.success) {
        throw new BahError(`Invalid project name "${name}": ${nameResult.error.issues[0]?.message}`);
    }

    const project = new Project(root, { name, packs: [] });

    if (existingPackageJson === null) {
        await writePackageJson(root, { name, version: "1.0.0", private: true, type: "module" });
        created.push("package.json");
    }

    await project.save();
    created.push(PROJECT_CONFIG_FILE);

    const gitignoreExisted = await pathExists(join(root, ".gitignore"));
    const added = await ensureGitignoreEntries(join(root, ".gitignore"), GITIGNORE_ENTRIES);
    if (!gitignoreExisted) {
        created.push(".gitignore");
    } else if (added.length > 0) {
        updated.push(".gitignore");
    }

    return { project, created, updated };
}

/**
 * Turns an npm package name or directory name into a valid project name:
 * drops the npm scope and replaces unsupported characters with `-`.
 */
export function deriveProjectName(raw: string): string {
    const withoutScope = raw.replace(/^@[^/]+\//, "");
    const cleaned = withoutScope
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^[-_]+/, "")
        .slice(0, 64);
    return cleaned === "" ? "addon" : cleaned;
}
