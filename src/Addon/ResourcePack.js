import Addon from "./Addon.js";
import FileUtils from "../Util/FileUtils.js";
import fs from "node:fs";
import AddonBuildResult from "./AddonBuildResult.js";

export default class ResourcePack extends Addon {
    /**
     * @inheritDoc
     */
    static getType() {
        return "resource";
    }

    /**
     * @inheritDoc
     */
    async build(options, logger = null) {
        logger?.log(`Building resource pack "${this.getName()}"...`);
        let buildPath = this.getBuildPath();
        await fs.promises.rm(buildPath, {recursive: true, force: true});
        await FileUtils.copyDirectory(this.getPath(), buildPath);

        logger?.log(`Packing resource pack "${this.getName()}"...`);
        let output = await this.package(buildPath);

        logger?.log(`Resource pack "${this.getName()}" built successfully.`);
        return new AddonBuildResult(this, buildPath, output);
    }
}
