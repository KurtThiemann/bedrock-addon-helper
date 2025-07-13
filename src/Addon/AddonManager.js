import ResourcePack from "./ResourcePack.js";
import BehaviorPack from "./BehaviorPack.js";
import FileUtils from "../Util/FileUtils.js";
import * as zl from "zip-lib";
import fs from "node:fs";
import path from "node:path";
import BundleBuildResult from "./BundleBuildResult.js";

export default class AddonManager {
    static ADDON_TYPES = [
        ResourcePack,
        BehaviorPack
    ];

    /** @type {Project} */ project;
    /** @type {?Addon[]} */ addons = null;

    /**
     * @param {Project} project
     */
    constructor(project) {
        this.project = project;
    }

    /**
     * @param {boolean} update
     * @return {Promise<Addon[]>}
     */
    async getAddons(update = false) {
        if (this.addons && !update) {
            return this.addons;
        }

        this.addons = [];
        let config = await FileUtils.readJson(new URL("addons.json", this.project.getConfigPath()), []);
        for (let addonConfig of config) {
            let type = this.constructor.ADDON_TYPES.find(t => t.getType() === addonConfig.type);
            if (!type) {
                throw new TypeError(`Unknown addon type: ${addonConfig.type}`);
            }

            this.addons.push(type.fromJson(addonConfig, this.project));
        }

        return this.addons;
    }

    /**
     * @param {string} name
     * @param {boolean} update
     * @return {Promise<null|?Addon>}
     */
    async getAddon(name, update = false) {
        let addons = await this.getAddons(update);
        for (let addon of addons) {
            if (addon.getName() === name) {
                return addon;
            }
        }
        return null;
    }

    /**
     * @param {boolean} update
     * @return {Promise<BehaviorPack[]>}
     */
    async getBehaviorPacks(update = false) {
        let addons = await this.getAddons(update);
        return /** @type {BehaviorPack[]} */ addons.filter(addon => addon instanceof BehaviorPack);
    }

    /**
     * @param {boolean} update
     * @return {Promise<ResourcePack[]>}
     */
    async getResourcePacks(update = false) {
        let addons = await this.getAddons(update);
        return /** @type {ResourcePack[]} */ addons.filter(addon => addon instanceof ResourcePack);
    }

    /**
     * @param {Addon[]} addons
     * @return {Promise<void>}
     */
    async saveAddons(addons) {
        this.addons = addons;
        await FileUtils.writeJson(new URL("addons.json", this.project.getConfigPath()), addons);
    }

    /**
     * @param {Addon} addon
     * @return {Promise<void>}
     */
    async saveAddon(addon) {
        let addons = await this.getAddons(true);
        let index = addons.findIndex(a => a.getName() === addon.getName());
        if (index !== -1) {
            addons[index] = addon;
        } else {
            addons.push(addon);
        }
        await this.saveAddons(addons);
    }

    /**
     * @param {string} name
     * @return {Promise<void>}
     */
    async removeAddon(name) {
        let addons = await this.getAddons(true);
        let index = addons.findIndex(a => a.getName() === name);
        if (index !== -1) {
            addons.splice(index, 1);
            await this.saveAddons(addons);
        }
    }

    /**
     * @return {URL}
     */
    getPackagePath() {
        return new URL(`${this.project.getName()}.mcaddon`, this.project.getArtifactPath());
    }

    /**
     * @param {AddonBuildOptions} options
     * @param {?Logger} logger
     * @return {Promise<?BundleBuildResult>}
     */
    async build(options, logger = null) {
        let addons = await this.getAddons(true);
        if (addons.length === 0) {
            logger?.warn(`No addons found to build.`);
        }

        let promises = [];

        logger?.log(`Building ${addons.length} addons...`);
        for (let addon of addons) {
            promises.push(addon.build(options, logger));
        }
        /** @type {AddonBuildResult[]} */
        let results = await Promise.all(promises);
        logger?.log(`Finished building addons.`);

        await fs.promises.mkdir(path.dirname(this.getPackagePath().pathname), {recursive: true});
        let outputPath = this.getPackagePath();

        let zip = new zl.Zip();
        for (let pack of results) {
            if (!pack.getAddon().isBundled()) {
                continue;
            }
            zip.addFile(pack.getOutputPack().pathname, path.basename(pack.getOutputPack().pathname));
        }
        await zip.archive(outputPath.pathname);

        return new BundleBuildResult(
            outputPath,
            results
        );
    }
}
