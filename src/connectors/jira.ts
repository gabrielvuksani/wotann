/**
 * Jira Connector — ingest issues, projects, and boards from Jira Cloud.
 *
 * Uses the Jira REST API v3 for listing, fetching, and searching.
 * Converts Jira issues to plain text documents.
 * Supports JQL for advanced searching.
 *
 * SECURITY: API token + email stored in ConnectorConfig credentials.
 * Uses Basic Auth (base64-encoded email:token). Never logs credentials.
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

interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly self: string;
  readonly fields: JiraIssueFields;
}

interface JiraIssueFields {
  readonly summary: string;
  readonly description: string | null;
  readonly status: { readonly name: string };
  readonly priority: { readonly name: string } | null;
  readonly issuetype: { readonly name: string };
  readonly assignee: { readonly displayName: string } | null;
  readonly reporter: { readonly displayName: string } | null;
  readonly created: string;
  readonly updated: string;
  readonly labels: readonly string[];
  readonly project: { readonly key: string; readonly name: string };
}

interface JiraSearchResponse {
  readonly issues: readonly JiraIssue[];
  readonly total: number;
  readonly startAt: number;
  readonly maxResults: number;
}

// ── Constants ────────────────────────────────────────────

const MAX_RESULTS = 50;

// ── Jira Connector ──────────────────────────────────────

export class JiraConnector implements Connector {
  readonly type: ConnectorType = "jira";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];
  private lastSync: number | undefined;

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    if (!this.config) return false;

    const domain = this.config.credentials["domain"];
    const auth = this.getAuthHeader();
    if (!domain || !auth) return false;

    try {
      const response = await this.jiraRequest("GET", "/rest/api/3/myself");
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
      const issues = await this.searchIssues("order by updated DESC");
      return issues.map((issue) => issueToDocument(issue, this.getDomain()));
    } catch {
      return this.documents;
    }
  }

  async fetch(documentId: string): Promise<ConnectorDocument | null> {
    if (!this.connected) return null;

    try {
      const response = await this.jiraRequest("GET", `/rest/api/3/issue/${documentId}`);
      if (!response.ok) return null;

      const issue = (await response.json()) as JiraIssue;
      return issueToDocument(issue, this.getDomain());
    } catch {
      return null;
    }
  }

  async search(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    if (!this.connected) return [];

    try {
      const jql = `text ~ "${escapeJql(query)}" order by updated DESC`;
      const issues = await this.searchIssues(jql, limit);
      return issues.map((issue) => issueToDocument(issue, this.getDomain()));
    } catch {
      return [];
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.connected) return { added: 0, updated: 0, removed: 0 };

    const result = { added: 0, updated: 0, removed: 0 };

    try {
      const jql = this.lastSync
        ? `updated >= "${formatJiraDate(this.lastSync)}" order by updated DESC`
        : "order by updated DESC";

      const issues = await this.searchIssues(jql);
      const newDocs = issues.map((issue) => issueToDocument(issue, this.getDomain()));
      const existingIds = new Set(this.documents.map((d) => d.id));

      for (const doc of newDocs) {
        if (!existingIds.has(doc.id)) {
          result.added++;
          this.documents.push(doc);
        } else {
          result.updated++;
          const idx = this.documents.findIndex((d) => d.id === doc.id);
          if (idx >= 0) {
            this.documents = [
              ...this.documents.slice(0, idx),
              doc,
              ...this.documents.slice(idx + 1),
            ];
          }
        }
      }

      this.lastSync = Date.now();
    } catch {
      // Sync failed — status reflects last successful sync
    }

    return result;
  }

  getStatus(): ConnectorStatus {
    return {
      id: this.config?.id ?? "jira",
      type: "jira",
      connected: this.connected,
      lastSync: this.lastSync,
      documentCount: this.documents.length,
    };
  }

  // ── Private ────────────────────────────────────────────

  private getDomain(): string {
    return this.config?.credentials["domain"] ?? "";
  }

  private getAuthHeader(): string | null {
    const email = this.config?.credentials["email"];
    const token = this.config?.credentials["apiToken"] ?? this.config?.credentials["token"];

    if (!email || !token) return null;
    return `Basic ${btoa(`${email}:${token}`)}`;
  }

  private async jiraRequest(method: string, path: string): Promise<Response> {
    const domain = this.getDomain();
    const auth = this.getAuthHeader();
    if (!domain || !auth) {
      throw new Error("Jira connector not configured: missing domain or credentials");
    }

    const url = `https://${domain}.atlassian.net${path}`;
    return guardedFetch(url, {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  }

  private async searchIssues(
    jql: string,
    limit: number = MAX_RESULTS,
  ): Promise<readonly JiraIssue[]> {
    const allIssues: JiraIssue[] = [];
    let startAt = 0;

    do {
      const params = new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: String(Math.min(limit - allIssues.length, MAX_RESULTS)),
        fields:
          "summary,description,status,priority,issuetype,assignee,reporter,created,updated,labels,project",
      });

      const response = await this.jiraRequest("GET", `/rest/api/3/search?${params.toString()}`);
      if (!response.ok) break;

      const data = (await response.json()) as JiraSearchResponse;
      allIssues.push(...data.issues);

      if (allIssues.length >= data.total) break;
      startAt += data.maxResults;
    } while (allIssues.length < limit);

    return allIssues;
  }
}

// ── Helpers ──────────────────────────────────────────────

function issueToDocument(issue: JiraIssue, domain: string): ConnectorDocument {
  const fields = issue.fields;
  const content = [
    `# ${issue.key}: ${fields.summary}`,
    "",
    `**Status**: ${fields.status.name}`,
    `**Type**: ${fields.issuetype.name}`,
    fields.priority ? `**Priority**: ${fields.priority.name}` : null,
    fields.assignee ? `**Assignee**: ${fields.assignee.displayName}` : null,
    fields.reporter ? `**Reporter**: ${fields.reporter.displayName}` : null,
    fields.labels.length > 0 ? `**Labels**: ${fields.labels.join(", ")}` : null,
    "",
    fields.description ?? "[No description]",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    id: issue.id,
    title: `${issue.key}: ${fields.summary}`,
    content,
    url: `https://${domain}.atlassian.net/browse/${issue.key}`,
    source: "jira",
    updatedAt: new Date(fields.updated).getTime(),
    metadata: {
      key: issue.key,
      status: fields.status.name,
      type: fields.issuetype.name,
      project: fields.project.key,
      priority: fields.priority?.name,
    },
  };
}

function escapeJql(text: string): string {
  return text.replace(/[\\/"']/g, "\\$&");
}

function formatJiraDate(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
