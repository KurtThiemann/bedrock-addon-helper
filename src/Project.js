import * as fs from "node:fs";

export default class Project {
    /**
     * @return {URL}
     */
    getWorkingDirectory() {
        let url = new URL(process.cwd() + '/', import.meta.url);
        if (process.env.BEDROCK_ADDON_ROOT) {
            url = new URL(process.env.BEDROCK_ADDON_ROOT + '/', url);
        }
        return url;
    }

    /**
     * @return {URL}
     */
    getBuildDirectory() {
        let dir = process.env.BEDROCK_ADDON_BUILD_DIR ?? "build";
        return new URL(dir + '/', this.getWorkingDirectory());
    }

    /**
     * @return {URL}
     */
    getBehaviorDirectory() {
        let dir = process.env.BEDROCK_ADDON_BEHAVIOR_DIR ?? "behavior";
        return new URL(dir + '/', this.getWorkingDirectory());
    }

    /**
     * @return {URL}
     */
    getResourceDirectory() {
        let dir = process.env.BEDROCK_ADDON_RESOURCE_DIR ?? "resource";
        return new URL(dir + '/', this.getWorkingDirectory());
    }

    /**
     * @return {Promise<boolean>}
     */
    async checkBehaviorExists() {
        return await this.checkFilesExist(new URL('manifest.json', this.getBehaviorDirectory()));
    }

    /**
     * @return {Promise<boolean>}
     */
    async checkResourceExists() {
        return await this.checkFilesExist(new URL('manifest.json', this.getResourceDirectory()));
    }

    /**
     * @param {string|URL} path
     * @return {Promise<boolean>}
     */
    async checkFilesExist(path) {
        try {
            await fs.promises.access(path, fs.constants.R_OK | fs.constants.W_OK);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {URL} src
     * @param {URL} dest
     * @return {Promise<this>}
     */
    async copyDirectory(src, dest) {
        await fs.promises.mkdir(dest, {recursive: true});
        const entries = await fs.promises.readdir(src, {withFileTypes: true});
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await this.copyDirectory(new URL(entry.name + '/', src), new URL(entry.name + '/', dest));
            } else {
                await fs.promises.copyFile(new URL(entry.name, src), new URL(entry.name, dest));
            }
        }
        return this;
    }

    /**
     * @param {string|URL} path
     * @return {Promise<Object>}
     */
    async readManifest(path) {
        return JSON.parse(await fs.promises.readFile(path, "utf-8"));
    }

    /**
     * @param {string|URL} path
     * @param {Object} manifest
     * @return {Promise<this>}
     */
    async saveManifest(path, manifest) {
        await fs.promises.writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
        return this;
    }
}
