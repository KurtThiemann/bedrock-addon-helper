import ServerCommand from "./ServerCommand.js";
import Server from "../../Server.js";

export default class StartServerDebuggerCommand extends ServerCommand {

    async configure(command) {
        command.description("Start a Debug Adapter Protocol server for a Minecraft server")
            .argument("<name>", "Name of the target server")
            .argument("<port>", "Port to start the debugger on", (value) => parseInt(value, 10), 9229);
    }

    getName() {
        return "debug";
    }

    async run(args, options) {
        let config = await this.servers.getServer(args[0]);
        if (!config) {
            console.error(`Server with name "${args[0]}" does not exist.`);
            return 1;
        }

        let server = new Server(config, this.project);

        if (!await server.getContainer()) {
            console.error(`Server "${args[0]}" is not running. Please start the server before starting the debugger.`);
            return 1;
        }

        if (!await this.project.checkBehaviorExists()) {
            console.error(`No behavior pack found in the project. Please create a behavior pack before starting the debugger.`);
            return 1;
        }

        let manifest = await this.project.readManifest(new URL("./manifest.json", this.project.getBehaviorDirectory()));
        let scriptModule = manifest.modules.find(m => m.type === "script");
        if (!scriptModule) {
            console.error(`No script module found in the behavior pack manifest. Please add a script module before starting the debugger.`);
            return 1;
        }

        let uuid = scriptModule.uuid;

        await server.startDebugger(args[1], uuid);
        await new Promise(() => {});
        return 0;
    }
}
