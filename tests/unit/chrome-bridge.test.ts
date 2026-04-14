import { describe, it, expect } from "vitest";
import { ChromeBridge } from "../../src/browser/chrome-bridge.js";

describe("Chrome Bridge", () => {
  it("initializes with disconnected status", () => {
    const bridge = new ChromeBridge();
    expect(bridge.getStatus()).toBe("disconnected");
  });

  it("reports unavailable when Chrome is not running with debugging", async () => {
    // Use a port that's definitely not Chrome DevTools
    const bridge = new ChromeBridge("ws://localhost:19999");
    const available = await bridge.isAvailable();
    expect(available).toBe(false);
  });

  it("returns error for actions when not connected", async () => {
    const bridge = new ChromeBridge("ws://localhost:19999");
    const result = await bridge.execute({ type: "click", selector: "#button" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Browser bridge not connected");
  });

  it("converts DOM tree to text description", () => {
    const bridge = new ChromeBridge();
    const text = bridge.domToText({
      tag: "div",
      id: "app",
      className: "container",
      text: "",
      attributes: {},
      interactable: false,
      children: [
        {
          tag: "button",
          text: "Submit",
          attributes: {},
          interactable: true,
          children: [],
        },
      ],
    });

    expect(text).toContain("div#app.container");
    expect(text).toContain('button "Submit" [interactive]');
  });

  it("returns empty tab list when Chrome is not running", async () => {
    const bridge = new ChromeBridge("ws://localhost:19999");
    const tabs = await bridge.getTabs();
    expect(tabs).toEqual([]);
  });
});
