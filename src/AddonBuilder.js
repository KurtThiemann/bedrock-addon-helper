import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import * as zl from 'zip-lib';

export default class AddonBuilder {
    /** @type {Project} */ project;
    /** @type {?URL} */ output;


    /**
     * @param {Project} project
     * @param {?URL} output
     */
    constructor(project, output = null) {
        this.project = project;
        this.output = output;
    }

    async build(debug = false) {
        let behaviorBuildDir = new URL("behavior_build/", this.project.getBuildDirectory());
        let resourceBuildDir = new URL("resource_build/", this.project.getBuildDirectory());
        let artifactDir = new URL("artifacts/", this.project.getBuildDirectory());

        if (await this.project.checkFilesExist(behaviorBuildDir)) {
            await fs.promises.rm(behaviorBuildDir, {recursive: true});
        }

        if (await this.project.checkFilesExist(resourceBuildDir)) {
            await fs.promises.rm(resourceBuildDir, {recursive: true});
        }

        await fs.promises.mkdir(behaviorBuildDir, {recursive: true});

        let packageJson = await this.project.readManifest(new URL("package.json", this.project.getWorkingDirectory()));

        let packs = [];
        if (await this.project.checkBehaviorExists()) {
            await this.buildBehaviorPack(behaviorBuildDir, debug);
            let filename = `${packageJson.name}_behavior.mcpack`;
            await this.packZip(behaviorBuildDir, new URL(filename, artifactDir));
            packs.push(filename);
        }

        if (await this.project.checkResourceExists()) {
            await this.buildResourcePack(resourceBuildDir);
            let filename = `${packageJson.name}_resources.mcpack`;
            await this.packZip(resourceBuildDir, new URL(filename, artifactDir));
            packs.push(filename);
        }

        if (packs.length === 0) {
            throw new Error("No packs found to build. Ensure you have a valid behavior or resource pack.");
        }

        let output = this.output?.pathname;
        if (!output) {
            output = new URL(`${packageJson.name}.mcaddon`, artifactDir).pathname;
        }

        let zip = new zl.Zip();
        for (let pack of packs) {
            zip.addFile(new URL(pack, artifactDir).pathname, pack);
        }
        await zip.archive(output);

        return 0;
    }

    async buildBehaviorPack(buildDir, debug) {
        await this.project.copyDirectory(this.project.getBehaviorDirectory(), buildDir);

        let manifest = await this.project.readManifest(new URL("manifest.json", buildDir));
        let entryPoints = [];
        for (let module of manifest.modules) {
            if (module.type !== "script" || module.language !== "javascript" || !module.entry) {
                continue;
            }
            entryPoints.push(new URL(module.entry, buildDir).pathname);
            module.entry = path.normalize(`dist/${module.entry}`);
        }

        await this.project.saveManifest(new URL("manifest.json", buildDir), manifest);

        await esbuild.build({
            entryPoints: entryPoints,
            bundle: true,
            minify: !debug,
            sourcemap: debug ? 'inline' : false,
            external: ["@minecraft/*"],
            outbase: buildDir.pathname,
            outdir: new URL("dist", buildDir).pathname,
        });

        await fs.promises.rm(new URL("scripts", buildDir), {recursive: true});
    }

    async buildResourcePack(buildDir) {
        await this.project.copyDirectory(this.project.getResourceDirectory(), buildDir);
    }

    async packZip(buildDir, outputPath) {
        await zl.archiveFolder(buildDir.pathname, outputPath.pathname);
    }
}
