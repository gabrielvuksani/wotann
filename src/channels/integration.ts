/**
 * Channel integration helpers.
 * Bridges the adapter.ts contract to the gateway.ts contract used by KAIROS,
 * and provides a one-call wiring function to set up all available channels.
 */

import type {
  ChannelAdapter as GatewayChannelAdapter,
  ChannelMessage,
  ChannelType,
} from "./gateway.js";
import { ChannelGateway, type GatewayConfig } from "./gateway.js";
import type {
  ChannelAdapter as LegacyChannelAdapter,
  IncomingMessage,
  OutgoingMessage,
  MessageAttachment,
} from "./adapter.js";
import { createAvailableAdapters, getChannelStatus, type ChannelStatusSummary } from "./auto-detect.js";

export function wrapLegacyAdapter(
  adapter: LegacyChannelAdapter,
): GatewayChannelAdapter {
  return new LegacyGatewayAdapter(adapter);
}

class LegacyGatewayAdapter implements GatewayChannelAdapter {
  readonly type: ChannelType;
  readonly name: string;
  private messageHandler: ((message: ChannelMessage) => void) | null = null;

  constructor(private readonly adapter: LegacyChannelAdapter) {
    this.type = adapter.type as ChannelType;
    this.name = adapter.name;
    this.adapter.onMessage(async (message) => {
      this.messageHandler?.(toGatewayMessage(message));
    });
  }

  get connected(): boolean {
    return this.adapter.isConnected();
  }

  async send(channelId: string, content: string, replyTo?: string): Promise<boolean> {
    const outgoing: OutgoingMessage = {
      channelType: this.adapter.type,
      channelId,
      content,
      replyTo,
      format: "markdown",
    };
    return this.adapter.send(outgoing);
  }

  onMessage(handler: (message: ChannelMessage) => void): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<boolean> {
    await this.adapter.start();
    return this.adapter.isConnected();
  }

  async disconnect(): Promise<void> {
    await this.adapter.stop();
  }
}

function toGatewayMessage(message: IncomingMessage): ChannelMessage {
  return {
    id: buildMessageId(message),
    channelType: message.channelType as ChannelType,
    channelId: message.channelId,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    timestamp: message.timestamp.getTime(),
    replyTo: message.replyTo,
    attachments: message.attachments?.map(toGatewayAttachment),
  };
}

function toGatewayAttachment(attachment: MessageAttachment) {
  return {
    type: attachment.type === "file" ? "file" : attachment.type,
    url: attachment.url,
    data: attachment.data,
    mimeType: attachment.mimeType,
    filename: attachment.name,
  } as const;
}

function buildMessageId(message: IncomingMessage): string {
  const replyToken = message.replyTo ?? "root";
  return `${message.channelType}:${message.channelId}:${message.senderId}:${replyToken}:${message.timestamp.getTime()}`;
}

// ── Gateway Wiring ────────────────────────────────────────

export interface WiredGatewayResult {
  readonly gateway: ChannelGateway;
  readonly registered: readonly ChannelType[];
  readonly skipped: readonly { type: ChannelType; reason: string }[];
  readonly status: ChannelStatusSummary;
}

/**
 * Create a ChannelGateway and register all adapters that have valid credentials.
 *
 * This is the main entry point for wiring channels. It:
 * 1. Loads credentials from ~/.wotann/channels.json (or env vars)
 * 2. Creates adapter instances for each configured channel
 * 3. Wraps them into the gateway contract via LegacyGatewayAdapter
 * 4. Registers them with a new ChannelGateway
 *
 * The caller still needs to:
 * - Call gateway.setMessageHandler() to wire up the KAIROS runtime
 * - Call gateway.connectAll() to start all adapters
 */
export function wireGateway(
  gatewayConfig?: Partial<GatewayConfig>,
  channelsConfigPath?: string,
): WiredGatewayResult {
  const gateway = new ChannelGateway(gatewayConfig);
  const adapterResults = createAvailableAdapters(channelsConfigPath);
  const status = getChannelStatus(channelsConfigPath);

  const registered: ChannelType[] = [];
  const skipped: { type: ChannelType; reason: string }[] = [];

  for (const result of adapterResults) {
    if (result.adapter) {
      const wrapped = wrapLegacyAdapter(result.adapter);
      gateway.registerAdapter(wrapped);
      registered.push(result.type);
    } else {
      skipped.push({ type: result.type, reason: result.reason });
    }
  }

  return { gateway, registered, skipped, status };
}
