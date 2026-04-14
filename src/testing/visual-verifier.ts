/**
 * Visual Test Verification: screenshot + OCR/vision for tests that need
 * visual confirmation beyond CLI output.
 *
 * DESIGN PRINCIPLE: The default behavior is to allow the model to look at
 * the computer screen if the test needs to be done outside of CLI.
 *
 * Three modes:
 * 1. CLI tests → standard stdout/stderr verification (no visual)
 * 2. Browser tests → Chrome extension screenshot + DOM comparison
 * 3. Desktop tests → native screenshot + OCR or vision model analysis
 *
 * For non-vision models: text-mediated fallback via accessibility tree
 * or OCR text extraction (uses the capability augmentation layer).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProviderCapabilities } from "../providers/types.js";

// ── Types ──────────────────────────────────────────────────

export type VerificationMode = "cli" | "browser" | "desktop";

export interface VisualVerificationResult {
  readonly mode: VerificationMode;
  readonly passed: boolean;
  readonly description: string;
  readonly screenshotPath?: string;
  readonly extractedText?: string;
  readonly confidence: number;
}

export interface VisualVerificationOptions {
  readonly mode: VerificationMode;
  readonly expectation: string;
  readonly screenshotDir?: string;
  readonly url?: string;
  readonly selector?: string;
}

// ── Screenshot Capture ─────────────────────────────────────

/**
 * Capture a screenshot of the current screen (macOS).
 * Uses the native `screencapture` command.
 */
export function captureScreenshot(outputPath: string): boolean {
  try {
    execFileSync("screencapture", ["-x", outputPath], {
      timeout: 10_000, stdio: "pipe",
    });
    return existsSync(outputPath);
  } catch {
    return false;
  }
}

/**
 * Capture a screenshot of a specific window by title (macOS).
 */
export function captureWindowScreenshot(windowTitle: string, outputPath: string): boolean {
  try {
    // Use screencapture with window selection via AppleScript
    execFileSync("screencapture", ["-x", "-l", windowTitle, outputPath], {
      timeout: 10_000, stdio: "pipe",
    });
    return existsSync(outputPath);
  } catch {
    return false;
  }
}

// ── Text Extraction (for non-vision models) ────────────────

/**
 * Extract text from a screenshot using macOS Vision framework.
 * Falls back to simple image description if OCR is unavailable.
 */
export function extractTextFromImage(imagePath: string): string {
  if (!existsSync(imagePath)) return "";

  // Try macOS shortcuts-based OCR
  try {
    const result = execFileSync("shortcuts", [
      "run", "Extract Text from Image",
      "-i", imagePath,
    ], { timeout: 15_000, encoding: "utf-8", stdio: "pipe" });

    return result.trim();
  } catch {
    // OCR shortcut not available — return placeholder
    return `[Screenshot captured at ${imagePath} — OCR not available. Use a vision-capable model for analysis.]`;
  }
}

/**
 * Get the accessibility tree of the frontmost application (macOS).
 * This provides a text representation of the UI that any model can process.
 */
export function getAccessibilityTree(): string {
  try {
    // Use AppleScript to get UI elements
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        set appProcess to first application process whose name is frontApp
        set windowList to every window of appProcess
        set result to ""
        repeat with w in windowList
          set result to result & "Window: " & name of w & linefeed
          try
            set uiElements to every UI element of w
            repeat with elem in uiElements
              set result to result & "  " & role of elem & ": " & (value of elem as text) & linefeed
            end repeat
          end try
        end repeat
        return result
      end tell
    `;

    const result = execFileSync("osascript", ["-e", script], {
      timeout: 10_000, encoding: "utf-8", stdio: "pipe",
    });

    return result.trim();
  } catch {
    return "[Accessibility tree not available]";
  }
}

// ── Verification Logic ─────────────────────────────────────

/**
 * Verify a visual expectation against the current screen state.
 * Returns a structured result that the agent can use to decide pass/fail.
 */
export function verifyVisual(
  options: VisualVerificationOptions,
  capabilities: ProviderCapabilities,
): VisualVerificationResult {
  const screenshotDir = options.screenshotDir ?? join(process.cwd(), ".wotann", "screenshots");

  if (!existsSync(screenshotDir)) {
    mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = Date.now();
  const screenshotPath = join(screenshotDir, `verify-${timestamp}.png`);

  switch (options.mode) {
    case "cli":
      // CLI mode: no screenshot needed, just return the expectation for inline check
      return {
        mode: "cli",
        passed: true,
        description: "CLI verification — use stdout/stderr output directly",
        confidence: 1.0,
      };

    case "browser":
      // Browser mode: would use Chrome extension for screenshot
      // For now, capture full screen as fallback
      return capturAndVerify(screenshotPath, options, capabilities);

    case "desktop":
      return capturAndVerify(screenshotPath, options, capabilities);

    default:
      return {
        mode: options.mode,
        passed: false,
        description: `Unknown verification mode: ${options.mode}`,
        confidence: 0,
      };
  }
}

function capturAndVerify(
  screenshotPath: string,
  options: VisualVerificationOptions,
  capabilities: ProviderCapabilities,
): VisualVerificationResult {
  const captured = captureScreenshot(screenshotPath);

  if (!captured) {
    return {
      mode: options.mode,
      passed: false,
      description: "Failed to capture screenshot",
      confidence: 0,
    };
  }

  // For vision-capable models, return the screenshot path — the model will analyze it
  if (capabilities.supportsVision) {
    return {
      mode: options.mode,
      passed: true, // Preliminary — model will do actual analysis
      description: `Screenshot captured. Vision model should analyze against: "${options.expectation}"`,
      screenshotPath,
      confidence: 0.5, // Preliminary — model determines final pass/fail
    };
  }

  // For non-vision models, extract text and provide text-mediated description
  const extractedText = extractTextFromImage(screenshotPath);
  const a11yTree = getAccessibilityTree();

  const textDescription = [
    "## Screen State (text-mediated)",
    "",
    "### OCR Text:",
    extractedText || "(no text extracted)",
    "",
    "### Accessibility Tree:",
    a11yTree || "(not available)",
    "",
    `### Expected: ${options.expectation}`,
  ].join("\n");

  return {
    mode: options.mode,
    passed: true, // Preliminary — model determines based on text
    description: textDescription,
    screenshotPath,
    extractedText,
    confidence: 0.3, // Lower confidence for text-mediated
  };
}

/**
 * Determine the best verification mode for a given test description.
 */
export function detectVerificationMode(testDescription: string): VerificationMode {
  const lower = testDescription.toLowerCase();

  if (lower.includes("browser") || lower.includes("chrome") || lower.includes("page") ||
      lower.includes("url") || lower.includes("website") || lower.includes("dom") ||
      lower.includes("html") || lower.includes("css")) {
    return "browser";
  }

  if (lower.includes("screen") || lower.includes("window") || lower.includes("desktop") ||
      lower.includes("gui") || lower.includes("visual") || lower.includes("ui") ||
      lower.includes("app") || lower.includes("display")) {
    return "desktop";
  }

  return "cli";
}
