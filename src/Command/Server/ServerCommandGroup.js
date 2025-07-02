import CommandGroup from "../CommandGroup.js";
import CreateServerCommand from "./CreateServerCommand.js";
import RemoveServerCommand from "./RemoveServerCommand.js";
import StartServerCommand from "./StartServerCommand.js";
import StopServerCommand from "./StopServerCommand.js";
import AttachServerCommand from "./AttachServerCommand.js";

export default class ServerCommandGroup extends CommandGroup {

    /**
     * @inheritDoc
     */
    getCommands() {
        return [
            new CreateServerCommand(this.project),
            new RemoveServerCommand(this.project),
            new StartServerCommand(this.project),
            new StopServerCommand(this.project),
            new AttachServerCommand(this.project),
        ];
    }

    /**
     * @inheritDoc
     */
    getDescription() {
        return "Manage test servers for the project";
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "server";
    }
}
