import Command from "../Command.js";
import BedrockVersionResolver from "../../Util/BedrockVersionResolver.js";

/**
 * @abstract
 */
export default class InitCommand extends Command {
    /** @type {BedrockVersionResolver} */ versionResolver = new BedrockVersionResolver();

    /**
     * @inheritDoc
     */
    async configure(command) {
        command.option("-y, --yes", "Use default values for all prompts")
            .option("-f, --force", "Force initialization even if files already exist")
            .option("-n, --name <name>", "The name of the addon")
            .option("-d, --description <description>", "The description of the addon")
            .option("--target-version <version>", "Target Minecraft version required for the addon");
    }

    /**
     * @param {AddonInitOptions} init
     * @param {Object} options
     * @param {string} defaultName
     * @return {Promise<AddonInitOptions>}
     */
    async readCommonOptions(init, options, defaultName) {
        let packageJson = await this.project.readPackageJson();
        init.name = await this.readStringOption(options, "name", packageJson.name ?? defaultName);
        init.description = await this.readStringOption(options, "description", packageJson.description ?? "");

        let version = await this.readStringOption(options, "targetVersion", "latest");
        version = await this.versionResolver.resolve(version);

        return init;
    }
}
