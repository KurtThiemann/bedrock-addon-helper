import type { Fetch } from "../bedrock/version-resolver.ts";

export interface FakeFetch {
    fetch: Fetch;
    readonly calls: string[];
}

/** A fetch that answers the Bedrock download-links API with the given versions. */
export function fakeDownloadLinksFetch(release = "1.26.66.1", preview = "1.26.70.26"): FakeFetch {
    const body = {
        result: {
            links: [
                {
                    downloadType: "serverBedrockLinux",
                    downloadUrl: `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${release}.zip`,
                },
                {
                    downloadType: "serverBedrockPreviewLinux",
                    downloadUrl: `https://www.minecraft.net/bedrockdedicatedserver/bin-linux-preview/bedrock-server-${preview}.zip`,
                },
            ],
        },
    };
    return fakeFetch(() => Response.json(body));
}

export function fakeFetch(respond: (url: string) => Response | Promise<Response>): FakeFetch {
    const calls: string[] = [];
    const fetch: Fetch = async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push(url);
        return respond(url);
    };
    return { fetch, calls };
}
