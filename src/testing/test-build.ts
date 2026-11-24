import { buildTestPack, type TestPackBuildResult } from "../build/build-pack.ts";
import { type BuildServices, typecheck, usesTypeScript } from "../build/build-project.ts";
import { manifestVersionOf, parseModuleVersion } from "../modules/module-version.ts";
import { readPackageJson } from "../project/package-json.ts";
import type { Project } from "../project/project.ts";
import { BahError } from "../util/errors.ts";
import { GAMETEST_MODULE } from "./gametest-bundle.ts";
import { findTestFiles } from "./test-files.ts";

export interface TestBuildResult {
    /** Every pack of the project, built for the test server. */
    readonly packs: readonly TestPackBuildResult[];
    /** Number of test files across all packs. */
    readonly testFileCount: number;
    /** npm version of the installed @minecraft/server-gametest types. */
    readonly gametestNpmVersion: string;
}

/** Builds all packs of the project into `build/test/`, with the tests of the packs that have some. */
export async function buildTests(
    project: Project,
    options: { typecheck?: boolean | undefined },
    services: BuildServices,
): Promise<TestBuildResult> {
    const packs = project.packs;
    const testFiles = new Map(
        await Promise.all(packs.map(async (pack) => [pack.name, await findTestFiles(pack)] as const)),
    );
    const testFileCount = [...testFiles.values()].reduce((sum, files) => sum + files.length, 0);
    if (testFileCount === 0) {
        throw new BahError(
            'No tests found. Tests are *.test.ts or *.test.js files in the "tests" directory of a behavior pack; "bah test init" creates an example.',
        );
    }
    const gametest = await installedGametest(project);

    if (options.typecheck && packs.some(usesTypeScript)) {
        await typecheck(project, services);
    }

    services.logger.info(`Building ${packs.length === 1 ? "1 pack" : `${packs.length} packs`} for testing...`);
    // allSettled: never return while another pack is still writing files.
    const settled = await Promise.allSettled(
        packs.map((pack) =>
            buildTestPack(project, pack, {
                testFiles: testFiles.get(pack.name) ?? [],
                gametestVersion: gametest.manifestVersion,
            }),
        ),
    );
    const results: TestPackBuildResult[] = [];
    for (const outcome of settled) {
        if (outcome.status === "rejected") {
            throw outcome.reason;
        }
        results.push(outcome.value);
    }
    for (const result of results) {
        for (const warning of result.warnings) {
            services.logger.warn(`${result.pack.name}: ${warning}`);
        }
    }
    return { packs: results, testFileCount, gametestNpmVersion: gametest.npmVersion };
}

/** Version of the @minecraft/server-gametest types installed in the project. */
async function installedGametest(project: Project): Promise<{ npmVersion: string; manifestVersion: string }> {
    const packageJson = await readPackageJson(project.paths.root);
    const npmVersion = packageJson.devDependencies?.[GAMETEST_MODULE] ?? packageJson.dependencies?.[GAMETEST_MODULE];
    if (npmVersion === undefined) {
        throw new BahError(`Tests need ${GAMETEST_MODULE} in package.json. Install it with "bah test init".`);
    }
    const manifestVersion = manifestVersionOf(parseModuleVersion(npmVersion));
    if (manifestVersion === null) {
        throw new BahError(
            `package.json has ${GAMETEST_MODULE}@${npmVersion}, which is not an exact beta version. Fix it with "bah module update ${GAMETEST_MODULE}".`,
        );
    }
    return { npmVersion, manifestVersion };
}
