import ServerCommand from "./ServerCommand.js";

export default class CreateServerCommand extends ServerCommand {
    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Create a new test server for the project")
            .argument("<name>", "Name of the server to create");
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "create";
    }

    /**
     * @return {number}
     */
    getRandomPort() {
        return Math.floor(Math.random() * (65535 - 1024)) + 1024;
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        if (await this.servers.getServer(args[0])) {
            console.error(`Server with name "${args[0]}" already exists.`);
            return 1;
        }

        let serverPort = this.getRandomPort();
        let debugPort = this.getRandomPort();

        await this.servers.saveServer(args[0], {
            name: args[0],
            id: crypto.randomUUID().substring(0, 12),
            experiments: [],
            permissions: {
                "allowed_modules": [
                    "@minecraft/server-gametest",
                    "@minecraft/server",
                    "@minecraft/server-ui",
                    "@minecraft/server-admin",
                    "@minecraft/server-editor",
                    "@minecraft/server-net",
                    "@minecraft/vanilla-data",
                    "@minecraft/math",
                    "@minecraft/debug-utilities"
                ]
            },
            variables: {},
            secrets: {},
            environment: {
                EULA: "TRUE",
                VERSION: "LATEST",
                ALLOW_CHEATS: "true",
                DEFAULT_PLAYER_PERMISSION_LEVEL: "operator",
                TEXTUREPACK_REQUIRED: "true",
                LEVEL_NAME: "world",
                CONTENT_LOG_CONSOLE_OUTPUT_ENABLED: "true",
            },
            serverProperties: {
                "allow-outbound-script-debugging": "true",
                "allow-inbound-script-debugging": "true",
                "force-inbound-debug-port": "19144",
            },
            reloadCommand: "reload",
            fullRestart: false,
            exposedPorts: {
                "19132/udp": {
                    ip: "",
                    port: serverPort
                },
                "19144/tcp": {
                    ip: "",
                    port: debugPort
                }
            }
        });

        console.log("Added new server:", args[0]);
        console.log("Edit the servers.json file to configure the server further.");
        return 0;
    }
}
