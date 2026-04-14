/**
 * Dispatch Inbox: shows inbound channel messages with triage actions.
 * Provides reply, snooze, and escalate actions for each message.
 * Displays in the TUI sidebar as a toggleable panel.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// ── Types ──────────────────────────────────────────────────────

export interface InboxMessage {
  readonly id: string;
  readonly channel: string;
  readonly sender: string;
  readonly content: string;
  readonly timestamp: number;
  readonly priority: "high" | "normal" | "low";
  readonly status: "unread" | "read" | "snoozed" | "replied" | "escalated";
}

interface DispatchInboxProps {
  readonly messages: readonly InboxMessage[];
  readonly onReply?: (messageId: string) => void;
  readonly onSnooze?: (messageId: string) => void;
  readonly onEscalate?: (messageId: string) => void;
  readonly maxVisible?: number;
}

// ── Helpers ────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function priorityColor(p: InboxMessage["priority"]): string {
  if (p === "high") return "red";
  if (p === "normal") return "yellow";
  return "gray";
}

function statusIcon(s: InboxMessage["status"]): string {
  if (s === "unread") return "●";
  if (s === "read") return "○";
  if (s === "snoozed") return "◑";
  if (s === "replied") return "✓";
  return "↑";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// ── Component ──────────────────────────────────────────────────

export function DispatchInbox({
  messages,
  onReply,
  onSnooze,
  onEscalate,
  maxVisible = 8,
}: DispatchInboxProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const visibleMessages = messages.slice(0, maxVisible);
  const unreadCount = messages.filter(m => m.status === "unread").length;

  useInput((_input, key) => {
    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
    if (key.downArrow && selectedIndex < visibleMessages.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
    if (_input === "r" && visibleMessages[selectedIndex]) {
      onReply?.(visibleMessages[selectedIndex].id);
    }
    if (_input === "s" && visibleMessages[selectedIndex]) {
      onSnooze?.(visibleMessages[selectedIndex].id);
    }
    if (_input === "e" && visibleMessages[selectedIndex]) {
      onEscalate?.(visibleMessages[selectedIndex].id);
    }
  });

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">📬 Dispatch Inbox</Text>
        <Text color="gray" dimColor>No messages</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color="cyan">📬 Dispatch Inbox</Text>
        <Text color="gray"> ({unreadCount} unread)</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleMessages.map((msg, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={msg.id} flexDirection="column">
              <Box>
                <Text color={isSelected ? "white" : "gray"}>
                  {isSelected ? "▸ " : "  "}
                </Text>
                <Text color={priorityColor(msg.priority)}>
                  {statusIcon(msg.status)}
                </Text>
                <Text color="blue"> [{msg.channel}]</Text>
                <Text bold={msg.status === "unread"} color={isSelected ? "white" : undefined}>
                  {" "}{msg.sender}
                </Text>
                <Text color="gray"> {formatTimestamp(msg.timestamp)}</Text>
              </Box>
              <Box marginLeft={4}>
                <Text color="gray" wrap="truncate">
                  {truncate(msg.content, 60)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      {messages.length > maxVisible && (
        <Text color="gray" dimColor>
          +{messages.length - maxVisible} more messages
        </Text>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          [r]eply  [s]nooze  [e]scalate  ↑↓ navigate
        </Text>
      </Box>
    </Box>
  );
}

export default DispatchInbox;
