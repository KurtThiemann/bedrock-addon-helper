import { createRequire } from "node:module";
import type * as Nbt from "prismarine-nbt";

// prismarine-nbt is CommonJS; load it the way its typings describe it.
export const nbt = createRequire(import.meta.url)("prismarine-nbt") as typeof Nbt;
export type { Nbt };
