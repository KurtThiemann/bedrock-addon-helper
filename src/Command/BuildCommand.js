import Command from "./Command.js";
import AddonBuilder from "../AddonBuilder.js";
import ServerManager from "../ServerManager.js";


export default class BuildCommand extends Command {
    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Build the Bedrock Edition Addon")
            .option("-d, --debug", "Enable debug mode for the build process")
            .option("-o, --output <path>", "Output directory for the mcpack file");
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "build";
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        console.log("Building addon...");
        let result;
        try {
            result = await new AddonBuilder(this.project, options.output || null).build(options.debug);
        } catch (e) {
            console.error("Error during build process:", e);
            return 1;
        }

        console.log("Addon built successfully.");

        let servers = new ServerManager(this.project);
        console.log("Reloading servers...");
        try {
            await servers.updatePacks(result)
        } catch (e) {
            console.error("Error updating servers:", e);
            return 1;
        }
        console.log("Servers reloaded successfully.");

        return 0;
    }
}
