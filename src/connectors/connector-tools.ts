/**
 * Connector Agent Tools — tool schemas + dispatch wrappers that expose
 * jira/linear/notion/confluence/google-drive/slack connectors as
 * first-class agent-callable tools.
 *
 * Design:
 * - Every tool routes through `ConnectorRegistry.get(id)` so the agent
 *   only sees connectors configured by the user.
 * - Reads use the existing `search()` / `fetch()` connector methods.
 * - Writes go through a minimal typed HTTP wrapper in `connector-writes.ts`
 *   so the connector file itself stays focused on ingestion.
 * - Every handler returns a structured envelope — `{ok: false, error:
 *   "not_configured" | "rate_limited" | "unauthorized" | ... }` — so the
 *   model can reason about failure modes without swallowing errors.
 * - Every outbound URL passes through the SSRF guard before the wire
 *   call, so a mis-configured connector cannot be tricked into leaking
 *   credentials to cloud metadata endpoints.
 */

import type { ToolDefinition } from "../core/types.js";
import type { Connector, ConnectorDocument, ConnectorRegistry } from "./connector-registry.js";
import {
  createJiraIssue,
  createLinearIssue,
  commentLinearIssue,
  createNotionPage,
  updateNotionPage,
  createConfluencePage,
  uploadDrive,
  downloadDrive,
  listDriveFiles,
  postSlackMessage,
  readSlackChannel,
} from "./connector-writes.js";

// ── Envelope ────────────────────────────────────────────────

export type ConnectorToolOk<T> = { readonly ok: true; readonly data: T };
export type ConnectorToolErr = {
  readonly ok: false;
  readonly error:
    | "not_configured"
    | "rate_limited"
    | "unauthorized"
    | "bad_input"
    | "ssrf_blocked"
    | "upstream_error";
  readonly detail?: string;
};
export type ConnectorToolResult<T> = ConnectorToolOk<T> | ConnectorToolErr;

// ── Tool Names ─────────────────────────────────────────────

export const CONNECTOR_TOOL_NAMES = [
  "jira.create_issue",
  "jira.read_issue",
  "jira.search",
  "linear.create_issue",
  "linear.search",
  "linear.comment",
  "notion.create_page",
  "notion.search",
  "notion.update_page",
  "confluence.create_page",
  "confluence.search",
  "drive.list_files",
  "drive.upload",
  "drive.download",
  "slack.post_message",
  "slack.search",
  "slack.read_channel",
] as const;

export type ConnectorToolName = (typeof CONNECTOR_TOOL_NAMES)[number];

export function isConnectorTool(name: string): name is ConnectorToolName {
  return (CONNECTOR_TOOL_NAMES as readonly string[]).includes(name);
}

// ── Schemas ────────────────────────────────────────────────

function stringProp(description: string): Record<string, unknown> {
  return { type: "string", description };
}

