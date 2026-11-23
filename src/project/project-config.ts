import { posix } from "node:path";
import { z } from "zod";
import { identifierSchema, relativePathSchema } from "../util/schemas.ts";

/** File name of the project config, which also marks the project root. */
export const PROJECT_CONFIG_FILE = "bah.json";
/** Directory for tool state and server config, relative to the project root. */
export const STATE_DIR = ".bah";
/** Build output directory, relative to the project root. */
export const BUILD_DIR = "build";
/** Top-level directories packs can't live in. */
const RESERVED_DIRS: readonly string[] = [BUILD_DIR, STATE_DIR, "node_modules"];

export const packTypeSchema = z.enum(["behavior", "resource"]);
export type PackType = z.infer<typeof packTypeSchema>;

export const scriptsConfigSchema = z.strictObject({
    /** Script entry point relative to the pack directory, e.g. `scripts/main.ts`. */
    entry: relativePathSchema.refine((path) => /\.[jt]s$/.test(path), {
        message: "must be a .js or .ts file",
    }),
});
export type ScriptsConfig = z.infer<typeof scriptsConfigSchema>;

/**
 * One pack in `bah.json`. Optional fields are left out of the file when
 * unset; {@link Pack} resolves their defaults.
 */
export const packConfigSchema = z.strictObject({
    name: identifierSchema,
    type: packTypeSchema,
    /** Pack directory relative to the project root. */
    path: relativePathSchema,
    /** Include the pack in the .mcaddon bundle. Defaults to true. */
    bundle: z.boolean().optional(),
    /** Names of other packs in this project that this pack depends on. */
    dependencies: z.array(identifierSchema).optional(),
    /** Script settings. Only valid for behavior packs. */
    scripts: scriptsConfigSchema.optional(),
});
export type PackConfig = z.infer<typeof packConfigSchema>;

/** The `bah.json` file. */
export const projectConfigSchema = z
    .strictObject({
        $schema: z.string().optional(),
        /** Project name, used for artifact and container names. */
        name: identifierSchema,
        packs: z.array(packConfigSchema),
    })
    .superRefine((config, ctx) => {
        const names = new Set<string>();
        const paths: { path: string; index: number }[] = [];

        config.packs.forEach((pack, index) => {
            if (names.has(pack.name)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["packs", index, "name"],
                    message: `duplicate pack name "${pack.name}"`,
                });
            }
            names.add(pack.name);

            const path = normalizePackPath(pack.path);
            for (const other of paths) {
                if (isSameOrNested(path, other.path)) {
                    ctx.addIssue({
                        code: "custom",
                        path: ["packs", index, "path"],
                        message: `overlaps with the path of pack #${other.index}`,
                    });
                }
            }
            paths.push({ path, index });

            const topLevel = path.split("/")[0] ?? "";
            if (path === "." || RESERVED_DIRS.includes(topLevel)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["packs", index, "path"],
                    message: `must not be the project root or inside ${RESERVED_DIRS.join(", ")}`,
                });
            }

            if (pack.scripts && pack.type !== "behavior") {
                ctx.addIssue({
                    code: "custom",
                    path: ["packs", index, "scripts"],
                    message: "only behavior packs can have scripts",
                });
            }
        });

        config.packs.forEach((pack, index) => {
            pack.dependencies?.forEach((dependency, depIndex) => {
                const path = ["packs", index, "dependencies", depIndex];
                if (dependency === pack.name) {
                    ctx.addIssue({ code: "custom", path, message: "a pack cannot depend on itself" });
                } else if (!names.has(dependency)) {
                    ctx.addIssue({ code: "custom", path, message: `unknown pack "${dependency}"` });
                }
            });
        });
    });
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

function normalizePackPath(path: string): string {
    return posix.normalize(path).replace(/\/+$/, "");
}

function isSameOrNested(a: string, b: string): boolean {
    return a === b || a === "." || b === "." || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
