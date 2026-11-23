import { z } from "zod";
import type { Fetch } from "../bedrock/version-resolver.ts";
import { BahError } from "../util/errors.ts";

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";

/** Abbreviated npm package metadata ("corgi" document); only what we use. */
const packumentSchema = z.object({
    name: z.string(),
    "dist-tags": z.record(z.string(), z.string()),
    versions: z.record(z.string(), z.object({})),
});

export interface PackageVersions {
    readonly name: string;
    readonly distTags: Readonly<Record<string, string>>;
    readonly versions: readonly string[];
}

/** Reads package versions from the npm registry, cached per instance. */
export class NpmRegistry {
    readonly #fetch: Fetch;
    readonly #registry: string;
    readonly #cache = new Map<string, Promise<PackageVersions>>();

    constructor(fetch: Fetch = globalThis.fetch, registry: string = DEFAULT_NPM_REGISTRY) {
        this.#fetch = fetch;
        this.#registry = registry.endsWith("/") ? registry : `${registry}/`;
    }

    /** Uses `npm_config_registry` if set (npm exports it to scripts; users may set it too). */
    static fromEnv(fetch: Fetch, env: Readonly<Record<string, string | undefined>>): NpmRegistry {
        return new NpmRegistry(fetch, env.npm_config_registry || DEFAULT_NPM_REGISTRY);
    }

    getVersions(name: string): Promise<PackageVersions> {
        let entry = this.#cache.get(name);
        if (entry === undefined) {
            entry = this.#load(name);
            entry.catch(() => this.#cache.delete(name));
            this.#cache.set(name, entry);
        }
        return entry;
    }

    async #load(name: string): Promise<PackageVersions> {
        const url = new URL(name.replace("/", "%2F"), this.#registry).href;
        let response: Response;
        try {
            response = await this.#fetch(url, {
                headers: { Accept: "application/vnd.npm.install-v1+json" },
            });
        } catch (error) {
            throw new BahError(`Could not reach the npm registry for ${name}: ${String(error)}`, { cause: error });
        }
        if (response.status === 404) {
            throw new BahError(`Package ${name} does not exist on npm.`);
        }
        if (!response.ok) {
            throw new BahError(`npm registry request for ${name} failed: HTTP ${response.status}`);
        }

        const result = packumentSchema.safeParse(await response.json());
        if (!result.success) {
            throw new BahError(`Unexpected npm registry response for ${name}.`, { cause: result.error });
        }
        return {
            name: result.data.name,
            distTags: result.data["dist-tags"],
            versions: Object.keys(result.data.versions),
        };
    }
}
