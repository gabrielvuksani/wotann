/**
 * V9 T11.3 — Anthropic Managed Agents cloud-offload adapter tests.
 *
 * Covers the HTTP-level choreography against the public-beta
 * Anthropic Managed Agents REST API:
 *   - request body shape (buildSessionSpec)
 *   - response parsing (parseAnthropicSessionResponse)
 *   - state mapping (mapAnthropicStateToSession)
 *   - lifecycle (start → status → cancel → list)
 *   - failure path (4xx / 5xx → session status = "failed")
 *   - cost accrual (active-hour rate, monotonic, clock-safe)
 *   - security (apiKey never leaks into CloudOffloadSession / URL)
 *   - isolation (two adapters never share session state)
 *
 * All HTTP traffic is mocked via an injected AnthropicFetcher — this
 * suite never touches the real Anthropic API.
 */

import { describe, it, expect, vi } from "vitest";
import type {
  CloudSnapshot,
  StartOffloadOptions,
} from "../../../src/providers/cloud-offload/adapter.js";
import {
  buildSessionSpec,
  createAnthropicManagedCloudOffloadAdapter,
  mapAnthropicStateToSession,
  parseAnthropicSessionResponse,
  type AnthropicFetchInit,
  type AnthropicFetchResponse,
  type AnthropicFetcher,
} from "../../../src/providers/cloud-offload/anthropic-managed.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    capturedAt: 1_700_000_000_000,
    cwd: "/tmp/anthropic-test",
    gitHead: "abc123",
    gitStatus: "",
    envAllowlist: { PATH: "/usr/bin", LANG: "en_US.UTF-8" },
    sizeBytes: 0,
    warnings: [],
    ...overrides,
  };
}

function makeStartOpts(overrides: Partial<StartOffloadOptions> = {}): StartOffloadOptions {
  return {
    task: "run some code",
    snapshot: makeSnapshot(),
    ...overrides,
  };
}

/** Build a mock fetcher that returns a canned response for every call. */
function stubFetcher(
  response: AnthropicFetchResponse,
): ReturnType<typeof vi.fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>> {
  return vi
    .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
    .mockResolvedValue(response);
}

/** Canned Anthropic JSON response helper. */
function anthropicResponse(payload: unknown, status = 200): AnthropicFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    json: async () => payload,
  };
}

// ── buildSessionSpec ─────────────────────────────────────────────────────

describe("buildSessionSpec", () => {
  it("includes task at the top level", () => {
    const spec = buildSessionSpec({
      task: "refactor the auth module",
      snapshot: makeSnapshot(),
    });
    expect((spec as Record<string, unknown>).task).toBe("refactor the auth module");
  });

  it("serializes snapshot into snake_case snapshot_ref", () => {
    const spec = buildSessionSpec({
      task: "x",
      snapshot: makeSnapshot({
        capturedAt: 1_700_000_000_000,
        cwd: "/home/u/project",
        gitHead: "deadbeef",
        gitStatus: " M file.ts",
        envAllowlist: { PATH: "/usr/bin" },
        sizeBytes: 1024,
      }),
    });
    const ref = (spec as { snapshot_ref: Record<string, unknown> }).snapshot_ref;
    expect(ref.captured_at).toBe(1_700_000_000_000);
    expect(ref.cwd).toBe("/home/u/project");
    expect(ref.git_head).toBe("deadbeef");
    expect(ref.git_status).toBe(" M file.ts");
    expect(ref.env_allowlist).toEqual({ PATH: "/usr/bin" });
    expect(ref.size_bytes).toBe(1024);
  });

  it("omits budget_usd when not provided", () => {
    const spec = buildSessionSpec({ task: "x", snapshot: makeSnapshot() });
    expect((spec as Record<string, unknown>).budget_usd).toBeUndefined();
  });

  it("forwards budget_usd + max_duration_ms when provided", () => {
    const spec = buildSessionSpec({
      task: "x",
      snapshot: makeSnapshot(),
      budgetUsd: 1.5,
      maxDurationMs: 60_000,
    });
    expect((spec as Record<string, unknown>).budget_usd).toBe(1.5);
    expect((spec as Record<string, unknown>).max_duration_ms).toBe(60_000);
  });

  it("includes memory_export_path and tarball_path when present", () => {
    const spec = buildSessionSpec({
      task: "x",
      snapshot: makeSnapshot({
        memoryExportPath: "/tmp/memory.json",
        tarballPath: "/tmp/snapshot.tar.gz",
      }),
    });
    const ref = (spec as { snapshot_ref: Record<string, unknown> }).snapshot_ref;
    expect(ref.memory_export_path).toBe("/tmp/memory.json");
    expect(ref.tarball_path).toBe("/tmp/snapshot.tar.gz");
  });

  it("is pure: same input produces deep-equal output", () => {
    const snap = makeSnapshot();
    const a = buildSessionSpec({ task: "hello", snapshot: snap, budgetUsd: 2 });
    const b = buildSessionSpec({ task: "hello", snapshot: snap, budgetUsd: 2 });
    expect(a).toEqual(b);
  });

  it("does not mutate the input snapshot envAllowlist", () => {
    const allowlist = { A: "1", B: "2" };
    const snap = makeSnapshot({ envAllowlist: allowlist });
    const spec = buildSessionSpec({ task: "x", snapshot: snap });
    const envCopy = (spec as { snapshot_ref: { env_allowlist: Record<string, unknown> } })
      .snapshot_ref.env_allowlist;
    (envCopy as Record<string, string>).C = "3";
    expect(allowlist).toEqual({ A: "1", B: "2" });
  });
});

