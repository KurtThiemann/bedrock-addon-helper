import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { type Zippable, zip } from "fflate";

/** Fixed timestamp so identical inputs produce identical archives. */
const FIXED_MTIME = new Date("2000-01-01T00:00:00Z");

/** Zips the contents of `directory` (not the directory itself) into `outputPath`. */
export async function zipDirectory(directory: string, outputPath: string): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    for (const path of await listFiles(directory)) {
        files[relative(directory, path).split(sep).join(posix.sep)] = await readFile(path);
    }
    await writeZip(outputPath, files);
}

/** Writes a zip with the given entries (archive path -> content). */
export async function writeZip(outputPath: string, files: Record<string, Uint8Array>): Promise<void> {
    const entries: Zippable = {};
    for (const name of Object.keys(files).sort()) {
        const content = files[name];
        if (content !== undefined) {
            entries[name] = [content, { mtime: FIXED_MTIME }];
        }
    }
    const data = await new Promise<Uint8Array>((resolve, reject) => {
        zip(entries, { level: 9 }, (error, result) => (error ? reject(error) : resolve(result)));
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
}

async function listFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
}
