import type { ServerConfig } from "../server/server-config.ts";

export const exampleServer: ServerConfig = {
    id: "a639cf19fd5e",
    version: "latest",
    port: 19132,
    udpPorts: { start: 19133, end: 19136 },
    experiments: ["gametest"],
    variables: { debug: true, spawn: { x: 0, y: 64 } },
    properties: { "allow-list": false, "view-distance": 10 },
    reload: { mode: "command", command: "reload" },
};
