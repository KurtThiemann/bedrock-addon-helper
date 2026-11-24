/*
 * The server reports GameTest progress only as console output; there is no
 * script API for results. These are the lines it prints (checked with BDS
 * 1.26.66). None of them are documented, so all knowledge of the format is
 * kept in this file.
 *
 *   Running test batch ':0' (5 tests)...
 *   [2026-11-24 13:33:16:775 INFO] Running 5 tests with tag 'probe'...
 *   onTestStructureLoaded: Smoke:pass
 *   onTestPassed: Smoke:pass
 *   onTestFailed: Smoke:fail - math is broken on purpose
 *   onTestFailed: Smoke:deep - Error: thrown from helper    at helper (main.js:34)
 *       at <anonymous> (main.js:37)
 *   [2026-11-24 14:01:02:548 ERROR] [Scripting] [pack] Error: ...
 *   [2026-11-24 13:34:14:058 ERROR] No tests found for tag 'nope'
 *   [2026-11-24 14:01:05:744 ERROR] Could not find test with name 'Nope:nope'.
 *
 * Failure messages and script output can span several lines (stack frames,
 * console output with line breaks). A message ends at a blank line or at
 * the next line the server prints itself: a timestamped line, or one of the
 * GameTest lines without a timestamp.
 */

export type GameTestLogEvent =
    | { readonly type: "started"; readonly count: number; readonly tag: string }
    | { readonly type: "passed"; readonly id: string }
    | { readonly type: "failed"; readonly id: string; readonly message: string }
    | { readonly type: "no-tests"; readonly tag: string }
    | { readonly type: "unknown-test"; readonly id: string }
    /** Output of scripts (console.*, uncaught errors). */
    | { readonly type: "script"; readonly level: string; readonly message: string };

const TIMESTAMPED = /^\[\d{4}-\d\d-\d\d [\d:]+ ([A-Z]+)\] (.*)$/;
const STARTED = /^Running (\d+) tests? with tag '(.*)'\.\.\.$/;
const NO_TESTS = /^No tests found for tag '(.*)'$/;
const UNKNOWN_TEST = /^Could not find test with name '(.*)'\.$/;
const SCRIPTING = /^\[Scripting\] (.*)$/;
const PASSED = /^onTestPassed: (.+)$/;
const FAILED = /^onTestFailed: (.+?) - (.*)$/;
/** GameTest lines printed without a timestamp. */
const UNTIMESTAMPED = /^(?:onTest\w+: |Running test batch )/;

/** Turns server output, line by line, into GameTest events. */
export class GameTestLogParser {
    /** An event whose message may still continue on the next lines. */
    #pending: GameTestLogEvent | null = null;

    /** Feeds one line (without the line break); returns the events it completed. */
    push(line: string): GameTestLogEvent[] {
        const text = line.trimEnd();
        if (this.#pending !== null && isContinuation(text)) {
            this.#pending = appendLine(this.#pending, text);
            return [];
        }
        const events = this.flush();
        const event = parseLine(text);
        if (event === null) {
            return events;
        }
        if (event.type === "failed" || event.type === "script") {
            this.#pending = event;
            return events;
        }
        return [...events, event];
    }

    /** Returns an event still waiting for continuation lines. */
    flush(): GameTestLogEvent[] {
        const pending = this.#pending;
        this.#pending = null;
        return pending === null ? [] : [pending];
    }
}

function isContinuation(line: string): boolean {
    return line.trim() !== "" && !TIMESTAMPED.test(line) && !UNTIMESTAMPED.test(line);
}

function parseLine(line: string): GameTestLogEvent | null {
    const timestamped = TIMESTAMPED.exec(line);
    if (timestamped) {
        const [, level = "", text = ""] = timestamped;
        return parseLogMessage(level, text);
    }
    const passed = PASSED.exec(line);
    if (passed?.[1] !== undefined) {
        return { type: "passed", id: passed[1] };
    }
    const failed = FAILED.exec(line);
    if (failed?.[1] !== undefined) {
        return { type: "failed", id: failed[1], message: (failed[2] ?? "").trim() };
    }
    return null;
}

function parseLogMessage(level: string, text: string): GameTestLogEvent | null {
    const started = STARTED.exec(text);
    if (started?.[1] !== undefined) {
        return { type: "started", count: Number(started[1]), tag: started[2] ?? "" };
    }
    const noTests = NO_TESTS.exec(text);
    if (noTests?.[1] !== undefined) {
        return { type: "no-tests", tag: noTests[1] };
    }
    const unknown = UNKNOWN_TEST.exec(text);
    if (unknown?.[1] !== undefined) {
        return { type: "unknown-test", id: unknown[1] };
    }
    const scripting = SCRIPTING.exec(text);
    if (scripting?.[1] !== undefined) {
        return { type: "script", level, message: scripting[1].trim() };
    }
    return null;
}

function appendLine(event: GameTestLogEvent, line: string): GameTestLogEvent {
    if (event.type === "failed" || event.type === "script") {
        return { ...event, message: `${event.message}\n${line}` };
    }
    return event;
}
