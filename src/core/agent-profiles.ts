/**
 * Agent Profiles (C10) — Write / Ask / Minimal + Shift+Tab cycle.
 *
 * Zed + Air introduced named agent "profiles" — presets that rewire
 * the agent's capability surface in one step:
 *
 *   Write    — full write access, autonomous tool use, strict hooks
 *   Ask      — read-only: no Write/Edit/Bash tool calls; shallow memory
 *   Minimal  — chat-only, no tool use at all; the classic "just talk"
 *
 * This module owns the profile definitions + the cycle helper.
 * Runtime wiring consumes `applyProfile()` to mutate the allowed
 * tool list, hook profile, and token cap per turn.
 */

export type AgentProfileName = "write" | "ask" | "minimal";

export interface AgentProfile {
  readonly name: AgentProfileName;
  readonly label: string;
  readonly description: string;
  readonly allowedTools: readonly string[] | "all";
  readonly hookProfile: "minimal" | "standard" | "strict";
  readonly memoryDepth: "full" | "shallow" | "none";
  readonly autoAcceptWriteTools: boolean;
  readonly maxTurnTokens?: number;
}

export const AGENT_PROFILES: Record<AgentProfileName, AgentProfile> = {
  write: {
    name: "write",
    label: "Write",
    description: "Full write access — autonomous tool use with strict guards",
    allowedTools: "all",
    hookProfile: "strict",
    memoryDepth: "full",
    autoAcceptWriteTools: false, // still gated by permission mode
    maxTurnTokens: undefined,
  },
  ask: {
    name: "ask",
    label: "Ask",
    description: "Read-only — no Write/Edit/Bash; shallow memory retrieval",
    allowedTools: [
      "Read",
      "Grep",
      "Glob",
      "WebFetch",
      "WebSearch",
      "ListMcpResourcesTool",
      "ReadMcpResourceTool",
    ],
    hookProfile: "standard",
    memoryDepth: "shallow",
    autoAcceptWriteTools: false,
    maxTurnTokens: 16_000,
  },
  minimal: {
    name: "minimal",
    label: "Minimal",
    description: "Chat only — no tool use, no memory injection",
    allowedTools: [],
    hookProfile: "minimal",
    memoryDepth: "none",
    autoAcceptWriteTools: false,
    maxTurnTokens: 8_000,
  },
};

// ── Profile dispatch ─────────────────────────────────────────

const CYCLE_ORDER: readonly AgentProfileName[] = ["write", "ask", "minimal"];

/** Return the next profile in cycle order. Shift+Tab UI handler. */
export function cycleProfile(current: AgentProfileName): AgentProfileName {
  const idx = CYCLE_ORDER.indexOf(current);
  const next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
  return next ?? "write";
}

export function getProfile(name: AgentProfileName): AgentProfile {
  return AGENT_PROFILES[name];
}

export function allProfiles(): readonly AgentProfile[] {
  return CYCLE_ORDER.map((n) => AGENT_PROFILES[n]);
}

/**
 * Set the active profile by name. Returns the profile itself (for
 * symmetry with `cycleProfile` so callers can chain). Type-safe
 * rejection of unknown names is enforced at compile time by
 * `AgentProfileName`; at runtime we still guard against bad strings
 * from deserialised config.
 */
export function setProfile(name: string): AgentProfile {
  if (name !== "write" && name !== "ask" && name !== "minimal") {
    throw new Error(`Unknown agent profile: "${name}". Valid options: write, ask, minimal.`);
  }
  return AGENT_PROFILES[name];
}

/**
 * Parse an untrusted profile name (from deserialised config or a user
 * command) and return the profile, or null if the input is unknown.
 * Safer than `setProfile` when the caller wants a best-effort merge.
 */
export function parseProfileName(raw: unknown): AgentProfileName | null {
  if (raw !== "write" && raw !== "ask" && raw !== "minimal") return null;
  return raw;
}

/**
 * Check whether a profile permits a specific tool. Returns true when
 * allowedTools is "all" OR the tool is in the explicit allow list.
 */
export function profilePermitsTool(profile: AgentProfile, toolName: string): boolean {
  if (profile.allowedTools === "all") return true;
  return profile.allowedTools.includes(toolName);
}

// ── Runtime application ──────────────────────────────────────

export interface ProfileRuntimeOverlay {
  readonly hookProfile: "minimal" | "standard" | "strict";
  readonly maxTurnTokens: number | undefined;
  readonly memoryDepth: "full" | "shallow" | "none";
  readonly toolFilter: (toolName: string) => boolean;
}

/**
 * Produce the runtime overlay for a given profile. The runtime
 * applies the overlay before each turn: hook profile switched,
 * token cap applied, memory depth selected, tool dispatch filtered.
 * Pure projection — no side effects in this module.
 */
export function applyProfile(profile: AgentProfile): ProfileRuntimeOverlay {
  return {
    hookProfile: profile.hookProfile,
    maxTurnTokens: profile.maxTurnTokens,
    memoryDepth: profile.memoryDepth,
    toolFilter: (toolName: string) => profilePermitsTool(profile, toolName),
  };
}

// ── Rendering ────────────────────────────────────────────────

export function renderProfileSwitch(to: AgentProfile): string {
  const toolInfo =
    to.allowedTools === "all"
      ? "all tools"
      : to.allowedTools.length === 0
        ? "no tools"
        : `${to.allowedTools.length} tools`;
  return `Switched to ${to.label} · ${toolInfo} · memory:${to.memoryDepth} · hooks:${to.hookProfile}`;
}

export function renderProfileList(): string {
  const lines: string[] = ["Available profiles (Shift+Tab to cycle):", ""];
  for (const p of allProfiles()) {
    const toolInfo =
      p.allowedTools === "all"
        ? "all"
        : p.allowedTools.length === 0
          ? "none"
          : `${p.allowedTools.length} allow-listed`;
    lines.push(`  ${p.label.padEnd(9)} ${p.description}`);
    lines.push(`            tools=${toolInfo} hooks=${p.hookProfile} memory=${p.memoryDepth}`);
  }
  return lines.join("\n");
}
