import * as net from "node:net";
import AdapterSession from "./AdapterSession.js";

export default class MinecraftDebugAdapter {
    server = undefined;
    running = false;
    reconnectDelay = 3000;

    constructor(listenPort, mcHost, mcPort, targetModuleUuid = undefined) {
        this.listenPort = listenPort;
        this.mcHost = mcHost;
        this.mcPort = mcPort;
        this.targetModuleUuid = targetModuleUuid;
    }

    start() {
        return new Promise(resolve => {
            if (this.running) return;
            this.running = true;

            this.server = net.createServer(ideSocket => {
                console.log('[adapter] DAP client connected');
                const session = new AdapterSession(ideSocket, this.mcHost, this.mcPort, this.targetModuleUuid, this.reconnectDelay);
                session.start();
            });

            this.server.on('error', e => console.error('[adapter] Server error:', e.message));
            this.server.listen(this.listenPort, () => {
                console.log(`[adapter] Listening for DAP connections on port ${this.listenPort}`);
                resolve();
            });
        })
    }

    stop() {
        this.running = false;
        this.server?.close();
    }
}
