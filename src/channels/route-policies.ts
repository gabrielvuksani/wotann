/**
 * Dispatch Route Policies — per-route configuration for the unified dispatch plane.
 *
 * Merges OpenClaw's channel concept with Claude Code's dispatch into one
 * unified system that works regardless of provider. Each route can have:
 * - Authentication requirements (pairing code, trusted sender list)
 * - Rate limits (per sender, per channel, global)
 * - Model preferences (cheap for triage, powerful for coding)
 * - Capability requirements (voice, browser, desktop for specific routes)
 * - Auto-escalation rules (escalate to human after N failures)
 * - Response formatting (markdown for chat, plain for SMS, rich for Slack)
 */

export type { ChannelType } from "./channel-types.js";
import type { ChannelType } from "./channel-types.js";

export type ResponseFormat = "markdown" | "plain" | "rich" | "html" | "json";

export type ModelTier = "fast" | "balanced" | "powerful" | "local";

export type EscalationAction = "retry" | "switch-model" | "switch-channel" | "human-escalate" | "snooze";

// ── Route Policy ────────────────────────────────────────

export interface RoutePolicy {
  readonly id: string;
  readonly name: string;
  readonly channel: ChannelType;
  readonly enabled: boolean;

  // Authentication
  readonly requiresPairing: boolean;
  readonly trustedSenders: readonly string[];
  readonly allowAnonymous: boolean;

  // Rate limiting
  readonly maxRequestsPerMinute: number;
  readonly maxRequestsPerHour: number;
  readonly maxConcurrentSessions: number;

  // Model selection
  readonly preferredModelTier: ModelTier;
  readonly preferredProvider?: string;
  readonly preferredModel?: string;
  readonly maxCostPerRequest: number;

  // Capabilities
  readonly requiredCapabilities: readonly DeviceCapability[];
  readonly optionalCapabilities: readonly DeviceCapability[];

  // Response
  readonly responseFormat: ResponseFormat;
  readonly maxResponseLength: number;
  readonly includeSourceLinks: boolean;
  readonly includeCodeBlocks: boolean;

  // Escalation
  readonly escalationRules: readonly EscalationRule[];

  // Routing
  readonly forwardTo?: string[]; // Channel IDs to also send to
  readonly priority: number; // Higher = processed first
  readonly tags: readonly string[];
}

export type DeviceCapability =
  | "text" | "voice" | "images" | "files" | "browser"
  | "desktop" | "notifications" | "camera" | "gps"
  | "screen-recording" | "clipboard";

export interface EscalationRule {
  readonly trigger: "failure-count" | "cost-exceeded" | "timeout" | "complexity" | "explicit-request";
  readonly threshold: number;
  readonly action: EscalationAction;
  readonly target?: string; // Channel ID or model name
}

// ── Device Node ─────────────────────────────────────────

export interface DeviceNode {
  readonly id: string;
  readonly name: string;
  readonly platform: "macos" | "linux" | "windows" | "ios" | "android" | "web";
  readonly capabilities: readonly DeviceCapability[];
  readonly channels: readonly ChannelType[];
  readonly lastSeen: number;
  readonly isOnline: boolean;
  readonly metadata: Record<string, string>;
}

// ── Route Policy Engine ─────────────────────────────────

export class RoutePolicyEngine {
  private readonly policies: Map<string, RoutePolicy> = new Map();
  private readonly devices: Map<string, DeviceNode> = new Map();
  private readonly requestCounts: Map<string, { minute: number[]; hour: number[] }> = new Map();

  /**
   * Register a route policy.
   */
  addPolicy(policy: RoutePolicy): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * Remove a route policy.
   */
  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  /**
   * Register a device node.
   */
  registerDevice(device: DeviceNode): void {
    this.devices.set(device.id, device);
  }

