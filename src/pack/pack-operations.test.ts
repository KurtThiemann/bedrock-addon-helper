import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Project } from "../project/project.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { pathExists } from "../util/fs.ts";
import { isModuleDependency, isPackDependency, type VersionTuple } from "./manifest.ts";
import { addPack, linkPacks, removePack, unlinkPacks } from "./pack-operations.ts";

const engineVersion = async (): Promise<VersionTuple> => [1, 26, 70];

async function createProject(t: Parameters<typeof createTempDir>[0]): Promise<Project> {
    const root = await createTempDir(t);
    await writeFiles(root, { "bah.json": { name: "addon", packs: [] } });
    return Project.load({ cwd: root });
}

async function reload(project: Project): Promise<Project> {
    return Project.load({ cwd: project.paths.root });
}

describe("addPack", () => {
    it("creates a behavior pack with a TypeScript entry and tsconfig", async (t) => {
        const project = await createProject(t);

        const result = await addPack(project, {
            name: "main",
            type: "behavior",
            description: "Main pack",
            scripts: "ts",
            minEngineVersion: engineVersion,
        });

        assert.equal(result.imported, false);
        assert.deepEqual(result.created, ["packs/main/manifest.json", "packs/main/scripts/main.ts", "tsconfig.json"]);

        const manifest = await result.pack.readManifest();
        assert.equal(manifest.header.name, "main");
        assert.equal(manifest.header.description, "Main pack");
        assert.deepEqual(manifest.header.min_engine_version, [1, 26, 70]);
        assert.deepEqual(
            manifest.modules.map((module) => [module.type, module.entry]),
            [
                ["data", undefined],
                ["script", "scripts/main.js"],
            ],
        );
        assert.match(await readFile(join(result.pack.directory, "scripts/main.ts"), "utf8"), /bah module add/);

        const saved = await reload(project);
        assert.deepEqual(saved.config.packs, [
            { name: "main", type: "behavior", path: "packs/main", scripts: { entry: "scripts/main.ts" } },
        ]);
    });

    it("creates a resource pack linked to an existing pack", async (t) => {
        const project = await createProject(t);
        const bp = await addPack(project, { name: "bp", type: "behavior", minEngineVersion: engineVersion });

        const rp = await addPack(project, {
            name: "rp",
            type: "resource",
            dependencies: ["bp"],
            bundle: false,
            minEngineVersion: engineVersion,
        });

        const bpManifest = await bp.pack.readManifest();
        const rpManifest = await rp.pack.readManifest();
        assert.deepEqual(rpManifest.modules[0]?.type, "resources");
        assert.deepEqual(rpManifest.dependencies, [{ uuid: bpManifest.header.uuid, version: [1, 0, 0] }]);
        assert.equal((await reload(project)).getPack("rp").bundle, false);
        assert.equal(await pathExists(join(project.paths.root, "tsconfig.json")), false);
    });

    it("registers an existing pack without touching it or resolving a version", async (t) => {
        const project = await createProject(t);
        const manifest = {
            format_version: 2,
            header: { name: "old", uuid: "b50ecd55-b1da-4bd5-baa1-b573a3f94301", version: [1, 2, 3] },
            modules: [
                {
                    type: "script",
                    uuid: "60b1d20e-6058-4840-b1d8-c18d41831631",
                    version: [1, 0, 0],
                    entry: "scripts/index.js",
                },
            ],
        };
        await writeFiles(project.paths.root, { "behavior/manifest.json": manifest });
        const original = await readFile(join(project.paths.root, "behavior/manifest.json"), "utf8");

        const result = await addPack(project, {
            name: "old",
            type: "behavior",
            path: "behavior",
            minEngineVersion: () => Promise.reject(new Error("should not be called")),
        });

        assert.equal(result.imported, true);
        assert.deepEqual(result.created, []);
        assert.deepEqual(result.pack.scripts, { entry: "scripts/index.js" });
        assert.equal(await readFile(join(project.paths.root, "behavior/manifest.json"), "utf8"), original);
    });

    it("refuses a non-empty directory without a manifest", async (t) => {
        const project = await createProject(t);
        await writeFiles(project.paths.root, { "packs/x/readme.txt": "hi" });

        await assert.rejects(
            addPack(project, { name: "x", type: "behavior", minEngineVersion: engineVersion }),
            /not empty/,
        );
    });

    it("refuses scripts on a resource pack", async (t) => {
        const project = await createProject(t);

        await assert.rejects(
            addPack(project, { name: "x", type: "resource", scripts: "js", minEngineVersion: engineVersion }),
            /Only behavior packs/,
        );
    });

    it("refuses unknown dependencies before creating files", async (t) => {
        const project = await createProject(t);

        await assert.rejects(
            addPack(project, { name: "x", type: "resource", dependencies: ["nope"], minEngineVersion: engineVersion }),
            /Pack "nope" does not exist/,
        );
        assert.equal(await pathExists(join(project.paths.root, "packs/x")), false);
    });
});

