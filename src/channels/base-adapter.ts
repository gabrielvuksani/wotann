/**
 * Base Channel Adapter — shared logic for all 11 channel adapters.
 * Extracts common WebSocket/HTTP patterns so each adapter only implements
 * channel-specific logic (auth, message format, etc).
 */

// ── Types ────────────────────────────────────────────────

export interface ChannelAdapterConfig {
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly credentials: Readonly<Record<string, string>>;
  readonly reconnectIntervalMs: number;
  readonly maxRetries: number;
}

export interface InboundMessage {
  readonly channelType: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly content: string;
  readonly timestamp: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface OutboundMessage {
  readonly channelType: string;
  readonly recipientId: string;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export type MessageHandler = (message: InboundMessage) => Promise<string>;

// ── Base Adapter ─────────────────────────────────────────

export abstract class BaseChannelAdapter {
  protected readonly config: ChannelAdapterConfig;
  protected state: ConnectionState = "disconnected";
  protected messageHandler: MessageHandler | null = null;
  protected retryCount = 0;

  constructor(config: ChannelAdapterConfig) {
    this.config = config;
  }

  /**
   * Connect to the channel service.
   */
  async connect(): Promise<boolean> {
    if (this.state === "connected") return true;
    this.state = "connecting";

    try {
      const connected = await this.doConnect();
      if (connected) {
        this.state = "connected";
        this.retryCount = 0;
        return true;
      }
      this.state = "error";
      return false;
    } catch {
      this.state = "error";
      return false;
    }
  }

  /**
   * Disconnect from the channel.
   */
  async disconnect(): Promise<void> {
    await this.doDisconnect();
    this.state = "disconnected";
    this.retryCount = 0;
  }

  /**
   * Send a message through the channel.
   */
  async send(message: OutboundMessage): Promise<boolean> {
    if (this.state !== "connected") return false;
    return this.doSend(message);
  }

  /**
   * Set the message handler for incoming messages.
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Get the current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get adapter info.
   */
  getInfo(): { name: string; type: string; state: ConnectionState; retries: number } {
    return {
      name: this.config.name,
      type: this.config.type,
      state: this.state,
      retries: this.retryCount,
    };
  }

  /**
   * Auto-reconnect with exponential backoff.
   */
  protected async attemptReconnect(): Promise<void> {
    if (this.retryCount >= this.config.maxRetries) {
      this.state = "error";
      return;
    }

    this.state = "reconnecting";
    this.retryCount++;

    const delay = Math.min(
      this.config.reconnectIntervalMs * Math.pow(2, this.retryCount - 1),
      60_000, // max 1 minute
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.connect();
  }

  /**
   * Handle an incoming message through the common pipeline.
   */
  protected async handleIncoming(message: InboundMessage): Promise<void> {
    if (!this.messageHandler) return;

    try {
      const response = await this.messageHandler(message);
      if (response) {
        await this.send({
          channelType: message.channelType,
          recipientId: message.senderId,
          content: response,
        });
      }
    } catch {
      // Message handling error — logged but not propagated
    }
  }

  // ── Abstract methods for subclasses ────────────────────

  protected abstract doConnect(): Promise<boolean>;
  protected abstract doDisconnect(): Promise<void>;
  protected abstract doSend(message: OutboundMessage): Promise<boolean>;
}
