/**
 * Tests for `src/daemon/auto-update.ts` — V9 resurrected module that
 * surfaces curated Ollama model recommendations and a cached
 * "new models discovered" feed.
 *
 * Why these tests:
 *   - getRecommendedModels — tests the ID *set*, not exact strings,
 *     so the curated list can be tweaked without breaking the test.
 *   - checkForUpdates — verifies the cache short-circuits a second
 *     call within CHECK_INTERVAL_MS (6 hours). We do this by writing
 *     a fresh cache file under WOTANN_HOME and then asserting
 *     `cached:true` on the next call without touching fetch.
 *   - pullModel — verifies the POST payload + the network-error path
 *     using vi.spyOn(global, "fetch").
 *
 * Constraints (per task):
 *   - No network calls. fetch is always mocked.
 *   - WOTANN_HOME is redirected to a per-test mkdtempSync directory
 *     so the real ~/.wotann/registry-cache.json is never touched.
 *   - The auto-update module reads CACHE_PATH at module-load time, so
 *     each test sets WOTANN_HOME *before* the dynamic import and uses
 *     vi.resetModules() to force a fresh load.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("auto-update — getRecommendedModels", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env["WOTANN_HOME"];
    tempHome = mkdtempSync(join(tmpdir(), "wotann-auto-update-"));
    process.env["WOTANN_HOME"] = tempHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["WOTANN_HOME"];
    else process.env["WOTANN_HOME"] = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a non-empty array of model id strings", async () => {
    const { getRecommendedModels } = await import("../../src/daemon/auto-update.js");
    const models = getRecommendedModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m).toBe("string");
      expect(m.length).toBeGreaterThan(0);
    }
  });

  it("includes the curated coding + general buckets (id-set, not exact strings)", async () => {
    const { getRecommendedModels } = await import("../../src/daemon/auto-update.js");
    const ids = new Set(getRecommendedModels());

    // We don't pin exact strings — the list is allowed to evolve.
    // Instead we assert the *categories* the source comment promises
    // ("Coding", "General", "Reasoning", "Small & fast", "Chinese/multilingual")
    // are represented by at least one curated id.
    const hasCoding = [...ids].some((m) => /coder|devstral|codestral/i.test(m));
    const hasGeneral = [...ids].some((m) => /gemma|llama|phi|mistral/i.test(m));
    expect(hasCoding).toBe(true);
    expect(hasGeneral).toBe(true);
  });
});

describe("auto-update — checkForUpdates cache short-circuit", () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env["WOTANN_HOME"];
    tempHome = mkdtempSync(join(tmpdir(), "wotann-auto-update-cache-"));
    process.env["WOTANN_HOME"] = tempHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["WOTANN_HOME"];
    else process.env["WOTANN_HOME"] = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns cached:true when a fresh cache exists (within CHECK_INTERVAL_MS)", async () => {
    // Pre-write a cache file dated "right now" so the module skips
    // the fetch path. CHECK_INTERVAL_MS is 6 hours; lastCheck = Date.now()
    // is firmly inside that window.
    const cachePath = join(tempHome, "registry-cache.json");
    mkdirSync(tempHome, { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        lastCheck: Date.now(),
        models: [
          {
            id: "gemma4",
            name: "gemma4",
            provider: "ollama",
            size: "varies",
            description: "test fixture",
            isNew: true,
            discoveredAt: Date.now(),
          },
        ],
        recommendedModels: ["gemma4"],
      }),
    );

    // fetch must NOT be called when the cache is fresh — spy on it
    // so we can assert that.
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(async () => new Response("{}"));

    const { checkForUpdates } = await import("../../src/daemon/auto-update.js");
    const result = await checkForUpdates();

    expect(result.cached).toBe(true);
    expect(result.newModels.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns cached:false when the cache is stale (older than CHECK_INTERVAL_MS)", async () => {
    const cachePath = join(tempHome, "registry-cache.json");
    mkdirSync(tempHome, { recursive: true });
    // 7 hours ago — outside the 6h window, so a refresh runs.
    const stale = Date.now() - 7 * 60 * 60 * 1000;
    writeFileSync(
      cachePath,
      JSON.stringify({ lastCheck: stale, models: [], recommendedModels: [] }),
    );

    // Mock fetch to return a connection error so we don't hit network.
    // The module catches the throw and returns an empty newModels list.
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(async () => {
      throw new Error("ECONNREFUSED — mocked");
    });

    const { checkForUpdates } = await import("../../src/daemon/auto-update.js");
    const result = await checkForUpdates();

    expect(result.cached).toBe(false);
    // fetch was attempted (Ollama tags endpoint) — even if it threw.
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("auto-update — pullModel", () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let originalOllamaHost: string | undefined;

  beforeEach(() => {
    originalHome = process.env["WOTANN_HOME"];
    originalOllamaHost = process.env["OLLAMA_HOST"];
    tempHome = mkdtempSync(join(tmpdir(), "wotann-auto-update-pull-"));
    process.env["WOTANN_HOME"] = tempHome;
    process.env["OLLAMA_HOST"] = "http://127.0.0.1:11434";
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env["WOTANN_HOME"];
    else process.env["WOTANN_HOME"] = originalHome;
    if (originalOllamaHost === undefined) delete process.env["OLLAMA_HOST"];
    else process.env["OLLAMA_HOST"] = originalOllamaHost;
    rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("posts to /api/pull with the correct JSON body", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const { pullModel } = await import("../../src/daemon/auto-update.js");
    const result = await pullModel("gemma4:2b");

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://127.0.0.1:11434/api/pull");
    const init = calledInit as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "gemma4:2b",
      stream: false,
    });
  });

  it("returns success:false with the Ollama status code when fetch is non-2xx", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(async () => new Response("not found", { status: 404 }));

    const { pullModel } = await import("../../src/daemon/auto-update.js");
    const result = await pullModel("ghost-model");

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  it("returns success:false with the error message on a network error", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(async () => {
      throw new Error("network unreachable");
    });

    const { pullModel } = await import("../../src/daemon/auto-update.js");
    const result = await pullModel("gemma4");

    expect(result.success).toBe(false);
    expect(result.error).toBe("network unreachable");
  });

  it("returns success:false with 'Unknown error' for non-Error throws", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockImplementation(async () => {
      // eslint-disable-next-line no-throw-literal
      throw "raw string failure";
    });

    const { pullModel } = await import("../../src/daemon/auto-update.js");
    const result = await pullModel("gemma4");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown error");
  });
});
