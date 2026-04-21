/**
 * Tests for `src/acp/registry.ts` + `src/cli/commands/acp-register.ts`:
 *   - validateManifest() checks FORMAT.md conformance
 *   - registerWithZed() — network + local-only + SSRF paths
 *   - runAcpRegisterCommand() — CLI entry surface
 *
 * Network submissions are mocked via the `fetchImpl` injection; no
 * real HTTP requests leave the test process (per task rules).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateManifest,
  registerWithZed,
  writeManifestToDisk,
  REGISTRY_MANUAL_SUBMIT_URL,
} from "../../src/acp/registry.js";
import { buildManifest, type AcpRegistryManifest } from "../../src/acp/manifest.js";
import { runAcpRegisterCommand } from "../../src/cli/commands/acp-register.js";
import { ACP_PROTOCOL_VERSION } from "../../src/acp/protocol.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-acp-registry-"));
}

function writePkg(dir: string, pkg: Record<string, unknown>): string {
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify(pkg, null, 2));
  return path;
}

function validManifest(): AcpRegistryManifest {
  return {
    id: "wotann",
    name: "WOTANN",
    version: "0.4.0",
    description: "AI agent harness",
    distribution: {
      npx: { package: "wotann@^0.4.0", args: ["acp"] },
    },
    capabilities: {
      acp: { version: ACP_PROTOCOL_VERSION, transports: ["stdio"] },
      mcp: true,
      tools: ["Bash", "Read"],
      languages: ["typescript"],
      models: [],
    },
  };
}

// validateManifest ──────────────────────────────────────────

describe("validateManifest — required-fields enforcement", () => {
  it("accepts a fully-formed WOTANN manifest", () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a manifest missing required fields", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
    expect(result.errors.some((e) => e.includes("description"))).toBe(true);
  });

  it("rejects non-kebab-case id", () => {
    const result = validateManifest({ ...validManifest(), id: "WOTANN_CamelCase" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("kebab-case"))).toBe(true);
  });

  it("rejects non-semver version", () => {
    const result = validateManifest({ ...validManifest(), version: "not-a-version" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("semver"))).toBe(true);
  });

  it("rejects manifest with no distribution transport", () => {
    const result = validateManifest({ ...validManifest(), distribution: {} });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("binary") && e.includes("npx") && e.includes("uvx"),
      ),
    ).toBe(true);
  });

  it("warns on description longer than 160 chars", () => {
    const result = validateManifest({
      ...validManifest(),
      description: "x".repeat(200),
    });
    expect(result.valid).toBe(true); // not blocking
    expect(result.warnings.some((w) => w.includes("description"))).toBe(true);
  });

  it("warns on ACP version mismatch (simulates 0.3 vs 0.4 upgrade)", () => {
    const mismatched = {
      ...validManifest(),
      capabilities: {
        ...validManifest().capabilities!,
        acp: { version: 999, transports: ["stdio"] },
      },
    };
    const result = validateManifest(mismatched);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("999"))).toBe(true);
  });

  it("rejects manifest with invalid binary distribution", () => {
    const bad = {
      ...validManifest(),
      distribution: {
        binary: {
          platforms: {
            "darwin-aarch64": { url: 123 }, // url must be string
          },
        },
      },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
  });
});

// writeManifestToDisk ───────────────────────────────────────

describe("writeManifestToDisk", () => {
  it("creates parent directories and writes a pretty-printed JSON file", () => {
    const dir = tempDir();
    try {
      const path = join(dir, "nested", "subdir", "agent.json");
      const manifest = validManifest();
      const returned = writeManifestToDisk(manifest, path);
      expect(returned).toBe(path);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content).toMatch(/"id": "wotann"/);
      expect(content.endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// registerWithZed ──────────────────────────────────────────

describe("registerWithZed — validation gate", () => {
  it("short-circuits on validation errors without touching disk or network", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      const result = await registerWithZed({} as unknown as AcpRegistryManifest, {
        manifestOutPath: manifestPath,
        fetchImpl: async () => {
          throw new Error("should not be called");
        },
      });
      expect(result.status).toBe("VALIDATION-FAILED");
      expect(existsSync(manifestPath)).toBe(false);
      expect(result.validationErrors?.length ?? 0).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("registerWithZed — dry-run + local-only", () => {
  it("dry-run writes the manifest to disk but skips the network", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      let fetchCalled = false;
      const result = await registerWithZed(validManifest(), {
        manifestOutPath: manifestPath,
        registryUrl: "https://example.com/acp",
        dryRun: true,
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response("", { status: 200 });
        },
      });
      expect(result.status).toBe("LOCAL-ONLY");
      expect(existsSync(manifestPath)).toBe(true);
      expect(fetchCalled).toBe(false);
      expect(result.manualSubmitUrl).toBe(REGISTRY_MANUAL_SUBMIT_URL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("local-only when no registry URL is provided", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      const result = await registerWithZed(validManifest(), {
        manifestOutPath: manifestPath,
      });
      expect(result.status).toBe("LOCAL-ONLY");
      expect(result.registryUrl).toBeUndefined();
      expect(existsSync(manifestPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("registerWithZed — POST success/failure paths", () => {
  it("reports SUBMITTED when the POST returns 2xx", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      let receivedUrl = "";
      let receivedAuth = "";
      const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
        receivedUrl = url;
        receivedAuth = (init.headers as Record<string, string>)["authorization"] ?? "";
        return new Response("ok", { status: 201 });
      };
      const result = await registerWithZed(validManifest(), {
        manifestOutPath: manifestPath,
        registryUrl: "https://registry.example.com/acp",
        registryToken: "tkn_123",
        fetchImpl,
      });
      expect(result.status).toBe("SUBMITTED");
      expect(receivedUrl).toBe("https://registry.example.com/acp");
      expect(receivedAuth).toBe("Bearer tkn_123");
      // Local copy is still written even on success, as a record.
      expect(existsSync(manifestPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to LOCAL-ONLY on network error and keeps the local manifest", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      const result = await registerWithZed(validManifest(), {
        manifestOutPath: manifestPath,
        registryUrl: "https://example.com/acp",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      });
      expect(result.status).toBe("LOCAL-ONLY");
      expect(result.reason).toMatch(/ECONNREFUSED/);
      expect(existsSync(manifestPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to LOCAL-ONLY on HTTP error and keeps the local manifest", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      const result = await registerWithZed(validManifest(), {
        manifestOutPath: manifestPath,
        registryUrl: "https://example.com/acp",
        fetchImpl: async () => new Response("internal error", { status: 500 }),
      });
      expect(result.status).toBe("LOCAL-ONLY");
      expect(result.reason).toMatch(/500/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("registerWithZed — SSRF guard blocks dangerous URLs", () => {
  it("blocks private-IP registry URLs before touching fetch", async () => {
    const dir = tempDir();
    try {
      const manifestPath = join(dir, "agent.json");
      let fetchCalled = false;
      const result = await registerWithZed(validManifest(), {
        manifestOutPath: manifestPath,
        registryUrl: "http://169.254.169.254/registry",
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response("", { status: 200 });
        },
      });
      expect(result.status).toBe("BLOCKED-URL");
      expect(fetchCalled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// runAcpRegisterCommand — CLI entry ────────────────────────

describe("runAcpRegisterCommand", () => {
  it("dry-run prints the manifest shape without network I/O", async () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "test",
      });
      const manifestOut = join(dir, "out", "agent.json");
      let fetchCalled = false;
      const result = await runAcpRegisterCommand({
        cwd: dir,
        packageJsonPath: pkgPath,
        manifestOut,
        dryRun: true,
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response("", { status: 200 });
        },
      });
      expect(result.success).toBe(true);
      expect(fetchCalled).toBe(false);
      expect(result.manifest?.id).toBe("wotann");
      expect(result.lines.some((l) => l.includes("DRY-RUN"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns success=false on malformed package.json (honest failure)", async () => {
    const dir = tempDir();
    try {
      const pkgPath = join(dir, "package.json");
      writeFileSync(pkgPath, "{bad json");
      const result = await runAcpRegisterCommand({
        cwd: dir,
        packageJsonPath: pkgPath,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.lines.some((l) => l.includes("Manifest build failed"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wires registry URL + token through to the fetch call", async () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "test",
      });
      const manifestOut = join(dir, "out", "agent.json");
      let seenUrl = "";
      let seenAuth = "";
      const result = await runAcpRegisterCommand({
        cwd: dir,
        packageJsonPath: pkgPath,
        manifestOut,
        registryUrl: "https://api.example.com/submit",
        registryToken: "tkn",
        fetchImpl: async (url, init) => {
          seenUrl = url;
          seenAuth = (init.headers as Record<string, string>)["authorization"] ?? "";
          return new Response("ok", { status: 200 });
        },
      });
      expect(result.success).toBe(true);
      expect(result.result?.status).toBe("SUBMITTED");
      expect(seenUrl).toBe("https://api.example.com/submit");
      expect(seenAuth).toBe("Bearer tkn");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("end-to-end with real package.json → buildManifest → validate → write", async () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "WOTANN agent harness",
        license: "MIT",
        homepage: "https://wotann.com",
        repository: { url: "git+https://github.com/wotann/wotann.git" },
      });
      const manifestOut = join(dir, "out", "agent.json");
      const result = await runAcpRegisterCommand({
        cwd: dir,
        packageJsonPath: pkgPath,
        manifestOut,
      });
      expect(result.success).toBe(true);
      expect(result.result?.status).toBe("LOCAL-ONLY");
      expect(existsSync(manifestOut)).toBe(true);
      const written = JSON.parse(readFileSync(manifestOut, "utf-8")) as AcpRegistryManifest;
      expect(written.id).toBe("wotann");
      expect(written.distribution.npx?.package).toBe("wotann@^0.4.0");
      // Ensure `validateManifest` agrees the output is a ready-to-PR manifest.
      const validation = validateManifest(written);
      expect(validation.valid).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// buildManifest <-> validateManifest roundtrip ─────────────

describe("buildManifest output always passes validateManifest", () => {
  it("the manifest built from a minimal valid package.json is registry-valid", () => {
    const dir = tempDir();
    try {
      const pkgPath = writePkg(dir, {
        name: "wotann",
        version: "0.4.0",
        description: "d",
      });
      const manifest = buildManifest({ packageJsonPath: pkgPath });
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
