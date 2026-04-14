import { describe, it, expect } from "vitest";
import { VirtualPathResolver } from "../../src/core/virtual-paths.js";
import type { VirtualPathConfig } from "../../src/core/virtual-paths.js";

describe("VirtualPathResolver", () => {
  const defaultMounts: VirtualPathConfig[] = [
    { prefix: "/mnt/workspace", physicalRoot: "/home/user/projects/myapp", readOnly: false },
    { prefix: "/mnt/readonly", physicalRoot: "/home/user/reference", readOnly: true },
  ];

  describe("resolve", () => {
    it("resolves a virtual path to physical", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.resolve("/mnt/workspace/src/index.ts");
      expect(result).not.toBeNull();
      expect(result!.physicalPath).toContain("myapp");
      expect(result!.physicalPath).toContain("src");
      expect(result!.readOnly).toBe(false);
    });

    it("resolves readonly mounts", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.resolve("/mnt/readonly/docs/readme.md");
      expect(result).not.toBeNull();
      expect(result!.readOnly).toBe(true);
    });

    it("returns null for unmapped paths", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.resolve("/unmapped/path/file.ts");
      expect(result).toBeNull();
    });

    it("prevents path traversal attacks", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.resolve("/mnt/workspace/../../etc/passwd");
      expect(result).toBeNull();
    });

    it("resolves the mount root itself", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.resolve("/mnt/workspace/");
      expect(result).not.toBeNull();
      expect(result!.relativePath).toBe(".");
    });

    it("includes the correct mount in the result", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.resolve("/mnt/workspace/foo.ts");
      expect(result).not.toBeNull();
      expect(result!.mount.prefix).toContain("workspace");
    });
  });

  describe("virtualize", () => {
    it("converts physical path to virtual", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.virtualize("/home/user/projects/myapp/src/index.ts");
      expect(result).not.toBeNull();
      expect(result).toContain("/mnt/workspace");
      expect(result).toContain("src");
    });

    it("returns null for unmapped physical paths", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.virtualize("/tmp/random/file.ts");
      expect(result).toBeNull();
    });

    it("virtualizes the mount root", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const result = resolver.virtualize("/home/user/projects/myapp");
      expect(result).not.toBeNull();
      expect(result).toContain("/mnt/workspace");
    });
  });

  describe("isWritable", () => {
    it("returns true for writable mounts", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      expect(resolver.isWritable("/mnt/workspace/src/file.ts")).toBe(true);
    });

    it("returns false for readonly mounts", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      expect(resolver.isWritable("/mnt/readonly/docs/file.md")).toBe(false);
    });

    it("returns false for unmapped paths", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      expect(resolver.isWritable("/unknown/path")).toBe(false);
    });
  });

  describe("isValid", () => {
    it("returns true for paths under a mount", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      expect(resolver.isValid("/mnt/workspace/anything")).toBe(true);
    });

    it("returns false for unmapped paths", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      expect(resolver.isValid("/not/mounted")).toBe(false);
    });
  });

  describe("getMounts", () => {
    it("returns all configured mounts", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      expect(resolver.getMounts()).toHaveLength(2);
    });

    it("returns empty for no mounts", () => {
      const resolver = new VirtualPathResolver();
      expect(resolver.getMounts()).toHaveLength(0);
    });
  });

  describe("withMount / withoutMount (immutable)", () => {
    it("adds a mount without mutating original", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const extended = resolver.withMount({
        prefix: "/mnt/extra",
        physicalRoot: "/home/user/extra",
        readOnly: false,
      });

      expect(resolver.getMounts()).toHaveLength(2);
      expect(extended.getMounts()).toHaveLength(3);
      expect(extended.isValid("/mnt/extra/file.ts")).toBe(true);
      expect(resolver.isValid("/mnt/extra/file.ts")).toBe(false);
    });

    it("removes a mount without mutating original", () => {
      const resolver = new VirtualPathResolver(defaultMounts);
      const reduced = resolver.withoutMount("/mnt/readonly");

      expect(resolver.getMounts()).toHaveLength(2);
      expect(reduced.getMounts()).toHaveLength(1);
      expect(reduced.isValid("/mnt/readonly/file")).toBe(false);
    });
  });

  describe("validateMounts", () => {
    it("passes valid mount configs", () => {
      const validation = VirtualPathResolver.validateMounts(defaultMounts);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("detects duplicate prefixes", () => {
      const validation = VirtualPathResolver.validateMounts([
        { prefix: "/mnt/workspace", physicalRoot: "/a", readOnly: false },
        { prefix: "/mnt/workspace", physicalRoot: "/b", readOnly: false },
      ]);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("Duplicate"))).toBe(true);
    });

    it("detects relative physical roots", () => {
      const validation = VirtualPathResolver.validateMounts([
        { prefix: "/mnt/workspace", physicalRoot: "relative/path", readOnly: false },
      ]);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("absolute"))).toBe(true);
    });

    it("detects overlapping prefixes", () => {
      const validation = VirtualPathResolver.validateMounts([
        { prefix: "/mnt/workspace", physicalRoot: "/a", readOnly: false },
        { prefix: "/mnt/workspace/sub", physicalRoot: "/b", readOnly: false },
      ]);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("Overlapping"))).toBe(true);
    });
  });
});
