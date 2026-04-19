/**
 * Tests for src/lsp/server-registry.ts — Phase D LSP Serena-parity port.
 *
 * These tests never spawn real language servers or call real `which` —
 * the registry exposes a `whichChecker` hook expressly so tests stay
 * hermetic. We verify:
 *
 *   - Catalog shape: 10 languages, stable ordering, unique extensions.
 *   - Detection: cached, invalidated on demand, honours the checker hook.
 *   - Extension routing: `.ts`/`.rs`/`.py`/... map to the correct server.
 *   - Honest errors: `lspNotInstalled()` produces a structured payload
 *     with a concrete install hint and the homepage pointer when present.
 *   - Lifecycle: `start` refuses when the binary is missing.
 */

import { describe, it, expect, vi } from "vitest";
import {
  LSP_SERVER_CATALOG,
  LanguageServerRegistry,
  lspNotInstalled,
  type LspLanguage,
} from "../../src/lsp/server-registry.js";

const ALWAYS_AVAILABLE = vi.fn(async () => true);
const NEVER_AVAILABLE = vi.fn(async () => false);

describe("LSP_SERVER_CATALOG", () => {
  it("exposes exactly the 10 languages the task requires", () => {
    const languages = LSP_SERVER_CATALOG.map((c) => c.language).sort();
    expect(languages).toEqual(
      [
        "csharp",
        "go",
        "java",
        "kotlin",
        "php",
        "python",
        "ruby",
        "rust",
        "swift",
        "typescript",
      ].sort(),
    );
  });

  it("every entry carries an install hint", () => {
    for (const config of LSP_SERVER_CATALOG) {
      expect(config.installHint).toBeTruthy();
      expect(config.installHint.length).toBeGreaterThan(5);
    }
  });

  it("every entry lists at least one file extension", () => {
    for (const config of LSP_SERVER_CATALOG) {
      expect(config.extensions.length).toBeGreaterThan(0);
      for (const ext of config.extensions) {
        expect(ext.startsWith(".")).toBe(true);
      }
    }
  });

  it("extensions are unique across the catalog (first-match wins)", () => {
    // Verifies the catalog itself doesn't have conflicting claims —
    // serverFor uses first-match, but two identical claims would be a
    // smell. We allow .ts/.js/.jsx/.tsx all under typescript.
    const extensionToLanguage = new Map<string, LspLanguage>();
    for (const config of LSP_SERVER_CATALOG) {
      for (const ext of config.extensions) {
        const existing = extensionToLanguage.get(ext);
        expect(
          existing,
          `Extension ${ext} claimed by both ${existing} and ${config.language}`,
        ).toBeUndefined();
        extensionToLanguage.set(ext, config.language);
      }
    }
  });
});

describe("LanguageServerRegistry.detect", () => {
  it("returns a result for every catalog language", async () => {
    const reg = new LanguageServerRegistry({ whichChecker: ALWAYS_AVAILABLE });
    const result = await reg.detect();
    expect(result.size).toBe(10);
    for (const language of reg.listLanguages()) {
      expect(result.has(language)).toBe(true);
    }
  });

  it("caches subsequent detect() calls", async () => {
    const checker = vi.fn(async () => true);
    const reg = new LanguageServerRegistry({ whichChecker: checker });
    await reg.detect();
    await reg.detect();
    // 10 languages x 1 probe (cached on 2nd call)
    expect(checker).toHaveBeenCalledTimes(10);
  });

  it("invalidateDetectCache forces a re-probe", async () => {
    const checker = vi.fn(async () => true);
    const reg = new LanguageServerRegistry({ whichChecker: checker });
    await reg.detect();
    reg.invalidateDetectCache();
    await reg.detect();
    expect(checker).toHaveBeenCalledTimes(20);
  });

  it("isInstalled uses the checker hook", async () => {
    const reg = new LanguageServerRegistry({
      whichChecker: async (cmd) => cmd === "rust-analyzer",
    });
    expect(await reg.isInstalled("rust")).toBe(true);
    expect(await reg.isInstalled("go")).toBe(false);
  });
});

