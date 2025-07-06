export default class AddonBuildResult {
    /** @type {Addon} */ addon;
    /** @type {URL} */ outputDirectory;
    /** @type {URL} */ outputPack;

    constructor(addon, outputDirectory, outputPack) {
        this.addon = addon;
        this.outputDirectory = outputDirectory;
        this.outputPack = outputPack;
    }

    /**
     * @return {Addon}
     */
    getAddon() {
        return this.addon;
    }

    /**
     * @return {URL}
     */
    getOutputDirectory() {
        return this.outputDirectory;
    }

    /**
     * @return {URL}
     */
    getOutputPack() {
        return this.outputPack;
    }
}
