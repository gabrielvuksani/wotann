/**
 * Data Connector Registry — plugin system for external data sources.
 * Inspired by Onyx's 40+ connectors for Google Drive, Notion, Jira, etc.
 * Feeds into the knowledge fabric for RAG retrieval.
 */

// ── Types ────────────────────────────────────────────────

export interface ConnectorConfig {
  readonly id: string;
  readonly name: string;
  readonly type: ConnectorType;
  readonly credentials: Readonly<Record<string, string>>;
  readonly syncInterval?: number; // ms between syncs
  readonly enabled: boolean;
}

export type ConnectorType =
  | "github"
  | "notion"
  | "confluence"
  | "jira"
  | "slack"
  | "linear"
  | "google-drive"
  | "google-docs"
  | "dropbox"
  | "figma"
  | "custom";

export interface ConnectorDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly url: string;
  readonly source: ConnectorType;
  readonly updatedAt: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ConnectorStatus {
  readonly id: string;
  readonly type: ConnectorType;
  readonly connected: boolean;
  readonly lastSync?: number;
  readonly documentCount: number;
  readonly error?: string;
}

export interface Connector {
  readonly type: ConnectorType;
  configure(config: ConnectorConfig): void;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  discover(): Promise<readonly ConnectorDocument[]>;
  fetch(documentId: string): Promise<ConnectorDocument | null>;
  search(query: string, limit?: number): Promise<readonly ConnectorDocument[]>;
  sync(): Promise<{ added: number; updated: number; removed: number }>;
  getStatus(): ConnectorStatus;
}

// ── Built-in Connectors ──────────────────────────────────

export class GitHubConnector implements Connector {
  readonly type: ConnectorType = "github";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];

  configure(config: ConnectorConfig): void { this.config = config; }

  async connect(): Promise<boolean> {
    if (!this.config?.credentials["token"]) return false;
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> { this.connected = false; }

  async discover(): Promise<readonly ConnectorDocument[]> {
    return this.documents;
  }

  async fetch(documentId: string): Promise<ConnectorDocument | null> {
    return this.documents.find((d) => d.id === documentId) ?? null;
  }

  async search(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    const lower = query.toLowerCase();
    return this.documents
      .filter((d) => d.title.toLowerCase().includes(lower) || d.content.toLowerCase().includes(lower))
      .slice(0, limit);
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    return { added: 0, updated: 0, removed: 0 };
  }

  getStatus(): ConnectorStatus {
    return {
      id: this.config?.id ?? "github",
      type: "github",
      connected: this.connected,
      documentCount: this.documents.length,
    };
  }
}

// ── Registry ─────────────────────────────────────────────

export class ConnectorRegistry {
  private readonly connectors: Map<string, Connector> = new Map();
  private readonly configs: Map<string, ConnectorConfig> = new Map();

  /**
   * Register a connector implementation.
   */
  register(id: string, connector: Connector, config: ConnectorConfig): void {
    connector.configure(config);
    this.connectors.set(id, connector);
    this.configs.set(id, config);
  }

  /**
   * Connect all enabled connectors.
   */
  async connectAll(): Promise<readonly ConnectorStatus[]> {
    const statuses: ConnectorStatus[] = [];
    for (const [id, connector] of this.connectors) {
      const config = this.configs.get(id);
      if (config?.enabled) {
        await connector.connect();
      }
      statuses.push(connector.getStatus());
    }
    return statuses;
  }

  /**
   * Search across all connected connectors.
   */
  async searchAll(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    const allResults: ConnectorDocument[] = [];
    for (const connector of this.connectors.values()) {
      const status = connector.getStatus();
      if (status.connected) {
        const results = await connector.search(query, limit);
        allResults.push(...results);
      }
    }
    return allResults.slice(0, limit);
  }

  /**
   * Sync all connectors.
   */
  async syncAll(): Promise<Readonly<Record<string, { added: number; updated: number; removed: number }>>> {
    const results: Record<string, { added: number; updated: number; removed: number }> = {};
    for (const [id, connector] of this.connectors) {
      const status = connector.getStatus();
      if (status.connected) {
        results[id] = await connector.sync();
      }
    }
    return results;
  }

  /**
   * Get all connector statuses.
   */
  getStatuses(): readonly ConnectorStatus[] {
    return [...this.connectors.values()].map((c) => c.getStatus());
  }

  /**
   * Get a connector by ID.
   */
  get(id: string): Connector | undefined {
    return this.connectors.get(id);
  }

  /**
   * List all registered connector IDs.
   */
  list(): readonly string[] {
    return [...this.connectors.keys()];
  }
}
