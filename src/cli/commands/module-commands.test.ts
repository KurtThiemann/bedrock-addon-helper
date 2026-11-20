import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureIo } from "../../test-support/capture-io.ts";
import { fakeNpmFetch } from "../../test-support/fake-npm.ts";
import { createTempDir } from "../../test-support/temp-dir.ts";
import type { CommandRunner } from "../../util/command-runner.ts";
import { runCli } from "../run-cli.ts";

function createRunner() {
    const calls: string[] = [];
    const runner: CommandRunner = {
        run: async (command, args, { cwd }) => {
            calls.push(`${cwd}: ${[command, ...args].join(" ")}`);
        },
    };
    return { runner, calls };
}

async function setup(t: Parameters<typeof createTempDir>[0]) {
    const root = await createTempDir(t);
    const { runner, calls } = createRunner();
    const { fetch } = fakeNpmFetch();
    const run = async (...argv: string[]) => {
        const io = captureIo();
        const code = await runCli(argv, { io, cwd: root, env: {}, fetch, runner });
        return { code, out: io.out, err: io.err };
    };
    assert.equal((await run("init")).code, 0);
    return { root, run, calls };
}

describe("CLI: module commands", () => {
    it("adds, lists, updates and removes modules, running npm install", async (t) => {
        const { root, run, calls } = await setup(t);
        await run("pack", "add", "behavior", "bp", "--scripts", "ts");

        const add = await run("module", "add", "@minecraft/server", "2.10");
        assert.equal(add.code, 0, add.err);
        assert.match(add.out, /Added @minecraft\/server@2\.10\.0 to pack "bp" \(manifest version 2\.10\.0\)/);
        assert.deepEqual(calls, [`${root}: npm install`]);

        const beta = await run("module", "add", "@minecraft/server-gametest", "--no-install");
        assert.equal(beta.code, 0, beta.err);
        assert.match(beta.out, /no stable release; using the beta/);
        assert.match(beta.out, /Skipped npm install/);
        assert.equal(calls.length, 1);

        const list = await run("module", "list");
        assert.equal(list.code, 0, list.err);
        assert.deepEqual(list.out.trimEnd().split("\n"), [
            "MODULE                      KIND    NPM VERSION                PACKS",
            "@minecraft/server           engine  2.10.0                     bp (2.10.0)",
            "@minecraft/server-gametest  engine  1.0.0-beta.1.26.66-stable  bp (1.0.0-beta)",
        ]);

        const update = await run("module", "update", "--no-install");
        assert.equal(update.code, 0, update.err);
        assert.match(update.out, /Updated @minecraft\/server: 2\.10\.0 -> 2\.11\.0/);

        const remove = await run("module", "remove", "@minecraft/server");
        assert.equal(remove.code, 0, remove.err);
        assert.match(remove.out, /Removed @minecraft\/server from package\.json/);
        assert.equal(calls.length, 2);
    });

    it("asks for --pack when there are several behavior packs", async (t) => {
        const { run } = await setup(t);
        await run("pack", "add", "behavior", "a");
        await run("pack", "add", "behavior", "b");

        const result = await run("module", "add", "@minecraft/server");

        assert.equal(result.code, 1);
        assert.match(result.err, /choose one with --pack/);
    });

    it("rejects an invalid --game-version", async (t) => {
        const { run } = await setup(t);
        await run("pack", "add", "behavior", "bp");

        const result = await run("module", "add", "@minecraft/server", "--beta", "--game-version", "soon");

        assert.equal(result.code, 1);
        assert.match(result.err, /gameVersion/);
    });

    it("does not run npm install when nothing changed in package.json", async (t) => {
        const { run, calls } = await setup(t);
        await run("pack", "add", "behavior", "bp");
        await run("module", "add", "@minecraft/server", "--no-install");

        const result = await run("module", "update");

        assert.match(result.out, /All modules are up to date/);
        assert.deepEqual(calls, []);
    });
});
