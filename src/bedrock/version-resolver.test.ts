import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDownloadLinksFetch, fakeFetch } from "../test-support/fake-fetch.ts";
import { BedrockVersionResolver, DOWNLOAD_LINKS_URL, versionFromDownloadUrl } from "./version-resolver.ts";

describe("BedrockVersionResolver", () => {
    it("resolves latest and preview from the download links, fetching once", async () => {
        const fake = fakeDownloadLinksFetch("1.26.66.1", "1.26.70.26");
        const resolver = new BedrockVersionResolver(fake.fetch);

        assert.deepEqual(await resolver.resolve("latest"), [1, 26, 66, 1]);
        assert.deepEqual(await resolver.resolve("preview"), [1, 26, 70, 26]);
        assert.deepEqual(fake.calls, [DOWNLOAD_LINKS_URL]);
    });

    it("returns exact versions without fetching", async () => {
        const fake = fakeDownloadLinksFetch();
        const resolver = new BedrockVersionResolver(fake.fetch);

        assert.deepEqual(await resolver.resolve("1.26.50"), [1, 26, 50]);
        assert.deepEqual(fake.calls, []);
    });

    it("reports HTTP errors and retries on the next call", async () => {
        let status = 503;
        const fake = fakeFetch(() =>
            status === 200
                ? fakeDownloadLinksFetch().fetch(DOWNLOAD_LINKS_URL)
                : new Response("unavailable", { status }),
        );
        const resolver = new BedrockVersionResolver(fake.fetch);

        await assert.rejects(resolver.resolve("latest"), /Could not fetch Bedrock versions: HTTP 503/);
        status = 200;
        assert.deepEqual(await resolver.resolve("latest"), [1, 26, 66, 1]);
    });

    it("rejects unexpected responses", async () => {
        const resolver = new BedrockVersionResolver(fakeFetch(() => Response.json({ links: [] })).fetch);

        await assert.rejects(resolver.resolve("latest"), /Unexpected response/);
    });

    it("reports a missing channel", async () => {
        const resolver = new BedrockVersionResolver(fakeFetch(() => Response.json({ result: { links: [] } })).fetch);

        await assert.rejects(resolver.resolve("preview"), /no preview server download/);
    });
});

describe("versionFromDownloadUrl", () => {
    it("reads the version from the file name", () => {
        assert.deepEqual(
            versionFromDownloadUrl(
                "https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.66.1.zip",
            ),
            [1, 26, 66, 1],
        );
    });

    it("rejects other file names", () => {
        assert.throws(() => versionFromDownloadUrl("https://example.com/server.jar"), /Cannot read the version/);
    });
});
