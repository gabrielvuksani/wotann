/**
 * Linear Connector SSRF rejection — Tier-1 P0-2 verification.
 *
 * Linear's `LINEAR_API_URL` is hard-coded to `https://api.linear.app/graphql`,
 * so the direct diversion vector is a refactoring regression. The test
 * exercises the `guardedFetch` seam that the connector imports — if a
 * future edit replaces `guardedFetch` with `fetch`, this test keeps
 * proving the guard still rejects blocked URLs, and the sibling-site
 * grep assertion catches the regression.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch } from "../../src/connectors/guarded-fetch.js";
import { SSRFBlockedError } from "../../src/security/ssrf-guard.js";

describe("linear connector — guardedFetch blocks private IP targets", () => {
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

  it("rejects 192.0.2.42 (TEST-NET-1) before the wire", async () => {
    await expect(
      guardedFetch("https://192.0.2.42/graphql", {
        method: "POST",
        headers: { Authorization: "lin_api_fake" },
        body: JSON.stringify({ query: "query { viewer { id } }" }),
      }),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects ::ffff:127.0.0.1 (IPv4-mapped IPv6 bypass)", async () => {
    await expect(guardedFetch("http://[::ffff:127.0.0.1]/graphql")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects metadata.goog", async () => {
    await expect(guardedFetch("http://metadata.goog/computeMetadata/v1/")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
