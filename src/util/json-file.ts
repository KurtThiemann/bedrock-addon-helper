import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { BahError } from "./errors.ts";

/** Raised when a JSON file is missing, unparsable or doesn't match its schema. */
export class JsonFileError extends BahError {
    readonly filePath: string;

    constructor(filePath: string, message: string, options?: ErrorOptions) {
        super(`${filePath}: ${message}`, options);
        this.name = "JsonFileError";
        this.filePath = filePath;
    }
}

/** Reads a JSON file and validates it, returning the schema's output type. */
export async function readJsonFile<T extends z.ZodType>(filePath: string, schema: T): Promise<z.output<T>> {
    let text: string;
    try {
        text = await readFile(filePath, "utf8");
    } catch (error) {
        throw new JsonFileError(filePath, "cannot read file", { cause: error });
    }
    return parseJson(filePath, text, schema);
}

/** Like {@link readJsonFile}, but returns `fallback` if the file doesn't exist. */
export async function readJsonFileOrDefault<T extends z.ZodType>(
    filePath: string,
    schema: T,
    fallback: z.output<T>,
): Promise<z.output<T>> {
    let text: string;
    try {
        text = await readFile(filePath, "utf8");
    } catch (error) {
        if (isNotFound(error)) {
            return fallback;
        }
        throw new JsonFileError(filePath, "cannot read file", { cause: error });
    }
    return parseJson(filePath, text, schema);
}

export function parseJson<T extends z.ZodType>(filePath: string, text: string, schema: T): z.output<T> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new JsonFileError(filePath, "invalid JSON", { cause: error });
    }
    const result = schema.safeParse(data);
    if (!result.success) {
        throw new JsonFileError(filePath, `invalid content\n${z.prettifyError(result.error)}`, {
            cause: result.error,
        });
    }
    return result.data;
}

/**
 * Validates `value` against `schema` and writes it as JSON (2-space indent,
 * trailing newline). The write is atomic: a temp file is renamed into place.
 */
export async function writeJsonFile<T extends z.ZodType>(
    filePath: string,
    schema: T,
    value: z.input<T>,
): Promise<void> {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new JsonFileError(filePath, `refusing to write invalid content\n${z.prettifyError(result.error)}`, {
            cause: result.error,
        });
    }

    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tempPath = join(dir, `.${basename(filePath)}.${randomUUID()}.tmp`);
    try {
        await writeFile(tempPath, `${JSON.stringify(result.data, null, 2)}\n`, "utf8");
        await rename(tempPath, filePath);
    } catch (error) {
        await rm(tempPath, { force: true });
        throw new JsonFileError(filePath, "cannot write file", { cause: error });
    }
}

function isNotFound(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
