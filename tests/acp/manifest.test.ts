/**
 * Tests for `src/acp/manifest.ts` — buildManifest reads package.json
 * and produces a registry-ready manifest.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManifest,
  BuildManifestError,
  type AcpRegistryManifest,
} from "../../src/acp/manifest.js";
import { ACP_PROTOCOL_VERSION } from "../../src/acp/protocol.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-acp-manifest-"));
}

function writePkg(dir: string, pkg: Record<string, unknown>): string {
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify(pkg, null, 2));
  return path;
}

describe("buildManifest — reads package.json", () => {
  it("extracts name, version, description from the package.json", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "The All-Father of AI Agent Harnesses",
        license: "MIT",
        homepage: "https://wotann.com",
        repository: { type: "git", url: "git+https://github.com/wotann/wotann.git" },
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      expect(manifest.id).toBe("wotann");
      expect(manifest.name).toBe("Wotann");
      expect(manifest.version).toBe("0.4.0");
      expect(manifest.description).toBe("The All-Father of AI Agent Harnesses");
      expect(manifest.license).toBe("MIT");
      expect(manifest.website).toBe("https://wotann.com");
      expect(manifest.repository).toBe("https://github.com/wotann/wotann");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("strips @scope from npm package name when deriving the id", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "@anthropic-ai/wotann",
        version: "1.0.0",
        description: "scoped package",
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      expect(manifest.id).toBe("wotann");
      expect(manifest.name).toBe("Wotann");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts author as object and extracts the name", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "d",
        author: { name: "Gabriel Vuksani" },
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      expect(manifest.authors).toEqual(["Gabriel Vuksani"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildManifest — required fields", () => {
  it("contains all required FORMAT.md fields (id, name, version, description, distribution)", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "description",
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      expect(typeof manifest.id).toBe("string");
      expect(typeof manifest.name).toBe("string");
      expect(typeof manifest.version).toBe("string");
      expect(typeof manifest.description).toBe("string");
      expect(manifest.distribution).toBeDefined();
      // At least one distribution transport must be present.
      const hasAnyTransport =
        manifest.distribution.binary !== undefined ||
        manifest.distribution.npx !== undefined ||
        manifest.distribution.uvx !== undefined;
      expect(hasAnyTransport).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("embeds ACP version + transports in capabilities.acp", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "d",
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      expect(manifest.capabilities?.acp.version).toBe(ACP_PROTOCOL_VERSION);
      expect(manifest.capabilities?.acp.transports).toContain("stdio");
      expect(manifest.capabilities?.mcp).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts tools, models, languages overrides and surfaces them in capabilities", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "d",
      });
      const manifest = buildManifest({
        packageJsonPath: pkgPath,
        tools: ["Bash", "Read", "Edit"],
        models: ["anthropic", "openai"],
        languages: ["typescript", "rust"],
      });
      expect(manifest.capabilities?.tools).toEqual(["Bash", "Read", "Edit"]);
      expect(manifest.capabilities?.models).toEqual(["anthropic", "openai"]);
      expect(manifest.capabilities?.languages).toEqual(["typescript", "rust"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildManifest — honest failures", () => {
  it("throws BuildManifestError when package.json does not exist", () => {
    const dir = tempDir();
    try {
      expect(() =>
        buildManifest({ packageJsonPath: join(dir, "missing.json") }),
      ).toThrow(BuildManifestError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when package.json is malformed JSON", () => {
    const dir = tempDir();
    try {
      const pkgPath = join(dir, "package.json");
      writeFileSync(pkgPath, "not json{{");
      expect(() => buildManifest({ packageJsonPath: pkgPath })).toThrow(BuildManifestError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws explicit error when `name` is missing (no silent default)", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, { version: "0.4.0", description: "d" });
      expect(() => buildManifest({ packageJsonPath: pkgPath })).toThrow(/name/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws explicit error when `description` is missing and no override", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, { name: "wotann", version: "0.4.0" });
      expect(() => buildManifest({ packageJsonPath: pkgPath })).toThrow(/description/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a description override when package.json has none", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, { name: "wotann", version: "0.4.0" });
      const manifest = buildManifest({
        packageJsonPath: pkgPath,
        description: "explicit override",
      });
      expect(manifest.description).toBe("explicit override");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildManifest — distribution.npx is canonical for WOTANN", () => {
  it("sets distribution.npx.package to name + major.minor.0", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.2-rc.1",
        description: "d",
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      expect(manifest.distribution.npx?.package).toBe("wotann@^0.4.0");
      expect(manifest.distribution.npx?.args).toEqual(["acp"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildManifest — shape is JSON-serializable (registry-ready)", () => {
  it("produces an object that round-trips through JSON without data loss", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "d",
        repository: { url: "git+https://github.com/wotann/wotann.git" },
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      const json = JSON.stringify(manifest);
      const roundTripped = JSON.parse(json) as AcpRegistryManifest;
      expect(roundTripped.id).toBe(manifest.id);
      expect(roundTripped.version).toBe(manifest.version);
      expect(roundTripped.distribution).toEqual(manifest.distribution);
      expect(roundTripped.repository).toBe("https://github.com/wotann/wotann");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
