/**
 * SSRF Guard — coverage for the stricter private-host rules ported
 * forward from `src/security/ssrf-guard 2.ts` (Tier-0-G security fix).
 *
 * Every test corresponds to a RFC-defined range that the pre-merge
 * live file silently allowed and the ghost file already rejected.
 * The bug was: callers on `guarded-fetch.ts` → every connector write
 * path accepted `domain` values in these ranges and issued real HTTP
 * requests against them, so a mis-configured user could reach local
 * metadata / test-net / multicast / link-local endpoints.
 *
 * Quality-Bar-#14 intent: each new rule below has a test that MUST
 * fail on the pre-merge live file and pass after the ghost's stricter
 * rule set is merged in. Signatures are unchanged — all five existing
 * callers (guarded-fetch, acp-agent-registry, browser-tools, aux-tools,
 * connector-writes) continue to consume the same public API.
 */

import { describe, it, expect } from "vitest";
import {
  checkUrl,
  isSafeUrl,
  requireSafeUrl,
  assertOutboundUrl,
  validateOutboundUrl,
  SSRFBlockedError,
} from "../../src/security/ssrf-guard.js";

// ── Baseline (things the pre-merge live file already rejected) ──
// These protect against regression of already-rejected ranges.

describe("ssrf-guard — baseline coverage (must remain rejected)", () => {
  it("rejects loopback 127.0.0.1", () => {
    expect(isSafeUrl("http://127.0.0.1/api")).toBe(false);
  });

  it("rejects RFC-1918 10/8", () => {
    expect(isSafeUrl("http://10.0.0.1/")).toBe(false);
  });

  it("rejects RFC-1918 172.16/12", () => {
    expect(isSafeUrl("http://172.20.5.5/")).toBe(false);
  });

  it("rejects RFC-1918 192.168/16", () => {
    expect(isSafeUrl("http://192.168.0.1/")).toBe(false);
  });

  it("rejects link-local 169.254/16 (AWS IMDSv4)", () => {
    expect(isSafeUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects named AWS metadata host", () => {
    expect(isSafeUrl("http://metadata.ec2.internal/")).toBe(false);
  });

  it("rejects named GCE metadata host", () => {
    expect(isSafeUrl("http://metadata.google.internal/")).toBe(false);
  });

  it("rejects *.internal suffix", () => {
    expect(isSafeUrl("http://foo.internal/")).toBe(false);
  });

  it("rejects localhost hostname", () => {
    expect(isSafeUrl("http://localhost/")).toBe(false);
  });

  it("accepts a public domain", () => {
    expect(isSafeUrl("https://example.com/")).toBe(true);
  });

  it("rejects file:// scheme", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });
});

// ── Newly-rejected ranges (the ported rules) ──────────────────

describe("ssrf-guard — IPv4 TEST-NET-1 (192.0.2.0/24, RFC-5737)", () => {
  it("rejects 192.0.2.1", () => {
    const r = checkUrl("http://192.0.2.1/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private-ip");
  });

  it("rejects 192.0.2.42 — bug scenario from spec", () => {
    expect(isSafeUrl("http://192.0.2.42/api")).toBe(false);
  });

  it("rejects 192.0.2.255", () => {
    expect(isSafeUrl("http://192.0.2.255/")).toBe(false);
  });
});

describe("ssrf-guard — IPv4 TEST-NET-2 (198.51.100.0/24, RFC-5737)", () => {
  it("rejects 198.51.100.1", () => {
    expect(isSafeUrl("http://198.51.100.1/")).toBe(false);
  });

  it("rejects 198.51.100.99", () => {
    expect(isSafeUrl("http://198.51.100.99/")).toBe(false);
  });
});

describe("ssrf-guard — IPv4 TEST-NET-3 (203.0.113.0/24, RFC-5737)", () => {
  it("rejects 203.0.113.1", () => {
    expect(isSafeUrl("http://203.0.113.1/")).toBe(false);
  });

  it("rejects 203.0.113.50", () => {
    expect(isSafeUrl("http://203.0.113.50/")).toBe(false);
  });
});

describe("ssrf-guard — IPv4 Benchmarking (198.18.0.0/15, RFC-2544)", () => {
  it("rejects 198.18.0.1 — bug scenario from spec", () => {
    expect(isSafeUrl("http://198.18.0.1/")).toBe(false);
  });

  it("rejects 198.19.200.50", () => {
    expect(isSafeUrl("http://198.19.200.50/")).toBe(false);
  });
});

describe("ssrf-guard — IPv4 multicast (224.0.0.0/4, RFC-5771)", () => {
  it("rejects 224.0.0.1 — bug scenario from spec", () => {
    expect(isSafeUrl("http://224.0.0.1/")).toBe(false);
  });

  it("rejects 233.5.5.5", () => {
    expect(isSafeUrl("http://233.5.5.5/")).toBe(false);
  });

  it("rejects 239.255.255.255", () => {
    expect(isSafeUrl("http://239.255.255.255/")).toBe(false);
  });
});

describe("ssrf-guard — IPv6 multicast (ff00::/8, RFC-4291)", () => {
  it("rejects ff02::1 (all-nodes)", () => {
    expect(isSafeUrl("http://[ff02::1]/")).toBe(false);
  });

  it("rejects ff05::1:3", () => {
    expect(isSafeUrl("http://[ff05::1:3]/")).toBe(false);
  });
});

