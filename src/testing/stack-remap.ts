import { readFile } from "node:fs/promises";
import { SourceMap, type SourceMapPayload } from "node:module";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Rewrites script positions in a message, e.g. `bp-tests.js:34` -> `packs/bp/tests/a.test.ts:12`. */
export type StackRemapper = (text: string) => string;

const INLINE_MAP = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/;

/** The server prints positions as `<file name>:<line>`, without a column. */
const POSITION = /([\w.-]+\.js):(\d+)/g;

interface MappedScript {
    readonly map: SourceMap;
    readonly lines: readonly string[];
    readonly directory: string;
}

/**
 * Creates a remapper for bundled scripts with inline source maps. Paths in
 * the result are relative to `root`. Unknown positions are left as they are.
 */
export async function createStackRemapper(scripts: readonly string[], root: string): Promise<StackRemapper> {
    const mapped = new Map<string, MappedScript>();
    for (const file of scripts) {
        const content = await readFile(file, "utf8");
        const encoded = INLINE_MAP.exec(content)?.[1];
        if (encoded === undefined) {
            continue;
        }
        const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as SourceMapPayload;
        mapped.set(basename(file), {
            map: new SourceMap(payload),
            lines: content.split("\n"),
            directory: dirname(file),
        });
    }

    return (text) =>
        text.replace(POSITION, (match, name: string, line: string) => {
            const script = mapped.get(name);
            const lineIndex = Number(line) - 1;
            const source = script?.lines[lineIndex];
            if (script === undefined || source === undefined) {
                return match;
            }
            // No column is given; use the first code on the line.
            const column = source.length - source.trimStart().length;
            const entry = script.map.findEntry(lineIndex, column);
            if (!("originalSource" in entry) || entry.generatedLine !== lineIndex) {
                return match;
            }
            const original = entry.originalSource.startsWith("file:")
                ? fileURLToPath(entry.originalSource)
                : resolve(script.directory, entry.originalSource);
            return `${relative(root, original)}:${entry.originalLine + 1}`;
        });
}
