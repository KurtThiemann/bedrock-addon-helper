import { type Nbt, nbt } from "../util/nbt.ts";

/** Structure that bah's GameTest wrapper sets on every test, unless the test picks its own. */
export const DEFAULT_TEST_STRUCTURE = "bah:default";

/**
 * Size of {@link DEFAULT_TEST_STRUCTURE}: a stone floor with air above it.
 * The game places structures one block above the test's origin, so in test
 * coordinates the floor is at y=1 and the free space starts at y=2.
 */
export const DEFAULT_TEST_STRUCTURE_SIZE = { x: 8, y: 8, z: 8 } as const;

/** Path of a structure inside a behavior pack: `ns:name` -> `structures/ns/name.mcstructure`. */
export function structurePath(name: string): string {
    const [namespace, path] = name.split(":");
    return `structures/${namespace}/${path}.mcstructure`;
}

/** Block state version written into palettes; the game upgrades older ones on load. */
const BLOCK_VERSION = 18_168_865;

interface Size {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/**
 * An .mcstructure file (little-endian NBT, no header) with a floor of
 * `floorBlock` at y=0 and air everywhere else.
 */
export function createPlatformStructure(size: Size, floorBlock = "minecraft:stone"): Buffer {
    // Blocks are stored with z changing fastest, then y, then x.
    const blocks: number[] = [];
    for (let x = 0; x < size.x; x++) {
        for (let y = 0; y < size.y; y++) {
            for (let z = 0; z < size.z; z++) {
                blocks.push(y === 0 ? 1 : 0);
            }
        }
    }
    // Second layer: waterlogging, -1 means none.
    const waterlogged = blocks.map(() => -1);

    const int = (value: number): Nbt.Int => ({ type: "int", value });
    const intList = (value: number[]): Nbt.List<Nbt.TagType.Int> => ({ type: "list", value: { type: "int", value } });
    const block = (name: string) => ({
        name: { type: "string", value: name } satisfies Nbt.String,
        states: { type: "compound", value: {} } satisfies Nbt.Compound,
        version: int(BLOCK_VERSION),
    });

    const root: Nbt.NBT = {
        type: "compound",
        name: "",
        value: {
            format_version: int(1),
            size: intList([size.x, size.y, size.z]),
            structure: {
                type: "compound",
                value: {
                    block_indices: {
                        type: "list",
                        value: {
                            type: "list",
                            value: [
                                { type: "int", value: blocks },
                                { type: "int", value: waterlogged },
                            ],
                        },
                    },
                    entities: { type: "list", value: { type: "compound", value: [] } },
                    palette: {
                        type: "compound",
                        value: {
                            default: {
                                type: "compound",
                                value: {
                                    block_palette: {
                                        type: "list",
                                        value: { type: "compound", value: [block("minecraft:air"), block(floorBlock)] },
                                    },
                                    block_position_data: { type: "compound", value: {} },
                                },
                            },
                        },
                    },
                },
            },
            structure_world_origin: intList([0, 0, 0]),
        },
    };
    return nbt.writeUncompressed(root, "little");
}
