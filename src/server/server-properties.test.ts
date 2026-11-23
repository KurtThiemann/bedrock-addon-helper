import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseServerProperties, updateServerProperties } from "./server-properties.ts";

describe("updateServerProperties", () => {
    it("updates keys in place, keeps comments and other keys, appends new keys", () => {
        const text = "# comment\nserver-name=Old\ngamemode=survival\nserver-port = 19132\n";

        const result = updateServerProperties(text, {
            "server-port": 40000,
            "server-name": "New",
            "allow-list": false,
        });

        assert.equal(result, "# comment\nserver-name=New\ngamemode=survival\nserver-port=40000\nallow-list=false\n");
    });

    it("handles an empty file and CRLF line endings", () => {
        assert.equal(updateServerProperties("", { a: 1 }), "a=1\n");
        assert.equal(updateServerProperties("a=1\r\nb=2\r\n", { b: 3 }), "a=1\nb=3\n");
    });
});

describe("parseServerProperties", () => {
    it("reads keys and values, ignoring comments", () => {
        assert.deepEqual(parseServerProperties("# x=1\nlevel-name=my world\nempty=\n"), {
            "level-name": "my world",
            empty: "",
        });
    });
});
