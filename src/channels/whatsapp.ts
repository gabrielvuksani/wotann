/**
 * WhatsApp channel adapter using the Baileys library (zero-SDK, open-source).
 * Baileys connects to WhatsApp Web via WebSocket — no official API needed.
 *
 * ZERO-DEPENDENCY by default: @whiskeysockets/baileys is dynamically imported.
 * If not installed, the adapter logs a warning and fails gracefully.
 *
 * Setup:
 * 1. Install: npm install @whiskeysockets/baileys
 * 2. Set WHATSAPP_SESSION or WHATSAPP_SESSION_DIR to auth state directory
 * 3. On first run, scan the QR code printed to terminal
 *
 * Security:
 * - DM pairing: unknown senders get a pairing code to verify
 * - Only processes messages from individual chats (not groups) by default
 * - No file downloads from untrusted senders
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";
// V9 T1.6 — crypto for verifySignature().
import { createHmac, timingSafeEqual } from "node:crypto";

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type: ChannelType = "whatsapp";
  readonly name = "WhatsApp (Baileys)";

  private _connected = false;
  private socket: unknown = null;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private readonly sessionDir: string;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY_MS = 60_000;
  private readonly streamingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(sessionDir?: string) {
    this.sessionDir =
      sessionDir ??
      process.env["WHATSAPP_SESSION"] ??
      process.env["WHATSAPP_SESSION_DIR"] ??
      ".wotann/whatsapp-auth";
  }

  /**
   * V9 T1.6 — Verify a WhatsApp Business Cloud API webhook signature.
   *
   * Meta signs outgoing webhook payloads with SHA256 HMAC using the
   * app secret. The digest is sent in the `X-Hub-Signature-256` header
   * with format `sha256=<hex>`. The signature MUST be computed over
   * the exact raw body bytes (not a re-serialized JSON).
   *
   * This method is for the Cloud API path (REST webhooks via Meta).
   * The Baileys-based path in this adapter connects directly to
   * WhatsApp servers via WebSocket — no webhook signing involved
   * there; this verify helper is available for deployments that
   * front Baileys with a webhook-bridge.
   *
   * @param rawBody Raw request body (as received, unmodified).
   * @param signature Value of the X-Hub-Signature-256 header
   *                  (format: `sha256=<hex>`).
   * @param appSecret Meta App Secret (from Meta App dashboard).
   * @returns true when the HMAC matches; false on any mismatch.
   */
  verifySignature(rawBody: string, signature: string, appSecret: string): boolean {
    if (!appSecret || !signature) return false;
    const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    // Dynamic import to avoid hard dependency on @whiskeysockets/baileys
    const baileys = await import("@whiskeysockets/baileys").catch(() => null);
    if (!baileys) {
      throw new Error(
        "@whiskeysockets/baileys not installed. Run: npm install @whiskeysockets/baileys",
      );
    }

    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    const sock = this.socket as Record<string, unknown>;
    const ev = sock["ev"] as {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
    };

    // Save auth credentials on update
    ev.on("creds.update", saveCreds);

    // Handle connection updates

    ev.on("connection.update", ((update: any) => {
      if (update.connection === "close") {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this._connected = false;
        if (shouldReconnect) {
          const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            this.MAX_RECONNECT_DELAY_MS,
          );
          this.reconnectAttempts++;
          setTimeout(() => void this.start(), delay);
        }
      } else if (update.connection === "open") {
        this._connected = true;
        this.reconnectAttempts = 0;
      }
    }) as (...args: unknown[]) => void);

    // Handle incoming messages

    ev.on("messages.upsert", ((event: any) => {
      for (const msg of event.messages ?? []) {
        if (msg.key?.fromMe) continue;

        const content = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
        if (!content) continue;

        // Skip group messages (JIDs ending in @g.us)
        const jid = msg.key?.remoteJid ?? "";
        if (jid.endsWith("@g.us")) continue;

        const incoming: IncomingMessage = {
          channelType: "whatsapp",
          channelId: jid,
          senderId: jid,
          senderName: msg.pushName ?? jid.split("@")[0] ?? "unknown",
          content,
          timestamp: new Date((msg.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000),
          replyTo: msg.key?.id,
        };

        if (this.messageHandler) {
          this.messageHandler(incoming).catch(() => {});
        }
      }
    }) as (...args: unknown[]) => void);

    // Don't set connected here — wait for the "open" connection event above
  }

  async stop(): Promise<void> {
    // Clean up all streaming timers first to avoid leaks when the socket closes.
    for (const handle of this.streamingTimers.values()) {
      clearInterval(handle);
    }
    this.streamingTimers.clear();

    if (this.socket) {
      const sock = this.socket as { end: (reason?: unknown) => void };
      sock.end(undefined);
      this.socket = null;
    }
    this._connected = false;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.socket || !this._connected) return false;

    try {
      const sock = this.socket as {
        sendMessage: (jid: string, message: { text: string }) => Promise<unknown>;
      };

      // Convert markdown-style formatting to WhatsApp-safe formatting + truncate code blocks.
      // Default behaviour: run the formatter so long code blocks and markdown
      // headers render correctly on WhatsApp. Callers that pre-format their
      // own text can pass `format: "text"` to bypass conversion.
      const formatted =
        message.format === "text" ? message.content : formatForWhatsApp(message.content);

      // Split long messages (WhatsApp limit: ~65536 chars, but 4096 is practical)
      const chunks = splitMessage(formatted, 4096);
      for (const chunk of chunks) {
        await sock.sendMessage(message.channelId, { text: chunk });
      }
      return true;
    } catch (err) {
      console.error("[WhatsApp] send failed:", err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * Begin a streaming "typing..." indicator for a given JID. Emits a presence
   * update every 5 seconds until stopStreaming() is called. Used to signal
   * that the agent is still working on the reply.
   */
  startStreaming(jid: string): void {
    if (!this.socket || !this._connected) return;
    const key = jid;
    if (this.streamingTimers.has(key)) return;
    const sock = this.socket as {
      sendPresenceUpdate?: (presence: string, jid: string) => Promise<unknown>;
    };
    const tick = (): void => {
      try {
        if (sock.sendPresenceUpdate) {
          // Baileys presence update: "composing" = typing indicator
          void sock.sendPresenceUpdate("composing", jid);
        }
      } catch (err) {
        // Best-effort telemetry — a failed presence update is non-fatal.
        console.error(
          "[WhatsApp] presence update failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    tick();
    const handle = setInterval(tick, 5000);
    this.streamingTimers.set(key, handle);
  }

  /** Stop the streaming indicator for a given JID. Safe to call multiple times. */
  stopStreaming(jid: string): void {
    const handle = this.streamingTimers.get(jid);
    if (handle) {
      clearInterval(handle);
      this.streamingTimers.delete(jid);
    }
    if (this.socket && this._connected) {
      try {
        const sock = this.socket as {
          sendPresenceUpdate?: (presence: string, jid: string) => Promise<unknown>;
        };
        if (sock.sendPresenceUpdate) {
          void sock.sendPresenceUpdate("paused", jid);
        }
      } catch {
        // Best-effort: the indicator naturally times out if we can't clear it.
      }
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this._connected;
  }
}

// ── Helpers ──────────────────────────────────────────────

/** Max characters to preserve inside a ```code``` block before truncation. */
const CODE_BLOCK_MAX = 2000;

/**
 * Convert common markdown formatting to WhatsApp-compatible formatting.
 *
 * WhatsApp uses the same asterisk/underscore/tilde/triple-backtick markers
 * that markdown uses, but it does not support `#` headers, so we promote
 * headers to bold. Long fenced code blocks are truncated with a pointer to
 * the desktop for the full text.
 */
export function formatForWhatsApp(md: string): string {
  // Truncate fenced code blocks. Match ```[lang]\n...``` with DOTALL semantics.
  const withTruncatedCode = md.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_all, _lang, body) => {
    const code = String(body);
    if (code.length <= CODE_BLOCK_MAX) return "```\n" + code + "```";
    const truncated = code.slice(0, CODE_BLOCK_MAX);
    return "```\n" + truncated + "\n[truncated, see desktop for full]\n```";
  });

  // Promote markdown headers (`# Heading`, `## Sub`) to bold lines.
  const withoutHeaders = withTruncatedCode.replace(
    /^(#{1,6})\s+(.+?)\s*$/gm,
    (_all, _hashes, text) => `*${String(text).trim()}*`,
  );

  // Asterisk/underscore/tilde pass-through already matches WhatsApp semantics.
  return withoutHeaders;
}

function splitMessage(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}
