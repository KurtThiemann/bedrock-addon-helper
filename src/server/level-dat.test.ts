import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import type * as Nbt from "prismarine-nbt";
import { createTempDir } from "../test-support/temp-dir.ts";
import { readExperiments, readLevelDat, setExperiments, writeLevelDat } from "./level-dat.ts";

const nbt = createRequire(import.meta.url)("prismarine-nbt") as typeof Nbt;

async function createLevelDat(dir: string, experiments: Nbt.Compound["value"]): Promise<string> {
    const path = join(dir, "level.dat");
    await writeLevelDat(path, 10, {
        type: "compound",
        name: "",
        value: {
            LevelName: nbt.string("world"),
            RandomSeed: { type: "long", value: [0, 42] },
            experiments: nbt.comp(experiments),
        },
    });
    return path;
}

describe("level.dat", () => {
    it("writes the Bedrock header (version and length)", async (t) => {
        const path = await createLevelDat(await createTempDir(t), {});

        const content = await readFile(path);

        assert.equal(content.readUInt32LE(0), 10);
        assert.equal(content.readUInt32LE(4), content.length - 8);
    });

    it("enables experiments (with aliases) and keeps other data", async (t) => {
        const path = await createLevelDat(await createTempDir(t), {
            experiments_ever_used: nbt.byte(0),
            saved_with_toggled_experiments: nbt.byte(0),
        });

        assert.equal(await setExperiments(path, ["beta-apis", "custom_components_v2"]), true);

        assert.deepEqual(await readExperiments(path), ["custom_components_v2", "gametest"]);
        const { version, root } = await readLevelDat(path);
        assert.equal(version, 10);
        assert.deepEqual(root.value.LevelName, nbt.string("world"));
        const seed = root.value.RandomSeed;
        assert.ok(seed?.type === "long");
        assert.deepEqual([...seed.value], [0, 42]);
        const experiments = root.value.experiments;
        assert.ok(experiments?.type === "compound");
        assert.deepEqual(experiments.value.experiments_ever_used, nbt.byte(1));
    });

    it("does nothing if the experiments already match", async (t) => {
        const path = await createLevelDat(await createTempDir(t), { gametest: nbt.byte(1) });

        assert.equal(await setExperiments(path, ["gametest"]), false);
    });

    it("turns experiments off but keeps the game's bookkeeping flags", async (t) => {
        const path = await createLevelDat(await createTempDir(t), {
            gametest: nbt.byte(1),
            experiments_ever_used: nbt.byte(1),
        });

        await setExperiments(path, []);

        assert.deepEqual(await readExperiments(path), []);
        const experiments = (await readLevelDat(path)).root.value.experiments;
        assert.ok(experiments?.type === "compound");
        assert.deepEqual(experiments.value.experiments_ever_used, nbt.byte(1));
        assert.deepEqual(experiments.value.saved_with_toggled_experiments, nbt.byte(0));
    });

    it("rejects files that are too short", async (t) => {
        const dir = await createTempDir(t);
        const path = join(dir, "level.dat");
        await import("node:fs/promises").then((fs) => fs.writeFile(path, Buffer.alloc(4)));

        await assert.rejects(readLevelDat(path), /not a valid level\.dat/);
    });
});
