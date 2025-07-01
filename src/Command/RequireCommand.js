import Command from "./Command.js";
import pacote from "pacote";
import {SemVer} from "semver";

export default class RequireCommand extends Command {
    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Require a specific Bedrock Edition Scripting module")
            .argument("<module>", "The name of the module to require, e.g. @minecraft/server")
            .argument("[version]", "The version of the module to require, e.g. 1.0.0")
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "require";
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        let [module, version] = args;
        if (!await this.project.checkBehaviorExists()) {
            console.error("Behavior directory does not exist.");
            return 1;
        }
        if (!module.startsWith("@minecraft/")) {
            console.error("Module must start with @minecraft/");
            return 1;
        }
        let packument = await pacote.packument(module);
        let packageVersion;
        let versions = [...Object.keys(packument.versions)].reverse();
        if (version) {
            packageVersion = this.resolveVersion(versions, version);
        } else {
            packageVersion = this.getLatestRelease(versions);
        }

        if (!packageVersion) {
            console.error(`Version ${version} not found for module ${module}.`);
            return 1;
        }

        console.log(`Adding module ${module}@${packageVersion} to the behavior pack...`);
        let packageJson = await this.project.readManifest(new URL("package.json", this.project.getWorkingDirectory()));
        if (!packageJson.devDependencies) {
            packageJson.devDependencies = {};
        }
        packageJson.devDependencies[module] = packageVersion;
        await this.project.saveManifest(new URL("package.json", this.project.getWorkingDirectory()), packageJson);

        let manifest = await this.project.readManifest(new URL("manifest.json", this.project.getBehaviorDirectory()));
        if (!manifest.dependencies) {
            manifest.dependencies = [];
        }
        let moduleEntry = manifest.dependencies.find(m => m.module_name === module);
        if (moduleEntry) {
            moduleEntry.version = version || packageVersion;
        } else {
            manifest.dependencies.push({
                module_name: module,
                version: version || packageVersion
            });
        }

        await this.project.saveManifest(new URL("manifest.json", this.project.getBehaviorDirectory()), manifest);

        console.log(`Module ${module}@${packageVersion} added successfully. Run 'npm install' to install the module.`);
        return 0;
    }

    /**
     * @param {string[]} available
     * @param {string} version
     * @return {string|null}
     */
    resolveVersion(available, version) {
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
    getLatestRelease(available) {
        for (let version of available) {
            if (new SemVer(version).prerelease.length === 0) {
                return version;
            }
        }
        return null;
    }
}