// ── parseAnthropicSessionResponse ───────────────────────────────────────

describe("parseAnthropicSessionResponse", () => {
  it("extracts session_id + status from a well-formed response", () => {
    const parsed = parseAnthropicSessionResponse({
      session_id: "sess-xyz",
      status: "running",
      extra: "ignored",
    });
    expect(parsed).toEqual({ sessionId: "sess-xyz", status: "running" });
  });

  it("returns null when session_id is missing", () => {
    expect(parseAnthropicSessionResponse({ status: "running" })).toBeNull();
  });

  it("returns null when status is missing", () => {
    expect(parseAnthropicSessionResponse({ session_id: "sess-xyz" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseAnthropicSessionResponse(null)).toBeNull();
    expect(parseAnthropicSessionResponse("string")).toBeNull();
    expect(parseAnthropicSessionResponse(42)).toBeNull();
    expect(parseAnthropicSessionResponse(undefined)).toBeNull();
  });

  it("returns null when session_id is an empty string", () => {
    expect(parseAnthropicSessionResponse({ session_id: "", status: "running" })).toBeNull();
  });
});

// ── mapAnthropicStateToSession ──────────────────────────────────────────

describe("mapAnthropicStateToSession", () => {
  it("maps pending / queued / starting → pending", () => {
    expect(mapAnthropicStateToSession("pending")).toBe("pending");
    expect(mapAnthropicStateToSession("queued")).toBe("pending");
    expect(mapAnthropicStateToSession("starting")).toBe("pending");
  });

  it("maps running / active → running", () => {
    expect(mapAnthropicStateToSession("running")).toBe("running");
    expect(mapAnthropicStateToSession("active")).toBe("running");
  });

  it("maps completed / succeeded / finished → completed", () => {
    expect(mapAnthropicStateToSession("completed")).toBe("completed");
    expect(mapAnthropicStateToSession("succeeded")).toBe("completed");
    expect(mapAnthropicStateToSession("finished")).toBe("completed");
  });

  it("maps failed / errored / error → failed", () => {
    expect(mapAnthropicStateToSession("failed")).toBe("failed");
    expect(mapAnthropicStateToSession("errored")).toBe("failed");
    expect(mapAnthropicStateToSession("error")).toBe("failed");
  });

  it("maps cancelled / canceled / aborted → cancelled", () => {
    expect(mapAnthropicStateToSession("cancelled")).toBe("cancelled");
    expect(mapAnthropicStateToSession("canceled")).toBe("cancelled");
    expect(mapAnthropicStateToSession("aborted")).toBe("cancelled");
  });

  it("defaults unknown states to running (optimistic)", () => {
    expect(mapAnthropicStateToSession("newfangled-state")).toBe("running");
  });
});

// ── Adapter behavior ─────────────────────────────────────────────────────

describe("createAnthropicManagedCloudOffloadAdapter — start()", () => {
  it("returns a session with provider 'anthropic-managed'", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
      now: () => 1000,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.provider).toBe("anthropic-managed");
    expect(session.sessionId).toMatch(/^anthropic-/);
  });

  it("POSTs to /v1/agents/sessions with x-api-key header", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-xyz",
      fetcher,
    });
    await adapter.start(makeStartOpts());
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/agents/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-xyz",
        }),
      }),
    );
  });

  it("honors a custom baseUrl override", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      baseUrl: "https://proxy.internal/anthropic",
      fetcher,
    });
    await adapter.start(makeStartOpts());
    expect(fetcher).toHaveBeenCalledWith(
      "https://proxy.internal/anthropic/v1/agents/sessions",
      expect.any(Object),
    );
  });

  it("flips session to 'failed' on 4xx API response (QB #6 honest failure)", async () => {
    const fetcher = stubFetcher(anthropicResponse("forbidden", 403));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-bad",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
    expect(session.endedAt).toBeDefined();
  });

  it("flips session to 'failed' on 5xx API response (QB #6 honest failure)", async () => {
    const fetcher = stubFetcher(anthropicResponse("server error", 503));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
    expect(session.endedAt).toBeDefined();
  });

  it("flips session to 'failed' when response JSON is malformed", async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      text: async () => "not json",
      json: async () => {
        throw new Error("unexpected token");
      },
    });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("flips session to 'failed' when response shape lacks session_id", async () => {
    const fetcher = stubFetcher(anthropicResponse({ unrelated: "field" }));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("emits 'error' and 'done' frames on 4xx", async () => {
    const fetcher = stubFetcher(anthropicResponse("forbidden", 403));
    const frames: string[] = [];
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    await adapter.start(
      makeStartOpts({
        onFrame: (f) => frames.push(f.kind),
      }),
    );
    expect(frames).toContain("error");
    expect(frames).toContain("done");
  });

  it("uses injected clock for startedAt", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
      now: () => 42_000,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.startedAt).toBe(42_000);
  });

  it("forwards budget_usd and max_duration_ms into the POST body", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    await adapter.start(
      makeStartOpts({
        budgetUsd: 2.5,
        maxDurationMs: 120_000,
      }),
    );
    const callArgs = fetcher.mock.calls[0];
    expect(callArgs).toBeDefined();
    const parsedBody = JSON.parse(callArgs![1].body as string) as Record<string, unknown>;
    expect(parsedBody.budget_usd).toBe(2.5);
    expect(parsedBody.max_duration_ms).toBe(120_000);
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — cancel()", () => {
  it("returns false for an unknown session id", async () => {
    const fetcher = stubFetcher(anthropicResponse({}, 200));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const ok = await adapter.cancel("nope");
    expect(ok).toBe(false);
  });

  it("POSTs to /v1/agents/sessions/:id/cancel", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // create
      anthropicResponse({}, 200), // cancel
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? anthropicResponse({}, 200));
      });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(true);

    const cancelCall = fetcher.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].endsWith("/cancel"),
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall![1].method).toBe("POST");
  });

  it("marks session cancelled without network when no remote session was assigned", async () => {
    // Create a session that fails boot → no remoteSessionId recorded.
    const fetcher = stubFetcher(anthropicResponse("server error", 500));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");

    // Cancelling a failed session still returns true & flips to cancelled,
    // without hitting the network (no remote session to cancel).
    const callsBefore = fetcher.mock.calls.length;
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(true);
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });

  it("surfaces cancel failure as false when API returns 4xx", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // create ok
      anthropicResponse("forbidden", 403), // cancel fails
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? anthropicResponse("", 500));
      });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(false);
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — status()", () => {
  it("returns null for an unknown session id", async () => {
    const fetcher = stubFetcher(anthropicResponse({}));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const result = await adapter.status("never-existed");
    expect(result).toBeNull();
  });

  it("reflects Anthropic state transitions into session status", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "pending" }), // create
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // status poll 1
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(
          next ?? anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
        );
      });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const s1 = await adapter.start(makeStartOpts());
    expect(s1.status).toBe("pending");
    const s2 = await adapter.status(s1.sessionId);
    expect(s2?.status).toBe("running");
  });

  it("marks session completed when remote returns 404 (session expired)", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "pending" }),
      anthropicResponse("not found", 404),
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? anthropicResponse("", 404));
      });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const s = await adapter.start(makeStartOpts());
    const updated = await adapter.status(s.sessionId);
    expect(updated?.status).toBe("completed");
    expect(updated?.endedAt).toBeDefined();
  });

  it("promotes to completed/failed/cancelled when the remote returns a terminal state", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // create
      anthropicResponse({ session_id: "remote-sess-1", status: "completed" }), // status
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(
          next ?? anthropicResponse({ session_id: "remote-sess-1", status: "completed" }),
        );
      });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const s = await adapter.start(makeStartOpts());
    const updated = await adapter.status(s.sessionId);
    expect(updated?.status).toBe("completed");
    expect(updated?.endedAt).toBeDefined();
  });

  it("short-circuits once a session is finalized (no extra network call)", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // create
      anthropicResponse({ session_id: "remote-sess-1", status: "completed" }), // status → finalize
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? anthropicResponse("", 500));
      });
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const s = await adapter.start(makeStartOpts());
    await adapter.status(s.sessionId); // → completed
    const callsBefore = fetcher.mock.calls.length;
    await adapter.status(s.sessionId); // short-circuit
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — cost accrual", () => {
  it("accrues ~$0.04 after half an active-hour at the default $0.08/hr rate", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // create
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }), // status
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(
          next ?? anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
        );
      });

    // Advance the injected clock by 30 minutes between start and status.
    let t = 0;
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
      now: () => t,
    });

    await adapter.start(makeStartOpts());
    t = 30 * 60 * 1000; // 30 minutes later
    const sessions = await adapter.list();
    const sessionId = sessions[0]!.sessionId;
    const updated = await adapter.status(sessionId);

    // 0.5h * $0.08/hr = $0.04
    expect(updated?.costUsd).toBeCloseTo(0.04, 4);
  });

  it("accepts a custom hourlyActiveUsd override", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(
          next ?? anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
        );
      });

    let t = 0;
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
      now: () => t,
      hourlyActiveUsd: 1.0, // $1/hr
    });

    await adapter.start(makeStartOpts());
    t = 60 * 60 * 1000; // 1 hour later
    const sessions = await adapter.list();
    const sessionId = sessions[0]!.sessionId;
    const updated = await adapter.status(sessionId);
    expect(updated?.costUsd).toBeCloseTo(1.0, 4);
  });

  it("clamps negative time deltas to zero cost (clock-safe)", async () => {
    const responses: AnthropicFetchResponse[] = [
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
      anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
    ];
    const fetcher = vi
      .fn<[string, AnthropicFetchInit], Promise<AnthropicFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(
          next ?? anthropicResponse({ session_id: "remote-sess-1", status: "running" }),
        );
      });

    let t = 10_000;
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
      now: () => t,
    });

    await adapter.start(makeStartOpts());
    t = 5_000; // clock regresses (NTP skew etc.)
    const sessions = await adapter.list();
    const sessionId = sessions[0]!.sessionId;
    const updated = await adapter.status(sessionId);
    expect(updated?.costUsd).toBe(0);
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — list()", () => {
  it("returns all sessions created by this adapter without network calls", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    await adapter.start(makeStartOpts({ task: "task-A" }));
    await adapter.start(makeStartOpts({ task: "task-B" }));
    const callsBefore = fetcher.mock.calls.length;
    const sessions = await adapter.list();
    expect(sessions.length).toBe(2);
    // list() is a pure read from the internal Map — no fetcher calls.
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });

  it("returns an empty list for a fresh adapter", async () => {
    const fetcher = stubFetcher(anthropicResponse({}));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const sessions = await adapter.list();
    expect(sessions).toEqual([]);
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — isolation (QB #7)", () => {
  it("two factory instances never share session state", async () => {
    const fetcherA = stubFetcher(
      anthropicResponse({ session_id: "rem-A", status: "pending" }),
    );
    const fetcherB = stubFetcher(
      anthropicResponse({ session_id: "rem-B", status: "pending" }),
    );
    const adapterA = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-A",
      fetcher: fetcherA,
    });
    const adapterB = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-B",
      fetcher: fetcherB,
    });

    const sA = await adapterA.start(makeStartOpts());
    const sB = await adapterB.start(makeStartOpts());

    const listA = await adapterA.list();
    const listB = await adapterB.list();

    expect(listA.length).toBe(1);
    expect(listB.length).toBe(1);
    expect(listA[0]?.sessionId).toBe(sA.sessionId);
    expect(listB[0]?.sessionId).toBe(sB.sessionId);

    // Cross-lookup returns null.
    const crossLookup = await adapterA.status(sB.sessionId);
    expect(crossLookup).toBeNull();
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — security", () => {
  it("never includes the apiKey in the CloudOffloadSession snapshot", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "running" }),
    );
    const API_KEY = "sk-ant-super-secret-abcdef-anthropic-managed";
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: API_KEY,
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain("super-secret");
    // Also check list() output.
    const sessions = await adapter.list();
    expect(JSON.stringify(sessions)).not.toContain(API_KEY);
  });

  it("NEVER invokes the fetcher with the apiKey embedded in the URL", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const API_KEY = "sk-ant-very-secret-1234567890";
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: API_KEY,
      fetcher,
    });
    await adapter.start(makeStartOpts());
    await adapter.status((await adapter.list())[0]!.sessionId);
    // Inspect EVERY call's URL — the key must never appear there.
    for (const [url] of fetcher.mock.calls) {
      expect(url).not.toContain(API_KEY);
      expect(url).not.toContain("very-secret");
    }
  });

  it("onFrame listener throwing does NOT take the session down", async () => {
    const fetcher = stubFetcher(
      anthropicResponse({ session_id: "sess-1", status: "pending" }),
    );
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    // If the listener throws on every call, start() should still complete.
    const session = await adapter.start(
      makeStartOpts({
        onFrame: () => {
          throw new Error("listener bug");
        },
      }),
    );
    expect(session.sessionId).toBeTruthy();
  });
});

describe("createAnthropicManagedCloudOffloadAdapter — fetcher signature", () => {
  it("accepts a minimal AnthropicFetcher stub without RequestInit", async () => {
    const fetcher: AnthropicFetcher = vi
      .fn()
      .mockResolvedValue(anthropicResponse({ session_id: "sess-1", status: "pending" }));
    const adapter = createAnthropicManagedCloudOffloadAdapter({
      apiKey: "sk-ant-test",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session).toBeDefined();
  });
});
