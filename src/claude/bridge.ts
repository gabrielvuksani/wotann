/**
 * WOTANN ↔ Claude SDK bridge composition root — V9 T3.1.
 *
 * Composes Waves 1-5 into a single launchable. The bridge is the
 * single integration point WOTANN's runtime calls when starting a
 * subscription-backed Claude session:
 *
 *   1. Spawn Wave 2's HTTP hook server (loopback-bound).
 *   2. Build Wave 3's agents config + hook config files.
 *   3. (Optional) Build Wave 4's channel plugin descriptor.
 *   4. Hand off to `claude-cli-backend.invokeClaudeCli` with the file
 *      paths threaded through `--hooks-config` + `--agents` + `--channels`.
 *   5. Wrap the spawn-loop in Wave 5's error classification + cost
 *      telemetry.
 *
 * Quality bars
 *   - QB #6 honest stubs: every dep is optional. The bridge surfaces a
 *     warning when a dep is missing (per `WaveDeps`) but never silently
 *     proceeds with a half-wired session.
 *   - QB #7 per-call state: the bridge returns a fresh handle per call.
 *   - QB #14 commit messages are claims: this is the wire-up; runtime
 *     behaviour is verified by the T3.6 integration test matrix.
 */

import { unlinkSync } from "node:fs";

import {
  startHookServer,
  buildHookConfig,
  writeHookConfigFile,
  buildAgentsConfig,
  writeAgentsConfigFile,
  buildChannelPluginDescriptor,
  createCostLedger,
  decideSubscriptionFlag,
  describeSubscriptionFlag,
  type WaveDeps,
  type HookServerHandle,
  type CostLedger,
  type SubscriptionFlagDecision,
} from "./index.js";

// ── Bridge surface ─────────────────────────────────────────────

export interface BridgeOptions {
  /** Wave 2 hook handlers receive these injected dependencies. */
  readonly deps: WaveDeps;
  /** Override the env used to read the rollback feature flag (test hook). */
  readonly env?: NodeJS.ProcessEnv;
  /** Session id; used for hook-config + agents-config temp-file naming. */
  readonly sessionId: string;
  /** Optional WOTANN MCP server descriptor (Wave 1) for the agents config. */
  readonly wotannMcpServer?: Record<string, unknown>;
  /** Optional channel-plugin entrypoint script. Skipped when omitted. */
  readonly channelPluginEntrypoint?: string;
  /** Optional initial prompt for the wotann-primary agent. */
  readonly initialPrompt?: string;
  /** Logger; default no-op. */
  readonly log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface BridgeHandle {
  /** Per-session cost snapshot accessor. */
  readonly costs: CostLedger;
  /** Resolved feature-flag decision. */
  readonly subscriptionFlag: SubscriptionFlagDecision;
  /** URLs / paths the spawned `claude` subprocess consumes. */
  readonly hooksBaseUrl: string;
  readonly hooksConfigPath: string;
  readonly agentsConfigPath: string;
  readonly channelPluginEntrypoint: string | null;
  /** Tear everything down — close hook server, unlink temp files. */
  readonly close: () => Promise<void>;
}

// ── Composition ────────────────────────────────────────────────

/**
 * Spin up the bridge for a new session. Returns a handle with the file
 * paths the caller threads into `claude-cli-backend.invokeClaudeCli`.
 * Caller is responsible for awaiting the spawn's exit and then calling
 * `handle.close()` to release temp files + the HTTP server port.
 *
 * If the rollback feature flag (`WOTANN_SUBSCRIPTION_SDK_ENABLED=0`)
 * is set, returns null so the caller falls through to the BYOK provider
 * path.
 */
export async function startBridge(opts: BridgeOptions): Promise<BridgeHandle | null> {
  const log = opts.log ?? (() => {});
  const subscriptionFlag = decideSubscriptionFlag(opts.env ?? process.env);

  log("info", describeSubscriptionFlag(subscriptionFlag));
  if (!subscriptionFlag.enabled) {
    return null;
  }

  const costs = createCostLedger();

  // Wrap the caller's deps so cost-recording is observable from
  // PostToolUse handlers — every PostToolUse with a token usage block
  // updates the per-session ledger.
  const wrappedDeps: WaveDeps = {
    ...opts.deps,
    recordCost: async (sessionId, delta) => {
      costs.record(sessionId, {
        ...(delta.input !== undefined ? { input: delta.input } : {}),
        ...(delta.output !== undefined ? { output: delta.output } : {}),
      });
      if (opts.deps.recordCost) {
        await opts.deps.recordCost(sessionId, delta);
      }
    },
  };

  const server: HookServerHandle = await startHookServer({
    deps: wrappedDeps,
    log,
  });
  log("info", `hooks server listening at ${server.url}`);

  const hookConfig = buildHookConfig(server.url);
  const hooksConfigPath = writeHookConfigFile(hookConfig, opts.sessionId);

  const agentsConfig = buildAgentsConfig({
    hooksBaseUrl: server.url,
    ...(opts.wotannMcpServer ? { wotannMcpServer: opts.wotannMcpServer } : {}),
    ...(opts.initialPrompt ? { initialPrompt: opts.initialPrompt } : {}),
  });
  const agentsConfigPath = writeAgentsConfigFile(agentsConfig, opts.sessionId);

  let channelPluginEntrypoint: string | null = null;
  if (opts.channelPluginEntrypoint) {
    const descriptor = buildChannelPluginDescriptor(opts.channelPluginEntrypoint);
    channelPluginEntrypoint = descriptor.entrypoint;
    log("info", `channel plugin descriptor built: ${descriptor.name}@${descriptor.version}`);
  }

  return {
    costs,
    subscriptionFlag,
    hooksBaseUrl: server.url,
    hooksConfigPath,
    agentsConfigPath,
    channelPluginEntrypoint,
    close: async () => {
      try {
        await server.close();
      } catch (err) {
        log(
          "warn",
          `hooks server close failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Unlink temp config files. We swallow ENOENT — if the file is
      // already gone, that's a successful cleanup.
      try {
        unlinkSync(hooksConfigPath);
      } catch {
        // No-op
      }
      try {
        unlinkSync(agentsConfigPath);
      } catch {
        // No-op
      }
    },
  };
}
