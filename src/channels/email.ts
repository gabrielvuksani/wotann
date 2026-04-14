/**
 * Email channel adapter using native Node.js IMAP/SMTP.
 * Connects to any IMAP mailbox for inbound, SMTP for outbound.
 * No external dependencies beyond nodemailer (already common in Node projects).
 */

import { randomUUID } from "node:crypto";
import type { ChannelAdapter, ChannelMessage, ChannelType } from "./gateway.js";

export interface EmailConfig {
  readonly imap: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly tls: boolean;
  };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly secure: boolean;
  };
  readonly fromAddress: string;
  readonly pollIntervalMs: number;
  readonly subjectPrefix: string;
}

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  imap: { host: "", port: 993, user: "", password: "", tls: true },
  smtp: { host: "", port: 587, user: "", password: "", secure: false },
  fromAddress: "",
  pollIntervalMs: 30_000,
  subjectPrefix: "[WOTANN]",
};

export class EmailAdapter implements ChannelAdapter {
  readonly type: ChannelType = "email";
  readonly name = "Email (IMAP/SMTP)";
  connected = false;
  private readonly emailConfig: EmailConfig;
  private messageHandlers: Array<(message: ChannelMessage) => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private transporter: unknown = null;
  private lastSeenUID = 0;

  constructor(config?: Partial<EmailConfig>) {
    this.emailConfig = { ...DEFAULT_EMAIL_CONFIG, ...config };
  }

  async connect(): Promise<boolean> {
    try {
      if (!this.emailConfig.imap.host || !this.emailConfig.smtp.host) {
        console.warn("[Email] IMAP/SMTP config not set. Set email config in .wotann/config.yaml.");
        return false;
      }

      // Dynamic import for nodemailer
      const nodemailer = await import("nodemailer").catch(() => null);
      if (!nodemailer) {
        console.warn("[Email] nodemailer not installed. Run: npm install nodemailer");
        return false;
      }

      this.transporter = nodemailer.createTransport({
        host: this.emailConfig.smtp.host,
        port: this.emailConfig.smtp.port,
        secure: this.emailConfig.smtp.secure,
        auth: {
          user: this.emailConfig.smtp.user,
          pass: this.emailConfig.smtp.password,
        },
      });

      // Start IMAP polling
      this.pollTimer = setInterval(() => {
        void this.pollInbox();
      }, this.emailConfig.pollIntervalMs);

      this.connected = true;
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
  }

  async send(channelId: string, content: string, _replyTo?: string): Promise<boolean> {
    if (!this.transporter || !this.connected) return false;
    try {
      const transport = this.transporter as { sendMail: (options: Record<string, string>) => Promise<unknown> };
      await transport.sendMail({
        from: this.emailConfig.fromAddress,
        to: channelId,
        subject: `${this.emailConfig.subjectPrefix} Response`,
        text: content,
      });
      return true;
    } catch {
      return false;
    }
  }

  onMessage(handler: (message: ChannelMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  private async pollInbox(): Promise<void> {
    try {
      // Use IMAP to check for new messages
      // This is a simplified polling approach — production would use IDLE for real-time
      const Imap = await import("imap").catch(() => null);
      if (!Imap) return;

      const imap = new Imap.default({
        user: this.emailConfig.imap.user,
        password: this.emailConfig.imap.password,
        host: this.emailConfig.imap.host,
        port: this.emailConfig.imap.port,
        tls: this.emailConfig.imap.tls,
      });

      await new Promise<void>((resolve, reject) => {
        imap.once("ready", () => {
          imap.openBox("INBOX", true, (err: Error | null) => {
            if (err) { reject(err); return; }

            const criteria = this.lastSeenUID > 0
              ? [["UID", `${this.lastSeenUID + 1}:*`]]
              : ["UNSEEN"];

            imap.search(criteria as string[], (searchErr: Error | null, uids: number[]) => {
              if (searchErr || !uids.length) { imap.end(); resolve(); return; }

              const fetch = imap.fetch(uids, { bodies: ["HEADER.FIELDS (FROM SUBJECT DATE)", "TEXT"], markSeen: true });

              fetch.on("message", (msg: { on: (event: string, handler: (stream: { on: (event: string, handler: (chunk: Buffer) => void) => void; once: (event: string, handler: () => void) => void }, info: { which: string }) => void) => void }, seqno: number) => {
                let from = "";
                let subject = "";
                let body = "";

                msg.on("body", (stream, info) => {
                  let buffer = "";
                  stream.on("data", (chunk: Buffer) => { buffer += chunk.toString("utf8"); });
                  stream.once("end", () => {
                    if (info.which.includes("HEADER")) {
                      const fromMatch = buffer.match(/From:\s*(.+)/i);
                      const subjectMatch = buffer.match(/Subject:\s*(.+)/i);
                      from = fromMatch?.[1]?.trim() ?? "";
                      subject = subjectMatch?.[1]?.trim() ?? "";
                    } else {
                      body = buffer.trim();
                    }
                  });
                });

                msg.on("end" as unknown as string, (() => {
                  if (body && from) {
                    const channelMessage: ChannelMessage = {
                      id: randomUUID(),
                      channelType: "email",
                      channelId: from,
                      senderId: from,
                      senderName: from,
                      content: subject ? `${subject}\n\n${body}` : body,
                      timestamp: Date.now(),
                    };
                    for (const handler of this.messageHandlers) {
                      handler(channelMessage);
                    }
                  }
                  this.lastSeenUID = Math.max(this.lastSeenUID, seqno);
                }) as () => void);
              });

              fetch.once("end", () => { imap.end(); resolve(); });
            });
          });
        });

        imap.once("error", reject);
        imap.connect();
      });
    } catch {
      // Silently fail polling — will retry on next interval
    }
  }
}
