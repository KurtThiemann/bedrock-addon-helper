import Command from "./Command.js";

export default class RemoveCommand extends Command {
    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Remove a Bedrock Edition Scripting module")
            .argument("<module>", "The name of the module to remove, e.g. @minecraft/server");
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "remove";
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        let [module] = args;
        if (!module.startsWith("@minecraft/")) {
            console.error("Module must start with @minecraft/");
            return 1;
        }

        let packageJsonUrl = new URL("package.json", this.project.getWorkingDirectory());
        let packageJson = await this.project.readManifest(packageJsonUrl);
        if (packageJson.devDependencies?.[module]) {
            delete packageJson.devDependencies[module];
        } else if (packageJson.dependencies?.[module]) {
            delete packageJson.dependencies[module];
        } else {
            console.warn(`Module ${module} is not listed in package.json.`);
        }

        await this.project.saveManifest(packageJsonUrl, packageJson);

        let manifestUrl = new URL("manifest.json", this.project.getBehaviorDirectory());
        let manifest = await this.project.readManifest(manifestUrl);
        if (manifest.dependencies) {
            manifest.dependencies = manifest.dependencies.filter(dep => dep.module_name !== module);
        } else {
            console.warn(`No dependencies found in manifest.json.`);
        }

        await this.project.saveManifest(manifestUrl, manifest);

        console.log(`Module ${module} has been removed successfully.`);
        return 0;
    }
}
