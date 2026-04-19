/**
 * Connector Writes — minimal typed HTTP writers for create/update/upload
 * operations that the existing ingestion-focused connector files don't
 * implement. Kept in a dedicated module so the original connector source
 * stays focused on read-side sync.
 *
 * SECURITY: every outbound URL is SSRF-guarded; every credential is
 * sourced from the connector's own config (never from tool input). Tool
 * input only carries operation-specific fields (issue title, file path,
 * etc.).
 *
 * All functions return the `ConnectorToolResult` envelope from
 * connector-tools.ts — no throws on upstream failure.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { isSafeUrl } from "../security/ssrf-guard.js";
import type { ConnectorConfig, ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorToolErr, ConnectorToolResult } from "./connector-tools.js";

function errEnv(error: ConnectorToolErr["error"], detail?: string): ConnectorToolErr {
  return { ok: false, error, ...(detail !== undefined ? { detail } : {}) };
}

/**
 * Read credentials off a registered connector by introspecting its
 * private `config` field. The connector interface deliberately does not
 * expose credentials publicly; this module is the only consumer that
 * needs them so widening the interface isn't justified.
 */
function readConnectorCreds(
  registry: ConnectorRegistry | null,
  id: string,
): { ok: true; creds: Readonly<Record<string, string>> } | { ok: false; err: ConnectorToolErr } {
  if (!registry) return { ok: false, err: errEnv("not_configured", "no connector registry") };
  const c = registry.get(id);
  if (!c) return { ok: false, err: errEnv("not_configured", `${id} not configured`) };
  const config = (c as unknown as { config: ConnectorConfig | null }).config;
  if (!config) return { ok: false, err: errEnv("not_configured", `${id} has no credentials`) };
  return { ok: true, creds: config.credentials };
}

async function guardedFetch(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  if (!isSafeUrl(url)) {
    throw new Error(`SSRF blocked: ${url}`);
  }
  const response = await fetch(url, init);
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

function httpErr(status: number, body: string): ConnectorToolErr {
  if (status === 401 || status === 403)
    return errEnv("unauthorized", `HTTP ${status}: ${body.slice(0, 200)}`);
  if (status === 429) return errEnv("rate_limited", `HTTP 429: ${body.slice(0, 200)}`);
  return errEnv("upstream_error", `HTTP ${status}: ${body.slice(0, 200)}`);
}

function catchErr(err: unknown): ConnectorToolErr {
  const message = err instanceof Error ? err.message : String(err);
  return errEnv(message.startsWith("SSRF blocked") ? "ssrf_blocked" : "upstream_error", message);
}

// ── Jira ────────────────────────────────────────────────────

export async function createJiraIssue(
  registry: ConnectorRegistry | null,
  input: {
    readonly projectKey: string;
    readonly summary: string;
    readonly description?: string;
    readonly issueType?: string;
  },
): Promise<
  ConnectorToolResult<{ readonly key: string; readonly id: string; readonly url: string }>
> {
  const creds = readConnectorCreds(registry, "jira");
  if (!creds.ok) return creds.err;
  const domain = creds.creds["domain"];
  const email = creds.creds["email"];
  const token = creds.creds["apiToken"] ?? creds.creds["token"];
  if (!domain || !email || !token)
    return errEnv("not_configured", "jira needs domain, email, apiToken");
  const body = {
    fields: {
      project: { key: input.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType ?? "Task" },
      ...(input.description
        ? {
            description: {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: input.description }] },
              ],
            },
          }
        : {}),
    },
  };
  try {
    const res = await guardedFetch(`https://${domain}.atlassian.net/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { key: string; id: string };
    return {
      ok: true,
      data: {
        key: parsed.key,
        id: parsed.id,
        url: `https://${domain}.atlassian.net/browse/${parsed.key}`,
      },
    };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Linear ──────────────────────────────────────────────────

async function linearGraphql(
  creds: Readonly<Record<string, string>>,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; err: ConnectorToolErr }> {
  const apiKey = creds["apiKey"] ?? creds["token"];
  if (!apiKey) return { ok: false, err: errEnv("not_configured", "linear needs apiKey") };
  try {
    const res = await guardedFetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return { ok: false, err: httpErr(res.status, res.body) };
    const parsed = JSON.parse(res.body) as { data?: unknown; errors?: unknown };
    if (parsed.errors)
      return {
        ok: false,
        err: errEnv("upstream_error", JSON.stringify(parsed.errors).slice(0, 200)),
      };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, err: catchErr(err) };
  }
}

export async function createLinearIssue(
  registry: ConnectorRegistry | null,
  input: {
    readonly teamId: string;
    readonly title: string;
    readonly description?: string;
    readonly priority?: number;
  },
): Promise<
  ConnectorToolResult<{ readonly id: string; readonly identifier: string; readonly url: string }>
