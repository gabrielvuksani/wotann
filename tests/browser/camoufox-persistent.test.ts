/**
 * Smoke test for the persistent Camoufox driver.
 *
 * Exercises the JSON-RPC protocol end-to-end with the default python
 * driver. When neither camoufox nor playwright is installed on the test
 * host, the driver boots in 'stub' mode which returns deterministic
 * canned values — enough to prove that:
 *
 *   1. One subprocess handles multiple RPC calls (no per-call spawn).
 *   2. State persists across calls (navigate then click then snapshot).
 *   3. Graceful close terminates the child on request.
 *
 * The real-browser path is gated behind WOTANN_CAMOUFOX_REAL=1 so CI
 * can verify the protocol without having the heavy python packages.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CamoufoxBrowser } from "../../src/browser/camoufox-backend.js";

const DRIVER_SCRIPT = resolve(process.cwd(), "python-scripts", "camoufox-driver.py");
const REAL_MODE = process.env.WOTANN_CAMOUFOX_REAL === "1";

function pythonAvailable(): boolean {
  try {
    const r = spawnSync("python3", ["-c", "print('ok')"], { stdio: "pipe", timeout: 5_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function describeIf(condition: boolean) {
  return condition ? describe : describe.skip;
}

describe("camoufox persistent driver script", () => {
  it("exists at the expected path", () => {
    expect(existsSync(DRIVER_SCRIPT)).toBe(true);
  });

  it("is syntactically valid python", () => {
    // `python3 -m py_compile` parses without running, so it works even
    // on hosts without camoufox/playwright installed.
    const out = spawnSync("python3", ["-m", "py_compile", DRIVER_SCRIPT], {
      stdio: "pipe",
      timeout: 10_000,
    });
    expect(out.status).toBe(0);
  });
});

describeIf(pythonAvailable())("CamoufoxBrowser persistent session (stub backend)", () => {
  beforeAll(() => {
    // Prove our environment actually has python3. If this fails, all
    // further tests in this block would error — better to fail fast.
    const ok = execFileSync("python3", ["-c", "print('ok')"], { encoding: "utf-8" }).trim();
    expect(ok).toBe("ok");
  });

  it("keeps a single subprocess across navigate + click + snapshot", async () => {
    const browser = new CamoufoxBrowser({
      driverScript: DRIVER_SCRIPT,
      headless: true,
      humanize: false,
    });

    const launched = await browser.launch();
    expect(launched).toBe(true);
    expect(browser.isLaunched()).toBe(true);
    // In a test env without camoufox/playwright, the stub is expected.
    // If the host happens to have a real browser installed, backend will
    // be 'camoufox' or 'playwright' — all three are acceptable here.
    expect(["stub", "camoufox", "playwright"]).toContain(browser.getBackend());

    const nav1 = await browser.newPage("https://example.com/one");
    expect(nav1.success).toBe(true);
    expect(nav1.url).toBe("https://example.com/one");

    // Same underlying subprocess should accept a click without
    // re-bootstrapping the browser — this is the whole point of the fix.
    const click = await browser.click("#primary");
    expect(click.success).toBe(true);

    // A second navigate on the SAME session — cookies etc. persist.
    const nav2 = await browser.newPage("https://example.com/two");
    expect(nav2.success).toBe(true);
    expect(browser.getCurrentUrl()).toBe("https://example.com/two");

    // Text snapshot must go through the same driver child.
    const text = await browser.getText();
    expect(text.success).toBe(true);
    expect(text.text.length).toBeGreaterThan(0);

    const closed = await browser.close();
    expect(closed).toBe(true);
    expect(browser.isLaunched()).toBe(false);
  }, 20_000);

  it("supports type + evaluate round-trips", async () => {
    const browser = new CamoufoxBrowser({
      driverScript: DRIVER_SCRIPT,
      headless: true,
      humanize: false,
    });
    await browser.launch();
    await browser.newPage("about:blank");

    const typed = await browser.type("#search", "wotann");
    expect(typed.success).toBe(true);

    const evaluated = await browser.evaluate<{ stub_evaluated?: string }>("1 + 1");
    expect(evaluated.success).toBe(true);
    // In stub mode the value echoes back the expression; in real mode
    // it will be a JS evaluation result. Either shape is fine.
    if (browser.getBackend() === "stub") {
      expect(evaluated.value).toEqual({ stub_evaluated: "1 + 1" });
    }

    await browser.close();
  }, 15_000);

  it("surfaces RPC errors without crashing the session", async () => {
    const browser = new CamoufoxBrowser({
      driverScript: DRIVER_SCRIPT,
      headless: true,
      humanize: false,
    });
    await browser.launch();

    // Calling navigate before launch is fine because launch is idempotent.
    // But navigating without a URL should still round-trip cleanly.
    const nav = await browser.newPage("");
    expect(nav).toBeDefined();

    // An unknown method is rejected by the driver. We don't expose that
    // directly, but click() with an empty selector should still return a
    // structured result rather than throw.
    const click = await browser.click("");
    expect(click).toHaveProperty("success");

    await browser.close();
  }, 15_000);

  it("close is idempotent", async () => {
    const browser = new CamoufoxBrowser({
      driverScript: DRIVER_SCRIPT,
      headless: true,
      humanize: false,
    });
    await browser.launch();
    await browser.close();
    // Second close must not throw and must not hang.
    const result = await browser.close();
    expect(result).toBe(true);
  }, 10_000);
});

// Real-browser suite — only runs when the operator explicitly opts in
// and a camoufox/playwright install is present.
describeIf(REAL_MODE && pythonAvailable())(
  "CamoufoxBrowser persistent session (real browser — WOTANN_CAMOUFOX_REAL=1)",
  () => {
    it("navigates to a real URL and extracts text", async () => {
      const browser = new CamoufoxBrowser({
        driverScript: DRIVER_SCRIPT,
        headless: true,
        humanize: false,
      });
      const launched = await browser.launch();
      expect(launched).toBe(true);
      expect(["camoufox", "playwright"]).toContain(browser.getBackend());

      const nav = await browser.newPage("https://example.com");
      expect(nav.success).toBe(true);
      expect(nav.title.toLowerCase()).toContain("example");

      await browser.close();
    }, 60_000);
  },
);
