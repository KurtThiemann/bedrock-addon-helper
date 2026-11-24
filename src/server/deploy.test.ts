import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { buildProject } from "../build/build-project.ts";
import { addPack } from "../pack/pack-operations.ts";
import { Project } from "../project/project.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { pathExists } from "../util/fs.ts";
import { silentLogger } from "../util/logger.ts";
import { type DeployablePack, deployPacks, findBuiltPacks } from "./deploy.ts";

const BP_UUID = "11111111-1111-4111-8111-111111111111";
const RP_UUID = "22222222-2222-4222-8222-222222222222";
const FOREIGN_UUID = "99999999-9999-4999-8999-999999999999";

async function setup(t: TestContext) {
    const dir = await createTempDir(t);
    await writeFiles(dir, {
        "build/bp/manifest.json": "{}",
        "build/bp/scripts/main.js": "// v1",
        "build/rp/manifest.json": "{}",
    });
    const bp: DeployablePack = {
        name: "bp",
        type: "behavior",
        uuid: BP_UUID,
        version: [1, 0, 0],
        directory: join(dir, "build/bp"),
    };
    const rp: DeployablePack = {
        name: "rp",
        type: "resource",
        uuid: RP_UUID,
        version: [1, 0, 0],
        directory: join(dir, "build/rp"),
    };
    return { data: join(dir, "server"), bp, rp, dir };
}

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));

describe("deployPacks", () => {
    it("copies packs and registers them in the world", async (t) => {
        const { data, bp, rp } = await setup(t);

        const result = await deployPacks(data, "addon", [bp, rp], new Set(["bp", "rp"]));

        assert.deepEqual(result, { installed: ["bp", "rp"], removed: [], packListChanged: true });
        assert.equal(
            await readFile(join(data, "development_behavior_packs/addon-bp/scripts/main.js"), "utf8"),
            "// v1",
        );
        assert.equal(await pathExists(join(data, "development_resource_packs/addon-rp/manifest.json")), true);
        assert.deepEqual(await readJson(join(data, "worlds/world/world_behavior_packs.json")), [
            { pack_id: BP_UUID, version: [1, 0, 0] },
        ]);
        assert.deepEqual(await readJson(join(data, "worlds/world/world_resource_packs.json")), [
            { pack_id: RP_UUID, version: [1, 0, 0] },
        ]);
    });

    it("replaces files on redeploy and reports list changes only when needed", async (t) => {
        const { data, bp, dir } = await setup(t);
        await deployPacks(data, "addon", [bp], new Set(["bp"]));
        await writeFiles(dir, { "build/bp/scripts/main.js": "// v2" });

        const same = await deployPacks(data, "addon", [bp], new Set(["bp"]));
        assert.equal(same.packListChanged, false);
        assert.equal(
            await readFile(join(data, "development_behavior_packs/addon-bp/scripts/main.js"), "utf8"),
            "// v2",
        );

        const bumped = await deployPacks(data, "addon", [{ ...bp, version: [1, 1, 0] }], new Set(["bp"]));
        assert.equal(bumped.packListChanged, true);
        assert.deepEqual(await readJson(join(data, "worlds/world/world_behavior_packs.json")), [
            { pack_id: BP_UUID, version: [1, 1, 0] },
        ]);
    });

    it("removes packs that left the project and keeps packs it didn't deploy", async (t) => {
        const { data, bp, rp } = await setup(t);
        await writeFiles(data, {
            "worlds/world/world_behavior_packs.json": [{ pack_id: FOREIGN_UUID, version: [2, 0, 0] }],
        });
        await deployPacks(data, "addon", [bp, rp], new Set(["bp", "rp"]));

        const result = await deployPacks(data, "addon", [bp], new Set(["bp"]));

        assert.deepEqual(result.removed, ["rp"]);
        assert.equal(result.packListChanged, true);
        assert.equal(await pathExists(join(data, "development_resource_packs/addon-rp")), false);
        assert.deepEqual(await readJson(join(data, "worlds/world/world_resource_packs.json")), []);
        assert.deepEqual(await readJson(join(data, "worlds/world/world_behavior_packs.json")), [
            { pack_id: FOREIGN_UUID, version: [2, 0, 0] },
            { pack_id: BP_UUID, version: [1, 0, 0] },
        ]);
    });

    it("keeps packs that weren't part of a partial deploy", async (t) => {
        const { data, bp, rp } = await setup(t);
        await deployPacks(data, "addon", [bp, rp], new Set(["bp", "rp"]));

        await deployPacks(data, "addon", [bp], new Set(["bp", "rp"]));

        assert.equal(await pathExists(join(data, "development_resource_packs/addon-rp")), true);
        assert.equal((await readJson(join(data, "worlds/world/world_resource_packs.json"))).length, 1);
    });

    it("replaces the world entry when a pack's UUID changes", async (t) => {
        const { data, bp } = await setup(t);
        await deployPacks(data, "addon", [bp], new Set(["bp"]));
        const newUuid = "33333333-3333-4333-8333-333333333333";

        await deployPacks(data, "addon", [{ ...bp, uuid: newUuid }], new Set(["bp"]));

        assert.deepEqual(await readJson(join(data, "worlds/world/world_behavior_packs.json")), [
            { pack_id: newUuid, version: [1, 0, 0] },
        ]);
    });
});

describe("findBuiltPacks", () => {
    it("returns packs with a finished build", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, { "bah.json": { name: "addon", packs: [] } });
        const project = await Project.load({ cwd: root });
        await addPack(project, { name: "rp", type: "resource", minEngineVersion: async () => [1, 26, 66] });
        await addPack(project, { name: "later", type: "resource", minEngineVersion: async () => [1, 26, 66] });
        assert.deepEqual(await findBuiltPacks(project, "release"), []);

        await buildProject(
            project,
            { packs: ["rp"] },
            { logger: silentLogger, runner: { run: () => Promise.resolve() } },
        );

        const built = await findBuiltPacks(project, "release");
        assert.deepEqual(
            built.map((pack) => [pack.name, pack.type]),
            [["rp", "resource"]],
        );
        assert.equal(built[0]?.uuid, (await project.getPack("rp").readManifest()).header.uuid);
    });
});
