import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureIo } from "../../test-support/capture-io.ts";
import { FakeRuntime, fakeServerFetch } from "../../test-support/fake-runtime.ts";
import { createTempDir } from "../../test-support/temp-dir.ts";
import { runCli } from "../run-cli.ts";

describe("CLI: server commands", () => {
    it("creates, starts, lists, commands and stops servers", async (t) => {
        const root = await createTempDir(t);
        const runtime = new FakeRuntime();
        const fetch = fakeServerFetch(runtime);
        const run = async (...argv: string[]) => {
            const io = captureIo();
            const code = await runCli(argv, {
                io,
                cwd: root,
                env: {},
                fetch,
                containers: runtime,
                interrupt: () => new AbortController().signal,
            });
            return { code, out: io.out, err: io.err };
        };
        await run("init", "--name", "demo");

        const create = await run("server", "create", "dev", "--port", "30000", "--reload", "restart");
        assert.equal(create.code, 0, create.err);
        assert.match(create.out, /Created server "dev" \(Bedrock latest, port 30000, UDP 30001-30004\)/);

        const start = await run("server", "start");
        assert.equal(start.code, 0, start.err);
        assert.match(start.out, /Server "dev" is running Bedrock 1\.26\.66\.1 at .+:30000/);

        const list = await run("server", "list");
        assert.match(list.out, /^dev\s+running\s+1\.26\.66\s+30000\/tcp 30001-30004\/udp\s+\S+:30000\s+0\/10$/m);

        const command = await run("server", "command", "dev", "say", "hi");
        assert.equal(command.code, 0, command.err);
        assert.ok(runtime.calls.some((call) => call.endsWith("send-command say hi")));

        const logs = await run("server", "logs", "dev", "-n", "20");
        assert.equal(logs.code, 0, logs.err);
        assert.ok(runtime.calls.some((call) => call.endsWith("follow=false tail=20")));

        // --game-version (not --version, which commander reserves for the tool's own version).
        const preview = await run("server", "create", "pre", "--game-version", "preview");
        assert.equal(preview.code, 0, preview.err);
        assert.match(preview.out, /Created server "pre" \(Bedrock preview, port 19132, UDP 19133\)/);

        assert.match((await run("server", "stop")).out, /Stopped "dev"/);
        assert.match((await run("server", "stop", "dev")).out, /is not running/);
        assert.match((await run("server", "remove", "dev", "--purge")).out, /and its data/);
    });

    it("explains when there are no servers", async (t) => {
        const root = await createTempDir(t);
        const run = (...argv: string[]) => {
            const io = captureIo();
            return runCli(argv, { io, cwd: root, env: {}, containers: new FakeRuntime() }).then((code) => ({
                code,
                ...io,
            }));
        };
        await run("init");

        assert.match((await run("server", "list")).out, /No servers yet/);
        const start = await run("server", "start");
        assert.equal(start.code, 1);
        assert.match(start.err, /no servers/);
        const unknown = await run("server", "start", "nope");
        assert.match(unknown.err, /Server "nope" does not exist/);
    });
});
