import * as zl from "zip-lib";
import fs from "node:fs";
import FileUtils from "../Util/FileUtils.js";

export default class Addon {
    static NAME_ALLOWED_CHARS = /^[\w-]+$/;

    /** @type {string} */ name;
    /** @type {URL} */ path;
    /** @type {boolean} */ bundle;
    /** @type {Project} */ project;

    /**
     * @param {Object} json
     * @param {Project} project
     * @return {Addon}
     */
    static fromJson(json, project) {
        if (!(json instanceof Object)) {
            throw new TypeError("Expected an object to load an Addon from JSON");
        }

        if (typeof json.name !== 'string' || !Addon.NAME_ALLOWED_CHARS.test(json.name)) {
            throw new TypeError("Invalid 'name' in Addon JSON, expected a string matching " + Addon.NAME_ALLOWED_CHARS);
        }

        return new Addon(
            json.type,
            json.name,
            !!json.bundle,
            project
        );
    }

    /**
     * @return {string}
     * @abstract
     */
    static getType() {

    }

    /**
     * @param {string} type
     * @param {string} name
     * @param {boolean} bundle
     * @param {Project} project
     */
    constructor(type, name, bundle, project) {
        this.type = type;
        this.name = name;
        this.bundle = bundle;
        this.path = new URL(name + "/", project.getProjectPath());
        this.project = project;
    }

    /**
     * @return {string}
     */
    getName() {
        return this.name;
    }

    /**
     * @return {URL}
     */
    getPath() {
        return this.path;
    }

    /**
     * @return {boolean}
     */
    isBundled() {
        return this.bundle;
    }

    /**
     * @return {Project}
     */
    getProject() {
        return this.project;
    }

    /**
     * @return {URL}
     */
    getBuildPath() {
        return new URL(`${this.project.getName()}-${this.name}/`, this.project.getBuildPath());
    }

    /**
     * @param {AddonBuildOptions} options
     * @param {?Logger} logger
     * @return {Promise<AddonBuildResult>}
     * @abstract
     */
    async build(options, logger = null) {

    }

    /**
     * @param {URL} outputDir
     * @return {Promise<URL>}
     */
    async package(outputDir) {
        let output = new URL(`${this.project.getName()}-${this.name}.mcpack`, this.project.getArtifactPath());
        await fs.promises.mkdir(this.project.getArtifactPath(), {recursive: true});
        await fs.promises.rm(output, {force: true});
        await zl.archiveFolder(outputDir.pathname, output.pathname);
        return output;
    }

    /**
     * @return {URL}
     */
    getManifestPath() {
        return new URL("manifest.json", this.getPath());
    }

    /**
     * @return {Promise<Object>}
     */
    async readManifest() {
        return await FileUtils.readJson(this.getManifestPath());
    }

    /**
     * @param {Object} manifest
     * @return {Promise<void>}
     */
    async writeManifest(manifest) {
        await FileUtils.writeJson(this.getManifestPath(), manifest);
    }

    /**
     * @return {Promise<boolean>}
     */
    async exists() {
        return await FileUtils.exists(this.getManifestPath());
    }

    /**
     * @return {{name: string, type: string}}
     */
    toJson() {
        return {
            name: this.name,
            type: this.constructor.getType()
        };
    }
}
