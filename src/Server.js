import Docker from "dockerode";
import {BedrockPingClient} from "craftping";
import nbt from "prismarine-nbt";
import fs from "node:fs";

export default class Server {
    /** @type {Object} */ config;
    /** @type {Project} */ project;
    /** @type {import("dockerode").Docker} */ docker;
    /** @type {import("dockerode").Container} */ container;
    /** @type {string} */ image = 'itzg/minecraft-bedrock-server:latest';

    /**
     * @param {Object} config
     * @param {Project} project
     */
    constructor(config, project) {
        if (/[^\w-]/.test(config.id) || /[^\w-]/.test(config.name)) {
            throw new Error(`Invalid server ID or name`);
        }
        this.config = config;
        this.project = project;
        this.docker = new Docker();
    }

    /**
     * @return {string}
     */
    getContainerName() {
        return `bedrock-server-${this.config.id}`;
    }

    /**
     * @return {URL}
     */
    getServerDirectory() {
        return new URL(`servers/${this.config.name}/`, this.project.getBuildDirectory());
    }

    /**
     * @return {URL}
     */
    getWorldDirectory() {
        let name = this.config.environment?.LEVEL_NAME ?? 'Bedrock level';
        if (name.includes('/') || name.includes('\\') || [".", ".."].includes(name)) {
            throw new Error(`Invalid world name: "${name}".`);
        }
        return new URL(`worlds/${name}/`, this.getServerDirectory());
    }

    async getContainer(update = false) {
        if (this.container && !update) {
            return this.container;
        }

        let containers = await this.docker.listContainers();
        for (let c of containers) {
            if (c.Names.includes(`/${this.getContainerName()}`)) {
                return this.container = this.docker.getContainer(c.Id);
            }
        }
    }

    /**
     * @return {Promise<Server>}
     */
    async configureServer() {
        await fs.promises.mkdir(this.getServerDirectory(), {recursive: true});
        let levelDat = new URL('level.dat', this.getWorldDirectory());

        if (!await this.project.checkFilesExist(levelDat)) {
            await this.startContainer();
            await this.waitForServerReady(AbortSignal.timeout(2 * 60 * 1000));
            await this.stopContainer();
        }

        if (!await this.project.checkFilesExist(levelDat)) {
            throw new Error(`No level.dat found in server directory. Ensure the server is configured correctly.`);
        }

        await this.updateLevelDat(levelDat);

        await fs.promises.mkdir(new URL('config/default/', this.getServerDirectory()), {recursive: true});
        await this.project.saveManifest(new URL('config/default/permissions.json', this.getServerDirectory()), this.config.permissions ?? {});
        await this.project.saveManifest(new URL('config/default/variables.json', this.getServerDirectory()), this.config.variables ?? {});
        await this.project.saveManifest(new URL('config/default/secrets.json', this.getServerDirectory()), this.config.secrets ?? {});

        return this;
    }

    /**
     * @param {URL} path
     * @return {Promise<this>}
     */
    async updateLevelDat(path) {
        let exp = {};
        for (let experiment of this.config.experiments || []) {
            exp[experiment] = nbt.byte(1);
        }
        let content = await fs.promises.readFile(path);
        let version = content.readUInt32LE(0);

        let {parsed} = await nbt.parse(content.subarray(8), 'little');
        parsed.value.experiments = nbt.comp(exp);
        let result = nbt.writeUncompressed(parsed, 'little');
        let prefix = Buffer.alloc(8);
        prefix.writeUInt32LE(version, 0);
        prefix.writeUInt32LE(result.byteLength, 4);
        await fs.promises.writeFile(path, Buffer.concat([prefix, result]));
        return this;
    }

    /**
     * @return {Promise<Container>}
     */
    async startContainer() {
        let container = await this.getContainer();
        if (container) {
            throw new Error(`Container with name "${this.getContainerName()}" already exists.`);
        }

        let uid = process.getuid?.() ?? 1000;
        let gid = process.getgid?.() ?? 1000;
        let baseEnvironment = Object.assign({}, this.config.environment || {}, {
            "SERVER_PORT": "19132",
        });
        let env = [];
        for (let [key, value] of Object.entries(baseEnvironment)) {
            if (value !== undefined && value !== null) {
                env.push(`${key}=${value}`);
            }
        }

        await this.pullImage();

        let options = {
            Image: this.image,
            name: this.getContainerName(),
            OpenStdin: true,
            HostConfig: {
                Binds: [
                    `${this.getServerDirectory().pathname}:/data`
                ],
                AutoRemove: true
            },
            Env: env,
            User: `${uid}:${gid}`,
        };

        this.container = await this.docker.createContainer(options);
        await this.container.start();
        return this.container;
    }

    /**
     * @return {Promise<unknown>}
     */
    async pullImage() {
        let stream = await this.docker.pull(this.image);
        return new Promise((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err, res) => {
                if (err) {
                    return reject(err);
                }
                resolve(res);
            });
        });
    }

    /**
     * @return {Promise<this>}
     */
    async stopContainer() {
        let container = await this.getContainer();
        if (!container) {
            throw new Error(`Container with name "${this.getContainerName()}" does not exist.`);
        }

        await container.stop();
        this.container = null;
        return this;
    }

    /**
     * @param {?AbortSignal} signal
     * @return {Promise<this>}
     */
    async waitForServerReady(signal) {
        let container = await this.getContainer();
        if (!container) {
            throw new Error(`Container with name "${this.getContainerName()}" does not exist.`);
        }

        let info = await container.inspect();
        let ip = info.NetworkSettings.IPAddress;

        let client = new BedrockPingClient();
        while (true) {
            signal?.throwIfAborted();
            try {
                await this.container.inspect();
            } catch (e) {
                throw new Error(`Server container "${this.getContainerName()}" no longer exists.`);
            }
            signal?.throwIfAborted();
            try {
                await client.ping(ip, 19132, AbortSignal.any([signal, AbortSignal.timeout(3000)]));
            } catch (e) {
                continue;
            }
            return this;
        }
    }

    async getAddress() {
        let container = await this.getContainer();
        if (!container) {
            throw new Error(`Container with name "${this.getContainerName()}" does not exist.`);
        }

        let info = await container.inspect();
        let ip = info.NetworkSettings.IPAddress;

        return `${ip}:19132`;
    }
}
