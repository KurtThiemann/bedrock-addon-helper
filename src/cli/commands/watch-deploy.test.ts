import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { captureIo } from "../../test-support/capture-io.ts";
import { FakeRuntime, fakeServerFetch } from "../../test-support/fake-runtime.ts";
import { createTempDir, writeFiles } from "../../test-support/temp-dir.ts";
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
    await writeFiles(root, { "packs/bp/scripts/main.js": 'console.warn("v1");\n' });
    return { root, runtime, run };
}

describe("CLI: build deploys to servers", () => {
    it("installs into all servers and reloads running ones", async (t) => {
        const { root, run } = await setup(t);
        await run(["server", "create", "running"]);
        await run(["server", "create", "stopped"]);
        await run(["server", "start", "running"]);

        const first = await run(["build"]);
        assert.equal(first.code, 0, first.err);
        assert.match(first.out, /Server "running": installed and restarted\./);
        assert.match(first.out, /Server "stopped": installed \(not running\)\./);

        const second = await run(["build", "--server", "running"]);
        assert.match(second.out, /Server "running": installed and reloaded\./);
        assert.doesNotMatch(second.out, /"stopped"/);

        const deployed = join(root, ".bah/servers/stopped/development_behavior_packs/demo-bp/scripts/main.js");
        assert.match(await readFile(deployed, "utf8"), /v1/);
    });

    it("skips deploying with --no-deploy and rejects unknown servers", async (t) => {
        const { run } = await setup(t);
        await run(["server", "create", "dev"]);

        assert.doesNotMatch((await run(["build", "--no-deploy"])).out, /Server "dev"/);
        const unknown = await run(["build", "--server", "nope"]);
        assert.equal(unknown.code, 1);
        assert.match(unknown.err, /Server "nope" does not exist/);
    });
});

describe("CLI: watch", () => {
    it("rebuilds and redeploys when a script changes, until interrupted", async (t) => {
        const { root, run } = await setup(t);
        await run(["server", "create", "dev"]);
        const controller = new AbortController();

        const watching = run(["watch"], { interrupt: () => controller.signal });
        await waitFor(() => readFile(join(root, "build/packs/bp/scripts/main.js"), "utf8"), /v1/);

        await writeFiles(root, { "packs/bp/scripts/main.js": 'console.warn("v2");\n' });
        const deployed = join(root, ".bah/servers/dev/development_behavior_packs/demo-bp/scripts/main.js");
        await waitFor(() => readFile(deployed, "utf8"), /v2/);

        controller.abort();
        const result = await watching;
        assert.equal(result.code, 0, result.err);
        assert.match(result.out, /Waiting for changes\.\.\./);
        assert.match(result.out, /Stopped watching\./);
    });
});

/** Polls until `read` returns text matching `pattern` (file watchers are asynchronous). */
async function waitFor(read: () => Promise<string>, pattern: RegExp, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        try {
            if (pattern.test(await read())) {
                return;
            }
        } catch {
            // Not written yet.
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${pattern}`);
        }
        await sleep(50);
    }
}
