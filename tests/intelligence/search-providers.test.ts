import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createBraveSearchProvider,
  createTavilySearchProvider,
  fallbackSearchProvider,
  cachingSearchProvider,
  createDefaultWebSearchProvider,
  type WebSearchProvider,
} from "../../src/intelligence/search-providers.js";

function makeMockFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return responder(url, init);
  }) as unknown as typeof fetch;
}

describe("createBraveSearchProvider", () => {
  it("returns [] on empty query", async () => {
    const fetchImpl = makeMockFetch(() => new Response("should not be called", { status: 500 }));
    const provider = createBraveSearchProvider({ apiKey: "x", fetchImpl });
    expect(await provider.search("  ")).toEqual([]);
  });

  it("throws if no apiKey and no env", async () => {
    delete process.env.BRAVE_API_KEY;
    const provider = createBraveSearchProvider({});
    await expect(provider.search("foo")).rejects.toThrow(/BRAVE_API_KEY/);
  });

  it("parses Brave API response into SearchHit[]", async () => {
    const fetchImpl = makeMockFetch((url) => {
      expect(url).toContain("api.search.brave.com");
      expect(url).toContain("q=typescript");
      return new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "TS docs", url: "https://typescriptlang.org/", description: "TypeScript is..." },
              { title: "TS wiki", url: "https://wiki.com/ts", description: "Superset of JS" },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const provider = createBraveSearchProvider({ apiKey: "k", fetchImpl });
    const hits = await provider.search("typescript", 10);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.title).toBe("TS docs");
    expect(hits[0]?.url).toBe("https://typescriptlang.org/");
    expect(hits[1]?.snippet).toBe("Superset of JS");
  });

  it("clamps maxResults to [1, 20]", async () => {
    const fetchImpl = makeMockFetch((url) => {
      expect(url).toContain("count=20");
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    });
    const provider = createBraveSearchProvider({ apiKey: "k", fetchImpl });
    await provider.search("q", 9999);
  });

  it("sends X-Subscription-Token header", async () => {
    let captured: Headers | undefined;
    const fetchImpl = makeMockFetch((_u, init) => {
      captured = new Headers(init?.headers as HeadersInit);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    });
    const provider = createBraveSearchProvider({ apiKey: "secret-key", fetchImpl });
    await provider.search("foo");
    expect(captured?.get("x-subscription-token")).toBe("secret-key");
  });

  it("throws on non-200 status with body preview", async () => {
    const fetchImpl = makeMockFetch(() => new Response("rate limit exceeded", { status: 429 }));
    const provider = createBraveSearchProvider({ apiKey: "k", fetchImpl });
    await expect(provider.search("q")).rejects.toThrow(/429/);
  });
});

