/**
 * SMS channel adapter via Twilio REST API.
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Twilio REST API.
 * No need for the twilio npm package.
 *
 * Setup:
 * 1. Create a Twilio account at https://www.twilio.com
 * 2. Get your Account SID, Auth Token, and a phone number
 * 3. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *
 * Security:
 * - DM pairing: unknown senders get pairing code
 * - Validate Twilio signature on incoming webhooks
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";
// V9 T1.6 — crypto for verifySignature().
import { createHmac, timingSafeEqual } from "node:crypto";

// ── Types ──────────────────────────────────────────────────

interface TwilioSendResponse {
  readonly sid?: string;
  readonly status?: string;
  readonly error_code?: number;
  readonly error_message?: string;
}

export interface TwilioWebhookPayload {
  readonly MessageSid: string;
  readonly From: string;
  readonly To: string;
  readonly Body: string;
  readonly NumMedia?: string;
}

// ── SMS Adapter ────────────────────────────────────────────

export class SMSAdapter implements ChannelAdapter {
  readonly type: ChannelType = "sms";
  readonly name = "SMS (Twilio)";

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly phoneNumber: string;
  private readonly apiBase: string;
  private connected = false;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  constructor(accountSid?: string, authToken?: string, phoneNumber?: string) {
    this.accountSid = accountSid ?? process.env["TWILIO_ACCOUNT_SID"] ?? "";
    this.authToken = authToken ?? process.env["TWILIO_AUTH_TOKEN"] ?? "";
    this.phoneNumber = phoneNumber ?? process.env["TWILIO_PHONE_NUMBER"] ?? "";
    this.apiBase = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`;
  }

  /**
   * V9 T1.6 — Verify a Twilio webhook signature.
   *
   * Twilio's scheme: concatenate the full request URL (exactly as
   * Twilio called it, including query string) with the POST form
   * parameters sorted by key and concatenated as `key+value` pairs,
   * then HMAC-SHA1 with the Auth Token. The base64-encoded digest is
   * sent in the `X-Twilio-Signature` header.
   *
   * Source: twilio.com/docs/usage/webhooks/webhooks-security
   *
   * @param fullUrl The full request URL (scheme + host + path + ?query).
   * @param postParams The POST form fields as parsed into a plain object.
   * @param signature Value of X-Twilio-Signature header.
   * @param authToken Twilio Auth Token (from twilio.com/console).
   * @returns true when the signature matches; false otherwise.
   */
  verifySignature(
    fullUrl: string,
    postParams: Readonly<Record<string, string>>,
    signature: string,
    authToken: string,
  ): boolean {
    if (!authToken || !signature || !fullUrl) return false;
    // Build the signing base: URL followed by sorted key+value pairs.
    const sortedKeys = Object.keys(postParams).sort();
    let base = fullUrl;
    for (const k of sortedKeys) {
      base += k + postParams[k];
    }
    const expected = createHmac("sha1", authToken).update(base, "utf8").digest("base64");
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (!this.accountSid || !this.authToken || !this.phoneNumber) {
      throw new Error(
        "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER required. " +
          "Sign up at https://www.twilio.com",
      );
    }

    // Verify credentials by fetching account info
    const response = await fetch(`${this.apiBase}.json`, {
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
      },
    });

    if (!response.ok) {
      throw new Error("Invalid Twilio credentials");
    }

    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const body = truncateSmsBody(message.content);

      const response = await fetch(`${this.apiBase}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: encodeFormData({
          To: message.channelId,
          From: this.phoneNumber,
          Body: body,
        }),
      });

      if (!response.ok) return false;

      const data = (await response.json()) as TwilioSendResponse;
      return data.sid !== undefined && data.error_code === undefined;
    } catch {
      return false;
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Process an incoming Twilio webhook payload.
   * Call this from your HTTP webhook handler.
   */
  async handleWebhook(payload: TwilioWebhookPayload): Promise<void> {
    if (!this.messageHandler) return;

    const msg: IncomingMessage = {
      channelType: "sms",
      channelId: payload.From,
      senderId: payload.From,
      senderName: payload.From,
      content: payload.Body,
      timestamp: new Date(),
      replyTo: payload.MessageSid,
    };

    await this.messageHandler(msg);
  }
}

// ── Helpers ────────────────────────────────────────────────

function encodeFormData(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function truncateSmsBody(content: string, maxLength: number = 1600): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength - 3) + "...";
}