  /**
   * Update device last-seen timestamp.
   */
  heartbeat(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      this.devices.set(deviceId, { ...device, lastSeen: Date.now(), isOnline: true });
    }
  }

  /**
   * Find the best policy for an incoming message.
   */
  resolvePolicy(channel: ChannelType, senderId: string): RoutePolicy | null {
    const candidates = [...this.policies.values()]
      .filter((p) => p.enabled && p.channel === channel)
      .sort((a, b) => b.priority - a.priority);

    for (const policy of candidates) {
      // Check sender authorization
      if (policy.requiresPairing && !policy.trustedSenders.includes(senderId)) {
        continue;
      }
      if (!policy.allowAnonymous && !senderId) {
        continue;
      }

      // Check rate limits
      if (!this.checkRateLimit(policy.id, senderId)) {
        continue;
      }

      return policy;
    }

    return null;
  }

  /**
   * Check if a request is within rate limits.
   */
  checkRateLimit(policyId: string, senderId: string): boolean {
    const key = `${policyId}:${senderId}`;
    const now = Date.now();
    const counts = this.requestCounts.get(key) ?? { minute: [], hour: [] };

    // Clean old entries
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;
    const recentMinute = counts.minute.filter((t) => t > oneMinuteAgo);
    const recentHour = counts.hour.filter((t) => t > oneHourAgo);

    const policy = this.policies.get(policyId);
    if (!policy) return true;

    if (recentMinute.length >= policy.maxRequestsPerMinute) return false;
    if (recentHour.length >= policy.maxRequestsPerHour) return false;

    // Record this request
    recentMinute.push(now);
    recentHour.push(now);
    this.requestCounts.set(key, { minute: recentMinute, hour: recentHour });

    return true;
  }

  /**
   * Find the best device for a required capability.
   */
  findDeviceWithCapability(capability: DeviceCapability): DeviceNode | null {
    const onlineDevices = [...this.devices.values()]
      .filter((d) => d.isOnline && d.capabilities.includes(capability))
      .sort((a, b) => b.lastSeen - a.lastSeen);

    return onlineDevices[0] ?? null;
  }

  /**
   * Determine the model tier for a route.
   */
  getModelTierForRoute(policy: RoutePolicy, taskComplexity: number): ModelTier {
    // Complexity override: high complexity always uses powerful
    if (taskComplexity >= 7) return "powerful";

    // Low complexity can use fast even if policy says balanced
    if (taskComplexity <= 2 && policy.preferredModelTier !== "powerful") return "fast";

    return policy.preferredModelTier;
  }

  /**
   * Evaluate escalation rules for a failed request.
   */
  evaluateEscalation(
    policy: RoutePolicy,
    failureCount: number,
    totalCost: number,
    elapsedMs: number,
  ): EscalationAction | null {
    for (const rule of policy.escalationRules) {
      switch (rule.trigger) {
        case "failure-count":
          if (failureCount >= rule.threshold) return rule.action;
          break;
        case "cost-exceeded":
          if (totalCost >= rule.threshold) return rule.action;
          break;
        case "timeout":
          if (elapsedMs >= rule.threshold) return rule.action;
          break;
      }
    }
    return null;
  }

  /**
   * Format a response according to the route's response format.
   */
  formatResponse(content: string, format: ResponseFormat, maxLength: number): string {
    let formatted = content;

    switch (format) {
      case "plain":
        // Strip markdown formatting
        formatted = content
          .replace(/#{1,6}\s/g, "")
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/`([^`]+)`/g, "$1")
          .replace(/```[\s\S]*?```/g, "[code block]");
        break;

      case "rich":
        // Keep markdown as-is (Slack/Discord render it)
        break;

      case "html":
        // Basic markdown → HTML
        formatted = content
          .replace(/^### (.+)$/gm, "<h3>$1</h3>")
          .replace(/^## (.+)$/gm, "<h2>$1</h2>")
          .replace(/^# (.+)$/gm, "<h1>$1</h1>")
          .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\n/g, "<br>");
        break;

      case "json":
        formatted = JSON.stringify({ content, timestamp: Date.now() });
        break;

      case "markdown":
      default:
        break;
    }

    // Truncate if needed
    if (formatted.length > maxLength) {
      formatted = formatted.slice(0, maxLength - 20) + "\n\n[truncated]";
    }

    return formatted;
  }

  /**
   * Get all policies.
   */
  getPolicies(): readonly RoutePolicy[] {
    return [...this.policies.values()];
  }

  /**
   * Get all registered devices.
   */
  getDevices(): readonly DeviceNode[] {
    return [...this.devices.values()];
  }

  /**
   * Get online devices count.
   */
  getOnlineDeviceCount(): number {
    return [...this.devices.values()].filter((d) => d.isOnline).length;
  }
}

// ── Default Policies ────────────────────────────────────

export function createDefaultPolicy(channel: ChannelType): RoutePolicy {
  const defaults: Partial<Record<ChannelType, Partial<RoutePolicy>>> = {
    cli: {
      responseFormat: "markdown",
      maxResponseLength: 50_000,
      includeCodeBlocks: true,
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 500,
      maxCostPerRequest: 1.0,
      preferredModelTier: "powerful",
    },
    telegram: {
      responseFormat: "markdown",
      maxResponseLength: 4096,
      includeCodeBlocks: true,
      maxRequestsPerMinute: 10,
      maxRequestsPerHour: 100,
      maxCostPerRequest: 0.25,
      preferredModelTier: "balanced",
    },
    slack: {
      responseFormat: "rich",
      maxResponseLength: 40_000,
      includeCodeBlocks: true,
      maxRequestsPerMinute: 20,
      maxRequestsPerHour: 200,
      maxCostPerRequest: 0.50,
      preferredModelTier: "balanced",
    },
    discord: {
      responseFormat: "markdown",
      maxResponseLength: 2000,
      includeCodeBlocks: true,
      maxRequestsPerMinute: 15,
      maxRequestsPerHour: 150,
      maxCostPerRequest: 0.25,
      preferredModelTier: "fast",
    },
    email: {
      responseFormat: "html",
      maxResponseLength: 100_000,
      includeCodeBlocks: true,
      maxRequestsPerMinute: 5,
      maxRequestsPerHour: 50,
      maxCostPerRequest: 0.50,
      preferredModelTier: "powerful",
    },
    sms: {
      responseFormat: "plain",
      maxResponseLength: 1600,
      includeCodeBlocks: false,
      maxRequestsPerMinute: 5,
      maxRequestsPerHour: 30,
      maxCostPerRequest: 0.10,
      preferredModelTier: "fast",
    },
    voice: {
      responseFormat: "plain",
      maxResponseLength: 2000,
      includeCodeBlocks: false,
      maxRequestsPerMinute: 10,
      maxRequestsPerHour: 60,
      maxCostPerRequest: 0.30,
      preferredModelTier: "fast",
    },
    webhook: {
      responseFormat: "json",
      maxResponseLength: 100_000,
      includeCodeBlocks: true,
      maxRequestsPerMinute: 30,
      maxRequestsPerHour: 300,
      maxCostPerRequest: 0.50,
      preferredModelTier: "balanced",
    },
  };

  const overrides = defaults[channel] ?? {};

  return {
    id: `default-${channel}`,
    name: `Default ${channel} policy`,
    channel,
    enabled: true,
    requiresPairing: channel !== "cli" && channel !== "webhook",
    trustedSenders: [],
    allowAnonymous: channel === "webhook",
    maxRequestsPerMinute: 10,
    maxRequestsPerHour: 100,
    maxConcurrentSessions: 3,
    preferredModelTier: "balanced",
    maxCostPerRequest: 0.25,
    requiredCapabilities: ["text"],
    optionalCapabilities: [],
    responseFormat: "markdown",
    maxResponseLength: 10_000,
    includeSourceLinks: false,
    includeCodeBlocks: true,
    escalationRules: [
      { trigger: "failure-count", threshold: 3, action: "switch-model" },
      { trigger: "failure-count", threshold: 5, action: "human-escalate" },
      { trigger: "cost-exceeded", threshold: 5.0, action: "human-escalate" },
    ],
    priority: 0,
    tags: [],
    ...overrides,
  };
}
