/**
 * Linear Connector — ingest issues, projects, and cycles from Linear.
 *
 * Uses the Linear GraphQL API for listing, fetching, and searching.
 * Converts Linear issues to plain text documents.
 *
 * SECURITY: API key stored in ConnectorConfig credentials, never logged.
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorDocument,
  ConnectorStatus,
  ConnectorType,
} from "./connector-registry.js";

// ── Types ────────────────────────────────────────────────

interface LinearIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly priority: number;
  readonly state: { readonly name: string };
  readonly assignee: { readonly name: string } | null;
  readonly team: { readonly name: string; readonly key: string };
  readonly labels: { readonly nodes: readonly { readonly name: string }[] };
}

interface LinearIssuesResponse {
  readonly data: {
    readonly issues: {
      readonly nodes: readonly LinearIssue[];
      readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly endCursor: string | null;
      };
    };
  };
}

interface LinearSearchResponse {
  readonly data: {
    readonly issueSearch: {
      readonly nodes: readonly LinearIssue[];
      readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly endCursor: string | null;
      };
    };
  };
}

interface LinearIssueResponse {
  readonly data: {
    readonly issue: LinearIssue;
  };
}

interface LinearViewerResponse {
  readonly data: {
    readonly viewer: {
      readonly id: string;
      readonly name: string;
    };
  };
}

// ── Constants ────────────────────────────────────────────

const LINEAR_API_URL = "https://api.linear.app/graphql";
const MAX_RESULTS = 50;

const PRIORITY_LABELS: Readonly<Record<number, string>> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

// ── GraphQL Fragments ────────────────────────────────────

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  createdAt
  updatedAt
  priority
  state { name }
  assignee { name }
  team { name key }
  labels { nodes { name } }
`;

// ── Linear Connector ────────────────────────────────────

export class LinearConnector implements Connector {
  readonly type: ConnectorType = "linear";
  private config: ConnectorConfig | null = null;
  private connected = false;
  private documents: ConnectorDocument[] = [];
  private lastSync: number | undefined;

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  async connect(): Promise<boolean> {
    if (!this.config) return false;

    const apiKey = this.config.credentials["apiKey"]
      ?? this.config.credentials["token"];
    if (!apiKey) return false;

    try {
      const response = await this.graphql<LinearViewerResponse>(
        `query { viewer { id name } }`,
      );
      if (response.data?.viewer?.id) {
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
      const issues = await this.listIssues();
      return issues.map((issue) => issueToDocument(issue));
    } catch {
      return this.documents;
    }
  }

  async fetch(documentId: string): Promise<ConnectorDocument | null> {
    if (!this.connected) return null;

    try {
      const response = await this.graphql<LinearIssueResponse>(
        `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
        { id: documentId },
      );

      const issue = response.data?.issue;
      if (!issue) return null;

      return issueToDocument(issue);
    } catch {
      return null;
    }
  }

  async search(query: string, limit = 10): Promise<readonly ConnectorDocument[]> {
    if (!this.connected) return [];

    try {
      const response = await this.graphql<LinearSearchResponse>(
        `query($query: String!, $first: Int!) {
          issueSearch(query: $query, first: $first) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { query, first: Math.min(limit, MAX_RESULTS) },
      );

      const issues = response.data?.issueSearch?.nodes ?? [];
      return issues.map((issue) => issueToDocument(issue));
    } catch {
      return [];
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.connected) return { added: 0, updated: 0, removed: 0 };

    const result = { added: 0, updated: 0, removed: 0 };

    try {
      const filter = this.lastSync
        ? { updatedAt: { gte: new Date(this.lastSync).toISOString() } }
        : undefined;

      const issues = await this.listIssues(filter);
      const newDocs = issues.map((issue) => issueToDocument(issue));
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
      id: this.config?.id ?? "linear",
      type: "linear",
      connected: this.connected,
      lastSync: this.lastSync,
      documentCount: this.documents.length,
    };
  }

  // ── Private ────────────────────────────────────────────

  private getApiKey(): string {
    return this.config?.credentials["apiKey"]
      ?? this.config?.credentials["token"]
      ?? "";
  }

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: this.getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private async listIssues(
    filter?: Record<string, unknown>,
  ): Promise<readonly LinearIssue[]> {
    const allIssues: LinearIssue[] = [];
    let cursor: string | null = null;

    do {
      const variables: Record<string, unknown> = {
        first: MAX_RESULTS,
      };
      if (cursor) variables["after"] = cursor;
      if (filter) variables["filter"] = filter;

      const filterArg = filter ? ", filter: $filter" : "";
      const filterDef = filter ? ", $filter: IssueFilter" : "";

      const response = await this.graphql<LinearIssuesResponse>(
        `query($first: Int!, $after: String${filterDef}) {
          issues(first: $first, after: $after${filterArg}, orderBy: updatedAt) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        variables,
      );

      const data = response.data?.issues;
      if (!data) break;

      allIssues.push(...data.nodes);
      cursor = data.pageInfo.hasNextPage ? data.pageInfo.endCursor : null;
    } while (cursor && allIssues.length < MAX_RESULTS * 5);

    return allIssues;
  }
}

// ── Helpers ──────────────────────────────────────────────

function issueToDocument(issue: LinearIssue): ConnectorDocument {
  const labels = issue.labels.nodes.map((l) => l.name);
  const priorityLabel = PRIORITY_LABELS[issue.priority] ?? "Unknown";

  const content = [
    `# ${issue.identifier}: ${issue.title}`,
    "",
    `**Status**: ${issue.state.name}`,
    `**Priority**: ${priorityLabel}`,
    `**Team**: ${issue.team.name} (${issue.team.key})`,
    issue.assignee ? `**Assignee**: ${issue.assignee.name}` : null,
    labels.length > 0 ? `**Labels**: ${labels.join(", ")}` : null,
    "",
    issue.description ?? "[No description]",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    id: issue.id,
    title: `${issue.identifier}: ${issue.title}`,
    content,
    url: issue.url,
    source: "linear",
    updatedAt: new Date(issue.updatedAt).getTime(),
    metadata: {
      identifier: issue.identifier,
      status: issue.state.name,
      priority: priorityLabel,
      team: issue.team.key,
      assignee: issue.assignee?.name,
    },
  };
}
