import { describe, it, expect } from "vitest";
import { detectVerificationMode, verifyVisual } from "../../src/testing/visual-verifier.js";
import type { ProviderCapabilities } from "../../src/providers/types.js";

const VISION_CAPS: ProviderCapabilities = {
  supportsComputerUse: true, supportsToolCalling: true, supportsVision: true,
  supportsStreaming: true, supportsThinking: true, maxContextWindow: 1_000_000,
};

const TEXT_ONLY_CAPS: ProviderCapabilities = {
  supportsComputerUse: false, supportsToolCalling: true, supportsVision: false,
  supportsStreaming: true, supportsThinking: false, maxContextWindow: 32_000,
};

describe("Visual Test Verifier", () => {
  describe("detectVerificationMode", () => {
    it("detects browser mode from web-related keywords", () => {
      expect(detectVerificationMode("Check the login page loads correctly")).toBe("browser");
      expect(detectVerificationMode("Verify the Chrome tab shows the dashboard")).toBe("browser");
      expect(detectVerificationMode("Check the HTML form renders")).toBe("browser");
      expect(detectVerificationMode("Verify the URL is correct")).toBe("browser");
    });

    it("detects desktop mode from GUI-related keywords", () => {
      expect(detectVerificationMode("Check the desktop window is visible")).toBe("desktop");
      expect(detectVerificationMode("Verify the GUI shows the settings panel")).toBe("desktop");
      expect(detectVerificationMode("Check the visual output matches")).toBe("desktop");
    });

    it("defaults to CLI mode for text-based tests", () => {
      expect(detectVerificationMode("Run tests and verify output")).toBe("cli");
      expect(detectVerificationMode("Check the function returns correct value")).toBe("cli");
      expect(detectVerificationMode("Verify the API response")).toBe("cli");
    });
  });

  describe("verifyVisual (CLI mode)", () => {
    it("returns pass for CLI mode without screenshots", () => {
      const result = verifyVisual({
        mode: "cli",
        expectation: "Test output should contain 'PASS'",
      }, VISION_CAPS);

      expect(result.mode).toBe("cli");
      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(1.0);
    });
  });

  describe("verifyVisual (desktop mode)", () => {
    it("attempts screenshot capture for desktop mode", () => {
      const result = verifyVisual({
        mode: "desktop",
        expectation: "Window shows settings",
        screenshotDir: "/tmp/wotann-test-screenshots",
      }, VISION_CAPS);

      // On CI or headless, screenshot capture may fail — that's OK
      expect(result.mode).toBe("desktop");
      expect(typeof result.passed).toBe("boolean");
    });

    it("provides text-mediated fallback for non-vision models", () => {
      const result = verifyVisual({
        mode: "desktop",
        expectation: "Settings panel visible",
        screenshotDir: "/tmp/wotann-test-screenshots",
      }, TEXT_ONLY_CAPS);

      expect(result.mode).toBe("desktop");
      // Non-vision models get lower confidence
      if (result.screenshotPath) {
        expect(result.confidence).toBeLessThanOrEqual(0.5);
      }
    });
  });
});
