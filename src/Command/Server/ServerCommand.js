import Command from "../Command.js";

/**
 * @abstract
 */
export default class ServerCommand extends Command {
    /** @type {?Object} */ loadedServers = null;

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
}
