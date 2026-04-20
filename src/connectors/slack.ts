/**
 * Slack Connector — ingest messages and threads from Slack workspaces.
 *
 * Uses the Slack Web API for channels, messages, and search.
 * Requires a Slack Bot Token (xoxb-) with channels:history, channels:read,
 * search:read scopes.
 *
 * SECURITY: Token stored in ConnectorConfig credentials, never logged.
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorDocument,
  ConnectorStatus,
  ConnectorType,
} from "./connector-registry.js";
import { guardedFetch } from "./guarded-fetch.js";

const API_BASE = "https://slack.com/api";

export class SlackConnector implements Connector {
  readonly type: ConnectorType = "slack";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];
  private lastSync: number | null = null;

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    const token = this.config?.credentials["token"] ?? this.config?.credentials["SLACK_BOT_TOKEN"];
    if (!token) return false;

    try {
      const resp = await guardedFetch(`${API_BASE}/auth.test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = (await resp.json()) as { ok: boolean };
      this.connected = data.ok;
      return data.ok;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async discover(): Promise<readonly ConnectorDocument[]> {
    return this.documents;
  }

  async fetch(documentId: string): Promise<ConnectorDocument | null> {
    return this.documents.find((d) => d.id === documentId) ?? null;
  }

  async search(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    if (!this.connected || !this.config) return [];
    const token =
      this.config.credentials["token"] ?? this.config.credentials["SLACK_BOT_TOKEN"] ?? "";

    try {
      const resp = await guardedFetch(
        `${API_BASE}/search.messages?query=${encodeURIComponent(query)}&count=${limit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) return [];

      const data = (await resp.json()) as {
        ok: boolean;
        messages?: {
          matches: readonly {
            ts: string;
            text: string;
            channel: { id: string; name: string };
            permalink: string;
          }[];
        };
      };
      if (!data.ok || !data.messages) return [];

      return data.messages.matches.map((match) => ({
        id: `slack-${match.channel.id}-${match.ts}`,
        title: `#${match.channel.name} — ${match.text.slice(0, 60)}`,
        content: match.text,
        url: match.permalink,
        source: "slack" as ConnectorType,
        updatedAt: Math.floor(parseFloat(match.ts) * 1000),
        metadata: { channel: match.channel.name },
      }));
    } catch {
      return [];
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.connected || !this.config) return { added: 0, updated: 0, removed: 0 };
    const token =
      this.config.credentials["token"] ?? this.config.credentials["SLACK_BOT_TOKEN"] ?? "";
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const prevCount = this.documents.length;
    const newDocs: ConnectorDocument[] = [];

    try {
      const channelsResp = await guardedFetch(
        `${API_BASE}/conversations.list?types=public_channel&limit=20`,
        { headers },
      );
      if (channelsResp.ok) {
        const channelsData = (await channelsResp.json()) as {
          ok: boolean;
          channels?: readonly { id: string; name: string }[];
        };
        if (channelsData.ok && channelsData.channels) {
          for (const channel of channelsData.channels.slice(0, 10)) {
            const historyResp = await guardedFetch(
              `${API_BASE}/conversations.history?channel=${channel.id}&limit=10`,
              { headers },
            );
            if (historyResp.ok) {
              const historyData = (await historyResp.json()) as {
                ok: boolean;
                messages?: readonly { ts: string; text: string; user: string }[];
              };
              if (historyData.ok && historyData.messages) {
                for (const msg of historyData.messages) {
                  newDocs.push({
                    id: `slack-${channel.id}-${msg.ts}`,
                    title: `#${channel.name} — ${msg.text.slice(0, 60)}`,
                    content: msg.text,
                    url: `https://slack.com/archives/${channel.id}/p${msg.ts.replace(".", "")}`,
                    source: "slack",
                    updatedAt: Math.floor(parseFloat(msg.ts) * 1000),
                    metadata: { channel: channel.name, user: msg.user },
                  });
                }
              }
            }
          }
        }
      }
    } catch {
      // Sync partially failed — keep what we have
    }

    this.documents = newDocs;
    this.lastSync = Date.now();

    return {
      added: Math.max(0, newDocs.length - prevCount),
      updated: Math.min(prevCount, newDocs.length),
      removed: Math.max(0, prevCount - newDocs.length),
    };
  }

  getStatus(): ConnectorStatus {
    return {
      id: this.config?.id ?? "slack",
      type: "slack",
      connected: this.connected,
      lastSync: this.lastSync ?? undefined,
      documentCount: this.documents.length,
    };
  }
}
