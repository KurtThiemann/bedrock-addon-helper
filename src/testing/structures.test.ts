import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nbt } from "../util/nbt.ts";
import { createPlatformStructure, structurePath } from "./structures.ts";

describe("createPlatformStructure", () => {
    it("writes a floor at y=0 and air above it", () => {
        const data = nbt.simplify(nbt.parseUncompressed(createPlatformStructure({ x: 2, y: 3, z: 2 }), "little"));

        assert.equal(data.format_version, 1);
        assert.deepEqual(data.size, [2, 3, 2]);
        const [blocks, waterlogged] = data.structure.block_indices;
        // z fastest, then y, then x: index = x * 6 + y * 2 + z
        assert.deepEqual(blocks, [1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
        assert.ok(waterlogged.every((value: number) => value === -1));
        const palette = data.structure.palette.default.block_palette.map((entry: { name: string }) => entry.name);
        assert.deepEqual(palette, ["minecraft:air", "minecraft:stone"]);
    });
});

describe("structurePath", () => {
    it("maps a structure name to its file in the pack", () => {
        assert.equal(structurePath("bah:default"), "structures/bah/default.mcstructure");
    });
});
