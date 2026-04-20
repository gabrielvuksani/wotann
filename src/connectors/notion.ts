/**
 * Notion Connector — ingest pages and databases from Notion.
 *
 * Uses the Notion API v2022-06-28 for listing, fetching, and searching.
 * Converts Notion blocks to plain text / markdown.
 *
 * SECURITY: API key is stored in ConnectorConfig credentials, never logged.
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorDocument,
  ConnectorStatus,
  ConnectorType,
} from "./connector-registry.js";
import { guardedFetch } from "./guarded-fetch.js";

// ── Types ────────────────────────────────────────────────

interface NotionPage {
  readonly id: string;
  readonly url: string;
  readonly created_time: string;
  readonly last_edited_time: string;
  readonly properties: Readonly<Record<string, NotionProperty>>;
}

interface NotionProperty {
  readonly type: string;
  readonly title?: readonly { plain_text: string }[];
  readonly rich_text?: readonly { plain_text: string }[];
}

interface NotionBlock {
  readonly id: string;
  readonly type: string;
  readonly paragraph?: { rich_text: readonly { plain_text: string }[] };
  readonly heading_1?: { rich_text: readonly { plain_text: string }[] };
  readonly heading_2?: { rich_text: readonly { plain_text: string }[] };
  readonly heading_3?: { rich_text: readonly { plain_text: string }[] };
  readonly bulleted_list_item?: { rich_text: readonly { plain_text: string }[] };
  readonly numbered_list_item?: { rich_text: readonly { plain_text: string }[] };
  readonly code?: { rich_text: readonly { plain_text: string }[]; language: string };
  readonly toggle?: { rich_text: readonly { plain_text: string }[] };
}

interface NotionSearchResponse {
  readonly results: readonly NotionPage[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

interface NotionBlocksResponse {
  readonly results: readonly NotionBlock[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

// ── Constants ────────────────────────────────────────────

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_RESULTS = 100;

// ── Notion Connector ────────────────────────────────────

export class NotionConnector implements Connector {
  readonly type: ConnectorType = "notion";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];
  private lastSync: number | undefined;

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    if (!this.config) return false;

    const apiKey = this.config.credentials["apiKey"] ?? this.config.credentials["token"];
    if (!apiKey) return false;

    try {
      const response = await this.notionRequest("GET", "/users/me");
      if (response.ok) {
        this.connected = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.documents = [];
  }

  async discover(): Promise<readonly ConnectorDocument[]> {
    if (!this.connected) return [];

    try {
      const pages = await this.searchPages("");
      return pages.map((page) => pageToDocument(page));
    } catch {
      return this.documents;
    }
  }

  async fetch(documentId: string): Promise<ConnectorDocument | null> {
    if (!this.connected) return null;

    try {
      // Fetch page metadata
      const pageResponse = await this.notionRequest("GET", `/pages/${documentId}`);
      if (!pageResponse.ok) return null;

      const page = (await pageResponse.json()) as NotionPage;
      const content = await this.fetchPageContent(documentId);
      const title = extractPageTitle(page);

      return {
        id: page.id,
        title,
        content,
        url: page.url,
        source: "notion",
        updatedAt: new Date(page.last_edited_time).getTime(),
        metadata: {
          createdTime: page.created_time,
        },
      };
    } catch {
      return null;
    }
  }

  async search(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    if (!this.connected) return [];

    try {
      const pages = await this.searchPages(query, limit);
      return pages.map((page) => pageToDocument(page));
    } catch {
      return [];
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.connected) return { added: 0, updated: 0, removed: 0 };

    const result = { added: 0, updated: 0, removed: 0 };

    try {
      const pages = await this.searchPages("");
      const newDocs = pages.map((page) => pageToDocument(page));
      const existingIds = new Set(this.documents.map((d) => d.id));
      const newIds = new Set(newDocs.map((d) => d.id));

      for (const doc of newDocs) {
        if (!existingIds.has(doc.id)) {
          result.added++;
        } else {
          result.updated++;
        }
      }

      for (const existing of this.documents) {
        if (!newIds.has(existing.id)) {
          result.removed++;
        }
      }

      this.documents = [...newDocs];
      this.lastSync = Date.now();
    } catch {
      // Sync failed — status reflects last successful sync
    }

    return result;
  }

  getStatus(): ConnectorStatus {
    return {
      id: this.config?.id ?? "notion",
      type: "notion",
      connected: this.connected,
      lastSync: this.lastSync,
      documentCount: this.documents.length,
    };
  }

  // ── Private ────────────────────────────────────────────

  private getApiKey(): string {
    return this.config?.credentials["apiKey"] ?? this.config?.credentials["token"] ?? "";
  }

  private async notionRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const url = `${NOTION_API_BASE}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    return guardedFetch(url, options);
  }

  private async searchPages(
    query: string,
    limit: number = MAX_RESULTS,
  ): Promise<readonly NotionPage[]> {
    const allPages: NotionPage[] = [];
    let cursor: string | null = null;

    do {
      const body: Record<string, unknown> = {
        filter: { property: "object", value: "page" },
        page_size: Math.min(limit - allPages.length, 100),
      };
      if (query) body["query"] = query;
      if (cursor) body["start_cursor"] = cursor;

      const response = await this.notionRequest("POST", "/search", body);
      if (!response.ok) break;

      const data = (await response.json()) as NotionSearchResponse;
      allPages.push(...data.results);
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor && allPages.length < limit);

    return allPages;
  }

  private async fetchPageContent(pageId: string): Promise<string> {
    const allBlocks: NotionBlock[] = [];
    let cursor: string | null = null;

    do {
      const path = cursor
        ? `/blocks/${pageId}/children?start_cursor=${cursor}&page_size=100`
        : `/blocks/${pageId}/children?page_size=100`;

      const response = await this.notionRequest("GET", path);
      if (!response.ok) break;

      const data = (await response.json()) as NotionBlocksResponse;
      allBlocks.push(...data.results);
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);

    return allBlocks
      .map((block) => blockToText(block))
      .filter(Boolean)
      .join("\n");
  }
}

// ── Helpers ──────────────────────────────────────────────

function extractPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

function pageToDocument(page: NotionPage): ConnectorDocument {
  return {
    id: page.id,
    title: extractPageTitle(page),
    content: "",
    url: page.url,
    source: "notion",
    updatedAt: new Date(page.last_edited_time).getTime(),
    metadata: {
      createdTime: page.created_time,
    },
  };
}

function blockToText(block: NotionBlock): string {
  const richTextBlock =
    block.paragraph ??
    block.heading_1 ??
    block.heading_2 ??
    block.heading_3 ??
    block.bulleted_list_item ??
    block.numbered_list_item ??
    block.toggle;

  if (richTextBlock) {
    const text = richTextBlock.rich_text.map((t) => t.plain_text).join("");
    if (block.type === "heading_1") return `# ${text}`;
    if (block.type === "heading_2") return `## ${text}`;
    if (block.type === "heading_3") return `### ${text}`;
    if (block.type === "bulleted_list_item") return `- ${text}`;
    if (block.type === "numbered_list_item") return `1. ${text}`;
    return text;
  }

  if (block.code) {
    const text = block.code.rich_text.map((t) => t.plain_text).join("");
    return `\`\`\`${block.code.language}\n${text}\n\`\`\``;
  }

  return "";
}
