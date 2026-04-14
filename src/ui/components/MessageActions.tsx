/**
 * Message actions: per-message action bar with Copy, Retry, Edit, Fork, Delete.
 * Displays inline below a chat message. Retry and Edit are only shown for user messages.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

// ── Types ──────────────────────────────────────────────────────

export type MessageAction = "copy" | "retry" | "edit" | "fork" | "delete";

interface ActionDefinition {
  readonly action: MessageAction;
  readonly label: string;
  readonly icon: string;
  readonly userOnly: boolean;
}

interface MessageActionsProps {
  readonly messageId: string;
  readonly content: string;
  readonly role: "user" | "assistant";
  readonly onAction: (action: MessageAction, messageId: string) => void;
}

// ── Action Definitions ─────────────────────────────────────────

const ALL_ACTIONS: readonly ActionDefinition[] = [
  { action: "copy", label: "Copy", icon: "[C]", userOnly: false },
  { action: "retry", label: "Retry", icon: "[R]", userOnly: true },
  { action: "edit", label: "Edit", icon: "[E]", userOnly: true },
  { action: "fork", label: "Fork", icon: "[F]", userOnly: false },
  { action: "delete", label: "Delete", icon: "[D]", userOnly: false },
];

const ACTION_COLORS: Readonly<Record<MessageAction, string>> = {
  copy: "cyan",
  retry: "yellow",
  edit: "green",
  fork: "magenta",
  delete: "red",
};

// ── Component ──────────────────────────────────────────────────

export function MessageActions({
  messageId,
  content,
  role,
  onAction,
}: MessageActionsProps): React.ReactElement {
  const availableActions = ALL_ACTIONS.filter(
    (a) => !a.userOnly || role === "user",
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const clampedIndex = Math.min(selectedIndex, availableActions.length - 1);

  const handleAction = useCallback(() => {
    const actionDef = availableActions[clampedIndex];
    if (!actionDef) return;

    onAction(actionDef.action, messageId);

    // Show brief feedback text
    const feedbackMessages: Readonly<Record<MessageAction, string>> = {
      copy: "Copied to clipboard",
      retry: "Retrying...",
      edit: "Editing...",
      fork: "Forking conversation...",
      delete: "Deleted",
    };
    setFeedback(feedbackMessages[actionDef.action]);
  }, [availableActions, clampedIndex, messageId, onAction]);

  useInput((input, key) => {
    // Clear feedback on any input
    if (feedback !== null) {
      setFeedback(null);
    }

    if (key.leftArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.rightArrow) {
      setSelectedIndex((prev) => Math.min(availableActions.length - 1, prev + 1));
      return;
    }

    if (key.return) {
      handleAction();
      return;
    }

    // Keyboard shortcuts: first letter of each action
    if (!key.ctrl && !key.meta && input) {
      const shortcut = input.toLowerCase();
      const matchIdx = availableActions.findIndex(
        (a) => a.action[0] === shortcut,
      );
      if (matchIdx >= 0) {
        setSelectedIndex(matchIdx);
        const actionDef = availableActions[matchIdx];
        if (actionDef) {
          onAction(actionDef.action, messageId);
        }
      }
    }
  });

  // Content preview (truncated for context)
  const preview = content.length > 60
    ? content.slice(0, 57) + "..."
    : content;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Context line */}
      <Box gap={1}>
        <Text dimColor>Actions for</Text>
        <Text color={role === "user" ? "blue" : "green"} dimColor>
          {role}
        </Text>
        <Text dimColor>message:</Text>
        <Text dimColor italic>{preview}</Text>
      </Box>

      {/* Action buttons row */}
      <Box gap={2} marginTop={0}>
        {availableActions.map((actionDef, idx) => {
          const isSelected = idx === clampedIndex;
          const color = ACTION_COLORS[actionDef.action];

          return (
            <Box key={actionDef.action} gap={0}>
              <Text
                color={isSelected ? color : "gray"}
                bold={isSelected}
                underline={isSelected}
              >
                {actionDef.icon} {actionDef.label}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Feedback line */}
      {feedback !== null && (
        <Box marginTop={0}>
          <Text color="green" dimColor>{feedback}</Text>
        </Box>
      )}

      {/* Hint line */}
      <Box marginTop={0} gap={1}>
        <Text dimColor>Arrows: navigate</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Enter: execute</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Letter: shortcut</Text>
      </Box>
    </Box>
  );
}
