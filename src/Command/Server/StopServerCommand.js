import ServerCommand from "./ServerCommand.js";
import Server from "../../Server.js";

export default class StopServerCommand extends ServerCommand {
    async configure(command) {
        command.description("Stop a test server")
            .argument("<name>", "Name of the server to stop");
    }

    getName() {
        return "stop";
    }

    async run(args, options) {
        let config = await this.servers.getServer(args[0]);
        if (!config) {
            console.error(`Server with name "${args[0]}" does not exist.`);
            return 1;
        }

        let server = new Server(config, this.project);

        if (!await server.getContainer()) {
            console.error(`Server "${args[0]}" is not running.`);
            return 1;
        }

        try {
            await server.stopContainer();
        } catch (e) {
            console.error("Error stopping server:", e);
            return 1;
        }

        console.log(`Server "${args[0]}" is was stopped successfully.`);
        return 0;
    }
}
