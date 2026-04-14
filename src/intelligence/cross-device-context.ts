/**
 * Cross-Device Context — unified phone location + desktop filesystem + clipboard.
 * Phone's context automatically available to the desktop agent and vice versa.
 */

// ── Types ────────────────────────────────────────────────

export interface DeviceContext {
  readonly deviceId: string;
  readonly deviceType: "desktop" | "phone" | "watch";
  readonly lastUpdated: number;
  readonly capabilities: readonly string[];
  readonly data: Readonly<Record<string, unknown>>;
}

export interface UnifiedContext {
  readonly desktop: DeviceContext | null;
  readonly phone: DeviceContext | null;
  readonly watch: DeviceContext | null;
  readonly mergedAt: number;
}

export interface ContextEvent {
  readonly source: "desktop" | "phone" | "watch";
  readonly type: "location" | "clipboard" | "file_change" | "activity" | "notification";
  readonly data: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

// ── Cross-Device Context Manager ─────────────────────────

export class CrossDeviceContextManager {
  private readonly contexts: Map<string, DeviceContext> = new Map();
  private readonly eventLog: ContextEvent[] = [];
  private readonly maxEvents = 100;

  /**
   * Update context from a device.
   */
  updateDeviceContext(deviceId: string, deviceType: DeviceContext["deviceType"], data: Record<string, unknown>): void {
    const existing = this.contexts.get(deviceId);
    this.contexts.set(deviceId, {
      deviceId,
      deviceType,
      lastUpdated: Date.now(),
      capabilities: existing?.capabilities ?? [],
      data: { ...(existing?.data ?? {}), ...data },
    });
  }

  /**
   * Register device capabilities.
   */
  registerCapabilities(deviceId: string, capabilities: readonly string[]): void {
    const existing = this.contexts.get(deviceId);
    if (existing) {
      this.contexts.set(deviceId, { ...existing, capabilities });
    }
  }

  /**
   * Record a context event (location change, clipboard copy, file save, etc).
   */
  recordEvent(event: ContextEvent): void {
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEvents) {
      this.eventLog.splice(0, this.eventLog.length - this.maxEvents);
    }
  }

  /**
   * Get the unified context across all devices.
   */
  getUnifiedContext(): UnifiedContext {
    let desktop: DeviceContext | null = null;
    let phone: DeviceContext | null = null;
    let watch: DeviceContext | null = null;

    for (const ctx of this.contexts.values()) {
      if (ctx.deviceType === "desktop") desktop = ctx;
      else if (ctx.deviceType === "phone") phone = ctx;
      else if (ctx.deviceType === "watch") watch = ctx;
    }

    return { desktop, phone, watch, mergedAt: Date.now() };
  }

  /**
   * Build a compact context summary for system prompt injection.
   * ~50-100 tokens describing what each device knows.
   */
  buildPromptContext(): string {
    const unified = this.getUnifiedContext();
    const parts: string[] = [];

    if (unified.phone) {
      const location = unified.phone.data["location"] as string | undefined;
      const clipboard = unified.phone.data["clipboard"] as string | undefined;
      const activity = unified.phone.data["activity"] as string | undefined;

      if (location) parts.push(`Phone location: ${location}`);
      if (clipboard) parts.push(`Phone clipboard: "${String(clipboard).slice(0, 50)}"`);
      if (activity) parts.push(`Phone activity: ${activity}`);
    }

    if (unified.desktop) {
      const workingDir = unified.desktop.data["workingDir"] as string | undefined;
      const gitBranch = unified.desktop.data["gitBranch"] as string | undefined;
      const recentFiles = unified.desktop.data["recentFiles"] as readonly string[] | undefined;

      if (workingDir) parts.push(`Desktop: ${workingDir}`);
      if (gitBranch) parts.push(`Branch: ${gitBranch}`);
      if (recentFiles && recentFiles.length > 0) parts.push(`Recent: ${recentFiles.slice(0, 3).join(", ")}`);
    }

    if (unified.watch) {
      parts.push("Watch: connected");
    }

    return parts.length > 0 ? parts.join(". ") : "";
  }

  /**
   * Get recent events for a specific device or type.
   */
  getRecentEvents(filter?: { source?: string; type?: string; limit?: number }): readonly ContextEvent[] {
    let events: ContextEvent[] = [...this.eventLog];
    if (filter?.source) events = events.filter((e) => e.source === filter.source);
    if (filter?.type) events = events.filter((e) => e.type === filter.type);
    return events.slice(-(filter?.limit ?? 10));
  }

  /**
   * Check if a specific device is connected (updated within last 5 minutes).
   */
  isDeviceConnected(deviceType: DeviceContext["deviceType"]): boolean {
    for (const ctx of this.contexts.values()) {
      if (ctx.deviceType === deviceType && Date.now() - ctx.lastUpdated < 5 * 60_000) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all device contexts.
   */
  reset(): void {
    this.contexts.clear();
    this.eventLog.length = 0;
  }
}
