export default class Command {
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
     * @param {import("commander").Command} command
     * @return {Promise<void>}
     * @abstract
     */
    async configure(command) {

    }

    /**
     * @param {any[]} args
     * @param {Object} options
     * @return {Promise<number>}
     * @abstract
     */
    async run(args, options) {

    }
}
