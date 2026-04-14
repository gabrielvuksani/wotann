/**
 * GitHub Bot -- respond to @wotann mentions in issues and PRs.
 *
 * Creates an HTTP server that receives GitHub webhook events,
 * verifies their signatures, and checks for @wotann mentions.
 * Mentioned events are forwarded to the dispatch plane for processing.
 *
 * Supported events:
 *   issue_comment              -- comments on issues
 *   pull_request_review_comment -- review comments on PRs
 *   issues                     -- issue creation/edits
 *
 * Zero external dependencies -- uses Node.js native HTTP + crypto.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";

// -- Configuration ----------------------------------------------------------

export interface GitHubBotConfig {
  readonly webhookSecret?: string;
  readonly port: number;
  readonly host: string;
  readonly mentionPattern: string;
  readonly webhookPath: string;
}

const DEFAULT_CONFIG: GitHubBotConfig = {
  port: 7743,
  host: "127.0.0.1",
  mentionPattern: "@wotann",
  webhookPath: "/github/webhook",
};

// -- Event Types ------------------------------------------------------------

export type GitHubEventType =
  | "issue_comment"
  | "pull_request_review_comment"
  | "issues";

export interface GitHubEvent {
  readonly id: string;
  readonly type: GitHubEventType;
  readonly action: string;
  readonly body: string;
  readonly repo: string;
  readonly number: number;
  readonly author: string;
  readonly timestamp: number;
  readonly url: string;
}

// -- Event Handler ----------------------------------------------------------

export type GitHubEventHandler = (event: GitHubEvent) => void;

// -- GitHub Bot Server ------------------------------------------------------

export class GitHubBot {
  private server: Server | null = null;
  private readonly eventHandlers: GitHubEventHandler[] = [];
  private readonly config: GitHubBotConfig;
  private readonly processedEvents: Set<string> = new Set();
  private readonly maxProcessedEventsSize = 1000;

  constructor(config: Partial<GitHubBotConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the webhook HTTP server.
   */
  async start(): Promise<{ readonly port: number; readonly host: string }> {
    if (this.server) {
      throw new Error("GitHub Bot is already running");
    }

    return new Promise<{ readonly port: number; readonly host: string }>((resolve, reject) => {
      const srv = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      srv.on("error", (err) => {
        reject(new Error(`GitHub Bot failed to start: ${err.message}`));
      });

      srv.listen(this.config.port, this.config.host, () => {
        this.server = srv;
        resolve({ port: this.config.port, host: this.config.host });
      });
    });
  }

  /**
   * Stop the webhook server.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.processedEvents.clear();
  }

  /**
   * Register a handler for @wotann mention events.
   */
  onMention(handler: GitHubEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Check whether the server is currently listening.
   */
  isListening(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Parse a raw webhook payload into a GitHubEvent, or null if not relevant.
   */
  parseWebhookEvent(
    eventType: string,
    action: string,
    payload: Record<string, unknown>,
  ): GitHubEvent | null {
    const normalized = this.normalizeEventType(eventType);
    if (!normalized) return null;

    const body = this.extractBody(normalized, payload);
    if (!body) return null;

    // Only process events that contain the mention pattern
    if (!body.toLowerCase().includes(this.config.mentionPattern.toLowerCase())) {
      return null;
    }

    const repo = this.extractRepo(payload);
    const number = this.extractNumber(normalized, payload);
    const author = this.extractAuthor(normalized, payload);
    const url = this.extractUrl(normalized, payload);

    return {
      id: randomUUID(),
      type: normalized,
      action,
      body,
      repo,
      number,
      author,
      timestamp: Date.now(),
      url,
    };
  }

  /**
   * Verify the HMAC-SHA256 signature of a webhook payload.
   * Returns true if no secret is configured (signature checking disabled).
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) {
      return true; // No secret configured, skip verification
    }

    const expected = "sha256=" + createHmac("sha256", this.config.webhookSecret)
      .update(payload, "utf8")
      .digest("hex");

    if (expected.length !== signature.length) {
      return false;
    }

    try {
      return timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(signature, "utf8"),
      );
    } catch {
      return false;
    }
  }

  // -- Outbound API: Issue & Comment Creation -------------------------------

  /**
   * Create a GitHub issue (used by agents to report blockers or create sub-tasks).
   * Requires GITHUB_TOKEN or GH_TOKEN env var with repo write permissions.
   * Returns the issue number and URL on success, or null on failure.
   */
  async createIssue(
    repo: string,
    title: string,
    body: string,
    labels?: readonly string[],
  ): Promise<{ readonly number: number; readonly url: string } | null> {
    const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
    if (!token) return null;

    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, labels }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as { number: number; html_url: string };
      return { number: data.number, url: data.html_url };
    } catch {
      return null;
    }
  }

  /**
   * Post a comment on a GitHub issue or PR.
   * Requires GITHUB_TOKEN or GH_TOKEN env var with repo write permissions.
   * Returns true on success, false on failure.
   */
  async postComment(
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<boolean> {
    const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
    if (!token) return false;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body }),
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  // -- Private: HTTP handling -----------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only accept POST to the webhook path
    if (req.method !== "POST" || req.url !== this.config.webhookPath) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Read body with size limit
    const MAX_BODY_SIZE = 1_048_576; // 1MB
    let bodySize = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      bodySize += buf.length;
      if (bodySize > MAX_BODY_SIZE) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        return;
      }
      chunks.push(buf);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");

    // Verify signature
    const signatureHeader = req.headers["x-hub-signature-256"];
    const signature = typeof signatureHeader === "string" ? signatureHeader : "";
    if (this.config.webhookSecret && !this.verifySignature(rawBody, signature)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid signature" }));
      return;
    }

    // Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    // Extract event type from GitHub header
    const eventTypeHeader = req.headers["x-github-event"];
    const eventType = typeof eventTypeHeader === "string" ? eventTypeHeader : "";
    const action = typeof payload["action"] === "string" ? payload["action"] : "";

    // Deduplicate using GitHub's delivery ID
    const deliveryHeader = req.headers["x-github-delivery"];
    const deliveryId = typeof deliveryHeader === "string" ? deliveryHeader : "";
    if (deliveryId && this.processedEvents.has(deliveryId)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, duplicate: true }));
      return;
    }

    // Parse and route the event
    const event = this.parseWebhookEvent(eventType, action, payload);

    if (event) {
      this.trackDelivery(deliveryId);
      for (const handler of this.eventHandlers) {
        handler(event);
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, processed: event !== null }));
  }

  // -- Private: Payload extraction ------------------------------------------

  private normalizeEventType(raw: string): GitHubEventType | null {
    const mapping: Record<string, GitHubEventType> = {
      "issue_comment": "issue_comment",
      "pull_request_review_comment": "pull_request_review_comment",
      "issues": "issues",
    };
    return mapping[raw] ?? null;
  }

  private extractBody(
    type: GitHubEventType,
    payload: Record<string, unknown>,
  ): string | null {
    if (type === "issue_comment" || type === "pull_request_review_comment") {
      const comment = payload["comment"] as Record<string, unknown> | undefined;
      return typeof comment?.["body"] === "string" ? comment["body"] : null;
    }

    if (type === "issues") {
      const issue = payload["issue"] as Record<string, unknown> | undefined;
      return typeof issue?.["body"] === "string" ? issue["body"] : null;
    }

    return null;
  }

  private extractRepo(payload: Record<string, unknown>): string {
    const repo = payload["repository"] as Record<string, unknown> | undefined;
    return typeof repo?.["full_name"] === "string" ? repo["full_name"] : "unknown";
  }

  private extractNumber(
    type: GitHubEventType,
    payload: Record<string, unknown>,
  ): number {
    if (type === "issue_comment" || type === "issues") {
      const issue = payload["issue"] as Record<string, unknown> | undefined;
      return typeof issue?.["number"] === "number" ? issue["number"] : 0;
    }

    if (type === "pull_request_review_comment") {
      const pr = payload["pull_request"] as Record<string, unknown> | undefined;
      return typeof pr?.["number"] === "number" ? pr["number"] : 0;
    }

    return 0;
  }

  private extractAuthor(
    type: GitHubEventType,
    payload: Record<string, unknown>,
  ): string {
    if (type === "issue_comment" || type === "pull_request_review_comment") {
      const comment = payload["comment"] as Record<string, unknown> | undefined;
      const user = comment?.["user"] as Record<string, unknown> | undefined;
      return typeof user?.["login"] === "string" ? user["login"] : "unknown";
    }

    if (type === "issues") {
      const issue = payload["issue"] as Record<string, unknown> | undefined;
      const user = issue?.["user"] as Record<string, unknown> | undefined;
      return typeof user?.["login"] === "string" ? user["login"] : "unknown";
    }

    return "unknown";
  }

  private extractUrl(
    type: GitHubEventType,
    payload: Record<string, unknown>,
  ): string {
    if (type === "issue_comment" || type === "pull_request_review_comment") {
      const comment = payload["comment"] as Record<string, unknown> | undefined;
      return typeof comment?.["html_url"] === "string" ? comment["html_url"] : "";
    }

    if (type === "issues") {
      const issue = payload["issue"] as Record<string, unknown> | undefined;
      return typeof issue?.["html_url"] === "string" ? issue["html_url"] : "";
    }

    return "";
  }

  private trackDelivery(deliveryId: string): void {
    if (!deliveryId) return;

    this.processedEvents.add(deliveryId);

    // Evict oldest entries to prevent unbounded growth
    if (this.processedEvents.size > this.maxProcessedEventsSize) {
      const iterator = this.processedEvents.values();
      const first = iterator.next();
      if (!first.done) {
        this.processedEvents.delete(first.value);
      }
    }
  }
}
