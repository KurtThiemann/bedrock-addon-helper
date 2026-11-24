import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type GameTestLogEvent, GameTestLogParser } from "./gametest-log.ts";

function parse(lines: readonly string[]): GameTestLogEvent[] {
    const parser = new GameTestLogParser();
    return [...lines.flatMap((line) => parser.push(line)), ...parser.flush()];
}

describe("GameTestLogParser", () => {
    it("parses a runset as printed by BDS 1.26.66", () => {
        const events = parse([
            "[2026-11-24 13:33:11:180 INFO] Server started.",
            "Running test batch ':0' (5 tests)...",
            "[2026-11-24 13:33:16:775 INFO] Running 5 tests with tag 'bah'...",
            "onTestStructureLoaded: Smoke:pass",
            "onTestPassed: Smoke:pass",
            "onTestFailed: Smoke:fail - math is broken on purpose",
            "[2026-11-24 13:33:17:841 INFO] Player Spawned: Bot xuid: , pfid: ",
            "[2026-11-24 14:01:02:548 ERROR] [Scripting] [addon-bp] Error: thrown from helper    at helper (bp-tests.js:34)",
            "    at <anonymous> (bp-tests.js:37)",
            "",
            "",
            "onTestFailed: Smoke:deep - Error: thrown from helper    at helper (bp-tests.js:34)",
            "    at <anonymous> (bp-tests.js:37)",
            "",
            "onTestFailed: Smoke:timeout - Didn't succeed or fail within 40 ticks",
        ]);

        assert.deepEqual(events, [
            { type: "started", count: 5, tag: "bah" },
            { type: "passed", id: "Smoke:pass" },
            { type: "failed", id: "Smoke:fail", message: "math is broken on purpose" },
            {
                type: "script",
                level: "ERROR",
                message:
                    "[addon-bp] Error: thrown from helper    at helper (bp-tests.js:34)\n    at <anonymous> (bp-tests.js:37)",
            },
            {
                type: "failed",
                id: "Smoke:deep",
                message: "Error: thrown from helper    at helper (bp-tests.js:34)\n    at <anonymous> (bp-tests.js:37)",
            },
            { type: "failed", id: "Smoke:timeout", message: "Didn't succeed or fail within 40 ticks" },
        ]);
    });

    it("recognizes missing tags and tests", () => {
        assert.deepEqual(
            parse([
                "[2026-11-24 13:34:14:058 ERROR] No tests found for tag 'nope'",
                "[2026-11-24 14:01:05:744 ERROR] Could not find test with name 'Nope:nope'.",
            ]),
            [
                { type: "no-tests", tag: "nope" },
                { type: "unknown-test", id: "Nope:nope" },
            ],
        );
    });

    it("keeps multi-line messages together until the server prints its next line", () => {
        assert.deepEqual(
            parse([
                "[2026-11-24 13:33:10:121 WARN] [Scripting] origin 1 -60 4",
                "y=-1 grass",
                "y=0 air",
                "onTestPassed: A:b",
                "onTestFailed: A:c - first",
                "second",
                "[2026-11-24 13:33:10:121 INFO] something else",
                "not a continuation",
            ]),
            [
                { type: "script", level: "WARN", message: "origin 1 -60 4\ny=-1 grass\ny=0 air" },
                { type: "passed", id: "A:b" },
                { type: "failed", id: "A:c", message: "first\nsecond" },
            ],
        );
    });

    it("handles a test id containing ' - '", () => {
        assert.deepEqual(parse(["onTestFailed: A:b - c - boom"]), [{ type: "failed", id: "A:b", message: "c - boom" }]);
    });
});
