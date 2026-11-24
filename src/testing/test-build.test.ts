import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { buildProject } from "../build/build-project.ts";
import { readManifest } from "../pack/manifest.ts";
import { addPack } from "../pack/pack-operations.ts";
import { Project } from "../project/project.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { silentLogger } from "../util/logger.ts";
import { buildTests } from "./test-build.ts";

const engineVersion = async () => [1, 26, 66] as [number, number, number];
const services = { logger: silentLogger, runner: { run: () => Promise.reject(new Error("unexpected command")) } };

async function createProject(t: TestContext, packageJson: object = {}): Promise<Project> {
    const root = await createTempDir(t);
    await writeFiles(root, {
        "bah.json": { name: "addon", packs: [] },
        "package.json": {
            name: "addon",
            devDependencies: { "@minecraft/server-gametest": "1.0.0-beta.1.26.66-stable" },
            ...packageJson,
        },
    });
    const project = await Project.load({ cwd: root });
    await addPack(project, { name: "res", type: "resource", minEngineVersion: engineVersion });
    await addPack(project, { name: "bp", type: "behavior", scripts: "ts", minEngineVersion: engineVersion });
    await writeFiles(join(project.paths.root, "packs/bp"), {
        "scripts/main.ts": 'import { world } from "@minecraft/server";\nexport const ready: string = "yes";\n',
        "tests/blocks.test.ts": [
            'import { register } from "@minecraft/server-gametest";',
            'import { ready } from "../scripts/main.ts";',
            'register("Blocks", "ready", (test) => { test.assert(ready === "yes", "loaded"); test.succeed(); });',
            "",
        ].join("\n"),
        "tests/helpers/util.ts": "export const unused = 1;\n",
        "tests/structures/my/cell.mcstructure": "cell",
    });
    return project;
}

describe("buildTests", () => {
    it("bundles the entry and the tests through the wrapper into build/test", async (t) => {
        const project = await createProject(t);

        const result = await buildTests(project, {}, services);

        assert.equal(result.testFileCount, 1);
        const bp = result.packs.find((pack) => pack.pack.name === "bp");
        assert.ok(bp?.testScript);
        assert.equal(bp.outputDirectory, join(project.paths.buildDir, "test/packs/bp"));
        assert.deepEqual((await readdir(bp.outputDirectory, { recursive: true })).sort(), [
            "manifest.json",
            "scripts",
            "scripts/bp-tests.js",
            "structures",
            "structures/bah",
            "structures/bah/default.mcstructure",
            "structures/my",
            "structures/my/cell.mcstructure",
        ]);

        const script = await readFile(bp.testScript, "utf8");
        assert.match(script, /structureName\("bah:default"\)\.tag\("bah"\)/);
        assert.match(script, /from "@minecraft\/server-gametest"/);
        assert.match(script, /"Blocks", "ready"/);
        assert.match(script, /sourceMappingURL=data:/);

        const manifest = await readManifest(join(bp.outputDirectory, "manifest.json"));
        assert.equal(manifest.modules.find((module) => module.type === "script")?.entry, "scripts/bp-tests.js");
        assert.deepEqual(manifest.dependencies?.at(-1), {
            module_name: "@minecraft/server-gametest",
            version: "1.0.0-beta",
        });

        const res = result.packs.find((pack) => pack.pack.name === "res");
        assert.equal(res?.testScript, null);
    });

    it("keeps tests out of the normal build", async (t) => {
        const project = await createProject(t);

        const result = await buildProject(project, {}, services);

        const bp = result.packs.find((pack) => pack.pack.name === "bp");
        assert.ok(bp);
        assert.deepEqual((await readdir(bp.outputDirectory)).sort(), ["manifest.json", "scripts"]);
        const manifest = await readManifest(join(bp.outputDirectory, "manifest.json"));
        assert.ok(!JSON.stringify(manifest).includes("server-gametest"));
    });

    it("needs the gametest types in package.json", async (t) => {
        const project = await createProject(t, { devDependencies: {} });

        await assert.rejects(buildTests(project, {}, services), /bah test init/);
    });

    it("fails when there are no tests", async (t) => {
        const project = await createProject(t);
        const root = project.paths.root;
        await rm(join(root, "packs/bp/tests"), { recursive: true });

        await assert.rejects(buildTests(project, {}, services), /No tests found/);
    });
});
