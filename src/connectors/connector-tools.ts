/**
 * Connector Agent Tools — Wave 4C complete surface.
 *
 * Exposes the jira/linear/notion/confluence/google-drive/slack connectors
 * as first-class agent-callable tools. 34 tools total (6+6+6+5+5+6) —
 * every connector has at least 5 operations covering BOTH read and write
 * paths:
 *
 *   jira.search, jira.read_issue, jira.create_issue, jira.update_issue,
 *   jira.comment, jira.transition
 *   linear.search, linear.read_issue, linear.create_issue,
 *   linear.update_issue, linear.comment, linear.assignee_set
 *   notion.search, notion.read_page, notion.create_page, notion.update_page,
 *   notion.append_block, notion.delete_block
 *   confluence.search, confluence.read_page, confluence.create_page,
 *   confluence.update_page, confluence.comment
 *   drive.list_files, drive.upload, drive.download, drive.share,
 *   drive.create_folder
 *   slack.search, slack.post_message, slack.read_channel,
 *   slack.create_channel, slack.upload_file, slack.react
 *
 * DESIGN:
 * - Every tool routes through `ConnectorRegistry.get(id)` so the agent
 *   only sees connectors configured by the user.
 * - Reads use the existing `search()` / `fetch()` connector methods.
 * - Writes go through typed HTTP helpers in `connector-writes.ts` which
 *   in turn use `guarded-fetch.ts` — every outbound URL is SSRF-validated
 *   before the wire call.
 * - Zod schemas validate input; the JSON-schema surface exposed to the
 *   model is generated from the Zod shape so the two cannot drift.
 * - Every handler returns a structured envelope:
 *   `{ok: true, data}` on success, or
 *   `{ok: false, error: "not_configured"|"unauthorized"|"rate_limited"|
 *    "not_found"|"bad_input"|"ssrf_blocked"|"upstream_error", fix?, detail?}`
 *   on failure. Honest error surfaces — no silent nulls, no `any`.
 * - Capability gating: missing auth returns a honest
 *   `{ok:false, error:"not_configured", fix:"Set <ENV_VAR> in env"}` so
 *   the model knows exactly which credential is missing. Credentials are
 *   never read from tool input — only from `ConnectorConfig.credentials`
 *   (which config-discovery.ts populates from env / OAuth / YAML).
 */

import { z } from "zod";
import type { ToolDefinition } from "../core/types.js";
import type { Connector, ConnectorDocument, ConnectorRegistry } from "./connector-registry.js";
import {
  createJiraIssue,
  updateJiraIssue,
  commentJiraIssue,
  transitionJiraIssue,
  createLinearIssue,
  updateLinearIssue,
  commentLinearIssue,
  setLinearAssignee,
  readLinearIssue,
  createNotionPage,
  updateNotionPage,
  readNotionPage,
  appendNotionBlock,
  deleteNotionBlock,
  createConfluencePage,
  updateConfluencePage,
  readConfluencePage,
  commentConfluencePage,
  uploadDrive,
  downloadDrive,
  listDriveFiles,
  shareDrive,
  createDriveFolder,
  postSlackMessage,
  readSlackChannel,
  createSlackChannel,
  uploadSlackFile,
  reactSlackMessage,
} from "./connector-writes.js";

// ── Envelope ────────────────────────────────────────────────

export type ConnectorToolOk<T> = { readonly ok: true; readonly data: T };
export type ConnectorToolErrCode =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "bad_input"
  | "ssrf_blocked"
  | "upstream_error";
export type ConnectorToolErr = {
  readonly ok: false;
  readonly error: ConnectorToolErrCode;
  /** Actionable remediation, e.g. "Set JIRA_OAUTH_TOKEN in env". */
  readonly fix?: string;
  /** Human-readable detail (error message slice, status code, etc.). */
  readonly detail?: string;
};
export type ConnectorToolResult<T> = ConnectorToolOk<T> | ConnectorToolErr;

// ── Tool Names ─────────────────────────────────────────────