describe("LanguageServerRegistry.serverFor", () => {
  const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });

  it("routes .ts to typescript", () => {
    const config = reg.serverFor("/abs/path/foo.ts");
    expect(config?.language).toBe("typescript");
  });

  it("routes .rs to rust", () => {
    expect(reg.serverFor("foo.rs")?.language).toBe("rust");
  });

  it("routes .py to python", () => {
    expect(reg.serverFor("foo.py")?.language).toBe("python");
  });

  it("routes .go to go", () => {
    expect(reg.serverFor("foo.go")?.language).toBe("go");
  });

  it("routes .java to java", () => {
    expect(reg.serverFor("Foo.java")?.language).toBe("java");
  });

  it("routes .swift to swift", () => {
    expect(reg.serverFor("Foo.swift")?.language).toBe("swift");
  });

  it("routes .kt to kotlin", () => {
    expect(reg.serverFor("Foo.kt")?.language).toBe("kotlin");
  });

  it("routes .cs to csharp", () => {
    expect(reg.serverFor("Foo.cs")?.language).toBe("csharp");
  });

  it("routes .rb to ruby", () => {
    expect(reg.serverFor("foo.rb")?.language).toBe("ruby");
  });

  it("routes .php to php", () => {
    expect(reg.serverFor("foo.php")?.language).toBe("php");
  });

  it("returns null for unknown extensions", () => {
    expect(reg.serverFor("foo.unknownext")).toBe(null);
  });

  it("returns null for extensionless paths", () => {
    expect(reg.serverFor("Makefile")).toBe(null);
  });
});

describe("lspNotInstalled()", () => {
  it("produces the structured error payload for every catalog entry", () => {
    for (const config of LSP_SERVER_CATALOG) {
      const err = lspNotInstalled(config);
      expect(err.error).toBe("lsp_not_installed");
      expect(err.language).toBe(config.language);
      expect(err.command).toBe(config.command);
      expect(err.fix).toBe(config.installHint);
    }
  });

  it("includes homepage when the config has one", () => {
    const tsConfig = LSP_SERVER_CATALOG.find((c) => c.language === "typescript")!;
    const err = lspNotInstalled(tsConfig);
    expect(err.homepage).toBe(tsConfig.homepage);
  });
});

describe("LanguageServerRegistry lifecycle", () => {
  it("start() returns false when the binary is missing", async () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    const started = await reg.start("rust");
    expect(started).toBe(false);
    expect(reg.isRunning("rust")).toBe(false);
  });

  it("ensureForFile returns null for unknown extensions", async () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    const result = await reg.ensureForFile("/path/to/file.weird");
    expect(result).toBe(null);
  });

  it("ensureForFile returns lsp_not_installed error for known ext with missing binary", async () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    const result = await reg.ensureForFile("/path/to/main.rs");
    expect(result).not.toBe(null);
    expect(result && "error" in result ? result.error : null).toBe("lsp_not_installed");
    // Honest install hint must come through verbatim.
    if (result && "error" in result) {
      expect(result.fix).toMatch(/rust-analyzer/);
    }
  });

  it("stop() is a no-op when nothing is running", () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    expect(() => reg.stop("rust")).not.toThrow();
  });

  it("stopAll() is a no-op when nothing is running", () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    expect(() => reg.stopAll()).not.toThrow();
  });

  it("runningLanguages() is empty when no server started", async () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    await reg.start("rust");
    expect(reg.runningLanguages()).toEqual([]);
  });
});

describe("LanguageServerRegistry config lookup", () => {
  it("configFor returns the full config for a known language", () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    const config = reg.configFor("rust");
    expect(config?.command).toBe("rust-analyzer");
    expect(config?.extensions).toContain(".rs");
  });

  it("installHint returns the catalog hint", () => {
    const reg = new LanguageServerRegistry({ whichChecker: NEVER_AVAILABLE });
    expect(reg.installHint("rust")).toMatch(/rust-analyzer/);
    expect(reg.installHint("go")).toMatch(/gopls/);
    expect(reg.installHint("php")).toMatch(/intelephense/);
  });
});
