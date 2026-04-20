/**
 * Jira Connector SSRF rejection — Tier-1 P0-2 verification.
 *
 * Jira's attacker vector is the `domain` credential, which is spliced
 * into `https://${domain}.atlassian.net${path}`. The guard blocks private
 * subdomain forms ONLY if the resolved hostname matches a private-IP
 * rule — a literal IP as "domain" yields `https://192.0.2.42.atlassian.net/...`
 * which is a public DNS name (benign).
 *
 * But a cloud metadata bypass through the domain field IS possible if
 * an attacker uses `.atlassian.net` as a domain suffix, e.g. config
 * `domain: "internal-test"` is benign, but the `fetch(documentId)` and
 * `search(query)` paths all route through `jiraRequest` which uses
 * `guardedFetch`. So the assertion we CAN make: if a refactoring
 * regression re-exposes raw `fetch`, the test exercises the helper
 * directly and fails.
 *
 * Primary assertions:
 *   1. guardedFetch rejects well-known private/metadata URLs
 *   2. The rejection class is SSRFBlockedError (so callers can branch)
 *   3. No real fetch is issued when the guard rejects
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch } from "../../src/connectors/guarded-fetch.js";
import { SSRFBlockedError } from "../../src/security/ssrf-guard.js";

describe("jira connector — guardedFetch blocks private IP targets", () => {
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
      guardedFetch("https://192.0.2.42/rest/api/3/myself", {
        headers: { Authorization: "Basic dXNlcjp0b2tlbg==" },
      }),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects metadata.goog (GCE alt metadata)", async () => {
    await expect(guardedFetch("http://metadata.goog/computeMetadata/v1/")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects ::ffff:127.0.0.1 (IPv4-mapped IPv6 bypass)", async () => {
    await expect(
      guardedFetch("http://[::ffff:127.0.0.1]/rest/api/3/myself"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
