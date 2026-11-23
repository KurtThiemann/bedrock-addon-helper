import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareBedrockVersions, formatBedrockVersion, parseBedrockVersion, toEngineVersion } from "./version.ts";

describe("Bedrock versions", () => {
    it("parses three- and four-part versions", () => {
        assert.deepEqual(parseBedrockVersion("1.26.70"), [1, 26, 70]);
        assert.deepEqual(parseBedrockVersion("1.26.70.26"), [1, 26, 70, 26]);
        assert.equal(formatBedrockVersion([1, 26, 70, 26]), "1.26.70.26");
    });

    for (const invalid of ["1.26", "1.26.70.1.2", "v1.26.70", "latest", ""]) {
        it(`rejects ${JSON.stringify(invalid)}`, () => {
            assert.throws(() => parseBedrockVersion(invalid), /Invalid Bedrock version/);
        });
    }

    it("compares numerically, treating missing parts as 0", () => {
        assert.equal(compareBedrockVersions([1, 26, 70], [1, 26, 70, 0]), 0);
        assert.equal(compareBedrockVersions([1, 26, 70, 26], [1, 26, 70]), 1);
        assert.equal(compareBedrockVersions([1, 26, 9], [1, 26, 10]), -1);
        assert.equal(compareBedrockVersions([2, 0, 0], [1, 99, 99, 99]), 1);
    });

    it("converts to a min_engine_version tuple", () => {
        assert.deepEqual(toEngineVersion([1, 26, 70, 26]), [1, 26, 70]);
    });
});