describe("createTavilySearchProvider", () => {
  it("POSTs to /search with apiKey in body", async () => {
    let capturedBody: string | undefined;
    const fetchImpl = makeMockFetch((url, init) => {
      expect(url).toContain("api.tavily.com");
      expect(init?.method).toBe("POST");
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          results: [{ title: "T", url: "https://t.com", content: "Snippet" }],
        }),
        { status: 200 },
      );
    });
    const provider = createTavilySearchProvider({ apiKey: "tavk", fetchImpl });
    const hits = await provider.search("q");
    expect(hits[0]?.title).toBe("T");
    expect(hits[0]?.snippet).toBe("Snippet");
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody ?? "{}");
    expect(parsed.api_key).toBe("tavk");
    expect(parsed.query).toBe("q");
  });

  it("throws when TAVILY_API_KEY missing", async () => {
    delete process.env.TAVILY_API_KEY;
    const provider = createTavilySearchProvider({});
    await expect(provider.search("foo")).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe("fallbackSearchProvider", () => {
  it("returns first non-empty result", async () => {
    const p1: WebSearchProvider = {
      name: "p1",
      search: async () => [],
    };
    const p2: WebSearchProvider = {
      name: "p2",
      search: async () => [{ title: "from p2", url: "u", snippet: "s" }],
    };
    const chain = fallbackSearchProvider([p1, p2]);
    const hits = await chain.search("q");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("from p2");
  });

  it("falls through errors to next provider", async () => {
    const p1: WebSearchProvider = {
      name: "p1",
      search: async () => {
        throw new Error("p1 is down");
      },
    };
    const p2: WebSearchProvider = {
      name: "p2",
      search: async () => [{ title: "ok", url: "u", snippet: "s" }],
    };
    const chain = fallbackSearchProvider([p1, p2]);
    const hits = await chain.search("q");
    expect(hits[0]?.title).toBe("ok");
  });

  it("throws the last error when all providers fail", async () => {
    const p: WebSearchProvider = {
      name: "p",
      search: async () => {
        throw new Error("boom");
      },
    };
    const chain = fallbackSearchProvider([p, p]);
    await expect(chain.search("q")).rejects.toThrow(/boom/);
  });

  it("rejects empty provider list", () => {
    expect(() => fallbackSearchProvider([])).toThrow(/at least one provider/);
  });

  it("name includes all sub-providers", () => {
    const p1: WebSearchProvider = { name: "a", search: async () => [] };
    const p2: WebSearchProvider = { name: "b", search: async () => [] };
    const chain = fallbackSearchProvider([p1, p2]);
    expect(chain.name).toBe("fallback(a+b)");
  });
});

describe("cachingSearchProvider", () => {
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches results and short-circuits the underlying provider on hit", async () => {
    const underlying = vi.fn(async () => [{ title: "t", url: "u", snippet: "s" }]);
    const provider: WebSearchProvider = { name: "u", search: underlying };
    const cached = cachingSearchProvider(provider, { now: () => now });

    await cached.search("q");
    await cached.search("q");
    await cached.search("q");
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("normalizes query casing", async () => {
    const underlying = vi.fn(async () => [{ title: "t", url: "u", snippet: "s" }]);
    const provider: WebSearchProvider = { name: "u", search: underlying };
    const cached = cachingSearchProvider(provider, { now: () => now });
    await cached.search("Foo Bar");
    await cached.search("foo bar  ");
    await cached.search("  FOO BAR");
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("expires entries after ttlMs", async () => {
    const underlying = vi.fn(async () => [{ title: "t", url: "u", snippet: "s" }]);
    const provider: WebSearchProvider = { name: "u", search: underlying };
    const cached = cachingSearchProvider(provider, { ttlMs: 1000, now: () => now });
    await cached.search("q");
    now += 500;
    await cached.search("q");
    expect(underlying).toHaveBeenCalledTimes(1);
    now += 600; // total elapsed 1100ms — exceeds ttl
    await cached.search("q");
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest entry when over maxEntries", async () => {
    const underlying = vi.fn(async () => [{ title: "t", url: "u", snippet: "s" }]);
    const provider: WebSearchProvider = { name: "u", search: underlying };
    const cached = cachingSearchProvider(provider, { maxEntries: 2, now: () => now });
    await cached.search("a");
    await cached.search("b");
    await cached.search("c"); // evicts "a"
    await cached.search("a"); // cache miss again
    expect(underlying).toHaveBeenCalledTimes(4);
  });

  it("different maxResults values are cached separately", async () => {
    const underlying = vi.fn(async () => [{ title: "t", url: "u", snippet: "s" }]);
    const provider: WebSearchProvider = { name: "u", search: underlying };
    const cached = cachingSearchProvider(provider, { now: () => now });
    await cached.search("q", 5);
    await cached.search("q", 10);
    expect(underlying).toHaveBeenCalledTimes(2);
  });
});

describe("createDefaultWebSearchProvider", () => {
  // Snapshot the env we mutate so we can restore after each test —
  // otherwise these process.env writes leak across files and break
  // tests that assume a clean env (discovery.test.ts,
  // account-pool.test.ts). The pollution surfaced when the vitest
  // pool was changed: forks isolate process state per file, but
  // vmThreads/threads share process.env regardless of vm context.
  // The fix here makes the test correct under any pool.
  const originalBrave = process.env.BRAVE_API_KEY;
  const originalTavily = process.env.TAVILY_API_KEY;

  afterEach(() => {
    if (originalBrave !== undefined) process.env.BRAVE_API_KEY = originalBrave;
    else delete process.env.BRAVE_API_KEY;
    if (originalTavily !== undefined) process.env.TAVILY_API_KEY = originalTavily;
    else delete process.env.TAVILY_API_KEY;
  });

  it("returns null when no API keys present", () => {
    delete process.env.BRAVE_API_KEY;
    delete process.env.TAVILY_API_KEY;
    expect(createDefaultWebSearchProvider()).toBeNull();
  });

  it("returns single cached provider with only Brave key", () => {
    process.env.BRAVE_API_KEY = "brave-x";
    delete process.env.TAVILY_API_KEY;
    const p = createDefaultWebSearchProvider();
    expect(p).not.toBeNull();
    expect(p?.name).toBe("cache(brave)");
  });

  it("returns fallback chain with both keys", () => {
    process.env.BRAVE_API_KEY = "bx";
    process.env.TAVILY_API_KEY = "tx";
    const p = createDefaultWebSearchProvider();
    expect(p?.name).toBe("cache(fallback(brave+tavily))");
  });
});
