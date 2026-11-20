import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Fetch } from "../bedrock/version-resolver.ts";
import { BahError } from "../util/errors.ts";

/** Response of NetherNet's `GET /v1/join` (server status). */
export const joinInfoSchema = z.looseObject({
    name: z.string(),
    protocol: z.number(),
    version: z.string(),
    level: z.string(),
    players: z.number(),
    maxPlayers: z.number(),
    gameType: z.number(),
});
export type ServerInfo = z.infer<typeof joinInfoSchema>;

/** Asks a server for its status; null if it doesn't answer (yet). */
export async function queryServer(
    fetch: Fetch,
    host: string,
    port: number,
    timeoutMs = 2000,
): Promise<ServerInfo | null> {
    try {
        const response = await fetch(`http://${host}:${port}/v1/join`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
            return null;
        }
        const result = joinInfoSchema.safeParse(await response.json());
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}

export interface WaitOptions {
    readonly host: string;
    readonly port: number;
    readonly timeoutMs: number;
    readonly intervalMs?: number;
    /** Checked between attempts, so a crashed server fails fast. */
    readonly isRunning: () => Promise<boolean>;
    readonly signal?: AbortSignal | undefined;
}

/** Polls the server until it answers `/v1/join`. */
export async function waitUntilReady(fetch: Fetch, options: WaitOptions): Promise<ServerInfo> {
    const deadline = Date.now() + options.timeoutMs;
    const interval = options.intervalMs ?? 1000;
    while (true) {
        options.signal?.throwIfAborted();
        const info = await queryServer(fetch, options.host, options.port);
        if (info !== null) {
            return info;
        }
        if (!(await options.isRunning())) {
            throw new BahError('The server stopped while starting. See "bah server logs <name>" for details.');
        }
        if (Date.now() >= deadline) {
            throw new BahError(
                `The server did not become ready within ${Math.round(options.timeoutMs / 1000)} s. See "bah server logs <name>".`,
            );
        }
        await sleep(interval, undefined, { signal: options.signal });
    }
}
