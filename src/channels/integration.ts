/**
 * Channel integration helpers.
 * Bridges the adapter.ts contract to the gateway.ts contract used by KAIROS.
 *
 * NB-5 (2026-04-28): the historical `wireGateway()` one-call wiring helper
 * was removed because it had zero callers — KAIROS calls
 * `gateway.registerAdapter()` directly per channel (see kairos.ts for
 * Telegram/Slack/Discord/Signal/WhatsApp/Email/Webhook/SMS/Matrix/Teams
 * registration sites). Keeping the helper around as orphan code accumulated
 * imports (`createAvailableAdapters`, `getChannelStatus`,
 * `ChannelStatusSummary`) that were not used elsewhere in this file.
 */

import type {
  ChannelAdapter as GatewayChannelAdapter,
  ChannelMessage,
  ChannelType,
} from "./gateway.js";
import type {
  ChannelAdapter as LegacyChannelAdapter,
  IncomingMessage,
  OutgoingMessage,
  MessageAttachment,
} from "./adapter.js";

export function wrapLegacyAdapter(adapter: LegacyChannelAdapter): GatewayChannelAdapter {
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