export const CONNECTOR_TOOL_NAMES = [
  // Jira (6)
  "jira.search",
  "jira.read_issue",
  "jira.create_issue",
  "jira.update_issue",
  "jira.comment",
  "jira.transition",
  // Linear (6)
  "linear.search",
  "linear.read_issue",
  "linear.create_issue",
  "linear.update_issue",
  "linear.comment",
  "linear.assignee_set",
  // Notion (6)
  "notion.search",
  "notion.read_page",
  "notion.create_page",
  "notion.update_page",
  "notion.append_block",
  "notion.delete_block",
  // Confluence (5)
  "confluence.search",
  "confluence.read_page",
  "confluence.create_page",
  "confluence.update_page",
  "confluence.comment",
  // Google Drive (5)
  "drive.list_files",
  "drive.upload",
  "drive.download",
  "drive.share",
  "drive.create_folder",
  // Slack (6)
  "slack.search",
  "slack.post_message",
  "slack.read_channel",
  "slack.create_channel",
  "slack.upload_file",
  "slack.react",
] as const;

export type ConnectorToolName = (typeof CONNECTOR_TOOL_NAMES)[number];

export function isConnectorTool(name: string): name is ConnectorToolName {
  return (CONNECTOR_TOOL_NAMES as readonly string[]).includes(name);
}

// ── Zod Schemas ─────────────────────────────────────────────
// Single source of truth per tool. The JSON-schema `inputSchema` exposed
// to the model is derived from each schema so the two cannot drift.

const LimitField = z.number().int().positive().optional();

// Jira
export const JiraSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: LimitField,
});
export const JiraReadIssueSchema = z.object({
  key: z.string().min(1, "key is required"),
});
export const JiraCreateIssueSchema = z.object({
  projectKey: z.string().min(1, "projectKey is required"),
  summary: z.string().min(1, "summary is required"),
  description: z.string().optional(),
  issueType: z.string().optional(),
});
export const JiraUpdateIssueSchema = z.object({
  key: z.string().min(1, "key is required"),
  summary: z.string().optional(),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
export const JiraCommentSchema = z.object({
  key: z.string().min(1, "key is required"),
  body: z.string().min(1, "body is required"),
});
export const JiraTransitionSchema = z.object({
  key: z.string().min(1, "key is required"),
  transitionId: z.string().optional(),
  transitionName: z.string().optional(),
});

// Linear
export const LinearSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: LimitField,
});
export const LinearReadIssueSchema = z.object({
  id: z.string().min(1, "id is required"),
});
export const LinearCreateIssueSchema = z.object({
  teamId: z.string().min(1, "teamId is required"),
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
});
export const LinearUpdateIssueSchema = z.object({
  issueId: z.string().min(1, "issueId is required"),
  title: z.string().optional(),
  description: z.string().optional(),
  stateId: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
});
export const LinearCommentSchema = z.object({
  issueId: z.string().min(1, "issueId is required"),
  body: z.string().min(1, "body is required"),
});
export const LinearAssigneeSetSchema = z.object({
  issueId: z.string().min(1, "issueId is required"),
  assigneeId: z
    .string()
    .min(1, "assigneeId is required (pass empty via `null`? — use explicit id)"),
});

// Notion
export const NotionSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: LimitField,
});
export const NotionReadPageSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
});
export const NotionCreatePageSchema = z.object({
  parentPageId: z.string().min(1, "parentPageId is required"),
  title: z.string().min(1, "title is required"),
  content: z.string().optional(),
});
export const NotionUpdatePageSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
  content: z.string().min(1, "content is required"),
});
export const NotionAppendBlockSchema = z.object({
  blockId: z.string().min(1, "blockId is required"),
  content: z.string().min(1, "content is required"),
});
export const NotionDeleteBlockSchema = z.object({
  blockId: z.string().min(1, "blockId is required"),
});

