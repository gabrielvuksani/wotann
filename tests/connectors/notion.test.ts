/**
 * Notion Connector SSRF rejection — Tier-1 P0-2 verification.
 *
 * Notion's `NOTION_API_BASE` is hard-coded to `https://api.notion.com/v1`,
 * so the direct diversion vector is a refactoring regression. The test
 * exercises the `guardedFetch` seam that the connector imports — if a
 * future edit replaces `guardedFetch` with `fetch`, this test keeps
 * proving the guard still rejects blocked URLs, and the sibling-site
 * grep assertion catches the regression.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch } from "../../src/connectors/guarded-fetch.js";
import { SSRFBlockedError } from "../../src/security/ssrf-guard.js";

describe("notion connector — guardedFetch blocks private IP targets", () => {
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
      guardedFetch("https://192.0.2.42/v1/users/me", {
        headers: {
          Authorization: "Bearer secret_fake",
          "Notion-Version": "2022-06-28",
        },
      }),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects AWS IMDSv4 link-local 169.254.169.254", async () => {
    await expect(
      guardedFetch("http://169.254.169.254/latest/meta-data/iam/"),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects ::ffff:10.0.0.1 (RFC-1918 via IPv4-mapped bypass)", async () => {
    await expect(guardedFetch("http://[::ffff:10.0.0.1]/v1/search")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
