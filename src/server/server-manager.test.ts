import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { BedrockVersionResolver } from "../bedrock/version-resolver.ts";
import { addModule } from "../modules/module-operations.ts";
import { NpmRegistry } from "../modules/npm-registry.ts";
import { addPack } from "../pack/pack-operations.ts";
import { Project } from "../project/project.ts";
import { FakeRuntime, fakeServerFetch } from "../test-support/fake-runtime.ts";
import { createTempDir, writeFiles } from "../test-support/temp-dir.ts";
import { pathExists } from "../util/fs.ts";
import { silentLogger } from "../util/logger.ts";
import { readExperiments } from "./level-dat.ts";
import { ServerConfigStore } from "./server-config-store.ts";
import { ServerManager } from "./server-manager.ts";

interface Setup {
    project: Project;
    runtime: FakeRuntime;
    manager: ServerManager;
    busyPorts: Set<string>;
}

async function setup(t: TestContext): Promise<Setup> {
    const root = await createTempDir(t);
    await writeFiles(root, {
        "bah.json": { name: "addon", packs: [] },
        "package.json": { name: "addon" },
    });
    const project = await Project.load({ cwd: root });
    const runtime = new FakeRuntime();
    const fetch = fakeServerFetch(runtime);
    const busyPorts = new Set<string>();
    const manager = new ServerManager(project, await ServerConfigStore.load(project.paths.stateDir), {
        runtime,
        fetch,
        versions: new BedrockVersionResolver(fetch),
        logger: silentLogger,
        isPortFree: async (port, protocol) => !busyPorts.has(`${port}/${protocol}`),
        lanAddress: () => "192.168.1.50",
        pollIntervalMs: 1,
    });
    return { project, runtime, manager, busyPorts };
}

describe("ServerManager.create", () => {
    it("allocates ports, an id and default settings", async (t) => {
        const { manager } = await setup(t);

        const entry = await manager.create("dev", { experiments: ["beta-apis"] });

        assert.match(entry.config.id, /^[0-9a-f]{12}$/);
        assert.deepEqual(
            { ...entry.config, id: "x" },
            {
                id: "x",
                version: "latest",
                port: 19132,
                udpPorts: { start: 19133, end: 19136 },
                experiments: ["gametest"],
                variables: {},
                properties: {},
                reload: { mode: "command", command: "reload" },
            },
        );
        const second = await manager.create("other");
        assert.equal(second.config.port, 19142);
    });

    it("uses a single UDP port for versions with multiplexing", async (t) => {
        const { manager } = await setup(t);

        const entry = await manager.create("preview", { version: "preview" });

        assert.deepEqual(entry.config.udpPorts, { start: 19133, end: 19133 });
    });

    it("rejects old versions and duplicate names", async (t) => {
        const { manager } = await setup(t);

        await assert.rejects(manager.create("old", { version: "1.26.40" }), /not supported/);
        await manager.create("dev");
        await assert.rejects(manager.create("dev"), /already exists/);
    });
});

