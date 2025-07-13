export default class BedrockVersionResolver {
    /** @type {?string} */ release = null;
    /** @type {?string} */ preview = null;

    /**
     * @param {string} version
     * @return {Promise<string>}
     */
    async resolve(version) {
        if (version === "latest") {
            return this.getLatestRelease();
        } else if (version === "preview") {
            return this.getLatestPreview();
        }

        if (!/\d+(\.\d+)+/.test(version)) {
            throw new Error(`Invalid version format: ${version}. Expected a version number or 'latest'/'preview'.`);
        }

        return version;
    }

    /**
     * @return {Promise<string>}
     */
    async getLatestRelease() {
        if (!this.release) {
            await this.loadVersions();
        }
        return this.release;
    }

    /**
     * @return {Promise<string>}
     */
    async getLatestPreview() {
        if (!this.preview) {
            await this.loadVersions();
        }
        return this.preview;
    }

    /**
     * @return {Promise<void>}
     */
    async loadVersions() {
        let response = await fetch("https://net-secondary.web.minecraft-services.net/api/v1.0/download/links");
        let downloads = await response.json();
        if (!Array.isArray(!downloads?.result?.links)) {
            throw new Error("Failed to fetch Bedrock version download links.");
        }

        let links = downloads.result.links;
        let releaseLink = links.find(l => l.downloadType === "serverBedrockLinux");
        let previewLink = links.find(l => l.downloadType === "serverBedrockPreviewLinux");
        if (!releaseLink || !previewLink) {
            throw new Error("Failed to find Bedrock server download links.");
        }
        this.release = this.getVersionFromLink(releaseLink.downloadUrl);
        this.preview = this.getVersionFromLink(previewLink.downloadUrl);
    }

    /**
     * @param {string} url
     * @return {string}
     */
    getVersionFromLink(url) {
        let filename = new URL(url).pathname.split("/").pop();
        let match = filename.match(/bedrock-server-(\d+(?:\.\d+)+)\.zip/);
        if (!match) {
            throw new Error(`Could not resolve version from URL: ${url}`);
        }
        return match[1];
    }
}
