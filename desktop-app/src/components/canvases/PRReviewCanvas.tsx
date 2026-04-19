/**
 * PRReviewCanvas — render a PR-review payload as an interactive card.
 *
 * Cursor 3 parity (UNKNOWN_UNKNOWNS.md #3): the agent hands back a
 * structured review, and the user accepts / rejects each hunk from
 * the canvas itself. No copy-paste into a diff tool, no round-trip.
 *
 * Events:
 *   - On accept/reject click, the canvas dispatches a window-level
 *     CustomEvent named `canvas:pr-review:apply` with detail:
 *       { blockId, decision: 'accept' | 'reject', commentId, hunkIds }
 *     Consumers (WorkshopView, ChatView) listen and forward to the
 *     engine RPC `pr.applyDecision`.
 *
 * Payload shape (validated at runtime):
 *   {
 *     title: string
 *     description?: string
 *     prUrl?: string
 *     riskScore: number        // 0..1, 0 = safe, 1 = high risk
 *     files: Array<{
 *       path: string
 *       additions: number
 *       deletions: number
 *       diff: string           // unified diff text
 *     }>
 *     comments: Array<{
 *       id: string
 *       file?: string
 *       line?: number
 *       body: string
 *       suggestion?: { hunkIds: string[] }  // hunks to accept
 *     }>
 *   }
 */

import { useCallback, useMemo, useState } from "react";
import type { CanvasProps } from "../../lib/canvas-registry";
import { InvalidPayload, isPlainObject, EmptyPayload } from "./CanvasFallback";

// ────────────────────────────────────────────────────────────
// Types + validation
// ────────────────────────────────────────────────────────────

interface PRFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly diff: string;
}

interface PRComment {
  readonly id: string;
  readonly file?: string;
  readonly line?: number;
  readonly body: string;
  readonly suggestion?: { readonly hunkIds: readonly string[] };
}

interface PRReviewPayload {
  readonly title: string;
  readonly description?: string;
  readonly prUrl?: string;
  readonly riskScore: number;
  readonly files: readonly PRFile[];
  readonly comments: readonly PRComment[];
}

