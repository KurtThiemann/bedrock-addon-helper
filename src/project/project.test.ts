import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { BahError } from "../util/errors.ts";
import { Project } from "./project.ts";
import type { ProjectConfig } from "./project-config.ts";

const config: ProjectConfig = {
    name: "my-addon",
    packs: [
        { name: "bp", type: "behavior", path: "packs/bp", dependencies: ["rp"], scripts: { entry: "scripts/main.ts" } },
        { name: "rp", type: "resource", path: "packs/rp" },
    ],
};

describe("Project.load", () => {
    it("finds bah.json in a parent directory", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, { "bah.json": config, "packs/bp/scripts/.keep": "" });

        const project = await Project.load({ cwd: join(root, "packs/bp/scripts") });

        assert.equal(project.paths.root, root);
        assert.equal(project.name, "my-addon");
    });

    it("uses BAH_PROJECT_ROOT relative to cwd", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "sub/bah.json": config });

        const project = await Project.load({ cwd: dir, env: { BAH_PROJECT_ROOT: "sub" } });

        assert.equal(project.paths.root, join(dir, "sub"));
    });

    it("fails with a hint when there is no project", async (t) => {
        const dir = await createTempDir(t);

        await assert.rejects(Project.load({ cwd: dir }), (error) => {
            assert.ok(error instanceof BahError);
            assert.match(error.message, /bah init/);
            return true;
        });
    });

    it("fails on an invalid bah.json", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "bah.json": { name: "bad name", packs: [] } });

        await assert.rejects(Project.load({ cwd: dir }), /bah\.json/);
    });
});

describe("Project", () => {
    it("resolves paths and pack defaults", () => {
        const project = new Project("/work/addon", config);

        assert.equal(project.paths.stateDir, "/work/addon/.bah");
        assert.equal(project.paths.serversDataDir, "/work/addon/.bah/servers");
        assert.equal(project.paths.artifactsDir, "/work/addon/build/artifacts");

        const bp = project.getPack("bp");
        assert.equal(bp.directory, "/work/addon/packs/bp");
        assert.equal(bp.manifestPath, "/work/addon/packs/bp/manifest.json");
        assert.equal(bp.bundle, true);
        assert.deepEqual(bp.dependencies, ["rp"]);
        assert.deepEqual(bp.scripts, { entry: "scripts/main.ts" });

        const rp = project.getPack("rp");
        assert.deepEqual(rp.dependencies, []);
        assert.equal(rp.scripts, null);
    });

    it("filters packs by type", () => {
        const project = new Project("/p", config);

        assert.deepEqual(
            project.behaviorPacks.map((pack) => pack.name),
            ["bp"],
        );
        assert.deepEqual(
            project.resourcePacks.map((pack) => pack.name),
            ["rp"],
        );
    });

    it("adds a pack and rejects invalid additions", () => {
        const project = new Project("/p", config);

        project.addPack({ name: "extra", type: "resource", path: "packs/extra" });
        assert.equal(project.packs.length, 3);

        assert.throws(() => project.addPack({ name: "extra", type: "resource", path: "x" }), /already exists/);
        assert.throws(() => project.addPack({ name: "other", type: "resource", path: "packs/bp" }), /overlaps/);
        assert.throws(
            () => project.addPack({ name: "other", type: "resource", path: "o", dependencies: ["nope"] }),
            /unknown pack/,
        );
        assert.equal(project.packs.length, 3, "failed additions must not change the config");
    });

    it("updates a pack without mutating the previous config", () => {
        const project = new Project("/p", config);
        const before = project.config;

        project.updatePack("rp", (pack) => ({ ...pack, bundle: false }));

        assert.equal(project.getPack("rp").bundle, false);
        assert.equal(before.packs[1]?.bundle, undefined);
    });

    it("refuses to remove a pack other packs depend on", () => {
        const project = new Project("/p", config);

        assert.throws(() => project.removePack("rp"), /"bp" depend/);
        project.removePack("bp");
        project.removePack("rp");
        assert.equal(project.packs.length, 0);
    });

    it("saves only the fields that were set", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, { "bah.json": config });
        const project = await Project.load({ cwd: root });

        project.addPack({ name: "extra", type: "resource", path: "packs/extra" });
        await project.save();

        const saved = JSON.parse(await readFile(join(root, "bah.json"), "utf8"));
        assert.deepEqual(saved.packs[2], { name: "extra", type: "resource", path: "packs/extra" });
        assert.deepEqual((await Project.load({ cwd: root })).config, project.config);
    });
});
