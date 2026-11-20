import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { captureIo } from "../../test-support/capture-io.ts";
import { fakeDownloadLinksFetch } from "../../test-support/fake-fetch.ts";
import { createTempDir, writeFiles } from "../../test-support/temp-dir.ts";
import { pathExists } from "../../util/fs.ts";
import { runCli } from "../run-cli.ts";

describe("CLI: build", () => {
    it("builds the project and lists the artifacts", async (t) => {
        const root = await createTempDir(t);
        const { fetch } = fakeDownloadLinksFetch();
        const run = async (...argv: string[]) => {
            const io = captureIo();
            const code = await runCli(argv, { io, cwd: root, env: {}, fetch });
            return { code, out: io.out, err: io.err };
        };
        await run("init", "--name", "demo");
        await run("pack", "add", "behavior", "bp", "--scripts", "js");
        await run("pack", "add", "resource", "rp");
        await writeFiles(root, { "packs/bp/scripts/main.js": 'console.warn("hi");\n' });

        const result = await run("build", "--output", "dist/demo.mcaddon");

        assert.equal(result.code, 0, result.err);
        assert.match(result.out, /Building 2 packs\.\.\./);
        assert.match(result.out, /build\/artifacts\/demo-bp\.mcpack \(\d+(\.\d)? (B|KiB)\)/);
        assert.match(result.out, /dist\/demo\.mcaddon/);
        assert.match(result.out, /Build finished in \d+ ms/);
        assert.equal(await pathExists(join(root, "dist/demo.mcaddon")), true);
    });
});
