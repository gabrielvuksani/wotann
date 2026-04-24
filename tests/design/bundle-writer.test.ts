/**
 * V9 T8.2 — Bundle writer tests.
 *
 * Covers the directory-tree output shape, optional section handling,
 * overwrite safety, and the `_wotann-partial` sentinel behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeHandoffBundle,
  type BundleManifest,
} from "../../src/design/bundle-writer.js";
import type { DtcgBundle } from "../../src/design/dtcg-emitter.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function emptyDtcg(): DtcgBundle {
  return {
    colors: {},
    spacing: {},
    typography: {},
    borderRadius: {},
    shadows: {},
    extras: {},
  };
}

function baseManifest(): BundleManifest {
  return {
    name: "Test Bundle",
    version: "1.0.0",
    bundleVersion: "1.0.0",
  };
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "wotann-bundle-writer-"));
});

afterEach(() => {
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

// ── Happy path ────────────────────────────────────────────────────────────

describe("writeHandoffBundle — happy path", () => {
  it("writes manifest.json + design-system.json at minimum", () => {
    const out = join(workDir, "bundle");
    const result = writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
      },
      out,
    );
    expect(result.ok).toBe(true);
    expect(result.filesWritten).toBe(2);
    expect(existsSync(join(out, "manifest.json"))).toBe(true);
    expect(existsSync(join(out, "design-system.json"))).toBe(true);
  });

  it("manifest uses snake_case keys the receiver expects", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      {
        manifest: {
          ...baseManifest(),
          author: "Gabriel",
          exportedFrom: "WOTANN",
          createdAt: "2026-04-23T00:00:00Z",
        },
        designSystem: emptyDtcg(),
      },
      out,
    );
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf-8"));
    expect(manifest.name).toBe("Test Bundle");
    expect(manifest.bundle_version).toBe("1.0.0");
    expect(manifest.exported_from).toBe("WOTANN");
    expect(manifest.created_at).toBe("2026-04-23T00:00:00Z");
    // camelCase should NOT appear
    expect(manifest.bundleVersion).toBeUndefined();
    expect(manifest.exportedFrom).toBeUndefined();
  });

  it("optional fields are only emitted when present", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emptyDtcg() },
      out,
    );
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf-8"));
    expect(manifest.author).toBeUndefined();
    expect(manifest.exported_from).toBeUndefined();
    expect(manifest.created_at).toBeUndefined();
  });

  it("writeTokensAlias=true produces tokens.json duplicate", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
        writeTokensAlias: true,
      },
      out,
    );
    expect(existsSync(join(out, "tokens.json"))).toBe(true);
    const design = readFileSync(join(out, "design-system.json"), "utf-8");
    const tokens = readFileSync(join(out, "tokens.json"), "utf-8");
    expect(tokens).toBe(design);
  });

  it("writeTokensAlias=false (default) does NOT produce tokens.json", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emptyDtcg() },
      out,
    );
    expect(existsSync(join(out, "tokens.json"))).toBe(false);
  });

  it("components.json is emitted when components are provided", () => {
    const out = join(workDir, "bundle");
    const result = writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
        components: [{ name: "Button", props: { variant: "primary" } }],
      },
      out,
    );
    expect(existsSync(join(out, "components.json"))).toBe(true);
    expect(result.filesWritten).toBe(3);
    const components = JSON.parse(readFileSync(join(out, "components.json"), "utf-8"));
    expect(components[0].name).toBe("Button");
  });

  it("code-scaffold files go under code-scaffold/ subdir", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
        codeScaffold: [
          { path: "App.tsx", contents: "export default function App() {}" },
          { path: "index.css", contents: "body{}" },
        ],
      },
      out,
    );
    expect(existsSync(join(out, "code-scaffold", "App.tsx"))).toBe(true);
    expect(existsSync(join(out, "code-scaffold", "index.css"))).toBe(true);
  });

  it("does not double-prefix paths already starting with code-scaffold/", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
        codeScaffold: [{ path: "code-scaffold/App.tsx", contents: "x" }],
      },
      out,
    );
    expect(existsSync(join(out, "code-scaffold", "App.tsx"))).toBe(true);
    expect(existsSync(join(out, "code-scaffold", "code-scaffold", "App.tsx"))).toBe(false);
  });

  it("binary assets are written under assets/ and preserve bytes", () => {
    const out = join(workDir, "bundle");
    const bytes = Buffer.from([0x00, 0xff, 0x7f, 0x80]);
    writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
        assets: [{ path: "icon.bin", data: bytes }],
      },
      out,
    );
    const readBack = readFileSync(join(out, "assets", "icon.bin"));
    expect(readBack.equals(bytes)).toBe(true);
  });
});

// ── Overwrite safety ──────────────────────────────────────────────────────

describe("writeHandoffBundle — overwrite safety", () => {
  it("refuses to overwrite an existing non-empty directory", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emptyDtcg() },
      out,
    );
    expect(() =>
      writeHandoffBundle(
        { manifest: baseManifest(), designSystem: emptyDtcg() },
        out,
      ),
    ).toThrow(/already exists/);
  });

  it("force=true overwrites cleanly (no stale files survive)", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emptyDtcg(),
        components: [{ name: "Stale" }],
      },
      out,
    );
    expect(existsSync(join(out, "components.json"))).toBe(true);

    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emptyDtcg() },
      out,
      { force: true },
    );
    // Stale components.json should be gone because force clears the dir.
    expect(existsSync(join(out, "components.json"))).toBe(false);
    // But a fresh design-system.json should exist.
    expect(existsSync(join(out, "design-system.json"))).toBe(true);
  });
});

// ── Partial-write sentinel ────────────────────────────────────────────────

describe("writeHandoffBundle — sentinel", () => {
  it("removes the _wotann-partial sentinel on success", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emptyDtcg() },
      out,
    );
    expect(existsSync(join(out, "_wotann-partial"))).toBe(false);
  });

  it("leaves sentinel behind when a write throws mid-flight", () => {
    const out = join(workDir, "bundle");
    // Inject an asset with an invalid path (null-byte not allowed)
    // to force the underlying mkdirSync/writeFileSync to fail.
    const nastyAsset = { path: "bad\0path", data: Buffer.from("x") };
    expect(() =>
      writeHandoffBundle(
        {
          manifest: baseManifest(),
          designSystem: emptyDtcg(),
          assets: [nastyAsset],
        },
        out,
      ),
    ).toThrow(/writeHandoffBundle failed/);
    // Manifest + design-system got written before the bad asset;
    // sentinel should still be present.
    expect(existsSync(join(out, "_wotann-partial"))).toBe(true);
    expect(readdirSync(out)).toContain("_wotann-partial");
  });
});

// ── Round-trip with T8.1 emitter ──────────────────────────────────────────

describe("writeHandoffBundle + serializeDtcg", () => {
  it("design-system.json is valid JSON the receiver can parse", () => {
    const out = join(workDir, "bundle");
    const bundle: DtcgBundle = {
      colors: {
        primary: { $type: "color", $value: "#06b6d4" },
      },
      spacing: {},
      typography: {},
      borderRadius: {},
      shadows: {},
      extras: {},
    };
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: bundle },
      out,
    );
    const text = readFileSync(join(out, "design-system.json"), "utf-8");
    const parsed = JSON.parse(text);
    expect(parsed.colors.primary.$type).toBe("color");
    expect(parsed.colors.primary.$value).toBe("#06b6d4");
  });
});
