import Addon from "./Addon.js";
import fs from "node:fs";
import FileUtils from "../Util/FileUtils.js";
import path from "node:path";
import * as esbuild from "esbuild";
import AddonBuildResult from "./AddonBuildResult.js";

export default class BehaviorPack extends Addon {
    /**
     * @inheritDoc
     */
    static getType() {
        return "behavior";
    }

    /**
     * @inheritDoc
     */
    async build(options, logger = null) {
        let buildPath = this.getBuildPath();
        logger?.log(`Building behavior pack "${this.getName()}"...`);
        await fs.promises.rm(buildPath, {recursive: true, force: true});
        await FileUtils.copyDirectory(this.getPath(), buildPath);

        let manifest = await this.readManifest();
        let scriptsDir = new URL("scripts/", buildPath);

        let entryPoints = [];
        for (let module of manifest.modules) {
            if (module.type !== "script" || module.language !== "javascript" || !module.entry) {
                continue;
            }
            if (!module.entry.startsWith("scripts/")) {
                logger?.warn(`Invalid entry point "${module.entry}" in module "${module.description}". Expected to start with "scripts/".`);
                continue;
            }
            entryPoints.push(new URL(module.entry, buildPath).pathname);
            module.entry = path.normalize(`scripts/dist/${module.entry.substring(8)}`);
        }

        await FileUtils.writeJson(new URL("manifest.json", buildPath), manifest);

        console.log(`Building scripts: ${entryPoints.join(", ")} in behavior pack "${this.getName()}"...`);
        let buildOptions = {
            entryPoints: entryPoints,
            bundle: true,
            minify: options.esbuildOptions.minify ?? !options.minify,
            sourcemap: options.esbuildOptions.sourcemap ?? options.sourceMaps ? 'inline' : false,
            external: ["@minecraft/*", ...(options.esbuildOptions.external ?? [])],
            outbase: scriptsDir.pathname,
            outdir: new URL("dist/", scriptsDir).pathname,
        };

        await esbuild.build(Object.assign({}, options.esbuildOptions, buildOptions));

        for (let file of await fs.promises.readdir(scriptsDir)) {
            if (file !== "dist") {
                await fs.promises.rm(new URL(file, scriptsDir), {recursive: true});
            }
        }

        logger?.log(`Packing behavior pack "${this.getName()}"...`);
        let result = await this.package(buildPath);

        logger?.log(`Behavior pack "${this.getName()}" built successfully.`);
        return new AddonBuildResult(this, buildPath, result);
    }

    /**
     * @param {string} name
     * @param {string} version
     * @return {Promise<void>}
     */
    async addRequiredModule(name, version) {
        let manifest = await this.readManifest();
        let moduleEntry = manifest.dependencies.find(m => m.module_name === name);
        if (moduleEntry) {
            moduleEntry.version = version;
        } else {
            manifest.dependencies.push({
                module_name: name,
                version: version
            });
        }
        await this.writeManifest(manifest);
    }
}
