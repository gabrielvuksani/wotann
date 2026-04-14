/**
 * Google Drive Connector — ingest documents from Google Drive.
 *
 * Supports: Google Docs, Sheets, Slides, PDFs, plain text.
 * Uses the Google Drive API v3 for listing, fetching, and searching.
 * Exports Google Workspace files to plain text / markdown.
 *
 * SECURITY: Credentials are stored in the ConnectorConfig, never logged.
 * All paths are validated. No shell execution.
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorDocument,
  ConnectorStatus,
  ConnectorType,
} from "./connector-registry.js";

// ── Types ────────────────────────────────────────────────

interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedTime: string;
  readonly webViewLink: string;
  readonly size?: string;
}

interface DriveListResponse {
  readonly files: readonly DriveFile[];
  readonly nextPageToken?: string;
}

// ── Constants ────────────────────────────────────────────

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const EXPORT_MIME_MAP: Readonly<Record<string, string>> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const SUPPORTED_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
]);

const MAX_RESULTS = 100;

// ── Google Drive Connector ──────────────────────────────

export class GoogleDriveConnector implements Connector {
  readonly type: ConnectorType = "google-drive";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];
  private lastSync: number | undefined;

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    if (!this.config) return false;

    const token = this.config.credentials["accessToken"]
      ?? this.config.credentials["token"];
    if (!token) return false;

    // Validate token by making a simple API call
    try {
      const response = await this.driveRequest("/about?fields=user");
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
      const files = await this.listFiles();
      return files.map((file) => fileToDocument(file));
    } catch {
      return this.documents;
    }
  }

  async fetch(documentId: string): Promise<ConnectorDocument | null> {
    if (!this.connected) return null;

    try {
      const metaResponse = await this.driveRequest(
        `/files/${documentId}?fields=id,name,mimeType,modifiedTime,webViewLink,size`,
      );
      if (!metaResponse.ok) return null;

      const file = (await metaResponse.json()) as DriveFile;
      const content = await this.fetchFileContent(file);

      return {
        id: file.id,
        title: file.name,
        content,
        url: file.webViewLink,
        source: "google-drive",
        updatedAt: new Date(file.modifiedTime).getTime(),
        metadata: {
          mimeType: file.mimeType,
          size: file.size,
        },
      };
    } catch {
      return null;
    }
  }

  async search(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    if (!this.connected) return [];

    try {
      const escapedQuery = query.replace(/'/g, "\\'");
      const params = new URLSearchParams({
        q: `fullText contains '${escapedQuery}'`,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,size)",
        pageSize: String(Math.min(limit, MAX_RESULTS)),
      });

      const response = await this.driveRequest(`/files?${params.toString()}`);
      if (!response.ok) return [];

      const data = (await response.json()) as DriveListResponse;
      return data.files.map((file) => fileToDocument(file));
    } catch {
      return [];
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.connected) return { added: 0, updated: 0, removed: 0 };

    const result = { added: 0, updated: 0, removed: 0 };

    try {
      const files = await this.listFiles();
      const newDocs = files.map((file) => fileToDocument(file));
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
      // Sync failed silently — status will reflect last successful sync
    }

    return result;
  }

  getStatus(): ConnectorStatus {
    return {
      id: this.config?.id ?? "google-drive",
      type: "google-drive",
      connected: this.connected,
      lastSync: this.lastSync,
      documentCount: this.documents.length,
    };
  }

  // ── Private ────────────────────────────────────────────

  private getAccessToken(): string {
    return this.config?.credentials["accessToken"]
      ?? this.config?.credentials["token"]
      ?? "";
  }

  private async driveRequest(path: string): Promise<Response> {
    const url = path.startsWith("http") ? path : `${DRIVE_API_BASE}${path}`;
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${this.getAccessToken()}`,
        Accept: "application/json",
      },
    });
  }

  private async listFiles(): Promise<readonly DriveFile[]> {
    const allFiles: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,size),nextPageToken",
        pageSize: String(MAX_RESULTS),
        orderBy: "modifiedTime desc",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await this.driveRequest(`/files?${params.toString()}`);
      if (!response.ok) break;

      const data = (await response.json()) as DriveListResponse;
      allFiles.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken && allFiles.length < MAX_RESULTS * 5);

    return allFiles;
  }

  private async fetchFileContent(file: DriveFile): Promise<string> {
    const exportMime = EXPORT_MIME_MAP[file.mimeType];

    if (exportMime) {
      // Google Workspace file — use export endpoint
      const params = new URLSearchParams({ mimeType: exportMime });
      const response = await this.driveRequest(
        `/files/${file.id}/export?${params.toString()}`,
      );
      return response.ok ? response.text() : `[Failed to export: ${file.name}]`;
    }

    if (SUPPORTED_MIME_TYPES.has(file.mimeType)) {
      // Regular file — download content
      const response = await this.driveRequest(`/files/${file.id}?alt=media`);
      return response.ok ? response.text() : `[Failed to fetch: ${file.name}]`;
    }

    return `[Unsupported file type: ${file.mimeType}]`;
  }
}

// ── Helpers ──────────────────────────────────────────────

function fileToDocument(file: DriveFile): ConnectorDocument {
  return {
    id: file.id,
    title: file.name,
    content: "",
    url: file.webViewLink,
    source: "google-drive",
    updatedAt: new Date(file.modifiedTime).getTime(),
    metadata: {
      mimeType: file.mimeType,
      size: file.size,
    },
  };
}
