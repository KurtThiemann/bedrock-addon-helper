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
     * @inheritDoc
     */
    async run(args, options) {
        if (await this.getServer(args[0])) {
            console.error(`Server with name "${args[0]}" already exists.`);
            return 1;
        }

        await this.saveServer(args[0], {
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
        });

        console.log("Added new server:", args[0]);
        console.log("Edit the servers.json file to configure the server further.");
        return 0;
    }
}
