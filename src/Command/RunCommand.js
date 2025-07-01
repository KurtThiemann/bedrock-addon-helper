import Command from "./Command.js";

export default class RunCommand extends Command {

    async configure(command) {
        return Promise.resolve(undefined);
    }

    getName() {
        return "";
    }

    async run(args, options) {
        return Promise.resolve(0);
    }
}
