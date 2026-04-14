/**
 * iMessage Gateway Adapter — bridges IMessageAdapter to the gateway ChannelAdapter interface.
 *
 * IMessageAdapter has a bespoke API (start/stop/send/onMessage) that does not
 * implement the gateway's ChannelAdapter contract. This thin wrapper adapts it
 * so it can be registered with ChannelGateway and UnifiedDispatchPlane.
 *
 * macOS only — no-op on other platforms.
 */

import { randomUUID } from "node:crypto";
import type { ChannelAdapter, ChannelMessage, ChannelType } from "./gateway.js";
import { IMessageAdapter, type IMessageConfig } from "./imessage.js";

export class IMessageGatewayAdapter implements ChannelAdapter {
  readonly type: ChannelType = "imessage";
  readonly name = "iMessage (macOS AppleScript)";
  private _connected = false;
  private readonly adapter: IMessageAdapter;
  private messageHandler: ((message: ChannelMessage) => void) | null = null;

  constructor(config?: Partial<IMessageConfig>) {
    this.adapter = new IMessageAdapter(config);
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<boolean> {
    if (!this.adapter.isAvailable()) {
      return false;
    }

    this.adapter.onMessage((msg) => {
      if (!this.messageHandler) return;

      const gatewayMessage: ChannelMessage = {
        id: msg.id || randomUUID(),
        channelType: "imessage",
        channelId: msg.chatId,
        senderId: msg.sender,
        senderName: msg.sender,
        content: msg.text,
        timestamp: msg.timestamp,
      };

      this.messageHandler(gatewayMessage);
    });

    this.adapter.start();
    this._connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.adapter.stop();
    this._connected = false;
  }

  async send(channelId: string, content: string, _replyTo?: string): Promise<boolean> {
    return this.adapter.send(channelId, content);
  }

  onMessage(handler: (message: ChannelMessage) => void): void {
    this.messageHandler = handler;
  }
}
