import ConsoleLogger from "../Logger/ConsoleLogger.js";
import * as readline from "node:readline";

export default class Command {
    /** @type {Project} */ project;
    /** @type {Logger} */ logger;

    /**
     * @param {Project} project
     */
    constructor(project) {
        this.project = project;
        this.logger = new ConsoleLogger();
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

    /**
     * @param {Object} options
     * @param {string} name
     * @param {string} defaultValue
     * @return {Promise<string>}
     */
    async readStringOption(options, name, defaultValue) {
        if (options[name] !== undefined) {
            return options[name];
        }
        if (options.yes) {
            return defaultValue;
        }

        let response = await this.prompt(`${name} [${defaultValue}]: `);
        if (!response || response.trim() === "") {
            return defaultValue;
        }
        return response.trim();
    }

    /**
     * @param {Object} options
     * @param {string} name
     * @param {boolean} defaultValue
     * @return {Promise<boolean>}
     */
    async readBooleanOption(options, name, defaultValue) {
        if (options[name] !== defaultValue) {
            return options[name];
        }
        if (options.yes) {
            return defaultValue;
        }

        let optionsString;
        if (defaultValue) {
            optionsString = "Y/n";
        } else {
            optionsString = "y/N";
        }

        let response = await this.prompt(`${name} (${optionsString}): `);
        if (!response || response.trim() === "") {
            return defaultValue;
        }
        return response.trim().toLowerCase() === "y";
    }

    /**
     * @param {string} question
     * @return {Promise<string>}
     */
    async prompt(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise(resolve => {
            rl.question(question, answer => {
                rl.close();
                resolve(answer);
            });
        });
    }
}
