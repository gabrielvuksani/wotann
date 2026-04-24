/**
 * Tier 12 T12.20 — Dokploy adapter tests.
 *
 * Mirrors coolify tests with Dokploy-specific endpoint paths + header
 * conventions (x-api-key instead of Bearer). Ensures the shared
 * DeployTargetAdapter contract behaves identically across back-ends.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createDokployAdapter,
  mapDokployStatus,
  type DokployConfig,
  type HttpFetcher,
} from "../../../src/build/deploy-targets/dokploy.js";

// ── Helpers ──────────────────────────────────────────────

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

function baseConfig(overrides: Partial<DokployConfig> = {}): DokployConfig {
  return {
    apiUrl: "https://dokploy.example.com",
    apiKey: "test-key",
    defaultProjectId: "proj-1",
    ...overrides,
  };
}

// ── Validation ───────────────────────────────────────────

describe("createDokployAdapter — validation", () => {
  it("rejects missing config", () => {
    expect(() => createDokployAdapter(undefined as unknown as DokployConfig)).toThrow();
  });

  it("rejects non-URL apiUrl", () => {
    expect(() => createDokployAdapter({ apiUrl: "nope", apiKey: "x" })).toThrow(/apiUrl/);
  });

  it("rejects missing apiKey", () => {
    expect(() =>
      createDokployAdapter({
        apiUrl: "https://dokploy.example.com",
      } as unknown as DokployConfig),
    ).toThrow(/apiKey/);
  });
});

// ── createAndDeploy ──────────────────────────────────────

describe("createAndDeploy", () => {
  it("happy path with x-api-key header", async () => {
    const fetcher: HttpFetcher = vi.fn(async (url, init) => {
      expect(init.headers["x-api-key"]).toBe("test-key");
      expect(init.headers["Authorization"]).toBeUndefined();
      if (url.endsWith("/api/application.create")) {
        return jsonResponse(200, { applicationId: "app-42" });
      }
      if (url.endsWith("/api/application.deploy")) {
        return jsonResponse(200, {
          deploymentId: "dep-1",
          status: "running",
          url: "https://x.dokploy.example.com",
        });
      }
      return jsonResponse(404, { error: "not found" });
    });
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    const r = await adapter.createAndDeploy({
      appName: "test",
      gitRepo: "https://g/x",
      branch: "main",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deploymentId).toBe("dep-1");
      expect(r.appId).toBe("app-42");
      expect(r.status).toBe("live");
      expect(r.url).toBe("https://x.dokploy.example.com");
    }
  });

  it("rejects missing gitRepo", async () => {
    const adapter = createDokployAdapter(baseConfig());
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "",
      branch: "main",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects missing projectId", async () => {
    const adapter = createDokployAdapter(
      baseConfig({
        defaultProjectId: undefined,
        fetcher: async () => jsonResponse(200, {}),
      }),
    );
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://g/x",
      branch: "main",
    });
    expect(r.ok).toBe(false);
  });

  it("surfaces HTTP 500 from create step with retry then fail", async () => {
    const fetcher: HttpFetcher = async () => jsonResponse(500, { error: "down" });
    const adapter = createDokployAdapter(
      baseConfig({ fetcher, maxRetries: 1, retryBackoffMs: 1 }),
    );
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://g/x",
      branch: "main",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.httpStatus).toBe(500);
  });

  it("rejects missing applicationId in response", async () => {
    const fetcher: HttpFetcher = async () => jsonResponse(200, { other: "field" });
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "r",
      branch: "m",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("applicationId");
  });

  it("forwards envVars + build/start commands", async () => {
    const seen: { body: unknown }[] = [];
    const fetcher: HttpFetcher = async (_url, init) => {
      seen.push({ body: init.body ? JSON.parse(init.body) : null });
      return jsonResponse(200, { applicationId: "a", deploymentId: "d" });
    };
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    await adapter.createAndDeploy({
      appName: "a",
      gitRepo: "r",
      branch: "b",
      envVars: { X: "y" },
      buildCommand: "tsc",
      startCommand: "node dist",
    });
    const body = seen[0]?.body as Record<string, unknown>;
    expect(body["env"]).toEqual({ X: "y" });
    expect(body["buildCommand"]).toBe("tsc");
    expect(body["startCommand"]).toBe("node dist");
  });
});

// ── fetchStatus ──────────────────────────────────────────

describe("fetchStatus", () => {
  it("normalizes status via query-string endpoint", async () => {
    const fetcher: HttpFetcher = async (url) => {
      if (url.includes("deployment.one?deploymentId=dep-X")) {
        return jsonResponse(200, { status: "done", url: "https://x.d" });
      }
      return jsonResponse(404, {});
    };
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    const r = await adapter.fetchStatus("dep-X");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deployment.status).toBe("live");
      expect(r.deployment.url).toBe("https://x.d");
    }
  });

  it("surfaces HTTP error", async () => {
    const fetcher: HttpFetcher = async () => jsonResponse(404, { error: "gone" });
    const adapter = createDokployAdapter(baseConfig({ fetcher, maxRetries: 0 }));
    const r = await adapter.fetchStatus("dep-1");
    expect(r.ok).toBe(false);
  });
});

// ── fetchLogs ────────────────────────────────────────────

describe("fetchLogs", () => {
  it("extracts logs from JSON envelope", async () => {
    const fetcher: HttpFetcher = async () =>
      jsonResponse(200, { logs: "building...\ndeployed\n" });
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    const r = await adapter.fetchLogs("dep-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.logs).toContain("building");
      expect(r.truncated).toBe(false);
    }
  });

  it("truncates large logs", async () => {
    const big = "x".repeat(1_200_000);
    const fetcher: HttpFetcher = async () => jsonResponse(200, { logs: big });
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    const r = await adapter.fetchLogs("dep-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).toBe(true);
      expect(r.logs.length).toBe(1_000_000);
    }
  });
});

// ── cancel ───────────────────────────────────────────────

describe("cancel", () => {
  it("POSTs to deployment.cancel and marks status", async () => {
    let setup = 0;
    const fetcher: HttpFetcher = async (url) => {
      setup++;
      if (setup === 1) return jsonResponse(200, { applicationId: "app" });
      if (setup === 2) return jsonResponse(200, { deploymentId: "dep" });
      if (url.endsWith("/api/deployment.cancel")) return jsonResponse(200, {});
      return jsonResponse(200, {});
    };
    const adapter = createDokployAdapter(baseConfig({ fetcher }));
    await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "https://g/x",
      branch: "m",
    });
    const r = await adapter.cancel("dep");
    expect(r.ok).toBe(true);
    const dep = adapter.listDeployments().find((d) => d.id === "dep");
    expect(dep?.status).toBe("cancelled");
  });

  it("surfaces HTTP error on cancel", async () => {
    const fetcher: HttpFetcher = async () =>
      jsonResponse(403, { error: "forbidden" });
    const adapter = createDokployAdapter(baseConfig({ fetcher, maxRetries: 0 }));
    const r = await adapter.cancel("dep-nope");
    expect(r.ok).toBe(false);
  });
});

// ── retry behavior ───────────────────────────────────────

describe("retry behavior", () => {
  it("retries on 429", async () => {
    let n = 0;
    const fetcher: HttpFetcher = async () => {
      n++;
      if (n === 1) return jsonResponse(429, { error: "rate limit" });
      if (n === 2) return jsonResponse(200, { applicationId: "a" });
      return jsonResponse(200, { deploymentId: "d" });
    };
    const adapter = createDokployAdapter(
      baseConfig({ fetcher, maxRetries: 2, retryBackoffMs: 1 }),
    );
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "r",
      branch: "m",
    });
    expect(r.ok).toBe(true);
  });

  it("surfaces transport error after retries", async () => {
    const fetcher: HttpFetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const adapter = createDokployAdapter(
      baseConfig({ fetcher, maxRetries: 1, retryBackoffMs: 1 }),
    );
    const r = await adapter.createAndDeploy({
      appName: "x",
      gitRepo: "r",
      branch: "m",
    });
    expect(r.ok).toBe(false);
  });
});

// ── mapDokployStatus ─────────────────────────────────────

describe("mapDokployStatus", () => {
  it("maps 'done' and 'running' and 'live' to 'live'", () => {
    expect(mapDokployStatus("done")).toBe("live");
    expect(mapDokployStatus("running")).toBe("live");
    expect(mapDokployStatus("live")).toBe("live");
  });

  it("maps 'idle' and 'queued' to 'queued'", () => {
    expect(mapDokployStatus("idle")).toBe("queued");
    expect(mapDokployStatus("queued")).toBe("queued");
  });

  it("maps error variants", () => {
    expect(mapDokployStatus("error")).toBe("failed");
    expect(mapDokployStatus("failed")).toBe("failed");
  });

  it("maps canceled variants", () => {
    expect(mapDokployStatus("canceled")).toBe("cancelled");
    expect(mapDokployStatus("cancelled")).toBe("cancelled");
  });

  it("falls back to pending", () => {
    expect(mapDokployStatus("mystery-state")).toBe("pending");
  });
});

// ── Per-adapter isolation ────────────────────────────────

describe("per-adapter isolation", () => {
  it("two adapters do not share state", () => {
    const fetcher: HttpFetcher = async () => jsonResponse(200, {});
    const a = createDokployAdapter(baseConfig({ fetcher }));
    const b = createDokployAdapter(baseConfig({ fetcher }));
    expect(a).not.toBe(b);
    expect(a.listDeployments()).toHaveLength(0);
    expect(b.listDeployments()).toHaveLength(0);
  });
});
