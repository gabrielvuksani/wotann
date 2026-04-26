/**
 * WOTANN Channel MCP plugin — V9 T3.5 Wave 4.
 *
 * The Claude binary's `--channels` flag accepts plugin descriptors that
 * implement the `claude/channel` MCP capability. Channel plugins push
 * unsolicited messages INTO a live Claude session — phone notifications,
 * iMessage replies, Slack DMs, IDE-driven nudges. The session treats them
 * as user-message-equivalents so the model sees them mid-turn.
 *
 * This plugin is the bridge from WOTANN's existing channel adapters
 * (`src/channels/*`) into the Claude session. WOTANN already runs an
 * iMessage gateway, Slack adapter, push-inversion server, etc. — Wave 4
 * puts a unified MCP face on top so the spawned `claude` subprocess can
 * subscribe to a channel, post outbound replies, and receive inbound
 * events as live injections.
 *
 * Quality bars
 *   - QB #6 honest stubs: every entry-point requires a wired adapter.
 *     Missing adapters surface as "channel_unavailable" errors.
 *   - QB #13 env guard: deps injected via `WotannChannelDeps`.
 *   - QB #15 verify before claim: the wire-shape is exercised by the
 *     T3.5 integration test matrix in MASTER_PLAN_V9.md.
 */

import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

// ── Types ──────────────────────────────────────────────────────

export type ChannelMessageDirection = "inbound" | "outbound";

export interface ChannelMessage {
  readonly id: string;
  readonly channelId: string;
  readonly senderHandle: string;
  readonly text: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image" | "file";
    readonly url: string;
  }>;
  readonly receivedAt: number;
  readonly threadId?: string;
}

export interface ChannelSubscription {
  readonly channelId: string;
  readonly direction: ChannelMessageDirection | "both";
}

/**
 * Adapter surface — WOTANN's existing channel layer implements one of these
 * per platform (iMessage, Slack, etc.). The plugin multiplexes across them.
 */
export interface ChannelAdapter {
  readonly platform: string;
  /** List active channels the adapter can route to. */
  readonly listChannels: () => Promise<readonly { id: string; name: string }[]>;
  /** Subscribe to a channel and yield inbound messages until cancelled. */
  readonly subscribe: (channelId: string, signal: AbortSignal) => AsyncIterable<ChannelMessage>;
  /** Send an outbound message; returns the platform's message id. */
  readonly send: (
    channelId: string,
    text: string,
    threadId?: string,
  ) => Promise<{ messageId: string }>;
}

export interface WotannChannelDeps {
  readonly adapters: readonly ChannelAdapter[];
  /** Hook invoked when the plugin emits an inbound message to Claude. */
  readonly onInbound?: (msg: ChannelMessage) => void;
  /** Hook invoked when Claude emits an outbound message via the plugin. */
  readonly onOutbound?: (msg: ChannelMessage) => void;
  /** Optional logger; default no-op. */
  readonly log?: (level: "info" | "warn" | "error", msg: string) => void;
}

// ── JSON-RPC envelope (MCP / claude/channel capability) ────────

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

// ── Plugin server ──────────────────────────────────────────────

export interface ChannelPluginOptions {
  readonly deps: WotannChannelDeps;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
}

/**
 * Run the channel plugin server over stdio. Loops until stdin closes.
 *
 * Implements the `claude/channel` capability:
 *   - channels/list                    — list available channels
 *   - channels/subscribe               — subscribe to inbound messages
 *   - channels/unsubscribe             — cancel a subscription
 *   - channels/send                    — emit an outbound message
 *   - channel.event (notification)     — server pushes inbound messages
 */
