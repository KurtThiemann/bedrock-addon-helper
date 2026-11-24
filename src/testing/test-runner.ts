import { BahError } from "../util/errors.ts";
import { type GameTestLogEvent, GameTestLogParser } from "./gametest-log.ts";

/** What to run: every test with a tag (`gametest runset`), or one test by id (`gametest run`). */
export type TestSelection = { readonly tag: string } | { readonly test: string };

export interface TestResult {
    readonly id: string;
    readonly passed: boolean;
    /** Failure message; null for passed tests. */
    readonly message: string | null;
}

export interface TestRunReport {
    readonly results: readonly TestResult[];
    /** Selections that matched nothing. */
    readonly problems: readonly string[];
}

export interface RunGameTestsOptions {
    readonly selections: readonly TestSelection[];
    /** Sends a console command to the server. */
    readonly send: (command: string) => Promise<void>;
    readonly events: GameTestEvents;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal | undefined;
    readonly onResult?: (result: TestResult) => void;
    readonly onScriptOutput?: (level: string, message: string) => void;
}

/**
 * Runs the selections one after another and collects the results from the
 * server output. A `runset` is finished once as many results arrived as its
 * "Running N tests" line announced.
 */
export async function runGameTests(options: RunGameTestsOptions): Promise<TestRunReport> {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const results: TestResult[] = [];
    const problems: string[] = [];
    // An error thrown in a test is printed as script output and then again as
    // the failure; hold script errors back so such duplicates can be dropped.
    let heldError: { level: string; message: string } | null = null;
    const releaseHeldError = () => {
        if (heldError !== null) {
            options.onScriptOutput?.(heldError.level, heldError.message);
            heldError = null;
        }
    };

    for (const selection of options.selections) {
        const isTag = "tag" in selection;
        let expected: number | null = isTag ? null : 1;
        const finished = new Set<string>();
        await options.send(isTag ? `gametest runset ${selection.tag}` : `gametest run ${selection.test}`);

        while (expected === null || finished.size < expected) {
            let event: GameTestLogEvent;
            try {
                event = await options.events.next(signal);
            } catch (error) {
                if (timeout.aborted) {
                    const waiting = expected === null ? "the tests to start" : `${expected - finished.size} test(s)`;
                    throw new BahError(
                        `Timed out after ${Math.round(options.timeoutMs / 1000)} s waiting for ${waiting}. Raise the limit with --timeout.`,
                        { cause: error },
                    );
                }
                throw error;
            }

            if (event.type === "failed" && heldError !== null && isSameError(heldError.message, event.message)) {
                heldError = null;
            }
            releaseHeldError();

            if (event.type === "script" && event.level === "ERROR") {
                heldError = { level: event.level, message: event.message };
            } else if (event.type === "script") {
                options.onScriptOutput?.(event.level, event.message);
            } else if (event.type === "started" && isTag && event.tag === selection.tag) {
                expected = event.count;
            } else if (event.type === "no-tests" && isTag && event.tag === selection.tag) {
                problems.push(`No tests have the tag "${selection.tag}".`);
                break;
            } else if (event.type === "unknown-test" && !isTag && event.id === selection.test) {
                problems.push(`There is no test "${selection.test}".`);
                break;
            } else if ((event.type === "passed" || event.type === "failed") && !finished.has(event.id)) {
                finished.add(event.id);
                const result: TestResult =
                    event.type === "passed"
                        ? { id: event.id, passed: true, message: null }
                        : { id: event.id, passed: false, message: event.message };
                results.push(result);
                options.onResult?.(result);
            }
        }
        releaseHeldError();
    }
    return { results, problems };
}

/**
 * Whether a script error is the failure of a test, printed a second time:
 * `[pack] Error: boom ...` for an error thrown in a test, or
 * `[pack] Unhandled promise rejection: GameTestError: <message>` for a failed
 * assertion in an async test.
 */
function isSameError(scriptError: string, failure: string): boolean {
    const firstLine = (text: string) => text.split("\n")[0]?.trim() ?? "";
    const failureLine = firstLine(failure);
    return failureLine !== "" && firstLine(scriptError).endsWith(failureLine);
}

/**
 * GameTest events from a stream of server output lines. A message that may
 * continue on more lines is passed on once the next line arrives or the
 * output pauses for `settleMs`.
 */
export class GameTestEvents {
    readonly #parser = new GameTestLogParser();
    readonly #settleMs: number;
    readonly #queue: GameTestLogEvent[] = [];
    #wake: (() => void) | null = null;
    #ended: Error | null = null;
    #settleTimer: NodeJS.Timeout | null = null;

    constructor(options: { settleMs?: number } = {}) {
        this.#settleMs = options.settleMs ?? 250;
    }

    pushLine(line: string): void {
        this.#enqueue(this.#parser.push(line));
        if (this.#settleTimer !== null) {
            clearTimeout(this.#settleTimer);
        }
        this.#settleTimer = setTimeout(() => {
            this.#settleTimer = null;
            this.#enqueue(this.#parser.flush());
        }, this.#settleMs);
        this.#settleTimer.unref();
    }

    /** The output ended; once the queue is drained, `next` rejects with `error`. */
    end(error: Error): void {
        if (this.#settleTimer !== null) {
            clearTimeout(this.#settleTimer);
            this.#settleTimer = null;
        }
        this.#enqueue(this.#parser.flush());
        this.#ended ??= error;
        this.#wake?.();
    }

    async next(signal: AbortSignal): Promise<GameTestLogEvent> {
        while (true) {
            const event = this.#queue.shift();
            if (event !== undefined) {
                return event;
            }
            if (this.#ended !== null) {
                throw this.#ended;
            }
            signal.throwIfAborted();
            await new Promise<void>((resolve) => {
                const done = () => {
                    signal.removeEventListener("abort", done);
                    this.#wake = null;
                    resolve();
                };
                this.#wake = done;
                signal.addEventListener("abort", done, { once: true });
            });
        }
    }

    #enqueue(events: readonly GameTestLogEvent[]): void {
        if (events.length > 0) {
            this.#queue.push(...events);
            this.#wake?.();
        }
    }
}
