import ServerCommand from "./ServerCommand.js";

export default class RemoveServerCommand extends ServerCommand {
    /**
     * @inheritDoc
     */
    async configure(command) {
        command.description("Remove a test server from the project")
            .argument("<name>", "Name of the server to remove");
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "remove";
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        if (!await this.getServer(args[0])) {
            console.error(`Server with name "${args[0]}" does not exist.`);
            return 1;
        }
        await this.removeServer(args[0]);
        console.log(`Removed server: ${args[0]}`);
        return 0;
    }
}
