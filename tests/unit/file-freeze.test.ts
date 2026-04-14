import { describe, it, expect, beforeEach } from "vitest";
import { FileFreezer } from "../../src/security/file-freeze.js";

describe("File Freeze", () => {
  let freezer: FileFreezer;

  beforeEach(() => {
    freezer = new FileFreezer("/Users/test/project");
  });

  describe("freeze/unfreeze", () => {
    it("freezes a file by exact path", () => {
      freezer.freeze("tsconfig.json", "Config protection");
      const result = freezer.check("tsconfig.json");
      expect(result.frozen).toBe(true);
      expect(result.rule?.reason).toBe("Config protection");
    });

    it("unfreezes a non-permanent rule", () => {
      freezer.freeze("tsconfig.json");
      const unfrozen = freezer.unfreeze("tsconfig.json");
      expect(unfrozen).toBe(true);
      expect(freezer.check("tsconfig.json").frozen).toBe(false);
    });

    it("refuses to unfreeze permanent rules", () => {
      freezer.freeze("package.json", "Never touch", true);
      const unfrozen = freezer.unfreeze("package.json");
      expect(unfrozen).toBe(false);
      expect(freezer.check("package.json").frozen).toBe(true);
    });

    it("deduplicates freeze rules", () => {
      freezer.freeze("tsconfig.json");
      freezer.freeze("tsconfig.json");
      expect(freezer.getRules()).toHaveLength(1);
    });
  });

  describe("pattern matching", () => {
    it("matches wildcard extensions", () => {
      freezer.freeze("*.json");
      expect(freezer.check("tsconfig.json").frozen).toBe(true);
      expect(freezer.check("package.json").frozen).toBe(true);
      expect(freezer.check("index.ts").frozen).toBe(false);
    });

    it("matches directory prefixes", () => {
      freezer.freeze("node_modules/");
      expect(freezer.check("node_modules/express/index.js").frozen).toBe(true);
      expect(freezer.check("src/index.ts").frozen).toBe(false);
    });

    it("matches double-star glob patterns", () => {
      freezer.freeze("**/*.test.ts");
      expect(freezer.check("src/utils/helpers.test.ts").frozen).toBe(true);
      expect(freezer.check("src/utils/helpers.ts").frozen).toBe(false);
    });

    it("matches glob with prefix wildcards", () => {
      freezer.freeze(".eslintrc*");
      expect(freezer.check(".eslintrc.js").frozen).toBe(true);
      expect(freezer.check(".eslintrc.json").frozen).toBe(true);
    });
  });

  describe("focus mode", () => {
    it("blocks edits outside the focus path", () => {
      freezer.setFocus("src/core");
      const result = freezer.check("/Users/test/project/src/utils/helper.ts");
      expect(result.frozen).toBe(true);
      expect(result.rule?.frozenBy).toBe("focus-mode");
    });

    it("allows edits inside the focus path", () => {
      freezer.setFocus("src/core");
      const result = freezer.check("/Users/test/project/src/core/mode-cycling.ts");
      expect(result.frozen).toBe(false);
    });

    it("clears focus mode", () => {
      freezer.setFocus("src/core");
      freezer.clearFocus();
      const result = freezer.check("/Users/test/project/src/utils/helper.ts");
      expect(result.frozen).toBe(false);
    });
  });

  describe("config freeze", () => {
    it("freezes common config files", () => {
      const frozen = freezer.freezeConfigFiles();
      expect(frozen.length).toBeGreaterThan(5);
      expect(freezer.check("tsconfig.json").frozen).toBe(true);
      expect(freezer.check("package.json").frozen).toBe(true);
      expect(freezer.check(".env").frozen).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears non-permanent rules and focus", () => {
      freezer.freeze("tsconfig.json");
      freezer.freeze("package.json", "Never touch", true);
      freezer.setFocus("src/");

      freezer.reset();

      expect(freezer.check("tsconfig.json").frozen).toBe(false);
      expect(freezer.check("package.json").frozen).toBe(true); // permanent survives
      expect(freezer.getFocus()).toBeNull();
    });
  });
});
