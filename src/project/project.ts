import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { Pack } from "../pack/pack.ts";
import { BahError } from "../util/errors.ts";
import { pathExists } from "../util/fs.ts";
import { readJsonFile, writeJsonFile } from "../util/json-file.ts";
import {
    BUILD_DIR,
    type PackConfig,
    PROJECT_CONFIG_FILE,
    type ProjectConfig,
    projectConfigSchema,
    STATE_DIR,
} from "./project-config.ts";

export interface ProjectPaths {
    readonly root: string;
    readonly configFile: string;
    /** `.bah/`: server config and local state. */
    readonly stateDir: string;
    /** `.bah/servers/`: data directories of the test servers. */
    readonly serversDataDir: string;
    /** `build/`: intermediate build output. */
    readonly buildDir: string;
    /** `build/artifacts/`: .mcpack and .mcaddon files. */
    readonly artifactsDir: string;
}

export interface LoadProjectOptions {
    /** Directory to start searching for `bah.json` from. */
    cwd: string;
    /** If `BAH_PROJECT_ROOT` is set, it is used instead of searching. */
    env?: Readonly<Record<string, string | undefined>>;
}

export class Project {
    readonly paths: ProjectPaths;
    #config: ProjectConfig;

    /** Finds and loads the project containing `cwd`. */
    static async load(options: LoadProjectOptions): Promise<Project> {
        const override = options.env?.BAH_PROJECT_ROOT;
        const root = override ? resolve(options.cwd, override) : await Project.findRoot(options.cwd);
        if (root === null) {
            throw new BahError(
                `No ${PROJECT_CONFIG_FILE} found in ${options.cwd} or its parent directories. Run "bah init" first.`,
            );
        }
        const config = await readJsonFile(join(root, PROJECT_CONFIG_FILE), projectConfigSchema);
        return new Project(root, config);
    }

    /** Walks up from `startDir` and returns the first directory containing `bah.json`. */
    static async findRoot(startDir: string): Promise<string | null> {
        let dir = resolve(startDir);
        while (true) {
            if (await pathExists(join(dir, PROJECT_CONFIG_FILE))) {
                return dir;
            }
            const parent = dirname(dir);
            if (parent === dir) {
                return null;
            }
            dir = parent;
        }
    }

    constructor(root: string, config: ProjectConfig) {
        const absoluteRoot = resolve(root);
        const stateDir = join(absoluteRoot, STATE_DIR);
        const buildDir = join(absoluteRoot, BUILD_DIR);
        this.paths = {
            root: absoluteRoot,
            configFile: join(absoluteRoot, PROJECT_CONFIG_FILE),
            stateDir,
            serversDataDir: join(stateDir, "servers"),
            buildDir,
            artifactsDir: join(buildDir, "artifacts"),
        };
        this.#config = validate(config, `Invalid project config (${this.paths.configFile})`);
    }

    get name(): string {
        return this.#config.name;
    }

    /** The config as stored in `bah.json`. Use the methods below to change it. */
    get config(): Readonly<ProjectConfig> {
        return this.#config;
    }

    get packs(): Pack[] {
        return this.#config.packs.map((config) => new Pack(this.paths.root, config));
    }

    get behaviorPacks(): Pack[] {
        return this.packs.filter((pack) => pack.type === "behavior");
    }

    get resourcePacks(): Pack[] {
        return this.packs.filter((pack) => pack.type === "resource");
    }

    findPack(name: string): Pack | null {
        return this.packs.find((pack) => pack.name === name) ?? null;
    }

    getPack(name: string): Pack {
        const pack = this.findPack(name);
        if (!pack) {
            throw new BahError(`Pack "${name}" does not exist in this project.`);
        }
        return pack;
    }

    /** Adds a pack to the config (in memory). Call {@link save} to persist. */
    addPack(config: PackConfig): Pack {
        if (this.findPack(config.name)) {
            throw new BahError(`Pack "${config.name}" already exists.`);
        }
        this.#update({ ...this.#config, packs: [...this.#config.packs, config] });
        return new Pack(this.paths.root, config);
    }

    /** Replaces the config of an existing pack (in memory). */
    updatePack(name: string, update: (config: PackConfig) => PackConfig): Pack {
        const index = this.#config.packs.findIndex((pack) => pack.name === name);
        const current = this.#config.packs[index];
        if (current === undefined) {
            throw new BahError(`Pack "${name}" does not exist in this project.`);
        }
        const updated = update(structuredClone(current));
        const packs = this.#config.packs.with(index, updated);
        this.#update({ ...this.#config, packs });
        return new Pack(this.paths.root, updated);
    }

    /**
     * Removes a pack from the config (in memory). Fails if other packs still
     * depend on it. The pack's files are not touched.
     */
    removePack(name: string): void {
        this.getPack(name);
        const dependents = this.#config.packs.filter((pack) => pack.dependencies?.includes(name));
        if (dependents.length > 0) {
            const list = dependents.map((pack) => `"${pack.name}"`).join(", ");
            throw new BahError(`Cannot remove pack "${name}": ${list} depend(s) on it.`);
        }
        this.#update({ ...this.#config, packs: this.#config.packs.filter((pack) => pack.name !== name) });
    }

    /** Writes the config back to `bah.json`. */
    save(): Promise<void> {
        return writeJsonFile(this.paths.configFile, projectConfigSchema, this.#config);
    }

    #update(config: ProjectConfig): void {
        this.#config = validate(config, "This change would make bah.json invalid");
    }
}

function validate(config: ProjectConfig, context = "Invalid project config"): ProjectConfig {
    const result = projectConfigSchema.safeParse(config);
    if (!result.success) {
        throw new BahError(`${context}:\n${z.prettifyError(result.error)}`, { cause: result.error });
    }
    return result.data;
}
