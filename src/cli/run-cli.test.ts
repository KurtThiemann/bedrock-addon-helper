import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureIo } from "../test-support/capture-io.ts";
import { readPackageInfo } from "./package-info.ts";
import { runCli } from "./run-cli.ts";

describe("runCli", () => {
    it("prints the package version with --version", async () => {
        const io = captureIo();
        const { version } = await readPackageInfo();

        const code = await runCli(["--version"], { io });

        assert.equal(code, 0);
        assert.equal(io.out.trim(), version);
    });

    it("prints usage with --help", async () => {
        const io = captureIo();

        const code = await runCli(["--help"], { io });

        assert.equal(code, 0);
        assert.match(io.out, /Usage: bah/);
    });

    it("returns a non-zero exit code for unknown options", async () => {
        const io = captureIo();

        const code = await runCli(["--definitely-not-an-option"], { io });

        assert.notEqual(code, 0);
        assert.match(io.err, /unknown option/);
    });
});