export async function runChannelPlugin(opts: ChannelPluginOptions): Promise<void> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const log = opts.deps.log ?? (() => {});

  const reader: Interface = createInterface({ input: stdin });
  const subs = new Map<string, AbortController>();

  const reply = (resp: JsonRpcResponse): void => {
    stdout.write(`${JSON.stringify(resp)}\n`);
  };
  const notify = (notif: JsonRpcNotification): void => {
    stdout.write(`${JSON.stringify(notif)}\n`);
  };

  for await (const line of reader) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch (err) {
      log("warn", `bad json: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    try {
      switch (req.method) {
        case "initialize": {
          // V9 Wave 5-DD (H-39a) — protocol version negotiation.
          // Channel plugin speaks the same MCP wire protocol as the
          // main MCP server. Echo the client's requested version when
          // we support it; otherwise fall back to the current spec
          // version + log a warn so operators see the downgrade.
          const channelSupported = ["2024-11-05", "2025-06-18", "2025-11-25"] as const;
          const requestedVersion = req.params?.["protocolVersion"];
          const requested = typeof requestedVersion === "string" ? requestedVersion : null;
          const negotiated =
            requested !== null && (channelSupported as readonly string[]).includes(requested)
              ? requested
              : "2025-11-25";
          if (requested !== null && negotiated !== requested) {
            log(
              "warn",
              `channel-plugin: client requested unsupported protocolVersion="${requested}", falling back to "${negotiated}"`,
            );
          }
          reply({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              protocolVersion: negotiated,
              capabilities: { channel: { subscriptions: true, outbound: true } },
              serverInfo: { name: "wotann-channel", version: "0.1.0" },
            },
          });
          break;
        }

        case "channels/list": {
          const channels = await listAcrossAdapters(opts.deps.adapters);
          reply({ jsonrpc: "2.0", id: req.id, result: { channels } });
          break;
        }

        case "channels/subscribe": {
          const params = req.params ?? {};
          const channelId = String(params.channelId ?? "");
          if (!channelId) {
            reply(error(req.id, -32602, "channelId required"));
            break;
          }
          const adapter = pickAdapterFor(channelId, opts.deps.adapters);
          if (!adapter) {
            reply(error(req.id, -32601, "channel_unavailable"));
            break;
          }
          const ac = new AbortController();
          subs.set(channelId, ac);
          reply({ jsonrpc: "2.0", id: req.id, result: { subscribed: true } });
          // Fire-and-forget consumer: every inbound message becomes a
          // `channel.event` notification.
          void (async () => {
            try {
              for await (const msg of adapter.subscribe(channelId, ac.signal)) {
                opts.deps.onInbound?.(msg);
                notify({
                  jsonrpc: "2.0",
                  method: "channel.event",
                  params: { type: "inbound", message: msg },
                });
              }
            } catch (err) {
              log("warn", `subscription ${channelId} ended: ${describeErr(err)}`);
            } finally {
              subs.delete(channelId);
            }
          })();
          break;
        }

        case "channels/unsubscribe": {
          const params = req.params ?? {};
          const channelId = String(params.channelId ?? "");
          const ac = subs.get(channelId);
          if (ac) {
            ac.abort();
            subs.delete(channelId);
          }
          reply({ jsonrpc: "2.0", id: req.id, result: { unsubscribed: true } });
          break;
        }

        case "channels/send": {
          const params = req.params ?? {};
          const channelId = String(params.channelId ?? "");
          const text = String(params.text ?? "");
          const threadId = params.threadId ? String(params.threadId) : undefined;
          if (!channelId || !text) {
            reply(error(req.id, -32602, "channelId+text required"));
            break;
          }
          const adapter = pickAdapterFor(channelId, opts.deps.adapters);
          if (!adapter) {
            reply(error(req.id, -32601, "channel_unavailable"));
            break;
          }
          try {
            const sent = await adapter.send(channelId, text, threadId);
            opts.deps.onOutbound?.({
              id: sent.messageId,
              channelId,
              senderHandle: "wotann",
              text,
              receivedAt: Date.now(),
              ...(threadId ? { threadId } : {}),
            });
            reply({ jsonrpc: "2.0", id: req.id, result: { messageId: sent.messageId } });
          } catch (err) {
            reply(error(req.id, -32000, `send_failed: ${describeErr(err)}`));
          }
          break;
        }

        case "shutdown":
          for (const ac of subs.values()) ac.abort();
          subs.clear();
          reply({ jsonrpc: "2.0", id: req.id, result: {} });
          return;

        default:
          reply(error(req.id, -32601, `unknown method: ${req.method}`));
      }
    } catch (err) {
      reply(error(req.id, -32603, describeErr(err)));
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

function error(id: number | string, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function listAcrossAdapters(
  adapters: readonly ChannelAdapter[],
): Promise<ReadonlyArray<{ id: string; name: string; platform: string }>> {
  const out: { id: string; name: string; platform: string }[] = [];
  for (const adapter of adapters) {
    try {
      const list = await adapter.listChannels();
      for (const c of list) {
        out.push({ id: c.id, name: c.name, platform: adapter.platform });
      }
    } catch {
      // Adapter listChannels failed — skip this platform's contribution.
    }
  }
  return out;
}

function pickAdapterFor(
  channelId: string,
  adapters: readonly ChannelAdapter[],
): ChannelAdapter | null {
  // Channel ids carry a "<platform>:<localid>" prefix by convention.
  const idx = channelId.indexOf(":");
  if (idx <= 0) return adapters[0] ?? null;
  const platform = channelId.slice(0, idx);
  return adapters.find((a) => a.platform === platform) ?? null;
}

// ── Plugin descriptor for the binary's --channels flag ────────

/**
 * Build the channel plugin descriptor that the `claude --channels` flag
 * consumes. The descriptor points at a Node entrypoint script that calls
 * `runChannelPlugin` over stdio.
 *
 * Use `dangerouslyLoadDevelopment` for local dev — production runs ship
 * the plugin packaged + signed.
 */
export interface ChannelPluginDescriptor {
  readonly name: string;
  readonly version: string;
  readonly entrypoint: string;
  readonly dangerouslyLoadDevelopment: boolean;
}

export function buildChannelPluginDescriptor(
  entrypoint: string,
  opts: { dev?: boolean } = {},
): ChannelPluginDescriptor {
  return {
    name: "wotann-channel",
    version: "0.1.0",
    entrypoint,
    dangerouslyLoadDevelopment: !!opts.dev,
  };
}
