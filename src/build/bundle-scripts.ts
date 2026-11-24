import * as esbuild from "esbuild";
import { type ModuleKind, moduleKindOf } from "../modules/module-catalog.ts";
import { BahError } from "../util/errors.ts";

/** A generated entry module, resolved like a file in `resolveDir`. */
export interface GeneratedEntry {
    contents: string;
    resolveDir: string;
    /** Name shown in error messages. */
    sourcefile: string;
}

export interface BundleScriptsOptions {
    /** Absolute path of the source entry (.js or .ts), or a generated entry. */
    entry: string | GeneratedEntry;
    /** Absolute path of the bundled output file. */
    outfile: string;
    /** Directory used to resolve node_modules (the project root). */
    workingDirectory: string;
    /** Debug builds keep code readable and embed a source map. */
    debug: boolean;
    /** Plugins that run before the engine module handling. */
    plugins?: readonly esbuild.Plugin[];
}

export interface BundleScriptsResult {
    warnings: string[];
}

/** ECMAScript version the game's script engine supports. */
export const SCRIPT_TARGET = "es2022";

/**
 * Bundles a pack's scripts into one ES module. Engine modules
 * (@minecraft/server, ...) are provided by the game and stay external;
 * everything else, including @minecraft library modules, is bundled.
 */
export async function bundleScripts(options: BundleScriptsOptions): Promise<BundleScriptsResult> {
    let result: esbuild.BuildResult;
    try {
        result = await esbuild.build({
            ...(typeof options.entry === "string"
                ? { entryPoints: [options.entry] }
                : { stdin: { ...options.entry, loader: "ts" } }),
            outfile: options.outfile,
            absWorkingDir: options.workingDirectory,
            bundle: true,
            format: "esm",
            platform: "neutral",
            mainFields: ["module", "main"],
            target: SCRIPT_TARGET,
            minify: !options.debug,
            sourcemap: options.debug ? "inline" : false,
            plugins: [...(options.plugins ?? []), engineModulesExternal],
            logLevel: "silent",
        });
    } catch (error) {
        if (isBuildFailure(error)) {
            const messages = await esbuild.formatMessages(error.errors, { kind: "error", color: false });
            throw new BahError(`Script build failed:\n${messages.join("").trimEnd()}`, { cause: error });
        }
        throw error;
    }
    const warnings = await esbuild.formatMessages(result.warnings, { kind: "warning", color: false });
    return { warnings: warnings.map((warning) => warning.trimEnd()) };
}

const engineModulesExternal: esbuild.Plugin = {
    name: "bah-engine-modules",
    setup(build) {
        build.onResolve({ filter: /^@minecraft\// }, (args) => {
            return kindOf(packageName(args.path)) === "engine" ? { path: args.path, external: true } : undefined;
        });
    },
};

/** `@minecraft/server/sub/path` -> `@minecraft/server` */
function packageName(path: string): string {
    return path.split("/").slice(0, 2).join("/");
}

function kindOf(name: string): ModuleKind | null {
    try {
        return moduleKindOf(name);
    } catch {
        return null;
    }
}

function isBuildFailure(error: unknown): error is esbuild.BuildFailure {
    return error instanceof Error && "errors" in error && Array.isArray(error.errors);
}
