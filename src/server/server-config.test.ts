import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exampleServer } from "../test-support/fixtures.ts";
import { serverConfigSchema, serversConfigSchema } from "./server-config.ts";

function issues(schema: typeof serverConfigSchema | typeof serversConfigSchema, value: unknown): string[] {
    const result = schema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("serverConfigSchema", () => {
    it("accepts a valid server", () => {
        assert.deepEqual(issues(serverConfigSchema, exampleServer), []);
    });

    for (const version of ["latest", "preview", "1.26.70", "1.26.70.26"]) {
        it(`accepts version ${version}`, () => {
            assert.deepEqual(issues(serverConfigSchema, { ...exampleServer, version }), []);
        });
    }

    for (const version of ["LATEST", "1.26", "v1.26.70", ""]) {
        it(`rejects version ${JSON.stringify(version)}`, () => {
            assert.notDeepEqual(issues(serverConfigSchema, { ...exampleServer, version }), []);
        });
    }

    it("rejects a reversed UDP range", () => {
        const server = { ...exampleServer, udpPorts: { start: 20000, end: 19999 } };
        assert.deepEqual(issues(serverConfigSchema, server), ["udpPorts: start must not be greater than end"]);
    });

    it("rejects overriding properties bah manages", () => {
        const server = { ...exampleServer, properties: { "server-port": 1 } };
        assert.deepEqual(issues(serverConfigSchema, server), [
            'properties.server-port: "server-port" is managed by bah',
        ]);
    });

    it("accepts every reload mode and rejects unknown ones", () => {
        for (const reload of [{ mode: "restart" }, { mode: "none" }, { mode: "command", command: "reload all" }]) {
            assert.deepEqual(issues(serverConfigSchema, { ...exampleServer, reload }), []);
        }
        assert.notDeepEqual(issues(serverConfigSchema, { ...exampleServer, reload: { mode: "explode" } }), []);
        assert.notDeepEqual(issues(serverConfigSchema, { ...exampleServer, reload: { mode: "command" } }), []);
    });
});

describe("serversConfigSchema", () => {
    it("rejects conflicting ids and ports between servers", () => {
        const config = {
            servers: {
                a: exampleServer,
                b: { ...exampleServer, udpPorts: { start: 19136, end: 19140 } },
            },
        };
        assert.deepEqual(issues(serversConfigSchema, config), [
            'servers.b.id: same id as "a"',
            'servers.b.port: same port as "a"',
            'servers.b.udpPorts: overlaps with the UDP ports of "a"',
        ]);
    });

    it("accepts servers with distinct ports", () => {
        const config = {
            servers: {
                a: exampleServer,
                b: { ...exampleServer, id: "bbbbbbbbbbbb", port: 19140, udpPorts: { start: 19141, end: 19141 } },
            },
        };
        assert.deepEqual(issues(serversConfigSchema, config), []);
    });

    it("rejects invalid server names", () => {
        assert.notDeepEqual(issues(serversConfigSchema, { servers: { "bad name": exampleServer } }), []);
    });
});
