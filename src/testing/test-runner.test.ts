import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BahError } from "../util/errors.ts";
import { GameTestEvents, runGameTests, type TestResult, type TestSelection } from "./test-runner.ts";

/** A fake server: each command gets the lines it would print. */
function fakeServer(responses: Record<string, readonly string[]>) {
    const events = new GameTestEvents({ settleMs: 5 });
    const sent: string[] = [];
    const send = async (command: string) => {
        sent.push(command);
        const lines = responses[command] ?? [];
        setImmediate(() => {
            for (const line of lines) {
                events.pushLine(line);
            }
        });
    };
    return { events, sent, send };
}

function run(server: ReturnType<typeof fakeServer>, selections: TestSelection[], timeoutMs = 2000) {
    const reported: TestResult[] = [];
    const scripts: string[] = [];
    const report = runGameTests({
        selections,
        send: server.send,
        events: server.events,
        timeoutMs,
        onResult: (result) => reported.push(result),
        onScriptOutput: (level, message) => scripts.push(`${level} ${message}`),
    });
    return { report, reported, scripts };
}

describe("runGameTests", () => {
    it("runs a tag and waits for all announced results", async () => {
        const server = fakeServer({
            "gametest runset bah": [
                "[2026-11-24 13:33:16:775 INFO] Running 2 tests with tag 'bah'...",
                "onTestStructureLoaded: A:one",
                "[2026-11-24 13:33:16:775 WARN] [Scripting] debug output",
                "onTestPassed: A:one",
                "[2026-11-24 13:33:16:775 ERROR] [Scripting] [addon-bp] Error: boom    at f (bp-tests.js:3)",
                "    at <anonymous> (bp-tests.js:9)",
                "",
                "onTestFailed: A:two - Error: boom    at f (bp-tests.js:3)",
                "    at <anonymous> (bp-tests.js:9)",
            ],
        });

        const { report, reported, scripts } = run(server, [{ tag: "bah" }]);

        assert.deepEqual(await report, {
            results: [
                { id: "A:one", passed: true, message: null },
                {
                    id: "A:two",
                    passed: false,
                    message: "Error: boom    at f (bp-tests.js:3)\n    at <anonymous> (bp-tests.js:9)",
                },
            ],
            problems: [],
        });
        assert.equal(reported.length, 2);
        assert.deepEqual(scripts, ["WARN debug output"]);
        assert.deepEqual(server.sent, ["gametest runset bah"]);
    });

    it("passes on script errors that are not a test's failure", async () => {
        const server = fakeServer({
            "gametest runset bah": [
                "[2026-11-24 13:33:16:775 INFO] Running 1 tests with tag 'bah'...",
                "[2026-11-24 13:33:16:775 ERROR] [Scripting] [addon-bp] Error: unrelated",
                "onTestPassed: A:one",
            ],
        });

        const { report, scripts } = run(server, [{ tag: "bah" }]);

        await report;
        assert.deepEqual(scripts, ["ERROR [addon-bp] Error: unrelated"]);
    });

    it("runs single tests and reports unknown ones and empty tags", async () => {
        const server = fakeServer({
            "gametest run A:one": ["onTestStructureLoaded: A:one", "onTestPassed: A:one"],
            "gametest run A:nope": ["[2026-11-24 14:01:05:744 ERROR] Could not find test with name 'A:nope'."],
            "gametest runset empty": ["[2026-11-24 13:34:14:058 ERROR] No tests found for tag 'empty'"],
        });

        const { report } = run(server, [{ test: "A:one" }, { test: "A:nope" }, { tag: "empty" }]);

        assert.deepEqual(await report, {
            results: [{ id: "A:one", passed: true, message: null }],
            problems: ['There is no test "A:nope".', 'No tests have the tag "empty".'],
        });
    });

    it("times out when results stop coming", async () => {
        const server = fakeServer({
            "gametest runset bah": [
                "[2026-11-24 13:33:16:775 INFO] Running 2 tests with tag 'bah'...",
                "onTestPassed: A:one",
            ],
        });

        await assert.rejects(run(server, [{ tag: "bah" }], 100).report, (error) => {
            assert.ok(error instanceof BahError);
            assert.match(error.message, /Timed out after 0 s waiting for 1 test/);
            return true;
        });
    });

    it("fails when the server output ends", async () => {
        const server = fakeServer({});
        const { report } = run(server, [{ tag: "bah" }]);
        setImmediate(() => server.events.end(new BahError("The server stopped.")));

        await assert.rejects(report, /The server stopped/);
    });
});