> {
  const creds = readConnectorCreds(registry, "linear");
  if (!creds.ok) return creds.err;
  const res = await linearGraphql(
    creds.creds,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier url } }
    }`,
    {
      input: {
        teamId: input.teamId,
        title: input.title,
        description: input.description,
        priority: input.priority,
      },
    },
  );
  if (!res.ok) return res.err;
  const data = res.data as {
    issueCreate?: { issue?: { id: string; identifier: string; url: string } };
  };
  const issue = data.issueCreate?.issue;
  if (!issue) return errEnv("upstream_error", "issueCreate returned no issue");
  return { ok: true, data: issue };
}

export async function commentLinearIssue(
  registry: ConnectorRegistry | null,
  input: { readonly issueId: string; readonly body: string },
): Promise<ConnectorToolResult<{ readonly id: string }>> {
  const creds = readConnectorCreds(registry, "linear");
  if (!creds.ok) return creds.err;
  const res = await linearGraphql(
    creds.creds,
    `mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id } }
    }`,
    { input: { issueId: input.issueId, body: input.body } },
  );
  if (!res.ok) return res.err;
  const data = res.data as { commentCreate?: { comment?: { id: string } } };
  const comment = data.commentCreate?.comment;
  if (!comment) return errEnv("upstream_error", "commentCreate returned no comment");
  return { ok: true, data: { id: comment.id } };
}

// ── Notion ──────────────────────────────────────────────────

const NOTION_VERSION = "2022-06-28";

function notionHeaders(creds: Readonly<Record<string, string>>): Record<string, string> | null {
  const apiKey = creds["apiKey"] ?? creds["token"];
  if (!apiKey) return null;
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function markdownToNotionBlocks(md: string): readonly Record<string, unknown>[] {
  return md
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: line.slice(0, 2000) } }],
      },
    }));
}

export async function createNotionPage(
  registry: ConnectorRegistry | null,
  input: { readonly parentPageId: string; readonly title: string; readonly content?: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly url: string }>> {
  const creds = readConnectorCreds(registry, "notion");
  if (!creds.ok) return creds.err;
  const headers = notionHeaders(creds.creds);
  if (!headers) return errEnv("not_configured", "notion needs apiKey");
  const body = {
    parent: { page_id: input.parentPageId },
    properties: {
      title: { title: [{ type: "text", text: { content: input.title } }] },
    },
    ...(input.content ? { children: markdownToNotionBlocks(input.content) } : {}),
  };
  try {
    const res = await guardedFetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string; url: string };
    return { ok: true, data: { id: parsed.id, url: parsed.url } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function updateNotionPage(
  registry: ConnectorRegistry | null,
  input: { readonly pageId: string; readonly content: string },
): Promise<ConnectorToolResult<{ readonly blocksAdded: number }>> {
  const creds = readConnectorCreds(registry, "notion");
  if (!creds.ok) return creds.err;
  const headers = notionHeaders(creds.creds);
  if (!headers) return errEnv("not_configured", "notion needs apiKey");
  const blocks = markdownToNotionBlocks(input.content);
  try {
    const res = await guardedFetch(`https://api.notion.com/v1/blocks/${input.pageId}/children`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ children: blocks }),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    return { ok: true, data: { blocksAdded: blocks.length } };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Confluence ──────────────────────────────────────────────

export async function createConfluencePage(
  registry: ConnectorRegistry | null,
  input: { readonly spaceKey: string; readonly title: string; readonly body: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly url: string }>> {
  const creds = readConnectorCreds(registry, "confluence");
  if (!creds.ok) return creds.err;
  const domain = creds.creds["domain"];
  const email = creds.creds["email"];
  const token = creds.creds["apiToken"] ?? creds.creds["token"];
  if (!domain || !email || !token)
    return errEnv("not_configured", "confluence needs domain, email, apiToken");
  const baseUrl = domain.includes("://") ? domain : `https://${domain}`;
  const body = {
    type: "page",
    title: input.title,
    space: { key: input.spaceKey },
    body: { storage: { value: input.body, representation: "storage" } },
  };
  try {
    const res = await guardedFetch(`${baseUrl}/wiki/rest/api/content`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string; _links?: { webui?: string } };
    return {
      ok: true,
      data: { id: parsed.id, url: `${baseUrl}/wiki${parsed._links?.webui ?? ""}` },
    };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Google Drive ────────────────────────────────────────────

function driveToken(creds: Readonly<Record<string, string>>): string | null {
  return creds["accessToken"] ?? creds["token"] ?? null;
}

export async function listDriveFiles(
  registry: ConnectorRegistry | null,
  input: { readonly query?: string; readonly limit: number },
): Promise<
  ConnectorToolResult<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly mimeType: string;
      readonly modifiedTime: string;
    }>
  >
> {
  const creds = readConnectorCreds(registry, "google-drive");
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken");
  const params = new URLSearchParams({
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: String(Math.min(input.limit, 100)),
    orderBy: "modifiedTime desc",
  });
  if (input.query) params.set("q", input.query);
  try {
    const res = await guardedFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      files?: ReadonlyArray<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime: string;
      }>;
    };
    return { ok: true, data: parsed.files ?? [] };
  } catch (err) {
    return catchErr(err);
  }
}

