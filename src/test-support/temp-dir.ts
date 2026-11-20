import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

/** Creates a temp directory that is deleted after the test. */
export async function createTempDir(t: TestContext): Promise<string> {
    // realpath: on macOS tmpdir() is a symlink, which would break path comparisons.
    const dir = await realpath(await mkdtemp(join(tmpdir(), "bah-test-")));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

/** Writes files (path relative to `root` → content; objects are JSON-encoded). */
export async function writeFiles(root: string, files: Record<string, string | object>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
        const fullPath = join(root, path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
}
