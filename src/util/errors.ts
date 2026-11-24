/**
 * An expected error caused by user input or project state. The CLI prints
 * only its message, without a stack trace.
 */
export class BahError extends Error {
    /** Process exit code when the CLI ends with this error. */
    readonly exitCode: number;

    constructor(message: string, options?: ErrorOptions & { exitCode?: number }) {
        super(message, options);
        this.name = "BahError";
        this.exitCode = options?.exitCode ?? 1;
    }
}
