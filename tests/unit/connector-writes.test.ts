/**
 * Wave-4C: connector-writes envelope coverage.
 *
 * These tests validate the honest-error contract for every write helper
 * without hitting the real network. They drive the helpers with:
 *
 * 1. A null registry — must return `{ok:false, error:"not_configured"}`
 *    with a `fix` hint naming the missing env var.
 * 2. An empty registry (no connector configured) — same honest
 *    `not_configured` envelope.
 * 3. A registry with a connector configured but credentials stripped —
 *    still `not_configured` (never silent success).
 *
 * SSRF gating is already covered by `tests/security/ssrf-guard.test.ts`
 * for the `isSafeUrl` function itself; this test adds end-to-end
 * coverage by pointing a Jira connector at a cloud-metadata hostname
 * and asserting the wire call is never made.
 */

import { describe, it, expect } from "vitest";
import { ConnectorRegistry } from "../../src/connectors/connector-registry.js";
import { JiraConnector } from "../../src/connectors/jira.js";
import { LinearConnector } from "../../src/connectors/linear.js";
import { NotionConnector } from "../../src/connectors/notion.js";
import { ConfluenceConnector } from "../../src/connectors/confluence.js";
import { GoogleDriveConnector } from "../../src/connectors/google-drive.js";
import { SlackConnector } from "../../src/connectors/slack.js";
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
  appendNotionBlock,
  deleteNotionBlock,
  readNotionPage,
  createConfluencePage,
  updateConfluencePage,
  readConfluencePage,
  commentConfluencePage,
  listDriveFiles,
  uploadDrive,
  downloadDrive,
  shareDrive,
  createDriveFolder,
  postSlackMessage,
  readSlackChannel,
  createSlackChannel,
  uploadSlackFile,
  reactSlackMessage,
} from "../../src/connectors/connector-writes.js";

// ── Null registry ───────────────────────────────────────────

describe("connector-writes — null registry returns honest not_configured", () => {
  const cases: ReadonlyArray<[string, () => Promise<{ ok: boolean }>]> = [
    ["createJiraIssue", () => createJiraIssue(null, { projectKey: "X", summary: "y" })],
    ["updateJiraIssue", () => updateJiraIssue(null, { key: "X-1", summary: "y" })],
    ["commentJiraIssue", () => commentJiraIssue(null, { key: "X-1", body: "hi" })],
    [
      "transitionJiraIssue",
      () => transitionJiraIssue(null, { key: "X-1", transitionId: "2" }),
    ],
    ["createLinearIssue", () => createLinearIssue(null, { teamId: "t", title: "y" })],
    [
      "updateLinearIssue",
      () => updateLinearIssue(null, { issueId: "i", title: "y" }),
    ],
    ["commentLinearIssue", () => commentLinearIssue(null, { issueId: "i", body: "hi" })],
    [
      "setLinearAssignee",
      () => setLinearAssignee(null, { issueId: "i", assigneeId: "u" }),
    ],
    ["readLinearIssue", () => readLinearIssue(null, { id: "i" })],
    [
      "createNotionPage",
      () => createNotionPage(null, { parentPageId: "p", title: "y" }),
    ],
    ["updateNotionPage", () => updateNotionPage(null, { pageId: "p", content: "hi" })],
    ["appendNotionBlock", () => appendNotionBlock(null, { blockId: "b", content: "hi" })],
    ["deleteNotionBlock", () => deleteNotionBlock(null, { blockId: "b" })],
    ["readNotionPage", () => readNotionPage(null, { pageId: "p" })],
    [
      "createConfluencePage",
      () => createConfluencePage(null, { spaceKey: "s", title: "y", body: "b" }),
    ],
    [
      "updateConfluencePage",
      () =>
        updateConfluencePage(null, {
          pageId: "p",
          title: "y",
          body: "b",
          version: 1,
        }),
    ],
    ["readConfluencePage", () => readConfluencePage(null, { pageId: "p" })],
    [
      "commentConfluencePage",
      () => commentConfluencePage(null, { pageId: "p", body: "b" }),
    ],
    ["listDriveFiles", () => listDriveFiles(null, { limit: 5 })],
    [
      "uploadDrive",
      () => uploadDrive(null, { filePath: "/tmp/x", name: "y" }),
    ],
    [
      "downloadDrive",
      () => downloadDrive(null, { fileId: "f", destPath: "/tmp/x" }),
    ],
    ["shareDrive", () => shareDrive(null, { fileId: "f" })],
    ["createDriveFolder", () => createDriveFolder(null, { name: "folder" })],
    [
      "postSlackMessage",
      () => postSlackMessage(null, { channel: "c", text: "t" }),
    ],
    ["readSlackChannel", () => readSlackChannel(null, { channel: "c", limit: 5 })],
    ["createSlackChannel", () => createSlackChannel(null, { name: "n" })],
    [
      "uploadSlackFile",
      () => uploadSlackFile(null, { channel: "c", filePath: "/tmp/x" }),
    ],
    [
      "reactSlackMessage",
      () => reactSlackMessage(null, { channel: "c", timestamp: "1", name: "thumbsup" }),
    ],
  ];
  for (const [label, fn] of cases) {
    it(`${label} returns {ok:false, error:"not_configured"} when registry is null`, async () => {
      const res = await fn();
      expect(res.ok).toBe(false);
      const err = res as { ok: false; error: string; fix?: string };
      expect(err.error).toBe("not_configured");
      expect(err.fix).toBeDefined();
    });
  }
});

// ── Missing connector ───────────────────────────────────────

