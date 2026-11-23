import type { ServerPropertyValue } from "./server-config.ts";

/**
 * Sets values in server.properties text. Existing lines are updated in
 * place, comments and other keys are kept, new keys are appended.
 */
export function updateServerProperties(text: string, values: Readonly<Record<string, ServerPropertyValue>>): string {
    const remaining = new Map(Object.entries(values).map(([key, value]) => [key, String(value)]));
    const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);

    const updated = lines.map((line) => {
        const match = /^\s*([^#=\s][^=]*?)\s*=/.exec(line);
        const key = match?.[1];
        if (key === undefined || !remaining.has(key)) {
            return line;
        }
        const value = remaining.get(key);
        remaining.delete(key);
        return `${key}=${value}`;
    });
    for (const [key, value] of remaining) {
        updated.push(`${key}=${value}`);
    }
    return `${updated.join("\n")}\n`;
}

/** Parses server.properties text into key/value pairs (last one wins). */
export function parseServerProperties(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([^#=\s][^=]*?)\s*=(.*)$/.exec(line);
        if (match?.[1] !== undefined) {
            result[match[1]] = match[2] ?? "";
        }
    }
    return result;
}