describe("linkPacks / unlinkPacks", () => {
    it("rejects an unknown dependency with a clear message", async (t) => {
        const project = await createProject(t);
        await addPack(project, { name: "bp", type: "behavior", minEngineVersion: engineVersion });

        await assert.rejects(linkPacks(project, "bp", "nope"), /Pack "nope" does not exist in this project/);
        await assert.rejects(linkPacks(project, "bp", "bp"), /cannot depend on itself/);
    });

    it("adds and removes the manifest dependency, keeping unrelated ones", async (t) => {
        const project = await createProject(t);
        const bp = (await addPack(project, { name: "bp", type: "behavior", minEngineVersion: engineVersion })).pack;
        const rp = (await addPack(project, { name: "rp", type: "resource", minEngineVersion: engineVersion })).pack;
        const rpUuid = (await rp.readManifest()).header.uuid;

        const manifest = await bp.readManifest();
        manifest.dependencies = [
            { module_name: "@minecraft/server", version: "2.1.0" },
            { uuid: "00000000-0000-0000-0000-000000000001", version: [1, 0, 0] },
        ];
        await bp.writeManifest(manifest);

        assert.equal(await linkPacks(project, "bp", "rp"), true);
        assert.equal(await linkPacks(project, "bp", "rp"), false);
        let dependencies = (await bp.readManifest()).dependencies ?? [];
        assert.equal(dependencies.length, 3);
        assert.ok(dependencies.some((dep) => isPackDependency(dep) && dep.uuid === rpUuid));
        assert.deepEqual((await reload(project)).getPack("bp").dependencies, ["rp"]);

        assert.equal(await unlinkPacks(project, "bp", "rp"), true);
        assert.equal(await unlinkPacks(project, "bp", "rp"), false);
        dependencies = (await bp.readManifest()).dependencies ?? [];
        assert.equal(dependencies.length, 2);
        assert.ok(dependencies.some(isModuleDependency));
        assert.equal((await reload(project)).config.packs[0]?.dependencies, undefined);
    });

    it("updates the version of an existing dependency entry", async (t) => {
        const project = await createProject(t);
        await addPack(project, { name: "rp", type: "resource", minEngineVersion: engineVersion });
        const bp = (
            await addPack(project, {
                name: "bp",
                type: "behavior",
                dependencies: ["rp"],
                minEngineVersion: engineVersion,
            })
        ).pack;
        const rp = project.getPack("rp");
        const rpManifest = await rp.readManifest();
        rpManifest.header.version = [2, 0, 0];
        await rp.writeManifest(rpManifest);

        await unlinkPacks(project, "bp", "rp");
        await linkPacks(project, "bp", "rp");

        assert.deepEqual((await bp.readManifest()).dependencies, [
            { uuid: rpManifest.header.uuid, version: [2, 0, 0] },
        ]);
    });
});

describe("removePack", () => {
    it("refuses while other packs depend on it", async (t) => {
        const project = await createProject(t);
        await addPack(project, { name: "rp", type: "resource", minEngineVersion: engineVersion });
        await addPack(project, { name: "bp", type: "behavior", dependencies: ["rp"], minEngineVersion: engineVersion });

        await assert.rejects(removePack(project, "rp"), /depend/);
    });

    it("keeps files by default and deletes them on request", async (t) => {
        const project = await createProject(t);
        const a = (await addPack(project, { name: "a", type: "resource", minEngineVersion: engineVersion })).pack;
        const b = (await addPack(project, { name: "b", type: "resource", minEngineVersion: engineVersion })).pack;

        await removePack(project, "a");
        await removePack(project, "b", { deleteFiles: true });

        assert.equal(await pathExists(a.directory), true);
        assert.equal(await pathExists(b.directory), false);
        assert.deepEqual((await reload(project)).packs, []);
    });
});
