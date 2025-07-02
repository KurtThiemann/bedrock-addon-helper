import ServerCommand from "./ServerCommand.js";
import Server from "../../Server.js";

export default class StartServerCommand extends ServerCommand {

    async configure(command) {
        command.description("Start a test server")
            .argument("<name>", "Name of the server to start")
            .option("--restart", "Restart the server if it is already running");
    }

    getName() {
        return "start";
    }

    async run(args, options) {
        let config = await this.getServer(args[0]);
        if (!config) {
            console.error(`Server with name "${args[0]}" does not exist.`);
            return 1;
        }

        let server = new Server(config, this.project);

        if (await server.getContainer()) {
            if (!options.restart) {
                console.error(`Server "${args[0]}" is already running. Use --restart to restart it.`);
                return 1;
            }
            console.log(`Stopping running server container for "${args[0]}"...`);
            await server.stopContainer();
        }

        console.log(`Updating server configuration for "${args[0]}"...`);
        try {
            await server.configureServer();
        } catch (e) {
            console.error("Error updating server configuration:", e);
            return 1;
        }

        console.log(`Starting server container for "${args[0]}"...`);
        try {
            await server.startContainer();
        } catch (e) {
            console.error("Error starting server container:", e);
            return 1;
        }

        console.log(`Waiting for server "${args[0]}" to be ready...`);
        try {
            await server.waitForServerReady(AbortSignal.timeout(2 * 60 * 1000));
        } catch (e) {
            console.error("Error waiting for server to be ready:", e);
            return 1;
        }

        console.log(`Server "${args[0]}" is now running at ${await server.getAddress()}`);
        return 0;
    }
}