export async function uploadDrive(
  registry: ConnectorRegistry | null,
  input: { readonly filePath: string; readonly name: string; readonly mimeType?: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly name: string }>> {
  const creds = readConnectorCreds(registry, "google-drive");
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken");
  if (!existsSync(input.filePath)) return errEnv("bad_input", `file not found: ${input.filePath}`);
  const stat = statSync(input.filePath);
  if (!stat.isFile()) return errEnv("bad_input", `not a file: ${input.filePath}`);
  const contents = readFileSync(input.filePath);
  const boundary = `wotann-${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: input.name });
  const mime = input.mimeType ?? "application/octet-stream";
  const bodyParts = [
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    `${meta}\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: ${mime}\r\n\r\n`,
  ].join("");
  const closeBoundary = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(bodyParts, "utf-8"),
    contents,
    Buffer.from(closeBoundary, "utf-8"),
  ]);
  try {
    const res = await guardedFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string; name: string };
    return { ok: true, data: parsed };
  } catch (err) {
    return catchErr(err);
  }
}

export async function downloadDrive(
  registry: ConnectorRegistry | null,
  input: { readonly fileId: string; readonly destPath: string },
): Promise<ConnectorToolResult<{ readonly bytes: number; readonly destPath: string }>> {
  const creds = readConnectorCreds(registry, "google-drive");
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken");
  if (!input.destPath.startsWith("/")) return errEnv("bad_input", "destPath must be absolute");
  const url = `https://www.googleapis.com/drive/v3/files/${input.fileId}?alt=media`;
  if (!isSafeUrl(url)) return errEnv("ssrf_blocked", url);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return httpErr(response.status, await response.text());
    const buf = Buffer.from(await response.arrayBuffer());
    writeFileSync(input.destPath, buf);
    return { ok: true, data: { bytes: buf.length, destPath: input.destPath } };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Slack ───────────────────────────────────────────────────

function slackToken(creds: Readonly<Record<string, string>>): string | null {
  return creds["token"] ?? creds["SLACK_BOT_TOKEN"] ?? null;
}

export async function postSlackMessage(
  registry: ConnectorRegistry | null,
  input: { readonly channel: string; readonly text: string; readonly threadTs?: string },
): Promise<ConnectorToolResult<{ readonly ts: string; readonly channel: string }>> {
  const creds = readConnectorCreds(registry, "slack");
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token");
  const body: Record<string, unknown> = { channel: input.channel, text: input.text };
  if (input.threadTs) body["thread_ts"] = input.threadTs;
  try {
    const res = await guardedFetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      ts?: string;
      channel?: string;
      error?: string;
    };
    if (!parsed.ok) {
      if (parsed.error === "ratelimited") return errEnv("rate_limited", parsed.error);
      if (parsed.error === "invalid_auth" || parsed.error === "not_authed")
        return errEnv("unauthorized", parsed.error);
      return errEnv("upstream_error", parsed.error ?? "slack error");
    }
    return { ok: true, data: { ts: parsed.ts ?? "", channel: parsed.channel ?? input.channel } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function readSlackChannel(
  registry: ConnectorRegistry | null,
  input: { readonly channel: string; readonly limit: number },
): Promise<
  ConnectorToolResult<
    ReadonlyArray<{ readonly ts: string; readonly user: string; readonly text: string }>
  >
> {
  const creds = readConnectorCreds(registry, "slack");
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token");
  try {
    const res = await guardedFetch(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(input.channel)}&limit=${Math.min(input.limit, 200)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      messages?: ReadonlyArray<{ ts: string; user?: string; text?: string }>;
      error?: string;
    };
    if (!parsed.ok) {
      if (parsed.error === "ratelimited") return errEnv("rate_limited", parsed.error);
      if (parsed.error === "invalid_auth" || parsed.error === "not_authed")
        return errEnv("unauthorized", parsed.error);
      return errEnv("upstream_error", parsed.error ?? "slack error");
    }
    return {
      ok: true,
      data: (parsed.messages ?? []).map((m) => ({
        ts: m.ts,
        user: m.user ?? "",
        text: m.text ?? "",
      })),
    };
  } catch (err) {
    return catchErr(err);
  }
}
