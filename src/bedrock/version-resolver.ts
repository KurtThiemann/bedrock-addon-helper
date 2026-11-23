import { z } from "zod";
import type { BedrockVersionSpec } from "../server/server-config.ts";
import { BahError } from "../util/errors.ts";
import { type BedrockVersion, parseBedrockVersion } from "./version.ts";

export const DOWNLOAD_LINKS_URL = "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links";

const downloadLinksSchema = z.object({
    result: z.object({
        links: z.array(z.object({ downloadType: z.string(), downloadUrl: z.url() })),
    }),
});

export type ReleaseChannel = "latest" | "preview";

const DOWNLOAD_TYPES: Record<ReleaseChannel, string> = {
    latest: "serverBedrockLinux",
    preview: "serverBedrockPreviewLinux",
};

export type Fetch = typeof globalThis.fetch;

/**
 * Resolves `latest` / `preview` to concrete Bedrock versions using the
 * official dedicated server download links. Results are cached per instance.
 */
export class BedrockVersionResolver {
    readonly #fetch: Fetch;
    #links: Promise<Map<string, string>> | null = null;

    constructor(fetch: Fetch = globalThis.fetch) {
        this.#fetch = fetch;
    }

    async resolve(spec: BedrockVersionSpec): Promise<BedrockVersion> {
        if (spec === "latest" || spec === "preview") {
            return this.latest(spec);
        }
        return parseBedrockVersion(spec);
    }

    async latest(channel: ReleaseChannel): Promise<BedrockVersion> {
        const links = await this.#loadLinks();
        const url = links.get(DOWNLOAD_TYPES[channel]);
        if (url === undefined) {
            throw new BahError(`The Bedrock download API returned no ${channel} server download.`);
        }
        return versionFromDownloadUrl(url);
    }

    #loadLinks(): Promise<Map<string, string>> {
        this.#links ??= this.#fetchLinks().catch((error: unknown) => {
            this.#links = null;
            throw error;
        });
        return this.#links;
    }

    async #fetchLinks(): Promise<Map<string, string>> {
        let data: unknown;
        try {
            const response = await this.#fetch(DOWNLOAD_LINKS_URL);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            data = await response.json();
        } catch (error) {
            throw new BahError(`Could not fetch Bedrock versions: ${errorMessage(error)}`, { cause: error });
        }

        const result = downloadLinksSchema.safeParse(data);
        if (!result.success) {
            throw new BahError("Unexpected response from the Bedrock download API.", { cause: result.error });
        }
        return new Map(result.data.result.links.map((link) => [link.downloadType, link.downloadUrl]));
    }
}

/** Extracts `1.26.66.1` from `.../bedrock-server-1.26.66.1.zip`. */
export function versionFromDownloadUrl(url: string): BedrockVersion {
    const fileName = new URL(url).pathname.split("/").pop() ?? "";
    const match = /^bedrock-server-(\d+(?:\.\d+)+)\.zip$/.exec(fileName);
    if (!match?.[1]) {
        throw new BahError(`Cannot read the version from download URL ${url}`);
    }
    return parseBedrockVersion(match[1]);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
