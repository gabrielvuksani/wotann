/**
 * Connector Writes — typed HTTP writers for every connector operation
 * that mutates or fetches data outside the read-side ingestion path.
 *
 * Every outbound request flows through `guardedFetch` (which wraps
 * `assertOutboundUrl` from `security/ssrf-guard.ts`) so a malicious or
 * mis-configured connector cannot be tricked into leaking credentials
 * to cloud-metadata endpoints or internal IPs.
 *
 * Credentials are sourced from the connector's own `ConnectorConfig.credentials`
 * — never from tool input. Tool input only carries operation-specific
 * fields (issue title, file path, etc.).
 *
 * All functions return the `ConnectorToolResult` envelope from
 * connector-tools.ts — honest `{ok:false, error: ..., fix?, detail?}`
 * surfaces on upstream failure, SSRF denial, bad input, missing auth,
 * rate-limit, not-found, or 401/403.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import type { ConnectorConfig, ConnectorRegistry } from "./connector-registry.js";
import type {
  ConnectorToolErr,
  ConnectorToolErrCode,
  ConnectorToolResult,
} from "./connector-tools.js";
import { guardedFetch } from "./guarded-fetch.js";
import { SSRFBlockedError } from "../security/ssrf-guard.js";

// ── Envelope helpers ────────────────────────────────────────

function errEnv(error: ConnectorToolErrCode, detail?: string, fix?: string): ConnectorToolErr {
  return {
    ok: false,
    error,
    ...(fix !== undefined ? { fix } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
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
  envVar: string,
): { ok: true; creds: Readonly<Record<string, string>> } | { ok: false; err: ConnectorToolErr } {
  if (!registry)
    return {
      ok: false,
      err: errEnv("not_configured", "no connector registry", `Set ${envVar} in env`),
    };
  const c = registry.get(id);
  if (!c)
    return {
      ok: false,
      err: errEnv("not_configured", `${id} not configured`, `Set ${envVar} in env`),
    };
  const config = (c as unknown as { config: ConnectorConfig | null }).config;
  if (!config)
    return {
      ok: false,
      err: errEnv("not_configured", `${id} has no credentials`, `Set ${envVar} in env`),
    };
  return { ok: true, creds: config.credentials };
}

/**
 * Run an SSRF-guarded fetch and read its body as text. Returns the raw
 * HTTP envelope so callers can branch on status. Throws `SSRFBlockedError`
 * or network errors — callers should wrap in `catchErr`.
 */
