/**
 * Confluence Connector — ingest pages and spaces from Atlassian Confluence.
 *
 * Uses the Confluence REST API v2 for spaces, pages, and search.
 * Supports both Confluence Cloud and Data Center.
 *
 * SECURITY: Credentials stored in ConnectorConfig, never logged.
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorDocument,
  ConnectorStatus,
  ConnectorType,
} from "./connector-registry.js";
import { guardedFetch } from "./guarded-fetch.js";

interface ConfluencePage {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly body?: { storage?: { value: string } };
  readonly _links: { webui: string };
  readonly version: { when: string };
  readonly spaceId?: string;
}

export class ConfluenceConnector implements Connector {
  readonly type: ConnectorType = "confluence";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];
  private lastSync: number | null = null;
  private baseUrl = "";

  configure(config: ConnectorConfig): void {
    this.config = config;
    const domain = config.credentials["domain"] ?? "";
    this.baseUrl = domain.includes("://") ? domain : `https://${domain}`;
  }

  async connect(): Promise<boolean> {
    if (!this.config) return false;
    const email = this.config.credentials["email"];
    const apiToken = this.config.credentials["apiToken"] ?? this.config.credentials["token"];
    if (!email || !apiToken || !this.baseUrl) return false;

    try {
      const resp = await guardedFetch(`${this.baseUrl}/wiki/api/v2/spaces?limit=1`, {
        headers: this.authHeaders(email, apiToken),
      });
      this.connected = resp.ok;
      return resp.ok;
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
    const email = this.config.credentials["email"] ?? "";
    const apiToken = this.config.credentials["apiToken"] ?? this.config.credentials["token"] ?? "";

    try {
      const cql = encodeURIComponent(`text ~ "${query}" AND type = page`);
      const resp = await guardedFetch(
        `${this.baseUrl}/wiki/rest/api/content/search?cql=${cql}&limit=${limit}&expand=body.storage`,
        { headers: this.authHeaders(email, apiToken) },
      );
      if (!resp.ok) return [];

      const data = (await resp.json()) as { results: readonly ConfluencePage[] };
      return data.results.map((page) => ({
        id: `confluence-${page.id}`,
        title: page.title,
        content: this.stripHtml(page.body?.storage?.value ?? ""),
        url: `${this.baseUrl}/wiki${page._links.webui}`,
        source: "confluence" as ConnectorType,
        updatedAt: new Date(page.version.when).getTime(),
        metadata: { spaceId: page.spaceId ?? "" },
      }));
    } catch {
      return [];
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.connected || !this.config) return { added: 0, updated: 0, removed: 0 };
    const email = this.config.credentials["email"] ?? "";
    const apiToken = this.config.credentials["apiToken"] ?? this.config.credentials["token"] ?? "";
    const headers = this.authHeaders(email, apiToken);
    const prevCount = this.documents.length;
    const newDocs: ConnectorDocument[] = [];

    try {
      const resp = await guardedFetch(
        `${this.baseUrl}/wiki/api/v2/pages?limit=50&sort=-modified-date&body-format=storage`,
        { headers },
      );
      if (resp.ok) {
        const data = (await resp.json()) as { results: readonly ConfluencePage[] };
        for (const page of data.results) {
          newDocs.push({
            id: `confluence-${page.id}`,
            title: page.title,
            content: this.stripHtml(page.body?.storage?.value ?? ""),
            url: `${this.baseUrl}/wiki${page._links.webui}`,
            source: "confluence",
            updatedAt: new Date(page.version.when).getTime(),
            metadata: { spaceId: page.spaceId ?? "", status: page.status },
          });
        }
      }
    } catch {
      // Partial failure
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
      id: this.config?.id ?? "confluence",
      type: "confluence",
      connected: this.connected,
      lastSync: this.lastSync ?? undefined,
      documentCount: this.documents.length,
    };
  }

  private authHeaders(email: string, apiToken: string): Record<string, string> {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return { Authorization: `Basic ${auth}`, Accept: "application/json" };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
}
