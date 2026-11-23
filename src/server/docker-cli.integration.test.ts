import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { DockerCli } from "./docker-cli.ts";

/*
 * Talks to a real Docker daemon. Opt in with BAH_DOCKER_TESTS=1
 * (pulls busybox the first time).
 */
const enabled = process.env.BAH_DOCKER_TESTS === "1";

describe("DockerCli (integration)", { skip: !enabled && "set BAH_DOCKER_TESTS=1 to run" }, () => {
    it("runs, inspects, execs, stops and removes a container", async (t) => {
        const docker = new DockerCli();
        const name = `bah-test-${randomBytes(4).toString("hex")}`;
        t.after(() => docker.remove(name));

        assert.equal(await docker.state(name), null);

        await docker.run({
            name,
            image: "busybox:latest",
            env: { HELLO: "world" },
            ports: [],
            volumes: [],
            labels: { "bah.test": "1" },
        });
        assert.equal(await docker.state(name), "running");

        await docker.exec(name, ["sh", "-c", 'test "$HELLO" = world']);
        await assert.rejects(docker.exec(name, ["false"]), /docker exec failed/);
        await assert.rejects(
            docker.run({ name, image: "busybox:latest", env: {}, ports: [], volumes: [], labels: {} }),
            /already running/,
        );

        await docker.stop(name, 1);
        assert.equal(await docker.state(name), "stopped");

        await docker.remove(name);
        assert.equal(await docker.state(name), null);
        await docker.remove(name);
    });

    it("reports a missing docker binary clearly", async () => {
        const docker = new DockerCli("docker-does-not-exist");

        await assert.rejects(docker.state("x"), /Is Docker installed\?/);
    });
});
