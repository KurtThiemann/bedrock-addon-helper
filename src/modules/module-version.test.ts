import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestBetaFor, manifestVersionOf, newestStable, parseModuleVersion } from "./module-version.ts";

describe("parseModuleVersion", () => {
    it("parses stable versions", () => {
        assert.deepEqual(parseModuleVersion("2.11.0"), { kind: "stable", npm: "2.11.0", base: [2, 11, 0] });
    });

    it("parses release betas", () => {
        assert.deepEqual(parseModuleVersion("2.12.0-beta.1.26.66-stable"), {
            kind: "beta",
            npm: "2.12.0-beta.1.26.66-stable",
            base: [2, 12, 0],
            channel: "stable",
            game: [1, 26, 66],
        });
    });

    it("parses preview betas, including the preview number", () => {
        const parsed = parseModuleVersion("2.13.0-beta.1.26.70-preview.26");
        assert.equal(parsed.kind, "beta");
        assert.ok(parsed.kind === "beta");
        assert.equal(parsed.channel, "preview");
        assert.deepEqual(parsed.game, [1, 26, 70, 26]);
    });

    for (const other of [
        "2.12.0-rc.1.26.70-preview.26",
        "1.0.0-internal.00001b39",
        "1.0.0-beta.00001b37",
        "1.0.0-beta.1.26.66-stable.1",
        "1.0.0-beta.1.26.70-preview",
    ]) {
        it(`treats ${other} as other`, () => assert.equal(parseModuleVersion(other).kind, "other"));
    }
});

describe("manifestVersionOf", () => {
    it("maps npm versions to manifest versions", () => {
        assert.equal(manifestVersionOf(parseModuleVersion("2.11.0")), "2.11.0");
        assert.equal(manifestVersionOf(parseModuleVersion("2.12.0-beta.1.26.66-stable")), "2.12.0-beta");
        assert.equal(manifestVersionOf(parseModuleVersion("2.13.0-beta.1.26.70-preview.26")), "2.13.0-beta");
        assert.equal(manifestVersionOf(parseModuleVersion("2.12.0-rc.1.26.70-preview.26")), null);
    });
});

const versions = [
    "2.9.0",
    "2.11.0",
    "2.10.0",
    "2.11.0-beta.1.26.50-stable",
    "2.12.0-beta.1.26.60-stable",
    "2.12.0-beta.1.26.66-stable",
    "2.13.0-beta.1.26.70-preview.24",
    "2.13.0-beta.1.26.70-preview.26",
].map(parseModuleVersion);

describe("newestStable", () => {
    it("compares numerically", () => {
        assert.equal(newestStable(versions)?.npm, "2.11.0");
    });

    it("returns null without stable versions", () => {
        assert.equal(newestStable([parseModuleVersion("1.0.0-beta.1.26.66-stable")]), null);
    });
});

describe("bestBetaFor", () => {
    it("matches a release by major.minor.patch, ignoring the build number", () => {
        assert.equal(bestBetaFor(versions, [1, 26, 66, 1], "stable")?.npm, "2.12.0-beta.1.26.66-stable");
    });

    it("falls back to the newest older game version", () => {
        assert.equal(bestBetaFor(versions, [1, 26, 63], "stable")?.npm, "2.12.0-beta.1.26.60-stable");
    });

    it("matches previews exactly and keeps channels apart", () => {
        assert.equal(bestBetaFor(versions, [1, 26, 70, 26], "preview")?.npm, "2.13.0-beta.1.26.70-preview.26");
        assert.equal(bestBetaFor(versions, [1, 26, 70, 25], "preview")?.npm, "2.13.0-beta.1.26.70-preview.24");
        assert.equal(bestBetaFor(versions, [1, 26, 40], "stable"), null);
    });

    it("can be limited to an API version", () => {
        assert.equal(bestBetaFor(versions, [1, 26, 66], "stable", [2, 11, 0])?.npm, "2.11.0-beta.1.26.50-stable");
    });
});
