/**
 * An expected error caused by user input or project state. The CLI prints
 * only its message, without a stack trace.
 */
export class BahError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "BahError";
    }
}
