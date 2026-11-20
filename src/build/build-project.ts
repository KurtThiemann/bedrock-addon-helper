import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Pack } from "../pack/pack.ts";
import { TSCONFIG_FILE } from "../pack/pack-operations.ts";
import type { Project } from "../project/project.ts";
import type { CommandRunner } from "../util/command-runner.ts";
import { BahError } from "../util/errors.ts";
import { pathExists } from "../util/fs.ts";
import type { Logger } from "../util/logger.ts";
import { buildPack, type PackBuildResult } from "./build-pack.ts";
import { writeZip } from "./zip.ts";

export interface BuildOptions {
    /** Readable output with inline source maps. */
    readonly debug?: boolean | undefined;
    /** Only build these packs (no .mcaddon is created then). */
    readonly packs?: readonly string[] | undefined;
    /** Absolute path for the .mcaddon. Default: build/artifacts/<project>.mcaddon */
    readonly output?: string | undefined;
    /** Run `tsc --noEmit` first if any built pack uses TypeScript. */
    readonly typecheck?: boolean | undefined;
}

export interface BuildServices {
    readonly logger: Logger;
    readonly runner: CommandRunner;
}

export interface BuildResult {
    readonly packs: readonly PackBuildResult[];
    /** Null for partial builds or when no pack is bundled. */
    readonly mcaddonPath: string | null;
}

export function defaultMcaddonPath(project: Project): string {
    return join(project.paths.artifactsDir, `${project.name}.mcaddon`);
}

export async function buildProject(
    project: Project,
    options: BuildOptions,
    services: BuildServices,
): Promise<BuildResult> {
    const { logger } = services;
    const partial = options.packs !== undefined && options.packs.length > 0;
    if (partial && options.output !== undefined) {
        throw new BahError("An output file can only be given when building all packs.");
    }

    const packs = partial ? (options.packs ?? []).map((name) => project.getPack(name)) : project.packs;
    if (packs.length === 0) {
        throw new BahError('This project has no packs to build. Add one with "bah pack add".');
    }

    if (options.typecheck && packs.some(usesTypeScript)) {
        await typecheck(project, services);
    }

    const debug = options.debug ?? false;
    logger.info(`Building ${packs.length === 1 ? "1 pack" : `${packs.length} packs`}${debug ? " (debug)" : ""}...`);
    // allSettled: never return while another pack is still writing files.
    const settled = await Promise.allSettled(packs.map((pack) => buildPack(project, pack, { debug })));
    const results: PackBuildResult[] = [];
    for (const outcome of settled) {
        if (outcome.status === "rejected") {
            throw outcome.reason;
        }
        results.push(outcome.value);
    }
    for (const result of results) {
        for (const warning of result.warnings) {
            logger.warn(`${result.pack.name}: ${warning}`);
        }
    }

    let mcaddonPath: string | null = null;
    const bundled = results.filter((result) => result.pack.bundle);
    if (!partial && bundled.length > 0) {
        mcaddonPath = options.output ?? defaultMcaddonPath(project);
        const files: Record<string, Uint8Array> = {};
        for (const result of bundled) {
            files[basename(result.mcpackPath)] = await readFile(result.mcpackPath);
        }
        await writeZip(mcaddonPath, files);
    }

    return { packs: results, mcaddonPath };
}

function usesTypeScript(pack: Pack): boolean {
    return pack.scripts?.entry.endsWith(".ts") ?? false;
}

async function typecheck(project: Project, { logger, runner }: BuildServices): Promise<void> {
    if (!(await pathExists(join(project.paths.root, TSCONFIG_FILE)))) {
        throw new BahError(`Type checking needs a ${TSCONFIG_FILE} in the project root.`);
    }
    if (!(await pathExists(join(project.paths.root, "node_modules", "typescript")))) {
        throw new BahError(
            'Type checking needs TypeScript in the project. Install it with "npm install -D typescript".',
        );
    }
    logger.info("Type checking...");
    try {
        await runner.run("npx", ["--no-install", "tsc", "--noEmit", "-p", TSCONFIG_FILE], {
            cwd: project.paths.root,
        });
    } catch (error) {
        throw new BahError("Type checking failed; see the errors above.", { cause: error });
    }
}