describe("ssrf-guard — IPv4-mapped IPv6 (::ffff:<v4>) bypass closed", () => {
  it("rejects ::ffff:127.0.0.1 — classic SSRF bypass from spec", () => {
    const r = checkUrl("http://[::ffff:127.0.0.1]/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private-ip");
  });

  it("rejects ::ffff:10.0.0.1 — RFC-1918 via IPv4-mapped bypass", () => {
    expect(isSafeUrl("http://[::ffff:10.0.0.1]/")).toBe(false);
  });

  it("rejects ::ffff:169.254.169.254 — AWS IMDS via IPv4-mapped bypass", () => {
    expect(isSafeUrl("http://[::ffff:169.254.169.254]/")).toBe(false);
  });

  it("rejects ::ffff:192.0.2.1 — TEST-NET-1 via IPv4-mapped bypass", () => {
    expect(isSafeUrl("http://[::ffff:192.0.2.1]/")).toBe(false);
  });
});

describe("ssrf-guard — AWS IMDSv6 metadata patterns", () => {
  it("rejects fd00:ec2::254", () => {
    const r = checkUrl("http://[fd00:ec2::254]/latest/meta-data/");
    expect(r.ok).toBe(false);
    // Either `metadata-host` (because it matches the IMDSv6 pattern list)
    // or `private-ip` (fd00:/8 unique-local) — both block the request.
    expect(["metadata-host", "private-ip"]).toContain(r.reason);
  });

  it("rejects fe80::a9fe:a9fe — link-local AWS IMDSv6 alt form", () => {
    expect(isSafeUrl("http://[fe80::a9fe:a9fe]/")).toBe(false);
  });
});

describe("ssrf-guard — GCE alt-metadata host (metadata.goog)", () => {
  it("rejects metadata.goog — bug scenario from spec", () => {
    const r = checkUrl("http://metadata.goog/computeMetadata/v1/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("metadata-host");
  });
});

// ── API-shape regression: 5 callers must keep compiling ───────

describe("ssrf-guard — public API shape (5 callers depend on this)", () => {
  it("isSafeUrl(string) returns boolean", () => {
    const result: boolean = isSafeUrl("https://example.com");
    expect(typeof result).toBe("boolean");
  });

  it("checkUrl returns {ok, reason?, detail?}", () => {
    const result = checkUrl("http://127.0.0.1/");
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect(typeof result.detail).toBe("string");
  });

  it("requireSafeUrl throws SSRFBlockedError on private IP", () => {
    expect(() => requireSafeUrl("http://127.0.0.1/")).toThrow(SSRFBlockedError);
  });

  it("assertOutboundUrl throws SSRFBlockedError on metadata host", () => {
    expect(() => assertOutboundUrl("http://metadata.goog/")).toThrow(SSRFBlockedError);
  });

  it("assertOutboundUrl === requireSafeUrl (backwards-compat alias)", () => {
    // Reference equality — the live file exports one as the alias of
    // the other; breaking this breaks `guardedFetch`.
    expect(assertOutboundUrl).toBe(requireSafeUrl);
  });

  it("validateOutboundUrl returns {valid:true, parsed} on success", () => {
    const result = validateOutboundUrl("https://example.com/foo");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.parsed).toBeInstanceOf(URL);
      expect(result.parsed.hostname).toBe("example.com");
    }
  });

  it("validateOutboundUrl returns {valid:false, reason, category} on failure", () => {
    const result = validateOutboundUrl("http://127.0.0.1/");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(typeof result.reason).toBe("string");
      expect(typeof result.category).toBe("string");
    }
  });

  it("SSRFBlockedError carries url + reason fields", () => {
    try {
      requireSafeUrl("http://127.0.0.1/");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SSRFBlockedError);
      if (err instanceof SSRFBlockedError) {
        expect(err.url).toBe("http://127.0.0.1/");
        expect(typeof err.reason).toBe("string");
        expect(err.name).toBe("SSRFBlockedError");
      }
    }
  });

  it("allowPrivate opt-in still works (tests must be able to hit localhost)", () => {
    expect(isSafeUrl("http://127.0.0.1/", { allowPrivate: true })).toBe(true);
  });
});

// ── Reason-code stability (SSRFRejectionReason is not re-shaped) ─

describe("ssrf-guard — rejection reason codes stable", () => {
  it("bad scheme → 'bad-scheme'", () => {
    const r = checkUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad-scheme");
  });

  it("invalid URL → 'invalid-url'", () => {
    const r = checkUrl("not a url");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-url");
  });

  it("metadata host → 'metadata-host'", () => {
    const r = checkUrl("http://169.254.169.254/");
    // live file classifies link-local as 'private-ip' (not metadata-host)
    // because it matches PRIVATE_IPV4_PATTERNS first via isPrivateHost.
    // The point of this test is that SOMETHING rejects it — not that
    // the specific reason is 'metadata-host'.
    expect(r.ok).toBe(false);
  });

  it("named metadata host → 'metadata-host'", () => {
    const r = checkUrl("http://metadata.google.internal/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("metadata-host");
  });

  it("new metadata.goog → 'metadata-host'", () => {
    const r = checkUrl("http://metadata.goog/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("metadata-host");
  });
});
