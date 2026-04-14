/**
 * Channel Gateway — central message router for multi-channel messaging.
 *
 * ARCHITECTURE (inspired by OpenClaw):
 * The Gateway is the always-on control plane that manages:
 * - Session routing: incoming messages → correct agent session
 * - Channel multiplexing: one agent, many channels (Telegram, Slack, Discord, WebChat)
 * - DM pairing security: unknown senders get pairing codes
 * - Node architecture: device capability registration
 * - Message queueing: async delivery when channels are offline
 *
 * This is the unified equivalent of:
 * - OpenClaw's Channel Architecture (50+ platforms)
 * - Claude Code's Dispatch feature
 * - Telegram/Slack/Discord adapters (unified interface)
 *
 * DESIGN PRINCIPLE:
 * The gateway sits between all external channels and the agent.
 * Every message flows through it, regardless of source.
 * The agent never knows which channel a message came from —
 * it just processes text and returns text.
 */

import { randomUUID } from "node:crypto";
import type { ChannelType } from "./channel-types.js";

export type { ChannelType } from "./channel-types.js";

export interface ChannelMessage {
  readonly id: string;
  readonly channelType: ChannelType;
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName?: string;
  readonly content: string;
  readonly timestamp: number;
  readonly replyTo?: string;
  readonly attachments?: readonly Attachment[];
  readonly metadata?: Record<string, unknown>;
}

export interface Attachment {
  readonly type: "image" | "file" | "audio" | "video" | "code";
  readonly url?: string;
  readonly data?: Buffer;
  readonly mimeType: string;
  readonly filename: string;
}

export interface GatewayResponse {
  readonly id: string;
  readonly content: string;
  readonly channelType: ChannelType;
  readonly channelId: string;
  readonly replyTo: string;
  readonly timestamp: number;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly name: string;
  readonly connected: boolean;
  send(channelId: string, content: string, replyTo?: string): Promise<boolean>;
  onMessage(handler: (message: ChannelMessage) => void): void;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
}

export interface PairingCode {
  readonly code: string;
  readonly senderId: string;
  readonly channelType: ChannelType;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly verified: boolean;
}

export interface DeviceNode {
  readonly id: string;
  readonly name: string;
  readonly channelType: ChannelType;
  readonly capabilities: readonly string[];
  readonly lastSeen: number;
  readonly online: boolean;
}

export interface GatewayConfig {
  readonly requirePairing: boolean;
  readonly pairingCodeTTL: number;
  readonly maxQueueSize: number;
  readonly allowedChannels: readonly ChannelType[];
}

const DEFAULT_CONFIG: GatewayConfig = {
  requirePairing: true,
  pairingCodeTTL: 5 * 60 * 1000, // 5 minutes
  maxQueueSize: 100,
  allowedChannels: ["telegram", "slack", "discord", "webchat", "cli"],
};

export class ChannelGateway {
  private readonly config: GatewayConfig;
  private adapters: Map<ChannelType, ChannelAdapter> = new Map();
  private verifiedSenders: Set<string> = new Set();
  private pairingCodes: Map<string, PairingCode> = new Map();
  private devices: Map<string, DeviceNode> = new Map();
  private messageQueue: ChannelMessage[] = [];
  private messageHandler: ((message: ChannelMessage) => Promise<string>) | null = null;

  constructor(config?: Partial<GatewayConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a channel adapter with the gateway.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);

