import pacote from "pacote";
import {SemVer} from "semver";

export default class PackageResolver {
    /** @type {Map<string, Object>} */ packuments = new Map();

    /**
     * @param {string} moduleName
     * @param {?string} version
     * @return {Promise<string>}
     */
    async resolveVersion(moduleName, version) {
        if (!moduleName.startsWith("@minecraft/")) {
            throw new Error("Not a valid Minecraft module: " + moduleName);
        }

        let versions = await this.getVersions(moduleName);
        let packageVersion;
        if (version) {
            packageVersion = this.findVersionInAvailable(versions, version);
        } else {
            packageVersion = this.findLatestVersion(versions);
        }

        if (!packageVersion) {
            throw new Error(`Could not find version ${version} for module ${moduleName}`);
        }

        return packageVersion;
    }

    /**
     * @param {string} name
     * @return {Promise<Object>}
     */
    async getPackument(name) {
        if (this.packuments.has(name)) {
            return this.packuments.get(name);
        }
        let packument = await pacote.packument(name);
        this.packuments.set(name, packument);
        return packument;
    }

    /**
     * @param {string} name
     * @return {Promise<string[]>}
     */
    async getVersions(name) {
        let packument = await this.getPackument(name);
        if (!packument.versions) {
            return [];
        }
        return [...Object.keys(packument.versions)].reverse();
    }

    /**
     * @param {string[]} available
     * @param {string} version
     * @return {string|null}
     */
    findVersionInAvailable(available, version) {
        let hasPrerelease = new SemVer(version).prerelease.length > 0;
        if (hasPrerelease) {
            return available.find(v => new SemVer(v).prerelease.length > 0 && v.startsWith(version)) ?? null;
        } else {
            return available.find(v => !new SemVer(v).prerelease.length && v.startsWith(version)) ?? null;
        }
    }

    /**
     * @param {string[]} available
     * @return {string|null}
     */
    findLatestVersion(available) {
        for (let version of available) {
            if (new SemVer(version).prerelease.length === 0) {
                return version;
            }
        }
        return null;
    }
}
