/**
 * V9 T11.3 — Cloudflare Agents cloud-offload adapter tests.
 *
 * Covers the HTTP-level choreography against Cloudflare's Workers REST API:
 *   - request body shape (buildDurableObjectInvocation)
 *   - response parsing (parseCloudflareAgentResponse) — envelope + flat
 *   - state mapping (mapCloudflareStateToSession)
 *   - lifecycle (start → status → cancel → list)
 *   - failure paths (4xx & 5xx → session status = "failed")
 *   - security (bearer token never leaks into CloudOffloadSession or URL)
 *   - isolation (two adapters never share session state)
 *   - $0 idle cost USP (costUsd stays at $0 at boot)
 *
 * All HTTP traffic is mocked via an injected CfFetcher — this suite
 * never touches the real Cloudflare API.
 */

import { describe, it, expect, vi } from "vitest";
import type { CloudSnapshot, StartOffloadOptions } from "../../../src/providers/cloud-offload/adapter.js";
import {
  buildDurableObjectInvocation,
  createCloudflareAgentsCloudOffloadAdapter,
  mapCloudflareStateToSession,
  parseCloudflareAgentResponse,
  type CfFetchInit,
  type CfFetchResponse,
  type CfFetcher,
} from "../../../src/providers/cloud-offload/cloudflare-agents.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    capturedAt: 1_700_000_000_000,
    cwd: "/tmp/cf-test",
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
  response: CfFetchResponse,
): ReturnType<typeof vi.fn<[string, CfFetchInit], Promise<CfFetchResponse>>> {
  return vi.fn<[string, CfFetchInit], Promise<CfFetchResponse>>().mockResolvedValue(response);
}

/** Canned Cloudflare JSON response helper — uses the wrapped envelope by default. */
function cfResponse(payload: unknown, status = 200): CfFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    json: async () => payload,
  };
}

/** Helper that wraps a DO object in Cloudflare's `{ success, result }` envelope. */
function cfEnvelope(result: Record<string, unknown>, status = 200): CfFetchResponse {
  return cfResponse({ success: true, result }, status);
}

// ── buildDurableObjectInvocation ─────────────────────────────────────────

describe("buildDurableObjectInvocation", () => {
  it("includes task verbatim", () => {
    const body = buildDurableObjectInvocation({
      task: "hello world",
      snapshot: makeSnapshot(),
    });
    expect(body.task).toBe("hello world");
  });

  it("flattens snapshot fields into snapshot_ref", () => {
    const body = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot({
        cwd: "/app",
        gitHead: "deadbeef",
        gitStatus: "M foo.ts",
        envAllowlist: { PATH: "/bin" },
        sizeBytes: 123,
      }),
    });
    const ref = body.snapshot_ref as Record<string, unknown>;
    expect(ref.cwd).toBe("/app");
    expect(ref.git_head).toBe("deadbeef");
    expect(ref.git_status).toBe("M foo.ts");
    expect(ref.env_allowlist).toEqual({ PATH: "/bin" });
    expect(ref.size_bytes).toBe(123);
  });

  it("copies envAllowlist into snapshot_ref without aliasing the source", () => {
    const source = { A: "1", B: "2" };
    const body = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot({ envAllowlist: source }),
    });
    const copied = (body.snapshot_ref as { env_allowlist: Record<string, string> }).env_allowlist;
    expect(copied).toEqual({ A: "1", B: "2" });
    // Mutate copy; source must not change.
    copied.C = "3";
    expect(source).toEqual({ A: "1", B: "2" });
  });

  it("omits optional tarball_path when snapshot does not have one", () => {
    const body = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot(),
    });
    const ref = body.snapshot_ref as Record<string, unknown>;
    expect("tarball_path" in ref).toBe(false);
  });

  it("passes through tarball_path when snapshot includes one", () => {
    const body = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot({ tarballPath: "/tmp/snap.tar.gz" }),
    });
    const ref = body.snapshot_ref as Record<string, unknown>;
    expect(ref.tarball_path).toBe("/tmp/snap.tar.gz");
  });

  it("includes budget_usd when provided, omits when absent", () => {
    const withBudget = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot(),
      budgetUsd: 5,
    });
    expect(withBudget.budget_usd).toBe(5);

    const withoutBudget = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot(),
    });
    expect("budget_usd" in withoutBudget).toBe(false);
  });

  it("includes max_ms when maxDurationMs provided", () => {
    const body = buildDurableObjectInvocation({
      task: "t",
      snapshot: makeSnapshot(),
      maxDurationMs: 60_000,
    });
    expect(body.max_ms).toBe(60_000);
  });

  it("is pure — two calls with the same input produce deep-equal output", () => {
    const snap = makeSnapshot();
    const a = buildDurableObjectInvocation({ task: "t", snapshot: snap, budgetUsd: 3 });
    const b = buildDurableObjectInvocation({ task: "t", snapshot: snap, budgetUsd: 3 });
    expect(a).toEqual(b);
  });
});