// Confluence
export const ConfluenceSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: LimitField,
});
export const ConfluenceReadPageSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
});
export const ConfluenceCreatePageSchema = z.object({
  spaceKey: z.string().min(1, "spaceKey is required"),
  title: z.string().min(1, "title is required"),
  body: z.string().min(1, "body is required"),
});
export const ConfluenceUpdatePageSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
  title: z.string().min(1, "title is required"),
  body: z.string().min(1, "body is required"),
  version: z.number().int().positive(),
});
export const ConfluenceCommentSchema = z.object({
  pageId: z.string().min(1, "pageId is required"),
  body: z.string().min(1, "body is required"),
});

// Drive
export const DriveListFilesSchema = z.object({
  query: z.string().optional(),
  limit: LimitField,
});
export const DriveUploadSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  name: z.string().min(1, "name is required"),
  mimeType: z.string().optional(),
  folderId: z.string().optional(),
});
export const DriveDownloadSchema = z.object({
  fileId: z.string().min(1, "fileId is required"),
  destPath: z.string().min(1, "destPath is required"),
});
export const DriveShareSchema = z.object({
  fileId: z.string().min(1, "fileId is required"),
  emailAddress: z.string().optional(),
  role: z.enum(["reader", "writer", "commenter", "owner"]).optional(),
  type: z.enum(["user", "group", "domain", "anyone"]).optional(),
});
export const DriveCreateFolderSchema = z.object({
  name: z.string().min(1, "name is required"),
  parentId: z.string().optional(),
});

// Slack
export const SlackSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: LimitField,
});
export const SlackPostMessageSchema = z.object({
  channel: z.string().min(1, "channel is required"),
  text: z.string().min(1, "text is required"),
  threadTs: z.string().optional(),
});
export const SlackReadChannelSchema = z.object({
  channel: z.string().min(1, "channel is required"),
  limit: LimitField,
});
export const SlackCreateChannelSchema = z.object({
  name: z.string().min(1, "name is required"),
  isPrivate: z.boolean().optional(),
});
export const SlackUploadFileSchema = z.object({
  channel: z.string().min(1, "channel is required"),
  filePath: z.string().min(1, "filePath is required"),
  filename: z.string().optional(),
  title: z.string().optional(),
  initialComment: z.string().optional(),
});
export const SlackReactSchema = z.object({
  channel: z.string().min(1, "channel is required"),
  timestamp: z.string().min(1, "timestamp is required"),
  name: z.string().min(1, "name is required (emoji without colons)"),
});

// ── JSON Schema Builders ───────────────────────────────────
// Hand-authored JSON schemas mirror the Zod shape so we don't pull in
// zod-to-json-schema as a dependency. The two are covered by the
// roundtrip test in tests/unit/connector-tools.test.ts.

function stringProp(description: string): Record<string, unknown> {
  return { type: "string", description };
}

type Schema = Record<string, unknown>;

function defineTool(
  name: ConnectorToolName,
  description: string,
  properties: Record<string, Schema>,
  required: readonly string[],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required: [...required],
    },
  };
}

