/**
 * V9 T11.3 — Fly Sprites cloud-offload adapter tests.
 *
 * Covers the HTTP-level choreography against Fly's machines API:
 *   - request body shape (buildMachineSpec)
 *   - response parsing (parseFlyMachineResponse)
 *   - state mapping (mapFlyStateToSession)
 *   - lifecycle (start → status → cancel → list)
 *   - failure path (4xx API response → session status = "failed")
 *   - security (bearer token never leaks into CloudOffloadSession)
 *   - isolation (two adapters never share session state)
 *
 * All HTTP traffic is mocked via an injected FlyFetcher — this suite
 * never touches the real Fly API.
 */

import { describe, it, expect, vi } from "vitest";
import type { CloudSnapshot, StartOffloadOptions } from "../../../src/providers/cloud-offload/adapter.js";
import {
  buildMachineSpec,
  createFlyCloudOffloadAdapter,
  mapFlyStateToSession,
  parseFlyMachineResponse,
  type FlyFetchInit,
  type FlyFetchResponse,
  type FlyFetcher,
} from "../../../src/providers/cloud-offload/fly-sprites.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    capturedAt: 1_700_000_000_000,
    cwd: "/tmp/fly-test",
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
function stubFetcher(response: FlyFetchResponse): ReturnType<typeof vi.fn<[string, FlyFetchInit], Promise<FlyFetchResponse>>> {
  return vi.fn<[string, FlyFetchInit], Promise<FlyFetchResponse>>().mockResolvedValue(response);
}

/** Canned Fly JSON response helper. */
function flyResponse(payload: unknown, status = 200): FlyFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    json: async () => payload,
  };
}

// ── buildMachineSpec ──────────────────────────────────────────────────────

describe("buildMachineSpec", () => {
  it("shapes config.image from imageRef", () => {
    const spec = buildMachineSpec({
      imageRef: "registry.fly.io/wotann-cloud-agent:v1",
      region: "iad",
      cpuCount: 2,
      memoryMb: 2048,
      env: { FOO: "bar" },
      cmd: ["/bin/echo", "hi"],
    });
    const config = (spec as { config: Record<string, unknown> }).config;
    expect(config.image).toBe("registry.fly.io/wotann-cloud-agent:v1");
  });

  it("places region at the top level", () => {
    const spec = buildMachineSpec({
      imageRef: "img",
      region: "dfw",
      cpuCount: 1,
      memoryMb: 512,
      env: {},
      cmd: ["/noop"],
    });
    expect((spec as Record<string, unknown>).region).toBe("dfw");
  });

  it("includes guest.cpu_kind, guest.cpus, guest.memory_mb", () => {
    const spec = buildMachineSpec({
      imageRef: "img",
      region: "iad",
      cpuCount: 4,
      memoryMb: 4096,
      env: {},
      cmd: ["/noop"],
    });
    const guest = ((spec as { config: { guest: Record<string, unknown> } }).config.guest);
    expect(guest.cpu_kind).toBe("shared");
    expect(guest.cpus).toBe(4);
    expect(guest.memory_mb).toBe(4096);
  });

  it("copies env into config.env without mutating input", () => {
    const env = { A: "1", B: "2" };
    const spec = buildMachineSpec({
      imageRef: "img",
      region: "iad",
      cpuCount: 1,
      memoryMb: 512,
      env,
      cmd: ["/noop"],
    });
    const configEnv = (spec as { config: { env: Record<string, unknown> } }).config.env;
    expect(configEnv).toEqual({ A: "1", B: "2" });
    // Mutate returned env; input must not change.
    (configEnv as Record<string, string>).C = "3";
    expect(env).toEqual({ A: "1", B: "2" });
  });

  it("places cmd inside config.init.cmd as an array", () => {
    const spec = buildMachineSpec({
      imageRef: "img",
      region: "iad",
      cpuCount: 1,
      memoryMb: 512,
      env: {},
      cmd: ["/wotann-entrypoint", "--task-b64", "xyz"],
    });
    const cmd = ((spec as { config: { init: { cmd: unknown[] } } }).config.init.cmd);
    expect(Array.isArray(cmd)).toBe(true);
    expect(cmd).toEqual(["/wotann-entrypoint", "--task-b64", "xyz"]);
  });

  it("auto-destroys on shutdown to avoid cost leaks", () => {
    const spec = buildMachineSpec({
      imageRef: "img",
      region: "iad",
      cpuCount: 1,
      memoryMb: 512,
      env: {},
      cmd: ["/noop"],
    });
    const config = (spec as { config: Record<string, unknown> }).config;
    expect(config.auto_destroy).toBe(true);
  });
});

// ── parseFlyMachineResponse ───────────────────────────────────────────────

