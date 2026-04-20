/**
 * Google Drive Connector SSRF rejection — Tier-1 P0-2 verification.
 *
 * Google Drive's `DRIVE_API_BASE` is hard-coded to
 * `https://www.googleapis.com/drive/v3`, BUT `driveRequest(path)` also
 * accepts an absolute URL (`path.startsWith("http")`) — so a malicious
 * `path` flowing in from a future caller could divert the request.
 * Ported public methods (`fetch`, `search`, `sync`) don't currently
 * take user URLs, but the defensive guard closes the regression door.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch } from "../../src/connectors/guarded-fetch.js";
import { SSRFBlockedError } from "../../src/security/ssrf-guard.js";

describe("google-drive connector — guardedFetch blocks private IP targets", () => {
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
      guardedFetch("https://192.0.2.42/drive/v3/about?fields=user", {
        headers: { Authorization: "Bearer ya29.fake" },
      }),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects metadata.goog (GCE metadata endpoint)", async () => {
    await expect(
      guardedFetch("http://metadata.goog/computeMetadata/v1/instance/service-accounts/default/token"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects ::ffff:169.254.169.254 (AWS IMDS via IPv4-mapped bypass)", async () => {
    await expect(
      guardedFetch("http://[::ffff:169.254.169.254]/latest/meta-data/"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
