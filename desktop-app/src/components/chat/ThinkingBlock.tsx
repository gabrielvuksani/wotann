/**
 * ThinkingBlock -- Collapsible display for model thinking/reasoning tokens.
 * Shows "Thinking for Xs" with a live timer during streaming.
 */

import { useState, useEffect } from "react";

interface ThinkingBlockProps {
  readonly content: string;
  readonly isStreaming?: boolean;
  readonly startedAt?: number;
}

export function ThinkingBlock({ content, isStreaming, startedAt }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming || !startedAt) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isStreaming, startedAt]);

  const label = isStreaming
    ? `Thinking for ${elapsed}s...`
    : `Thought for ${elapsed || Math.ceil(content.length / 50)}s`;

  return (
    <div style={{
      margin: "4px 0",
      borderLeft: "2px solid var(--color-primary)",
      paddingLeft: "12px",
    }}>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: "12px",
          padding: "4px 0",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
        aria-expanded={expanded}
        aria-label={label}
      >
        <span style={{ fontSize: "14px" }} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 6.5a2 2 0 013.5 1.5c0 1-1.5 1-1.5 2M8 12v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <span>{label}</span>
        <span style={{ fontSize: "10px" }}>{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>
      {expanded && (
        <div style={{
          color: "var(--text-dim)",
          fontSize: "12px",
          lineHeight: "1.5",
          padding: "8px 0",
          maxHeight: "300px",
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}>
          {content}
        </div>
      )}
    </div>
  );
}
