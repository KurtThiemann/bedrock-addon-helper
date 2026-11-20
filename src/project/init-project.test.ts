import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { deriveProjectName, GITIGNORE_ENTRIES, initProject } from "./init-project.ts";

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));

describe("initProject", () => {
    it("creates bah.json, package.json and .gitignore", async (t) => {
        const root = join(await createTempDir(t), "my-addon");

        const result = await initProject({ root });

        assert.equal(result.project.name, "my-addon");
        assert.deepEqual(result.created, ["package.json", "bah.json", ".gitignore"]);
        assert.deepEqual(await readJson(join(root, "bah.json")), { name: "my-addon", packs: [] });
        assert.deepEqual(await readJson(join(root, "package.json")), {
            name: "my-addon",
            version: "1.0.0",
            private: true,
            type: "module",
        });
        assert.equal(await readFile(join(root, ".gitignore"), "utf8"), `${GITIGNORE_ENTRIES.join("\n")}\n`);
    });

    it("keeps an existing package.json and takes the name from it", async (t) => {
        const root = await createTempDir(t);
        const packageJson = { name: "@me/cool-addon", scripts: { x: "y" } };
        await writeFiles(root, { "package.json": packageJson, ".gitignore": "node_modules/\n" });

        const result = await initProject({ root });

        assert.equal(result.project.name, "cool-addon");
        assert.deepEqual(result.created, ["bah.json"]);
        assert.deepEqual(result.updated, [".gitignore"]);
        assert.deepEqual(await readJson(join(root, "package.json")), packageJson);
    });

    it("uses an explicit name", async (t) => {
        const root = await createTempDir(t);

        const result = await initProject({ root, name: "custom" });

        assert.equal(result.project.name, "custom");
    });

    it("rejects an invalid explicit name", async (t) => {
        const root = await createTempDir(t);

        await assert.rejects(initProject({ root, name: "no spaces" }), /Invalid project name/);
    });

    it("refuses to overwrite an existing project", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, { "bah.json": { name: "x", packs: [] } });

        await assert.rejects(initProject({ root }), /already exists/);
    });
});

describe("deriveProjectName", () => {
    const cases: [string, string][] = [
        ["my-addon", "my-addon"],
        ["@scope/my-addon", "my-addon"],
        ["My Addon!", "My-Addon-"],
        ["..hidden", "hidden"],
        ["ääää", "addon"],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} -> ${expected}`, () => assert.equal(deriveProjectName(input), expected));
    }
});