describe("parseFlyMachineResponse", () => {
  it("extracts id + state from a well-formed response", () => {
    const parsed = parseFlyMachineResponse({ id: "m-abc", state: "started", other: "ignored" });
    expect(parsed).toEqual({ id: "m-abc", state: "started" });
  });

  it("returns null when id is missing", () => {
    expect(parseFlyMachineResponse({ state: "started" })).toBeNull();
  });

  it("returns null when state is missing", () => {
    expect(parseFlyMachineResponse({ id: "m-abc" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseFlyMachineResponse(null)).toBeNull();
    expect(parseFlyMachineResponse("string")).toBeNull();
    expect(parseFlyMachineResponse(42)).toBeNull();
    expect(parseFlyMachineResponse(undefined)).toBeNull();
  });

  it("returns null when id is an empty string", () => {
    expect(parseFlyMachineResponse({ id: "", state: "started" })).toBeNull();
  });
});

// ── mapFlyStateToSession ──────────────────────────────────────────────────

describe("mapFlyStateToSession", () => {
  it("maps created → pending", () => {
    expect(mapFlyStateToSession("created")).toBe("pending");
  });

  it("maps starting → pending", () => {
    expect(mapFlyStateToSession("starting")).toBe("pending");
  });

  it("maps started → running", () => {
    expect(mapFlyStateToSession("started")).toBe("running");
  });

  it("maps stopping / stopped / destroying → running (still winding down)", () => {
    expect(mapFlyStateToSession("stopping")).toBe("running");
    expect(mapFlyStateToSession("stopped")).toBe("running");
    expect(mapFlyStateToSession("destroying")).toBe("running");
  });

  it("maps destroyed → completed", () => {
    expect(mapFlyStateToSession("destroyed")).toBe("completed");
  });

  it("defaults unknown states to running (optimistic)", () => {
    expect(mapFlyStateToSession("newfangled-state")).toBe("running");
  });
});

// ── Adapter behavior ─────────────────────────────────────────────────────

describe("createFlyCloudOffloadAdapter — start()", () => {
  it("returns a session with provider 'fly-sprites'", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "secret-token",
      orgSlug: "my-org",
      fetcher,
      now: () => 1000,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.provider).toBe("fly-sprites");
    expect(session.sessionId).toMatch(/^fly-/);
  });

  it("POSTs to /apps/:slug/machines with Authorization header", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "secret-token-xyz",
      orgSlug: "wotann-prod",
      fetcher,
    });
    await adapter.start(makeStartOpts());
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.machines.dev/v1/apps/wotann-prod/machines",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token-xyz",
        }),
      })
    );
  });

  it("flips session to 'failed' on 4xx API response", async () => {
    const fetcher = stubFetcher(flyResponse("invalid org", 403));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "bad-token",
      orgSlug: "my-org",
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
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("flips session to 'failed' when response shape lacks id/state", async () => {
    const fetcher = stubFetcher(flyResponse({ unrelated: "field" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");
  });

  it("emits 'error' frame on 4xx", async () => {
    const fetcher = stubFetcher(flyResponse("forbidden", 403));
    const frames: string[] = [];
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    await adapter.start(
      makeStartOpts({
        onFrame: (f) => frames.push(f.kind),
      })
    );
    expect(frames).toContain("error");
    expect(frames).toContain("done");
  });

  it("uses injected clock for startedAt", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
      now: () => 42_000,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.startedAt).toBe(42_000);
  });

  it("forwards envAllowlist into machine spec env (NO secrets added)", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "secret",
      orgSlug: "my-org",
      fetcher,
    });
    await adapter.start(
      makeStartOpts({
        snapshot: makeSnapshot({ envAllowlist: { ONLY_THIS: "visible" } }),
      })
    );
    const callArgs = fetcher.mock.calls[0];
    expect(callArgs).toBeDefined();
    const parsedBody = JSON.parse(callArgs![1].body as string) as {
      config: { env: Record<string, unknown> };
    };
    expect(parsedBody.config.env).toEqual({ ONLY_THIS: "visible" });
    // Bearer token NEVER leaks into machine env.
    expect(parsedBody.config.env).not.toHaveProperty("FLY_API_TOKEN");
    expect(JSON.stringify(parsedBody.config.env)).not.toContain("secret");
  });
});

