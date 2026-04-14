/**
 * Rendered artifact card: code, diagram, table, or diff.
 */

import { useState, useCallback } from "react";
import { useStore } from "../../store";
import { CodeBlock } from "../chat/CodeBlock";

interface ArtifactCardProps {
  readonly type: "code" | "diagram" | "table" | "diff";
  readonly title: string;
  readonly content: string;
  readonly language?: string;
}

export function ArtifactCard({ type, title, content, language }: ArtifactCardProps) {
  const [copyLabel, setCopyLabel] = useState("Copy");
  const setView = useStore((s) => s.setView);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyLabel("Copied");
      setTimeout(() => setCopyLabel("Copy"), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }, [content]);

  const handleOpen = useCallback(() => {
    if (type === "code") {
      setView("editor");
    }
  }, [type, setView]);

  return (
    <div className="rounded-xl overflow-hidden my-3 animate-slideUp" style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-2)" }} role="article" aria-label={`${type} artifact: ${title}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <ArtifactIcon type={type} />
          <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleOpen} className="px-2 py-0.5 text-[10px] rounded artifact-action-btn" aria-label={`Open ${title}`}>
            Open
          </button>
          <button onClick={handleCopy} className="px-2 py-0.5 text-[10px] rounded artifact-action-btn" aria-label={`Copy ${title} to clipboard`}>
            {copyLabel}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-0">
        {type === "code" && <CodeBlock code={content} language={language ?? ""} />}
        {type === "table" && (
          <div className="overflow-x-auto p-4 text-xs font-mono whitespace-pre" style={{ color: "var(--color-text-secondary)" }}>
            {content}
          </div>
        )}
        {type === "diagram" && (
          <div className="p-4 text-xs font-mono whitespace-pre" style={{ color: "var(--color-text-secondary)" }}>
            {content}
          </div>
        )}
        {type === "diff" && (
          <div className="p-0">
            {content.split("\n").map((line, i) => (
              <div
                key={i}
                className="px-4 py-0.5 text-xs font-mono"
                style={{
                  ...(line.startsWith("+")
                    ? { background: "var(--color-success-muted)", color: "var(--color-success)" }
                    : line.startsWith("-")
                      ? { background: "var(--color-error-muted)", color: "var(--color-error)" }
                      : line.startsWith("@@")
                        ? { background: "var(--color-info-muted)", color: "var(--info)" }
                        : { color: "var(--color-text-dim)" }),
                }}
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactIcon({ type }: { readonly type: string }) {
  const icons: Record<string, React.ReactNode> = {
    code: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-primary)" }}>
        <path d="M5 4L1 8l4 4M11 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    diagram: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-accent)" }}>
        <rect x="1" y="1" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="1" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="6" y="11" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 3h6M3 5v3l5 3M13 5v3l-5 3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    table: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-success)" }}>
        <rect x="1" y="1" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 5h14M1 9h14M6 1v14M11 1v14" stroke="currentColor" strokeWidth="1" />
      </svg>
    ),
    diff: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-warning)" }}>
        <path d="M3 8h10M8 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  };
  return icons[type] ?? null;
}