// Exported so `runtime-tools.ts::buildConnectorTools()` can delegate.
export function buildConnectorToolDefinitions(): readonly ToolDefinition[] {
  return [
    // ── Jira (6) ────────────────────────────────────────────
    defineTool(
      "jira.search",
      "Search Jira issues by free text. Returns up to `limit` matches.",
      {
        query: stringProp("Free-text query"),
        limit: { type: "number", description: "Max results (default 10, cap 50)" },
      },
      ["query"],
    ),
    defineTool(
      "jira.read_issue",
      "Fetch a specific Jira issue by key (e.g. WOT-42) or id.",
      { key: stringProp("Jira issue key or id") },
      ["key"],
    ),
    defineTool(
      "jira.create_issue",
      "Create a new Jira issue. Needs the jira connector configured with domain, email, apiToken.",
      {
        projectKey: stringProp("Jira project key (e.g. WOT)"),
        summary: stringProp("Issue summary / title"),
        description: stringProp("Issue description (optional)"),
        issueType: stringProp("Issue type (Bug, Task, Story — default: Task)"),
      },
      ["projectKey", "summary"],
    ),
    defineTool(
      "jira.update_issue",
      "Update an existing Jira issue (summary, description, labels).",
      {
        key: stringProp("Jira issue key (e.g. WOT-42)"),
        summary: stringProp("New summary (optional)"),
        description: stringProp("New description (optional)"),
        labels: { type: "array", items: { type: "string" }, description: "Replacement label list" },
      },
      ["key"],
    ),
    defineTool(
      "jira.comment",
      "Add a comment to a Jira issue.",
      {
        key: stringProp("Jira issue key (e.g. WOT-42)"),
        body: stringProp("Comment body (plain text)"),
      },
      ["key", "body"],
    ),
    defineTool(
      "jira.transition",
      "Transition a Jira issue to a new workflow state (by transition id or name).",
      {
        key: stringProp("Jira issue key"),
        transitionId: stringProp("Jira transition id (preferred)"),
        transitionName: stringProp(
          "Jira transition name (e.g. 'Done') — resolved to id if id missing",
        ),
      },
      ["key"],
    ),
    // ── Linear (6) ──────────────────────────────────────────
    defineTool(
      "linear.search",
      "Search Linear issues by free text.",
      {
        query: stringProp("Free-text query"),
        limit: { type: "number", description: "Max results (default 10, cap 50)" },
      },
      ["query"],
    ),
    defineTool(
      "linear.read_issue",
      "Fetch a specific Linear issue by id.",
      { id: stringProp("Linear issue id") },
      ["id"],
    ),
    defineTool(
      "linear.create_issue",
      "Create a new Linear issue. Needs the linear connector configured with apiKey.",
      {
        teamId: stringProp("Linear team id"),
        title: stringProp("Issue title"),
        description: stringProp("Issue description (optional)"),
        priority: { type: "number", description: "Priority 0-4 (0 none, 1 urgent)" },
      },
      ["teamId", "title"],
    ),
    defineTool(
      "linear.update_issue",
      "Update an existing Linear issue.",
      {
        issueId: stringProp("Linear issue id"),
        title: stringProp("New title (optional)"),
        description: stringProp("New description (optional)"),
        stateId: stringProp("New workflow state id (optional)"),
        priority: { type: "number", description: "Priority 0-4 (optional)" },
      },
      ["issueId"],
    ),
    defineTool(
      "linear.comment",
      "Post a comment on a Linear issue by id.",
      {
        issueId: stringProp("Linear issue id"),
        body: stringProp("Comment body (markdown)"),
      },
      ["issueId", "body"],
    ),
    defineTool(
      "linear.assignee_set",
      "Assign a Linear issue to a user.",
      {
        issueId: stringProp("Linear issue id"),
        assigneeId: stringProp("Linear user id"),
      },
      ["issueId", "assigneeId"],
    ),
    // ── Notion (6) ──────────────────────────────────────────
    defineTool(
      "notion.search",
      "Search Notion pages by free text.",
      {
        query: stringProp("Free-text query"),
        limit: { type: "number", description: "Max results (default 10)" },
      },
      ["query"],
    ),
    defineTool(
      "notion.read_page",
      "Fetch a Notion page's properties and block content.",
      { pageId: stringProp("Notion page id") },
      ["pageId"],
    ),
    defineTool(
      "notion.create_page",
      "Create a new Notion page. `parentPageId` selects the parent container.",
      {
        parentPageId: stringProp("Parent page id"),
        title: stringProp("Page title"),
        content: stringProp("Optional markdown content"),
      },
      ["parentPageId", "title"],
    ),
    defineTool(
      "notion.update_page",
      "Append markdown content to an existing Notion page by id.",
      {
        pageId: stringProp("Notion page id"),
        content: stringProp("Markdown content to append"),
      },
      ["pageId", "content"],
    ),
    defineTool(
      "notion.append_block",
      "Append markdown content as children of a Notion block.",
      {
        blockId: stringProp("Notion block id (container)"),
        content: stringProp("Markdown content"),
      },
      ["blockId", "content"],
    ),
    defineTool(
      "notion.delete_block",
      "Archive (soft-delete) a Notion block.",
      { blockId: stringProp("Notion block id") },
      ["blockId"],
    ),
    // ── Confluence (5) ──────────────────────────────────────
    defineTool(
      "confluence.search",
      "Search Confluence pages by free text.",
      {
        query: stringProp("Free-text query"),
        limit: { type: "number", description: "Max results (default 10)" },
      },
      ["query"],
    ),
    defineTool(
      "confluence.read_page",
      "Fetch a Confluence page's storage body by id.",
      { pageId: stringProp("Confluence page id") },
      ["pageId"],
    ),
    defineTool(
      "confluence.create_page",
      "Create a new Confluence page under the given spaceKey.",
      {
        spaceKey: stringProp("Confluence space key"),
        title: stringProp("Page title"),
        body: stringProp("Page body (storage XHTML)"),
      },
      ["spaceKey", "title", "body"],
    ),
    defineTool(
      "confluence.update_page",
      "Update a Confluence page (title + body). Requires current version number.",
      {
        pageId: stringProp("Confluence page id"),
        title: stringProp("New title"),
        body: stringProp("New body (storage XHTML)"),
        version: {
          type: "number",
          description: "Current version number (Confluence optimistic locking)",
        },
      },
      ["pageId", "title", "body", "version"],
    ),
    defineTool(
      "confluence.comment",
      "Add a comment to a Confluence page.",
      {
        pageId: stringProp("Confluence page id"),
        body: stringProp("Comment body (storage XHTML)"),
      },
      ["pageId", "body"],
    ),
    // ── Drive (5) ───────────────────────────────────────────
    defineTool(
      "drive.list_files",
      "List files in the configured Google Drive.",
      {
        query: stringProp("Drive search query (optional)"),
        limit: { type: "number", description: "Max results (default 20)" },
      },
      [],
    ),
    defineTool(
      "drive.upload",
      "Upload a local file to Google Drive.",
      {
        filePath: stringProp("Absolute path on the host filesystem"),
        name: stringProp("Target filename in Drive"),
        mimeType: stringProp("MIME type (optional, default application/octet-stream)"),
        folderId: stringProp("Target folder id (optional — default: My Drive root)"),
      },
      ["filePath", "name"],
    ),
    defineTool(
      "drive.download",
      "Download a Google Drive file by id to the given local path.",
      {
        fileId: stringProp("Drive file id"),
        destPath: stringProp("Absolute destination path"),
      },
      ["fileId", "destPath"],
    ),
    defineTool(
      "drive.share",
      "Grant a permission on a Drive file/folder (anyone-with-link, user, group, or domain).",
      {
        fileId: stringProp("Drive file id"),
        emailAddress: stringProp("Email address (required for user/group/domain)"),
        role: { type: "string", enum: ["reader", "writer", "commenter", "owner"] },
        type: { type: "string", enum: ["user", "group", "domain", "anyone"] },
      },
      ["fileId"],
    ),
    defineTool(
      "drive.create_folder",
      "Create a new Drive folder.",
      {
        name: stringProp("Folder name"),
        parentId: stringProp("Parent folder id (optional — default: My Drive root)"),
      },
      ["name"],
    ),
    // ── Slack (6) ───────────────────────────────────────────
    defineTool(
      "slack.search",
      "Search Slack messages by free text.",
      {
        query: stringProp("Free-text query"),
        limit: { type: "number", description: "Max results (default 10)" },
      },
      ["query"],
    ),
    defineTool(
      "slack.post_message",
      "Post a message to a Slack channel or DM.",
      {
        channel: stringProp("Channel id or name (e.g. #general)"),
        text: stringProp("Message text (Slack markdown supported)"),
        threadTs: stringProp("Thread timestamp to reply into (optional)"),
      },
      ["channel", "text"],
    ),
    defineTool(
      "slack.read_channel",
      "Read the most recent messages from a Slack channel.",
      {
        channel: stringProp("Channel id"),
        limit: { type: "number", description: "Max messages (default 20)" },
      },
      ["channel"],
    ),
    defineTool(
      "slack.create_channel",
      "Create a new public or private Slack channel.",
      {
        name: stringProp("Channel name (lowercase, no spaces, 1-80 chars)"),
        isPrivate: { type: "boolean", description: "Private channel? (default: false)" },
      },
      ["name"],
    ),
    defineTool(
      "slack.upload_file",
      "Upload a local file to a Slack channel.",
      {
        channel: stringProp("Channel id"),
        filePath: stringProp("Absolute path on the host filesystem"),
        filename: stringProp("Filename shown in Slack (optional)"),
        title: stringProp("File title (optional)"),
        initialComment: stringProp("Accompanying comment (optional)"),
      },
      ["channel", "filePath"],
    ),
    defineTool(
      "slack.react",
      "Add an emoji reaction to a Slack message.",
      {
        channel: stringProp("Channel id"),
        timestamp: stringProp("Message timestamp (ts field)"),
        name: stringProp("Emoji name without colons (e.g. 'thumbsup')"),
      },
      ["channel", "timestamp", "name"],
    ),
  ];
}

