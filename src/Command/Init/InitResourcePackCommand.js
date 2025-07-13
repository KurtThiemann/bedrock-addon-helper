import Command from "../Command.js";
import ResourcePackInitOptions from "../../Addon/Init/ResourcePackInitOptions.js";

export default class InitResourcePackCommand extends Command {

    async configure(command) {
        command.option("-y, --yes", "Use default values for all prompts")
            .option("-f, --force", "Force initialization even if files already exist")
            .option("-n, --name <name>", "The name of the addon")
            .option("-d, --description <description>", "The description of the addon")
            .option("--target-version <version>", "Target Minecraft version required for the addon");
    }

    getName() {
        return "resource-pack";
    }

    async run(args, options) {
        let packageJson = await this.project.readPackageJson();
        let init = new ResourcePackInitOptions();
        init.name = await this.readStringOption(options, "name", packageJson.name ?? "resources");
        init.description = await this.readStringOption(options, "description", packageJson.description ?? "");
        init.targetVersion = await this.readStringOption(options, "targetVersion", "latest");
    }
}
