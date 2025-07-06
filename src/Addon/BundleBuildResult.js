export default class BundleBuildResult {
    /** @type {URL} */ bundlePath;
    /** @type {AddonBuildResult[]} */ addons;

    /**
     * @param {URL} bundlePath
     * @param {AddonBuildResult[]} addons
     */
    constructor(bundlePath, addons) {
        this.bundlePath = bundlePath;
        this.addons = addons;
    }

    /**
     * @return {URL}
     */
    getBundlePath() {
        return this.bundlePath;
    }

    /**
     * @return {AddonBuildResult[]}
     */
    getAddons() {
        return this.addons;
    }
}