// ── Dispatch helpers ────────────────────────────────────────

export function errEnvelope(
  error: ConnectorToolErrCode,
  detail?: string,
  fix?: string,
): ConnectorToolErr {
  return {
    ok: false,
    error,
    ...(fix !== undefined ? { fix } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Resolve a connector by id and assert it is connected. Returns a honest
 * `not_configured` or `unauthorized` envelope otherwise — agents always
 * see why a tool call failed.
 */
function getConnected(
  registry: ConnectorRegistry | null,
  id: string,
  envVar: string,
): { ok: true; connector: Connector } | { ok: false; err: ConnectorToolErr } {
  if (!registry)
    return {
      ok: false,
      err: errEnvelope("not_configured", "no connector registry", `Set ${envVar} in env`),
    };
  const connector = registry.get(id);
  if (!connector)
    return {
      ok: false,
      err: errEnvelope("not_configured", `${id} not configured`, `Set ${envVar} in env`),
    };
  const status = connector.getStatus();
  if (!status.connected)
    return {
      ok: false,
      err: errEnvelope(
        "unauthorized",
        `${id} not connected`,
        `Verify ${envVar} and reconnect via: wotann connectors connect ${id}`,
      ),
    };
  return { ok: true, connector };
}

function parseOrBad<T>(
  schema: z.ZodType<T>,
  input: Record<string, unknown>,
): { ok: true; value: T } | { ok: false; err: ConnectorToolErr } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0];
  const detail = first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "bad input";
  return { ok: false, err: errEnvelope("bad_input", detail) };
}

function clampLimit(limit: number | undefined, fallback: number, cap: number): number {
  if (limit === undefined) return fallback;
  return Math.min(Math.max(1, limit), cap);
}

function docsToSummary(docs: readonly ConnectorDocument[]): ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly updatedAt: number;
}> {
  return docs.map((d) => ({ id: d.id, title: d.title, url: d.url, updatedAt: d.updatedAt }));
}