    adapter.onMessage((message) => {
      void this.handleIncomingMessage(message);
    });
  }

  /**
   * Set the message handler — the function that processes messages and returns responses.
   * This is typically the agent's query function.
   */
  setMessageHandler(handler: (message: ChannelMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  /**
   * Connect all registered adapters.
   */
  async connectAll(): Promise<{ connected: readonly ChannelType[]; failed: readonly ChannelType[] }> {
    const connected: ChannelType[] = [];
    const failed: ChannelType[] = [];

    for (const [type, adapter] of this.adapters) {
      try {
        const ok = await adapter.connect();
        if (ok) connected.push(type);
        else failed.push(type);
      } catch {
        failed.push(type);
      }
    }

    return { connected, failed };
  }

  /**
   * Disconnect all adapters.
   */
  async disconnectAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }
  }

  /**
   * Generate a DM pairing code for an unknown sender.
   * The user must enter this code via a trusted channel (CLI or web UI)
   * to verify the sender.
   */
  generatePairingCode(senderId: string, channelType: ChannelType): PairingCode {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const pairing: PairingCode = {
      code,
      senderId,
      channelType,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.pairingCodeTTL,
      verified: false,
    };

    this.pairingCodes.set(code, pairing);
    return pairing;
  }

  /**
   * Verify a pairing code. Returns true if the code is valid and not expired.
   */
  verifyPairingCode(code: string): boolean {
    const pairing = this.pairingCodes.get(code);
    if (!pairing) return false;
    if (Date.now() > pairing.expiresAt) {
      this.pairingCodes.delete(code);
      return false;
    }

    this.verifiedSenders.add(pairing.senderId);
    this.pairingCodes.delete(code);
    return true;
  }

  /**
   * Register a device node with its capabilities.
   */
  registerDevice(name: string, channelType: ChannelType, capabilities: readonly string[]): DeviceNode {
    const node: DeviceNode = {
      id: randomUUID(),
      name,
      channelType,
      capabilities,
      lastSeen: Date.now(),
      online: true,
    };
    this.devices.set(node.id, node);
    return node;
  }

  /**
   * Get all registered devices.
   */
  getDevices(): readonly DeviceNode[] {
    return [...this.devices.values()];
  }

  /**
   * Get connected channel types.
   */
  getConnectedChannels(): readonly ChannelType[] {
    return [...this.adapters.entries()]
      .filter(([_, adapter]) => adapter.connected)
      .map(([type]) => type);
  }

  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Send a message to a specific channel.
   */
  async sendToChannel(channelType: ChannelType, channelId: string, content: string, replyTo?: string): Promise<boolean> {
    const adapter = this.adapters.get(channelType);
    if (!adapter?.connected) return false;
    return adapter.send(channelId, content, replyTo);
  }

  /**
   * Broadcast a message to all connected channels.
   */
  async broadcast(content: string): Promise<readonly ChannelType[]> {
    const sent: ChannelType[] = [];
    for (const [type, adapter] of this.adapters) {
      if (adapter.connected) {
        const ok = await adapter.send("broadcast", content);
        if (ok) sent.push(type);
      }
    }
    return sent;
  }

  /**
   * Get queued messages that couldn't be delivered.
   */
  getMessageQueue(): readonly ChannelMessage[] {
    return [...this.messageQueue];
  }

  /**
   * Check if a sender is verified.
   */
  isSenderVerified(senderId: string): boolean {
    return this.verifiedSenders.has(senderId);
  }

  /**
   * Manually verify a sender (bypass pairing).
   */
  verifySender(senderId: string): void {
    this.verifiedSenders.add(senderId);
  }

  getAdapterCount(): number { return this.adapters.size; }
  getVerifiedSenderCount(): number { return this.verifiedSenders.size; }

  // ── Private ────────────────────────────────────────────────

  private async handleIncomingMessage(message: ChannelMessage): Promise<void> {
    // Check if channel is allowed
    if (!this.config.allowedChannels.includes(message.channelType)) return;

    // DM pairing security
    if (this.config.requirePairing && !this.verifiedSenders.has(message.senderId)) {
      if (message.channelType !== "cli" && message.channelType !== "webchat") {
        const pairing = this.generatePairingCode(message.senderId, message.channelType);
        const adapter = this.adapters.get(message.channelType);
        if (adapter) {
          await adapter.send(
            message.channelId,
            `Unknown sender. Enter this pairing code in the WOTANN CLI to verify: ${pairing.code}`,
            message.id,
          );
        }
        return;
      }
      // CLI and webchat are implicitly trusted
      this.verifiedSenders.add(message.senderId);
    }

    // Process message through handler
    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(message);
        const adapter = this.adapters.get(message.channelType);
        if (adapter?.connected) {
          await adapter.send(message.channelId, response, message.id);
        } else {
          // Queue for later delivery
          this.queueMessage(message);
        }
      } catch {
        // Queue on error
        this.queueMessage(message);
      }
    }
  }

  private queueMessage(message: ChannelMessage): void {
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      this.messageQueue.shift();
    }
    this.messageQueue.push(message);
  }
}
