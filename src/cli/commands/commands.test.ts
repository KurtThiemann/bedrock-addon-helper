import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { captureIo } from "../../test-support/capture-io.ts";
import { fakeDownloadLinksFetch } from "../../test-support/fake-fetch.ts";
import { createTempDir } from "../../test-support/temp-dir.ts";
import { runCli } from "../run-cli.ts";

/** Runs the CLI in `cwd` with a fake network and captured output. */
async function run(cwd: string, ...argv: string[]) {
    const io = captureIo();
    const fake = fakeDownloadLinksFetch("1.26.66.1", "1.26.70.26");
    const code = await runCli(argv, { io, cwd, env: {}, fetch: fake.fetch });
    return { code, out: io.out, err: io.err, fetches: fake.calls.length };
}

describe("CLI: init and pack commands", () => {
    it("initializes a project and manages packs end to end", async (t) => {
        const dir = await createTempDir(t);

        const init = await run(dir, "init", "addon");
        assert.equal(init.code, 0, init.err);
        assert.match(init.out, /Initialized project "addon"/);
        const root = join(dir, "addon");

        const bp = await run(root, "pack", "add", "behavior", "main", "--scripts", "ts");
        assert.equal(bp.code, 0, bp.err);
        assert.equal(bp.fetches, 1);
        const manifest = JSON.parse(await readFile(join(root, "packs/main/manifest.json"), "utf8"));
        assert.deepEqual(manifest.header.min_engine_version, [1, 26, 66]);

        const rp = await run(root, "pack", "add", "resource", "res", "--depends-on", "main", "--no-bundle");
        assert.equal(rp.code, 0, rp.err);

        const preview = await run(root, "pack", "add", "resource", "other", "--min-engine-version", "preview");
        assert.equal(preview.code, 0, preview.err);
        const previewManifest = JSON.parse(await readFile(join(root, "packs/other/manifest.json"), "utf8"));
        assert.deepEqual(previewManifest.header.min_engine_version, [1, 26, 70]);

        const link = await run(root, "pack", "link", "main", "res");
        assert.equal(link.code, 0, link.err);

        const list = await run(join(root, "packs/main"), "pack", "list");
        assert.equal(list.code, 0, list.err);
        assert.deepEqual(list.out.trimEnd().split("\n"), [
            "NAME   TYPE      PATH         BUNDLE  SCRIPTS          DEPENDS ON",
            "main   behavior  packs/main   yes     scripts/main.ts  res",
            "res    resource  packs/res    no      -                main",
            "other  resource  packs/other  yes     -                -",
        ]);

        const blocked = await run(root, "pack", "remove", "res");
        assert.equal(blocked.code, 1);
        assert.match(blocked.err, /Error: Cannot remove pack "res"/);

        assert.equal((await run(root, "pack", "remove", "other", "--delete-files")).code, 0);
    });

    it("rejects an invalid pack type", async (t) => {
        const dir = await createTempDir(t);
        await run(dir, "init");

        const result = await run(dir, "pack", "add", "skin", "x");

        assert.notEqual(result.code, 0);
        assert.match(result.err, /Allowed choices are behavior, resource/);
    });

    it("explains how to start when there is no project", async (t) => {
        const dir = await createTempDir(t);

        const result = await run(dir, "pack", "list");

        assert.equal(result.code, 1);
        assert.match(result.err, /bah init/);
        assert.doesNotMatch(result.err, /Unexpected error/);
    });
});