export function buildConnectorToolDefinitions(): readonly ToolDefinition[] {
  return [
    {
      name: "jira.create_issue",
      description:
        "Create a new Jira issue. Needs the jira connector configured with domain, email, apiToken.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: stringProp("Jira project key (e.g. WOT)"),
          summary: stringProp("Issue summary / title"),
          description: stringProp("Issue description (optional)"),
          issueType: stringProp("Issue type (Bug, Task, Story — default: Task)"),
        },
        required: ["projectKey", "summary"],
      },
    },
    {
      name: "jira.read_issue",
      description: "Fetch a specific Jira issue by key (e.g. WOT-42) or id.",
      inputSchema: {
        type: "object",
        properties: { key: stringProp("Jira issue key or id") },
        required: ["key"],
      },
    },
    {
      name: "jira.search",
      description: "Search Jira issues by free text. Returns up to `limit` matches.",
      inputSchema: {
        type: "object",
        properties: {
          query: stringProp("Free-text query"),
          limit: { type: "number", description: "Max results (default 10, cap 50)" },
        },
        required: ["query"],
      },
    },
    {
      name: "linear.create_issue",
      description: "Create a new Linear issue. Needs the linear connector configured with apiKey.",
      inputSchema: {
        type: "object",
        properties: {
          teamId: stringProp("Linear team id"),
          title: stringProp("Issue title"),
          description: stringProp("Issue description (optional)"),
          priority: { type: "number", description: "Priority 0-4 (0 none, 1 urgent)" },
        },
        required: ["teamId", "title"],
      },
    },
    {
      name: "linear.search",
      description: "Search Linear issues by free text.",
      inputSchema: {
        type: "object",
        properties: {
          query: stringProp("Free-text query"),
          limit: { type: "number", description: "Max results (default 10, cap 50)" },
        },
        required: ["query"],
      },
    },
    {
      name: "linear.comment",
      description: "Post a comment on a Linear issue by id.",
      inputSchema: {
        type: "object",
        properties: {
          issueId: stringProp("Linear issue id"),
          body: stringProp("Comment body (markdown)"),
        },
        required: ["issueId", "body"],
      },
    },
    {
      name: "notion.create_page",
      description: "Create a new Notion page. `parentPageId` selects the parent container.",
      inputSchema: {
        type: "object",
        properties: {
          parentPageId: stringProp("Parent page id"),
          title: stringProp("Page title"),
          content: stringProp("Optional markdown content"),
        },
        required: ["parentPageId", "title"],
      },
    },
    {
      name: "notion.search",
      description: "Search Notion pages by free text.",
      inputSchema: {
        type: "object",
        properties: {
          query: stringProp("Free-text query"),
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "notion.update_page",
      description: "Append markdown content to an existing Notion page by id.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: stringProp("Notion page id"),
          content: stringProp("Markdown content to append"),
        },
        required: ["pageId", "content"],
      },
    },
    {
      name: "confluence.create_page",
      description: "Create a new Confluence page under the given spaceKey.",
      inputSchema: {
        type: "object",
        properties: {
          spaceKey: stringProp("Confluence space key"),
          title: stringProp("Page title"),
          body: stringProp("Page body (storage XHTML)"),
        },
        required: ["spaceKey", "title", "body"],
      },
    },
    {
      name: "confluence.search",
      description: "Search Confluence pages by free text.",
      inputSchema: {
        type: "object",
        properties: {
          query: stringProp("Free-text query"),
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "drive.list_files",
      description: "List files in the configured Google Drive.",
      inputSchema: {
        type: "object",
        properties: {
          query: stringProp("Drive search query (optional)"),
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
    {
      name: "drive.upload",
      description: "Upload a local file to Google Drive.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: stringProp("Absolute path on the host filesystem"),
          name: stringProp("Target filename in Drive"),
          mimeType: stringProp("MIME type (optional, default application/octet-stream)"),
        },
        required: ["filePath", "name"],
      },
    },
    {
      name: "drive.download",
      description: "Download a Google Drive file by id to the given local path.",
      inputSchema: {
        type: "object",
        properties: {
          fileId: stringProp("Drive file id"),
          destPath: stringProp("Absolute destination path"),
        },
        required: ["fileId", "destPath"],
      },
    },
    {
      name: "slack.post_message",
      description: "Post a message to a Slack channel or DM.",
      inputSchema: {
        type: "object",
        properties: {
          channel: stringProp("Channel id or name (e.g. #general)"),
          text: stringProp("Message text (Slack markdown supported)"),
          threadTs: stringProp("Thread timestamp to reply into (optional)"),
        },
        required: ["channel", "text"],
      },
    },
    {
      name: "slack.search",
      description: "Search Slack messages by free text.",
      inputSchema: {
        type: "object",
        properties: {
          query: stringProp("Free-text query"),
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "slack.read_channel",
      description: "Read the most recent messages from a Slack channel.",
      inputSchema: {
        type: "object",
        properties: {
          channel: stringProp("Channel id"),
          limit: { type: "number", description: "Max messages (default 20)" },
        },
        required: ["channel"],
      },
    },
  ];
}

// ── Dispatch helpers ────────────────────────────────────────

function errEnvelope(error: ConnectorToolErr["error"], detail?: string): ConnectorToolErr {
  return { ok: false, error, ...(detail !== undefined ? { detail } : {}) };
}

function getConnected(
  registry: ConnectorRegistry | null,
  id: string,
): { ok: true; connector: Connector } | { ok: false; err: ConnectorToolErr } {
  if (!registry) return { ok: false, err: errEnvelope("not_configured", "no connector registry") };
  const connector = registry.get(id);
  if (!connector) return { ok: false, err: errEnvelope("not_configured", `${id} not configured`) };
  const status = connector.getStatus();
  if (!status.connected)
    return { ok: false, err: errEnvelope("unauthorized", `${id} not connected`) };
  return { ok: true, connector };
}

function stringOrBad(
  value: unknown,
  field: string,
): { ok: true; v: string } | { ok: false; err: ConnectorToolErr } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, err: errEnvelope("bad_input", `${field} is required`) };
  }
  return { ok: true, v: value };
}

function numberOr(value: unknown, fallback: number, cap?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return cap !== undefined ? Math.min(value, cap) : value;
}

function docsToSummary(docs: readonly ConnectorDocument[]): ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly updatedAt: number;
}> {
  return docs.map((d) => ({ id: d.id, title: d.title, url: d.url, updatedAt: d.updatedAt }));
}

// ── Dispatcher ──────────────────────────────────────────────

