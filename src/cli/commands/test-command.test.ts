import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { captureIo } from "../../test-support/capture-io.ts";
import { FakeRuntime, fakeServerFetch } from "../../test-support/fake-runtime.ts";
import { createTempDir } from "../../test-support/temp-dir.ts";
import type { CliContext } from "../context.ts";
import { runCli } from "../run-cli.ts";

async function setup(t: Parameters<typeof createTempDir>[0]) {
    const root = await createTempDir(t);
    const runtime = new FakeRuntime();
    const fetch = fakeServerFetch(runtime);
    const run = async (argv: string[], overrides: Partial<CliContext> = {}) => {
        const io = captureIo();
        const code = await runCli(argv, {
            io,
            cwd: root,
            env: {},
            fetch,
            containers: runtime,
            interrupt: () => new AbortController().signal,
            ...overrides,
        });
        return { code, out: io.out, err: io.err };
    };
    await run(["init", "--name", "demo"]);
    await run(["pack", "add", "behavior", "bp", "--scripts", "js"]);
    return { root, runtime, run };
}

/** What BDS prints for a run of the "bah" tag with one passing and one failing test. */
const RUN_OUTPUT = [
    "[2026-11-24 13:33:11:180 INFO] Server started.",
    "[2026-11-24 13:33:16:775 INFO] Running 2 tests with tag 'bah'...",
    "onTestPassed: Example:places_a_block",
    "onTestFailed: Example:broken - nope",
];

describe("CLI: test", () => {
    it("init installs the GameTest types and creates an example", async (t) => {
        const { root, run } = await setup(t);

        const result = await run(["test", "init", "--no-install"]);

        assert.equal(result.code, 0, result.err);
        assert.match(result.out, /Added @minecraft\/server-gametest@1\.0\.0-beta\.1\.26\.66-stable/);
        assert.match(result.out, /Created packs\/bp\/tests\/example\.test\.js/);
        const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        assert.ok(packageJson.devDependencies["@minecraft/server-gametest"]);
        // The pack's own manifest doesn't get the module; only test builds do.
        assert.doesNotMatch(await readFile(join(root, "packs/bp/manifest.json"), "utf8"), /gametest/);

        assert.match((await run(["test", "init", "--no-install"])).out, /already has tests/);
    });

    it("creates a test server, runs the tests and exits with 1 on failures", async (t) => {
        const { run, runtime } = await setup(t);
        await run(["test", "init", "--no-install"]);
        await run(["server", "create", "dev"]);
        runtime.output.set("*", RUN_OUTPUT);

        const result = await run(["test"]);

        assert.equal(result.code, 1);
        assert.match(result.out, /Created test server "test"/);
        assert.match(result.out, /PASS {2}Example:places_a_block\nFAIL {2}Example:broken\n {6}nope/);
        assert.match(result.out, /2 test\(s\): 1 passed, 1 failed/);
        assert.match(result.err, /1 test\(s\) failed/);
        const sent = runtime.calls.filter((call) => call.includes("send-command"));
        assert.match(sent.at(-1) ?? "", /send-command gametest runset bah$/);
        // The server is stopped afterwards, and "bah build" leaves it alone.
        assert.ok(runtime.calls.at(-1)?.startsWith("stop "));
        assert.doesNotMatch((await run(["build"])).out, /Server "test"/);
    });

    it("exits with 0 when all tests pass and 2 when it can't run them", async (t) => {
        const { run, runtime } = await setup(t);
        await run(["test", "init", "--no-install"]);
        runtime.output.set("*", [
            "[2026-11-24 13:33:16:775 INFO] Running 1 tests with tag 'bah'...",
            "onTestPassed: Example:places_a_block",
        ]);

        const passed = await run(["test"]);
        assert.equal(passed.code, 0, passed.err);

        const wrongServer = await run(["server", "create", "dev"]).then(() => run(["test", "--server", "dev"]));
        assert.equal(wrongServer.code, 2);
        assert.match(wrongServer.err, /not a test server/);
    });

    it("needs tests", async (t) => {
        const { run } = await setup(t);

        const result = await run(["test"]);

        assert.equal(result.code, 2);
        assert.match(result.err, /No tests found/);
    });
});
