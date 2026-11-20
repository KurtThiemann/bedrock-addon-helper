import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { readPackageJson, writePackageJson } from "./package-json.ts";

describe("package.json", () => {
    it("keeps unknown fields when updating dependencies", async (t) => {
        const root = await createTempDir(t);
        const original = { name: "addon", scripts: { build: "bah build" }, devDependencies: { typescript: "^7.0.0" } };
        await writeFiles(root, { "package.json": original });

        const packageJson = await readPackageJson(root);
        packageJson.devDependencies = { ...packageJson.devDependencies, "@minecraft/server": "2.1.0" };
        await writePackageJson(root, packageJson);

        assert.deepEqual(JSON.parse(await readFile(join(root, "package.json"), "utf8")), {
            ...original,
            devDependencies: { typescript: "^7.0.0", "@minecraft/server": "2.1.0" },
        });
    });

    it("rejects non-string dependency versions", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, { "package.json": { dependencies: { x: 1 } } });

        await assert.rejects(readPackageJson(root), /dependencies/);
    });
});
