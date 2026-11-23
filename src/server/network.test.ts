import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import { exampleServer } from "../test-support/fixtures.ts";
import {
    allocatePorts,
    assertSupportedVersion,
    detectLanAddress,
    formatUdpPorts,
    isPortFree,
    requiredUdpPorts,
} from "./network.ts";

describe("server versions", () => {
    it("needs a UDP range before 1.26.70 and a single port from then on", () => {
        assert.equal(requiredUdpPorts([1, 26, 50]), 4);
        assert.equal(requiredUdpPorts([1, 26, 66, 1]), 4);
        assert.equal(requiredUdpPorts([1, 26, 70]), 1);
        assert.equal(requiredUdpPorts([1, 26, 70, 26]), 1);
        assert.equal(requiredUdpPorts([1, 27, 0]), 1);
    });

    it("supports 1.26.50 and newer", () => {
        assertSupportedVersion([1, 26, 50]);
        assertSupportedVersion([1, 26, 60, 3]);
        assert.throws(() => assertSupportedVersion([1, 26, 40, 9]), /1\.26\.40\.9 is not supported.*1\.26\.50/);
    });

    it("formats server-udp-ports", () => {
        assert.equal(formatUdpPorts({ start: 19133, end: 19136 }), "19133-19136");
        assert.equal(formatUdpPorts({ start: 19133, end: 19133 }), "19133");
    });
});

describe("allocatePorts", () => {
    const allFree = async () => true;

    it("starts at 19132 with the UDP ports right after", async () => {
        assert.deepEqual(await allocatePorts([], 4, allFree), { port: 19132, udpPorts: { start: 19133, end: 19136 } });
        assert.deepEqual(await allocatePorts([], 1, allFree), { port: 19132, udpPorts: { start: 19133, end: 19133 } });
    });

    it("skips blocks used by other servers or by other programs", async () => {
        const busy = new Set(["19142/tcp", "19153/udp"]);
        const checker = async (port: number, protocol: string) => !busy.has(`${port}/${protocol}`);

        const result = await allocatePorts([exampleServer], 4, checker);

        // 19132: used by exampleServer, 19142: TCP busy, 19152: UDP 19153 busy.
        assert.deepEqual(result, { port: 19162, udpPorts: { start: 19163, end: 19166 } });
    });
});

describe("isPortFree", () => {
    it("detects a bound TCP port", async (t) => {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, resolve));
        t.after(() => server.close());
        const address = server.address();
        assert.ok(address !== null && typeof address === "object");

        assert.equal(await isPortFree(address.port, "tcp"), false);
    });
});

describe("detectLanAddress", () => {
    const entry = (address: string, internal = false) => ({
        address,
        netmask: "255.255.255.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal,
        cidr: null,
    });

    it("prefers a physical interface and skips loopback, link-local and bridges", () => {
        const interfaces = {
            lo0: [entry("127.0.0.1", true)],
            bridge100: [entry("192.168.64.1")],
            utun3: [entry("10.8.0.2")],
            en7: [entry("169.254.10.1")],
            en0: [entry("192.168.1.203")],
        };
        assert.equal(detectLanAddress(interfaces), "192.168.1.203");
    });

    it("returns null without a usable address", () => {
        assert.equal(detectLanAddress({ lo0: [entry("127.0.0.1", true)] }), null);
    });
});