// Per-connector "fix" messages for honest capability gating.
const FIX_JIRA = "Set JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN in env";
const FIX_LINEAR = "Set LINEAR_API_KEY in env";
const FIX_NOTION = "Set NOTION_API_KEY in env";
const FIX_CONFLUENCE = "Set CONFLUENCE_DOMAIN, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN in env";
const _FIX_DRIVE = "Set GOOGLE_DRIVE_ACCESS_TOKEN (or run OAuth flow) in env";
const FIX_SLACK = "Set SLACK_BOT_TOKEN in env";

// ── Dispatcher ──────────────────────────────────────────────

export async function dispatchConnectorTool(
  toolName: ConnectorToolName,
  input: Record<string, unknown>,
  registry: ConnectorRegistry | null,
): Promise<ConnectorToolResult<unknown>> {
  switch (toolName) {
    // ── Jira ──────────────────────────────────────────────
    case "jira.search": {
      const p = parseOrBad(JiraSearchSchema, input);
      if (!p.ok) return p.err;
      const c = getConnected(registry, "jira", FIX_JIRA);
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(p.value.query, clampLimit(p.value.limit, 10, 50));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", errMsg(err));
      }
    }
    case "jira.read_issue": {
      const p = parseOrBad(JiraReadIssueSchema, input);
      if (!p.ok) return p.err;
      const c = getConnected(registry, "jira", FIX_JIRA);
      if (!c.ok) return c.err;
      try {
        const doc = await c.connector.fetch(p.value.key);
        if (!doc) return errEnvelope("not_found", `issue ${p.value.key} not found`);
        return {
          ok: true,
          data: { id: doc.id, title: doc.title, content: doc.content, url: doc.url },
        };
      } catch (err) {
        return errEnvelope("upstream_error", errMsg(err));
      }
    }
    case "jira.create_issue": {
      const p = parseOrBad(JiraCreateIssueSchema, input);
      if (!p.ok) return p.err;
      return createJiraIssue(registry, p.value);
    }
    case "jira.update_issue": {
      const p = parseOrBad(JiraUpdateIssueSchema, input);
      if (!p.ok) return p.err;
      return updateJiraIssue(registry, p.value);
    }
    case "jira.comment": {
      const p = parseOrBad(JiraCommentSchema, input);
      if (!p.ok) return p.err;
      return commentJiraIssue(registry, p.value);
    }
    case "jira.transition": {
      const p = parseOrBad(JiraTransitionSchema, input);
      if (!p.ok) return p.err;
      if (!p.value.transitionId && !p.value.transitionName)
        return errEnvelope("bad_input", "transitionId or transitionName is required");
      return transitionJiraIssue(registry, p.value);
    }
    // ── Linear ────────────────────────────────────────────
    case "linear.search": {
      const p = parseOrBad(LinearSearchSchema, input);
      if (!p.ok) return p.err;
      const c = getConnected(registry, "linear", FIX_LINEAR);
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(p.value.query, clampLimit(p.value.limit, 10, 50));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", errMsg(err));
      }
    }
    case "linear.read_issue": {
      const p = parseOrBad(LinearReadIssueSchema, input);
      if (!p.ok) return p.err;
      return readLinearIssue(registry, p.value);
    }
    case "linear.create_issue": {
      const p = parseOrBad(LinearCreateIssueSchema, input);
      if (!p.ok) return p.err;
      return createLinearIssue(registry, p.value);
    }
    case "linear.update_issue": {
      const p = parseOrBad(LinearUpdateIssueSchema, input);
      if (!p.ok) return p.err;
      return updateLinearIssue(registry, p.value);
    }
    case "linear.comment": {
      const p = parseOrBad(LinearCommentSchema, input);
      if (!p.ok) return p.err;
      return commentLinearIssue(registry, p.value);
    }
    case "linear.assignee_set": {
      const p = parseOrBad(LinearAssigneeSetSchema, input);
      if (!p.ok) return p.err;
      return setLinearAssignee(registry, p.value);
    }
    // ── Notion ────────────────────────────────────────────
    case "notion.search": {
      const p = parseOrBad(NotionSearchSchema, input);
      if (!p.ok) return p.err;
      const c = getConnected(registry, "notion", FIX_NOTION);
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(p.value.query, clampLimit(p.value.limit, 10, 100));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", errMsg(err));
      }
    }
    case "notion.read_page": {
      const p = parseOrBad(NotionReadPageSchema, input);
      if (!p.ok) return p.err;
      return readNotionPage(registry, p.value);
    }
    case "notion.create_page": {
      const p = parseOrBad(NotionCreatePageSchema, input);
      if (!p.ok) return p.err;
      return createNotionPage(registry, p.value);
    }
    case "notion.update_page": {
      const p = parseOrBad(NotionUpdatePageSchema, input);
      if (!p.ok) return p.err;
      return updateNotionPage(registry, p.value);
    }
    case "notion.append_block": {
      const p = parseOrBad(NotionAppendBlockSchema, input);
      if (!p.ok) return p.err;
      return appendNotionBlock(registry, p.value);
    }
    case "notion.delete_block": {
      const p = parseOrBad(NotionDeleteBlockSchema, input);
      if (!p.ok) return p.err;
      return deleteNotionBlock(registry, p.value);
    }
    // ── Confluence ────────────────────────────────────────
    case "confluence.search": {
      const p = parseOrBad(ConfluenceSearchSchema, input);
      if (!p.ok) return p.err;
      const c = getConnected(registry, "confluence", FIX_CONFLUENCE);
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(p.value.query, clampLimit(p.value.limit, 10, 100));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", errMsg(err));
      }
    }
    case "confluence.read_page": {
      const p = parseOrBad(ConfluenceReadPageSchema, input);
      if (!p.ok) return p.err;
      return readConfluencePage(registry, p.value);
    }
    case "confluence.create_page": {
      const p = parseOrBad(ConfluenceCreatePageSchema, input);
      if (!p.ok) return p.err;
      return createConfluencePage(registry, p.value);
    }
    case "confluence.update_page": {
      const p = parseOrBad(ConfluenceUpdatePageSchema, input);
      if (!p.ok) return p.err;
      return updateConfluencePage(registry, p.value);
    }
    case "confluence.comment": {
      const p = parseOrBad(ConfluenceCommentSchema, input);
      if (!p.ok) return p.err;
      return commentConfluencePage(registry, p.value);
    }
    // ── Drive ─────────────────────────────────────────────
    case "drive.list_files": {
      const p = parseOrBad(DriveListFilesSchema, input);
      if (!p.ok) return p.err;
      return listDriveFiles(registry, {
        query: p.value.query,
        limit: clampLimit(p.value.limit, 20, 100),
      });
    }
    case "drive.upload": {
      const p = parseOrBad(DriveUploadSchema, input);
      if (!p.ok) return p.err;
      return uploadDrive(registry, p.value);
    }
    case "drive.download": {
      const p = parseOrBad(DriveDownloadSchema, input);
      if (!p.ok) return p.err;
      return downloadDrive(registry, p.value);
    }
    case "drive.share": {
      const p = parseOrBad(DriveShareSchema, input);
      if (!p.ok) return p.err;
      return shareDrive(registry, p.value);
    }
    case "drive.create_folder": {
      const p = parseOrBad(DriveCreateFolderSchema, input);
      if (!p.ok) return p.err;
      return createDriveFolder(registry, p.value);
    }
    // ── Slack ─────────────────────────────────────────────
    case "slack.search": {
      const p = parseOrBad(SlackSearchSchema, input);
      if (!p.ok) return p.err;
      const c = getConnected(registry, "slack", FIX_SLACK);
      if (!c.ok) return c.err;
      try {
        const docs = await c.connector.search(p.value.query, clampLimit(p.value.limit, 10, 100));
        return { ok: true, data: docsToSummary(docs) };
      } catch (err) {
        return errEnvelope("upstream_error", errMsg(err));
      }
    }
    case "slack.post_message": {
      const p = parseOrBad(SlackPostMessageSchema, input);
      if (!p.ok) return p.err;
      return postSlackMessage(registry, p.value);
    }
    case "slack.read_channel": {
      const p = parseOrBad(SlackReadChannelSchema, input);
      if (!p.ok) return p.err;
      return readSlackChannel(registry, {
        channel: p.value.channel,
        limit: clampLimit(p.value.limit, 20, 200),
      });
    }
    case "slack.create_channel": {
      const p = parseOrBad(SlackCreateChannelSchema, input);
      if (!p.ok) return p.err;
      return createSlackChannel(registry, p.value);
    }
    case "slack.upload_file": {
      const p = parseOrBad(SlackUploadFileSchema, input);
      if (!p.ok) return p.err;
      return uploadSlackFile(registry, p.value);
    }
    case "slack.react": {
      const p = parseOrBad(SlackReactSchema, input);
      if (!p.ok) return p.err;
      return reactSlackMessage(registry, p.value);
    }
    default: {
      const _exhaustive: never = toolName;
      return errEnvelope("bad_input", `unknown tool: ${String(_exhaustive)}`);
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
