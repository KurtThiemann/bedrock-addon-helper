export default class AddonBuildOptions {
    /** @type {boolean} */ minify = true;
    /** @type {boolean} */ sourceMaps = false;
    /** @type {import("esbuild").BuildOptions} */ esbuildOptions = {};
}