// ── parseCloudflareAgentResponse ─────────────────────────────────────────

describe("parseCloudflareAgentResponse", () => {
  it("extracts object_id + state from a Cloudflare-envelope response", () => {
    const parsed = parseCloudflareAgentResponse({
      success: true,
      result: { object_id: "do-abc", state: "running" },
    });
    expect(parsed).toEqual({ objectId: "do-abc", state: "running" });
  });

  it("extracts from flat (unwrapped) response too", () => {
    const parsed = parseCloudflareAgentResponse({ object_id: "do-abc", state: "running" });
    expect(parsed).toEqual({ objectId: "do-abc", state: "running" });
  });

  it("accepts camelCase objectId alongside snake_case", () => {
    const parsed = parseCloudflareAgentResponse({ objectId: "do-x", state: "idle" });
    expect(parsed).toEqual({ objectId: "do-x", state: "idle" });
  });

  it("returns null for non-object input", () => {
    expect(parseCloudflareAgentResponse(null)).toBeNull();
    expect(parseCloudflareAgentResponse("string")).toBeNull();
    expect(parseCloudflareAgentResponse(42)).toBeNull();
    expect(parseCloudflareAgentResponse(undefined)).toBeNull();
  });

  it("returns null when object_id is missing", () => {
    expect(parseCloudflareAgentResponse({ state: "running" })).toBeNull();
  });

  it("returns null when state is missing", () => {
    expect(parseCloudflareAgentResponse({ object_id: "do-1" })).toBeNull();
  });

  it("returns null when object_id is an empty string", () => {
    expect(parseCloudflareAgentResponse({ object_id: "", state: "running" })).toBeNull();
  });
});

// ── mapCloudflareStateToSession ──────────────────────────────────────────

describe("mapCloudflareStateToSession", () => {
  it("maps created → pending", () => {
    expect(mapCloudflareStateToSession("created")).toBe("pending");
  });

  it("maps running / idle / active → running", () => {
    expect(mapCloudflareStateToSession("running")).toBe("running");
    expect(mapCloudflareStateToSession("idle")).toBe("running");
    expect(mapCloudflareStateToSession("active")).toBe("running");
  });

  it("maps destroyed → completed", () => {
    expect(mapCloudflareStateToSession("destroyed")).toBe("completed");
  });

  it("maps errored / failed → failed", () => {
    expect(mapCloudflareStateToSession("errored")).toBe("failed");
    expect(mapCloudflareStateToSession("failed")).toBe("failed");
  });

  it("maps cancelled → cancelled", () => {
    expect(mapCloudflareStateToSession("cancelled")).toBe("cancelled");
  });

  it("defaults unknown states to running (optimistic)", () => {
    expect(mapCloudflareStateToSession("newfangled-state")).toBe("running");
  });
});

