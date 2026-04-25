/**
 * Check emitter — verifies real GitHub Checks API contract.
 *
 * QB #14: tests assert headers, URL shape, body, retry behavior — not just
 * that the function returns truthy.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildCheckRunPayload,
  computeOverallConclusion,
  emitAllChecks,
  emitCheckRun,
  mapConclusion,
} from "../../src/pr-checks/check-emitter.js";
import type { PrCheckResult } from "../../src/pr-checks/pr-types.js";

const baseResult = (overrides: Partial<PrCheckResult> = {}): PrCheckResult => ({
  id: "no-todos",
  status: "pass",
  message: "PASS:",
  severity: "blocking",
  durationMs: 12,
  ...overrides,
});

describe("mapConclusion", () => {
  it("PASS → success", () => {
    expect(mapConclusion(baseResult({ status: "pass" }))).toBe("success");
  });

  it("FAIL+blocking → failure", () => {
    expect(mapConclusion(baseResult({ status: "fail", severity: "blocking" }))).toBe("failure");
  });

  it("FAIL+advisory → neutral", () => {
    expect(mapConclusion(baseResult({ status: "fail", severity: "advisory" }))).toBe("neutral");
  });

  it("neutral + error → neutral", () => {
    expect(mapConclusion(baseResult({ status: "neutral" }))).toBe("neutral");
    expect(mapConclusion(baseResult({ status: "error" }))).toBe("neutral");
  });
});

describe("computeOverallConclusion", () => {
  it("any failure dominates", () => {
    const overall = computeOverallConclusion([
      baseResult({ status: "pass" }),
      baseResult({ status: "fail", severity: "blocking" }),
      baseResult({ status: "pass" }),
    ]);
    expect(overall).toBe("failure");
  });

  it("any neutral wins over success", () => {
    const overall = computeOverallConclusion([
      baseResult({ status: "pass" }),
      baseResult({ status: "neutral" }),
    ]);
    expect(overall).toBe("neutral");
  });

  it("all pass → success", () => {
    const overall = computeOverallConclusion([
      baseResult({ status: "pass" }),
      baseResult({ status: "pass" }),
    ]);
    expect(overall).toBe("success");
  });

  it("empty results → success", () => {
    expect(computeOverallConclusion([])).toBe("success");
  });
});

describe("buildCheckRunPayload", () => {
  it("emits required GH Checks fields", () => {
    const payload = buildCheckRunPayload(baseResult(), "abc123");
    expect(payload["name"]).toBe("wotann/no-todos");
    expect(payload["head_sha"]).toBe("abc123");
    expect(payload["status"]).toBe("completed");
    expect(payload["conclusion"]).toBe("success");
    const out = payload["output"] as Record<string, unknown>;
    expect(out["title"]).toContain("PASS");
  });

  it("FAIL + blocking → conclusion=failure", () => {
    const p = buildCheckRunPayload(
      baseResult({ status: "fail", severity: "blocking", message: "FAIL: bad" }),
      "sha",
    );
    expect(p["conclusion"]).toBe("failure");
  });

  it("trims overlong summary", () => {
    const big = "x".repeat(70_000);
    const p = buildCheckRunPayload(baseResult({ message: big }), "sha");
    const out = p["output"] as Record<string, string>;
    expect(out["summary"].length).toBeLessThanOrEqual(65535);
  });
});

describe("emitCheckRun", () => {
  it("validates config — repo without slash", async () => {
    const r = await emitCheckRun(baseResult(), {
      repo: "no-slash",
      headSha: "x",
      token: "y",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/owner\/name/);
  });

  it("rejects empty headSha + token explicitly", async () => {
    const r1 = await emitCheckRun(baseResult(), { repo: "a/b", headSha: "", token: "y" });
    expect(r1.ok).toBe(false);
    const r2 = await emitCheckRun(baseResult(), { repo: "a/b", headSha: "x", token: "" });
    expect(r2.ok).toBe(false);
  });

  it("posts to /repos/{owner}/{name}/check-runs with required headers", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 999 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const r = await emitCheckRun(baseResult(), {
      repo: "owner/name",
      headSha: "abc",
      token: "tok",
      fetchFn: fetchSpy as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    expect(r.checkRunId).toBe(999);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe("https://api.github.com/repos/owner/name/check-runs");
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok");
    expect(headers["Accept"]).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(init.method).toBe("POST");
  });

  it("retries 3 times on transient 503", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      if (calls < 3) return new Response("", { status: 503 });
      return new Response(JSON.stringify({ id: 1 }), { status: 201 });
    });
    const sleeps: number[] = [];
    const r = await emitCheckRun(baseResult(), {
      repo: "a/b",
      headSha: "x",
      token: "y",
      fetchFn: fetchSpy as unknown as typeof fetch,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("returns failure after all retries exhausted", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 503 }));
    const r = await emitCheckRun(baseResult(), {
      repo: "a/b",
      headSha: "x",
      token: "y",
      retries: 2,
      fetchFn: fetchSpy as unknown as typeof fetch,
      sleepFn: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
  });

  it("does NOT retry on 401", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      return new Response("bad token", { status: 401 });
    });
    const r = await emitCheckRun(baseResult(), {
      repo: "a/b",
      headSha: "x",
      token: "y",
      fetchFn: fetchSpy as unknown as typeof fetch,
      sleepFn: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(401);
    expect(calls).toBe(1);
  });

  it("retries on network error and surfaces last error", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      throw new Error(`econnrefused #${calls}`);
    });
    const r = await emitCheckRun(baseResult(), {
      repo: "a/b",
      headSha: "x",
      token: "y",
      retries: 2,
      fetchFn: fetchSpy as unknown as typeof fetch,
      sleepFn: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("econnrefused");
    expect(calls).toBe(2);
  });
});

describe("emitAllChecks", () => {
  it("emits each result and returns array of results in order", async () => {
    let i = 0;
    const fetchSpy = vi.fn(async () => {
      i++;
      return new Response(JSON.stringify({ id: i }), { status: 201 });
    });
    const summary = {
      results: [baseResult({ id: "a" }), baseResult({ id: "b" })],
      overall: "success" as const,
      totalDurationMs: 10,
    };
    const out = await emitAllChecks(summary, {
      repo: "x/y",
      headSha: "sha",
      token: "tok",
      fetchFn: fetchSpy as unknown as typeof fetch,
    });
    expect(out.length).toBe(2);
    expect(out[0]?.checkRunId).toBe(1);
    expect(out[1]?.checkRunId).toBe(2);
  });

  it("continues on per-emit failure", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      return new Response("nope", { status: 422 });
    });
    const summary = {
      results: [baseResult({ id: "a" }), baseResult({ id: "b" })],
      overall: "success" as const,
      totalDurationMs: 0,
    };
    const out = await emitAllChecks(summary, {
      repo: "x/y",
      headSha: "sha",
      token: "tok",
      fetchFn: fetchSpy as unknown as typeof fetch,
      sleepFn: async () => {},
    });
    expect(out.length).toBe(2);
    expect(out.every((e) => !e.ok)).toBe(true);
    expect(calls).toBe(2);
  });
});
