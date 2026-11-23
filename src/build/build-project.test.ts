import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { addPack } from "../pack/pack-operations.ts";
import { Project } from "../project/project.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import type { CommandRunner } from "../util/command-runner.ts";
import { silentLogger } from "../util/logger.ts";
import { type BuildOptions, buildProject } from "./build-project.ts";

const engineVersion = async () => [1, 26, 66] as [number, number, number];

async function readZipNames(path: string): Promise<string[]> {
    return Object.keys(unzipSync(await readFile(path))).sort();
}

async function createProject(t: TestContext): Promise<Project> {
    const root = await createTempDir(t);
    await writeFiles(root, {
        "bah.json": { name: "addon", packs: [] },
        "package.json": { name: "addon", type: "module" },
        // A library module the bundler must inline.
        "node_modules/@minecraft/math/package.json": {
            name: "@minecraft/math",
            version: "2.4.1",
            type: "module",
            module: "lib/index.js",
        },
        "node_modules/@minecraft/math/lib/index.js": "export function add(a, b) { return { x: a.x + b.x }; }\n",
    });
    const project = await Project.load({ cwd: root });
    await addPack(project, { name: "res", type: "resource", minEngineVersion: engineVersion });
    await addPack(project, {
        name: "main",
        type: "behavior",
        scripts: "ts",
        dependencies: ["res"],
        minEngineVersion: engineVersion,
    });
    await writeFiles(join(project.paths.root, "packs/main"), {
        "scripts/main.ts": [
            'import { world } from "@minecraft/server";',
            'import { add } from "@minecraft/math";',
            'import { greeting } from "./greeting.ts";',
            "const position: { x: number } = add({ x: 1 }, { x: 2 });",
            'world.sendMessage(greeting + " " + position.x);',
            "",
        ].join("\n"),
        "scripts/greeting.ts": 'export const greeting: string = "hello";\n',
        "items/sword.json": "{}",
        ".DS_Store": "junk",
    });
    await writeFiles(join(project.paths.root, "packs/res"), { "textures/a.png": "png" });
    return project;
}

function build(project: Project, options: BuildOptions = {}, runner?: CommandRunner) {
    return buildProject(project, options, {
        logger: silentLogger,
        runner: runner ?? { run: () => Promise.reject(new Error("unexpected command")) },
    });
}

