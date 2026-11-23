import { readFile, writeFile } from "node:fs/promises";

/**
 * Appends any of `entries` that are missing from the .gitignore at `path`
 * (creating it if needed). Returns the entries that were added.
 */
export async function ensureGitignoreEntries(path: string, entries: readonly string[]): Promise<string[]> {
    let content = "";
    try {
        content = await readFile(path, "utf8");
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
        }
    }

    const existing = new Set(content.split(/\r?\n/).map((line) => line.trim()));
    const missing = entries.filter((entry) => !existing.has(entry));
    if (missing.length === 0) {
        return [];
    }

    const separator = content === "" || content.endsWith("\n") ? "" : "\n";
    await writeFile(path, `${content}${separator}${missing.join("\n")}\n`, "utf8");
    return missing;
}
