import fs from "node:fs";

export default class FileUtils {
    /**
     * @param {PathLike} path
     * @return {Promise<boolean>}
     */
    static async exists(path) {
        try {
            await fs.promises.access(path, fs.constants.R_OK);
        } catch (e) {
            return false;
        }
        return true;
    }

    /**
     * @param {PathLike} path
     * @param {any} fallback
     * @return {Promise<any>}
     */
    static async readJson(path, fallback = null) {
        let data;
        try {
            data = await fs.promises.readFile(path, 'utf-8');
        } catch (e) {
            if (fallback !== null && e.code === 'ENOENT') {
                return fallback;
            }
            throw e;
        }

        return JSON.parse(data);
    }

    /**
     * @param {PathLike} path
     * @param {any} data
     * @return {Promise<void>}
     */
    static async writeJson(path, data) {
        await fs.promises.mkdir(new URL('.', path), {recursive: true});
        await fs.promises.writeFile(path, JSON.stringify(data, null, 2) + "\n");
    }

    /**
     * @param {URL} src
     * @param {URL} dest
     * @return {Promise<this>}
     */
    static async copyDirectory(src, dest) {
        await fs.promises.mkdir(dest, {recursive: true});
        const entries = await fs.promises.readdir(src, {withFileTypes: true});
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
                await this.copyDirectory(new URL(entry.name + '/', src), new URL(entry.name + '/', dest));
            } else {
                await fs.promises.copyFile(new URL(entry.name, src), new URL(entry.name, dest));
            }
        }
        return this;
    }
}
