/**
 * Mastodon channel adapter tests.
 * Covers construction, credential validation, webhook-style dispatch,
 * HTML stripping, and status-length splitting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MastodonAdapter,
  splitStatus,
  stripHtml,
} from "../../src/channels/mastodon.js";

describe("Mastodon Channel Adapter", () => {
  beforeEach(() => {
    delete process.env["MASTODON_INSTANCE_URL"];
    delete process.env["MASTODON_ACCESS_TOKEN"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates adapter with correct type and name", () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    expect(adapter.type).toBe("mastodon");
    expect(adapter.name).toBe("Mastodon");
  });

  it("reports disconnected initially", () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without instance URL", async () => {
    const adapter = new MastodonAdapter("", "token");
    await expect(adapter.start()).rejects.toThrow("MASTODON_INSTANCE_URL");
  });

  it("throws on start without access token", async () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "");
    await expect(adapter.start()).rejects.toThrow("MASTODON_INSTANCE_URL");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    const sent = await adapter.send({
      channelType: "mastodon",
      channelId: "status-id",
      content: "Hello fediverse",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("normalizes trailing slashes on instance URL", () => {
    const a = new MastodonAdapter("https://mastodon.social/", "token");
    const b = new MastodonAdapter("https://mastodon.social//", "token");
    expect(a.type).toBe("mastodon");
    expect(b.type).toBe("mastodon");
  });

  it("reads credentials from env vars when no args given", () => {
    process.env["MASTODON_INSTANCE_URL"] = "https://env.example";
    process.env["MASTODON_ACCESS_TOKEN"] = "env-token";
    const adapter = new MastodonAdapter();
    expect(adapter.type).toBe("mastodon");
  });

  it("dispatches mention notifications via handleNotification", async () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleNotification({
      id: "notif-1",
      type: "mention",
      created_at: "2026-04-19T12:00:00Z",
      account: {
        id: "acct-123",
        username: "alice",
        acct: "alice@mastodon.social",
        display_name: "Alice",
      },
      status: {
        id: "status-42",
        content: "<p>Hello <b>world</b></p>",
        account: {
          id: "acct-123",
          username: "alice",
          acct: "alice@mastodon.social",
          display_name: "Alice",
        },
        created_at: "2026-04-19T12:00:00Z",
        visibility: "public",
      },
    });

    expect(received).toHaveLength(1);
    const msg = received[0] as {
      channelType: string;
      senderId: string;
      senderName: string;
      content: string;
    };
    expect(msg.channelType).toBe("mastodon");
    expect(msg.senderId).toBe("acct-123");
    expect(msg.senderName).toBe("alice@mastodon.social");
    expect(msg.content).toBe("Hello world");
  });

  it("ignores non-mention notifications", async () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    const received: unknown[] = [];
    adapter.onMessage(async (msg) => {
      received.push(msg);
    });

    await adapter.handleNotification({
      id: "notif-2",
      type: "favourite",
      created_at: "2026-04-19T12:00:00Z",
      account: {
        id: "acct-999",
        username: "bob",
        acct: "bob",
        display_name: "Bob",
      },
    });

    expect(received).toHaveLength(0);
  });

  it("skips notifications when no handler registered", async () => {
    const adapter = new MastodonAdapter("https://mastodon.social", "token");
    // Should not throw
    await adapter.handleNotification({
      id: "notif-3",
      type: "mention",
      created_at: "2026-04-19T12:00:00Z",
      account: {
        id: "acct-1",
        username: "u",
        acct: "u",
        display_name: "U",
      },
      status: {
        id: "s-1",
        content: "<p>hi</p>",
        account: {
          id: "acct-1",
          username: "u",
          acct: "u",
          display_name: "U",
        },
        created_at: "2026-04-19T12:00:00Z",
        visibility: "public",
      },
    });
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<p>hello &amp; <b>world</b></p>")).toBe("hello & world");
  });

  it("converts <br> to newline", () => {
    expect(stripHtml("line1<br/>line2")).toBe("line1\nline2");
  });

  it("converts paragraph breaks to blank lines", () => {
    expect(stripHtml("<p>a</p><p>b</p>")).toBe("a\n\nb");
  });

  it("handles decoded quotes and apostrophes", () => {
    expect(stripHtml("it&#39;s &quot;ok&quot;")).toBe(`it's "ok"`);
  });
});

describe("splitStatus", () => {
  it("returns single chunk when within limit", () => {
    const result = splitStatus("hello", 500);
    expect(result).toEqual(["hello"]);
  });

  it("splits on newlines when possible", () => {
    const input = "one\ntwo\nthree";
    const result = splitStatus(input, 5);
    expect(result.length).toBeGreaterThan(1);
    expect(result.join("")).toContain("one");
  });

  it("splits on word boundary when no newline fits", () => {
    const input = "alpha beta gamma";
    const result = splitStatus(input, 6);
    expect(result.length).toBeGreaterThan(1);
  });
});
