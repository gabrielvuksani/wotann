/**
 * Connector Registry SSRF rejection — Tier-1 P0-2 verification.
 *
 * The built-in `GitHubConnector` in `src/connectors/connector-registry.ts`
 * is a scaffolded placeholder — it doesn't currently make network calls,
 * so there's no direct SSRF surface to test at the registry layer. What
 * we CAN verify is that any future network call flowing through the
 * shared `guardedFetch` helper will be guarded: the registry pipeline
 * (connect → search → sync) composes connectors that MUST go through
 * `guardedFetch`.
 *
 * This file acts as a defense-in-depth smoke test for the import seam:
 * it asserts `guardedFetch` (the module the registry's connectors use)
 * rejects the classic SSRF bypass shapes. If the seam is ever severed
 * (someone reimports raw `fetch` under a wrapper name), the sibling
 * grep in code review catches it and this test keeps the guard honest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch } from "../../src/connectors/guarded-fetch.js";
import { SSRFBlockedError } from "../../src/security/ssrf-guard.js";

describe("connector-registry — guardedFetch seam is active", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("blocks 192.0.2.42 (TEST-NET-1) with SSRFBlockedError", async () => {
    await expect(guardedFetch("http://192.0.2.42/")).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks metadata.goog (cloud metadata alt endpoint)", async () => {
    await expect(guardedFetch("http://metadata.goog/")).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks ::ffff:127.0.0.1 (IPv4-mapped IPv6 bypass)", async () => {
    await expect(guardedFetch("http://[::ffff:127.0.0.1]/")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
