import CommandGroup from "../CommandGroup.js";

export default class InitCommandGroup extends CommandGroup {
    /**
     * @inheritDoc
     */
    getCommands() {
        return [];
    }

    /**
     * @inheritDoc
     */
    getDescription() {
        return "Initialize a new resource or behavior pack for the project";
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "init";
    }
}
