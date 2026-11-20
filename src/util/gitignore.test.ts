import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { ensureGitignoreEntries } from "./gitignore.ts";

describe("ensureGitignoreEntries", () => {
    it("creates the file", async (t) => {
        const dir = await createTempDir(t);
        const path = join(dir, ".gitignore");

        assert.deepEqual(await ensureGitignoreEntries(path, ["a/", "b"]), ["a/", "b"]);
        assert.equal(await readFile(path, "utf8"), "a/\nb\n");
    });

    it("appends only missing entries and handles a missing final newline", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { ".gitignore": "# mine\na/" });
        const path = join(dir, ".gitignore");

        assert.deepEqual(await ensureGitignoreEntries(path, ["a/", "b"]), ["b"]);
        assert.equal(await readFile(path, "utf8"), "# mine\na/\nb\n");
        assert.deepEqual(await ensureGitignoreEntries(path, ["a/", "b"]), []);
    });
});
