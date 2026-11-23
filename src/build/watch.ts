import { basename, join, resolve } from "node:path";
import { watch as chokidarWatch } from "chokidar";
import { PACKAGE_JSON_FILE } from "../project/package-json.ts";
import type { Project } from "../project/project.ts";
import { BahError } from "../util/errors.ts";
import type { Logger } from "../util/logger.ts";

export interface FileWatcher {
    close(): Promise<void>;
}

/** Starts watching paths (files or directories, recursively). */
export type WatchFiles = (paths: readonly string[], onChange: (path: string) => void) => FileWatcher;

export const watchFiles: WatchFiles = (paths, onChange) => {
    const watcher = chokidarWatch([...paths], {
        ignoreInitial: true,
        // Hidden files (.DS_Store, editor swap files, .git) never affect the build.
        ignored: (path: string) => basename(path).startsWith("."),
    });
    watcher.on("all", (_event, path) => onChange(path));
    return { close: () => watcher.close() };
};

export interface WatchProjectOptions {
    /** Loads (or reloads, after bah.json changed) the project. */
    readonly loadProject: () => Promise<Project>;
    /** Builds and deploys; errors are logged and watching continues. */
    readonly rebuild: (project: Project) => Promise<void>;
    readonly watchFiles: WatchFiles;
    readonly logger: Logger;
    /** Watching stops when this is aborted. */
    readonly signal: AbortSignal;
    /** Quiet time after the last change before rebuilding. */
    readonly debounceMs?: number;
}

/** Files outside the packs that affect the build. */
const PROJECT_FILES = ["bah.json", PACKAGE_JSON_FILE, "package-lock.json"];

export function watchedPaths(project: Project): string[] {
    return [
        ...PROJECT_FILES.map((file) => join(project.paths.root, file)),
        ...project.packs.map((pack) => pack.directory),
    ];
}

/**
 * Builds once, then rebuilds whenever project files change, until the
 * signal is aborted. Builds never overlap: changes during a build trigger
 * one more build afterwards.
 */
export async function watchProject(options: WatchProjectOptions): Promise<void> {
    const { logger, signal } = options;
    const debounceMs = options.debounceMs ?? 300;

    let project = await options.loadProject();
    const current: { watcher: FileWatcher | null } = { watcher: null };
    let timer: NodeJS.Timeout | null = null;
    let building: Promise<void> | null = null;
    let pending = false;
    let configChanged = false;

    const startWatching = async () => {
        await current.watcher?.close();
        current.watcher = options.watchFiles(watchedPaths(project), onChange);
    };

    const build = async () => {
        if (configChanged) {
            configChanged = false;
            try {
                project = await options.loadProject();
                await startWatching();
            } catch (error) {
                logger.error(`Not rebuilding: ${messageOf(error)}`);
                return;
            }
        }
        try {
            await options.rebuild(project);
        } catch (error) {
            logger.error(messageOf(error));
        }
    };

    const run = () => {
        if (signal.aborted) {
            return;
        }
        if (building !== null) {
            pending = true;
            return;
        }
        building = build().finally(() => {
            building = null;
            if (pending) {
                pending = false;
                run();
            } else {
                logger.info("Waiting for changes...");
            }
        });
    };

    function onChange(path: string): void {
        if (resolve(path) === project.paths.configFile) {
            configChanged = true;
        }
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            run();
        }, debounceMs);
    }

    await startWatching();
    run();

    await new Promise<void>((resolveAbort) => {
        if (signal.aborted) {
            resolveAbort();
        } else {
            signal.addEventListener("abort", () => resolveAbort(), { once: true });
        }
    });

    if (timer !== null) {
        clearTimeout(timer);
    }
    await current.watcher?.close();
    await building;
}

function messageOf(error: unknown): string {
    if (error instanceof BahError) {
        return error.message;
    }
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