describe("createFlyCloudOffloadAdapter — cancel()", () => {
  it("returns false for an unknown session id", async () => {
    const fetcher = stubFetcher(flyResponse({}, 200));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const ok = await adapter.cancel("nope");
    expect(ok).toBe(false);
  });

  it("issues DELETE against the machine after stop()", async () => {
    // First call → create machine; subsequent calls → stop, delete.
    const responses: FlyFetchResponse[] = [
      flyResponse({ id: "m-xyz", state: "started" }), // create
      flyResponse({}, 200), // stop
      flyResponse({}, 200), // delete
    ];
    const fetcher = vi
      .fn<[string, FlyFetchInit], Promise<FlyFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? flyResponse({}, 200));
      });
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(true);

    // Confirm DELETE was issued — inspect all calls.
    const methods = fetcher.mock.calls.map((args) => args[1]?.method);
    expect(methods).toContain("DELETE");
    // and stop POST (the /stop endpoint)
    const stopCall = fetcher.mock.calls.find((args) => typeof args[0] === "string" && args[0].endsWith("/stop"));
    expect(stopCall).toBeDefined();
  });

  it("marks session cancelled without network when no machine was ever booted", async () => {
    // Create a session that fails boot → no machineId recorded.
    const fetcher = stubFetcher(flyResponse("server error", 500));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session.status).toBe("failed");

    // Cancelling a failed session still returns true & flips to cancelled.
    const callsBefore = fetcher.mock.calls.length;
    const ok = await adapter.cancel(session.sessionId);
    expect(ok).toBe(true);
    // No new fetcher calls should fire for a no-machine session.
    expect(fetcher.mock.calls.length).toBe(callsBefore);
  });
});

describe("createFlyCloudOffloadAdapter — status()", () => {
  it("returns null for an unknown session id", async () => {
    const fetcher = stubFetcher(flyResponse({}));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const result = await adapter.status("never-existed");
    expect(result).toBeNull();
  });

  it("reflects Fly state transitions into session status", async () => {
    const responses: FlyFetchResponse[] = [
      flyResponse({ id: "m-1", state: "starting" }), // create
      flyResponse({ id: "m-1", state: "started" }), // status poll 1
    ];
    const fetcher = vi
      .fn<[string, FlyFetchInit], Promise<FlyFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? flyResponse({ id: "m-1", state: "started" }));
      });
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const s1 = await adapter.start(makeStartOpts());
    expect(s1.status).toBe("pending");
    const s2 = await adapter.status(s1.sessionId);
    expect(s2?.status).toBe("running");
  });

  it("marks session completed when machine is 404 (auto-destroyed)", async () => {
    const responses: FlyFetchResponse[] = [
      flyResponse({ id: "m-1", state: "starting" }),
      flyResponse("not found", 404),
    ];
    const fetcher = vi
      .fn<[string, FlyFetchInit], Promise<FlyFetchResponse>>()
      .mockImplementation(() => {
        const next = responses.shift();
        return Promise.resolve(next ?? flyResponse("", 404));
      });
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const s = await adapter.start(makeStartOpts());
    const updated = await adapter.status(s.sessionId);
    expect(updated?.status).toBe("completed");
    expect(updated?.endedAt).toBeDefined();
  });
});

describe("createFlyCloudOffloadAdapter — list()", () => {
  it("returns all sessions created by this adapter", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    await adapter.start(makeStartOpts({ task: "task-A" }));
    await adapter.start(makeStartOpts({ task: "task-B" }));
    const sessions = await adapter.list();
    expect(sessions.length).toBe(2);
  });

  it("returns an empty list for a fresh adapter", async () => {
    const fetcher = stubFetcher(flyResponse({}));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const sessions = await adapter.list();
    expect(sessions).toEqual([]);
  });
});

describe("createFlyCloudOffloadAdapter — isolation", () => {
  it("two adapters never share session state", async () => {
    const fetcherA = stubFetcher(flyResponse({ id: "m-A", state: "starting" }));
    const fetcherB = stubFetcher(flyResponse({ id: "m-B", state: "starting" }));
    const adapterA = createFlyCloudOffloadAdapter({
      apiToken: "tokA",
      orgSlug: "org-A",
      fetcher: fetcherA,
    });
    const adapterB = createFlyCloudOffloadAdapter({
      apiToken: "tokB",
      orgSlug: "org-B",
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

describe("createFlyCloudOffloadAdapter — security", () => {
  it("never includes the API token in the CloudOffloadSession snapshot", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "started" }));
    const TOKEN = "sk-super-secret-abcdef-fly-token";
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: TOKEN,
      orgSlug: "my-org",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("secret");
    // Also check list() output.
    const sessions = await adapter.list();
    expect(JSON.stringify(sessions)).not.toContain(TOKEN);
  });

  it("onFrame listener throwing does NOT take the session down", async () => {
    const fetcher = stubFetcher(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    // If the listener throws on every call, start() should still complete.
    const session = await adapter.start(
      makeStartOpts({
        onFrame: () => {
          throw new Error("listener bug");
        },
      })
    );
    expect(session.sessionId).toBeTruthy();
  });
});

describe("createFlyCloudOffloadAdapter — fetcher signature", () => {
  it("accepts a minimal FlyFetcher stub without RequestInit", async () => {
    // Verify the FlyFetcher type accepts the narrow init shape.
    const fetcher: FlyFetcher = vi.fn().mockResolvedValue(flyResponse({ id: "m-1", state: "starting" }));
    const adapter = createFlyCloudOffloadAdapter({
      apiToken: "token",
      orgSlug: "my-org",
      fetcher,
    });
    const session = await adapter.start(makeStartOpts());
    expect(session).toBeDefined();
  });
});
