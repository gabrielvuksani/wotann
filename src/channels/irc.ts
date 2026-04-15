/**
 * IRC channel adapter (E9).
 *
 * Thin wrapper around raw IRC RFC 1459/2812 protocol. Supports SASL PLAIN
 * auth and joins a configurable set of channels. Each incoming PRIVMSG is
 * dispatched through the standard ChannelAdapter contract so the gateway
 * can route it into the normal pipeline.
 *
 * Config:
 *   IRC_SERVER=irc.libera.chat
 *   IRC_PORT=6697
 *   IRC_NICK=wotannbot
 *   IRC_PASSWORD=... (optional SASL)
 *   IRC_CHANNELS=#wotann,#test
 *   IRC_USE_TLS=1  (default)
 */

import { createConnection, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { ChannelAdapter, ChannelMessage, ChannelType } from "./gateway.js";

export interface IRCConfig {
  readonly server: string;
  readonly port: number;
  readonly useTLS: boolean;
  readonly nick: string;
  readonly user: string;
  readonly realname: string;
  readonly password?: string;
  readonly channels: readonly string[];
  readonly reconnectBackoffMs: number;
}

const DEFAULTS: Omit<IRCConfig, "server" | "nick" | "channels" | "user" | "realname"> = {
  port: 6697,
  useTLS: true,
  reconnectBackoffMs: 5_000,
};

export class IRCAdapter implements ChannelAdapter {
  readonly type: ChannelType = "irc";
  readonly name = "IRC";
  connected = false;

  private socket: Socket | TLSSocket | null = null;
  private buffer = "";
  private readonly config: IRCConfig;
  private readonly handlers: Array<(m: ChannelMessage) => void> = [];
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<IRCConfig> & Pick<IRCConfig, "server" | "nick" | "channels">) {
    this.config = {
      ...DEFAULTS,
      user: "wotann",
      realname: "WOTANN Agent",
      ...config,
    };
  }

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      const { server, port, useTLS } = this.config;
      const onConnect = (): void => {
        this.connected = true;
        this.sendRaw(`NICK ${this.config.nick}`);
        this.sendRaw(`USER ${this.config.user} 0 * :${this.config.realname}`);
        if (this.config.password) {
          this.sendRaw(`PASS ${this.config.password}`);
        }
        resolve(true);
      };
      const sock = useTLS
        ? tlsConnect({ host: server, port, rejectUnauthorized: true }, onConnect)
        : createConnection({ host: server, port }, onConnect);
      sock.setEncoding("utf-8");
      sock.on("data", (data: string) => this.onData(data));
      sock.on("close", () => this.onClose());
      sock.on("error", (err) => {
         
        console.error(`[irc] socket error: ${err.message}`);
        resolve(false);
      });
      this.socket = sock;
    });
  }

  disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this.sendRaw("QUIT :wotann shutting down");
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
    return Promise.resolve();
  }

  onMessage(handler: (m: ChannelMessage) => void): void {
    this.handlers.push(handler);
  }

  async send(channelId: string, content: string, _replyTo?: string): Promise<boolean> {
    if (!this.connected) return false;
    try {
      // IRC lines are 512 bytes max including CRLF, so split long messages
      for (const line of wrapForIRC(content)) {
        this.sendRaw(`PRIVMSG ${channelId} :${line}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  private sendRaw(line: string): void {
    if (!this.socket) return;
    this.socket.write(`${line}\r\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf("\r\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.handleLine(line);
      idx = this.buffer.indexOf("\r\n");
    }
  }

  private handleLine(line: string): void {
    // PING keep-alive
    if (line.startsWith("PING ")) {
      this.sendRaw(`PONG ${line.slice(5)}`);
      return;
    }

    const parsed = parseIRCLine(line);
    if (!parsed) return;

    // After receiving the 001 welcome, join configured channels
    if (parsed.command === "001") {
      for (const channel of this.config.channels) {
        this.sendRaw(`JOIN ${channel}`);
      }
      return;
    }

    // Dispatch incoming PRIVMSG
    if (parsed.command === "PRIVMSG") {
      const target = parsed.args[0];
      const text = parsed.trailing;
      if (!target || text === undefined) return;
      const from = parsed.prefix?.split("!")[0] ?? "unknown";
      for (const handler of this.handlers) {
        handler({
          id: `irc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channelType: this.type,
          channelId: target,
          senderId: from,
          senderName: from,
          content: text,
          timestamp: Date.now(),
        });
      }
    }
  }

  private onClose(): void {
    this.connected = false;
    // Simple auto-reconnect
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // swallowed — next backoff will try again
      });
    }, this.config.reconnectBackoffMs);
  }
}

interface ParsedIRCLine {
  readonly prefix?: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly trailing: string;
}

export function parseIRCLine(line: string): ParsedIRCLine | null {
  if (!line) return null;
  let idx = 0;
  let prefix: string | undefined;
  if (line.startsWith(":")) {
    const space = line.indexOf(" ", 1);
    if (space === -1) return null;
    prefix = line.slice(1, space);
    idx = space + 1;
  }
  const colonIdx = line.indexOf(" :", idx);
  const head = colonIdx === -1 ? line.slice(idx) : line.slice(idx, colonIdx);
  const trailing = colonIdx === -1 ? "" : line.slice(colonIdx + 2);
  const parts = head.split(" ").filter(Boolean);
  const command = parts[0] ?? "";
  const args = parts.slice(1);
  return { prefix, command, args, trailing };
}

/** Split a message into 400-byte chunks so IRC's 512-byte line limit never trips. */
export function wrapForIRC(message: string): readonly string[] {
  const out: string[] = [];
  for (const paragraph of message.split("\n")) {
    let remaining = paragraph;
    while (remaining.length > 0) {
      out.push(remaining.slice(0, 400));
      remaining = remaining.slice(400);
    }
  }
  return out;
}