function validate(data: unknown): PRReviewPayload | { readonly error: string } {
  if (!isPlainObject(data)) return { error: "Payload must be an object." };
  const { title, riskScore, files, comments } = data;
  if (typeof title !== "string") return { error: "`title` missing or not a string." };
  if (typeof riskScore !== "number" || !Number.isFinite(riskScore)) {
    return { error: "`riskScore` must be a finite number (0..1)." };
  }
  if (!Array.isArray(files)) return { error: "`files` must be an array." };
  if (!Array.isArray(comments)) return { error: "`comments` must be an array." };

  // Narrow each entry. Malformed entries are dropped rather than aborting
  // so a partial stream still renders the healthy parts.
  const safeFiles: PRFile[] = [];
  for (const f of files) {
    if (!isPlainObject(f)) continue;
    if (typeof f.path !== "string" || typeof f.diff !== "string") continue;
    safeFiles.push({
      path: f.path,
      additions: typeof f.additions === "number" ? f.additions : 0,
      deletions: typeof f.deletions === "number" ? f.deletions : 0,
      diff: f.diff,
    });
  }

  const safeComments: PRComment[] = [];
  for (const c of comments) {
    if (!isPlainObject(c)) continue;
    if (typeof c.id !== "string" || typeof c.body !== "string") continue;
    let suggestion: PRComment["suggestion"];
    if (isPlainObject(c.suggestion)) {
      const hunkIds = c.suggestion.hunkIds;
      if (Array.isArray(hunkIds) && hunkIds.every((h) => typeof h === "string")) {
        suggestion = { hunkIds };
      }
    }
    safeComments.push({
      id: c.id,
      file: typeof c.file === "string" ? c.file : undefined,
      line: typeof c.line === "number" ? c.line : undefined,
      body: c.body,
      suggestion,
    });
  }

  return {
    title,
    description:
      typeof data.description === "string" ? data.description : undefined,
    prUrl: typeof data.prUrl === "string" ? data.prUrl : undefined,
    riskScore: Math.max(0, Math.min(1, riskScore)),
    files: safeFiles,
    comments: safeComments,
  };
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

type Decision = "accept" | "reject";

function dispatchDecision(
  blockId: string,
  commentId: string,
  decision: Decision,
  hunkIds: readonly string[],
): void {
  const event = new CustomEvent("canvas:pr-review:apply", {
    detail: {
      blockId,
      commentId,
      decision,
      hunkIds,
    },
    bubbles: true,
  });
  window.dispatchEvent(event);
}

export default function PRReviewCanvas({ data, blockId }: CanvasProps) {
  const parsed = useMemo(() => validate(data), [data]);
  const [decisions, setDecisions] = useState<
    Readonly<Record<string, Decision>>
  >({});
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const handleDecide = useCallback(
    (comment: PRComment, decision: Decision) => {
      setDecisions((prev) => ({ ...prev, [comment.id]: decision }));
      dispatchDecision(
        blockId,
        comment.id,
        decision,
        comment.suggestion?.hunkIds ?? [],
      );
    },
    [blockId],
  );

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if ("error" in parsed) {
    return (
      <InvalidPayload
        canvasLabel="PR Review"
        reason={parsed.error}
        data={data}
      />
    );
  }

  if (parsed.files.length === 0 && parsed.comments.length === 0) {
    return (
      <EmptyPayload
        canvasLabel="PR Review"
        hint="The agent returned a PR review with no files or comments. Nothing to apply."
      />
    );
  }

  const riskColor =
    parsed.riskScore > 0.66
      ? "var(--color-error)"
      : parsed.riskScore > 0.33
        ? "var(--color-warning)"
        : "var(--color-success)";

  return (
    <section
      className="liquid-glass"
      data-glass-tier="medium"
      style={{
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md, 10px)",
        margin: "var(--space-sm) 0",
      }}
      aria-label={`PR review: ${parsed.title}`}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-sm)",
          marginBottom: "var(--space-sm)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              marginBottom: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {parsed.title}
          </h3>
          {parsed.description ? (
            <p
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                lineHeight: 1.5,
              }}
            >
              {parsed.description}
            </p>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Risk
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              color: riskColor,
            }}
            aria-label={`Risk score ${(parsed.riskScore * 100).toFixed(0)} percent`}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background: riskColor,
              }}
            />
            {(parsed.riskScore * 100).toFixed(0)}%
          </div>
        </div>
      </header>

      {/* Files */}
      {parsed.files.length > 0 ? (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: "var(--space-sm)",
            marginTop: "var(--space-sm)",
          }}
        >
          <div
            style={{
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Files ({parsed.files.length})
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {parsed.files.map((file) => {
              const expanded = expandedFiles.has(file.path);
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => toggleFile(file.path)}
                    aria-expanded={expanded}
                    className="btn-press"
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      background: expanded
                        ? "var(--bg-surface-hover)"
                        : "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm, 6px)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-xs)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 10,
                        transform: expanded ? "rotate(90deg)" : "none",
                        transition: "transform 160ms var(--ease-out)",
                        color: "var(--color-text-dim)",
                      }}
                    >
                      ▸
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.path}
                    </span>
                    <span style={{ color: "var(--color-success)" }}>
                      +{file.additions}
                    </span>
                    <span style={{ color: "var(--color-error)" }}>
                      -{file.deletions}
                    </span>
                  </button>
                  {expanded ? (
                    <pre
                      style={{
                        margin: "4px 0 0",
                        padding: "var(--space-sm)",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm, 6px)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--font-size-2xs)",
                        color: "var(--color-text-secondary)",
                        overflow: "auto",
                        maxHeight: 320,
                      }}
                    >
                      {formatDiff(file.diff)}
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Comments */}
      {parsed.comments.length > 0 ? (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: "var(--space-sm)",
            marginTop: "var(--space-sm)",
          }}
        >
          <div
            style={{
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            Comments ({parsed.comments.length})
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {parsed.comments.map((c) => {
              const decision = decisions[c.id];
              return (
                <li
                  key={c.id}
                  style={{
                    padding: "var(--space-sm)",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm, 6px)",
                  }}
                >
                  {c.file ? (
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--font-size-2xs)",
                        color: "var(--color-text-dim)",
                        marginBottom: 4,
                      }}
                    >
                      {c.file}
                      {typeof c.line === "number" ? `:${c.line}` : ""}
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: "var(--font-size-xs)",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {c.body}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      marginTop: "var(--space-sm)",
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      className="btn-press"
                      onClick={() => handleDecide(c, "accept")}
                      disabled={decision === "accept"}
                      aria-pressed={decision === "accept"}
                      style={{
                        padding: "4px 10px",
                        fontSize: "var(--font-size-2xs)",
                        fontWeight: 600,
                        borderRadius: "var(--radius-sm, 6px)",
                        border: "1px solid var(--color-success)",
                        background:
                          decision === "accept"
                            ? "var(--color-success-muted)"
                            : "transparent",
                        color: "var(--color-success)",
                        cursor: decision === "accept" ? "default" : "pointer",
                        opacity: decision === "reject" ? 0.5 : 1,
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn-press"
                      onClick={() => handleDecide(c, "reject")}
                      disabled={decision === "reject"}
                      aria-pressed={decision === "reject"}
                      style={{
                        padding: "4px 10px",
                        fontSize: "var(--font-size-2xs)",
                        fontWeight: 600,
                        borderRadius: "var(--radius-sm, 6px)",
                        border: "1px solid var(--color-error)",
                        background:
                          decision === "reject"
                            ? "var(--color-error-muted)"
                            : "transparent",
                        color: "var(--color-error)",
                        cursor: decision === "reject" ? "default" : "pointer",
                        opacity: decision === "accept" ? 0.5 : 1,
                      }}
                    >
                      Reject
                    </button>
                    {decision ? (
                      <span
                        style={{
                          fontSize: "var(--font-size-2xs)",
                          color: "var(--color-text-dim)",
                        }}
                      >
                        applied
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {parsed.prUrl ? (
        <div
          style={{
            marginTop: "var(--space-sm)",
            paddingTop: "var(--space-sm)",
            borderTop: "1px solid var(--border-subtle)",
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
          }}
        >
          Source:{" "}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-muted)",
            }}
          >
            {parsed.prUrl}
          </span>
        </div>
      ) : null}
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Keep the diff single-pass but add leading-char classes so consumers
 * could later colorize. We return plain string today — visual colors
 * come from CSS if we ever wire a <code> with data attrs. Keeping the
 * API ready for that without bloating now.
 */
function formatDiff(diff: string): string {
  return diff.replace(/\r\n?/g, "\n");
}
