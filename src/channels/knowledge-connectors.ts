/**
 * Knowledge source connectors for non-messaging data sources.
 * Inspired by Onyx's connector architecture.
 *
 * Each connector uses globalThis.fetch() against the provider's REST API.
 * No external SDKs required — only native fetch + env var credentials.
 */

// ── Types ──────────────────────────────────────────────────

export interface KnowledgeDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
  readonly url?: string;
  readonly lastModified?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SearchResult {
  readonly document: KnowledgeDocument;
  readonly score: number;
  readonly snippet: string;
}

export interface ConnectorConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly workspace?: string;
  readonly additionalConfig?: Readonly<Record<string, string>>;
}

export type ConnectorType = "google-drive" | "notion" | "confluence" | "jira";

export interface KnowledgeConnector {
  readonly id: string;
  readonly type: ConnectorType;
  readonly name: string;

  connect(config: ConnectorConfig): Promise<void>;
  search(query: string, limit?: number): Promise<readonly SearchResult[]>;
  ingest(): Promise<readonly KnowledgeDocument[]>;
  isConnected(): boolean;
}

// ── Connector Registry ─────────────────────────────────────

export class KnowledgeConnectorRegistry {
  private readonly connectors: Map<string, KnowledgeConnector> = new Map();

  register(connector: KnowledgeConnector): void {
    this.connectors.set(connector.id, connector);
  }

  unregister(id: string): void {
    this.connectors.delete(id);
  }

  getConnector(id: string): KnowledgeConnector | undefined {
    return this.connectors.get(id);
  }

  getConnectorsByType(type: ConnectorType): readonly KnowledgeConnector[] {
    return [...this.connectors.values()].filter((c) => c.type === type);
  }

  getAllConnectors(): readonly KnowledgeConnector[] {
    return [...this.connectors.values()];
  }

  getConnectedConnectors(): readonly KnowledgeConnector[] {
    return [...this.connectors.values()].filter((c) => c.isConnected());
  }

  getConnectorCount(): number {
    return this.connectors.size;
  }

