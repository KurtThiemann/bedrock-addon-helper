import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { exampleServer } from "../test-support/fixtures.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { ServerConfigStore } from "./server-config-store.ts";

describe("ServerConfigStore", () => {
    it("treats missing files as empty", async (t) => {
        const dir = await createTempDir(t);

        const store = await ServerConfigStore.load(dir);

        assert.deepEqual(store.names, []);
    });

    it("merges shared and local config and resolves advertiseHost", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, {
            "servers.json": {
                servers: {
                    a: exampleServer,
                    b: { ...exampleServer, id: "bbbbbbbbbbbb", port: 19140, udpPorts: { start: 19141, end: 19141 } },
                },
            },
            "servers.local.json": {
                advertiseHost: "192.168.1.10",
                servers: { b: { advertiseHost: "10.0.0.5", secrets: { token: "s3cret" } } },
            },
        });

        const store = await ServerConfigStore.load(dir);

        assert.deepEqual(store.names, ["a", "b"]);
        assert.equal(store.get("a").advertiseHost, "192.168.1.10");
        assert.deepEqual(store.get("a").local, {});
        assert.equal(store.get("b").advertiseHost, "10.0.0.5");
        assert.deepEqual(store.get("b").local.secrets, { token: "s3cret" });
    });

    it("sets, removes and saves both files", async (t) => {
        const dir = await createTempDir(t);
        const store = await ServerConfigStore.load(dir);

        store.set("a", exampleServer);
        store.setLocal("a", { secrets: { key: "value" } });
        await store.save();

        const reloaded = await ServerConfigStore.load(dir);
        assert.deepEqual(reloaded.get("a").config, exampleServer);
        assert.deepEqual(reloaded.get("a").local, { secrets: { key: "value" } });

        reloaded.remove("a");
        await reloaded.save();
        assert.deepEqual(JSON.parse(await readFile(join(dir, "servers.json"), "utf8")), { servers: {} });
        assert.deepEqual(JSON.parse(await readFile(join(dir, "servers.local.json"), "utf8")), { servers: {} });
    });

    it("refuses to save conflicting servers", async (t) => {
        const dir = await createTempDir(t);
        const store = await ServerConfigStore.load(dir);

        store.set("a", exampleServer);
        store.set("b", exampleServer);

        await assert.rejects(store.save(), /same id/);
    });

    it("rejects unknown servers", async (t) => {
        const store = await ServerConfigStore.load(await createTempDir(t));

        assert.throws(() => store.get("nope"), /does not exist/);
        assert.throws(() => store.setLocal("nope", {}), /does not exist/);
        assert.throws(() => store.remove("nope"), /does not exist/);
    });
});
