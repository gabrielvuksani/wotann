/**
 * Chat view: rich message display with role badges, code blocks,
 * tool call formatting, timestamps, and streaming indicator.
 */

import React from "react";
import { Box, Text } from "ink";
import type { AgentMessage } from "../../core/types.js";

interface ChatViewProps {
  readonly messages: readonly AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingContent?: string;
  readonly currentModel?: string;
}

const ROLE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  user: { icon: "▸", color: "blue", label: "You" },
  assistant: { icon: "◆", color: "green", label: "WOTANN" },
  system: { icon: "●", color: "yellow", label: "System" },
  tool: { icon: "⚙", color: "magenta", label: "Tool" },
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatContent(content: string, role: string): React.ReactElement {
  // System messages get special formatting (box style for command output)
  if (role === "system") {
    // Check if it's a structured command output (contains box-drawing chars or bullet points)
    if (content.includes("╭") || content.includes("│")) {
      return <Text color="yellow">{content}</Text>;
    }
    return <Text color="yellow" dimColor>{content}</Text>;
  }

  // Split content into code blocks and text
  const parts: React.ReactElement[] = [];
  const segments = content.split(/(```[\s\S]*?```)/g);

  segments.forEach((segment, i) => {
    if (segment.startsWith("```") && segment.endsWith("```")) {
      // Code block
      const code = segment.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
      parts.push(
        <Box key={i} flexDirection="column" marginY={0} paddingX={1} borderStyle="single" borderColor="gray">
          <Text color="white">{code}</Text>
        </Box>,
      );
    } else if (segment.trim()) {
      // Regular text — handle inline code with backticks
      parts.push(<Text key={i} wrap="wrap">{segment}</Text>);
    }
  });

  return <Box flexDirection="column">{parts}</Box>;
}

function MessageBubble({ message }: { readonly message: AgentMessage }): React.ReactElement {
  const config = ROLE_CONFIG[message.role] ?? ROLE_CONFIG["system"]!;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header: icon + role + model/tool badge */}
      <Box gap={1}>
        <Text color={config.color} bold>{config.icon} {config.label}</Text>
        {message.model && (
          <Text dimColor>({message.model})</Text>
        )}
        {message.toolName && (
          <Box>
            <Text color="magenta" dimColor>[</Text>
            <Text color="magenta">{message.toolName}</Text>
            <Text color="magenta" dimColor>]</Text>
          </Box>
        )}
        {message.tokensUsed && message.tokensUsed > 0 && (
          <Text dimColor>{message.tokensUsed.toLocaleString()}t</Text>
        )}
      </Box>

      {/* Content */}
      <Box paddingLeft={3}>
        {formatContent(message.content, message.role)}
      </Box>
    </Box>
  );
}

export function ChatView({
  messages,
  isStreaming,
  streamingContent,
  currentModel,
}: ChatViewProps): React.ReactElement {
  // Animated spinner using frame index based on time
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [isStreaming]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.map((msg, i) => (
        <MessageBubble key={`msg-${i}-${msg.role}`} message={msg} />
      ))}

      {/* Streaming response */}
      {isStreaming && streamingContent && (
        <Box flexDirection="column" marginBottom={1}>
          <Box gap={1}>
            <Text color="green" bold>◆ WOTANN</Text>
            {currentModel && <Text dimColor>({currentModel})</Text>}
            <Text color="green">{SPINNER_FRAMES[frame]}</Text>
          </Box>
          <Box paddingLeft={3}>
            <Text wrap="wrap">{streamingContent}</Text>
            <Text color="green">▌</Text>
          </Box>
        </Box>
      )}

      {/* Waiting for first token */}
      {isStreaming && !streamingContent && (
        <Box gap={1} paddingLeft={1}>
          <Text color="green">{SPINNER_FRAMES[frame]}</Text>
          <Text dimColor>Thinking...</Text>
        </Box>
      )}
    </Box>
  );
}
