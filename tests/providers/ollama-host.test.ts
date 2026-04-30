import { describe, it, expect } from "vitest";

import {
  resolveOllamaHost,
  ollamaUrl,
  normalizeOllamaUrl,
  OLLAMA_DEFAULT_URL,
} from "../../src/providers/ollama-host.js";

describe("resolveOllamaHost", () => {
  it("falls back to literal 127.0.0.1:11434 when no env is set", () => {
    expect(resolveOllamaHost({})).toBe("http://127.0.0.1:11434");
    expect(resolveOllamaHost({})).toBe(OLLAMA_DEFAULT_URL);
  });

  it("honors OLLAMA_HOST as the canonical primary", () => {
    expect(resolveOllamaHost({ OLLAMA_HOST: "http://nas.local:11434" })).toBe(
      "http://nas.local:11434",
    );
  });

  it("falls back to OLLAMA_URL when OLLAMA_HOST is unset", () => {
    expect(resolveOllamaHost({ OLLAMA_URL: "http://192.168.1.50:11434" })).toBe(
      "http://192.168.1.50:11434",
    );
  });

  it("OLLAMA_HOST wins over OLLAMA_URL when both are set", () => {
    // Document the upstream-Ollama-CLI-compatible precedence: HOST > URL.
    expect(
      resolveOllamaHost({
        OLLAMA_HOST: "http://primary.local:11434",
        OLLAMA_URL: "http://secondary.local:11434",
      }),
    ).toBe("http://primary.local:11434");
  });

  it("treats empty/whitespace env values as absent", () => {
    expect(resolveOllamaHost({ OLLAMA_HOST: "", OLLAMA_URL: "http://fallback:11434" })).toBe(
      "http://fallback:11434",
    );
    expect(resolveOllamaHost({ OLLAMA_HOST: "   ", OLLAMA_URL: "http://fallback:11434" })).toBe(
      "http://fallback:11434",
    );
  });

  it("normalizes bare host:port to http://host:port", () => {
    expect(resolveOllamaHost({ OLLAMA_HOST: "nas.local:8080" })).toBe(
      "http://nas.local:8080",
    );
  });

  it("normalizes bare hostname to http://host:11434 (default port)", () => {
    expect(resolveOllamaHost({ OLLAMA_HOST: "nas.local" })).toBe("http://nas.local:11434");
  });

  it("preserves https scheme for tunnel/proxy setups", () => {
    expect(resolveOllamaHost({ OLLAMA_HOST: "https://ollama.example.com" })).toBe(
      "https://ollama.example.com",
    );
  });

  it("strips trailing slashes so callers can append paths cleanly", () => {
    expect(resolveOllamaHost({ OLLAMA_HOST: "http://nas.local:11434/" })).toBe(
      "http://nas.local:11434",
    );
    expect(resolveOllamaHost({ OLLAMA_HOST: "http://nas.local:11434///" })).toBe(
      "http://nas.local:11434",
    );
  });
});

describe("ollamaUrl", () => {
  it("appends an absolute path correctly", () => {
    expect(ollamaUrl("/api/tags", {})).toBe("http://127.0.0.1:11434/api/tags");
  });

  it("appends a relative path with implicit leading slash", () => {
    expect(ollamaUrl("api/tags", {})).toBe("http://127.0.0.1:11434/api/tags");
  });

  it("returns the bare base when no path is given", () => {
    expect(ollamaUrl("", {})).toBe("http://127.0.0.1:11434");
    expect(ollamaUrl(undefined as unknown as string, {})).toBe("http://127.0.0.1:11434");
  });

  it("composes correctly when env points at a tunneled host", () => {
    expect(ollamaUrl("/api/version", { OLLAMA_HOST: "https://ollama.example.com" })).toBe(
      "https://ollama.example.com/api/version",
    );
  });
});

describe("normalizeOllamaUrl (exported for completeness)", () => {
  it("returns the default when given empty input", () => {
    expect(normalizeOllamaUrl("")).toBe("http://127.0.0.1:11434");
    expect(normalizeOllamaUrl("   ")).toBe("http://127.0.0.1:11434");
  });

  it("preserves http and https URLs as-is (minus trailing slash)", () => {
    expect(normalizeOllamaUrl("http://x.y:1234")).toBe("http://x.y:1234");
    expect(normalizeOllamaUrl("https://x.y:1234/")).toBe("https://x.y:1234");
  });

  it("upgrades host:port to a URL with http://", () => {
    expect(normalizeOllamaUrl("nas.local:8080")).toBe("http://nas.local:8080");
  });

  it("upgrades bare host to host:11434", () => {
    expect(normalizeOllamaUrl("nas.local")).toBe("http://nas.local:11434");
  });
});
