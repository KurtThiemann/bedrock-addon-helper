import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureModuleTypes, type ModuleServices, selectBehaviorPack } from "../modules/module-operations.ts";
import type { ResolvedModule } from "../modules/module-resolver.ts";
import type { Pack } from "../pack/pack.ts";
import type { Project } from "../project/project.ts";
import { BahError } from "../util/errors.ts";
import { GAMETEST_MODULE } from "./gametest-bundle.ts";
import { findTestFiles, TESTS_DIR } from "./test-files.ts";

export interface InitTestsResult {
    readonly pack: Pack;
    readonly module: ResolvedModule;
    /** True if the GameTest types were added to package.json. */
    readonly addedModule: boolean;
    /** The example test, relative to the project; null if the pack already had tests. */
    readonly example: string | null;
}

const EXAMPLE = `import { register } from "@minecraft/server-gametest";

// Every test runs in its own copy of bah's default structure: an 8x8x8 area
// with a stone floor at y=1 (free space starts at y=2). Use
// .structureName("ns:name") to load tests/structures/ns/name.mcstructure
// instead. Run the tests with "bah test".
register("Example", "places_a_block", (test) => {
    test.assertBlockPresent("minecraft:stone", { x: 1, y: 1, z: 1 });
    test.setBlockType("minecraft:gold_block", { x: 1, y: 2, z: 1 });
    test.assertBlockPresent("minecraft:gold_block", { x: 1, y: 2, z: 1 });
    test.succeed();
});
`;

/** Installs the GameTest types and creates an example test in a behavior pack. */
export async function initTests(
    project: Project,
    services: ModuleServices,
    options: { pack?: string | undefined },
): Promise<InitTestsResult> {
    const pack = selectBehaviorPack(project, options.pack);
    if (!pack.scripts) {
        throw new BahError(
            `Pack "${pack.name}" has no script entry. Tests run together with the pack's scripts; add an entry under "scripts" in bah.json.`,
        );
    }
    const { module, added } = await ensureModuleTypes(project, services, GAMETEST_MODULE);

    let example: string | null = null;
    if ((await findTestFiles(pack)).length === 0) {
        const extension = pack.scripts.entry.endsWith(".ts") ? "ts" : "js";
        const directory = join(pack.directory, TESTS_DIR);
        await mkdir(directory, { recursive: true });
        const path = join(directory, `example.test.${extension}`);
        await writeFile(path, EXAMPLE, { flag: "wx" });
        example = path.slice(project.paths.root.length + 1);
    }
    return { pack, module, addedModule: added, example };
}
