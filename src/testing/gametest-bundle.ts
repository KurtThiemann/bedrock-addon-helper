import type * as esbuild from "esbuild";
import { DEFAULT_TEST_STRUCTURE } from "./structures.ts";

export const GAMETEST_MODULE = "@minecraft/server-gametest";

/** Tag the wrapper adds to every test; `bah test` runs this tag by default. */
export const TEST_TAG = "bah";

const WRAPPER_NAMESPACE = "bah-gametest";

/**
 * Stands in for `@minecraft/server-gametest` in test builds. Everything is
 * passed through, except that `register`/`registerAsync` first set bah's
 * default structure and tag. A test's own `.structureName()` or `.tag()`
 * calls come later in the chain, so they still apply.
 */
const WRAPPER_SOURCE = `
import * as gametest from ${JSON.stringify(GAMETEST_MODULE)};
export * from ${JSON.stringify(GAMETEST_MODULE)};

function prepare(builder) {
    return builder.structureName(${JSON.stringify(DEFAULT_TEST_STRUCTURE)}).tag(${JSON.stringify(TEST_TAG)});
}

export function register(testClassName, testName, testFunction) {
    return prepare(gametest.register(testClassName, testName, testFunction));
}

export function registerAsync(testClassName, testName, testFunction) {
    return prepare(gametest.registerAsync(testClassName, testName, testFunction));
}
`;

/** Routes imports of `@minecraft/server-gametest` through the wrapper. */
export const gametestWrapperPlugin: esbuild.Plugin = {
    name: "bah-gametest-wrapper",
    setup(build) {
        build.onResolve({ filter: /^@minecraft\/server-gametest$/ }, (args) =>
            args.namespace === WRAPPER_NAMESPACE
                ? { path: args.path, external: true }
                : { path: "wrapper", namespace: WRAPPER_NAMESPACE },
        );
        build.onLoad({ filter: /.*/, namespace: WRAPPER_NAMESPACE }, () => ({
            contents: WRAPPER_SOURCE,
            loader: "js",
        }));
    },
};

/**
 * Entry module of a test build: the pack's own entry first, so tests run
 * against the loaded add-on, then every test file. Paths are relative to
 * the pack directory.
 */
export function testEntrySource(entry: string, testFiles: readonly string[]): string {
    return [entry, ...testFiles].map((path) => `import ${JSON.stringify(`./${path}`)};\n`).join("");
}
