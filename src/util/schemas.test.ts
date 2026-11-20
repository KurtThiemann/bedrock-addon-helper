import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identifierSchema, relativePathSchema, uuidSchema } from "./schemas.ts";

describe("identifierSchema", () => {
    for (const valid of ["main", "my-pack", "pack_2", "A1"]) {
        it(`accepts ${valid}`, () => assert.ok(identifierSchema.safeParse(valid).success));
    }
    for (const invalid of ["", "-pack", "my pack", "a/b", "ä", "x".repeat(65)]) {
        it(`rejects ${JSON.stringify(invalid)}`, () => assert.ok(!identifierSchema.safeParse(invalid).success));
    }
});

describe("relativePathSchema", () => {
    for (const valid of ["packs/main", "behavior", "a/b/c/"]) {
        it(`accepts ${valid}`, () => assert.ok(relativePathSchema.safeParse(valid).success));
    }
    for (const invalid of ["", "/abs", "../outside", "a/../../b", "C:/x", "a\\b"]) {
        it(`rejects ${JSON.stringify(invalid)}`, () => assert.ok(!relativePathSchema.safeParse(invalid).success));
    }
});

describe("uuidSchema", () => {
    it("accepts UUIDs regardless of RFC variant", () => {
        assert.ok(uuidSchema.safeParse("b50ecd55-b1da-4bd5-baa1-b573a3f94301").success);
        assert.ok(uuidSchema.safeParse("00000000-0000-0000-0000-000000000000").success);
    });

    it("rejects malformed UUIDs", () => {
        assert.ok(!uuidSchema.safeParse("not-a-uuid").success);
    });
});
