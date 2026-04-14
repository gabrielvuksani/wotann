import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import {
  DispatchInbox,
  type InboxMessage,
} from "../../src/ui/components/DispatchInbox.js";

// ── Test Helpers ────────────────────────────────────────────

function makeMessage(overrides?: Partial<InboxMessage>): InboxMessage {
  return {
    id: "msg-1",
    channel: "slack",
    sender: "Alice",
    content: "Can you review this PR?",
    timestamp: Date.now() - 120_000, // 2 minutes ago
    priority: "normal",
    status: "unread",
    ...overrides,
  };
}

function makeMessages(count: number): InboxMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeMessage({
      id: `msg-${i + 1}`,
      sender: `User ${i + 1}`,
      content: `Message ${i + 1}`,
      status: i % 2 === 0 ? "unread" : "read",
      priority: i === 0 ? "high" : "normal",
    }),
  );
}

// ── Tests ──────────────────────────────────────────────────

describe("DispatchInbox", () => {
  describe("empty state", () => {
    it("renders empty state message when no messages", () => {
      const { lastFrame } = render(<DispatchInbox messages={[]} />);
      const output = lastFrame();

      expect(output).toContain("Dispatch Inbox");
      expect(output).toContain("No messages");
    });

    it("does not render unread count when empty", () => {
      const { lastFrame } = render(<DispatchInbox messages={[]} />);
      expect(lastFrame()).not.toContain("unread");
    });
  });

  describe("message rendering", () => {
    it("renders a single message with sender and channel", () => {
      const msg = makeMessage({
        sender: "Bob",
        channel: "discord",
        content: "Hello there",
      });

      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);
      const output = lastFrame();

      expect(output).toContain("Bob");
      expect(output).toContain("[discord]");
    });

    it("displays unread count in header", () => {
      const messages = [
        makeMessage({ id: "1", status: "unread" }),
        makeMessage({ id: "2", status: "unread" }),
        makeMessage({ id: "3", status: "read" }),
      ];

      const { lastFrame } = render(<DispatchInbox messages={messages} />);
      expect(lastFrame()).toContain("2 unread");
    });

    it("truncates long message content", () => {
      const longContent = "A".repeat(100);
      const msg = makeMessage({ content: longContent });

      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);
      const output = lastFrame();

      // Should not contain the full 100 chars
      expect(output).not.toContain(longContent);
    });

    it("respects maxVisible prop", () => {
      const messages = makeMessages(10);

      const { lastFrame } = render(
        <DispatchInbox messages={messages} maxVisible={3} />,
      );
      const output = lastFrame();

      // Should show the overflow indicator
      expect(output).toContain("more messages");
    });

    it("does not show overflow indicator when all messages visible", () => {
      const messages = makeMessages(3);

      const { lastFrame } = render(
        <DispatchInbox messages={messages} maxVisible={8} />,
      );
      const output = lastFrame();

      expect(output).not.toContain("more messages");
    });
  });

  describe("status icons", () => {
    it("shows unread indicator for unread messages", () => {
      const msg = makeMessage({ status: "unread" });
      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);

      // The unread icon is a filled circle
      expect(lastFrame()).toContain("\u25CF"); // filled circle
    });

    it("shows read indicator for read messages", () => {
      const msg = makeMessage({ status: "read" });
      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);

      expect(lastFrame()).toContain("\u25CB"); // empty circle
    });
  });

  describe("keyboard controls hint", () => {
    it("shows control hints when messages exist", () => {
      const msg = makeMessage();
      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);
      const output = lastFrame();

      expect(output).toContain("[r]eply");
      expect(output).toContain("[s]nooze");
      expect(output).toContain("[e]scalate");
    });

    it("does not show control hints when empty", () => {
      const { lastFrame } = render(<DispatchInbox messages={[]} />);
      expect(lastFrame()).not.toContain("[r]eply");
    });
  });

  describe("timestamp formatting", () => {
    it("shows 'just now' for very recent messages", () => {
      const msg = makeMessage({ timestamp: Date.now() - 10_000 }); // 10s ago
      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);

      expect(lastFrame()).toContain("just now");
    });

    it("shows minutes for messages within an hour", () => {
      const msg = makeMessage({ timestamp: Date.now() - 300_000 }); // 5 min ago
      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);

      expect(lastFrame()).toContain("5m ago");
    });

    it("shows hours for messages within a day", () => {
      const msg = makeMessage({ timestamp: Date.now() - 7_200_000 }); // 2 hours ago
      const { lastFrame } = render(<DispatchInbox messages={[msg]} />);

      expect(lastFrame()).toContain("2h ago");
    });
  });

  describe("callbacks", () => {
    it("accepts onReply callback without crashing", () => {
      const onReply = vi.fn();
      const msg = makeMessage();

      expect(() =>
        render(<DispatchInbox messages={[msg]} onReply={onReply} />),
      ).not.toThrow();
    });

    it("accepts onSnooze callback without crashing", () => {
      const onSnooze = vi.fn();
      const msg = makeMessage();

      expect(() =>
        render(<DispatchInbox messages={[msg]} onSnooze={onSnooze} />),
      ).not.toThrow();
    });

    it("accepts onEscalate callback without crashing", () => {
      const onEscalate = vi.fn();
      const msg = makeMessage();

      expect(() =>
        render(<DispatchInbox messages={[msg]} onEscalate={onEscalate} />),
      ).not.toThrow();
    });
  });

  describe("priority display", () => {
    it("renders high-priority messages distinctly", () => {
      const highMsg = makeMessage({ id: "high", priority: "high", sender: "Urgent" });
      const normalMsg = makeMessage({ id: "normal", priority: "normal", sender: "Normal" });

      const { lastFrame } = render(
        <DispatchInbox messages={[highMsg, normalMsg]} />,
      );
      const output = lastFrame();

      expect(output).toContain("Urgent");
      expect(output).toContain("Normal");
    });
  });

  describe("selection indicator", () => {
    it("shows selection arrow on first message by default", () => {
      const messages = makeMessages(3);

      const { lastFrame } = render(<DispatchInbox messages={messages} />);

      // The first item should have the selection indicator
      expect(lastFrame()).toContain("\u25B8"); // right-pointing triangle
    });
  });
});
