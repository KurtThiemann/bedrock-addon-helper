import Command from "./Command.js";
import chokidar from "chokidar";
import AddonBuilder from "../AddonBuilder.js";


export default class WatchCommand extends Command {
    /** @type {?number} */ buildTimeout = null;

    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Continuously watch for changes in the Bedrock Edition Addon and rebuild automatically")
            .option("-d, --debug", "Enable debug mode for the build process")
            .option("-o, --output <path>", "Output directory for the mcpack file");
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "watch";
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        let builder = new AddonBuilder(this.project, options.output || null);

        chokidar.watch([
            this.project.getBehaviorDirectory().pathname,
            this.project.getResourceDirectory().pathname,
            new URL("package.json", this.project.getWorkingDirectory()).pathname,
            new URL("node_modules/", this.project.getWorkingDirectory()).pathname
        ], {
            persistent: true,
            ignoreInitial: true
        }).on('all', async (event, path) => {
            await this.handleChange(builder, event, path, options.debug);
        });

        try {
            console.log("Building addon for the first time...");
            await builder.build(options.debug);
            console.log("Addon built successfully.");
        } catch (e) {
            console.error("Error during initial build process:", e);
            return 1;
        }

        await new Promise(() => {});
        return 0; // Keep the process running
    }

    /**
     *
     * @param builder
     * @param event
     * @param path
     * @param debug
     * @return {Promise<void>}
     */
    async handleChange(builder, event, path, debug) {
        if (path) {
            console.log(`File ${path} changed, event: ${event}`);
        } else {
            console.log(`Files changed, event: ${event}`);
        }

        if (this.buildTimeout) {
            clearTimeout(this.buildTimeout);
        }
        this.buildTimeout = setTimeout(async () => {
            console.log("Rebuilding addon due to changes...");
            try {
                await builder.build(debug);
                console.log("Addon rebuilt successfully.");
            } catch (e) {
                console.error("Error during rebuild process:", e);
            }
        }, 200);
    }
}