async function sendGuarded(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await guardedFetch(url, init);
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

function httpErr(status: number, body: string): ConnectorToolErr {
  if (status === 401 || status === 403)
    return errEnv("unauthorized", `HTTP ${status}: ${body.slice(0, 200)}`);
  if (status === 404) return errEnv("not_found", `HTTP 404: ${body.slice(0, 200)}`);
  if (status === 429) return errEnv("rate_limited", `HTTP 429: ${body.slice(0, 200)}`);
  return errEnv("upstream_error", `HTTP ${status}: ${body.slice(0, 200)}`);
}

function catchErr(err: unknown): ConnectorToolErr {
  if (err instanceof SSRFBlockedError) return errEnv("ssrf_blocked", err.message);
  const message = err instanceof Error ? err.message : String(err);
  return errEnv(message.startsWith("SSRF blocked") ? "ssrf_blocked" : "upstream_error", message);
}

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

// ── Jira ────────────────────────────────────────────────────

const FIX_JIRA = "Set JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN in env";

function jiraAuth(
  creds: Readonly<Record<string, string>>,
): { ok: true; base: string; auth: string } | { ok: false; err: ConnectorToolErr } {
  const domain = creds["domain"];
  const email = creds["email"];
  const token = creds["apiToken"] ?? creds["token"];
  if (!domain || !email || !token)
    return {
      ok: false,
      err: errEnv("not_configured", "jira needs domain, email, apiToken", FIX_JIRA),
    };
  return { ok: true, base: `https://${domain}.atlassian.net`, auth: basicAuth(email, token) };
}

function jiraHeaders(auth: string): Record<string, string> {
  return {
    Authorization: auth,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function toAdf(text: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

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
  const creds = readConnectorCreds(registry, "jira", FIX_JIRA);
  if (!creds.ok) return creds.err;
  const a = jiraAuth(creds.creds);
  if (!a.ok) return a.err;
  const body = {
    fields: {
      project: { key: input.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType ?? "Task" },
      ...(input.description ? { description: toAdf(input.description) } : {}),
    },
  };
  try {
    const res = await sendGuarded(`${a.base}/rest/api/3/issue`, {
      method: "POST",
      headers: jiraHeaders(a.auth),
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { key: string; id: string };
    return {
      ok: true,
      data: { key: parsed.key, id: parsed.id, url: `${a.base}/browse/${parsed.key}` },
    };
  } catch (err) {
    return catchErr(err);
  }
}

export async function updateJiraIssue(
  registry: ConnectorRegistry | null,
  input: {
    readonly key: string;
    readonly summary?: string;
    readonly description?: string;
    readonly labels?: readonly string[];
  },
): Promise<ConnectorToolResult<{ readonly key: string; readonly url: string }>> {
  const creds = readConnectorCreds(registry, "jira", FIX_JIRA);
  if (!creds.ok) return creds.err;
  const a = jiraAuth(creds.creds);
  if (!a.ok) return a.err;
  const fields: Record<string, unknown> = {};
  if (input.summary !== undefined) fields["summary"] = input.summary;
  if (input.description !== undefined) fields["description"] = toAdf(input.description);
  if (input.labels !== undefined) fields["labels"] = [...input.labels];
  if (Object.keys(fields).length === 0)
    return errEnv("bad_input", "at least one of summary, description, labels is required");
  try {
    const res = await sendGuarded(`${a.base}/rest/api/3/issue/${encodeURIComponent(input.key)}`, {
      method: "PUT",
      headers: jiraHeaders(a.auth),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    return { ok: true, data: { key: input.key, url: `${a.base}/browse/${input.key}` } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function commentJiraIssue(
  registry: ConnectorRegistry | null,
  input: { readonly key: string; readonly body: string },
): Promise<ConnectorToolResult<{ readonly id: string }>> {
  const creds = readConnectorCreds(registry, "jira", FIX_JIRA);
  if (!creds.ok) return creds.err;
  const a = jiraAuth(creds.creds);
  if (!a.ok) return a.err;
  try {
    const res = await sendGuarded(
      `${a.base}/rest/api/3/issue/${encodeURIComponent(input.key)}/comment`,
      {
        method: "POST",
        headers: jiraHeaders(a.auth),
        body: JSON.stringify({ body: toAdf(input.body) }),
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string };
    return { ok: true, data: { id: parsed.id } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function transitionJiraIssue(
  registry: ConnectorRegistry | null,
  input: {
    readonly key: string;
    readonly transitionId?: string;
    readonly transitionName?: string;
  },
): Promise<ConnectorToolResult<{ readonly key: string; readonly transitionId: string }>> {
  const creds = readConnectorCreds(registry, "jira", FIX_JIRA);
  if (!creds.ok) return creds.err;
  const a = jiraAuth(creds.creds);
  if (!a.ok) return a.err;
  let id = input.transitionId;
  if (!id) {
    // Resolve transition by name.
    try {
      const res = await sendGuarded(
        `${a.base}/rest/api/3/issue/${encodeURIComponent(input.key)}/transitions`,
        { headers: jiraHeaders(a.auth) },
      );
      if (!res.ok) return httpErr(res.status, res.body);
      const parsed = JSON.parse(res.body) as {
        transitions?: ReadonlyArray<{ id: string; name: string }>;
      };
      const match = (parsed.transitions ?? []).find(
        (t) => t.name.toLowerCase() === (input.transitionName ?? "").toLowerCase(),
      );
      if (!match)
        return errEnv(
          "not_found",
          `no transition named "${input.transitionName}" for ${input.key}`,
        );
      id = match.id;
    } catch (err) {
      return catchErr(err);
    }
  }
  try {
    const res = await sendGuarded(
      `${a.base}/rest/api/3/issue/${encodeURIComponent(input.key)}/transitions`,
      {
        method: "POST",
        headers: jiraHeaders(a.auth),
        body: JSON.stringify({ transition: { id } }),
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    return { ok: true, data: { key: input.key, transitionId: id } };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Linear ──────────────────────────────────────────────────

const FIX_LINEAR = "Set LINEAR_API_KEY in env";

async function linearGraphql(
  creds: Readonly<Record<string, string>>,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; err: ConnectorToolErr }> {
  const apiKey = creds["apiKey"] ?? creds["token"];
  if (!apiKey)
    return { ok: false, err: errEnv("not_configured", "linear needs apiKey", FIX_LINEAR) };
  try {
    const res = await sendGuarded("https://api.linear.app/graphql", {
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
  const creds = readConnectorCreds(registry, "linear", FIX_LINEAR);
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

export async function updateLinearIssue(
  registry: ConnectorRegistry | null,
  input: {
    readonly issueId: string;
    readonly title?: string;
    readonly description?: string;
    readonly stateId?: string;
    readonly priority?: number;
  },
): Promise<
  ConnectorToolResult<{ readonly id: string; readonly identifier: string; readonly url: string }>
> {
  const creds = readConnectorCreds(registry, "linear", FIX_LINEAR);
  if (!creds.ok) return creds.err;
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload["title"] = input.title;
  if (input.description !== undefined) payload["description"] = input.description;
  if (input.stateId !== undefined) payload["stateId"] = input.stateId;
  if (input.priority !== undefined) payload["priority"] = input.priority;
  if (Object.keys(payload).length === 0)
    return errEnv("bad_input", "at least one of title, description, stateId, priority is required");
  const res = await linearGraphql(
    creds.creds,
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id identifier url } }
    }`,
    { id: input.issueId, input: payload },
  );
  if (!res.ok) return res.err;
  const data = res.data as {
    issueUpdate?: { issue?: { id: string; identifier: string; url: string } };
  };
  const issue = data.issueUpdate?.issue;
  if (!issue) return errEnv("upstream_error", "issueUpdate returned no issue");
  return { ok: true, data: issue };
}

export async function commentLinearIssue(
  registry: ConnectorRegistry | null,
  input: { readonly issueId: string; readonly body: string },
): Promise<ConnectorToolResult<{ readonly id: string }>> {
  const creds = readConnectorCreds(registry, "linear", FIX_LINEAR);
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

export async function setLinearAssignee(
  registry: ConnectorRegistry | null,
  input: { readonly issueId: string; readonly assigneeId: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly assigneeId: string }>> {
  const creds = readConnectorCreds(registry, "linear", FIX_LINEAR);
  if (!creds.ok) return creds.err;
  const res = await linearGraphql(
    creds.creds,
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id assignee { id } } }
    }`,
    { id: input.issueId, input: { assigneeId: input.assigneeId } },
  );
  if (!res.ok) return res.err;
  const data = res.data as {
    issueUpdate?: { issue?: { id: string; assignee?: { id: string } } };
  };
  const issue = data.issueUpdate?.issue;
  if (!issue) return errEnv("upstream_error", "issueUpdate returned no issue");
  return { ok: true, data: { id: issue.id, assigneeId: issue.assignee?.id ?? input.assigneeId } };
}

export async function readLinearIssue(
  registry: ConnectorRegistry | null,
  input: { readonly id: string },
): Promise<
  ConnectorToolResult<{
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly description: string | null;
    readonly url: string;
    readonly state: string;
  }>
> {
  const creds = readConnectorCreds(registry, "linear", FIX_LINEAR);
  if (!creds.ok) return creds.err;
  const res = await linearGraphql(
    creds.creds,
    `query($id: String!) {
      issue(id: $id) { id identifier title description url state { name } }
    }`,
    { id: input.id },
  );
  if (!res.ok) return res.err;
  const data = res.data as {
    issue?: {
      id: string;
      identifier: string;
      title: string;
      description: string | null;
      url: string;
      state: { name: string };
    };
  };
  const issue = data.issue;
  if (!issue) return errEnv("not_found", `linear issue ${input.id} not found`);
  return {
    ok: true,
    data: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      state: issue.state.name,
    },
  };
}

// ── Notion ──────────────────────────────────────────────────

const FIX_NOTION = "Set NOTION_API_KEY in env";
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
  const creds = readConnectorCreds(registry, "notion", FIX_NOTION);
  if (!creds.ok) return creds.err;
  const headers = notionHeaders(creds.creds);
  if (!headers) return errEnv("not_configured", "notion needs apiKey", FIX_NOTION);
  const body = {
    parent: { page_id: input.parentPageId },
    properties: {
      title: { title: [{ type: "text", text: { content: input.title } }] },
    },
    ...(input.content ? { children: markdownToNotionBlocks(input.content) } : {}),
  };
  try {
    const res = await sendGuarded("https://api.notion.com/v1/pages", {
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
  const creds = readConnectorCreds(registry, "notion", FIX_NOTION);
  if (!creds.ok) return creds.err;
  const headers = notionHeaders(creds.creds);
  if (!headers) return errEnv("not_configured", "notion needs apiKey", FIX_NOTION);
  const blocks = markdownToNotionBlocks(input.content);
  try {
    const res = await sendGuarded(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(input.pageId)}/children`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ children: blocks }),
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    return { ok: true, data: { blocksAdded: blocks.length } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function readNotionPage(
  registry: ConnectorRegistry | null,
  input: { readonly pageId: string },
): Promise<
  ConnectorToolResult<{
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly blocks: readonly {
      readonly id: string;
      readonly type: string;
      readonly text: string;
    }[];
  }>
> {
  const creds = readConnectorCreds(registry, "notion", FIX_NOTION);
  if (!creds.ok) return creds.err;
  const headers = notionHeaders(creds.creds);
  if (!headers) return errEnv("not_configured", "notion needs apiKey", FIX_NOTION);
  try {
    const pageRes = await sendGuarded(
      `https://api.notion.com/v1/pages/${encodeURIComponent(input.pageId)}`,
      { headers },
    );
    if (!pageRes.ok) return httpErr(pageRes.status, pageRes.body);
    const page = JSON.parse(pageRes.body) as {
      id: string;
      url: string;
      properties?: Record<string, { type: string; title?: readonly { plain_text: string }[] }>;
    };
    const title = extractNotionTitle(page.properties ?? {});
    const blocksRes = await sendGuarded(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(input.pageId)}/children?page_size=100`,
      { headers },
    );
    if (!blocksRes.ok) return httpErr(blocksRes.status, blocksRes.body);
    const blocksData = JSON.parse(blocksRes.body) as {
      results?: ReadonlyArray<{ id: string; type: string } & Record<string, unknown>>;
    };
    const blocks = (blocksData.results ?? []).map((b) => ({
      id: b.id,
      type: b.type,
      text: extractBlockText(b),
    }));
    return { ok: true, data: { id: page.id, url: page.url, title, blocks } };
  } catch (err) {
    return catchErr(err);
  }
}

function extractNotionTitle(
  properties: Record<string, { type: string; title?: readonly { plain_text: string }[] }>,
): string {
  for (const prop of Object.values(properties)) {
    if (prop.type === "title" && prop.title) return prop.title.map((t) => t.plain_text).join("");
  }
  return "Untitled";
}

function extractBlockText(block: { type: string } & Record<string, unknown>): string {
  const payload = block[block.type] as
    | { rich_text?: readonly { plain_text?: string }[] }
    | undefined;
  if (!payload?.rich_text) return "";
  return payload.rich_text.map((t) => t.plain_text ?? "").join("");
}

export async function appendNotionBlock(
  registry: ConnectorRegistry | null,
  input: { readonly blockId: string; readonly content: string },
): Promise<ConnectorToolResult<{ readonly blocksAdded: number }>> {
  // Notion's append-children endpoint is the same for both pages and
  // blocks — Notion treats a page as a block. So we reuse updateNotionPage
  // semantics but keyed off `blockId`.
  return updateNotionPage(registry, { pageId: input.blockId, content: input.content });
}

export async function deleteNotionBlock(
  registry: ConnectorRegistry | null,
  input: { readonly blockId: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly archived: true }>> {
  const creds = readConnectorCreds(registry, "notion", FIX_NOTION);
  if (!creds.ok) return creds.err;
  const headers = notionHeaders(creds.creds);
  if (!headers) return errEnv("not_configured", "notion needs apiKey", FIX_NOTION);
  try {
    const res = await sendGuarded(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(input.blockId)}`,
      { method: "DELETE", headers },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string };
    return { ok: true, data: { id: parsed.id, archived: true as const } };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Confluence ──────────────────────────────────────────────

const FIX_CONFLUENCE = "Set CONFLUENCE_DOMAIN, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN in env";

function confluenceAuth(
  creds: Readonly<Record<string, string>>,
): { ok: true; base: string; auth: string } | { ok: false; err: ConnectorToolErr } {
  const domain = creds["domain"];
  const email = creds["email"];
  const token = creds["apiToken"] ?? creds["token"];
  if (!domain || !email || !token)
    return {
      ok: false,
      err: errEnv("not_configured", "confluence needs domain, email, apiToken", FIX_CONFLUENCE),
    };
  const base = domain.includes("://") ? domain : `https://${domain}`;
  return { ok: true, base, auth: basicAuth(email, token) };
}

export async function createConfluencePage(
  registry: ConnectorRegistry | null,
  input: { readonly spaceKey: string; readonly title: string; readonly body: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly url: string }>> {
  const creds = readConnectorCreds(registry, "confluence", FIX_CONFLUENCE);
  if (!creds.ok) return creds.err;
  const a = confluenceAuth(creds.creds);
  if (!a.ok) return a.err;
  const body = {
    type: "page",
    title: input.title,
    space: { key: input.spaceKey },
    body: { storage: { value: input.body, representation: "storage" } },
  };
  try {
    const res = await sendGuarded(`${a.base}/wiki/rest/api/content`, {
      method: "POST",
      headers: {
        Authorization: a.auth,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string; _links?: { webui?: string } };
    return {
      ok: true,
      data: { id: parsed.id, url: `${a.base}/wiki${parsed._links?.webui ?? ""}` },
    };
  } catch (err) {
    return catchErr(err);
  }
}

export async function updateConfluencePage(
  registry: ConnectorRegistry | null,
  input: {
    readonly pageId: string;
    readonly title: string;
    readonly body: string;
    readonly version: number;
  },
): Promise<
  ConnectorToolResult<{ readonly id: string; readonly url: string; readonly version: number }>
> {
  const creds = readConnectorCreds(registry, "confluence", FIX_CONFLUENCE);
  if (!creds.ok) return creds.err;
  const a = confluenceAuth(creds.creds);
  if (!a.ok) return a.err;
  const body = {
    version: { number: input.version + 1 },
    title: input.title,
    type: "page",
    body: { storage: { value: input.body, representation: "storage" } },
  };
  try {
    const res = await sendGuarded(
      `${a.base}/wiki/rest/api/content/${encodeURIComponent(input.pageId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: a.auth,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      id: string;
      _links?: { webui?: string };
      version?: { number?: number };
    };
    return {
      ok: true,
      data: {
        id: parsed.id,
        url: `${a.base}/wiki${parsed._links?.webui ?? ""}`,
        version: parsed.version?.number ?? input.version + 1,
      },
    };
  } catch (err) {
    return catchErr(err);
  }
}

export async function readConfluencePage(
  registry: ConnectorRegistry | null,
  input: { readonly pageId: string },
): Promise<
  ConnectorToolResult<{
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly version: number;
    readonly url: string;
  }>
> {
  const creds = readConnectorCreds(registry, "confluence", FIX_CONFLUENCE);
  if (!creds.ok) return creds.err;
  const a = confluenceAuth(creds.creds);
  if (!a.ok) return a.err;
  try {
    const res = await sendGuarded(
      `${a.base}/wiki/rest/api/content/${encodeURIComponent(input.pageId)}?expand=body.storage,version`,
      { headers: { Authorization: a.auth, Accept: "application/json" } },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      id: string;
      title: string;
      body?: { storage?: { value: string } };
      version?: { number?: number };
      _links?: { webui?: string };
    };
    return {
      ok: true,
      data: {
        id: parsed.id,
        title: parsed.title,
        body: parsed.body?.storage?.value ?? "",
        version: parsed.version?.number ?? 1,
        url: `${a.base}/wiki${parsed._links?.webui ?? ""}`,
      },
    };
  } catch (err) {
    return catchErr(err);
  }
}

export async function commentConfluencePage(
  registry: ConnectorRegistry | null,
  input: { readonly pageId: string; readonly body: string },
): Promise<ConnectorToolResult<{ readonly id: string }>> {
  const creds = readConnectorCreds(registry, "confluence", FIX_CONFLUENCE);
  if (!creds.ok) return creds.err;
  const a = confluenceAuth(creds.creds);
  if (!a.ok) return a.err;
  const body = {
    type: "comment",
    container: { id: input.pageId, type: "page" },
    body: { storage: { value: input.body, representation: "storage" } },
  };
  try {
    const res = await sendGuarded(`${a.base}/wiki/rest/api/content`, {
      method: "POST",
      headers: {
        Authorization: a.auth,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string };
    return { ok: true, data: { id: parsed.id } };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Google Drive ────────────────────────────────────────────

const FIX_DRIVE = "Set GOOGLE_DRIVE_ACCESS_TOKEN (or run OAuth flow) in env";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

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
  const creds = readConnectorCreds(registry, "google-drive", FIX_DRIVE);
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken", FIX_DRIVE);
  const params = new URLSearchParams({
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: String(Math.min(input.limit, 100)),
    orderBy: "modifiedTime desc",
  });
  if (input.query) params.set("q", input.query);
  try {
    const res = await sendGuarded(
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
  input: {
    readonly filePath: string;
    readonly name: string;
    readonly mimeType?: string;
    readonly folderId?: string;
  },
): Promise<ConnectorToolResult<{ readonly id: string; readonly name: string }>> {
  const creds = readConnectorCreds(registry, "google-drive", FIX_DRIVE);
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken", FIX_DRIVE);
  if (!existsSync(input.filePath)) return errEnv("bad_input", `file not found: ${input.filePath}`);
  const stat = statSync(input.filePath);
  if (!stat.isFile()) return errEnv("bad_input", `not a file: ${input.filePath}`);
  const contents = readFileSync(input.filePath);
  const boundary = `wotann-${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({
    name: input.name,
    ...(input.folderId ? { parents: [input.folderId] } : {}),
  });
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
    const res = await sendGuarded(
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
  const creds = readConnectorCreds(registry, "google-drive", FIX_DRIVE);
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken", FIX_DRIVE);
  if (!input.destPath.startsWith("/")) return errEnv("bad_input", "destPath must be absolute");
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media`;
  try {
    const response = await guardedFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const body = await response.text();
      return httpErr(response.status, body);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    writeFileSync(input.destPath, buf);
    return { ok: true, data: { bytes: buf.length, destPath: input.destPath } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function shareDrive(
  registry: ConnectorRegistry | null,
  input: {
    readonly fileId: string;
    readonly emailAddress?: string;
    readonly role?: "reader" | "writer" | "commenter" | "owner";
    readonly type?: "user" | "group" | "domain" | "anyone";
  },
): Promise<
  ConnectorToolResult<{ readonly id: string; readonly role: string; readonly type: string }>
> {
  const creds = readConnectorCreds(registry, "google-drive", FIX_DRIVE);
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken", FIX_DRIVE);
  const role = input.role ?? "reader";
  const type = input.type ?? (input.emailAddress ? "user" : "anyone");
  if ((type === "user" || type === "group" || type === "domain") && !input.emailAddress)
    return errEnv("bad_input", `emailAddress is required when type="${type}"`);
  const body: Record<string, unknown> = { role, type };
  if (input.emailAddress) body["emailAddress"] = input.emailAddress;
  try {
    const res = await sendGuarded(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string; role?: string; type?: string };
    return {
      ok: true,
      data: { id: parsed.id, role: parsed.role ?? role, type: parsed.type ?? type },
    };
  } catch (err) {
    return catchErr(err);
  }
}

export async function createDriveFolder(
  registry: ConnectorRegistry | null,
  input: { readonly name: string; readonly parentId?: string },
): Promise<ConnectorToolResult<{ readonly id: string; readonly name: string }>> {
  const creds = readConnectorCreds(registry, "google-drive", FIX_DRIVE);
  if (!creds.ok) return creds.err;
  const token = driveToken(creds.creds);
  if (!token) return errEnv("not_configured", "drive needs accessToken", FIX_DRIVE);
  const body = {
    name: input.name,
    mimeType: DRIVE_FOLDER_MIME,
    ...(input.parentId ? { parents: [input.parentId] } : {}),
  };
  try {
    const res = await sendGuarded("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { id: string; name: string };
    return { ok: true, data: parsed };
  } catch (err) {
    return catchErr(err);
  }
}

// ── Slack ───────────────────────────────────────────────────

const FIX_SLACK = "Set SLACK_BOT_TOKEN in env";

function slackToken(creds: Readonly<Record<string, string>>): string | null {
  return creds["token"] ?? creds["SLACK_BOT_TOKEN"] ?? null;
}

function slackErrFrom(body: { ok: boolean; error?: string }): ConnectorToolErr | null {
  if (body.ok) return null;
  const e = body.error ?? "slack error";
  if (e === "ratelimited") return errEnv("rate_limited", e);
  if (e === "invalid_auth" || e === "not_authed" || e === "token_expired")
    return errEnv("unauthorized", e);
  if (e === "channel_not_found" || e === "message_not_found") return errEnv("not_found", e);
  return errEnv("upstream_error", e);
}

export async function postSlackMessage(
  registry: ConnectorRegistry | null,
  input: { readonly channel: string; readonly text: string; readonly threadTs?: string },
): Promise<ConnectorToolResult<{ readonly ts: string; readonly channel: string }>> {
  const creds = readConnectorCreds(registry, "slack", FIX_SLACK);
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token", FIX_SLACK);
  const body: Record<string, unknown> = { channel: input.channel, text: input.text };
  if (input.threadTs) body["thread_ts"] = input.threadTs;
  try {
    const res = await sendGuarded("https://slack.com/api/chat.postMessage", {
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
    const slackErr = slackErrFrom(parsed);
    if (slackErr) return slackErr;
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
  const creds = readConnectorCreds(registry, "slack", FIX_SLACK);
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token", FIX_SLACK);
  try {
    const res = await sendGuarded(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(input.channel)}&limit=${Math.min(input.limit, 200)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      messages?: ReadonlyArray<{ ts: string; user?: string; text?: string }>;
      error?: string;
    };
    const slackErr = slackErrFrom(parsed);
    if (slackErr) return slackErr;
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

export async function createSlackChannel(
  registry: ConnectorRegistry | null,
  input: { readonly name: string; readonly isPrivate?: boolean },
): Promise<ConnectorToolResult<{ readonly id: string; readonly name: string }>> {
  const creds = readConnectorCreds(registry, "slack", FIX_SLACK);
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token", FIX_SLACK);
  try {
    const res = await sendGuarded("https://slack.com/api/conversations.create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ name: input.name, is_private: input.isPrivate ?? false }),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as {
      ok: boolean;
      channel?: { id: string; name: string };
      error?: string;
    };
    const slackErr = slackErrFrom(parsed);
    if (slackErr) return slackErr;
    if (!parsed.channel) return errEnv("upstream_error", "slack returned no channel");
    return { ok: true, data: { id: parsed.channel.id, name: parsed.channel.name } };
  } catch (err) {
    return catchErr(err);
  }
}

export async function uploadSlackFile(
  registry: ConnectorRegistry | null,
  input: {
    readonly channel: string;
    readonly filePath: string;
    readonly filename?: string;
    readonly title?: string;
    readonly initialComment?: string;
  },
): Promise<ConnectorToolResult<{ readonly id: string; readonly name: string }>> {
  const creds = readConnectorCreds(registry, "slack", FIX_SLACK);
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token", FIX_SLACK);
  if (!existsSync(input.filePath)) return errEnv("bad_input", `file not found: ${input.filePath}`);
  const stat = statSync(input.filePath);
  if (!stat.isFile()) return errEnv("bad_input", `not a file: ${input.filePath}`);

  const filename = input.filename ?? basename(input.filePath);
  // Step 1: getUploadURLExternal to obtain the upload URL.
  try {
    const params = new URLSearchParams({
      filename,
      length: String(stat.size),
    });
    const step1 = await sendGuarded(
      `https://slack.com/api/files.getUploadURLExternal?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!step1.ok) return httpErr(step1.status, step1.body);
    const step1Parsed = JSON.parse(step1.body) as {
      ok: boolean;
      upload_url?: string;
      file_id?: string;
      error?: string;
    };
    const slackErr1 = slackErrFrom(step1Parsed);
    if (slackErr1) return slackErr1;
    if (!step1Parsed.upload_url || !step1Parsed.file_id)
      return errEnv("upstream_error", "slack did not return upload_url");
    // Step 2: PUT file to the presigned URL.
    const fileBytes = readFileSync(input.filePath);
    const step2 = await guardedFetch(step1Parsed.upload_url, {
      method: "POST",
      body: fileBytes,
    });
    if (!step2.ok) {
      const body = await step2.text();
      return httpErr(step2.status, body);
    }
    // Step 3: completeUploadExternal with the file id + channel.
    const completeBody: Record<string, unknown> = {
      files: [
        {
          id: step1Parsed.file_id,
          ...(input.title ? { title: input.title } : {}),
        },
      ],
      channel_id: input.channel,
      ...(input.initialComment ? { initial_comment: input.initialComment } : {}),
    };
    const step3 = await sendGuarded("https://slack.com/api/files.completeUploadExternal", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(completeBody),
    });
    if (!step3.ok) return httpErr(step3.status, step3.body);
    const step3Parsed = JSON.parse(step3.body) as {
      ok: boolean;
      files?: ReadonlyArray<{ id: string; title?: string }>;
      error?: string;
    };
    const slackErr3 = slackErrFrom(step3Parsed);
    if (slackErr3) return slackErr3;
    const file = step3Parsed.files?.[0];
    if (!file) return errEnv("upstream_error", "slack returned no file");
    return { ok: true, data: { id: file.id, name: file.title ?? filename } };
  } catch (err) {
    return catchErr(err);
  }
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export async function reactSlackMessage(
  registry: ConnectorRegistry | null,
  input: { readonly channel: string; readonly timestamp: string; readonly name: string },
): Promise<
  ConnectorToolResult<{
    readonly channel: string;
    readonly timestamp: string;
    readonly name: string;
  }>
> {
  const creds = readConnectorCreds(registry, "slack", FIX_SLACK);
  if (!creds.ok) return creds.err;
  const token = slackToken(creds.creds);
  if (!token) return errEnv("not_configured", "slack needs token", FIX_SLACK);
  // Normalise: strip surrounding colons (Slack wants bare emoji name).
  const name = input.name.replace(/^:/, "").replace(/:$/, "");
  try {
    const res = await sendGuarded("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channel,
        timestamp: input.timestamp,
        name,
      }),
    });
    if (!res.ok) return httpErr(res.status, res.body);
    const parsed = JSON.parse(res.body) as { ok: boolean; error?: string };
    const slackErr = slackErrFrom(parsed);
    if (slackErr) return slackErr;
    return {
      ok: true,
      data: { channel: input.channel, timestamp: input.timestamp, name },
    };
  } catch (err) {
    return catchErr(err);
  }
}