describe("connector-writes — empty registry returns not_configured", () => {
  it("createJiraIssue fails honestly when jira not registered", async () => {
    const registry = new ConnectorRegistry();
    const res = await createJiraIssue(registry, { projectKey: "WOT", summary: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("not_configured");
      expect(res.fix).toContain("JIRA");
    }
  });
});

// ── Missing credentials (connector registered without token) ───────

describe("connector-writes — connector registered but credentials missing", () => {
  it("jira.create_issue — domain/email/apiToken missing yields not_configured", async () => {
    const registry = new ConnectorRegistry();
    const connector = new JiraConnector();
    registry.register("jira", connector, {
      id: "jira",
      name: "Jira (unconfigured)",
      type: "jira",
      credentials: {},
      enabled: true,
    });
    const res = await createJiraIssue(registry, { projectKey: "WOT", summary: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_configured");
  });

  it("linear.create_issue — apiKey missing yields not_configured", async () => {
    const registry = new ConnectorRegistry();
    registry.register("linear", new LinearConnector(), {
      id: "linear",
      name: "Linear",
      type: "linear",
      credentials: {},
      enabled: true,
    });
    const res = await createLinearIssue(registry, { teamId: "t", title: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_configured");
  });

  it("notion.create_page — apiKey missing yields not_configured", async () => {
    const registry = new ConnectorRegistry();
    registry.register("notion", new NotionConnector(), {
      id: "notion",
      name: "Notion",
      type: "notion",
      credentials: {},
      enabled: true,
    });
    const res = await createNotionPage(registry, { parentPageId: "p", title: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_configured");
  });

  it("confluence.create_page — credentials missing yields not_configured", async () => {
    const registry = new ConnectorRegistry();
    registry.register("confluence", new ConfluenceConnector(), {
      id: "confluence",
      name: "Confluence",
      type: "confluence",
      credentials: {},
      enabled: true,
    });
    const res = await createConfluencePage(registry, {
      spaceKey: "s",
      title: "x",
      body: "b",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_configured");
  });

  it("drive.list_files — accessToken missing yields not_configured", async () => {
    const registry = new ConnectorRegistry();
    registry.register("google-drive", new GoogleDriveConnector(), {
      id: "google-drive",
      name: "Drive",
      type: "google-drive",
      credentials: {},
      enabled: true,
    });
    const res = await listDriveFiles(registry, { limit: 5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_configured");
  });

  it("slack.post_message — token missing yields not_configured", async () => {
    const registry = new ConnectorRegistry();
    registry.register("slack", new SlackConnector(), {
      id: "slack",
      name: "Slack",
      type: "slack",
      credentials: {},
      enabled: true,
    });
    const res = await postSlackMessage(registry, { channel: "c", text: "t" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_configured");
  });
});

// ── Bad input shortcuts (no network) ────────────────────────

describe("connector-writes — bad input surfaces honestly", () => {
  it("updateJiraIssue with no fields returns bad_input", async () => {
    const registry = new ConnectorRegistry();
    registry.register("jira", new JiraConnector(), {
      id: "jira",
      name: "Jira",
      type: "jira",
      credentials: { domain: "acme", email: "a@b.c", apiToken: "t" },
      enabled: true,
    });
    const res = await updateJiraIssue(registry, { key: "WOT-1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_input");
  });

  it("uploadDrive with a non-existent file returns bad_input", async () => {
    const registry = new ConnectorRegistry();
    registry.register("google-drive", new GoogleDriveConnector(), {
      id: "google-drive",
      name: "Drive",
      type: "google-drive",
      credentials: { accessToken: "t" },
      enabled: true,
    });
    const res = await uploadDrive(registry, {
      filePath: "/tmp/wotann-definitely-not-a-real-file-xyz-123",
      name: "x",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_input");
  });

  it("downloadDrive with a non-absolute dest path returns bad_input", async () => {
    const registry = new ConnectorRegistry();
    registry.register("google-drive", new GoogleDriveConnector(), {
      id: "google-drive",
      name: "Drive",
      type: "google-drive",
      credentials: { accessToken: "t" },
      enabled: true,
    });
    const res = await downloadDrive(registry, {
      fileId: "f",
      destPath: "relative/path.txt",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_input");
  });

  it("updateLinearIssue with no fields returns bad_input", async () => {
    const registry = new ConnectorRegistry();
    registry.register("linear", new LinearConnector(), {
      id: "linear",
      name: "Linear",
      type: "linear",
      credentials: { apiKey: "t" },
      enabled: true,
    });
    const res = await updateLinearIssue(registry, { issueId: "i" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_input");
  });

  it("shareDrive with type=user but no emailAddress returns bad_input", async () => {
    const registry = new ConnectorRegistry();
    registry.register("google-drive", new GoogleDriveConnector(), {
      id: "google-drive",
      name: "Drive",
      type: "google-drive",
      credentials: { accessToken: "t" },
      enabled: true,
    });
    const res = await shareDrive(registry, { fileId: "f", type: "user" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_input");
  });
});

// ── SSRF end-to-end ────────────────────────────────────────

describe("connector-writes — SSRF guard rejects metadata hosts", () => {
  it("confluence.create_page with a metadata domain surfaces ssrf_blocked", async () => {
    const registry = new ConnectorRegistry();
    registry.register("confluence", new ConfluenceConnector(), {
      id: "confluence",
      name: "Confluence-evil",
      type: "confluence",
      credentials: {
        // Metadata host — SSRF guard must block before fetch.
        domain: "http://169.254.169.254",
        email: "a@b.c",
        apiToken: "t",
      },
      enabled: true,
    });
    const res = await createConfluencePage(registry, {
      spaceKey: "s",
      title: "t",
      body: "b",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("ssrf_blocked");
  });
});