describe("ServerManager.start", () => {
    it("creates the world on first start, configures it and starts the server", async (t) => {
        const { project, runtime, manager } = await setup(t);
        await addPack(project, {
            name: "bp",
            type: "behavior",
            scripts: "js",
            minEngineVersion: async () => [1, 26, 66],
        });
        const fetch = fakeServerFetch(runtime);
        await addModule(
            project,
            { registry: new NpmRegistry(fetch), versions: new BedrockVersionResolver(fetch) },
            { name: "@minecraft/server-ui", beta: true },
        );
        const entry = await manager.create("dev");
        const container = manager.containerName(entry);

        const result = await manager.start("dev");

        assert.equal(result.address, "192.168.1.50:19132");
        assert.deepEqual(result.version, [1, 26, 66, 1]);
        assert.deepEqual(runtime.calls, [`run ${container}`, `stop ${container}`, `run ${container}`]);

        const spec = runtime.containers.get(container)?.spec;
        assert.ok(spec);
        assert.deepEqual(spec.env, {
            EULA: "TRUE",
            VERSION: "1.26.66.1",
            SERVER_PORT: "19132",
            SERVER_PORT_V6: "19132",
        });
        assert.deepEqual(
            spec.ports.map((mapping) => `${mapping.port}/${mapping.protocol}`),
            ["19132/tcp", "19133/udp", "19134/udp", "19135/udp", "19136/udp"],
        );
        assert.deepEqual(spec.volumes, [{ host: manager.dataDirectory("dev"), container: "/data" }]);
        assert.deepEqual(spec.labels, { "bah.project": "addon", "bah.server": "dev" });

        const data = manager.dataDirectory("dev");
        const properties = await readFile(join(data, "server.properties"), "utf8");
        assert.match(properties, /^server-port=19132$/m);
        assert.match(properties, /^server-udp-ports=19133-19136$/m);
        assert.match(properties, /^server-public-ip=192\.168\.1\.50$/m);
        assert.match(properties, /^allow-list=false$/m);

        const permissions = JSON.parse(await readFile(join(data, "config/default/permissions.json"), "utf8"));
        assert.ok(permissions.allowed_modules.includes("@minecraft/server-ui"));
        assert.equal(await pathExists(join(data, "keys/server_identity_key.pem")), true);

        // A beta module in a pack turns on the Beta APIs experiment.
        assert.deepEqual(await readExperiments(join(data, "worlds/world/level.dat")), ["gametest"]);
    });

    it("starts an existing world directly and passes PREVIEW for preview versions", async (t) => {
        const { runtime, manager } = await setup(t);
        const entry = await manager.create("dev", { version: "1.26.70.26" });
        await manager.start("dev");
        await manager.stop("dev");
        runtime.calls.length = 0;

        await manager.start("dev");

        const container = manager.containerName(entry);
        assert.deepEqual(runtime.calls, [`run ${container}`]);
        assert.equal(runtime.containers.get(container)?.spec.env.PREVIEW, "TRUE");
    });

    it("refuses to start twice, with busy ports, or with too few UDP ports", async (t) => {
        const { manager, busyPorts } = await setup(t);
        await manager.create("dev");
        await manager.create("narrow", { port: 19500 });
        manager.store.set("narrow", {
            ...manager.store.get("narrow").config,
            udpPorts: { start: 19501, end: 19501 },
        });

        await manager.start("dev");
        await assert.rejects(manager.start("dev"), /already running/);

        await assert.rejects(manager.start("narrow"), /needs 4 UDP ports, but server "narrow" has 1/);

        busyPorts.add("19500/tcp");
        manager.store.set("narrow", {
            ...manager.store.get("narrow").config,
            udpPorts: { start: 19501, end: 19504 },
        });
        await assert.rejects(manager.start("narrow"), /19500\/tcp of server "narrow" are in use/);
    });
});

describe("ServerManager other operations", () => {
    it("stops, restarts and reports status", async (t) => {
        const { manager } = await setup(t);
        await manager.create("dev");

        assert.equal((await manager.status("dev")).state, "missing");
        assert.equal(await manager.stop("dev"), false);

        await manager.start("dev");
        const running = await manager.status("dev");
        assert.equal(running.state, "running");
        assert.equal(running.info?.version, "1.26.66");

        await manager.restart("dev");
        assert.equal(await manager.stop("dev"), true);
        assert.deepEqual(
            { state: (await manager.status("dev")).state, info: (await manager.status("dev")).info },
            { state: "stopped", info: null },
        );
    });

    it("sends console commands to running servers only", async (t) => {
        const { runtime, manager } = await setup(t);
        const entry = await manager.create("dev");

        await assert.rejects(manager.command("dev", "reload"), /not running/);
        await manager.start("dev");
        await manager.command("dev", "say  hello world");

        assert.ok(runtime.calls.includes(`exec ${manager.containerName(entry)} send-command say hello world`));
    });

    it("removes the container, the config and optionally the data", async (t) => {
        const { project, runtime, manager } = await setup(t);
        await manager.create("keep");
        await manager.create("purge");
        await manager.start("keep");
        await manager.start("purge");

        await manager.remove("keep");
        await manager.remove("purge", { purge: true });

        assert.equal(runtime.containers.size, 0);
        assert.deepEqual((await ServerConfigStore.load(project.paths.stateDir)).names, []);
        assert.equal(await pathExists(manager.dataDirectory("keep")), true);
        assert.equal(await pathExists(manager.dataDirectory("purge")), false);
    });

    it("attaches until detached, and waits for restarts", async (t) => {
        const { runtime, manager } = await setup(t);
        const entry = await manager.create("dev");
        const container = manager.containerName(entry);
        await manager.start("dev");

        // Detaching while the server runs ends the command.
        await manager.attach("dev", new AbortController().signal);
        assert.equal(runtime.calls.filter((call) => call.startsWith("attach")).length, 1);

        // When the server stops, attach waits and reattaches once it is back.
        let attaches = 0;
        runtime.onAttach = () => {
            attaches++;
            const state = runtime.containers.get(container);
            if (attaches === 1 && state) {
                state.state = "stopped";
                setTimeout(() => {
                    state.state = "running";
                }, 10);
            }
        };
        await manager.attach("dev", new AbortController().signal);
        assert.equal(attaches, 2);
    });
});
