import { readdir } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import type { Pack } from "../pack/pack.ts";
import { pathExists } from "../util/fs.ts";

/**
 * Directory in a behavior pack with GameTests and their structures. It only
 * goes into test builds, never into the .mcpack or .mcaddon.
 */
export const TESTS_DIR = "tests";

/** Structures used by tests; merged into the pack's `structures/` in test builds. */
export const TEST_STRUCTURES_DIR = `${TESTS_DIR}/structures`;

const TEST_FILE = /\.test\.[jt]s$/;

/** Test files of a pack (`tests/**\/*.test.{js,ts}`), relative to the pack, sorted. */
export async function findTestFiles(pack: Pack): Promise<string[]> {
    if (pack.type !== "behavior") {
        return [];
    }
    const directory = join(pack.directory, TESTS_DIR);
    if (!(await pathExists(directory))) {
        return [];
    }
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && TEST_FILE.test(entry.name))
        .map((entry) =>
            join(entry.parentPath, entry.name)
                .slice(pack.directory.length + 1)
                .split(sep)
                .join(posix.sep),
        )
        .filter((path) => !path.startsWith(`${TEST_STRUCTURES_DIR}/`))
        .sort();
}
