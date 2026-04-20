/**
 * Confluence Connector SSRF rejection — Tier-1 P0-2 verification.
 *
 * The attacker vector here is REAL: `ConfluenceConnector.configure()`
 * takes `credentials.domain` from user config and splices it directly
 * into `this.baseUrl`. A malicious or misconfigured domain pointing at
 * an internal IP would — without the guard — send Basic-Auth creds to
 * that IP on every `connect()`/`search()`/`sync()` call.
 *
 * The guard closes this: `guardedFetch` runs the URL through
 * `assertOutboundUrl` and throws `SSRFBlockedError` before the wire.
 * The connector's try/catch swallows the throw and returns a degraded
 * result (`false` / `[]` / `{added:0,updated:0,removed:0}`), which is
 * the observable signal we assert below.
 *
 * We also intercept `globalThis.fetch` to prove NO network call is
 * issued for a blocked URL — so a reviewer can't silently regress the
 * wiring by bypassing the guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfluenceConnector } from "../../src/connectors/confluence.js";
import type { ConnectorConfig } from "../../src/connectors/connector-registry.js";

const BLOCKED_DOMAIN = "192.0.2.42"; // RFC-5737 TEST-NET-1

function makeConfig(domain: string): ConnectorConfig {
  return {
    id: "confluence-test",
    name: "test",
    type: "confluence",
    credentials: {
      domain,
      email: "u@example.com",
      apiToken: "fake-token",
    },
    enabled: true,
  };
}

describe("confluence connector — SSRF guard blocks private-range domains", () => {
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

  it("connect() returns false when domain is a TEST-NET IP", async () => {
    const conn = new ConfluenceConnector();
    conn.configure(makeConfig(BLOCKED_DOMAIN));
    const ok = await conn.connect();
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("connect() returns false when domain is metadata.goog", async () => {
    const conn = new ConfluenceConnector();
    conn.configure(makeConfig("metadata.goog"));
    const ok = await conn.connect();
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("connect() returns false when domain encodes ::ffff:127.0.0.1", async () => {
    const conn = new ConfluenceConnector();
    // Put the IPv6 literal in bracket form as it'd appear in a URL.
    conn.configure(makeConfig("[::ffff:127.0.0.1]"));
    const ok = await conn.connect();
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
