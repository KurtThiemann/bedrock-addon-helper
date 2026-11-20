import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { type BedrockVersion, compareBedrockVersions, formatBedrockVersion } from "../bedrock/version.ts";
import { BahError } from "../util/errors.ts";
import type { ServerConfig, UdpPortRange } from "./server-config.ts";

/** Oldest supported server version: the first one using NetherNet. */
export const MIN_SERVER_VERSION: BedrockVersion = [1, 26, 50];

export function assertSupportedVersion(version: BedrockVersion): void {
    if (compareBedrockVersions(version, MIN_SERVER_VERSION) < 0) {
        throw new BahError(
            `Bedrock ${formatBedrockVersion(version)} is not supported; test servers need ${formatBedrockVersion(MIN_SERVER_VERSION)} or newer.`,
        );
    }
}

/*
 * UDP ports per server. Servers before 1.26.70 can't share one UDP port
 * between players, so they get a small range. Once 1.26.70 is the oldest
 * version anyone uses, delete this and always use a single port.
 */
const UDP_MULTIPLEXING_VERSION: BedrockVersion = [1, 26, 70];
const UDP_PORTS_WITHOUT_MULTIPLEXING = 4;

export function requiredUdpPorts(version: BedrockVersion): number {
    return compareBedrockVersions(version, UDP_MULTIPLEXING_VERSION) >= 0 ? 1 : UDP_PORTS_WITHOUT_MULTIPLEXING;
}

export function udpPortCount(range: UdpPortRange): number {
    return range.end - range.start + 1;
}

/** `server-udp-ports` value for a range. */
export function formatUdpPorts(range: UdpPortRange): string {
    return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
}

/** First TCP port tried for new servers; servers use blocks of 10 ports from here. */
export const FIRST_SERVER_PORT = 19132;
const PORT_BLOCK = 10;

export interface PortAllocation {
    port: number;
    udpPorts: UdpPortRange;
}

export type PortChecker = (port: number, protocol: "tcp" | "udp") => Promise<boolean>;

/**
 * Picks the first block of ports (TCP signaling port followed by the UDP
 * range) that no configured server uses and that is free on this machine.
 */
export async function allocatePorts(
    existing: readonly ServerConfig[],
    udpCount: number,
    isFree: PortChecker = isPortFree,
): Promise<PortAllocation> {
    for (let port = FIRST_SERVER_PORT; port + udpCount <= 65535; port += PORT_BLOCK) {
        const udpPorts = { start: port + 1, end: port + udpCount };
        const taken = existing.some(
            (server) =>
                server.port === port ||
                (server.udpPorts.start <= udpPorts.end && udpPorts.start <= server.udpPorts.end) ||
                (port >= server.udpPorts.start && port <= server.udpPorts.end),
        );
        if (taken || !(await isFree(port, "tcp"))) {
            continue;
        }
        let udpFree = true;
        for (let udp = udpPorts.start; udp <= udpPorts.end && udpFree; udp++) {
            udpFree = await isFree(udp, "udp");
        }
        if (udpFree) {
            return { port, udpPorts };
        }
    }
    throw new BahError("Could not find free ports for a new server.");
}

/** True if nothing on this machine is bound to the port. */
export function isPortFree(port: number, protocol: "tcp" | "udp"): Promise<boolean> {
    return new Promise((resolve) => {
        if (protocol === "tcp") {
            const server = createServer();
            server.once("error", () => resolve(false));
            server.listen(port, () => server.close(() => resolve(true)));
        } else {
            const socket = createSocket("udp4");
            socket.once("error", () => {
                socket.close();
                resolve(false);
            });
            socket.bind(port, () => socket.close(() => resolve(true)));
        }
    });
}

/**
 * The machine's LAN IPv4 address, which players on this machine and on the
 * local network can reach. Null if there is none.
 */
export function detectLanAddress(interfaces = networkInterfaces()): string | null {
    const candidates = Object.entries(interfaces)
        .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
        .filter((address) => address.family === "IPv4" && !address.internal)
        // Skip link-local and container/VM bridges.
        .filter((address) => !address.address.startsWith("169.254."))
        .filter((address) => !/^(docker|br-|veth|vmnet|vboxnet|utun|bridge)/.test(address.name));
    const preferred = candidates.find((address) => /^(en|eth|wl)/.test(address.name)) ?? candidates[0];
    return preferred?.address ?? null;
}
