/**
 * Microsoft Teams channel adapter using the Bot Framework REST API.
 *
 * ZERO-DEPENDENCY: Uses fetch() against the Bot Framework API.
 * No need for botbuilder npm packages.
 *
 * Setup:
 * 1. Register a bot in the Azure Bot Service
 * 2. Configure messaging endpoint
 * 3. Set TEAMS_APP_ID and TEAMS_APP_PASSWORD
 *
 * Authentication flow:
 * - OAuth2 client credentials to get token from login.microsoftonline.com
 * - Token used for all Bot Framework API calls
 */

import type { ChannelAdapter, IncomingMessage, OutgoingMessage, ChannelType } from "./adapter.js";

// ── Types ──────────────────────────────────────────────────

interface BotFrameworkActivity {
  readonly type: string;
  readonly id: string;
  readonly timestamp: string;
  readonly channelId: string;
  readonly from: {
    readonly id: string;
    readonly name: string;
  };
  readonly conversation: {
    readonly id: string;
  };
  readonly text?: string;
  readonly serviceUrl: string;
  readonly replyToId?: string;
}

interface OAuthTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
}

// ── Teams Adapter ──────────────────────────────────────────

export class TeamsAdapter implements ChannelAdapter {
  readonly type: ChannelType = "teams";
  readonly name = "Microsoft Teams";

  private readonly appId: string;
  private readonly appPassword: string;
  private connected = false;
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private accessToken: string = "";
  private tokenExpiresAt: number = 0;

  constructor(appId?: string, appPassword?: string) {
    this.appId = appId ?? process.env["TEAMS_APP_ID"] ?? "";
    this.appPassword = appPassword ?? process.env["TEAMS_APP_PASSWORD"] ?? "";
  }

  /**
   * V9 T1.6 — Structural JWT-header validation for Bot Framework webhooks.
   *
   * Microsoft Teams webhooks arrive as signed JWT Bearer tokens in the
   * `Authorization` header. Full cryptographic verification requires
   * fetching Microsoft's OpenID Connect metadata + public keys from
   * `https://login.botframework.com/v1/.well-known/openidconfiguration`
   * and then its JWKS URL, then RS256-verifying the token — that's
   * 150+ LOC of JWT + JWKS plumbing with a network fetch.
   *
   * For Tier-1 ship this implements the STRUCTURAL checks a real JWT
   * verifier must pass BEFORE the crypto step: shape (`x.y.z`), base64
   * decodability, expected issuer, expected audience (appId), and
   * non-expired timestamps. Any failure here means the token is
   * definitely invalid; passing here means crypto-verify is the
   * remaining step.
   *
   * A V9 follow-up task should wire the full JWKS path; leaving the
   * structural wire in place NOW lets the webhook host call
   * `verifySignature(...)` and get a hard fail on malformed tokens
   * without waiting for the full plumb.
   *
   * @param authHeader Full `Authorization` header (expected form `Bearer <jwt>`).
   * @returns true when structural checks pass (NOT a full crypto verify).
   */
  verifySignature(authHeader: string): boolean {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
    const jwt = authHeader.slice(7).trim();
    const parts = jwt.split(".");
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64] = parts;
    if (!headerB64 || !payloadB64) return false;
    try {
      const header = JSON.parse(
        Buffer.from(headerB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      ) as { alg?: string; typ?: string };
      const payload = JSON.parse(
        Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      ) as { iss?: string; aud?: string; exp?: number; nbf?: number };
      // Bot Framework tokens use RS256.
      if (header.alg !== "RS256") return false;
      // Issuer must be Microsoft's Bot Framework token service.
      if (
        payload.iss !== "https://api.botframework.com" &&
        payload.iss !== "https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/"
      ) {
        return false;
      }
      // Audience must be the bot's appId.
      if (this.appId && payload.aud !== this.appId) return false;
      const nowSec = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === "number" && payload.exp < nowSec) return false;
      if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) return false;
      // Structural check passed. Crypto verify is the next step —
      // deferred to a V9 follow-up wire.
      return true;
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (!this.appId || !this.appPassword) {
      throw new Error(
        "TEAMS_APP_ID and TEAMS_APP_PASSWORD required. " +
          "Register a bot at https://dev.botframework.com",
      );
    }

    // Authenticate with Bot Framework
    await this.refreshToken();
    this.connected = true;
  }

  async stop(): Promise<void> {
    this.connected = false;
    this.accessToken = "";
    this.tokenExpiresAt = 0;
  }

  async send(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      await this.ensureValidToken();

      // Parse serviceUrl and conversationId from channelId
      // Format: serviceUrl|conversationId
      const [serviceUrl, conversationId] = parseChannelId(message.channelId);
      if (!serviceUrl || !conversationId) return false;

      const activity = {
        type: "message",
        text: message.content,
        textFormat: message.format === "markdown" ? "markdown" : "plain",
        replyToId: message.replyTo,
      };

      const endpoint = `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(activity),
      });

      return response.ok;
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
   * Process an incoming Bot Framework activity.
   * Call this from your HTTP endpoint handler.
   */
  async handleActivity(activity: BotFrameworkActivity): Promise<void> {
    if (!this.messageHandler) return;
    if (activity.type !== "message" || !activity.text) return;

    const msg: IncomingMessage = {
      channelType: "teams",
      channelId: `${activity.serviceUrl}|${activity.conversation.id}`,
      senderId: activity.from.id,
      senderName: activity.from.name,
      content: activity.text,
      timestamp: new Date(activity.timestamp),
      replyTo: activity.id,
    };

    await this.messageHandler(msg);
  }

  // ── OAuth2 Token Management ──────────────────────────────

  private async refreshToken(): Promise<void> {
    const tokenUrl = "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.appId,
      client_secret: this.appPassword,
      scope: "https://api.botframework.com/.default",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error("Failed to authenticate with Bot Framework");
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.accessToken = data.access_token;
    // Refresh 5 minutes before expiry
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
  }

  private async ensureValidToken(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function parseChannelId(channelId: string): [string | undefined, string | undefined] {
  const separatorIdx = channelId.indexOf("|");
  if (separatorIdx === -1) return [undefined, undefined];

  const serviceUrl = channelId.slice(0, separatorIdx);
  const conversationId = channelId.slice(separatorIdx + 1);

  return [serviceUrl || undefined, conversationId || undefined];
}
