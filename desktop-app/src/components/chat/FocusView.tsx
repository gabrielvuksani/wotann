/**
 * Focus View — collapsed single-task lens.
 *
 * Competitive port from Claude Code's `/focus` (design-spec §12 P9 #8).
 * When a long back-and-forth conversation gets noisy, `⌘⇧F` collapses it
 * to three lines:
 *   1. Last user prompt
 *   2. One-line summary of every tool call (`read × 4 · edit × 2 · bash × 1`)
 *   3. Final assistant response (truncated to 2 lines)
 *
 * The rest of the conversation collapses into a grey "N hidden turns"
 * ribbon that click-expands back to the full history. Designed to give the
 * user a triage surface without leaving the chat.
 */

import { useMemo, useState, type JSX } from "react";
import { color } from "../../design/tokens.generated";

// ── Types ────────────────────────────────────────────────────────

export interface FocusMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "system";
  /** Plain-text content (markdown stripped by caller). */
  readonly content: string;
  /** For role="tool": the tool name (e.g. "read", "edit"). */
  readonly toolName?: string;
  /** Timestamp (unix ms). */
  readonly createdAt: number;
}

export interface FocusViewProps {
  readonly messages: readonly FocusMessage[];
  readonly onExpand?: () => void;
  readonly className?: string;
}

// ── Component ────────────────────────────────────────────────────

export function FocusView({ messages, onExpand, className }: FocusViewProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const { lastUser, toolSummary, lastAssistant, hiddenCount } = useMemo(
    () => summarizeMessages(messages),
    [messages],
  );

  if (expanded) {
    // Let the caller render the full view. If they didn't provide a handler,
    // we just render a very thin "expanded" marker so the component never
    // renders nothing.
    onExpand?.();
    return (
      <div
        className={className}
        role="status"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: color("muted"),
        }}
      >
        Focus view collapsed — full conversation restored.
      </div>
    );
  }

  return (
    <div
      className={className}
      role="region"
      aria-label="Focus view"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 12,
        background: "var(--surface-1, rgba(138, 176, 224, 0.02))",
        border: "1px solid var(--border-subtle, rgba(138,176,224,0.08))",
        fontFamily: "var(--wotann-font-sans, 'Inter Variable', system-ui)",
      }}
    >
      {/* 1. Last user prompt */}
      <FocusRow
        label="You asked"
        accent={color("muted")}
        placeholder="No user messages in window"
        content={lastUser}
      />

      {/* 2. Tool summary */}
      <FocusRow
        label="Tools used"
        accent={color("toolMessage")}
        placeholder="No tool calls in window"
        content={toolSummary}
        mono
      />

      {/* 3. Final assistant response */}
      <FocusRow
        label="WOTANN said"
        accent={color("warning")}
        placeholder="No assistant messages in window"
        content={lastAssistant}
        maxLines={2}
      />

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            alignSelf: "flex-start",
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: color("muted"),
            background: "transparent",
            border: "1px dashed var(--border-subtle, rgba(138,176,224,0.15))",
            borderRadius: 6,
            cursor: "pointer",
            transition: "background 120ms ease",
          }}
          aria-label={`Expand to show ${hiddenCount} hidden turns`}
        >
          {hiddenCount} hidden turn{hiddenCount === 1 ? "" : "s"} — click to expand
        </button>
      )}
    </div>
  );
}

// ── Summary helper (pure) ────────────────────────────────────────

interface Summary {
  readonly lastUser: string;
  readonly toolSummary: string;
  readonly lastAssistant: string;
  readonly hiddenCount: number;
}

export function summarizeMessages(messages: readonly FocusMessage[]): Summary {
  // Last user message (most recent first)
  let lastUser = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      lastUser = m.content;
      break;
    }
  }

  // Last assistant message
  let lastAssistant = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      lastAssistant = m.content;
      break;
    }
  }

  // Aggregate tool counts
  const toolCounts = new Map<string, number>();
  for (const m of messages) {
    if (m.role === "tool" && m.toolName) {
      toolCounts.set(m.toolName, (toolCounts.get(m.toolName) ?? 0) + 1);
    }
  }
  const toolSummary = toolCounts.size === 0
    ? ""
    : [...toolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name} × ${count}`)
        .join(" · ");

  // Hidden count = total messages minus the 2-3 we're surfacing
  const surfaced = [
    lastUser && "u",
    toolSummary && "t",
    lastAssistant && "a",
  ].filter(Boolean).length;
  const hiddenCount = Math.max(0, messages.length - surfaced);

  return { lastUser, toolSummary, lastAssistant, hiddenCount };
}

// ── Row primitive ────────────────────────────────────────────────

function FocusRow({
  label,
  accent,
  placeholder,
  content,
  mono = false,
  maxLines,
}: {
  label: string;
  accent: string;
  placeholder: string;
  content: string;
  mono?: boolean;
  maxLines?: number;
}): JSX.Element {
  const isEmpty = !content.trim();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: accent,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: isEmpty
            ? "var(--color-text-dim, rgba(138,176,224,0.35))"
            : color("text"),
          fontStyle: isEmpty ? "italic" : "normal",
          fontFamily: mono
            ? "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)"
            : undefined,
          display: "-webkit-box",
          WebkitLineClamp: maxLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {isEmpty ? placeholder : content}
      </div>
    </div>
  );
}
