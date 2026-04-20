/**
 * EchoChannelAdapter — concrete subclass of BaseChannelAdapter.
 *
 * Not a production channel. Serves two purposes:
 *   1. Reference implementation for the BaseChannelAdapter pattern —
 *      future real channels (WebSocket/HTTP with connect/retry/reconnect)
 *      that want the shared state-machine + exponential-backoff retry
 *      helpers should extend BaseChannelAdapter and see this as the
 *      minimal template.
 *   2. In-process echo channel used for dev-loop wiring tests and
 *      agent-harness self-checks where the runtime wants to exercise
 *      the channel-adapter surface without contacting an external
 *      service (Slack/Discord/etc). `doSend` records outbound messages
 *      into an in-memory log; `handleIncoming` synthesises an
 *      inbound roundtrip so the pipeline fires end-to-end.
 *
 * Wiring: exported from `src/channels/index.ts` (and `lib.ts` via the
 * channels barrel) so tests and future integrations can instantiate it.
 * Creating this concrete subclass closes the "BaseChannelAdapter has 0
 * extenders" finding from docs/FINAL_VERIFICATION_AUDIT_2026-04-19.md.
 */

import {
  BaseChannelAdapter,
  type ChannelAdapterConfig,
  type InboundMessage,
  type OutboundMessage,
} from "./base-adapter.js";

export interface EchoChannelSnapshot {
  readonly outbound: readonly OutboundMessage[];
  readonly inbound: readonly InboundMessage[];
}

export class EchoChannelAdapter extends BaseChannelAdapter {
  private readonly outboundLog: OutboundMessage[] = [];
  private readonly inboundLog: InboundMessage[] = [];
  private connected = false;

  constructor(name: string = "echo-dev") {
    const config: ChannelAdapterConfig = {
      name,
      type: "echo",
      enabled: true,
      credentials: {},
      reconnectIntervalMs: 1_000,
      maxRetries: 0,
    };
    super(config);
  }

  /**
   * Simulate an inbound message (from a test harness or agent-loop
   * self-check). Routes through the BaseChannelAdapter pipeline so
   * the messageHandler chain fires — same semantics as a real channel
   * receiving a PRIVMSG / webhook / Slack event.
   */
  async simulateInbound(content: string, senderId: string = "test-user"): Promise<void> {
    const msg: InboundMessage = {
      channelType: "echo",
      senderId,
      senderName: senderId,
      content,
      timestamp: Date.now(),
      metadata: {},
    };
    this.inboundLog.push(msg);
    await this.handleIncoming(msg);
  }

  /**
   * Read-only snapshot of message traffic. Test helpers use this to
   * assert the round-trip — handler replied, outbound log grew.
   */
  getSnapshot(): EchoChannelSnapshot {
    return {
      outbound: [...this.outboundLog],
      inbound: [...this.inboundLog],
    };
  }

  /** Reset traffic logs between tests without re-instantiating. */
  clearLogs(): void {
    this.outboundLog.length = 0;
    this.inboundLog.length = 0;
  }

  // ── BaseChannelAdapter abstract methods ──

  protected async doConnect(): Promise<boolean> {
    this.connected = true;
    return true;
  }

  protected async doDisconnect(): Promise<void> {
    this.connected = false;
  }

  protected async doSend(message: OutboundMessage): Promise<boolean> {
    if (!this.connected) return false;
    this.outboundLog.push(message);
    return true;
  }
}
