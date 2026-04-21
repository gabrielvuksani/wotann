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
 * (see src/lib.ts:1351 prior to the deletion commit). The class's
 * API surface (`doConnect/doDisconnect/doSend` with `OutboundMessage`
 * carrying `recipientId`) is incompatible with both production
 * `ChannelAdapter` interfaces (`adapter.ts` and `gateway.ts`), so
 * no real adapter could migrate without a full rewrite.
 *
 * This test pins:
 *   1. Real adapters implement one of the two blessed ChannelAdapter
 *      interfaces from `adapter.ts` (start/stop/isConnected) or
 *      `gateway.ts` (connect/disconnect/connected).
 *   2. `base-adapter.ts` and `echo-channel-adapter.ts` are absent —
 *      preventing re-introduction without deliberate decision.
 *   3. `lib.ts` no longer re-exports `BaseChannelAdapter` /
 *      `EchoChannelAdapter`.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

// Sample representative adapters from both blessed paths:
import { SlackAdapter } from "../../src/channels/slack.js";
import { TelegramAdapter } from "../../src/channels/telegram.js";
import { DiscordAdapter } from "../../src/channels/discord.js";
import { SignalAdapter } from "../../src/channels/signal.js";
import { EmailAdapter } from "../../src/channels/email.js";
import { WebhookAdapter } from "../../src/channels/webhook.js";

const REPO_ROOT = join(__dirname, "..", "..");

describe("channel adapter convention — post-base-adapter deletion", () => {
  it("BaseChannelAdapter source file is absent", () => {
    const baseAdapterPath = join(REPO_ROOT, "src/channels/base-adapter.ts");
    expect(existsSync(baseAdapterPath)).toBe(false);
  });

  it("EchoChannelAdapter source file is absent", () => {
    const echoPath = join(REPO_ROOT, "src/channels/echo-channel-adapter.ts");
    expect(existsSync(echoPath)).toBe(false);
  });

  it("lib.ts does not re-export BaseChannelAdapter or EchoChannelAdapter", async () => {
    const libContent = await readFile(join(REPO_ROOT, "src/lib.ts"), "utf-8");
    expect(libContent).not.toMatch(/BaseChannelAdapter/);
    expect(libContent).not.toMatch(/EchoChannelAdapter/);
    expect(libContent).not.toMatch(/base-adapter/);
    expect(libContent).not.toMatch(/echo-channel-adapter/);
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

  it("no source file in src/channels/ or src/lib.ts imports from base-adapter or echo-channel-adapter", async () => {
    // Targeted scan of the only dirs that ever referenced these modules.
    // A broad glob would be wider but pulls in extra deps; a focused
    // readdir is sufficient because external callers never imported
    // these modules — they were re-exported from src/lib.ts only.
    const { readdir } = await import("node:fs/promises");
    const targets: string[] = [];
    const channelsDir = join(REPO_ROOT, "src/channels");
    for (const entry of await readdir(channelsDir)) {
      if (entry.endsWith(".ts")) targets.push(join(channelsDir, entry));
    }
    targets.push(join(REPO_ROOT, "src/lib.ts"));

    const offenders: string[] = [];
    for (const abs of targets) {
      const content = await readFile(abs, "utf-8");
      // Match `from "./base-adapter"`, `from "./base-adapter.js"`, etc.
      if (/from\s+["'][^"']*\/base-adapter(\.js)?["']/.test(content)) {
        offenders.push(`${abs}: imports base-adapter`);
      }
      if (/from\s+["'][^"']*\/echo-channel-adapter(\.js)?["']/.test(content)) {
        offenders.push(`${abs}: imports echo-channel-adapter`);
      }
    }
    expect(offenders, `Stale imports after deletion:\n${offenders.join("\n")}`).toEqual([]);
  });
});
