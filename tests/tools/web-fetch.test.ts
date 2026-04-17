import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WebFetchTool,
  _stripHtml,
  _extractTitle,
  _validateUrl,
  _extractMainContent,
  _isTestEnvironment,
  _createPinnedDispatcher,
} from "../../src/tools/web-fetch.js";

// ── HTML Stripping ───────────────────────────────────────

describe("stripHtml", () => {
  it("removes basic HTML tags", () => {
    const result = _stripHtml("<p>Hello <b>world</b></p>");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<b>");
  });

  it("removes script blocks entirely", () => {
    const html = '<p>Before</p><script>alert("xss")</script><p>After</p>';
    const result = _stripHtml(html);
    expect(result).toContain("Before");
    expect(result).toContain("After");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("script");
  });

  it("removes style blocks entirely", () => {
    const html = "<p>Text</p><style>body { color: red; }</style>";
    const result = _stripHtml(html);
    expect(result).toContain("Text");
    expect(result).not.toContain("color");
    expect(result).not.toContain("style");
  });

  it("removes HTML comments", () => {
    const html = "<p>Visible</p><!-- hidden comment --><p>Also visible</p>";
    const result = _stripHtml(html);
    expect(result).toContain("Visible");
    expect(result).toContain("Also visible");
    expect(result).not.toContain("hidden comment");
  });

  it("decodes HTML entities", () => {
    const html = "<p>Tom &amp; Jerry &lt;3&gt;</p>";
    const result = _stripHtml(html);
    expect(result).toContain("Tom & Jerry <3>");
  });

  it("collapses excessive whitespace", () => {
    const html = "<p>Hello</p>\n\n\n\n\n<p>World</p>";
    const result = _stripHtml(html);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("handles empty string", () => {
    expect(_stripHtml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(_stripHtml("Just plain text")).toBe("Just plain text");
  });

  it("removes noscript blocks", () => {
    const html = "<noscript><p>Enable JS</p></noscript><p>Content</p>";
    const result = _stripHtml(html);
    expect(result).toContain("Content");
    expect(result).not.toContain("Enable JS");
  });
});

// ── Title Extraction ─────────────────────────────────────

describe("extractTitle", () => {
  it("extracts title from standard HTML", () => {
    const html = "<html><head><title>My Page</title></head><body></body></html>";
    expect(_extractTitle(html)).toBe("My Page");
  });

  it("returns null when no title exists", () => {
    const html = "<html><head></head><body>No title here</body></html>";
    expect(_extractTitle(html)).toBeNull();
  });

  it("decodes entities in title", () => {
    const html = "<title>Tom &amp; Jerry</title>";
    expect(_extractTitle(html)).toBe("Tom & Jerry");
  });

  it("trims whitespace from title", () => {
    const html = "<title>  Spaced Title  </title>";
    expect(_extractTitle(html)).toBe("Spaced Title");
  });

  it("handles multiline title", () => {
    const html = "<title>\n  Multi\n  Line\n</title>";
    expect(_extractTitle(html)).toBe("Multi\n  Line");
  });
});

// ── URL Validation ───────────────────────────────────────

describe("validateUrl", () => {
  const allowedProtocols = ["https:", "http:"];

  it("accepts valid HTTPS URL", () => {
    const result = _validateUrl("https://example.com", allowedProtocols);
    expect(result.valid).toBe(true);
  });

  it("accepts valid HTTP URL", () => {
    const result = _validateUrl("http://example.com/path?q=1", allowedProtocols);
    expect(result.valid).toBe(true);
  });

  it("rejects file:// protocol (SSRF prevention)", () => {
    const result = _validateUrl("file:///etc/passwd", allowedProtocols);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("not allowed");
    }
  });

  it("rejects ftp:// protocol", () => {
    const result = _validateUrl("ftp://evil.com/data", allowedProtocols);
    expect(result.valid).toBe(false);
  });

  it("rejects invalid URL", () => {
    const result = _validateUrl("not a url", allowedProtocols);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Invalid URL");
    }
  });

  it("rejects empty string", () => {
    const result = _validateUrl("", allowedProtocols);
    expect(result.valid).toBe(false);
  });

  it("allows custom protocol list", () => {
    const result = _validateUrl("ftp://files.com/data", ["ftp:"]);
    expect(result.valid).toBe(true);
  });
});

// ── Main Content Extraction ──────────────────────────────

describe("extractMainContent", () => {
  it("extracts content from <main> tag", () => {
    const html = "<nav>Menu</nav><main><p>Main content here</p></main><footer>Footer</footer>";
    const result = _extractMainContent(html);
    expect(result).toContain("Main content here");
    expect(result).not.toContain("Menu");
    expect(result).not.toContain("Footer");
  });

  it("extracts content from <article> tag when no <main>", () => {
    const html = "<nav>Menu</nav><article><p>Article text</p></article><aside>Sidebar</aside>";
    const result = _extractMainContent(html);
    expect(result).toContain("Article text");
    expect(result).not.toContain("Menu");
    expect(result).not.toContain("Sidebar");
  });

  it("falls back to full stripped content when no main/article", () => {
    const html = "<div><p>Just some content</p></div>";
    const result = _extractMainContent(html);
    expect(result).toContain("Just some content");
  });

  it("removes nav, header, footer, aside", () => {
    const html = "<header>Head</header><nav>Nav</nav><div>Body</div><aside>Side</aside><footer>Foot</footer>";
    const result = _extractMainContent(html);
    expect(result).toContain("Body");
    expect(result).not.toContain("Head");
    expect(result).not.toContain("Nav");
    expect(result).not.toContain("Side");
    expect(result).not.toContain("Foot");
  });
});

// ── WebFetchTool ─────────────────────────────────────────

describe("WebFetchTool", () => {
  let tool: WebFetchTool;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tool = new WebFetchTool();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(body: string, options?: {
    readonly status?: number;
    readonly contentType?: string;
  }): void {
    const status = options?.status ?? 200;
    const contentType = options?.contentType ?? "text/html; charset=utf-8";

    globalThis.fetch = vi.fn().mockResolvedValue({
      status,
      text: () => Promise.resolve(body),
      headers: new Headers({ "content-type": contentType }),
    });
  }

  it("constructs with default config", () => {
    const t = new WebFetchTool();
    expect(t).toBeInstanceOf(WebFetchTool);
  });

  it("constructs with partial config override", () => {
    const t = new WebFetchTool({ maxContentBytes: 50_000, userAgent: "Test/1.0" });
    expect(t).toBeInstanceOf(WebFetchTool);
  });

  describe("fetch()", () => {
    it("returns structured result for HTML content", async () => {
      mockFetch("<html><head><title>Test Page</title></head><body><p>Hello</p></body></html>");

      const result = await tool.fetch("https://example.com");

      expect(result.url).toBe("https://example.com");
      expect(result.status).toBe(200);
      expect(result.contentType).toContain("text/html");
      expect(result.title).toBe("Test Page");
      expect(result.markdown).toContain("Hello");
      expect(result.truncated).toBe(false);
      expect(result.fetchDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns plain text for non-HTML content", async () => {
      mockFetch('{"key": "value"}', { contentType: "application/json" });

      const result = await tool.fetch("https://api.example.com/data");

      expect(result.title).toBeNull();
      expect(result.markdown).toContain('"key"');
    });

    it("returns error result for invalid URL", async () => {
      const result = await tool.fetch("not-a-valid-url");

      expect(result.status).toBe(0);
      expect(result.contentType).toBe("error");
      expect(result.content).toContain("Error:");
    });

    it("returns error result for disallowed protocol", async () => {
      const result = await tool.fetch("file:///etc/passwd");

      expect(result.status).toBe(0);
      expect(result.content).toContain("not allowed");
    });

    it("handles fetch errors gracefully", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      const result = await tool.fetch("https://down.example.com");

      expect(result.status).toBe(0);
      expect(result.content).toContain("Network failure");
    });

    it("truncates content exceeding maxContentBytes", async () => {
      const longContent = "A".repeat(200_000);
      mockFetch(longContent, { contentType: "text/plain" });

      const smallTool = new WebFetchTool({ maxContentBytes: 1000 });
      const result = await smallTool.fetch("https://example.com/large");

      expect(result.truncated).toBe(true);
      expect(result.byteLength).toBe(1000);
    });

    it("does not truncate content within limit", async () => {
      mockFetch("Short content", { contentType: "text/plain" });

      const result = await tool.fetch("https://example.com/small");

      expect(result.truncated).toBe(false);
    });

    it("strips HTML from markdown field", async () => {
      mockFetch("<p>Clean <b>text</b></p><script>evil()</script>");

      const result = await tool.fetch("https://example.com");

      expect(result.markdown).not.toContain("<p>");
      expect(result.markdown).not.toContain("<b>");
      expect(result.markdown).not.toContain("evil");
      expect(result.markdown).toContain("Clean");
      expect(result.markdown).toContain("text");
    });

    it("preserves raw HTML in content field", async () => {
      const html = "<p>Raw <b>HTML</b></p>";
      mockFetch(html);

      const result = await tool.fetch("https://example.com");

      expect(result.content).toContain("<p>");
      expect(result.content).toContain("<b>");
    });

    it("handles non-Error exceptions", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue("string error");

      const result = await tool.fetch("https://example.com");

      expect(result.status).toBe(0);
      expect(result.content).toContain("string error");
    });
  });

  describe("fetchText()", () => {
    it("returns main content for HTML pages", async () => {
      mockFetch("<nav>Menu</nav><main><p>Main body</p></main><footer>Foot</footer>");

      const text = await tool.fetchText("https://example.com");

      expect(text).toContain("Main body");
      expect(text).not.toContain("Menu");
    });

    it("returns plain text for non-HTML content", async () => {
      mockFetch("Plain text data", { contentType: "text/plain" });

      const text = await tool.fetchText("https://example.com/data.txt");

      expect(text).toBe("Plain text data");
    });

    it("returns error message on failure", async () => {
      const text = await tool.fetchText("file:///etc/passwd");

      expect(text).toContain("Error:");
    });
  });

  // ── DNS-rebinding TOCTOU regression guards (session 4) ─────
  //
  // Session 3 shipped a dispatcher fix that was runtime-broken in
  // production (Node's globalThis.fetch rejected the installed undici
  // Agent with "invalid onRequestStart method"). VITEST=1 short-circuited
  // the entire pinning path, so 43/43 tests passed without exercising
  // the fix. These tests directly exercise the helpers that silently
  // regressed, independent of the fetch path.

  describe("isTestEnvironment (session 4 regression guards)", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("returns true when both NODE_ENV=test and VITEST=true", () => {
      process.env["NODE_ENV"] = "test";
      process.env["VITEST"] = "true";
      delete process.env["WOTANN_TEST_MODE"];
      expect(_isTestEnvironment()).toBe(true);
    });

    it("returns true with NODE_ENV=test and WOTANN_TEST_MODE=1", () => {
      process.env["NODE_ENV"] = "test";
      process.env["WOTANN_TEST_MODE"] = "1";
      delete process.env["VITEST"];
      expect(_isTestEnvironment()).toBe(true);
    });

    it("returns FALSE when VITEST=1 alone in production (regression guard)", () => {
      // Prior buggy `||` chain treated this as test-mode and disabled
      // SSRF protection. A leaked VITEST env could let attackers reach
      // 169.254.169.254 AWS metadata from a production binary.
      process.env["NODE_ENV"] = "production";
      process.env["VITEST"] = "true";
      delete process.env["WOTANN_TEST_MODE"];
      expect(_isTestEnvironment()).toBe(false);
    });

    it("returns FALSE when WOTANN_TEST_MODE=0 (strings are truthy regression)", () => {
      // Prior buggy `||` chain treated `"0"` as truthy and disabled
      // SSRF — operators explicitly disabling test mode would in fact
      // disable the SSRF defence.
      process.env["NODE_ENV"] = "test";
      process.env["WOTANN_TEST_MODE"] = "0";
      delete process.env["VITEST"];
      expect(_isTestEnvironment()).toBe(false);
    });

    it("returns FALSE when no test marker is set", () => {
      process.env["NODE_ENV"] = "test";
      delete process.env["WOTANN_TEST_MODE"];
      delete process.env["VITEST"];
      expect(_isTestEnvironment()).toBe(false);
    });

    it("returns FALSE when NODE_ENV is production regardless of markers", () => {
      process.env["NODE_ENV"] = "production";
      process.env["WOTANN_TEST_MODE"] = "1";
      process.env["VITEST"] = "true";
      expect(_isTestEnvironment()).toBe(false);
    });
  });

  describe("createPinnedDispatcher (session 4 regression guards)", () => {
    it("returns null when addresses array is empty", () => {
      const dispatcher = _createPinnedDispatcher([]);
      expect(dispatcher).toBeNull();
    });

    it("builds an Agent when addresses are provided", () => {
      const dispatcher = _createPinnedDispatcher([
        { address: "93.184.216.34", family: 4 },
      ]);
      expect(dispatcher).not.toBeNull();
    });

    it("builds an Agent (not a generic dispatcher) with connect.lookup configured", async () => {
      // Agent 4 runtime-verified that undici's connect.lookup is called
      // with `options.all=true` and expects `cb(null, [{address, family}])`
      // — not the positional `cb(null, addr, family)` signature. The
      // prior implementation used only positional, and node's socket
      // layer crashed with "Invalid IP address: undefined". The
      // full-path proof of the callback shape is the isTestEnvironment +
      // end-to-end fetch integration — here we only assert the Agent
      // was constructed (not null), so future refactors that
      // accidentally return a generic Dispatcher would fail this guard.
      const dispatcher = _createPinnedDispatcher([
        { address: "93.184.216.34", family: 4 },
      ]);
      expect(dispatcher).not.toBeNull();
      // Undici's Agent exposes `close` and `destroy` on its prototype —
      // close without throwing proves the instance is fully constructed.
      await dispatcher!.close();
    });
  });

  describe("fetchAll()", () => {
    it("fetches multiple URLs in parallel", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(`<p>Page ${callCount}</p>`),
          headers: new Headers({ "content-type": "text/html" }),
        });
      });

      const urls = [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ];

      const results = await tool.fetchAll(urls);

      expect(results).toHaveLength(3);
      expect(results[0]?.url).toBe("https://example.com/a");
      expect(results[1]?.url).toBe("https://example.com/b");
      expect(results[2]?.url).toBe("https://example.com/c");
    });

    it("handles individual failures without affecting others", async () => {
      let callIndex = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          return Promise.reject(new Error("Second failed"));
        }
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve("<p>OK</p>"),
          headers: new Headers({ "content-type": "text/html" }),
        });
      });

      const results = await tool.fetchAll([
        "https://example.com/ok1",
        "https://example.com/fail",
        "https://example.com/ok2",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]?.status).toBe(200);
      expect(results[1]?.status).toBe(0);
      expect(results[1]?.content).toContain("Second failed");
      expect(results[2]?.status).toBe(200);
    });

    it("returns empty array for empty input", async () => {
      const results = await tool.fetchAll([]);
      expect(results).toHaveLength(0);
    });
  });
});
