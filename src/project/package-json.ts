import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../util/json-file.ts";

export const PACKAGE_JSON_FILE = "package.json";

const dependencyMapSchema = z.record(z.string(), z.string());

/**
 * The project's package.json. Only the fields this tool touches are typed;
 * everything else is kept as-is.
 */
export const packageJsonSchema = z.looseObject({
    name: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    type: z.string().optional(),
    dependencies: dependencyMapSchema.optional(),
    devDependencies: dependencyMapSchema.optional(),
});
export type PackageJson = z.infer<typeof packageJsonSchema>;

export function packageJsonPath(projectRoot: string): string {
    return join(projectRoot, PACKAGE_JSON_FILE);
}

export function readPackageJson(projectRoot: string): Promise<PackageJson> {
    return readJsonFile(packageJsonPath(projectRoot), packageJsonSchema);
}

export function writePackageJson(projectRoot: string, packageJson: PackageJson): Promise<void> {
    return writeJsonFile(packageJsonPath(projectRoot), packageJsonSchema, packageJson);
}
