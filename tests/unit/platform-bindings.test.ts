import { describe, it, expect } from "vitest";
import {
  detectPlatform,
  detectAvailableTools,
  listDesktopActions,
  executeDesktopAction,
} from "../../src/computer-use/platform-bindings.js";

describe("Computer Use Platform Bindings", () => {
  it("detects platform as darwin or linux", () => {
    const p = detectPlatform();
    expect(["darwin", "linux", "win32", "unknown"]).toContain(p);
  });

  it("discovers available tools", () => {
    const tools = detectAvailableTools();
    expect(Array.isArray(tools)).toBe(true);
    // On macOS, osascript should always be available
    if (detectPlatform() === "darwin") {
      expect(tools).toContain("osascript");
    }
  });

  it("lists desktop actions", () => {
    const actions = listDesktopActions();
    expect(actions).toContain("open-url");
    expect(actions).toContain("screenshot");
    expect(actions).toContain("get-clipboard");
    expect(actions).toContain("set-clipboard");
    expect(actions).toContain("get-active-window");
  });

  it("executes get-active-window action", () => {
    const result = executeDesktopAction({
      action: "get-active-window",
      params: {},
    });
    expect(result).not.toBeNull();
    // May or may not succeed depending on environment
    expect(typeof result?.success).toBe("boolean");
  });

  it("returns null for unknown action", () => {
    const result = executeDesktopAction({
      action: "nonexistent-action",
      params: {},
    });
    expect(result).toBeNull();
  });

  it("get-clipboard returns a result", () => {
    const result = executeDesktopAction({ action: "get-clipboard", params: {} });
    expect(result).not.toBeNull();
    expect(typeof result?.success).toBe("boolean");
  });
});
