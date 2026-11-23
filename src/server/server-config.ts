import { z } from "zod";
import { identifierSchema, portSchema } from "../util/schemas.ts";

export const SERVERS_CONFIG_FILE = "servers.json";
export const LOCAL_SERVERS_CONFIG_FILE = "servers.local.json";

/** `latest`, `preview` or an exact version such as `1.26.70` or `1.26.70.26`. */
export const bedrockVersionSpecSchema = z.union([
    z.literal("latest"),
    z.literal("preview"),
    z.string().regex(/^\d+\.\d+\.\d+(?:\.\d+)?$/, "must be latest, preview or a version like 1.26.70"),
]);
export type BedrockVersionSpec = z.infer<typeof bedrockVersionSpecSchema>;

/** Inclusive UDP port range for game traffic (`server-udp-ports`). */
export const udpPortRangeSchema = z
    .strictObject({ start: portSchema, end: portSchema })
    .refine((range) => range.start <= range.end, { message: "start must not be greater than end" });
export type UdpPortRange = z.infer<typeof udpPortRangeSchema>;

/** What to do with a running server after new packs are deployed. */
export const reloadStrategySchema = z.discriminatedUnion("mode", [
    /** Send a console command (e.g. `reload`). */
    z.strictObject({ mode: z.literal("command"), command: z.string().min(1) }),
    /** Stop and start the server. */
    z.strictObject({ mode: z.literal("restart") }),
    /** Leave the server alone. */
    z.strictObject({ mode: z.literal("none") }),
]);
export type ReloadStrategy = z.infer<typeof reloadStrategySchema>;

export const serverPropertyValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ServerPropertyValue = z.infer<typeof serverPropertyValueSchema>;

/** server.properties keys the tool manages itself; they can't be overridden. */
export const RESERVED_SERVER_PROPERTIES = [
    "server-port",
    "server-portv6",
    "server-udp-ports",
    "server-public-ip",
] as const;

export const serverConfigSchema = z.strictObject({
    /** Random ID used for the Docker container name. */
    id: z.string().regex(/^[a-z0-9]{8,32}$/, "must be 8-32 lowercase letters or digits"),
    version: bedrockVersionSpecSchema,
    /** TCP port for NetherNet signaling (`server-port`), same on host and container. */
    port: portSchema,
    udpPorts: udpPortRangeSchema,
    /** Experiment toggles written to level.dat. */
    experiments: z.array(z.string().min(1)),
    /** Script modules to allow in addition to the ones the packs require. */
    allowedModules: z.array(z.string().min(1)).optional(),
    /** Written to `config/default/variables.json`. */
    variables: z.record(z.string(), z.json()),
    /** Extra or overridden server.properties values. */
    properties: z.record(z.string(), serverPropertyValueSchema).superRefine((properties, ctx) => {
        for (const key of RESERVED_SERVER_PROPERTIES) {
            if (key in properties) {
                ctx.addIssue({ code: "custom", path: [key], message: `"${key}" is managed by bah` });
            }
        }
    }),
    reload: reloadStrategySchema,
});
export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** The shared `.bah/servers.json` file. */
export const serversConfigSchema = z
    .strictObject({
        $schema: z.string().optional(),
        servers: z.record(identifierSchema, serverConfigSchema),
    })
    .superRefine((config, ctx) => {
        const entries = Object.entries(config.servers);
        const ids = new Map<string, string>();
        for (const [index, [name, server]] of entries.entries()) {
            const other = ids.get(server.id);
            if (other !== undefined) {
                ctx.addIssue({ code: "custom", path: ["servers", name, "id"], message: `same id as "${other}"` });
            }
            ids.set(server.id, name);

            for (const [otherName, otherServer] of entries.slice(0, index)) {
                if (server.port === otherServer.port) {
                    ctx.addIssue({
                        code: "custom",
                        path: ["servers", name, "port"],
                        message: `same port as "${otherName}"`,
                    });
                }
                if (rangesOverlap(server.udpPorts, otherServer.udpPorts)) {
                    ctx.addIssue({
                        code: "custom",
                        path: ["servers", name, "udpPorts"],
                        message: `overlaps with the UDP ports of "${otherName}"`,
                    });
                }
            }
        }
    });
export type ServersConfig = z.infer<typeof serversConfigSchema>;

/** Per-machine settings for one server. */
export const localServerConfigSchema = z.strictObject({
    /** Written to `config/default/secrets.json`. */
    secrets: z.record(z.string(), z.string()).optional(),
    /** Overrides the top-level `advertiseHost` for this server. */
    advertiseHost: z.string().min(1).optional(),
});
export type LocalServerConfig = z.infer<typeof localServerConfigSchema>;

/** The gitignored `.bah/servers.local.json` file. */
export const localServersConfigSchema = z.strictObject({
    $schema: z.string().optional(),
    /** Address clients use to reach the servers (`server-public-ip`). Defaults to the host's LAN IP. */
    advertiseHost: z.string().min(1).optional(),
    servers: z.record(identifierSchema, localServerConfigSchema),
});
export type LocalServersConfig = z.infer<typeof localServersConfigSchema>;

function rangesOverlap(a: UdpPortRange, b: UdpPortRange): boolean {
    return a.start <= b.end && b.start <= a.end;
}
