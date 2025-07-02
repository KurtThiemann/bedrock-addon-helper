import Server from "./Server.js";
import path from "node:path";
import fs from "node:fs";

export default class ServerManager {
    /** @type {?Object} */ loadedServers = null;
    /** @type {Project} */ project;

    /**
     * @param {Project} project
     */
    constructor(project) {
        this.project = project;
    }

    /**
     * @return {URL}
     */
    getServersPath() {
        return new URL("servers.json", this.project.getWorkingDirectory());
    }

    /**
     * @return {Promise<Object>}
     */
    async getServers() {
        if (this.loadedServers !== null) {
            return this.loadedServers;
        }
        if (!await this.project.checkFilesExist(this.getServersPath())) {
            return this.loadedServers = {};
        }
        return this.loadedServers = await this.project.readManifest(this.getServersPath());
    }

    /**
     * @param {Object} servers
     * @return {Promise<this>}
     */
    async saveServers(servers) {
        this.loadedServers = servers;
        await this.project.saveManifest(this.getServersPath(), servers);
        return this;
    }

    /**
     * @param {string} name
     * @return {Promise<Object|null>}
     */
    async getServer(name) {
        const servers = await this.getServers();
        return servers[name] ?? null;
    }

    /**
     * @param {string} name
     * @param {Object} server
     * @return {Promise<this>}
     */
    async saveServer(name, server) {
        const servers = await this.getServers();
        servers[name] = server;
        await this.saveServers(servers);
        return this;
    }

    /**
     * @param {string} name
     * @return {Promise<this>}
     */
    async removeServer(name) {
        const servers = await this.getServers();
        if (servers[name]) {
            delete servers[name];
            await this.saveServers(servers);
        }
        return this;
    }

    async updatePacks(packBuildInformation) {
        let reloads = [];
        for (let serverConfig of Object.values(await this.getServers())) {
            let server = new Server(serverConfig, this.project);
            let worldBehaviorPacksPath = new URL("world_behavior_packs.json", server.getWorldDirectory());
            let worldResourcePacksPath = new URL("world_resource_packs.json", server.getWorldDirectory());

            let worldBehaviorPacks = [];
            if (await this.project.checkFilesExist(worldBehaviorPacksPath)) {
                worldBehaviorPacks = await server.project.readManifest(worldBehaviorPacksPath)
            }
            let worldResourcePacks = [];
            if (await this.project.checkFilesExist(worldResourcePacksPath)) {
                worldResourcePacks = await server.project.readManifest(worldResourcePacksPath)
            }

            for (let pack of packBuildInformation) {
                let name = path.basename(pack.location.pathname);
                let baseDir = new URL(`development_${pack.type}_packs/`, server.getServerDirectory());
                await fs.promises.mkdir(baseDir, {recursive: true});

                let targetDir = new URL(`${name}/`, baseDir);
                if (await this.project.checkFilesExist(targetDir)) {
                    await fs.promises.rm(targetDir, {recursive: true});
                }
                await this.project.copyDirectory(pack.location, targetDir);

                let list = pack.type === 'behavior' ? worldBehaviorPacks : worldResourcePacks;
                let existing = list.find(p => p.pack_id === pack.uuid);
                if (existing) {
                    existing.version = pack.version;
                } else {
                    list.push({
                        pack_id: pack.uuid,
                        version: pack.version,
                    });
                }
            }

            if (!await server.getContainer(true)) {
                continue;
            }

            await fs.promises.mkdir(server.getWorldDirectory(), {recursive: true});
            await server.project.saveManifest(worldBehaviorPacksPath, worldBehaviorPacks);
            await server.project.saveManifest(worldResourcePacksPath, worldResourcePacks);
            if (serverConfig.fullRestart) {
                reloads.push((async () => {
                    await server.stopContainer();
                    await server.startContainer();
                    await server.waitForServerReady(AbortSignal.timeout(2 * 60 * 1000));
                })());
            } else {
                reloads.push(server.reloadAddons());
            }
        }

        await Promise.all(reloads);
    }
}