export async function dispatchConnectorTool(
  toolName: ConnectorToolName,
  input: Record<string, unknown>,
  registry: ConnectorRegistry | null,
): Promise<ConnectorToolResult<unknown>> {
  switch (toolName) {
    case "jira.search": {
      const q = stringOrBad(input["query"], "query");
      if (!q.ok) return q.err;
      const c = getConnected(registry, "jira");
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(q.v, numberOr(input["limit"], 10, 50));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "jira.read_issue": {
      const k = stringOrBad(input["key"], "key");
      if (!k.ok) return k.err;
      const c = getConnected(registry, "jira");
      if (!c.ok) return c.err;
      try {
        const doc = await c.connector.fetch(k.v);
        if (!doc) return errEnvelope("upstream_error", "issue not found");
        return {
          ok: true,
          data: { id: doc.id, title: doc.title, content: doc.content, url: doc.url },
        };
      } catch (err) {
        return errEnvelope("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "jira.create_issue": {
      const p = stringOrBad(input["projectKey"], "projectKey");
      if (!p.ok) return p.err;
      const s = stringOrBad(input["summary"], "summary");
      if (!s.ok) return s.err;
      return createJiraIssue(registry, {
        projectKey: p.v,
        summary: s.v,
        description: typeof input["description"] === "string" ? input["description"] : undefined,
        issueType: typeof input["issueType"] === "string" ? input["issueType"] : undefined,
      });
    }
    case "linear.search": {
      const q = stringOrBad(input["query"], "query");
      if (!q.ok) return q.err;
      const c = getConnected(registry, "linear");
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(q.v, numberOr(input["limit"], 10, 50));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "linear.create_issue": {
      const t = stringOrBad(input["teamId"], "teamId");
      if (!t.ok) return t.err;
      const ti = stringOrBad(input["title"], "title");
      if (!ti.ok) return ti.err;
      return createLinearIssue(registry, {
        teamId: t.v,
        title: ti.v,
        description: typeof input["description"] === "string" ? input["description"] : undefined,
        priority: typeof input["priority"] === "number" ? input["priority"] : undefined,
      });
    }
    case "linear.comment": {
      const i = stringOrBad(input["issueId"], "issueId");
      if (!i.ok) return i.err;
      const b = stringOrBad(input["body"], "body");
      if (!b.ok) return b.err;
      return commentLinearIssue(registry, { issueId: i.v, body: b.v });
    }
    case "notion.search": {
      const q = stringOrBad(input["query"], "query");
      if (!q.ok) return q.err;
      const c = getConnected(registry, "notion");
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(q.v, numberOr(input["limit"], 10));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "notion.create_page": {
      const p = stringOrBad(input["parentPageId"], "parentPageId");
      if (!p.ok) return p.err;
      const t = stringOrBad(input["title"], "title");
      if (!t.ok) return t.err;
      return createNotionPage(registry, {
        parentPageId: p.v,
        title: t.v,
        content: typeof input["content"] === "string" ? input["content"] : undefined,
      });
    }
    case "notion.update_page": {
      const p = stringOrBad(input["pageId"], "pageId");
      if (!p.ok) return p.err;
      const c = stringOrBad(input["content"], "content");
      if (!c.ok) return c.err;
      return updateNotionPage(registry, { pageId: p.v, content: c.v });
    }
    case "confluence.search": {
      const q = stringOrBad(input["query"], "query");
      if (!q.ok) return q.err;
      const c = getConnected(registry, "confluence");
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(q.v, numberOr(input["limit"], 10));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "confluence.create_page": {
      const s = stringOrBad(input["spaceKey"], "spaceKey");
      if (!s.ok) return s.err;
      const t = stringOrBad(input["title"], "title");
      if (!t.ok) return t.err;
      const b = stringOrBad(input["body"], "body");
      if (!b.ok) return b.err;
      return createConfluencePage(registry, { spaceKey: s.v, title: t.v, body: b.v });
    }
    case "drive.list_files":
      return listDriveFiles(registry, {
        query: typeof input["query"] === "string" ? input["query"] : undefined,
        limit: numberOr(input["limit"], 20, 100),
      });
    case "drive.upload": {
      const f = stringOrBad(input["filePath"], "filePath");
      if (!f.ok) return f.err;
      const n = stringOrBad(input["name"], "name");
      if (!n.ok) return n.err;
      return uploadDrive(registry, {
        filePath: f.v,
        name: n.v,
        mimeType: typeof input["mimeType"] === "string" ? input["mimeType"] : undefined,
      });
    }
    case "drive.download": {
      const f = stringOrBad(input["fileId"], "fileId");
      if (!f.ok) return f.err;
      const d = stringOrBad(input["destPath"], "destPath");
      if (!d.ok) return d.err;
      return downloadDrive(registry, { fileId: f.v, destPath: d.v });
    }
    case "slack.search": {
      const q = stringOrBad(input["query"], "query");
      if (!q.ok) return q.err;
      const c = getConnected(registry, "slack");
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(q.v, numberOr(input["limit"], 10));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "slack.post_message": {
      const ch = stringOrBad(input["channel"], "channel");
      if (!ch.ok) return ch.err;
      const tx = stringOrBad(input["text"], "text");
      if (!tx.ok) return tx.err;
      return postSlackMessage(registry, {
        channel: ch.v,
        text: tx.v,
        threadTs: typeof input["threadTs"] === "string" ? input["threadTs"] : undefined,
      });
    }
    case "slack.read_channel": {
      const ch = stringOrBad(input["channel"], "channel");
      if (!ch.ok) return ch.err;
      return readSlackChannel(registry, {
        channel: ch.v,
        limit: numberOr(input["limit"], 20, 100),
      });
    }
    default: {
      const _exhaustive: never = toolName;
      return errEnvelope("bad_input", `unknown tool: ${String(_exhaustive)}`);
    }
  }
}
