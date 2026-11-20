import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { isModuleDependency, isPackDependency, manifestSchema, readManifest, writeManifest } from "./manifest.ts";

const formatTwo = {
    format_version: 2,
    header: {
        name: "test",
        description: "",
        uuid: "b50ecd55-b1da-4bd5-baa1-b573a3f94301",
        version: [1, 0, 0],
        min_engine_version: [1, 21, 92],
    },
    modules: [
        {
            description: "Script resources",
            language: "javascript",
            type: "script",
            uuid: "60b1d20e-6058-4840-b1d8-c18d41831631",
            version: [1, 0, 0],
            entry: "scripts/main.js",
        },
    ],
    dependencies: [
        { uuid: "2fc829c8-371f-432a-bd78-19d311aa2cc1", version: [1, 0, 0] },
        { module_name: "@minecraft/server", version: "2.1.0-beta" },
    ],
    metadata: { authors: ["someone"], generated_with: { bah: ["2.0.0"] } },
    capabilities: ["script_eval"],
};

describe("manifestSchema", () => {
    it("accepts a format 2 manifest", () => {
        assert.ok(manifestSchema.safeParse(formatTwo).success);
    });

    it("accepts semver string versions (format 3)", () => {
        const manifest = {
            ...formatTwo,
            format_version: 3,
            header: { ...formatTwo.header, version: "1.2.3" },
        };
        assert.ok(manifestSchema.safeParse(manifest).success);
    });

    it("rejects an unsupported format version", () => {
        assert.ok(!manifestSchema.safeParse({ ...formatTwo, format_version: 1 }).success);
    });

    it("rejects an invalid header uuid", () => {
        const manifest = { ...formatTwo, header: { ...formatTwo.header, uuid: "nope" } };
        assert.ok(!manifestSchema.safeParse(manifest).success);
    });

    it("tells module and pack dependencies apart", () => {
        const manifest = manifestSchema.parse(formatTwo);
        const [pack, module] = manifest.dependencies ?? [];

        assert.ok(pack && isPackDependency(pack));
        assert.ok(module && isModuleDependency(module));
        assert.equal(module.module_name, "@minecraft/server");
    });
});

describe("readManifest / writeManifest", () => {
    it("round-trips fields the schema doesn't know about", async (t) => {
        const dir = await createTempDir(t);
        await writeFiles(dir, { "manifest.json": formatTwo });
        const path = join(dir, "manifest.json");

        const manifest = await readManifest(path);
        manifest.header.version = [1, 0, 1];
        await writeManifest(path, manifest);

        const saved = JSON.parse(await readFile(path, "utf8"));
        assert.deepEqual(saved, { ...formatTwo, header: { ...formatTwo.header, version: [1, 0, 1] } });
    });
});
