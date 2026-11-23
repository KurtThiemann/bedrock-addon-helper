import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { JsonFileError, readJsonFile, readJsonFileOrDefault, writeJsonFile } from "./json-file.ts";

const schema = z.strictObject({ name: z.string(), count: z.int() });

describe("readJsonFile", () => {
    it("returns validated data", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "a.json": { name: "x", count: 2 } });

        assert.deepEqual(await readJsonFile(join(dir, "a.json"), schema), { name: "x", count: 2 });
    });

    it("reports the file path and the invalid field", async (t) => {
        const dir = await createTempDir(t);
        const path = join(dir, "a.json");
        await writeFiles(dir, { "a.json": { name: "x", count: "two" } });

        await assert.rejects(readJsonFile(path, schema), (error) => {
            assert.ok(error instanceof JsonFileError);
            assert.equal(error.filePath, path);
            assert.match(error.message, /count/);
            return true;
        });
    });

    it("rejects malformed JSON", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "a.json": "{ nope" });

        await assert.rejects(readJsonFile(join(dir, "a.json"), schema), /invalid JSON/);
    });

    it("rejects a missing file", async (t) => {
        const dir = await createTempDir(t);

        await assert.rejects(readJsonFile(join(dir, "missing.json"), schema), JsonFileError);
    });
});

describe("readJsonFileOrDefault", () => {
    it("returns the fallback for a missing file", async (t) => {
        const dir = await createTempDir(t);

        const value = await readJsonFileOrDefault(join(dir, "missing.json"), schema, { name: "d", count: 0 });

        assert.deepEqual(value, { name: "d", count: 0 });
    });

    it("still validates an existing file", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "a.json": { name: 1 } });

        await assert.rejects(
            readJsonFileOrDefault(join(dir, "a.json"), schema, { name: "d", count: 0 }),
            JsonFileError,
        );
    });
});

describe("key order", () => {
    it("keeps the file's key order through a read/write cycle with a loose schema", async (t) => {
        const dir = await createTempDir(t);
        const path = join(dir, "package.json");
        const loose = z.looseObject({ name: z.string(), nested: z.looseObject({ b: z.number() }).optional() });
        await writeFiles(dir, { "package.json": '{"private":true,"name":"x","nested":{"a":1,"b":2}}' });

        const data = await readJsonFile(path, loose);
        await writeJsonFile(path, loose, { ...data, added: 1 });

        assert.deepEqual(Object.keys(JSON.parse(await readFile(path, "utf8"))), ["private", "name", "nested", "added"]);
        assert.deepEqual(Object.keys(JSON.parse(await readFile(path, "utf8")).nested), ["a", "b"]);
    });
});

describe("writeJsonFile", () => {
    it("writes formatted JSON with a trailing newline and creates directories", async (t) => {
        const dir = await createTempDir(t);
        const path = join(dir, "nested", "a.json");

        await writeJsonFile(path, schema, { name: "x", count: 1 });

        assert.equal(await readFile(path, "utf8"), '{\n  "name": "x",\n  "count": 1\n}\n');
    });

    it("refuses to write invalid data and leaves no temp files", async (t) => {
        const dir = await createTempDir(t);

        await assert.rejects(
            writeJsonFile(join(dir, "a.json"), schema, { name: "x", count: 1.5 }),
            /refusing to write/,
        );
        assert.deepEqual(await readdir(dir), []);
    });
});
