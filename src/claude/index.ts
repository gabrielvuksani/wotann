/**
 * Top-level barrel for the WOTANN ↔ Claude SDK bridge — V9 T3 Waves 1-5.
 *
 * Wave 1 (T3.2) lives at `src/mcp/servers/wotann-tools.ts` (predates this
 * directory). Waves 2-5 are organized here:
 *
 *   hooks/      — 6 lifecycle hook handlers + HTTP server + config builder
 *   agents/     — wotann-primary / council-member / arena-judge / exploit-lane
 *                 definitions for `claude --agents`
 *   channels/   — unified MCP channel plugin (iMessage/Slack/phone)
 *   hardening/  — cost telemetry, error classification, rollback flag
 *
 * The bridge composes these waves at session-spawn time:
 *   1. Start the HTTP hook server (Wave 2).
 *   2. Build agents config pointing at the hook server URL (Wave 3).
 *   3. Build the channel plugin descriptor (Wave 4) if channels are wired.
 *   4. Wrap the spawn loop in error classification + cost telemetry (Wave 5).
 */

export * from "./types.js";

export {
  createSessionStartHandler,
  createUserPromptSubmitHandler,
  createPreToolUseHandler,
  createPostToolUseHandler,
  createStopHandler,
  createPreCompactHandler,
  startHookServer,
  getHookRoutes,
  buildHookConfig,
  writeHookConfigFile,
} from "./hooks/index.js";
export type {
  HookServerOptions,
  HookServerHandle,
  HookConfigJson,
  HookEntry,
} from "./hooks/index.js";

export { buildAgentsConfig, writeAgentsConfigFile } from "./agents/index.js";
export type { AgentDefinition, AgentsConfig, AgentsConfigOptions } from "./agents/index.js";

export { runChannelPlugin, buildChannelPluginDescriptor } from "./channels/index.js";
export type {
  ChannelMessage,
  ChannelMessageDirection,
  ChannelSubscription,
  ChannelAdapter,
  WotannChannelDeps,
  ChannelPluginOptions,
  ChannelPluginDescriptor,
} from "./channels/index.js";

export {
  createCostLedger,
  getQuotaProbe,
  isQuotaThresholdCrossed,
  classify,
  renderUserHint,
  isRetriable,
  decideSubscriptionFlag,
  describeSubscriptionFlag,
} from "./hardening/index.js";
export type { CostLedger, RawProcessFailure, SubscriptionFlagDecision } from "./hardening/index.js";

// V9 T3.1 — composition root that runtime.ts calls to wire Waves 1-5
// (hooks/agents/channels/hardening) into a single launchable bridge.
export { startBridge } from "./bridge.js";
export type { BridgeOptions, BridgeHandle } from "./bridge.js";