  /**
   * Search across all connected connectors.
   */
  async searchAll(query: string, limit: number = 10): Promise<readonly SearchResult[]> {
    const connected = this.getConnectedConnectors();
    if (connected.length === 0) return [];

    const allResults: SearchResult[] = [];

    for (const connector of connected) {
      try {
        const results = await connector.search(query, limit);
        allResults.push(...results);
      } catch {
        // Skip failed connectors gracefully
      }
    }

    return allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// ── Connector Configuration Metadata ──────────────────────────

interface ConnectorSetupInfo {
  readonly envVars: readonly { readonly name: string; readonly description: string }[];
  readonly docsUrl: string;
  readonly apiEndpoint: string;
  readonly npmPackage: string;
}

const CONNECTOR_SETUP: Readonly<Record<ConnectorType, ConnectorSetupInfo>> = {
  "google-drive": {
    envVars: [
      { name: "GOOGLE_DRIVE_API_KEY", description: "Google Cloud API key with Drive API enabled" },
    ],
    docsUrl: "https://developers.google.com/drive/api/quickstart/nodejs",
    apiEndpoint: "https://www.googleapis.com/drive/v3/files",
    npmPackage: "googleapis",
  },
  "notion": {
    envVars: [
      { name: "NOTION_API_KEY", description: "Notion integration token (starts with secret_)" },
    ],
    docsUrl: "https://developers.notion.com/docs/create-a-notion-integration",
    apiEndpoint: "https://api.notion.com/v1/search",
    npmPackage: "@notionhq/client",
  },
  "confluence": {
    envVars: [
      { name: "CONFLUENCE_API_TOKEN", description: "Atlassian API token for authentication" },
      { name: "CONFLUENCE_BASE_URL", description: "Atlassian site URL (e.g., https://yourcompany.atlassian.net/wiki)" },
      { name: "CONFLUENCE_EMAIL", description: "Atlassian account email for Basic auth" },
    ],
    docsUrl: "https://developer.atlassian.com/cloud/confluence/rest/v2/intro/",
    apiEndpoint: "/rest/api/content/search",
    npmPackage: "confluence.js",
  },
  "jira": {
    envVars: [
      { name: "JIRA_API_TOKEN", description: "Atlassian API token for authentication" },
      { name: "JIRA_BASE_URL", description: "Atlassian site URL (e.g., https://yourcompany.atlassian.net)" },
      { name: "JIRA_EMAIL", description: "Atlassian account email for Basic auth" },
    ],
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
    apiEndpoint: "/rest/api/3/search",
    npmPackage: "jira.js",
  },
};

// ── Shared Utilities ──────────────────────────────────────

/** Escape quotes and control characters to prevent query injection. */
function sanitizeQuery(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .trim()
    .slice(0, 500);
}

/** Build Atlassian Basic auth header from email + API token. */
function atlassianAuthHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

// ── Base Connector ─────────────────────────────────────────

abstract class BaseConnector implements KnowledgeConnector {
  abstract readonly id: string;
  abstract readonly type: ConnectorType;
  abstract readonly name: string;

  protected connected = false;
  protected config: ConnectorConfig = {};

  abstract connect(config: ConnectorConfig): Promise<void>;

  async search(_query: string, _limit?: number): Promise<readonly SearchResult[]> {
    this.requireConnection();
    return [];
  }

  async ingest(): Promise<readonly KnowledgeDocument[]> {
    this.requireConnection();
    return [];
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check whether all required env vars for this connector are present.
   */
  isConfigured(): boolean {
    const setup = CONNECTOR_SETUP[this.type];
    return setup.envVars.every((v) => Boolean(process.env[v.name]));
  }

  /**
   * Return a structured setup guide when the connector is not configured.
   */
  getSetupInstructions(): string {
    const setup = CONNECTOR_SETUP[this.type];
    const lines: string[] = [
      `${this.name} Connector — Setup Required`,
      "",
      "Missing environment variables:",
    ];

    for (const envVar of setup.envVars) {
      const isSet = Boolean(process.env[envVar.name]);
      lines.push(`  ${isSet ? "[ok]" : "[missing]"} ${envVar.name} — ${envVar.description}`);
    }

    lines.push(
      "",
      `Documentation: ${setup.docsUrl}`,
      `API endpoint:  ${setup.apiEndpoint}`,
      `NPM package:   ${setup.npmPackage}`,
      "",
      "Once env vars are set, call connector.connect({}) to activate.",
    );

    return lines.join("\n");
  }

  protected requireConnection(): void {
    if (!this.connected) {
      throw new Error(`${this.name} connector is not connected. Call connect() first.`);
    }
  }

  protected requireEnvVar(envVar: string, description: string): string {
    const value = process.env[envVar];
    if (!value) {
      throw new Error(
        `${envVar} not set. ${description}\n`
        + `See: ${CONNECTOR_SETUP[this.type].docsUrl}`,
      );
    }
    return value;
  }

  protected buildNotConfiguredResults(query: string): readonly SearchResult[] {
    const setup = CONNECTOR_SETUP[this.type];
    const missingVars = setup.envVars
      .filter((v) => !process.env[v.name])
      .map((v) => v.name);

    return [{
      document: {
        id: `setup-${this.type}-${Date.now()}`,
        title: `${this.name} — Not Configured`,
        content: [
          `The ${this.name} connector requires API credentials to search.`,
          "",
          `Missing env vars: ${missingVars.join(", ")}`,
          "",
          `Setup guide: ${setup.docsUrl}`,
          `NPM package: npm install ${setup.npmPackage}`,
        ].join("\n"),
        source: this.type,
        url: setup.docsUrl,
      },
      score: 0,
      snippet: `${this.name} not configured. Set ${missingVars.join(", ")} and reconnect. Query was: "${query}"`,
    }];
  }
}

// ── Google Drive Connector ─────────────────────────────────

export class GoogleDriveConnector extends BaseConnector {
  readonly id = "google-drive";
  readonly type: ConnectorType = "google-drive";
  readonly name = "Google Drive";

  async connect(config: ConnectorConfig): Promise<void> {
    const apiKey = config.apiKey
      ?? this.requireEnvVar(
        "GOOGLE_DRIVE_API_KEY",
        "Create credentials at https://console.cloud.google.com",
      );

    this.config = { ...config, apiKey };
    this.connected = true;
  }

  async search(query: string, limit: number = 10): Promise<readonly SearchResult[]> {
    this.requireConnection();

    if (!this.isConfigured()) {
      return this.buildNotConfiguredResults(query);
    }

    try {
      const apiKey = this.config.apiKey ?? "";
      const safe = sanitizeQuery(query);
      const q = encodeURIComponent(`fullText contains '${safe}'`);
      const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink)");
      const url =
        `https://www.googleapis.com/drive/v3/files?q=${q}&key=${apiKey}&fields=${fields}&pageSize=${limit}`;

      const response = await globalThis.fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as {
        readonly files?: readonly {
          readonly id?: string;
          readonly name?: string;
          readonly mimeType?: string;
          readonly modifiedTime?: string;
          readonly webViewLink?: string;
        }[];
      };

      return (data.files ?? []).map((file, index) => ({
        document: {
          id: file.id ?? `gdrive-${Date.now()}-${index}`,
          title: file.name ?? "Untitled",
          content: "",
          source: "google-drive" as const,
          url: file.webViewLink,
          lastModified: file.modifiedTime,
          metadata: { mimeType: file.mimeType ?? "unknown" },
        },
        score: 1 - index * 0.05,
        snippet: `${file.name ?? "Untitled"} (${file.mimeType ?? "unknown"})`,
      }));
    } catch {
      return [];
    }
  }

  async ingest(): Promise<readonly KnowledgeDocument[]> {
    this.requireConnection();

    if (!this.isConfigured()) return [];

    try {
      const apiKey = this.config.apiKey ?? "";
      const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,webViewLink)");
      const url =
        `https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime+desc&pageSize=50&key=${apiKey}&fields=${fields}`;

      const listResponse = await globalThis.fetch(url);
      if (!listResponse.ok) return [];

      const listData = (await listResponse.json()) as {
        readonly files?: readonly {
          readonly id?: string;
          readonly name?: string;
          readonly mimeType?: string;
          readonly modifiedTime?: string;
          readonly webViewLink?: string;
        }[];
      };

      const files = listData.files ?? [];
      const documents: KnowledgeDocument[] = [];

      for (const file of files) {
        const fileId = file.id ?? "";
        const mimeType = file.mimeType ?? "";

        let content = "";
        try {
          if (mimeType.startsWith("application/vnd.google-apps.")) {
            // Google Docs/Sheets/Slides: export as plain text
            const exportUrl =
              `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${apiKey}`;
            const exportRes = await globalThis.fetch(exportUrl);
            if (exportRes.ok) {
              content = await exportRes.text();
            }
          } else {
            // Binary files: use download endpoint
            const dlUrl =
              `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
            const dlRes = await globalThis.fetch(dlUrl);
            if (dlRes.ok) {
              content = await dlRes.text();
            }
          }
        } catch {
          // Skip files that fail to download
        }

        documents.push({
          id: fileId,
          title: file.name ?? "Untitled",
          content,
          source: "google-drive",
          url: file.webViewLink,
          lastModified: file.modifiedTime,
          metadata: { mimeType },
        });
      }

      return documents;
    } catch {
      return [];
    }
  }
}

// ── Notion Connector ───────────────────────────────────────

export class NotionConnector extends BaseConnector {
  readonly id = "notion";
  readonly type: ConnectorType = "notion";
  readonly name = "Notion";

  async connect(config: ConnectorConfig): Promise<void> {
    const apiKey = config.apiKey
      ?? this.requireEnvVar(
        "NOTION_API_KEY",
        "Create an integration at https://www.notion.so/my-integrations",
      );

    this.config = { ...config, apiKey };
    this.connected = true;
  }

  async search(query: string, limit: number = 10): Promise<readonly SearchResult[]> {
    this.requireConnection();

    if (!this.isConfigured()) {
      return this.buildNotConfiguredResults(query);
    }

    try {
      const apiKey = this.config.apiKey ?? "";
      const safe = sanitizeQuery(query);

      const response = await globalThis.fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: safe, page_size: limit }),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        readonly results?: readonly {
          readonly id?: string;
          readonly object?: string;
          readonly url?: string;
          readonly last_edited_time?: string;
          readonly properties?: {
            readonly title?: {
              readonly title?: readonly { readonly plain_text?: string }[];
            };
            readonly Name?: {
              readonly title?: readonly { readonly plain_text?: string }[];
            };
          };
        }[];
      };

      return (data.results ?? [])
        .filter((r) => r.object === "page")
        .map((page, index) => {
          const titleProp = page.properties?.title ?? page.properties?.Name;
          const titleText = titleProp?.title
            ?.map((t) => t.plain_text ?? "")
            .join("") ?? "Untitled";

          return {
            document: {
              id: page.id ?? `notion-${Date.now()}-${index}`,
              title: titleText,
              content: "",
              source: "notion" as const,
              url: page.url,
              lastModified: page.last_edited_time,
            },
            score: 1 - index * 0.05,
            snippet: titleText,
          };
        });
    } catch {
      return [];
    }
  }

  async ingest(): Promise<readonly KnowledgeDocument[]> {
    this.requireConnection();

    if (!this.isConfigured()) return [];

    try {
      const apiKey = this.config.apiKey ?? "";
      const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      };

      // List all pages via search with empty query
      const listResponse = await globalThis.fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers,
        body: JSON.stringify({ page_size: 50 }),
      });

      if (!listResponse.ok) return [];

      const listData = (await listResponse.json()) as {
        readonly results?: readonly {
          readonly id?: string;
          readonly object?: string;
          readonly url?: string;
          readonly last_edited_time?: string;
          readonly properties?: {
            readonly title?: {
              readonly title?: readonly { readonly plain_text?: string }[];
            };
            readonly Name?: {
              readonly title?: readonly { readonly plain_text?: string }[];
            };
          };
        }[];
      };

      const pages = (listData.results ?? []).filter((r) => r.object === "page");
      const documents: KnowledgeDocument[] = [];

      for (const page of pages) {
        const pageId = page.id ?? "";
        const titleProp = page.properties?.title ?? page.properties?.Name;
        const title = titleProp?.title
          ?.map((t) => t.plain_text ?? "")
          .join("") ?? "Untitled";

        let content = "";
        try {
          // Fetch block children for content
          const blocksRes = await globalThis.fetch(
            `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
            { headers },
          );
          if (blocksRes.ok) {
            const blocksData = (await blocksRes.json()) as {
              readonly results?: readonly {
                readonly type?: string;
                readonly paragraph?: {
                  readonly rich_text?: readonly { readonly plain_text?: string }[];
                };
                readonly heading_1?: {
                  readonly rich_text?: readonly { readonly plain_text?: string }[];
                };
                readonly heading_2?: {
                  readonly rich_text?: readonly { readonly plain_text?: string }[];
                };
                readonly heading_3?: {
                  readonly rich_text?: readonly { readonly plain_text?: string }[];
                };
                readonly bulleted_list_item?: {
                  readonly rich_text?: readonly { readonly plain_text?: string }[];
                };
                readonly numbered_list_item?: {
                  readonly rich_text?: readonly { readonly plain_text?: string }[];
                };
              }[];
            };

            const textBlocks = (blocksData.results ?? []).map((block) => {
              const blockContent =
                block.paragraph
                ?? block.heading_1
                ?? block.heading_2
                ?? block.heading_3
                ?? block.bulleted_list_item
                ?? block.numbered_list_item;
              return (blockContent?.rich_text ?? [])
                .map((t) => t.plain_text ?? "")
                .join("");
            });

            content = textBlocks.filter(Boolean).join("\n");
          }
        } catch {
          // Skip pages whose blocks fail to fetch
        }

        documents.push({
          id: pageId,
          title,
          content,
          source: "notion",
          url: page.url,
          lastModified: page.last_edited_time,
        });
      }

      return documents;
    } catch {
      return [];
    }
  }
}

// ── Confluence Connector ───────────────────────────────────

export class ConfluenceConnector extends BaseConnector {
  readonly id = "confluence";
  readonly type: ConnectorType = "confluence";
  readonly name = "Confluence";

