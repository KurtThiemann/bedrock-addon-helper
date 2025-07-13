import Command from "./Command.js";
import BehaviorPack from "../Addon/BehaviorPack.js";

export default class RequireCommand extends Command {
    /** @type {PackageResolver} */ packageResolver;

    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Require a specific Bedrock Edition Scripting module")
            .argument("<module>", "The name of the module to require, e.g. @minecraft/server")
            .argument("[version]", "The version of the module to require, e.g. 1.0.0")
            .option("-a, --addons <addon...>", "The addons to require the module for", null)
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
        let [moduleName, version] = args;

        let resolvedVersion;
        try {
            resolvedVersion = await this.packageResolver.resolveVersion(moduleName, version);
        } catch (e) {
            this.logger.error(`Failed to resolve version for module ${moduleName}: ${e.message}`);
        }

        let addons;
        if (options.addons) {
            for (let addonName of options.addons) {
                let addon = await this.project.addonManager.getAddon(addonName);
                if (!addon) {
                    this.logger.error(`Addon ${addonName} not found.`);
                    return 1;
                }
                if (!(addon instanceof BehaviorPack)) {
                    this.logger.error(`Addon ${addonName} is not a behavior pack.`);
                    return 1;
                }
            }
        } else {
            addons = await this.project.addonManager.getBehaviorPacks();
            if (addons.length === 0) {
                this.logger.error("No addons found in the project.");
                return 1;
            }
        }

        for (let addon of addons) {
            this.logger.info(`Adding module ${moduleName}@${version || resolvedVersion} to addon ${addon.getName()}...`);
            await addon.addRequiredModule(moduleName, version || resolvedVersion);
        }

        this.logger.info(`Adding module ${moduleName}@${resolvedVersion} to package.json.`);
        await this.project.addTypeModule(moduleName, resolvedVersion);

        this.logger.info(`Module ${moduleName}@${resolvedVersion} added successfully, run 'npm install' to install the module.`);
        return 0;
    }
}
