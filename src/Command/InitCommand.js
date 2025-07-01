import Command from "./Command.js";
import * as readline from "node:readline";
import * as fs from "node:fs";

export default class InitCommand extends Command {
    /**
     * @inheritDoc
     */
    async configure(command) {
        command.option("-y, --yes", "Use default values for all prompts")
            .option("-f, --force", "Force initialization even if files already exist")
            .option("-n, --name <name>", "The name of the addon")
            .option("-d, --description <description>", "The description of the addon")
            .option("--min-version <version>", "Minimum Minecraft version required for the addon")
            .option("--no-resources <version>", "Do not create a resource pack")
            .option("--no-behavior <version>", "Do not create a behavior pack")
    }

    /**
     * @inheritDoc
     */
    getName() {
        return "init";
    }

    /**
     * @inheritDoc
     */
    async run(args, options) {
        if (!options.force) {
            if (!options.noBehavior && await this.checkBehaviorExists()) {
                console.error("Behavior pack already exists. Use --force to overwrite, or --no-behavior to skip.");
                return 1;
            }
            if (!options.noResources && await this.checkResourceExists()) {
                console.error("Resource pack already exists. Use --force to overwrite, or --no-resources to skip.");
                return 1;
            }
        }

        let packageJson = await this.project.readManifest(new URL("package.json", this.project.getWorkingDirectory()));
        let name = await this.readOption(options, "name", packageJson.name);
        let description = await this.readOption(options, "description", packageJson.description ?? "");
        let minVersion = await this.readOption(options, "min-version", packageJson.minVersion ?? "latest");

        minVersion = await this.resolveBedrockVersion(minVersion);
        minVersion = minVersion.split(".").map(n => parseInt(n)).slice(0, 3);

        let behaviorUuid = crypto.randomUUID();
        let resourceUuid = crypto.randomUUID();

        if (!options.noBehavior) {
            await fs.promises.mkdir(this.project.getBehaviorDirectory(), {recursive: true});
            await fs.promises.mkdir(new URL("scripts", this.project.getBehaviorDirectory()), {recursive: true});
            await fs.promises.writeFile(new URL("scripts/index.js", this.project.getBehaviorDirectory()), "// Your script code here\n");
            await this.project.saveManifest(new URL("manifest.json", this.project.getBehaviorDirectory()), {
                "format_version": 2,
                "header": {
                    "name": name,
                    "description": description,
                    "uuid": behaviorUuid,
                    "version": [
                        1,
                        0,
                        0
                    ],
                    "min_engine_version": minVersion
                },
                "modules": [
                    {
                        "description": "Script resources",
                        "language": "javascript",
                        "type": "script",
                        "uuid": crypto.randomUUID(),
                        "version": [
                            1,
                            0,
                            0
                        ],
                        "entry": "scripts/index.js"
                    }
                ],
                "dependencies": [
                    {
                        "uuid": resourceUuid,
                        "version": [
                            1,
                            0,
                            0
                        ]
                    }
                ]
            });
        }

        if (!options.noResources) {
            await fs.promises.mkdir(this.project.getResourceDirectory(), {recursive: true});
            await this.project.saveManifest(new URL("manifest.json", this.project.getResourceDirectory()), {
                "format_version": 2,
                "header": {
                    "name": name,
                    "description": description,
                    "uuid": resourceUuid,
                    "version": [
                        1,
                        0,
                        0
                    ],
                    "min_engine_version": minVersion
                },
                "modules": [
                    {
                        "description": "Resource pack",
                        "type": "resources",
                        "uuid": crypto.randomUUID(),
                        "version": [
                            1,
                            0,
                            0
                        ]
                    }
                ],
                "dependencies": [
                    {
                        "uuid": behaviorUuid,
                        "version": [
                            1,
                            0,
                            0
                        ]
                    }
                ]
            });
        }

        console.log("Addon initialized successfully.");
        console.log(`Behavior Pack UUID: ${behaviorUuid}`);
        console.log(`Resource Pack UUID: ${resourceUuid}`);
        return 0;
    }

    /**
     * @param {string} version
     * @return {Promise<string>}
     */
    async resolveBedrockVersion(version) {
        if (!["latest", "preview"].includes(version)) {
            return version;
        }
        let response = await fetch("https://net-secondary.web.minecraft-services.net/api/v1.0/download/links");
        let downloads = await response.json();
        let url = null;
        if (version === "latest") {
            url = downloads.result.links.find(l => l.downloadType === "serverBedrockLinux").downloadUrl;
        } else if (version === "preview") {
            url = downloads.result.links.find(l => l.downloadType === "serverBedrockPreviewLinux").downloadUrl;
        }

        let filename = new URL(url).pathname.split("/").pop();
        let match = filename.match(/bedrock-server-(\d+(?:\.\d+)+)\.zip/);
        if (!match) {
            throw new Error(`Could not resolve version for ${version}`);
        }
        return match[1];
    }

    /**
     * @param {Object} options
     * @param {string} name
     * @param {string} defaultValue
     * @return {Promise<string>}
     */
    async readOption(options, name, defaultValue) {
        if (options[name] !== undefined) {
            return options[name];
        }
        if (options.yes) {
            return defaultValue;
        }

        let response = await this.prompt(`${name} [${defaultValue}]: `);
        if (!response || response.trim() === "") {
            return defaultValue;
        }
        return response.trim();
    }

    async prompt(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise(resolve => {
            rl.question(question, answer => {
                rl.close();
                resolve(answer);
            });
        });
    }
}