  async connect(config: ConnectorConfig): Promise<void> {
    const apiKey = config.apiKey
      ?? this.requireEnvVar(
        "CONFLUENCE_API_TOKEN",
        "Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens",
      );

    const baseUrl = config.baseUrl
      ?? process.env["CONFLUENCE_BASE_URL"]
      ?? "";

    if (!baseUrl) {
      throw new Error(
        "CONFLUENCE_BASE_URL required. Set to your Atlassian site URL "
        + "(e.g., https://yourcompany.atlassian.net/wiki)\n"
        + `See: ${CONNECTOR_SETUP.confluence.docsUrl}`,
      );
    }

    const email = config.additionalConfig?.["email"]
      ?? process.env["CONFLUENCE_EMAIL"]
      ?? "";

    this.config = {
      ...config,
      apiKey,
      baseUrl,
      additionalConfig: { ...config.additionalConfig, email },
    };
    this.connected = true;
  }

  private getAuthHeader(): string {
    const email = this.config.additionalConfig?.["email"] ?? "";
    const apiToken = this.config.apiKey ?? "";
    return atlassianAuthHeader(email, apiToken);
  }

  async search(query: string, limit: number = 10): Promise<readonly SearchResult[]> {
    this.requireConnection();

    if (!this.isConfigured()) {
      return this.buildNotConfiguredResults(query);
    }

    try {
      const baseUrl = this.config.baseUrl ?? "";
      const safe = sanitizeQuery(query);
      const cql = encodeURIComponent(`text~"${safe}"`);
      const url = `${baseUrl}/rest/api/content/search?cql=${cql}&limit=${limit}&expand=body.storage`;

      const response = await globalThis.fetch(url, {
        headers: {
          "Authorization": this.getAuthHeader(),
          "Accept": "application/json",
        },
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        readonly results?: readonly {
          readonly id?: string;
          readonly title?: string;
          readonly type?: string;
          readonly status?: string;
          readonly body?: {
            readonly storage?: { readonly value?: string };
          };
          readonly _links?: {
            readonly webui?: string;
          };
        }[];
      };

      return (data.results ?? []).map((item, index) => {
        const rawHtml = item.body?.storage?.value ?? "";
        // Strip HTML tags for a plain-text snippet
        const plainText = rawHtml.replace(/<[^>]*>/g, "").slice(0, 300);

        return {
          document: {
            id: item.id ?? `confluence-${Date.now()}-${index}`,
            title: item.title ?? "Untitled",
            content: plainText,
            source: "confluence" as const,
            url: item._links?.webui
              ? `${baseUrl}${item._links.webui}`
              : undefined,
            metadata: {
              type: item.type ?? "unknown",
              status: item.status ?? "unknown",
            },
          },
          score: 1 - index * 0.05,
          snippet: plainText.slice(0, 200),
        };
      });
    } catch {
      return [];
    }
  }

  async ingest(): Promise<readonly KnowledgeDocument[]> {
    this.requireConnection();

    if (!this.isConfigured()) return [];

    try {
      const baseUrl = this.config.baseUrl ?? "";
      const url = `${baseUrl}/rest/api/content?type=page&limit=50&expand=body.storage`;

      const response = await globalThis.fetch(url, {
        headers: {
          "Authorization": this.getAuthHeader(),
          "Accept": "application/json",
        },
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        readonly results?: readonly {
          readonly id?: string;
          readonly title?: string;
          readonly type?: string;
          readonly _links?: { readonly webui?: string };
          readonly body?: {
            readonly storage?: { readonly value?: string };
          };
        }[];
      };

      return (data.results ?? []).map((item, index) => {
        const rawHtml = item.body?.storage?.value ?? "";
        const plainText = rawHtml.replace(/<[^>]*>/g, "");

        return {
          id: item.id ?? `confluence-${Date.now()}-${index}`,
          title: item.title ?? "Untitled",
          content: plainText,
          source: "confluence" as const,
          url: item._links?.webui
            ? `${baseUrl}${item._links.webui}`
            : undefined,
          metadata: {
            type: item.type ?? "page",
          },
        };
      });
    } catch {
      return [];
    }
  }
}

// ── Jira Connector ─────────────────────────────────────────

export class JiraConnector extends BaseConnector {
  readonly id = "jira";
  readonly type: ConnectorType = "jira";
  readonly name = "Jira";

  async connect(config: ConnectorConfig): Promise<void> {
    const apiKey = config.apiKey
      ?? this.requireEnvVar(
        "JIRA_API_TOKEN",
        "Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens",
      );

    const baseUrl = config.baseUrl
      ?? process.env["JIRA_BASE_URL"]
      ?? "";

    if (!baseUrl) {
      throw new Error(
        "JIRA_BASE_URL required. Set to your Atlassian site URL "
        + "(e.g., https://yourcompany.atlassian.net)\n"
        + `See: ${CONNECTOR_SETUP.jira.docsUrl}`,
      );
    }

    const email = config.additionalConfig?.["email"]
      ?? process.env["JIRA_EMAIL"]
      ?? "";

    this.config = {
      ...config,
      apiKey,
      baseUrl,
      additionalConfig: { ...config.additionalConfig, email },
    };
    this.connected = true;
  }

  private getAuthHeader(): string {
    const email = this.config.additionalConfig?.["email"] ?? "";
    const apiToken = this.config.apiKey ?? "";
    return atlassianAuthHeader(email, apiToken);
  }

  async search(query: string, limit: number = 10): Promise<readonly SearchResult[]> {
    this.requireConnection();

    if (!this.isConfigured()) {
      return this.buildNotConfiguredResults(query);
    }

    try {
      const baseUrl = this.config.baseUrl ?? "";
      const safe = sanitizeQuery(query);
      const jql = encodeURIComponent(`text~"${safe}"`);
      const url = `${baseUrl}/rest/api/3/search?jql=${jql}&maxResults=${limit}&fields=summary,description,status,updated`;

      const response = await globalThis.fetch(url, {
        headers: {
          "Authorization": this.getAuthHeader(),
          "Accept": "application/json",
        },
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        readonly issues?: readonly {
          readonly id?: string;
          readonly key?: string;
          readonly self?: string;
          readonly fields?: {
            readonly summary?: string;
            readonly description?: string | {
              readonly content?: readonly {
                readonly content?: readonly { readonly text?: string }[];
              }[];
            };
            readonly status?: { readonly name?: string };
            readonly updated?: string;
          };
        }[];
      };

      return (data.issues ?? []).map((issue, index) => {
        const summary = issue.fields?.summary ?? "Untitled";
        const rawDesc = issue.fields?.description;
        let description = "";
        if (typeof rawDesc === "string") {
          description = rawDesc;
        } else if (rawDesc && typeof rawDesc === "object") {
          // Atlassian Document Format: extract text nodes
          description = (rawDesc.content ?? [])
            .flatMap((block) => (block.content ?? []).map((c) => c.text ?? ""))
            .join(" ");
        }
        const snippet = `[${issue.key ?? "?"}] ${summary}: ${description.slice(0, 200)}`;

        return {
          document: {
            id: issue.id ?? `jira-${Date.now()}-${index}`,
            title: `${issue.key ?? "?"} — ${summary}`,
            content: description,
            source: "jira" as const,
            url: issue.key
              ? `${baseUrl}/browse/${issue.key}`
              : undefined,
            lastModified: issue.fields?.updated,
            metadata: {
              key: issue.key ?? "",
              status: issue.fields?.status?.name ?? "unknown",
            },
          },
          score: 1 - index * 0.05,
          snippet,
        };
      });
    } catch {
      return [];
    }
  }

  async ingest(): Promise<readonly KnowledgeDocument[]> {
    this.requireConnection();

    if (!this.isConfigured()) return [];

    try {
      const baseUrl = this.config.baseUrl ?? "";
      const jql = encodeURIComponent("updated >= -7d ORDER BY updated DESC");
      const url =
        `${baseUrl}/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,description,status,updated`;

      const response = await globalThis.fetch(url, {
        headers: {
          "Authorization": this.getAuthHeader(),
          "Accept": "application/json",
        },
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        readonly issues?: readonly {
          readonly id?: string;
          readonly key?: string;
          readonly fields?: {
            readonly summary?: string;
            readonly description?: string | {
              readonly content?: readonly {
                readonly content?: readonly { readonly text?: string }[];
              }[];
            };
            readonly status?: { readonly name?: string };
            readonly updated?: string;
          };
        }[];
      };

      return (data.issues ?? []).map((issue, index) => {
        const summary = issue.fields?.summary ?? "Untitled";
        const rawDesc = issue.fields?.description;
        let description = "";
        if (typeof rawDesc === "string") {
          description = rawDesc;
        } else if (rawDesc && typeof rawDesc === "object") {
          description = (rawDesc.content ?? [])
            .flatMap((block) => (block.content ?? []).map((c) => c.text ?? ""))
            .join(" ");
        }

        return {
          id: issue.id ?? `jira-${Date.now()}-${index}`,
          title: `${issue.key ?? "?"} — ${summary}`,
          content: description,
          source: "jira" as const,
          url: issue.key
            ? `${baseUrl}/browse/${issue.key}`
            : undefined,
          lastModified: issue.fields?.updated,
          metadata: {
            key: issue.key ?? "",
            status: issue.fields?.status?.name ?? "unknown",
          },
        };
      });
    } catch {
      return [];
    }
  }
}

// ── Factory ────────────────────────────────────────────────

export function createConnector(type: ConnectorType): KnowledgeConnector {
  switch (type) {
    case "google-drive":
      return new GoogleDriveConnector();
    case "notion":
      return new NotionConnector();
    case "confluence":
      return new ConfluenceConnector();
    case "jira":
      return new JiraConnector();
  }
}

/**
 * Create a registry pre-loaded with all available connector types.
 */
export function createDefaultRegistry(): KnowledgeConnectorRegistry {
  const registry = new KnowledgeConnectorRegistry();
  const types: readonly ConnectorType[] = ["google-drive", "notion", "confluence", "jira"];

  for (const type of types) {
    registry.register(createConnector(type));
  }

  return registry;
}

/**
 * Return setup status for all connectors — which are configured and which need env vars.
 */
export function getConnectorSetupStatus(): readonly { readonly type: ConnectorType; readonly configured: boolean; readonly instructions: string }[] {
  return (Object.keys(CONNECTOR_SETUP) as ConnectorType[]).map((type) => {
    const connector = createConnector(type) as BaseConnector;
    return {
      type,
      configured: connector.isConfigured(),
      instructions: connector.getSetupInstructions(),
    };
  });
}
