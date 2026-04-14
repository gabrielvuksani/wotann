import { describe, it, expect, beforeEach } from "vitest";
import {
  RoutePolicyEngine,
  createDefaultPolicy,
  type RoutePolicy,
  type DeviceNode,
} from "../../src/channels/route-policies.js";

describe("Route Policies", () => {
  let engine: RoutePolicyEngine;

  beforeEach(() => {
    engine = new RoutePolicyEngine();
  });

  describe("policy management", () => {
    it("adds and retrieves policies", () => {
      engine.addPolicy(createDefaultPolicy("cli"));
      expect(engine.getPolicies()).toHaveLength(1);
    });

    it("removes policies", () => {
      engine.addPolicy(createDefaultPolicy("cli"));
      engine.removePolicy("default-cli");
      expect(engine.getPolicies()).toHaveLength(0);
    });
  });

  describe("policy resolution", () => {
    it("resolves a policy for a matching channel", () => {
      engine.addPolicy(createDefaultPolicy("cli"));
      const policy = engine.resolvePolicy("cli", "local-user");
      expect(policy).not.toBeNull();
      expect(policy?.channel).toBe("cli");
    });

    it("returns null when no policy matches", () => {
      engine.addPolicy(createDefaultPolicy("cli"));
      const policy = engine.resolvePolicy("telegram", "user1");
      expect(policy).toBeNull();
    });

    it("respects priority ordering", () => {
      const lowPriority = { ...createDefaultPolicy("cli"), id: "low", priority: 1 };
      const highPriority = { ...createDefaultPolicy("cli"), id: "high", priority: 10, name: "High priority" };

      engine.addPolicy(lowPriority);
      engine.addPolicy(highPriority);

      const resolved = engine.resolvePolicy("cli", "local-user");
      expect(resolved?.id).toBe("high");
    });

    it("checks trusted senders for pairing-required channels", () => {
      const policy = {
        ...createDefaultPolicy("telegram"),
        trustedSenders: ["trusted-user-123"],
      };
      engine.addPolicy(policy);

      // Untrusted sender blocked
      const untrusted = engine.resolvePolicy("telegram", "random-user");
      expect(untrusted).toBeNull();

      // Trusted sender allowed
      const trusted = engine.resolvePolicy("telegram", "trusted-user-123");
      expect(trusted).not.toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("allows requests within rate limits", () => {
      const policy = { ...createDefaultPolicy("cli"), maxRequestsPerMinute: 5 };
      engine.addPolicy(policy);

      for (let i = 0; i < 5; i++) {
        expect(engine.checkRateLimit(policy.id, "user1")).toBe(true);
      }
    });

    it("blocks requests exceeding rate limits", () => {
      const policy = { ...createDefaultPolicy("cli"), maxRequestsPerMinute: 2 };
      engine.addPolicy(policy);

      engine.checkRateLimit(policy.id, "user1");
      engine.checkRateLimit(policy.id, "user1");
      expect(engine.checkRateLimit(policy.id, "user1")).toBe(false);
    });
  });

  describe("device management", () => {
    it("registers and queries devices", () => {
      const device: DeviceNode = {
        id: "dev1",
        name: "MacBook",
        platform: "macos",
        capabilities: ["text", "browser", "desktop"],
        channels: ["cli"],
        lastSeen: Date.now(),
        isOnline: true,
        metadata: {},
      };

      engine.registerDevice(device);
      expect(engine.getDevices()).toHaveLength(1);
      expect(engine.getOnlineDeviceCount()).toBe(1);
    });

    it("finds devices by capability", () => {
      engine.registerDevice({
        id: "dev1",
        name: "MacBook",
        platform: "macos",
        capabilities: ["text", "browser", "desktop"],
        channels: ["cli"],
        lastSeen: Date.now(),
        isOnline: true,
        metadata: {},
      });

      const found = engine.findDeviceWithCapability("browser");
      expect(found?.id).toBe("dev1");

      const notFound = engine.findDeviceWithCapability("voice");
      expect(notFound).toBeNull();
    });
  });

  describe("model tier selection", () => {
    it("upgrades to powerful for high complexity tasks", () => {
      const policy = createDefaultPolicy("telegram"); // balanced by default
      const tier = engine.getModelTierForRoute(policy, 8);
      expect(tier).toBe("powerful");
    });

    it("downgrades to fast for trivial tasks on non-powerful channels", () => {
      const policy = createDefaultPolicy("telegram"); // telegram defaults to "balanced"
      const tier = engine.getModelTierForRoute(policy, 1);
      expect(tier).toBe("fast");
    });

    it("keeps powerful tier for CLI even on trivial tasks", () => {
      const policy = createDefaultPolicy("cli"); // CLI defaults to "powerful"
      const tier = engine.getModelTierForRoute(policy, 1);
      expect(tier).toBe("powerful"); // powerful tier is never downgraded
    });

    it("uses policy default for medium complexity", () => {
      const policy = createDefaultPolicy("telegram"); // balanced
      const tier = engine.getModelTierForRoute(policy, 5);
      expect(tier).toBe("balanced");
    });
  });

  describe("escalation rules", () => {
    it("escalates on failure count threshold", () => {
      const policy = createDefaultPolicy("cli");
      const action = engine.evaluateEscalation(policy, 3, 0, 0);
      expect(action).toBe("switch-model");
    });

    it("first matching rule wins in escalation order", () => {
      const policy = createDefaultPolicy("cli");
      // 5 failures >= 3 threshold → switch-model is first rule that matches
      const action = engine.evaluateEscalation(policy, 5, 0, 0);
      expect(action).toBe("switch-model");
    });

    it("escalates to human on cost exceeded", () => {
      const policy = createDefaultPolicy("cli");
      const action = engine.evaluateEscalation(policy, 0, 6.0, 0);
      expect(action).toBe("human-escalate");
    });

    it("returns null when no thresholds are met", () => {
      const policy = createDefaultPolicy("cli");
      const action = engine.evaluateEscalation(policy, 1, 0, 0);
      expect(action).toBeNull();
    });
  });

  describe("response formatting", () => {
    it("strips markdown for plain format", () => {
      const formatted = engine.formatResponse("**bold** `code`", "plain", 10_000);
      expect(formatted).not.toContain("**");
      expect(formatted).not.toContain("`");
    });

    it("converts to HTML", () => {
      const formatted = engine.formatResponse("# Header\n**bold**", "html", 10_000);
      expect(formatted).toContain("<h1>");
      expect(formatted).toContain("<b>");
    });

    it("wraps in JSON", () => {
      const formatted = engine.formatResponse("Hello", "json", 10_000);
      const parsed = JSON.parse(formatted);
      expect(parsed.content).toBe("Hello");
      expect(parsed.timestamp).toBeTruthy();
    });

    it("truncates long responses", () => {
      const longContent = "x".repeat(5000);
      const formatted = engine.formatResponse(longContent, "markdown", 1000);
      expect(formatted.length).toBeLessThanOrEqual(1000);
      expect(formatted).toContain("[truncated]");
    });
  });

  describe("default policies", () => {
    it("creates appropriate defaults for different channels", () => {
      const cli = createDefaultPolicy("cli");
      expect(cli.responseFormat).toBe("markdown");
      expect(cli.maxResponseLength).toBe(50_000);
      expect(cli.preferredModelTier).toBe("powerful");

      const telegram = createDefaultPolicy("telegram");
      expect(telegram.maxResponseLength).toBe(4096);
      expect(telegram.requiresPairing).toBe(true);

      const sms = createDefaultPolicy("sms");
      expect(sms.responseFormat).toBe("plain");
      expect(sms.maxResponseLength).toBe(1600);
      expect(sms.includeCodeBlocks).toBe(false);

      const webhook = createDefaultPolicy("webhook");
      expect(webhook.responseFormat).toBe("json");
      expect(webhook.allowAnonymous).toBe(true);
    });
  });
});
