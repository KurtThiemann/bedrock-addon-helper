import { z } from "zod";

/**
 * Names used for packs and servers. They end up in file names, directory
 * names and Docker container names, so keep them conservative.
 */
export const identifierSchema = z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, "must start with a letter or digit and contain only letters, digits, _ and -")
    .max(64);

/** Any 8-4-4-4-12 hex UUID (Minecraft doesn't care about the RFC variant bits). */
export const uuidSchema = z.guid();

export const portSchema = z.int().min(1).max(65535);

/**
 * A relative path inside the project, using forward slashes, that does not
 * escape the project root.
 */
export const relativePathSchema = z
    .string()
    .min(1)
    .refine((path) => !path.startsWith("/") && !/^[a-z]:/i.test(path) && !path.includes("\\"), {
        message: "must be a relative path using forward slashes",
    })
    .refine((path) => !path.split("/").includes(".."), { message: "must not contain '..'" });
