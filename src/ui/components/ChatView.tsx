/**
 * Chat view: rich message display with role badges, code blocks,
 * tool call formatting, timestamps, and streaming indicator.
 *
 * V9 design polish:
 *   - Role badges pull glyphs + colors from design tokens. Each role
 *     has its own muted-vs-bold balance so the chat scans cleanly.
 *   - The streaming indicator uses the Spinner primitive — same dot
 *     animation as PromptInput / StatusBar, so all "we're working"
 *     surfaces share a single pulse.
 *   - Code-block container uses the rounded-card border style instead
 *     of the bare "single" so embedded code feels like a proper card,
 *     not a sliced rectangle.
 *   - Empty state — no messages — gets a friendly hint instead of a
 *     totally blank chat zone, matching the polish of other surfaces.
 */

import React from "react";
import { Box, Text } from "ink";
import type { AgentMessage } from "../../core/types.js";
import { PALETTES } from "../themes.js";
import { buildTone, glyph, rune, type Tone } from "../theme/tokens.js";
import { Spinner } from "./primitives/index.js";

interface ChatViewProps {
  readonly messages: readonly AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingContent?: string;
  readonly currentModel?: string;
}

interface RoleConfig {
  readonly icon: string;
  readonly accent: keyof Tone;
  readonly label: string;
}

const ROLE_CONFIG: Record<string, RoleConfig> = {
  user: { icon: glyph.pointer, accent: "info", label: "You" },
  assistant: { icon: glyph.badgeAssistant, accent: "primary", label: "WOTANN" },
  system: { icon: glyph.statusActive, accent: "warning", label: "System" },
  tool: { icon: glyph.bullet, accent: "primaryMuted", label: "Tool" },
};

function formatContent(content: string, role: string, tone: Tone): React.ReactElement {
  // System messages get special formatting (box style for command output)
  if (role === "system") {
    // Check if it's a structured command output (contains box-drawing chars or bullet points)
    if (content.includes("╭") || content.includes("│")) {
      return <Text color={tone.warning}>{content}</Text>;
    }
    return <Text color={tone.warning}>{content}</Text>;
  }

  // Split content into code blocks and text
  const parts: React.ReactElement[] = [];
  const segments = content.split(/(```[\s\S]*?```)/g);

  segments.forEach((segment, i) => {
    if (segment.startsWith("```") && segment.endsWith("```")) {
      // Code block
      const code = segment.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
      parts.push(
        <Box
          key={i}
          flexDirection="column"
          marginY={0}
          paddingX={1}
          borderStyle="round"
          borderColor={tone.border}
        >
          <Text color={tone.text}>{code}</Text>
        </Box>,
      );
    } else if (segment.trim()) {
      // Regular text — handle inline code with backticks
      parts.push(
        <Text key={i} wrap="wrap" color={role === "assistant" ? tone.text : undefined}>
          {segment}
        </Text>,
      );
    }
  });

  return <Box flexDirection="column">{parts}</Box>;
}

function MessageBubble({
  message,
  tone,
}: {
  readonly message: AgentMessage;
  readonly tone: Tone;
}): React.ReactElement {
  const config = ROLE_CONFIG[message.role] ?? ROLE_CONFIG["system"]!;
  const accentColor = tone[config.accent];

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header: icon + role + model/tool badge */}
      <Box gap={1}>
        <Text color={accentColor} bold>
          {config.icon} {config.label}
        </Text>
        {message.model && <Text color={tone.muted}>({message.model})</Text>}
        {message.toolName && (
          <Box>
            <Text color={tone.primaryMuted}>[</Text>
            <Text color={tone.primary}>{message.toolName}</Text>
            <Text color={tone.primaryMuted}>]</Text>
          </Box>
        )}
        {message.tokensUsed && message.tokensUsed > 0 && (
          <Text color={tone.muted}>{message.tokensUsed.toLocaleString()}t</Text>
        )}
      </Box>

      {/* Content */}
      <Box paddingLeft={3}>{formatContent(message.content, message.role, tone)}</Box>
    </Box>
  );
}

export function ChatView({
  messages,
  isStreaming,
  streamingContent,
  currentModel,
}: ChatViewProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);

  // Empty state — encourage the user with a tiny help hint instead of
  // an utterly blank chat pane.
  const showEmpty = messages.length === 0 && !isStreaming;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {showEmpty && (
        <Box flexDirection="column" paddingY={1} paddingX={1} gap={1}>
          <Box gap={1}>
            <Text color={tone.rune} bold>
              {rune.ask}
            </Text>
            <Text color={tone.text} bold>
              Ready when you are.
            </Text>
          </Box>
          <Text color={tone.muted}>
            Type a question, drop a path with @file, or press / for commands.
          </Text>
        </Box>
      )}

      {messages.map((msg, i) => (
        <MessageBubble key={`msg-${i}-${msg.role}`} message={msg} tone={tone} />
      ))}

      {/* Streaming response */}
      {isStreaming && streamingContent && (
        <Box flexDirection="column" marginBottom={1}>
          <Box gap={1}>
            <Text color={tone.primary} bold>
              {glyph.badgeAssistant} WOTANN
            </Text>
            {currentModel && <Text color={tone.muted}>({currentModel})</Text>}
            <Spinner tone={tone} accent="primary" />
          </Box>
          <Box paddingLeft={3}>
            <Text wrap="wrap" color={tone.text}>
              {streamingContent}
            </Text>
            <Text color={tone.primary}>{glyph.streamingTail}</Text>
          </Box>
        </Box>
      )}

      {/* Waiting for first token */}
      {isStreaming && !streamingContent && (
        <Box gap={1} paddingLeft={1}>
          <Spinner tone={tone} accent="primary" label="Thinking..." />
        </Box>
      )}
    </Box>
  );
}
