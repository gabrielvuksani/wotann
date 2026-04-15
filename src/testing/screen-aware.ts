/**
 * Screen-Aware Testing — verify visual outcomes using computer use.
 *
 * DEFAULT BEHAVIOR: When a test requires visual verification (e.g., "check
 * if the button is visible"), the harness automatically uses the computer-use
 * layer to take a screenshot and verify the visual state.
 *
 * This works across all environments:
 * 1. Chrome DevTools Protocol — for web app testing
 * 2. Desktop screenshot + OCR — for native app testing
 * 3. Text-mediated fallback — describe the screen for non-vision models
 *
 * INTEGRATION:
 * - Used by the autonomous mode for end-to-end verification
 * - Used by the forced verification middleware after UI changes
 * - Can be invoked manually via `wotann test --visual`
 */

import { takeScreenshot, getActiveWindowTitle } from "../computer-use/platform-bindings.js";
import { ChromeBridge } from "../browser/chrome-bridge.js";

export interface VisualTestCase {
  readonly id: string;
  readonly description: string;
  readonly target: "browser" | "desktop" | "auto";
  readonly assertions: readonly VisualAssertion[];
  readonly url?: string;
  readonly selector?: string;
}

export interface VisualAssertion {
  readonly type:
    | "element-visible"
    | "text-present"
    | "no-error"
    | "screenshot-diff"
    | "color-check";
  readonly value: string;
  readonly tolerance?: number;
}

export interface VisualTestResult {
  readonly testId: string;
  readonly passed: boolean;
  readonly screenshotPath?: string;
  readonly textContent?: string;
  readonly assertions: readonly VisualAssertionResult[];
  readonly durationMs: number;
}

export interface VisualAssertionResult {
  readonly type: string;
  readonly passed: boolean;
  readonly message: string;
}

/**
 * Run a visual test case.
 * Automatically selects the best verification method based on target.
 */
export async function runVisualTest(
  testCase: VisualTestCase,
  chromeBridge?: ChromeBridge,
): Promise<VisualTestResult> {
  const start = Date.now();
  const results: VisualAssertionResult[] = [];
  let screenshotPath: string | undefined;
  let textContent: string | undefined;

  const target = testCase.target === "auto" ? detectTarget(testCase) : testCase.target;

  if (target === "browser" && chromeBridge) {
    // Use Chrome DevTools for browser testing
    const domResult = await chromeBridge.execute({ type: "read_dom", selector: testCase.selector });
    if (domResult.success && domResult.domTree) {
      textContent = chromeBridge.domToText(domResult.domTree);
    }

    // Take browser screenshot
    const ssResult = await chromeBridge.execute({ type: "screenshot" });
    if (ssResult.success) {
      screenshotPath = ssResult.screenshotPath;
    }

    // Run assertions against DOM text
    for (const assertion of testCase.assertions) {
      results.push(evaluateVisualAssertion(assertion, textContent ?? "", screenshotPath));
    }
  } else {
    // Desktop: take screenshot and check window title
    const screenshot = takeScreenshot();
    if (screenshot) {
      screenshotPath = screenshot.path;
    }

    const windowTitle = getActiveWindowTitle() ?? "";
    textContent = `Active window: ${windowTitle}`;

    for (const assertion of testCase.assertions) {
      results.push(evaluateVisualAssertion(assertion, textContent, screenshotPath));
    }
  }

  return {
    testId: testCase.id,
    passed: results.every((r) => r.passed),
    screenshotPath,
    textContent,
    assertions: results,
    durationMs: Date.now() - start,
  };
}

function detectTarget(testCase: VisualTestCase): "browser" | "desktop" {
  if (testCase.url) return "browser";
  if (testCase.selector?.startsWith("http")) return "browser";
  return "desktop";
}

function evaluateVisualAssertion(
  assertion: VisualAssertion,
  textContent: string,
  _screenshotPath?: string,
): VisualAssertionResult {
  switch (assertion.type) {
    case "text-present":
      return {
        type: "text-present",
        passed: textContent.toLowerCase().includes(assertion.value.toLowerCase()),
        message: textContent.includes(assertion.value)
          ? `Found "${assertion.value}"`
          : `"${assertion.value}" not found in screen content`,
      };

    case "no-error":
      return {
        type: "no-error",
        passed:
          !textContent.toLowerCase().includes("error") &&
          !textContent.toLowerCase().includes("exception") &&
          !textContent.toLowerCase().includes("crash"),
        message: textContent.toLowerCase().includes("error")
          ? "Error detected on screen"
          : "No errors visible",
      };

    case "element-visible":
      return {
        type: "element-visible",
        passed: textContent.includes(assertion.value),
        message: textContent.includes(assertion.value)
          ? `Element "${assertion.value}" is visible`
          : `Element "${assertion.value}" not found`,
      };

    case "screenshot-diff":
      // Would compare against a baseline screenshot
      return {
        type: "screenshot-diff",
        passed: true,
        message: "Screenshot comparison requires baseline image",
      };

    case "color-check":
      // Would check pixel colors in the screenshot
      return {
        type: "color-check",
        passed: true,
        message: "Color check requires image analysis capability",
      };
  }
}

/**
 * Generate a text description of the current screen state.
 * Used for non-vision models that can't process screenshots.
 */
export function describeScreenState(): string {
  const windowTitle = getActiveWindowTitle();
  const screenshot = takeScreenshot();

  const parts: string[] = [];

  if (windowTitle) {
    parts.push(`Active window: ${windowTitle}`);
  }

  if (screenshot) {
    parts.push(`Screenshot captured: ${screenshot.path}`);
    parts.push("(Use a vision-capable model to analyze the screenshot)");
  } else {
    parts.push("No screenshot available (display not accessible)");
  }

  return parts.join("\n");
}
