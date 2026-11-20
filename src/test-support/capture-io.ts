import type { CliIo } from "../cli/io.ts";

export interface CapturedIo extends CliIo {
    readonly out: string;
    readonly err: string;
}

/** A CliIo that records everything written to it. */
export function captureIo(): CapturedIo {
    let out = "";
    let err = "";
    return {
        stdout: (text) => {
            out += text;
        },
        stderr: (text) => {
            err += text;
        },
        get out() {
            return out;
        },
        get err() {
            return err;
        },
    };
}
