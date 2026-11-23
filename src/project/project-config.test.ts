import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ProjectConfig, projectConfigSchema } from "./project-config.ts";

function issues(config: unknown): string[] {
    const result = projectConfigSchema.safeParse(config);
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const valid: ProjectConfig = {
    name: "my-addon",
    packs: [
        {
            name: "main",
            type: "behavior",
            path: "packs/main",
            dependencies: ["main-rp"],
            scripts: { entry: "scripts/main.ts" },
        },
        { name: "main-rp", type: "resource", path: "packs/main-rp", bundle: false, dependencies: ["main"] },
    ],
};

describe("projectConfigSchema", () => {
    it("accepts a valid config, including mutual dependencies", () => {
        assert.deepEqual(issues(valid), []);
    });

    it("accepts a project without packs", () => {
        assert.deepEqual(issues({ name: "empty", packs: [] }), []);
    });

    it("rejects unknown keys", () => {
        assert.match(issues({ ...valid, nmae: "typo" }).join("\n"), /nmae/);
    });

    it("rejects duplicate pack names", () => {
        const config = {
            name: "x",
            packs: [
                { name: "a", type: "behavior", path: "a" },
                { name: "a", type: "resource", path: "b" },
            ],
        };
        assert.deepEqual(issues(config), ['packs.1.name: duplicate pack name "a"']);
    });

    it("rejects overlapping pack paths", () => {
        const config = {
            name: "x",
            packs: [
                { name: "a", type: "behavior", path: "packs/a" },
                { name: "b", type: "resource", path: "packs/a/nested" },
                { name: "c", type: "resource", path: "packs/a/" },
            ],
        };
        assert.equal(issues(config).length, 3);
    });

    it("does not treat a shared name prefix as overlap", () => {
        const config = {
            name: "x",
            packs: [
                { name: "a", type: "behavior", path: "packs/main" },
                { name: "b", type: "resource", path: "packs/main-rp" },
            ],
        };
        assert.deepEqual(issues(config), []);
    });

    for (const path of ["build/pack", ".bah", "node_modules/x", "."]) {
        it(`rejects the reserved pack path ${path}`, () => {
            const config = { name: "x", packs: [{ name: "a", type: "behavior", path }] };
            assert.match(
                issues(config).join("\n"),
                /must not be the project root or inside build, \.bah, node_modules/,
            );
        });
    }

    it("rejects unknown and self dependencies", () => {
        const config = {
            name: "x",
            packs: [{ name: "a", type: "behavior", path: "a", dependencies: ["a", "missing"] }],
        };
        assert.deepEqual(issues(config), [
            "packs.0.dependencies.0: a pack cannot depend on itself",
            'packs.0.dependencies.1: unknown pack "missing"',
        ]);
    });

    it("rejects scripts on resource packs", () => {
        const config = {
            name: "x",
            packs: [{ name: "a", type: "resource", path: "a", scripts: { entry: "scripts/main.js" } }],
        };
        assert.deepEqual(issues(config), ["packs.0.scripts: only behavior packs can have scripts"]);
    });

    it("rejects script entries that are not .js or .ts", () => {
        const config = {
            name: "x",
            packs: [{ name: "a", type: "behavior", path: "a", scripts: { entry: "scripts/main.py" } }],
        };
        assert.equal(issues(config).length, 1);
    });
});