// ── Adapter behavior — start() ───────────────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — start()", () => {
  it("returns a session with provider 'cloudflare-agents'", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "secret-token",
      accountId: "acct-123",
      namespaceId: "ns-456",
      fetcher,
      now: () => 1000,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.provider).toBe("cloudflare-agents");
    expect(session.sessionId).toMatch(/^cf-/);
  });

  it("POSTs to the DO endpoint with the Authorization bearer header", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "secret-token-xyz",
      accountId: "acct-prod",
      namespaceId: "ns-prod",
      fetcher,
    });
    await adapter.start(makeStartOpts());

    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toContain("/accounts/acct-prod/workers/scripts/wotann-cloud-agent");
    expect(url).toContain("/namespaces/ns-prod/objects/");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-token-xyz" });
  });

  it("uses a configured scriptName when provided", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "a",
      namespaceId: "n",
      scriptName: "custom-script",
      fetcher,
    });
    await adapter.start(makeStartOpts());
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toContain("/workers/scripts/custom-script");
  });

  it("uses a configured baseUrl when provided", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "a",
      namespaceId: "n",
      baseUrl: "https://mock.test.local/v4",
      fetcher,
    });
    await adapter.start(makeStartOpts());
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0].startsWith("https://mock.test.local/v4")).toBe(true);
  });

  it("flips session to 'failed' on 4xx API response (honest failure)", async () => {
    const fetcher = stubFetcher(cfResponse("invalid account", 403));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "bad-token",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
    expect(session.endedAt).toBeDefined();
  });

  it("flips session to 'failed' on 5xx API response (honest failure)", async () => {
    const fetcher = stubFetcher(cfResponse("internal error", 503));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("flips session to 'failed' when JSON is malformed", async () => {
    const fetcher = stubFetcher({
      ok: true,
      status: 200,
      text: async () => "not json",
      json: async () => {
        throw new Error("unexpected token");
      },
    });
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("flips session to 'failed' when response shape lacks object_id/state", async () => {
    const fetcher = stubFetcher(cfResponse({ irrelevant: "field" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("emits 'error' frame on 4xx", async () => {
    const fetcher = stubFetcher(cfResponse("forbidden", 403));
    const frames: string[] = [];
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
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

  it("emits 'error' frame on 5xx", async () => {
    const fetcher = stubFetcher(cfResponse("overloaded", 500));
    const frames: string[] = [];
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    await adapter.start(
      makeStartOpts({
        onFrame: (f) => frames.push(f.kind),
      }),
    );
    expect(frames).toContain("error");
  });

  it("uses injected clock for startedAt", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
      now: () => 42_000,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.startedAt).toBe(42_000);
  });

  it("costUsd is $0 at boot — the Cloudflare $0-idle USP demonstrated", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "idle" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.costUsd).toBe(0);
    const cost = await adapter.list();
    expect(cost[0]?.costUsd).toBe(0);
  });

  it("forwards envAllowlist into snapshot_ref (NO secrets added)", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "secret",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    await adapter.start(
      makeStartOpts({
        snapshot: makeSnapshot({ envAllowlist: { ONLY_THIS: "visible" } }),
      }),
    );
    const callArgs = fetcher.mock.calls[0];
    expect(callArgs).toBeDefined();
    const parsedBody = JSON.parse(callArgs![1].body as string) as {
      snapshot_ref: { env_allowlist: Record<string, unknown> };
    };
    expect(parsedBody.snapshot_ref.env_allowlist).toEqual({ ONLY_THIS: "visible" });
    // Bearer token NEVER leaks into request body.
    expect(parsedBody.snapshot_ref.env_allowlist).not.toHaveProperty("CF_API_TOKEN");
    expect(JSON.stringify(parsedBody.snapshot_ref.env_allowlist)).not.toContain("secret");
  });
});

// ── cancel() ─────────────────────────────────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — cancel()", () => {
  it("returns false for an unknown session id", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const ok = await adapter.cancel("nope");
    expect(ok).toBe(false);
  });

  it("issues DELETE against the DO object path", async () => {
    const responses: CfFetchResponse[] = [
      cfEnvelope({ object_id: "do-xyz", state: "running" }),
      cfResponse({ success: true }, 200),
    ];
    const fetcher = vi
      .fn<[string, CfFetchInit], Promise<CfFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? cfResponse({}, 200));
      });
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(true);

    const methods = fetcher.mock.calls.map((args) => args[1]?.method);
    expect(methods).toContain("DELETE");

    // DELETE must target the /objects/:objectId path.
    const deleteCall = fetcher.mock.calls.find((args) => args[1]?.method === "DELETE");
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toContain("/objects/");
  });

  it("marks session cancelled without network when DO was never provisioned", async () => {
    const fetcher = stubFetcher(cfResponse("server error", 500));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");

    const callsBefore = fetcher.mock.calls.length;
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(true);
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });

  it("returns false and emits error frame on cancel 4xx", async () => {
    const responses: CfFetchResponse[] = [
      cfEnvelope({ object_id: "do-1", state: "running" }),
      cfResponse("conflict", 409),
    ];
    const fetcher = vi
      .fn<[string, CfFetchInit], Promise<CfFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? cfResponse({}, 200));
      });
    const frames: string[] = [];
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const s = await adapter.start(
      makeStartOpts({
        onFrame: (f) => frames.push(f.kind),
      }),
    );
    const ok = await adapter.cancel(s.sessionId);
    expect(ok).toBe(false);
    expect(frames).toContain("error");
  });
});

