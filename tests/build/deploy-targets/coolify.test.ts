/**
 * Tier 12 T12.20 — Coolify adapter tests.
 *
 * Uses a stub fetcher to exercise the REST flow end-to-end without a
 * live Coolify instance. Covers validation, create-and-deploy, status
 * polling, log fetch, cancel, retry on 5xx, and 4xx fast-fail.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createCoolifyAdapter,
  mapCoolifyStatus,
  type CoolifyConfig,
  type HttpFetcher,
} from "../../../src/build/deploy-targets/coolify.js";

// ── Helpers ──────────────────────────────────────────────

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

function textResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => null,
  };
}

function baseConfig(overrides: Partial<CoolifyConfig> = {}): CoolifyConfig {
  return {
    apiUrl: "https://coolify.example.com",
    apiToken: "test-token",
    defaultProjectId: "proj-1",
    ...overrides,
  };
}

// ── Validation ───────────────────────────────────────────

describe("createCoolifyAdapter — validation", () => {
  it("rejects missing config", () => {
    expect(() => createCoolifyAdapter(undefined as unknown as CoolifyConfig)).toThrow();
  });

  it("rejects non-URL apiUrl", () => {
    expect(() =>
      createCoolifyAdapter({ apiUrl: "garbage", apiToken: "x" }),
    ).toThrow(/apiUrl/);
  });

  it("rejects missing apiToken", () => {
    expect(() =>
      createCoolifyAdapter({
        apiUrl: "https://coolify.example.com",
      } as unknown as CoolifyConfig),
    ).toThrow(/apiToken/);
  });
});

// ── createAndDeploy ──────────────────────────────────────

describe("createAndDeploy", () => {
  it("happy path: creates app, triggers deploy, returns URL", async () => {
    const fetcher: HttpFetcher = vi.fn(async (url, init) => {
      if (url.endsWith("/api/v1/applications/public")) {
        expect(init.method).toBe("POST");
        expect(init.headers["Authorization"]).toBe("Bearer test-token");
        return jsonResponse(200, { uuid: "app-uuid-42" });
      }
      if (url.endsWith("/api/v1/deploy")) {
        return jsonResponse(200, {
          deployment_uuid: "dep-99",
          status: "queued",
          url: "https://myapp.example.com",
        });
      }
      return jsonResponse(404, { error: "not found" });
    });
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    const r = await adapter.createAndDeploy({
      appName: "test-app",
      gitRepo: "https://github.com/x/y",
      branch: "main",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deploymentId).toBe("dep-99");
      expect(r.appId).toBe("app-uuid-42");
      expect(r.url).toBe("https://myapp.example.com");
      expect(r.status).toBe("queued");
    }
  });

  it("fails cleanly when projectId missing", async () => {
    const adapter = createCoolifyAdapter(
      baseConfig({
        defaultProjectId: undefined,
        fetcher: async () => jsonResponse(200, {}),
      }),
    );
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://github.com/a/b",
      branch: "main",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("projectId");
  });

  it("fails cleanly when gitRepo missing", async () => {
    const adapter = createCoolifyAdapter(baseConfig());
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "",
      branch: "main",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("gitRepo");
  });

  it("surfaces HTTP 401 from create step", async () => {
    const fetcher: HttpFetcher = async () =>
      jsonResponse(401, { error: "Unauthorized" });
    const adapter = createCoolifyAdapter(baseConfig({ fetcher, maxRetries: 0 }));
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://github.com/a/b",
      branch: "main",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("application create failed");
      expect(r.httpStatus).toBe(401);
    }
  });

  it("surfaces missing uuid in create response", async () => {
    let n = 0;
    const fetcher: HttpFetcher = async () => {
      n++;
      if (n === 1) return jsonResponse(200, { foo: "bar" }); // no uuid
      return jsonResponse(200, {});
    };
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://github.com/a/b",
      branch: "main",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("missing uuid");
  });

  it("forwards envVars + buildCommand in create body", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      seen.push({
        url,
        body: init.body ? JSON.parse(init.body) : null,
      });
      if (url.endsWith("/api/v1/applications/public")) {
        return jsonResponse(200, { uuid: "u" });
      }
      return jsonResponse(200, { uuid: "d" });
    };
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    await adapter.createAndDeploy({
      appName: "a",
      gitRepo: "r",
      branch: "b",
      envVars: { FOO: "1" },
      buildCommand: "npm run build",
    });
    const createBody = seen[0]?.body as Record<string, unknown>;
    expect(createBody["environment_variables"]).toEqual({ FOO: "1" });
    expect(createBody["build_command"]).toBe("npm run build");
  });
});

// ── fetchStatus ──────────────────────────────────────────

describe("fetchStatus", () => {
  it("returns mapped status from deployment endpoint", async () => {
    const fetcher: HttpFetcher = async (url) => {
      if (url.includes("/api/v1/deployments/")) {
        return jsonResponse(200, {
          status: "running",
          url: "https://live.example.com",
        });
      }
      return jsonResponse(404, {});
    };
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    const r = await adapter.fetchStatus("dep-99");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deployment.status).toBe("live");
      expect(r.deployment.url).toBe("https://live.example.com");
    }
  });

  it("surfaces 404", async () => {
    const fetcher: HttpFetcher = async () => jsonResponse(404, { error: "not found" });
    const adapter = createCoolifyAdapter(baseConfig({ fetcher, maxRetries: 0 }));
    const r = await adapter.fetchStatus("dep-99");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.httpStatus).toBe(404);
  });
});

// ── fetchLogs ────────────────────────────────────────────

describe("fetchLogs", () => {
  it("returns full logs when under cap", async () => {
    const fetcher: HttpFetcher = async (url) => {
      if (url.includes("/logs")) return textResponse(200, "building...\ndone");
      return jsonResponse(200, {});
    };
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    const r = await adapter.fetchLogs("dep-99");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.logs).toContain("building");
      expect(r.truncated).toBe(false);
    }
  });

  it("truncates logs at 1MB", async () => {
    const big = "x".repeat(1_500_000);
    const fetcher: HttpFetcher = async () => textResponse(200, big);
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    const r = await adapter.fetchLogs("dep-99");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).toBe(true);
      expect(r.logs.length).toBe(1_000_000);
    }
  });
});

// ── cancel ───────────────────────────────────────────────

describe("cancel", () => {
  it("issues DELETE and marks deployment cancelled", async () => {
    let createCount = 0;
    const fetcher: HttpFetcher = async (url, init) => {
      if (init.method === "DELETE" && url.includes("/api/v1/deployments/")) {
        return jsonResponse(200, {});
      }
      createCount++;
      if (createCount === 1) return jsonResponse(200, { uuid: "app-1" });
      return jsonResponse(200, { deployment_uuid: "dep-1" });
    };
    const adapter = createCoolifyAdapter(baseConfig({ fetcher }));
    await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://g/x",
      branch: "m",
    });
    const r = await adapter.cancel("dep-1");
    expect(r.ok).toBe(true);
    const dep = adapter.listDeployments().find((d) => d.id === "dep-1");
    expect(dep?.status).toBe("cancelled");
  });

  it("surfaces HTTP error from cancel", async () => {
    const fetcher: HttpFetcher = async () => jsonResponse(403, { error: "forbidden" });
    const adapter = createCoolifyAdapter(baseConfig({ fetcher, maxRetries: 0 }));
    const r = await adapter.cancel("dep-1");
    expect(r.ok).toBe(false);
  });
});

// ── retry behavior ───────────────────────────────────────

describe("retry behavior", () => {
  it("retries on 500 then succeeds", async () => {
    let n = 0;
    const fetcher: HttpFetcher = async (_url, _init) => {
      n++;
      if (n === 1) return jsonResponse(500, { error: "transient" });
      if (n === 2) return jsonResponse(200, { uuid: "app" });
      return jsonResponse(200, { deployment_uuid: "dep" });
    };
    const adapter = createCoolifyAdapter(
      baseConfig({ fetcher, maxRetries: 2, retryBackoffMs: 1 }),
    );
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://g/x",
      branch: "m",
    });
    expect(r.ok).toBe(true);
  });

  it("does NOT retry on 4xx", async () => {
    let n = 0;
    const fetcher: HttpFetcher = async () => {
      n++;
      return jsonResponse(400, { error: "bad" });
    };
    const adapter = createCoolifyAdapter(
      baseConfig({ fetcher, maxRetries: 3, retryBackoffMs: 1 }),
    );
    await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://g/x",
      branch: "m",
    });
    expect(n).toBe(1);
  });
});

// ── mapCoolifyStatus ─────────────────────────────────────

describe("mapCoolifyStatus", () => {
  it("normalizes live/running/succeeded to 'live'", () => {
    expect(mapCoolifyStatus("running")).toBe("live");
    expect(mapCoolifyStatus("succeeded")).toBe("live");
    expect(mapCoolifyStatus("deployed")).toBe("live");
    expect(mapCoolifyStatus("live")).toBe("live");
  });

  it("maps failure-ish statuses to 'failed'", () => {
    expect(mapCoolifyStatus("failed")).toBe("failed");
    expect(mapCoolifyStatus("error")).toBe("failed");
    expect(mapCoolifyStatus("FAILED_WITH_ERRORS")).toBe("failed");
  });

  it("maps cancelled variants", () => {
    expect(mapCoolifyStatus("cancelled")).toBe("cancelled");
    expect(mapCoolifyStatus("canceled")).toBe("cancelled");
  });

  it("maps building + deploying", () => {
    expect(mapCoolifyStatus("building")).toBe("building");
    expect(mapCoolifyStatus("deploying")).toBe("deploying");
  });

  it("falls back to 'pending' for unknown", () => {
    expect(mapCoolifyStatus("mystery")).toBe("pending");
  });
});

// ── Per-adapter isolation ────────────────────────────────

describe("per-adapter isolation", () => {
  it("two adapters do not share deployment maps", () => {
    const fetcher: HttpFetcher = async () => jsonResponse(200, {});
    const a = createCoolifyAdapter(baseConfig({ fetcher }));
    const b = createCoolifyAdapter(baseConfig({ fetcher }));
    expect(a.listDeployments()).toHaveLength(0);
    expect(b.listDeployments()).toHaveLength(0);
    expect(a).not.toBe(b);
  });
});
