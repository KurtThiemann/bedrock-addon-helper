export default class CommandGroup {
    /** @type {Project} */ project;

    /**
     * @param {Project} project
     */
    constructor(project) {
        this.project = project;
    }

    /**
     * @return {string}
     * @abstract
     */
    getName() {
    }

    /**
     * @return {string}
     * @abstract
     */
    getDescription() {
    }

    /**
     * @return {(CommandGroup|Command)[]}
     * @abstract
     */
    getCommands() {
    }
}
