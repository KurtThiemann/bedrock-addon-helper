import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bundleScripts } from "../build/bundle-scripts.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { createStackRemapper } from "./stack-remap.ts";

describe("createStackRemapper", () => {
    it("maps bundle lines back to the source files", async (t) => {
        const root = await createTempDir(t);
        await writeFiles(root, {
            "packs/bp/scripts/util.ts": 'export function fail(): never {\n    throw new Error("boom");\n}\n',
            "packs/bp/tests/a.test.ts": 'import { fail } from "../scripts/util.ts";\n\n\nfail();\n',
        });
        const outfile = join(root, "build/test/packs/bp/scripts/bp-tests.js");
        await bundleScripts({
            entry: join(root, "packs/bp/tests/a.test.ts"),
            outfile,
            workingDirectory: root,
            debug: true,
        });
        const bundle = (await readFile(outfile, "utf8")).split("\n");
        const throwLine = bundle.findIndex((line) => line.includes("throw")) + 1;
        const callLine = bundle.findIndex((line) => line.trim() === "fail();") + 1;

        const remap = await createStackRemapper([outfile], root);

        assert.equal(
            remap(`Error: boom    at fail (bp-tests.js:${throwLine})\n    at <anonymous> (bp-tests.js:${callLine})`),
            "Error: boom    at fail (packs/bp/scripts/util.ts:2)\n    at <anonymous> (packs/bp/tests/a.test.ts:4)",
        );
        assert.equal(remap("at x (other.js:3) and bp-tests.js:9999"), "at x (other.js:3) and bp-tests.js:9999");
    });
});
