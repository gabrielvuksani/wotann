/**
 * Tests for src/utils/marker-polling.ts — Terminus-KIRA-style marker wrap +
 * double-confirmation polling.
 *
 * Test strategy:
 *   - `markerWrap` — pure string-transform tests (deterministic via injected uuid)
 *   - `findMarker` / `stripMarker` — pure buffer ops
 *   - `pollForMarker` — fake ChunkSource + fake clock where possible
 *   - `spawnWithMarker` — end-to-end with real /bin/sh, kept small
 */

import { describe, it, expect } from "vitest";
import {
  markerWrap,
  findMarker,
  stripMarker,
  pollForMarker,
  spawnWithMarker,
  TimedOutWithoutMarker,
  type ChunkSource,
} from "../../src/utils/marker-polling.js";

describe("markerWrap", () => {
  it("appends a marker printf to the user command", () => {
    const { cmdWithMarker, marker } = markerWrap("echo hi", {
      uuid: "deadbeef-1234-4000-8000-000000000001",
    });
    expect(marker).toBe("__CMD_DONE_deadbeef-1234-4000-8000-000000000001__");
    expect(cmdWithMarker).toBe(
      `echo hi; printf '\\n%s\\n' '__CMD_DONE_deadbeef-1234-4000-8000-000000000001__'`,
    );
  });

  it("generates a unique marker per call when uuid is not provided", () => {
    const a = markerWrap("ls");
    const b = markerWrap("ls");
    expect(a.marker).not.toBe(b.marker);
    expect(a.marker).toMatch(/^__CMD_DONE_[A-Za-z0-9-]+__$/);
  });

  it("folds sessionId into the marker when supplied", () => {
    const { marker } = markerWrap("ls", {
      uuid: "11111111-2222-4333-8444-555555555555",
      sessionId: "sess-alpha",
    });
    expect(marker).toBe("__CMD_DONE_11111111-2222-4333-8444-555555555555_sessalpha__");
  });

  it("sanitizes adversarial sessionId salt — shell metas cannot escape", () => {
    // Salt with quotes, semicolons, backticks — all should be dropped.
    const { marker, cmdWithMarker } = markerWrap("true", {
      uuid: "abcd-ef01-4234-8567-890abcdef012",
      sessionId: "bad'`;rm -rf /",
    });
    expect(marker).not.toContain("'");
    expect(marker).not.toContain("`");
    expect(marker).not.toContain(";");
    expect(marker).not.toContain(" ");
    expect(marker).toMatch(/^__CMD_DONE_[A-Za-z0-9-]+_[A-Za-z0-9]+__$/);
    // The printf line still has exactly one marker surrounded by single quotes.
    expect(cmdWithMarker.split("'").length).toBe(5);
  });

  it("uses `;` (not `&&`) so failing commands still emit the marker", () => {
    const { cmdWithMarker } = markerWrap("false", {
      uuid: "00000000-0000-4000-8000-000000000000",
    });
    expect(cmdWithMarker).toContain("; printf");
    expect(cmdWithMarker).not.toContain("&& printf");
  });

  it("preserves user command verbatim even with quotes/backticks", () => {
    const tricky = `echo "a'b\`c\\d"`;
    const { cmdWithMarker } = markerWrap(tricky, {
      uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(cmdWithMarker.startsWith(tricky + ";")).toBe(true);
  });
});

describe("findMarker", () => {
  it("returns found=false when marker is absent", () => {
    const r = findMarker("no marker here", "__CMD_DONE_x__");
    expect(r.found).toBe(false);
    expect(r.index).toBe(-1);
    expect(r.endIndex).toBe(-1);
  });

  it("returns indices bracketing the marker", () => {
    const buf = "before\n__CMD_DONE_x__\nafter";
    const r = findMarker(buf, "__CMD_DONE_x__");
    expect(r.found).toBe(true);
    expect(buf.slice(r.index, r.endIndex)).toBe("__CMD_DONE_x__");
  });
});

describe("stripMarker", () => {
  it("removes marker + the \\n<marker>\\n bracket markerWrap inserts", () => {
    // markerWrap inserts `\n<marker>\n` after the user command. stripMarker
    // must undo exactly that insertion, so the user content's final \n and
    // the post-marker content appear joined without the inserted pair.
    const buf = "user-output\n__CMD_DONE_abc__\n";
    expect(stripMarker(buf, "__CMD_DONE_abc__")).toBe("user-output");
  });

  it("strips leading user-content newline and post-marker newline separately", () => {
    // When the agent adds its own content before and after (rare; the marker
    // should always be terminal), stripMarker still removes the inserted
    // `\n<marker>\n` boundary. Content adjacent to the marker is preserved.
    const buf = "line1\nline2\n__CMD_DONE_abc__\ntrailing";
    // Removes the \n immediately before the marker and the \n immediately
    // after — everything else stays as-is.
    expect(stripMarker(buf, "__CMD_DONE_abc__")).toBe("line1\nline2trailing");
  });

  it("returns buffer unchanged when marker is absent", () => {
    expect(stripMarker("hello", "__CMD_DONE_abc__")).toBe("hello");
  });

  it("handles marker at end-of-buffer without trailing newline", () => {
    const buf = "hello\n__CMD_DONE_abc__";
    expect(stripMarker(buf, "__CMD_DONE_abc__")).toBe("hello");
  });
});

// ── pollForMarker with a scripted ChunkSource ─────────

/** Build a ChunkSource that yields scripted chunks in order. */
function scriptedSource(chunks: ReadonlyArray<string>): ChunkSource {
  let i = 0;
  return {
    read(): string {
      if (i < chunks.length) {
        const c = chunks[i]!;
        i += 1;
        return c;
      }
      return "";
    },
  };
}

describe("pollForMarker", () => {
  it("returns the output stripped of the marker when marker is seen immediately", async () => {
    const marker = "__CMD_DONE_TEST__";
    const source = scriptedSource(["hello world\n", `\n${marker}\n`, ""]);
    const r = await pollForMarker(source, marker, {
      pollIntervalMs: 1,
      doubleConfirmMs: 5,
      timeoutMs: 2000,
    });
    expect(r.done).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.output).toBe("hello world\n");
  });

  it("collects trailing bytes arriving within the double-confirm window", async () => {
    const marker = "__CMD_DONE_TRAIL__";
    // Marker appears first, then one trailing chunk within double-confirm.
    let step = 0;
    const source: ChunkSource = {
      read(): string {
        step += 1;
        if (step === 1) return `line1\n\n${marker}\n`;
        if (step === 2) return "TRAIL-BYTES";
        return "";
      },
    };
    const r = await pollForMarker(source, marker, {
      pollIntervalMs: 1,
      doubleConfirmMs: 30,
      timeoutMs: 2000,
    });
    expect(r.done).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.output).toBe("line1\n");
    expect(r.trailing).toContain("TRAIL-BYTES");
  });

  it("honest timeout: no marker → done=false, timedOut=true, output retained", async () => {
    const marker = "__CMD_DONE_MISSING__";
    const source = scriptedSource(["partial output", " more", " never-marker"]);
    const r = await pollForMarker(source, marker, {
      pollIntervalMs: 2,
      doubleConfirmMs: 5,
      timeoutMs: 30,
    });
    expect(r.done).toBe(false);
    expect(r.timedOut).toBe(true);
    // Output should be whatever we accumulated so caller can inspect it.
    expect(r.output.length).toBeGreaterThan(0);
  });

  it("streaming: marker arrives mid-stream after many chunks", async () => {
    const marker = "__CMD_DONE_MID__";
    const chunks: string[] = [];
    for (let i = 0; i < 10; i++) chunks.push(`chunk-${i.toString()} `);
    chunks.push(`done\n\n${marker}\n`);
    const source = scriptedSource(chunks);
    const r = await pollForMarker(source, marker, {
      pollIntervalMs: 1,
      doubleConfirmMs: 5,
      timeoutMs: 2000,
    });
    expect(r.done).toBe(true);
    expect(r.output).toContain("chunk-0 ");
    expect(r.output).toContain("chunk-9 ");
    expect(r.output).not.toContain(marker);
  });

  it("calls source.close() exactly once", async () => {
    const marker = "__CMD_DONE_CLOSE__";
    let closeCount = 0;
    const source: ChunkSource = {
      read(): string {
        return `\n${marker}\n`;
      },
      close(): void {
        closeCount += 1;
      },
    };
    await pollForMarker(source, marker, {
      pollIntervalMs: 1,
      doubleConfirmMs: 5,
      timeoutMs: 2000,
    });
    expect(closeCount).toBe(1);
  });

  it("respects AbortSignal — cancellation short-circuits the wait", async () => {
    const marker = "__CMD_DONE_ABORT__";
    const source: ChunkSource = {
      read(): string {
        return ""; // never produces anything
      },
    };
    const ac = new AbortController();
    const p = pollForMarker(source, marker, {
      pollIntervalMs: 1000,
      doubleConfirmMs: 5,
      timeoutMs: 5000,
      signal: ac.signal,
    });
    // Abort almost immediately.
    setTimeout(() => {
      ac.abort();
    }, 10);
    const r = await p;
    expect(r.done).toBe(false);
    expect(r.timedOut).toBe(true);
  });

  it("TimedOutWithoutMarker error class exposes the marker and partial output", () => {
    const err = new TimedOutWithoutMarker("__CMD_DONE_X__", "partial", 500);
    expect(err.name).toBe("TimedOutWithoutMarker");
    expect(err.marker).toBe("__CMD_DONE_X__");
    expect(err.partialOutput).toBe("partial");
    expect(err.timeoutMs).toBe(500);
    expect(err.timedOutWithoutMarker).toBe(true);
  });
});