// ── status() ─────────────────────────────────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — status()", () => {
  it("returns null for an unknown session id", async () => {
    const fetcher = stubFetcher(cfResponse({}));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const result = await adapter.status("never-existed");
    expect(result).toBeNull();
  });

  it("reflects DO state transitions into session status and updates the internal map", async () => {
    const responses: CfFetchResponse[] = [
      cfEnvelope({ object_id: "do-1", state: "created" }), // create
      cfEnvelope({ object_id: "do-1", state: "running" }), // status poll 1
    ];
    const fetcher = vi
      .fn<[string, CfFetchInit], Promise<CfFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? cfEnvelope({ object_id: "do-1", state: "running" }));
      });
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const s1 = await adapter.start(makeStartOpts());
    expect(s1.status).toBe("pending");
    const s2 = await adapter.status(s1.sessionId);
    expect(s2?.status).toBe("running");

    // list() now reflects the freshest known state without a second poll.
    const allSessions = await adapter.list();
    expect(allSessions[0]?.status).toBe("running");
  });

  it("marks session completed when DO is 404 (auto-destroyed)", async () => {
    const responses: CfFetchResponse[] = [
      cfEnvelope({ object_id: "do-1", state: "running" }),
      cfResponse("not found", 404),
    ];
    const fetcher = vi
      .fn<[string, CfFetchInit], Promise<CfFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? cfResponse("", 404));
      });
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const s = await adapter.start(makeStartOpts());
    const updated = await adapter.status(s.sessionId);
    expect(updated?.status).toBe("completed");
    expect(updated?.endedAt).toBeDefined();
  });

  it("short-circuits for already-finalized sessions (no extra network hit)", async () => {
    const responses: CfFetchResponse[] = [
      cfEnvelope({ object_id: "do-1", state: "running" }),
      cfResponse("not found", 404),
    ];
    const fetcher = vi
      .fn<[string, CfFetchInit], Promise<CfFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? cfResponse({ success: true }, 200));
      });
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const s = await adapter.start(makeStartOpts());
    // First status → observes 404 → completed
    await adapter.status(s.sessionId);
    const callsAfterFirst = fetcher.mock.calls.length;
    // Second status on completed session — no additional fetch
    await adapter.status(s.sessionId);
    expect(fetcher.mock.calls.length).toBe(callsAfterFirst);
  });
});

// ── list() ──────────────────────────────────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — list()", () => {
  it("returns all sessions created by this adapter without a network hit", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    await adapter.start(makeStartOpts({ task: "task-A" }));
    await adapter.start(makeStartOpts({ task: "task-B" }));
    const callsBefore = fetcher.mock.calls.length;

    const sessions = await adapter.list();
    expect(sessions.length).toBe(2);

    // list() itself must not trigger network calls.
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });

  it("returns an empty list for a fresh adapter", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const sessions = await adapter.list();
    expect(sessions).toEqual([]);
  });
});

// ── isolation (QB #7 per-session state) ──────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — isolation", () => {
  it("two factory instances never share session state", async () => {
    const fetcherA = stubFetcher(cfEnvelope({ object_id: "do-A", state: "running" }));
    const fetcherB = stubFetcher(cfEnvelope({ object_id: "do-B", state: "running" }));
    const adapterA = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "tokA",
      accountId: "acct-A",
      namespaceId: "ns-A",
      fetcher: fetcherA,
    });
    const adapterB = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "tokB",
      accountId: "acct-B",
      namespaceId: "ns-B",
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

// ── Security ─────────────────────────────────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — security", () => {
  it("never includes the API token in the CloudOffloadSession snapshot", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const TOKEN = "sk-super-secret-abcdef-cloudflare-token";
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: TOKEN,
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("secret");

    const sessions = await adapter.list();
    expect(JSON.stringify(sessions)).not.toContain(TOKEN);
  });

  it("never places the API token in the URL (bearer header only)", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const TOKEN = "sk-unique-url-check-token";
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: TOKEN,
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    await adapter.start(makeStartOpts());

    // The URL in every call must never contain the token.
    for (const call of fetcher.mock.calls) {
      expect(call[0]).not.toContain(TOKEN);
    }
    // But the Authorization header of each call MUST.
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("onFrame listener throwing does NOT take the session down", async () => {
    const fetcher = stubFetcher(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
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

// ── Fetcher signature sanity ────────────────────────────────────────────

describe("createCloudflareAgentsCloudOffloadAdapter — fetcher signature", () => {
  it("accepts a minimal CfFetcher stub without RequestInit", async () => {
    const fetcher: CfFetcher = vi
      .fn()
      .mockResolvedValue(cfEnvelope({ object_id: "do-1", state: "running" }));
    const adapter = createCloudflareAgentsCloudOffloadAdapter({
      apiToken: "t",
      accountId: "acct",
      namespaceId: "ns",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session).toBeDefined();
  });
});
