import { describe, it, expect, beforeEach } from "vitest";
import { DockerSandbox, DockerSandboxError } from "../../src/sandbox/docker-backend.js";
import type { DockerSandboxConfig } from "../../src/sandbox/docker-backend.js";

// ── Test Helpers ────────────────────────────────────

const DEFAULT_CONFIG: DockerSandboxConfig = {
  image: "node:20-slim",
  workspaceMount: "/tmp/test-workspace",
  networkPolicy: "none",
  memoryLimitMb: 256,
  timeoutMs: 10_000,
};

// Note: These tests validate the sandbox API contract without requiring Docker.
// Integration tests that actually create containers belong in tests/e2e/.

// ── Tests ───────────────────────────────────────────

describe("DockerSandbox", () => {
  let sandbox: DockerSandbox;

  beforeEach(() => {
    sandbox = new DockerSandbox();
  });

  describe("constructor", () => {
    it("creates a new sandbox instance", () => {
      expect(sandbox).toBeDefined();
    });

    it("starts with no containers", () => {
      expect(sandbox.listContainers()).toEqual([]);
    });
  });

  describe("listContainers", () => {
    it("returns empty array initially", () => {
      expect(sandbox.listContainers()).toHaveLength(0);
    });
  });

  describe("getContainer", () => {
    it("returns undefined for unknown container", () => {
      expect(sandbox.getContainer("nonexistent")).toBeUndefined();
    });
  });

  describe("run command — error for unknown container", () => {
    it("throws DockerSandboxError for unknown container", async () => {
      await expect(sandbox.exec("nonexistent", "echo hello")).rejects.toThrow(DockerSandboxError);
      await expect(sandbox.exec("nonexistent", "echo hello")).rejects.toThrow("Unknown container");
    });
  });

  describe("copy to container — error for unknown container", () => {
    it("throws DockerSandboxError for unknown container", async () => {
      await expect(
        sandbox.copyToContainer("nonexistent", "/tmp/file", "/workspace/file"),
      ).rejects.toThrow(DockerSandboxError);
    });
  });

  describe("copy from container — error for unknown container", () => {
    it("throws DockerSandboxError for unknown container", async () => {
      await expect(
        sandbox.copyFromContainer("nonexistent", "/workspace/file", "/tmp/file"),
      ).rejects.toThrow(DockerSandboxError);
    });
  });

  describe("destroyAll", () => {
    it("returns 0 when no containers exist", async () => {
      const count = await sandbox.destroyAll();
      expect(count).toBe(0);
    });
  });

  describe("destroy — tolerates already-removed containers", () => {
    it("does not throw for unknown container ID", async () => {
      // destroy is tolerant — it just tries docker rm --force
      await expect(sandbox.destroy("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("DockerSandboxError", () => {
    it("has correct name", () => {
      const error = new DockerSandboxError("test");
      expect(error.name).toBe("DockerSandboxError");
    });

    it("has correct message", () => {
      const error = new DockerSandboxError("something went wrong");
      expect(error.message).toBe("something went wrong");
    });

    it("is an instance of Error", () => {
      const error = new DockerSandboxError("test");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("config types", () => {
    it("accepts all network policies", () => {
      const configs: DockerSandboxConfig[] = [
        { ...DEFAULT_CONFIG, networkPolicy: "none" },
        { ...DEFAULT_CONFIG, networkPolicy: "restricted" },
        { ...DEFAULT_CONFIG, networkPolicy: "full" },
      ];
      expect(configs).toHaveLength(3);
    });

    it("accepts optional fields", () => {
      const config: DockerSandboxConfig = {
        ...DEFAULT_CONFIG,
        cpuLimit: 2,
        readOnlyRoot: true,
        envVars: { NODE_ENV: "test", DEBUG: "true" },
      };
      expect(config.cpuLimit).toBe(2);
      expect(config.readOnlyRoot).toBe(true);
      expect(config.envVars?.NODE_ENV).toBe("test");
    });
  });
});
