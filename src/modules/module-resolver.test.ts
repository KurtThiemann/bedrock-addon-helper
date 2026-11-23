import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BedrockVersionResolver } from "../bedrock/version-resolver.ts";
import { fakeNpmFetch } from "../test-support/fake-npm.ts";
import { type GameTarget, gameTargetFromSpec, gameTargetOf, resolveModule } from "./module-resolver.ts";
import { NpmRegistry } from "./npm-registry.ts";

const registry = new NpmRegistry(fakeNpmFetch().fetch);
const release: GameTarget = { version: [1, 26, 66, 1], channel: "stable" };
const noGameTarget = () => Promise.reject(new Error("game target should not be needed"));

describe("resolveModule", () => {
    it("picks the newest stable engine version without asking for a game version", async () => {
        const result = await resolveModule(registry, { name: "@minecraft/server", gameTarget: noGameTarget });

        assert.deepEqual(result, {
            name: "@minecraft/server",
            kind: "engine",
            npmVersion: "2.11.0",
            manifestVersion: "2.11.0",
            note: null,
        });
    });

    it("picks the beta for the target game version", async () => {
        const result = await resolveModule(registry, {
            name: "@minecraft/server",
            beta: true,
            gameTarget: async () => release,
        });

        assert.equal(result.npmVersion, "2.12.0-beta.1.26.66-stable");
        assert.equal(result.manifestVersion, "2.12.0-beta");
        assert.match(result.note ?? "", /1\.26\.66/);
    });

    it("picks preview betas for a preview target", async () => {
        const result = await resolveModule(registry, {
            name: "@minecraft/server",
            beta: true,
            gameTarget: async () => ({ version: [1, 26, 70, 26], channel: "preview" }),
        });

        assert.equal(result.npmVersion, "2.13.0-beta.1.26.70-preview.26");
    });

    it("falls back to beta for modules without a stable release", async () => {
        const result = await resolveModule(registry, {
            name: "@minecraft/server-gametest",
            gameTarget: async () => release,
        });

        assert.equal(result.npmVersion, "1.0.0-beta.1.26.66-stable");
        assert.match(result.note ?? "", /no stable release/);
    });

    it("accepts a beta API version", async () => {
        const result = await resolveModule(registry, {
            name: "@minecraft/server",
            version: "2.11.0-beta",
            gameTarget: async () => release,
        });

        assert.equal(result.npmVersion, "2.11.0-beta.1.26.50-stable");
    });

    it("accepts stable prefixes and exact npm versions", async () => {
        const prefix = await resolveModule(registry, {
            name: "@minecraft/server",
            version: "2.10",
            gameTarget: noGameTarget,
        });
        assert.equal(prefix.npmVersion, "2.10.0");

        const exact = await resolveModule(registry, {
            name: "@minecraft/server",
            version: "2.12.0-beta.1.26.60-stable",
            gameTarget: noGameTarget,
        });
        assert.equal(exact.manifestVersion, "2.12.0-beta");
    });

    it("rejects versions that don't exist or can't go into a manifest", async () => {
        await assert.rejects(
            resolveModule(registry, { name: "@minecraft/server", version: "9", gameTarget: noGameTarget }),
            /no version matching "9"/,
        );
        await assert.rejects(
            resolveModule(registry, {
                name: "@minecraft/server",
                version: "2.12.0-rc.1.26.70-preview.26",
                gameTarget: noGameTarget,
            }),
            /neither a stable nor a beta/,
        );
        await assert.rejects(
            resolveModule(registry, {
                name: "@minecraft/server-ui",
                beta: true,
                gameTarget: async () => ({ version: [1, 26, 40], channel: "stable" }),
            }),
            /no beta for game 1\.26\.40/,
        );
    });

    it("resolves library modules from npm tags", async () => {
        const latest = await resolveModule(registry, { name: "@minecraft/math", gameTarget: noGameTarget });
        assert.deepEqual(latest, {
            name: "@minecraft/math",
            kind: "library",
            npmVersion: "2.4.1",
            manifestVersion: null,
            note: null,
        });

        const pinned = await resolveModule(registry, {
            name: "@minecraft/math",
            version: "2.3",
            gameTarget: noGameTarget,
        });
        assert.equal(pinned.npmVersion, "2.3.1");
    });

    it("rejects packages outside @minecraft", async () => {
        await assert.rejects(resolveModule(registry, { name: "lodash", gameTarget: noGameTarget }), /not a Minecraft/);
    });
});

describe("game targets", () => {
    const versions = new BedrockVersionResolver(fakeNpmFetch().fetch);

    it("resolves specs", async () => {
        assert.deepEqual(await gameTargetFromSpec("latest", versions), release);
        assert.deepEqual(await gameTargetFromSpec("preview", versions), {
            version: [1, 26, 70, 26],
            channel: "preview",
        });
        assert.deepEqual(await gameTargetFromSpec("1.26.60", versions), { version: [1, 26, 60], channel: "stable" });
    });

    it("reads the target of an installed beta", () => {
        assert.deepEqual(gameTargetOf("2.12.0-beta.1.26.60-stable"), { version: [1, 26, 60], channel: "stable" });
        assert.equal(gameTargetOf("2.11.0"), null);
    });
});
