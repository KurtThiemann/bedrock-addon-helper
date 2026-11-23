import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../util/json-file.ts";
import { uuidSchema } from "../util/schemas.ts";

/*
 * Schemas for a pack's manifest.json. Only fields this tool reads or writes
 * are typed; everything else is kept as-is (loose objects), so reading and
 * writing a manifest never drops data.
 */

const versionPart = z.int().min(0);

/** `[major, minor, patch]`, used by format_version 2. */
export const versionTupleSchema = z.tuple([versionPart, versionPart, versionPart]);
export type VersionTuple = z.infer<typeof versionTupleSchema>;

/** A pack or module version: a tuple (format 2) or a semver string (format 3). */
export const packVersionSchema = z.union([versionTupleSchema, z.string().regex(/^\d+\.\d+\.\d+(?:[-+].*)?$/)]);
export type PackVersion = z.infer<typeof packVersionSchema>;

export const manifestHeaderSchema = z.looseObject({
    name: z.string(),
    description: z.string().optional(),
    uuid: uuidSchema,
    version: packVersionSchema,
    min_engine_version: packVersionSchema.optional(),
});
export type ManifestHeader = z.infer<typeof manifestHeaderSchema>;

export const manifestModuleSchema = z.looseObject({
    type: z.string(),
    uuid: uuidSchema,
    version: packVersionSchema,
    description: z.string().optional(),
    /** Script modules only. */
    language: z.string().optional(),
    /** Script modules only: path of the entry file inside the pack. */
    entry: z.string().optional(),
});
export type ManifestModule = z.infer<typeof manifestModuleSchema>;

/** Dependency on a script API module such as `@minecraft/server`. */
export const moduleDependencySchema = z.looseObject({
    module_name: z.string(),
    /** e.g. `1.16.0` or `2.1.0-beta`. */
    version: z.string(),
});
export type ModuleDependency = z.infer<typeof moduleDependencySchema>;

/** Dependency on another pack, by UUID. */
export const packDependencySchema = z.looseObject({
    uuid: uuidSchema,
    version: packVersionSchema,
});
export type PackDependency = z.infer<typeof packDependencySchema>;

export const manifestDependencySchema = z.union([moduleDependencySchema, packDependencySchema]);
export type ManifestDependency = z.infer<typeof manifestDependencySchema>;

export const manifestSchema = z.looseObject({
    format_version: z.union([z.literal(2), z.literal(3)]),
    header: manifestHeaderSchema,
    modules: z.array(manifestModuleSchema),
    dependencies: z.array(manifestDependencySchema).optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;

export function isModuleDependency(dependency: ManifestDependency): dependency is ModuleDependency {
    return "module_name" in dependency;
}

export function isPackDependency(dependency: ManifestDependency): dependency is PackDependency {
    return !isModuleDependency(dependency);
}

export function readManifest(path: string): Promise<Manifest> {
    return readJsonFile(path, manifestSchema);
}

export function writeManifest(path: string, manifest: Manifest): Promise<void> {
    return writeJsonFile(path, manifestSchema, manifest);
}
