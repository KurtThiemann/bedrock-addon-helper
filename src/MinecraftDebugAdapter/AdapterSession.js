export default class AdapterSession {
    mcSocket = undefined;
    reconnectTimer = undefined;

    constructor(ideSocket, mcHost, mcPort, targetModuleUuid, reconnectDelay) {
        this.ideSocket = ideSocket;
        this.mcHost = mcHost;
        this.mcPort = mcPort;
        this.targetModuleUuid = targetModuleUuid;
        this.reconnectDelay = reconnectDelay;
    }

    start() {
        this.ideSocket.on('error', e => console.error('[session] DAP client error:', e.message));
        this.ideSocket.on('close', () => {
            console.log('[session] DAP client disconnected');
            clearTimeout(this.reconnectTimer);
            this.mcSocket?.destroy();
        });
        this.connectToMinecraft();
    }

    connectToMinecraft() {
        if (this.ideSocket.destroyed) return;

        console.log(`[session] Connecting to Minecraft at ${this.mcHost}:${this.mcPort}...`);

        const mcSocket = net.createConnection({ host: this.mcHost, port: this.mcPort });
        this.mcSocket = mcSocket;

        mcSocket.on('connect', () => {
            console.log('[session] Connected to Minecraft');
            this.setupBridge(mcSocket);
        });

        mcSocket.on('error', e => {
            console.error('[session] Minecraft socket error:', e.message);
        });

        mcSocket.on('close', () => {
            console.log('[session] Minecraft disconnected');
            if (!this.ideSocket.destroyed) {
                this.scheduleReconnect();
            }
        });
    }

    scheduleReconnect() {
        if (this.ideSocket.destroyed) return;
        console.log(`[session] Reconnecting in ${this.reconnectDelay / 1000}s...`);
        this.reconnectTimer = setTimeout(() => this.connectToMinecraft(), this.reconnectDelay);
    }

    setupBridge(mcSocket) {
        let handshakeDone = false;
        const pendingFromIDE = [];

        this.readMinecraftMessages(mcSocket, msg => {
            if (!handshakeDone) {
                if (msg.type === 'event' && msg.event?.type === 'ProtocolEvent') {
                    handshakeDone = true;
                    this.handleHandshake(mcSocket, msg.event);
                    for (const m of pendingFromIDE) this.writeMinecraftMessage(mcSocket, m);
                    pendingFromIDE.length = 0;
                }
                return;
            }
            this.writeDAPMessage(this.ideSocket, msg);
        });

        this.readDAPMessages(this.ideSocket, msg => {
            if (!handshakeDone) {
                pendingFromIDE.push(msg);
            } else {
                this.writeMinecraftMessage(mcSocket, msg);
            }
        });
    }

    readDAPMessages(socket, onMessage) {
        let buffer = '';
        socket.on('data', chunk => {
            buffer += chunk.toString('utf8');
            while (true) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1) break;
                const match = buffer.substring(0, headerEnd).match(/Content-Length:\s*(\d+)/i);
                if (!match) break;
                const length = parseInt(match[1]);
                const start = headerEnd + 4;
                if (buffer.length < start + length) break;
                try { onMessage(JSON.parse(buffer.substring(start, start + length))); } catch {}
                buffer = buffer.substring(start + length);
            }
        });
    }

    writeDAPMessage(socket, obj) {
        if (socket.destroyed) return;
        const json = JSON.stringify(obj);
        socket.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
    }

    handleHandshake(mcSocket, proto) {
        const targetUuid = this.targetModuleUuid ?? proto.plugins?.[0]?.module_uuid ?? null;

        if (!targetUuid && proto.plugins?.length > 1) {
            console.warn('[session] Multiple plugins found and no targetModuleUuid set. Using first plugin.');
        }

        this.writeMinecraftMessage(mcSocket, {
            type: 'protocol',
            version: proto.version,
            target_module_uuid: targetUuid,
            passcode: null,
        });

        console.log(`[session] Handshake complete (protocol v${proto.version}, target: ${targetUuid ?? 'none'})`);
    }

    readMinecraftMessages(socket, onMessage) {
        let buffer = Buffer.alloc(0);
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 9) {
                const msgLength = parseInt(buffer.subarray(0, 8).toString('ascii'), 16);
                if (isNaN(msgLength) || buffer.length < 9 + msgLength) break;
                try { onMessage(JSON.parse(buffer.subarray(9, 9 + msgLength - 1).toString('utf8'))); } catch {}
                buffer = buffer.subarray(9 + msgLength);
            }
        });
    }

    writeMinecraftMessage(socket, obj) {
        if (socket.destroyed) return;
        const jsonBuf = Buffer.from(JSON.stringify(obj));
        const len = jsonBuf.byteLength + 1;
        const header = ('00000000' + len.toString(16) + '\n').slice(-9);
        socket.write(Buffer.concat([Buffer.from(header), jsonBuf, Buffer.from('\n')]));
    }
}
