import { DOWNLOAD_LINKS_URL } from "../bedrock/version-resolver.ts";
import { type FakeFetch, fakeDownloadLinksFetch, fakeFetch } from "./fake-fetch.ts";

export interface FakePackage {
    versions: string[];
    distTags?: Record<string, string>;
}

/** Realistic slice of the @minecraft packages on npm. */
export const MINECRAFT_PACKAGES: Record<string, FakePackage> = {
    "@minecraft/server": {
        versions: [
            "2.10.0",
            "2.11.0",
            "2.11.0-beta.1.26.50-stable",
            "2.12.0-beta.1.26.60-stable",
            "2.12.0-beta.1.26.66-stable",
            "2.12.0-rc.1.26.70-preview.26",
            "2.13.0-beta.1.26.70-preview.24",
            "2.13.0-beta.1.26.70-preview.26",
        ],
        distTags: { latest: "2.11.0", beta: "2.12.0-beta.1.26.66-stable" },
    },
    "@minecraft/server-ui": {
        versions: ["2.3.0", "2.4.0-beta.1.26.60-stable", "2.4.0-beta.1.26.66-stable"],
        distTags: { latest: "2.3.0" },
    },
    "@minecraft/server-gametest": {
        // 0.1.0 is a real, years-old stable release that must not be picked.
        versions: ["0.1.0", "1.0.0-beta.1.26.60-stable", "1.0.0-beta.1.26.66-stable", "1.0.0-beta.1.26.70-preview.26"],
        distTags: { latest: "1.0.0-beta.1.21.60-preview.24" },
    },
    "@minecraft/math": {
        versions: ["2.3.1", "2.4.0", "2.4.1"],
        distTags: { latest: "2.4.1" },
    },
    "@minecraft/vanilla-data": {
        versions: ["1.26.60", "1.26.70-preview.26"],
        distTags: { latest: "1.26.60", preview: "1.26.70-preview.26" },
    },
};

/**
 * A fetch serving the given packages as an npm registry, plus the Bedrock
 * download links (release 1.26.66.1, preview 1.26.70.26).
 */
export function fakeNpmFetch(packages: Record<string, FakePackage> = MINECRAFT_PACKAGES): FakeFetch {
    const downloads = fakeDownloadLinksFetch("1.26.66.1", "1.26.70.26");
    return fakeFetch((url) => {
        if (url === DOWNLOAD_LINKS_URL) {
            return downloads.fetch(url);
        }
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        const pkg = packages[name];
        if (pkg === undefined) {
            return new Response("not found", { status: 404 });
        }
        return Response.json({
            name,
            "dist-tags": pkg.distTags ?? {},
            versions: Object.fromEntries(pkg.versions.map((version) => [version, { name, version }])),
        });
    });
}
