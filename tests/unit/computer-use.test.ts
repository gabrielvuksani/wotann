import { describe, it, expect } from "vitest";
import { ComputerUseAgent } from "../../src/computer-use/computer-agent.js";
import { PerceptionEngine, detectPlatform } from "../../src/computer-use/perception-engine.js";

describe("Computer Use (Phase 12)", () => {
  describe("ComputerUseAgent", () => {
    const agent = new ComputerUseAgent();

    describe("API route table (Layer 1)", () => {
      it("finds calendar route", () => {
        const route = agent.findAPIRoute("check my calendar");
        expect(route).not.toBeNull();
        expect(route!.handler).toBe("calendar.list");
      });

      it("finds email route", () => {
        const route = agent.findAPIRoute("check my email inbox");
        expect(route).not.toBeNull();
        expect(route!.handler).toBe("email.list");
      });

      it("finds git route", () => {
        const route = agent.findAPIRoute("git status");
        expect(route).not.toBeNull();
        expect(route!.handler).toBe("git.command");
      });

      it("finds media control route", () => {
        const route = agent.findAPIRoute("pause the music");
        expect(route).not.toBeNull();
        expect(route!.handler).toBe("media.control");
      });

      it("returns null for non-API tasks", () => {
        const route = agent.findAPIRoute("analyze this codebase architecture");
        expect(route).toBeNull();
      });
    });

    describe("guardrails", () => {
      it("blocks financial sites", () => {
        expect(agent.isBlockedDomain("https://www.paypal.com")).toBe(true);
        expect(agent.isBlockedDomain("https://bank.example.com")).toBe(true);
        expect(agent.isBlockedDomain("https://coinbase.com/trade")).toBe(true);
      });

      it("allows non-financial sites", () => {
        expect(agent.isBlockedDomain("https://github.com")).toBe(false);
        expect(agent.isBlockedDomain("https://docs.google.com")).toBe(false);
      });

      it("enforces rate limiting", () => {
        const freshAgent = new ComputerUseAgent({ guardrails: { maxActionsPerMinute: 3 } });

        expect(freshAgent.checkRateLimit().allowed).toBe(true);
        freshAgent.recordAction();
        freshAgent.recordAction();
        freshAgent.recordAction();
        expect(freshAgent.checkRateLimit().allowed).toBe(false);
      });
    });

    describe("text-mediated CU prompt", () => {
      it("generates structured prompt for text models", () => {
        const screenText = [
          'Active: Chrome (github.com)',
          '  [1] Button "Code" at (450,200)',
          '  [2] Tab "Issues" at (550,80)',
          '  [3] Input "Search" at (700,80) - FOCUSED',
        ].join("\n");

        const prompt = agent.generateTextMediatedPrompt("Find the search bar", screenText);

        expect(prompt).toContain("You control a computer");
        expect(prompt).toContain("click(N)");
        expect(prompt).toContain("type(");
        expect(prompt).toContain("JSON");
      });
    });

    describe("action parsing", () => {
      it("parses click action", () => {
        const action = agent.parseAction('{"type": "click", "elementIndex": 3}');
        expect(action).toEqual({ type: "click", elementIndex: 3 });
      });

      it("parses type action", () => {
        const action = agent.parseAction('{"type": "type", "text": "hello world"}');
        expect(action).toEqual({ type: "type", text: "hello world" });
      });

      it("parses key action", () => {
        const action = agent.parseAction('Let me press enter: {"type": "key", "combo": "enter"}');
        expect(action).toEqual({ type: "key", combo: "enter" });
      });

      it("returns null for invalid JSON", () => {
        expect(agent.parseAction("not json")).toBeNull();
      });
    });

    describe("sensitive data redaction", () => {
      it("redacts password fields", () => {
        const text = 'password: "mysecret123"';
        const redacted = agent.redactSensitive(text);
        expect(redacted).toContain("[REDACTED]");
        expect(redacted).not.toContain("mysecret123");
      });

      it("leaves normal text unchanged", () => {
        const text = 'Button "Submit" at (100,200)';
        expect(agent.redactSensitive(text)).toBe(text);
      });
    });
  });

  describe("PerceptionEngine", () => {
    it("converts perception to structured text", () => {
      const engine = new PerceptionEngine("darwin");
      const text = engine.toText({
        screenshot: null,
        a11yTree: null,
        elements: [
          { index: 1, type: "button", label: "Submit", x: 100, y: 200, width: 80, height: 30, focused: false, disabled: false },
          { index: 2, type: "input", label: "Name", x: 100, y: 150, width: 200, height: 30, focused: true, disabled: false, value: "John" },
        ],
        activeWindow: { name: "Chrome", app: "Chrome", pid: 1234, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        timestamp: Date.now(),
      });

      expect(text).toContain("Active: Chrome");
      expect(text).toContain('[1] button "Submit"');
      expect(text).toContain("FOCUSED");
      expect(text).toContain("[John]");
    });

    it("detects platform correctly", () => {
      const platform = detectPlatform();
      expect(["darwin", "linux", "win32", "unknown"]).toContain(platform);
    });
  });
});
