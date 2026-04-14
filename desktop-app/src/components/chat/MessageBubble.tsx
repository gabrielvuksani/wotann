/**
 * Individual message bubble with role indicator, timestamp, and actions.
 * User messages: right-aligned, blue accent bg. Assistant: left-aligned, elevated surface.
 * Hover shows actions (copy, retry) with 200ms fade. Token count tooltip.
 */

import { useState, useCallback, useMemo } from "react";
import type { Message } from "../../types";
import { useStore } from "../../store";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingIndicator } from "./StreamingIndicator";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { ArtifactCard } from "../artifacts/ArtifactCard";
import { DiffViewer } from "../artifacts/DiffViewer";

/** Inline keyframes for thinking brain pulse — avoids modifying globals.css */
const BUBBLE_KEYFRAMES = `
@keyframes messageBubblePulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
`;

interface MessageBubbleProps {
  readonly message: Message;
  readonly conversationId?: string;
  readonly onRetry?: () => void;
  readonly onCopy?: () => void;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface ExtractedArtifact {
  readonly type: "code" | "diff";
  readonly title: string;
  readonly content: string;
  readonly language: string;
  readonly original?: string;
  readonly modified?: string;
}

// ── Thinking / Tool Call Detection ──────────────────────

/** Check if content starts with thinking tokens or a "Thinking..." prefix */
function isThinkingContent(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith("Thinking...") ||
    trimmed.startsWith("<thinking>") ||
    trimmed.startsWith("[thinking]") ||
    /^thinking\s*[.]{0,3}\s*$/i.test(trimmed.split("\n")[0] ?? "")
  );
}

/** Extract thinking text from content (the part inside thinking markers) */
function extractThinkingText(content: string): { readonly thinking: string; readonly rest: string } {
  // <thinking>...</thinking> block
  const xmlMatch = content.match(/^(\s*)<thinking>([\s\S]*?)<\/thinking>([\s\S]*)/);
  if (xmlMatch) {
    return { thinking: xmlMatch[2]?.trim() ?? "", rest: xmlMatch[3]?.trim() ?? "" };
  }
  // [thinking]...[/thinking] block
  const bracketMatch = content.match(/^(\s*)\[thinking\]([\s\S]*?)\[\/thinking\]([\s\S]*)/);
  if (bracketMatch) {
    return { thinking: bracketMatch[2]?.trim() ?? "", rest: bracketMatch[3]?.trim() ?? "" };
  }
  // "Thinking..." prefix followed by actual content on next line
  const prefixMatch = content.match(/^(\s*Thinking\.{0,3}\s*\n)([\s\S]*)/);
  if (prefixMatch) {
    return { thinking: "", rest: prefixMatch[2]?.trim() ?? "" };
  }
  return { thinking: "", rest: content };
}

/** Detect tool call JSON patterns in content */
const TOOL_CALL_REGEX = /(\{"type"\s*:\s*"tool"[\s\S]*?\}|\[tool_call:[^\]]+\])/g;

/** Split content into segments: regular text and tool call blocks */
function splitToolCalls(content: string): readonly { readonly kind: "text" | "tool"; readonly value: string }[] {
  const segments: { readonly kind: "text" | "tool"; readonly value: string }[] = [];
  let lastIndex = 0;
  const regex = new RegExp(TOOL_CALL_REGEX.source, "g");

  let match = regex.exec(content);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "tool", value: match[0] });
    lastIndex = match.index + match[0].length;
    match = regex.exec(content);
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return segments;
}

// ToolCallIndicator removed — replaced by ToolCallCard component (Tier 5B)

/** Extract code artifacts and diffs from message content for rich rendering. */
function extractArtifacts(content: string): readonly ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  // Detect diff blocks: lines starting with diff --git or --- a/ / +++ b/
  const diffRegex = /^(diff --git .+\n(?:(?:---|[+]{3}|@@|[ +-]).+\n?)*)/gm;
  const diffMatches = content.match(diffRegex);
  if (diffMatches) {
    for (const block of diffMatches) {
      const fileMatch = block.match(/diff --git a\/(.+?) b\//);
      const filename = fileMatch?.[1] ?? "file";
      const origLines: string[] = [];
      const modLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("-") && !line.startsWith("---")) {
          origLines.push(line.slice(1));
        } else if (line.startsWith("+") && !line.startsWith("+++")) {
          modLines.push(line.slice(1));
        } else if (!line.startsWith("diff") && !line.startsWith("---") && !line.startsWith("+++") && !line.startsWith("@@")) {
          origLines.push(line.startsWith(" ") ? line.slice(1) : line);
          modLines.push(line.startsWith(" ") ? line.slice(1) : line);
        }
      }
      artifacts.push({
        type: "diff",
        title: filename,
        content: block,
        language: "",
        original: origLines.join("\n"),
        modified: modLines.join("\n"),
      });
    }
  }

  // Detect fenced code blocks with artifact markers: ```language:filename
  const codeRegex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;
  let codeMatch = codeRegex.exec(content);
  while (codeMatch !== null) {
    artifacts.push({
      type: "code",
      title: codeMatch[2]!.trim(),
      content: codeMatch[3]!.trim(),
      language: codeMatch[1]!,
    });
    codeMatch = codeRegex.exec(content);
  }

  return artifacts;
}

