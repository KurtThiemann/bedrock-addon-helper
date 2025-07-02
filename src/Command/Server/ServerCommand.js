import Command from "../Command.js";
import ServerManager from "../../ServerManager.js";

/**
 * @abstract
 */
export default class ServerCommand extends Command {
    /** @type {?Object} */ loadedServers = null;
    /** @type {ServerManager} */ servers;

    /**
     * @inheritDoc
     */
    constructor(project) {
        super(project);
        this.servers = new ServerManager(project);
    }
}
