import Logger from "./Logger.js";

export default class ConsoleLogger extends Logger {
    /**
     * @inheritDoc
     */
    debug(...message) {
        console.debug(...message);
    }

    /**
     * @inheritDoc
     */
    error(...message) {
        console.error(...message);
    }

    /**
     * @inheritDoc
     */
    info(...message) {
        console.info(...message);
    }

    /**
     * @inheritDoc
     */
    log(...message) {
        console.log(...message);
    }

    /**
     * @inheritDoc
     */
    warn(...message) {
        console.warn(...message);
    }
}
