import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { BedrockVersionResolver } from "../bedrock/version-resolver.ts";
import { isModuleDependency } from "../pack/manifest.ts";
import type { Pack } from "../pack/pack.ts";
import { addPack } from "../pack/pack-operations.ts";
import { readPackageJson } from "../project/package-json.ts";
import { Project } from "../project/project.ts";
import { fakeNpmFetch } from "../test-support/fake-npm.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { addModule, listModules, type ModuleServices, removeModule, updateModules } from "./module-operations.ts";
import { NpmRegistry } from "./npm-registry.ts";

function services(): ModuleServices {
    const { fetch } = fakeNpmFetch();
    return { registry: new NpmRegistry(fetch), versions: new BedrockVersionResolver(fetch) };
}

async function createProject(t: TestContext, behaviorPacks: string[]): Promise<Project> {
    const root = await createTempDir(t);
    await writeFiles(root, {
        "bah.json": { name: "addon", packs: [] },
        "package.json": { name: "addon", devDependencies: { typescript: "^7.0.0" } },
    });
    const project = await Project.load({ cwd: root });
    for (const name of behaviorPacks) {
        await addPack(project, { name, type: "behavior", scripts: "js", minEngineVersion: async () => [1, 26, 66] });
    }
    await addPack(project, { name: "rp", type: "resource", minEngineVersion: async () => [1, 26, 66] });
    return project;
}

async function manifestModules(pack: Pack): Promise<Record<string, string>> {
    const dependencies = (await pack.readManifest()).dependencies ?? [];
    return Object.fromEntries(dependencies.filter(isModuleDependency).map((dep) => [dep.module_name, dep.version]));
}

describe("addModule", () => {
    it("adds an engine module to the only behavior pack and devDependencies", async (t) => {
        const project = await createProject(t, ["bp"]);

        const result = await addModule(project, services(), { name: "@minecraft/server" });

        assert.equal(result.pack?.name, "bp");
        assert.deepEqual(result.warnings, []);
        assert.deepEqual(await manifestModules(project.getPack("bp")), { "@minecraft/server": "2.11.0" });
        assert.deepEqual((await readPackageJson(project.paths.root)).devDependencies, {
            "@minecraft/server": "2.11.0",
            typescript: "^7.0.0",
        });
    });

    it("requires --pack when there are several behavior packs", async (t) => {
        const project = await createProject(t, ["a", "b"]);

        await assert.rejects(
            addModule(project, services(), { name: "@minecraft/server" }),
            /several behavior packs \(a, b\); choose one with --pack/,
        );
        await assert.rejects(
            addModule(project, services(), { name: "@minecraft/server", pack: "rp" }),
            /resource pack/,
        );
    });

    it("fails without a behavior pack", async (t) => {
        const project = await createProject(t, []);

        await assert.rejects(addModule(project, services(), { name: "@minecraft/server" }), /no behavior pack/);
    });

    it("reuses the project's version for another pack and refuses a different one", async (t) => {
        const project = await createProject(t, ["a", "b"]);
        await addModule(project, services(), { name: "@minecraft/server", version: "2.10.0", pack: "a" });

        const second = await addModule(project, services(), { name: "@minecraft/server", pack: "b" });
        assert.equal(second.module.npmVersion, "2.10.0");
        assert.deepEqual(await manifestModules(project.getPack("b")), { "@minecraft/server": "2.10.0" });

        await assert.rejects(
            addModule(project, services(), { name: "@minecraft/server", version: "2.11.0", pack: "b" }),
            /already used by "a".*bah module update @minecraft\/server 2\.11\.0/,
        );
    });

    it("keeps new betas on the game version of existing betas", async (t) => {
        const project = await createProject(t, ["bp"]);
        await addModule(project, services(), { name: "@minecraft/server", beta: true, gameVersion: "1.26.60" });

        const ui = await addModule(project, services(), { name: "@minecraft/server-ui", beta: true });

        assert.equal(ui.module.npmVersion, "2.4.0-beta.1.26.60-stable");
        assert.deepEqual(await manifestModules(project.getPack("bp")), {
            "@minecraft/server": "2.12.0-beta",
            "@minecraft/server-ui": "2.4.0-beta",
        });
    });

    it("adds library modules to dependencies only", async (t) => {
        const project = await createProject(t, ["a", "b"]);

        const result = await addModule(project, services(), { name: "@minecraft/math", pack: "a" });

        assert.equal(result.pack, null);
        assert.match(result.warnings[0] ?? "", /--pack is ignored/);
        assert.deepEqual((await readPackageJson(project.paths.root)).dependencies, { "@minecraft/math": "2.4.1" });
        assert.deepEqual(await manifestModules(project.getPack("a")), {});
    });

    it("warns when the pack has no scripts", async (t) => {
        const project = await createProject(t, []);
        await addPack(project, { name: "data-only", type: "behavior", minEngineVersion: async () => [1, 26, 66] });

        const result = await addModule(project, services(), { name: "@minecraft/server" });

        assert.match(result.warnings[0] ?? "", /no script entry/);
    });
});

