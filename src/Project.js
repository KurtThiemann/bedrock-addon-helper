import path from "node:path";
import FileUtils from "./FileUtils.js";
import ResourcePack from "./Addon/ResourcePack.js";
import BehaviorPack from "./Addon/BehaviorPack.js";
import AddonManager from "./Addon/AddonManager.js";

export default class Project {
    static NAME_ALLOWED_CHARS = /^[\w-]+$/;

    static ADDON_TYPES = [
        ResourcePack,
        BehaviorPack
    ];

    /** @type {string} */ name;
    /** @type {URL} */ projectPath;
    /** @type {URL} */ buildPath;
    /** @type {URL} */ configPath;
    /** @type {AddonManager} */ addonManager;

    /**
     * @return {Project}
     */
    static async fromEnvironment() {
        let projectPath = new URL(process.cwd() + '/', import.meta.url);
        if (process.env.BAH_PROJECT_ROOT) {
            projectPath = new URL(process.env.BAH_PROJECT_ROOT + '/', projectPath);
        }

        let buildPath = new URL((process.env.BAH_BUILD_DIR ?? "build") + '/', projectPath);
        let configPath = new URL((process.env.BAH_CONFIG_DIR ?? ".bah") + "/", projectPath);

        let name = process.env.BAH_PROJECT_NAME ?? null;
        let packageJsonPath = new URL("package.json", projectPath);
        if (name === null && await FileUtils.exists(packageJsonPath)) {
            try {
                let packageJson = await FileUtils.readJson(packageJsonPath);
                if (typeof packageJson.name === 'string') {
                    name = packageJson.name;
                }
            } catch (e) {
            }

        }
        if (name === null) {
            name = path.basename(projectPath.pathname);
        }
        if (name === null || !Project.NAME_ALLOWED_CHARS.test(name)) {
            throw new TypeError("Could not find valid project name, expected a string matching " + Project.NAME_ALLOWED_CHARS);
        }

        return new this(name, projectPath, buildPath, configPath);
    }

    /**
     * @param {string} name
     * @param {URL} projectPath
     * @param {URL} buildPath
     * @param {URL} configPath
     */
    constructor(name, projectPath, buildPath, configPath) {
        this.name = name;
        this.projectPath = projectPath;
        this.buildPath = buildPath;
        this.configPath = configPath;
        this.addonManager = new AddonManager(this);
    }

    /**
     * @return {string}
     */
    getName() {
        return this.name;
    }

    /**
     * @return {URL}
     */
    getProjectPath() {
        return this.projectPath;
    }

    /**
     * @return {URL}
     */
    getBuildPath() {
        return this.buildPath;
    }

    /**
     * @return {URL}
     */
    getArtifactPath() {
        return new URL("artifacts/", this.getBuildPath());
    }

    /**
     * @return {URL}
     */
    getConfigPath() {
        return this.configPath;
    }
}
