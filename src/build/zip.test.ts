import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { zipDirectory } from "./zip.ts";

export async function readZip(path: string): Promise<Record<string, string>> {
    const entries = unzipSync(await readFile(path));
    return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}

describe("zipDirectory", () => {
    it("stores the directory contents with forward-slash paths", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "src/manifest.json": "{}", "src/a/b/c.txt": "deep" });

        await zipDirectory(join(dir, "src"), join(dir, "out/test.zip"));

        assert.deepEqual(await readZip(join(dir, "out/test.zip")), { "a/b/c.txt": "deep", "manifest.json": "{}" });
    });

    it("produces identical archives for identical input", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "src/x.txt": "x", "src/y.txt": "y" });

        await zipDirectory(join(dir, "src"), join(dir, "1.zip"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        await zipDirectory(join(dir, "src"), join(dir, "2.zip"));

        assert.deepEqual(await readFile(join(dir, "1.zip")), await readFile(join(dir, "2.zip")));
    });
});