describe("buildProject", () => {
    it("builds packs, bundles scripts and creates the .mcaddon", async (t) => {
        const project = await createProject(t);

        const result = await build(project);

        const main = result.packs.find((pack) => pack.pack.name === "main");
        assert.ok(main);
        assert.equal(main.outputDirectory, join(project.paths.buildDir, "packs/main"));

        // Script sources are replaced by one bundled file; other files are copied, junk is not.
        assert.deepEqual((await readdir(main.outputDirectory, { recursive: true })).sort(), [
            "items",
            "items/sword.json",
            "manifest.json",
            "scripts",
            "scripts/main.js",
        ]);
        const script = await readFile(join(main.outputDirectory, "scripts/main.js"), "utf8");
        assert.match(script, /from"@minecraft\/server"|from "@minecraft\/server"/);
        assert.doesNotMatch(script, /@minecraft\/math/);
        assert.match(script, /hello/);
        assert.doesNotMatch(script, /sourceMappingURL/);

        const manifest = JSON.parse(await readFile(join(main.outputDirectory, "manifest.json"), "utf8"));
        const scriptModule = manifest.modules.find((module: { type: string }) => module.type === "script");
        assert.equal(scriptModule.entry, "scripts/main.js");

        assert.equal(main.mcpackPath, join(project.paths.artifactsDir, "addon-main.mcpack"));
        assert.deepEqual(await readZipNames(main.mcpackPath), ["items/sword.json", "manifest.json", "scripts/main.js"]);

        assert.equal(result.mcaddonPath, join(project.paths.artifactsDir, "addon.mcaddon"));
        assert.deepEqual(await readZipNames(result.mcaddonPath ?? ""), ["addon-main.mcpack", "addon-res.mcpack"]);
    });

    it("keeps debug builds readable with an inline source map", async (t) => {
        const project = await createProject(t);

        await build(project, { debug: true });

        const script = await readFile(join(project.paths.buildDir, "packs/main/scripts/main.js"), "utf8");
        assert.match(script, /sourceMappingURL=data:application\/json/);
        assert.match(script, /var greeting = "hello"|const greeting = "hello"/);
    });

    it("syncs pack dependency versions before building", async (t) => {
        const project = await createProject(t);
        const res = project.getPack("res");
        const resManifest = await res.readManifest();
        resManifest.header.version = [1, 2, 0];
        await res.writeManifest(resManifest);

        const result = await build(project);

        const main = result.packs.find((pack) => pack.pack.name === "main");
        const output = JSON.parse(await readFile(join(main?.outputDirectory ?? "", "manifest.json"), "utf8"));
        assert.deepEqual(output.dependencies, [{ uuid: resManifest.header.uuid, version: [1, 2, 0] }]);
        assert.deepEqual((await project.getPack("main").readManifest()).dependencies, output.dependencies);
    });

    it("leaves bundle: false packs out of the .mcaddon", async (t) => {
        const project = await createProject(t);
        project.updatePack("res", (config) => ({ ...config, bundle: false }));

        const result = await build(project);

        assert.equal(result.packs.length, 2);
        assert.deepEqual(await readZipNames(result.mcaddonPath ?? ""), ["addon-main.mcpack"]);
    });

    it("builds selected packs without an .mcaddon, and writes the .mcaddon to --output", async (t) => {
        const project = await createProject(t);

        const partial = await build(project, { packs: ["res"] });
        assert.deepEqual(
            partial.packs.map((pack) => pack.pack.name),
            ["res"],
        );
        assert.equal(partial.mcaddonPath, null);

        await assert.rejects(
            build(project, { packs: ["res"], output: "/x.mcaddon" }),
            /only be given when building all/,
        );
        await assert.rejects(build(project, { packs: ["nope"] }), /does not exist/);

        const output = join(project.paths.root, "dist/release.mcaddon");
        const full = await build(project, { output });
        assert.equal(full.mcaddonPath, output);
        assert.equal((await readZipNames(output)).length, 2);
    });

    it("reports script errors with file and line", async (t) => {
        const project = await createProject(t);
        await writeFiles(join(project.paths.root, "packs/main"), { "scripts/greeting.ts": "export const = ;\n" });

        await assert.rejects(build(project), (error: Error) => {
            assert.match(error.message, /Script build failed/);
            assert.match(error.message, /greeting\.ts:1/);
            return true;
        });
    });

    it("fails if the manifest has no script module", async (t) => {
        const project = await createProject(t);
        const main = project.getPack("main");
        const manifest = await main.readManifest();
        manifest.modules = manifest.modules.filter((module) => module.type !== "script");
        await main.writeManifest(manifest);

        await assert.rejects(build(project), /no "script" module/);
    });

    it("fails without packs", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, { "bah.json": { name: "empty", packs: [] } });

        await assert.rejects(build(await Project.load({ cwd: root })), /no packs to build/);
    });
});

describe("buildProject typecheck", () => {
    it("explains what is missing", async (t) => {
        const project = await createProject(t);

        await assert.rejects(build(project, { typecheck: true }), /needs TypeScript in the project/);
    });

    it("runs tsc and stops the build when it fails", async (t) => {
        const project = await createProject(t);
        await writeFiles(project.paths.root, { "node_modules/typescript/package.json": { name: "typescript" } });
        const calls: string[] = [];
        let fail = false;
        const runner: CommandRunner = {
            run: async (command, args) => {
                calls.push([command, ...args].join(" "));
                if (fail) {
                    throw new Error("tsc exited with code 2");
                }
            },
        };

        await build(project, { typecheck: true }, runner);
        assert.deepEqual(calls, ["npx --no-install tsc --noEmit -p tsconfig.json"]);

        fail = true;
        await assert.rejects(build(project, { typecheck: true }, runner), /Type checking failed/);
    });

    it("skips type checking when no built pack uses TypeScript", async (t) => {
        const project = await createProject(t);

        const result = await build(project, { typecheck: true, packs: ["res"] });

        assert.equal(result.packs.length, 1);
    });
});

describe("pack outputs", () => {
    it("contain valid JSON manifests", async (t) => {
        const project = await createProject(t);
        const result = await build(project);

        for (const pack of result.packs) {
            const entries = unzipSync(await readFile(pack.mcpackPath));
            const manifest = entries["manifest.json"];
            assert.ok(manifest);
            assert.equal(JSON.parse(strFromU8(manifest)).header.uuid, pack.uuid);
        }
    });
});
