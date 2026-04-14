import { describe, it, expect } from "vitest";
import {
  generateFakeTools,
  embedWatermark,
  extractWatermark,
  hasWatermark,
} from "../../src/security/anti-distillation.js";

describe("Anti-Distillation (Phase 15)", () => {
  describe("fake tool injection", () => {
    it("generates the requested number of fake tools", () => {
      const fakes = generateFakeTools(3);
      expect(fakes).toHaveLength(3);
    });

    it("each fake tool has name, description, schema", () => {
      const fakes = generateFakeTools(2);
      for (const fake of fakes) {
        expect(fake.name).toBeTruthy();
        expect(fake.description).toBeTruthy();
        expect(fake.inputSchema).toBeDefined();
      }
    });

    it("generates requested number of polymorphic tools", () => {
      const fakes = generateFakeTools(100);
      expect(fakes.length).toBe(100);
      // Verify all names are unique (polymorphic generation)
      const names = new Set(fakes.map((f) => f.name));
      expect(names.size).toBe(100);
    });
  });

  describe("response watermarking", () => {
    it("embeds invisible watermark in text", () => {
      const original = "Here is the code you requested. It implements the auth module.";
      const watermarked = embedWatermark(original, "nx");

      // Text should look the same (visible content preserved)
      expect(watermarked.replace(/[\u200B\u200C\u200D\uFEFF]/g, "")).toBe(original);
      // But it contains zero-width chars
      expect(hasWatermark(watermarked)).toBe(true);
    });

    it("detects watermark presence", () => {
      const clean = "No watermark here";
      const dirty = "Has\u200Bwatermark";

      expect(hasWatermark(clean)).toBe(false);
      expect(hasWatermark(dirty)).toBe(true);
    });

    it("clean text has no watermark", () => {
      expect(hasWatermark("Regular text with no special characters")).toBe(false);
    });
  });
});
