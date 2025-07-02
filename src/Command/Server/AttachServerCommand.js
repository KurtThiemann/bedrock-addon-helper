import ServerCommand from "./ServerCommand.js";
import Server from "../../Server.js";

export default class AttachServerCommand extends ServerCommand {
    async configure(command) {
        command.description("Attach to a running test server")
            .argument("<name>", "Name of the server to attach to");
    }

    getName() {
        return "attach";
    }

    async run(args, options) {
        let config = await this.getServer(args[0]);
        if (!config) {
            console.error(`Server with name "${args[0]}" does not exist.`);
            return 1;
        }

        let server = new Server(config, this.project);

        if (!await server.getContainer()) {
            console.error(`Server "${args[0]}" is not running.`);
            return 1;
        }

        while (true) {
            let container = await server.getContainer(true);
            if (!container) {
                console.error(`Server "${args[0]}" is not running, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }

            console.log(`Attaching to server "${args[0]}"...`);
            try {
                let stream = await container.attach({
                    stream: true,
                    stdin: true,
                    stdout: true,
                    stderr: true,
                    tty: true,
                    logs: true
                });
                process.stdin.pipe(stream);
                container.modem.demuxStream(stream, process.stdout, process.stderr);
                await this.waitForStream(stream);
                console.log(`Detached from server "${args[0]}".`);
            } catch (e) {
                console.error(`Error attaching to server "${args[0]}", retrying...`);
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    waitForStream(stream) {
        return new Promise((resolve, reject) => {
            stream.on("end", resolve);
            stream.on("error", reject);
        });
    }
}
