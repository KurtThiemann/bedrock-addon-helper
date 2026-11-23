import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Project } from "../project/project.ts";
import type { ProjectConfig } from "../project/project-config.ts";
import { BahError } from "../util/errors.ts";
import type { Logger } from "../util/logger.ts";
import { type WatchFiles, watchProject } from "./watch.ts";

const ROOT = "/work/addon";

function config(packs: string[]): ProjectConfig {
    return { name: "addon", packs: packs.map((name) => ({ name, type: "resource", path: `packs/${name}` })) };
}

function createHarness(options: { buildMs?: number } = {}) {
    const controller = new AbortController();
    let currentConfig = config(["a"]);
    let failLoad = false;
    const builds: string[][] = [];
    const watched: string[][] = [];
    let closed = 0;
    let emit: (path: string) => void = () => {};
    const messages: string[] = [];
    let failNextBuild = false;

    const logger: Logger = {
        info: (message) => messages.push(`info: ${message}`),
        warn: (message) => messages.push(`warn: ${message}`),
        error: (message) => messages.push(`error: ${message}`),
        debug: () => {},
    };
    const watchFiles: WatchFiles = (paths, onChange) => {
        watched.push([...paths]);
        emit = onChange;
        return {
            close: async () => {
                closed++;
            },
        };
    };

    const done = watchProject({
        loadProject: async () => {
            if (failLoad) {
                throw new BahError("bah.json: invalid content");
            }
            return new Project(ROOT, currentConfig);
        },
        rebuild: async (project) => {
            builds.push(project.packs.map((pack) => pack.name));
            await sleep(options.buildMs ?? 0);
            if (failNextBuild) {
                failNextBuild = false;
                throw new BahError("Script build failed: oops");
            }
        },
        watchFiles,
        logger,
        signal: controller.signal,
        debounceMs: 10,
    });

    return {
        builds,
        watched,
        messages,
        done,
        emit: (path: string) => emit(path),
        stop: () => controller.abort(),
        closedCount: () => closed,
        setConfig: (packs: string[]) => {
            currentConfig = config(packs);
        },
        failLoad: (value: boolean) => {
            failLoad = value;
        },
        failNextBuild: () => {
            failNextBuild = true;
        },
    };
}

describe("watchProject", () => {
    it("builds once at start and watches the project files and packs", async () => {
        const harness = createHarness();
        await sleep(20);
        harness.stop();
        await harness.done;

        assert.deepEqual(harness.builds, [["a"]]);
        assert.deepEqual(harness.watched, [
            [
                join(ROOT, "bah.json"),
                join(ROOT, "package.json"),
                join(ROOT, "package-lock.json"),
                join(ROOT, "packs/a"),
            ],
        ]);
        assert.equal(harness.closedCount(), 1);
    });

    it("debounces bursts of changes into one rebuild", async () => {
        const harness = createHarness();
        await sleep(20);

        harness.emit(join(ROOT, "packs/a/x.json"));
        harness.emit(join(ROOT, "packs/a/y.json"));
        harness.emit(join(ROOT, "packs/a/z.json"));
        await sleep(60);
        harness.stop();
        await harness.done;

        assert.equal(harness.builds.length, 2);
    });

    it("never overlaps builds and runs one more after changes during a build", async () => {
        const harness = createHarness({ buildMs: 80 });
        await sleep(5);

        // The initial build is still running; these changes queue a single rebuild.
        harness.emit(join(ROOT, "packs/a/x.json"));
        await sleep(20);
        harness.emit(join(ROOT, "packs/a/y.json"));
        await sleep(250);
        harness.stop();
        await harness.done;

        assert.equal(harness.builds.length, 2);
    });

    it("reloads the project when bah.json changes, and keeps going after errors", async () => {
        const harness = createHarness();
        await sleep(20);

        harness.setConfig(["a", "b"]);
        harness.emit(join(ROOT, "bah.json"));
        await sleep(40);
        assert.deepEqual(harness.builds.at(-1), ["a", "b"]);
        assert.equal(harness.watched.length, 2);
        assert.ok(harness.watched[1]?.includes(join(ROOT, "packs/b")));

        harness.failLoad(true);
        harness.emit(join(ROOT, "bah.json"));
        await sleep(40);
        assert.ok(harness.messages.includes("error: Not rebuilding: bah.json: invalid content"));

        harness.failLoad(false);
        harness.failNextBuild();
        harness.emit(join(ROOT, "bah.json"));
        await sleep(40);
        assert.ok(harness.messages.includes("error: Script build failed: oops"));

        harness.emit(join(ROOT, "packs/a/x.json"));
        await sleep(40);
        harness.stop();
        await harness.done;

        assert.equal(harness.builds.length, 4);
        assert.ok(harness.messages.includes("info: Waiting for changes..."));
    });
});
