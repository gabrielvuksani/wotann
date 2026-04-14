/**
 * Channel adapter abstraction for multi-platform messaging.
 * DM pairing security: unknown senders get pairing code.
 */

import { randomBytes } from "node:crypto";
import type { ChannelType } from "./channel-types.js";

export type { ChannelType } from "./channel-types.js";

export interface IncomingMessage {
  readonly channelType: ChannelType;
  readonly channelId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly content: string;
  readonly timestamp: Date;
  readonly replyTo?: string;
  readonly attachments?: readonly MessageAttachment[];
}

export interface OutgoingMessage {
  readonly channelType: ChannelType;
  readonly channelId: string;
  readonly content: string;
  readonly replyTo?: string;
  readonly format?: "text" | "markdown" | "html";
}

export interface MessageAttachment {
  readonly type: "image" | "file" | "audio" | "video";
  readonly url?: string;
  readonly data?: Buffer;
  readonly name: string;
  readonly mimeType: string;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly name: string;

  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<boolean>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  isConnected(): boolean;
}

// ── DM Pairing Security ─────────────────────────────────────

export interface PairingEntry {
  readonly senderId: string;
  readonly channelType: ChannelType;
  readonly pairingCode: string;
  readonly createdAt: Date;
  readonly approved: boolean;
}

export class DMPairingManager {
  private readonly pairings: Map<string, PairingEntry> = new Map();
  private readonly approvedSenders: Set<string> = new Set();

  generatePairingCode(): string {
    return randomBytes(3).toString("hex").toUpperCase();
  }

  isApproved(senderId: string): boolean {
    return this.approvedSenders.has(senderId);
  }

  requestPairing(senderId: string, channelType: ChannelType): PairingEntry {
    const key = `${channelType}:${senderId}`;
    const existing = this.pairings.get(key);
    if (existing) return existing;

    const entry: PairingEntry = {
      senderId,
      channelType,
      pairingCode: this.generatePairingCode(),
      createdAt: new Date(),
      approved: false,
    };
    this.pairings.set(key, entry);
    return entry;
  }

  approvePairing(senderId: string, channelType: ChannelType, code: string): boolean {
    const key = `${channelType}:${senderId}`;
    const entry = this.pairings.get(key);

    if (!entry || entry.pairingCode !== code) return false;

    this.approvedSenders.add(senderId);
    this.pairings.set(key, { ...entry, approved: true });
    return true;
  }

  revokePairing(senderId: string): void {
    this.approvedSenders.delete(senderId);
  }

  getPendingPairings(): readonly PairingEntry[] {
    return [...this.pairings.values()].filter((p) => !p.approved);
  }
}

// ── Node Capabilities (device registration) ─────────────────

export interface NodeCapabilities {
  readonly camera: boolean;
  readonly screenRecording: boolean;
  readonly location: boolean;
  readonly notifications: boolean;
  readonly clipboard: boolean;
  readonly microphone: boolean;
  readonly fileSystem: boolean;
}

export interface RegisteredNode {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly capabilities: NodeCapabilities;
  readonly lastSeen: Date;
}

export class NodeRegistry {
  private readonly nodes: Map<string, RegisteredNode> = new Map();

  register(node: RegisteredNode): void {
    this.nodes.set(node.id, node);
  }

  unregister(nodeId: string): void {
    this.nodes.delete(nodeId);
  }

  getNode(nodeId: string): RegisteredNode | undefined {
    return this.nodes.get(nodeId);
  }

  getNodesWithCapability(capability: keyof NodeCapabilities): readonly RegisteredNode[] {
    return [...this.nodes.values()].filter((n) => n.capabilities[capability]);
  }

  getAllNodes(): readonly RegisteredNode[] {
    return [...this.nodes.values()];
  }

  getNodeCount(): number {
    return this.nodes.size;
  }
}

// ── WebChat Adapter (HTTP/SSE — built-in) ───────────────────

export class WebChatAdapter implements ChannelAdapter {
  readonly type: ChannelType = "webchat";
  readonly name = "WebChat (HTTP/SSE)";

  private connected = false;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  async start(): Promise<void> {
    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  async send(_message: OutgoingMessage): Promise<boolean> {
    return this.connected;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async receiveMessage(msg: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      await this.messageHandler(msg);
    }
  }
}