describe("removeModule", () => {
    it("keeps the npm package while another pack still uses it", async (t) => {
        const project = await createProject(t, ["a", "b"]);
        await addModule(project, services(), { name: "@minecraft/server", pack: "a" });
        await addModule(project, services(), { name: "@minecraft/server", pack: "b" });

        const first = await removeModule(project, { name: "@minecraft/server", pack: "a" });
        assert.equal(first.removedFromPackageJson, false);
        assert.deepEqual(await manifestModules(project.getPack("a")), {});
        assert.equal((await project.getPack("a").readManifest()).dependencies, undefined);

        const second = await removeModule(project, { name: "@minecraft/server", pack: "b" });
        assert.equal(second.removedFromPackageJson, true);
        assert.deepEqual((await readPackageJson(project.paths.root)).devDependencies, { typescript: "^7.0.0" });
    });

    it("rejects modules the pack doesn't use", async (t) => {
        const project = await createProject(t, ["bp"]);

        await assert.rejects(removeModule(project, { name: "@minecraft/server" }), /does not use/);
    });

    it("removes library modules from package.json", async (t) => {
        const project = await createProject(t, ["bp"]);
        await addModule(project, services(), { name: "@minecraft/math" });

        await removeModule(project, { name: "@minecraft/math" });

        assert.equal((await readPackageJson(project.paths.root)).dependencies, undefined);
        await assert.rejects(removeModule(project, { name: "@minecraft/math" }), /not installed/);
    });
});

describe("updateModules", () => {
    it("updates stable and beta modules in package.json and every manifest", async (t) => {
        const project = await createProject(t, ["a", "b"]);
        await addModule(project, services(), { name: "@minecraft/server", version: "2.10.0", pack: "a" });
        await addModule(project, services(), { name: "@minecraft/server", pack: "b" });
        await addModule(project, services(), {
            name: "@minecraft/server-ui",
            beta: true,
            gameVersion: "1.26.60",
            pack: "a",
        });

        const updates = await updateModules(project, services(), {});

        assert.deepEqual(
            updates.map(({ name, from, to }) => ({ name, from, to })),
            [
                { name: "@minecraft/server", from: "2.10.0", to: "2.11.0" },
                { name: "@minecraft/server-ui", from: "2.4.0-beta.1.26.60-stable", to: "2.4.0-beta.1.26.66-stable" },
            ],
        );
        assert.deepEqual(await manifestModules(project.getPack("a")), {
            "@minecraft/server": "2.11.0",
            "@minecraft/server-ui": "2.4.0-beta",
        });
        assert.deepEqual(await manifestModules(project.getPack("b")), { "@minecraft/server": "2.11.0" });
        assert.deepEqual(await updateModules(project, services(), {}), []);
    });

    it("switches a module to beta for a preview", async (t) => {
        const project = await createProject(t, ["bp"]);
        await addModule(project, services(), { name: "@minecraft/server" });

        const updates = await updateModules(project, services(), {
            name: "@minecraft/server",
            beta: true,
            gameVersion: "preview",
        });

        assert.equal(updates[0]?.to, "2.13.0-beta.1.26.70-preview.26");
        assert.deepEqual(await manifestModules(project.getPack("bp")), { "@minecraft/server": "2.13.0-beta" });
    });

    it("validates its arguments", async (t) => {
        const project = await createProject(t, ["bp"]);

        await assert.rejects(updateModules(project, services(), { version: "2.11.0" }), /together with a module/);
        await assert.rejects(updateModules(project, services(), { name: "@minecraft/server" }), /not installed/);
    });
});

describe("listModules", () => {
    it("flags beta modules that target different game versions", async (t) => {
        const project = await createProject(t, ["bp"]);
        await addModule(project, services(), { name: "@minecraft/server", beta: true, gameVersion: "1.26.60" });
        await addModule(project, services(), { name: "@minecraft/server-ui", beta: true, gameVersion: "1.26.66" });

        const modules = await listModules(project);

        assert.deepEqual(
            modules.map((entry) => entry.problems.length),
            [1, 1],
        );
        assert.match(modules[0]?.problems[0] ?? "", /beta for game 1\.26\.60, but other beta modules/);
    });

    it("lists modules with their packs and reports mismatches", async (t) => {
        const project = await createProject(t, ["a", "b"]);
        await addModule(project, services(), { name: "@minecraft/server", pack: "a" });
        await addModule(project, services(), { name: "@minecraft/server", pack: "b" });
        await addModule(project, services(), { name: "@minecraft/math" });
        const b = project.getPack("b");
        const manifest = await b.readManifest();
        manifest.dependencies = [{ module_name: "@minecraft/server", version: "2.10.0" }];
        await b.writeManifest(manifest);

        const modules = await listModules(project);

        assert.deepEqual(
            modules.map((entry) => ({ ...entry, packs: Object.fromEntries(entry.packs) })),
            [
                { name: "@minecraft/math", kind: "library", npmVersion: "2.4.1", packs: {}, problems: [] },
                {
                    name: "@minecraft/server",
                    kind: "engine",
                    npmVersion: "2.11.0",
                    packs: { a: "2.11.0", b: "2.10.0" },
                    problems: ['pack "b" uses 2.10.0, package.json has 2.11.0'],
                },
            ],
        );
    });
});
