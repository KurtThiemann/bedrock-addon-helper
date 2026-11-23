import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeFetch } from "../test-support/fake-fetch.ts";
import { queryServer, waitUntilReady } from "./readiness.ts";

const info = {
    name: "Dedicated Server",
    protocol: 2225,
    version: "1.26.66",
    level: "world",
    players: 1,
    maxPlayers: 10,
    gameType: 0,
};

describe("queryServer", () => {
    it("returns the /v1/join status", async () => {
        const fake = fakeFetch(() => Response.json(info));

        assert.deepEqual(await queryServer(fake.fetch, "127.0.0.1", 19132), info);
        assert.deepEqual(fake.calls, ["http://127.0.0.1:19132/v1/join"]);
    });

    it("returns null for errors, non-2xx and unexpected bodies", async () => {
        const refused = fakeFetch(() => {
            throw new TypeError("fetch failed");
        });
        assert.equal(await queryServer(refused.fetch, "127.0.0.1", 1), null);
        assert.equal(await queryServer(fakeFetch(() => new Response("", { status: 404 })).fetch, "h", 1), null);
        assert.equal(await queryServer(fakeFetch(() => Response.json({ hello: 1 })).fetch, "h", 1), null);
    });
});

describe("waitUntilReady", () => {
    it("polls until the server answers", async () => {
        let attempts = 0;
        const fake = fakeFetch(() => (++attempts < 3 ? new Response("", { status: 503 }) : Response.json(info)));

        const result = await waitUntilReady(fake.fetch, {
            host: "127.0.0.1",
            port: 19132,
            timeoutMs: 5000,
            intervalMs: 1,
            isRunning: async () => true,
        });

        assert.deepEqual(result, info);
        assert.equal(attempts, 3);
    });

    it("fails fast when the container stops", async () => {
        const fake = fakeFetch(() => new Response("", { status: 503 }));

        await assert.rejects(
            waitUntilReady(fake.fetch, {
                host: "h",
                port: 1,
                timeoutMs: 5000,
                intervalMs: 1,
                isRunning: async () => false,
            }),
            /stopped while starting/,
        );
    });

    it("gives up after the timeout", async () => {
        const fake = fakeFetch(() => new Response("", { status: 503 }));

        await assert.rejects(
            waitUntilReady(fake.fetch, {
                host: "h",
                port: 1,
                timeoutMs: 20,
                intervalMs: 5,
                isRunning: async () => true,
            }),
            /did not become ready/,
        );
    });
});
