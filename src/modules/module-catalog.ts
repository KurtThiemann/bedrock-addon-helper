import { BahError } from "../util/errors.ts";

/**
 * - engine: provided by the game. Listed in the pack manifest, types-only on
 *   npm (devDependency), kept external when bundling.
 * - library: plain JavaScript published on npm. Bundled into the pack,
 *   installed as a regular dependency, not listed in the manifest.
 */
export type ModuleKind = "engine" | "library";

const LIBRARY_MODULES: ReadonlySet<string> = new Set(["@minecraft/math", "@minecraft/vanilla-data"]);

/** Type packages that npm installs automatically as peer dependencies. */
const PEER_ONLY_MODULES: ReadonlySet<string> = new Set(["@minecraft/common"]);

export function isMinecraftModule(name: string): boolean {
    return name.startsWith("@minecraft/");
}

/** Classifies a module, rejecting names this tool doesn't manage. */
export function moduleKindOf(name: string): ModuleKind {
    if (!/^@minecraft\/[a-z0-9][a-z0-9._-]*$/.test(name)) {
        throw new BahError(`"${name}" is not a Minecraft script module (expected @minecraft/<name>).`);
    }
    if (PEER_ONLY_MODULES.has(name)) {
        throw new BahError(`${name} only contains shared types and is installed automatically.`);
    }
    return LIBRARY_MODULES.has(name) ? "library" : "engine";
}
