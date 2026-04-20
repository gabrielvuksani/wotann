/**
 * Slack Connector SSRF rejection — Tier-1 P0-2 verification.
 *
 * Slack's `API_BASE` is hard-coded to `https://slack.com/api`, so the
 * direct diversion vector is a refactoring regression (someone puts a
 * user-supplied URL in). This test exercises the guarded-fetch helper
 * that the connector imports — if the import seam is ever severed
 * (e.g. someone replaces `guardedFetch` with `fetch`), the test below
 * will stop exercising the guard and a sibling grep assertion in the
 * review step will fail.
 *
 * We also sanity-check that `globalThis.fetch` is NOT called when a
 * private URL flows through `guardedFetch` — so a reviewer can't
 * satisfy the test by reimporting the raw global.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch } from "../../src/connectors/guarded-fetch.js";
import { SSRFBlockedError } from "../../src/security/ssrf-guard.js";

describe("slack connector — guardedFetch blocks private IP targets", () => {
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

  it("rejects 192.0.2.42 (TEST-NET-1) before hitting the wire", async () => {
    await expect(
      guardedFetch("http://192.0.2.42/api/auth.test", {
        method: "POST",
        headers: { Authorization: "Bearer xoxb-fake" },
      }),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects ::ffff:127.0.0.1 (IPv4-mapped IPv6 bypass)", async () => {
    await expect(
      guardedFetch("http://[::ffff:127.0.0.1]/api/conversations.list"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects metadata.goog (GCE alt metadata endpoint)", async () => {
    await expect(
      guardedFetch("http://metadata.goog/computeMetadata/v1/"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects AWS IMDSv4 link-local 169.254.169.254", async () => {
    await expect(
      guardedFetch("http://169.254.169.254/latest/meta-data/iam/"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