export function MessageBubble({ message, conversationId, onRetry, onCopy }: MessageBubbleProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const forkConversation = useStore((s) => s.forkConversation);
  const updateMessage = useStore((s) => s.updateMessage);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming ?? false;

  const handleEditSave = useCallback(() => {
    const convId = conversationId ?? activeConversationId;
    if (convId && editContent.trim()) {
      updateMessage(convId, message.id, { content: editContent.trim() });
    }
    setIsEditing(false);
  }, [conversationId, activeConversationId, editContent, updateMessage, message.id]);

  const handleEditCancel = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(false);
  }, [message.content]);

  // Extract artifacts (diffs, code blocks with filenames) for rich rendering
  const artifacts = useMemo(
    () => (!isUser && message.content ? extractArtifacts(message.content) : []),
    [isUser, message.content],
  );

  // Detect thinking state and extract thinking/rest content
  const hasThinking = useMemo(() => !isUser && isThinkingContent(message.content), [isUser, message.content]);
  const thinkingParts = useMemo(
    () => (!isUser && hasThinking ? extractThinkingText(message.content) : { thinking: "", rest: message.content }),
    [isUser, hasThinking, message.content],
  );

  // Split non-thinking content into text segments and tool call blocks
  const contentSegments = useMemo(() => {
    const contentToRender = hasThinking ? thinkingParts.rest : message.content;
    if (!isUser && contentToRender) {
      return splitToolCalls(contentToRender);
    }
    return [{ kind: "text" as const, value: contentToRender }];
  }, [isUser, hasThinking, thinkingParts.rest, message.content]);

  const handleFork = useCallback(() => {
    const convId = conversationId ?? activeConversationId;
    if (convId) {
      forkConversation(convId, message.id);
    }
  }, [conversationId, activeConversationId, forkConversation, message.id]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
      onCopy?.();
    } catch {
      // Clipboard unavailable
    }
  }, [message.content, onCopy]);

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} group`}
      role="article"
      aria-label={`${isUser ? "Your" : "WOTANN"} message at ${formatTime(message.timestamp)}`}
    >
      {/* Scoped keyframes for thinking pulse */}
      {hasThinking && <style>{BUBBLE_KEYFRAMES}</style>}
      <div
        className={`${isUser ? "max-w-[80%]" : "max-w-[90%]"} relative animate-slideUp`}
        style={isUser ? {
          background: "rgba(10, 132, 255, 0.08)",
          borderRadius: 12,
          padding: "16px",
        } : {
          background: "#1C1C1E",
          borderRadius: 12,
          padding: "16px",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          if (isUser) {
            el.style.background = "rgba(10, 132, 255, 0.12)";
          } else {
            el.style.background = "#252528";
          }
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          if (isUser) {
            el.style.background = "rgba(10, 132, 255, 0.08)";
          } else {
            el.style.background = "#1C1C1E";
          }
        }}
      >
        {/* Header: avatar + role label + time */}
        <div className="flex items-center gap-1.5 mb-2" style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 500 }}>
          {!isUser && (
            <div
              className="shrink-0 flex items-center justify-center"
              style={{
                width: 24, height: 24,
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--color-primary), #0066CC)",
                boxShadow: "0 1px 3px rgba(10, 132, 255, 0.2)",
              }}
              aria-hidden="true"
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "white", lineHeight: 1 }}>W</span>
            </div>
          )}
          <span>{isUser ? "You" : "WOTANN"}</span>
          {isStreaming && (
            <span className="animate-pulse" style={{ color: "var(--color-warning)" }} aria-live="polite">streaming</span>
          )}
        </div>

        {/* Content */}
        <div style={{ fontSize: 15, lineHeight: 1.6, wordBreak: "break-word", color: "var(--color-text-primary)" }}>
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleEditSave();
                  } else if (e.key === "Escape") {
                    handleEditCancel();
                  }
                }}
                className="w-full bg-transparent resize-none focus:outline-none rounded-lg p-2 text-sm"
                style={{
                  border: "1px solid var(--color-primary)",
                  color: "var(--color-text-primary)",
                  minHeight: 60,
                }}
                aria-label="Edit message — Enter to save, Escape to cancel"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleEditCancel}
                  className="px-2.5 py-1 text-xs rounded-md transition-colors"
                  style={{ background: "var(--surface-3)", color: "var(--color-text-secondary)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="px-2.5 py-1 text-xs font-medium text-white rounded-md transition-colors"
                  style={{ background: "var(--color-primary)" }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : message.content ? (
            isUser ? (
              <p className="whitespace-pre-wrap" style={{ color: "var(--color-text-primary)" }}>{message.content}</p>
            ) : (
              <>
                {/* Thinking block — collapsible with live timer */}
                {hasThinking && (
                  <ThinkingBlock
                    content={thinkingParts.thinking || "Thinking..."}
                    isStreaming={isStreaming}
                    startedAt={message.timestamp}
                  />
                )}

                {/* Render content segments — text through markdown, tool calls as collapsible blocks */}
                {contentSegments.map((seg, idx) =>
                  seg.kind === "tool" ? (
                    <ToolCallCard
                      key={`seg-${idx}`}
                      toolName={(() => {
                        try {
                          if (seg.value.startsWith("{")) {
                            const parsed = JSON.parse(seg.value);
                            return parsed.name ?? parsed.tool ?? "tool_call";
                          }
                          const m = seg.value.match(/\[tool_call:([^\]]+)\]/);
                          return m?.[1] ?? "tool_call";
                        } catch { return "tool_call"; }
                      })()}
                      toolInput={(() => {
                        try {
                          if (seg.value.startsWith("{")) {
                            const parsed = JSON.parse(seg.value);
                            return parsed.arguments ?? parsed.input ?? undefined;
                          }
                        } catch { /* ignore */ }
                        return undefined;
                      })()}
                      status={isStreaming ? "running" : "complete"}
                    />
                  ) : seg.value.trim() ? (
                    <MarkdownRenderer key={`seg-${idx}`} content={seg.value} />
                  ) : null,
                )}
              </>
            )
          ) : isStreaming ? (
            <StreamingIndicator />
          ) : null}
        </div>

        {/* Rich artifacts: code blocks and diffs extracted from content */}
        {artifacts.length > 0 && (
          <div className="mt-2 space-y-2">
            {artifacts.map((artifact, i) =>
              artifact.type === "diff" && artifact.original !== undefined && artifact.modified !== undefined ? (
                <DiffViewer
                  key={`artifact-diff-${i}`}
                  filename={artifact.title}
                  original={artifact.original}
                  modified={artifact.modified}
                />
              ) : artifact.type === "code" ? (
                <ArtifactCard
                  key={`artifact-code-${i}`}
                  type="code"
                  title={artifact.title}
                  content={artifact.content}
                  language={artifact.language}
                />
              ) : null,
            )}
          </div>
        )}

        {/* Token + cost meta — near-invisible */}
        {!isStreaming && message.tokensUsed && (
          <div
            className="flex items-center gap-2 mt-1 opacity-20 group-hover:opacity-50 transition-opacity"
            style={{ color: "var(--color-text-ghost)", fontSize: 6 }}
            title={`${message.tokensUsed.toLocaleString()} tokens${message.costUsd !== undefined ? ` / $${message.costUsd.toFixed(4)}` : ""}`}
          >
            <span className="flex items-center gap-1" aria-label={`${message.tokensUsed.toLocaleString()} tokens used`}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="opacity-60" aria-hidden="true">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {message.tokensUsed.toLocaleString()} tokens
            </span>
            {message.costUsd !== undefined && (
              <span className="flex items-center gap-1" aria-label={`Cost: $${message.costUsd.toFixed(4)}`}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="opacity-60" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 4.5v7M6 6.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-.9 1.5-2 1.5-2 .7-2 1.5.9 1.5 2 1.5 2-.7 2-1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                </svg>
                ${message.costUsd.toFixed(4)}
              </span>
            )}
          </div>
        )}

        {/* Action buttons — visible on group hover via CSS */}
        {!isStreaming && !isEditing && (
          <div className="flex items-center gap-1 mt-2 -mb-1 opacity-0 group-hover:opacity-100" style={{ transition: "opacity 200ms ease" }} role="toolbar" aria-label="Message actions">
            <ActionButton
              label={copyState === "copied" ? "Copied" : "Copy"}
              onClick={handleCopy}
              ariaLabel="Copy message to clipboard"
            />
            {isUser && (
              <ActionButton
                label="Edit"
                icon={
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
                onClick={() => { setEditContent(message.content); setIsEditing(true); }}
                ariaLabel="Edit this message"
              />
            )}
            {!isUser && onRetry && <ActionButton label="Retry" onClick={onRetry} ariaLabel="Retry this message" />}
            <ActionButton label="Fork" onClick={handleFork} ariaLabel="Fork conversation from this point" />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  ariaLabel,
}: {
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly onClick: () => void;
  readonly ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="depth-action-btn px-2 py-0.5 active:scale-95 inline-flex items-center gap-1"
      style={{ fontSize: "var(--font-size-xs)", borderRadius: "var(--radius-sm)", color: "var(--color-text-muted)" }}
      aria-label={ariaLabel}
    >
      {icon}
      {label}
    </button>
  );
}
