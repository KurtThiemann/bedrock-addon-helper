import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeFetch } from "../test-support/fake-fetch.ts";
import { fakeNpmFetch } from "../test-support/fake-npm.ts";
import { NpmRegistry } from "./npm-registry.ts";

describe("NpmRegistry", () => {
    it("requests abbreviated metadata with an encoded scoped name and caches it", async () => {
        const headers: string[] = [];
        const npm = fakeNpmFetch();
        const fake = fakeFetch((url) => npm.fetch(url));
        const registry = new NpmRegistry(async (input, init) => {
            headers.push(new Headers(init?.headers).get("accept") ?? "");
            return fake.fetch(input, init);
        });

        const result = await registry.getVersions("@minecraft/math");
        await registry.getVersions("@minecraft/math");

        assert.deepEqual(result.versions, ["2.3.1", "2.4.0", "2.4.1"]);
        assert.equal(result.distTags.latest, "2.4.1");
        assert.deepEqual(fake.calls, ["https://registry.npmjs.org/@minecraft%2Fmath"]);
        assert.deepEqual(headers, ["application/vnd.npm.install-v1+json"]);
    });

    it("uses npm_config_registry", async () => {
        const fake = fakeFetch(() => Response.json({ name: "x", "dist-tags": {}, versions: {} }));
        const registry = NpmRegistry.fromEnv(fake.fetch, { npm_config_registry: "https://npm.example.com/base" });

        await registry.getVersions("@minecraft/server");

        assert.deepEqual(fake.calls, ["https://npm.example.com/base/@minecraft%2Fserver"]);
    });

    it("reports unknown packages and other failures", async () => {
        const missing = new NpmRegistry(fakeFetch(() => new Response("", { status: 404 })).fetch);
        await assert.rejects(missing.getVersions("@minecraft/nope"), /does not exist on npm/);

        const failing = new NpmRegistry(fakeFetch(() => new Response("", { status: 500 })).fetch);
        await assert.rejects(failing.getVersions("@minecraft/server"), /HTTP 500/);

        const garbage = new NpmRegistry(fakeFetch(() => Response.json({ hello: 1 })).fetch);
        await assert.rejects(garbage.getVersions("@minecraft/server"), /Unexpected npm registry response/);
    });
});
