/**
 * Channel adapter convention test — replaces the deleted
 * echo-channel-adapter.test.ts and locks in the decision from
 * MASTER_PLAN_V8.md §6 P2 polish: "Channel adapter consolidation
 * (migrate to BaseChannelAdapter OR delete base-adapter.ts)".
 *
 * DECISION: DELETE. The `BaseChannelAdapter` abstract class (from
 * `src/channels/base-adapter.ts`) had exactly 1 extender
 * (`EchoChannelAdapter`) out of 31 channel adapters (~3%). That
 * extender was itself "audit theater" — explicitly added only to
 * close the "BaseChannelAdapter has 0 extenders" finding
 * (see src/lib.ts before the deletion commit). The class's API
 * surface (`doConnect/doDisconnect/doSend` with `OutboundMessage`
 * carrying `recipientId`) is incompatible with both production
 * `ChannelAdapter` interfaces (`adapter.ts` and `gateway.ts`), so
 * no real adapter could migrate without a full rewrite.
 *
 * This test pins:
 *   1. Real adapters implement one of the two blessed ChannelAdapter
 *      interfaces from `adapter.ts` (start/stop/isConnected) or
 *      `gateway.ts` (connect/disconnect/connected).
 *   2. The deleted modules are not re-committed — verified via
 *      `git ls-files`, which is authoritative against the repo
 *      index (and immune to ShadowGit test-setup resurrection of
 *      untracked copies on disk).
 *   3. `src/lib.ts` no longer re-exports the removed symbols.
 *   4. No TRACKED source file in src/channels/ imports the removed
 *      modules — deletion firewall against re-introduction.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

// Sample representative adapters from both blessed paths:
import { SlackAdapter } from "../../src/channels/slack.js";
import { TelegramAdapter } from "../../src/channels/telegram.js";
import { DiscordAdapter } from "../../src/channels/discord.js";
import { SignalAdapter } from "../../src/channels/signal.js";
import { EmailAdapter } from "../../src/channels/email.js";
import { WebhookAdapter } from "../../src/channels/webhook.js";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Read the repo's tracked-files set. This is the authoritative
 * "what's committed" answer — ShadowGit may resurrect deleted
 * files as UNTRACKED copies during test runs (it snapshots the
 * workspace for checkpoint/restore), so disk-existsSync is not
 * a reliable source of truth. git ls-files only lists paths in
 * the index.
 *
 * Uses execFileSync (no shell) for safety — no user input is
 * involved but this matches the repo's security convention.
 */
function trackedFiles(): Set<string> {
  const raw = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  return new Set(raw.split("\n").filter(Boolean));
}

describe("channel adapter convention — post-base-adapter deletion", () => {
  it("src/channels/base-adapter.ts is not tracked by git", () => {
    const tracked = trackedFiles();
    expect(tracked.has("src/channels/base-adapter.ts")).toBe(false);
  });

  it("src/channels/echo-channel-adapter.ts is not tracked by git", () => {
    const tracked = trackedFiles();
    expect(tracked.has("src/channels/echo-channel-adapter.ts")).toBe(false);
  });

  it("tests/channels/echo-channel-adapter.test.ts is not tracked by git", () => {
    const tracked = trackedFiles();
    expect(tracked.has("tests/channels/echo-channel-adapter.test.ts")).toBe(false);
  });

  it("src/lib.ts does not re-export BaseChannelAdapter or EchoChannelAdapter", async () => {
    const libContent = await readFile(join(REPO_ROOT, "src/lib.ts"), "utf-8");
    // No exports and no imports of the removed modules. We tolerate the
    // word appearing inside an intentional `// removed:` comment by
    // checking for actual `export {...BaseChannelAdapter...}` statements
    // and `from "./channels/base-adapter"` import specifiers.
    expect(libContent).not.toMatch(/export\s*\{[^}]*BaseChannelAdapter/);
    expect(libContent).not.toMatch(/export\s*\{[^}]*EchoChannelAdapter/);
    expect(libContent).not.toMatch(/from\s+["'][^"']*channels\/base-adapter/);
    expect(libContent).not.toMatch(/from\s+["'][^"']*channels\/echo-channel-adapter/);
  });

  it("Slack, Telegram, Discord conform to the adapter.ts ChannelAdapter shape", () => {
    // adapter.ts ChannelAdapter: start/stop/send/onMessage/isConnected + readonly type, name
    const slack = new SlackAdapter("bot-token", "app-token");
    const tele = new TelegramAdapter("tg-token");
    const disc = new DiscordAdapter("dc-token");

    for (const a of [slack, tele, disc]) {
      expect(typeof a.start).toBe("function");
      expect(typeof a.stop).toBe("function");
      expect(typeof a.send).toBe("function");
      expect(typeof a.onMessage).toBe("function");
      expect(typeof a.isConnected).toBe("function");
      expect(typeof a.type).toBe("string");
      expect(typeof a.name).toBe("string");
      expect(a.isConnected()).toBe(false);
    }
  });

  it("Signal, Email, Webhook conform to the gateway.ts ChannelAdapter shape", () => {
    // gateway.ts ChannelAdapter: connect/disconnect/send/onMessage + connected + readonly type, name
    const signal = new SignalAdapter({ phoneNumber: "+15555555555" });
    const email = new EmailAdapter({
      imap: { host: "imap.example.com", port: 993, user: "u", password: "p", tls: true },
      smtp: { host: "smtp.example.com", port: 587, user: "u", password: "p", secure: false },
      fromAddress: "bot@example.com",
    });
    const webhook = new WebhookAdapter({
      port: 0,
      host: "127.0.0.1",
      path: "/webhook",
      secret: "s",
    });

    for (const a of [signal, email, webhook]) {
      expect(typeof a.connect).toBe("function");
      expect(typeof a.disconnect).toBe("function");
      expect(typeof a.send).toBe("function");
      expect(typeof a.onMessage).toBe("function");
      expect(typeof a.type).toBe("string");
      expect(typeof a.name).toBe("string");
      expect(a.connected).toBe(false);
    }
  });

  it("no tracked source file imports from base-adapter or echo-channel-adapter", async () => {
    // Scan only git-tracked .ts files in src/channels/ + src/lib.ts.
    // Using the tracked set filters out ShadowGit-resurrected untracked
    // copies that a disk walk would pick up.
    const tracked = trackedFiles();
    const targets: string[] = [];
    for (const rel of tracked) {
      if (rel === "src/lib.ts") targets.push(rel);
      else if (rel.startsWith("src/channels/") && rel.endsWith(".ts")) targets.push(rel);
    }

    const offenders: string[] = [];
    for (const rel of targets) {
      const content = await readFile(join(REPO_ROOT, rel), "utf-8");
      // Match `from "./base-adapter"`, `from "./base-adapter.js"`, etc.
      if (/from\s+["'][^"']*\/base-adapter(\.js)?["']/.test(content)) {
        offenders.push(`${rel}: imports base-adapter`);
      }
      if (/from\s+["'][^"']*\/echo-channel-adapter(\.js)?["']/.test(content)) {
        offenders.push(`${rel}: imports echo-channel-adapter`);
      }
    }
    expect(offenders, `Stale imports after deletion:\n${offenders.join("\n")}`).toEqual([]);
  });
});