describe("concurrent markerWrap calls", () => {
  it("two parallel invocations get different markers — no cross-contamination", () => {
    const a = markerWrap("ls -la", { sessionId: "sess-one" });
    const b = markerWrap("pwd", { sessionId: "sess-two" });
    expect(a.marker).not.toBe(b.marker);
    expect(a.cmdWithMarker).toContain(a.marker);
    expect(b.cmdWithMarker).toContain(b.marker);
    expect(a.cmdWithMarker).not.toContain(b.marker);
    expect(b.cmdWithMarker).not.toContain(a.marker);
  });
});

// ── spawnWithMarker — real /bin/sh integration ────────

describe("spawnWithMarker — integration with /bin/sh", () => {
  it("round-trip: echo is correctly stripped of the marker", async () => {
    const r = await spawnWithMarker("echo HELLO-POLL-TEST", {
      timeoutMs: 3000,
      doubleConfirmMs: 30,
      pollIntervalMs: 5,
    });
    expect(r.done).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("HELLO-POLL-TEST");
    expect(r.output).not.toContain(r.marker);
    // Exit code is 0 from /bin/sh completing normally.
    expect(r.exitCode).toBe(0);
  });

  it("failing command still emits marker — done=true, exitCode non-zero ignored intentionally by marker path", async () => {
    const r = await spawnWithMarker("false", {
      timeoutMs: 3000,
      doubleConfirmMs: 30,
      pollIntervalMs: 5,
    });
    // Marker printed via `;` so done must be true even for a failing command.
    expect(r.done).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.output).not.toContain(r.marker);
  });

  it("commands with quotes and backticks do not break the marker", async () => {
    const r = await spawnWithMarker(`printf 'quoted: %s\\n' "ab'cd"`, {
      timeoutMs: 3000,
      doubleConfirmMs: 30,
      pollIntervalMs: 5,
    });
    expect(r.done).toBe(true);
    expect(r.output).toContain("quoted: ab'cd");
    expect(r.output).not.toContain(r.marker);
  });

  it("long-ish command completes cleanly — no premature read", async () => {
    // ~150ms sleep followed by output: a naive early-read agent would have
    // returned empty before the output arrived. With marker polling we only
    // return AFTER the marker, so the output must be non-empty.
    const cmd = `sh -c 'sleep 0.15 && echo DONE-AFTER-DELAY'`;
    const r = await spawnWithMarker(cmd, {
      timeoutMs: 4000,
      doubleConfirmMs: 50,
      pollIntervalMs: 5,
    });
    expect(r.done).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain("DONE-AFTER-DELAY");
  });
});
