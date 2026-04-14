/**
 * Style Editor -- maps raw CSS changes to design token suggestions.
 * Part of Design Mode: receives inspector edits (color, padding, font-size, etc.)
 * and suggests matching design tokens before applying.
 *
 * Shows a preview diff of pending changes, with Apply and Reset actions.
 */

import { useState, useCallback, useMemo } from "react";

// ── Design Token Map ────────────────────────────────────

/** Maps raw CSS values to their closest design token equivalents. */
const DESIGN_TOKENS: ReadonlyArray<{
  readonly property: string;
  readonly pattern: RegExp;
  readonly token: string;
  readonly label: string;
}> = [
  // Spacing tokens
  { property: "padding", pattern: /^4px$/, token: "var(--sp-4)", label: "--sp-4" },
  { property: "padding", pattern: /^8px$/, token: "var(--sp-8)", label: "--sp-8" },
  { property: "padding", pattern: /^12px$/, token: "var(--sp-12)", label: "--sp-12" },
  { property: "padding", pattern: /^16px$/, token: "var(--sp-16)", label: "--sp-16" },
  { property: "padding", pattern: /^24px$/, token: "var(--sp-24)", label: "--sp-24" },
  { property: "padding", pattern: /^32px$/, token: "var(--sp-32)", label: "--sp-32" },
  { property: "margin", pattern: /^4px$/, token: "var(--sp-4)", label: "--sp-4" },
  { property: "margin", pattern: /^8px$/, token: "var(--sp-8)", label: "--sp-8" },
  { property: "margin", pattern: /^16px$/, token: "var(--sp-16)", label: "--sp-16" },
  { property: "margin", pattern: /^24px$/, token: "var(--sp-24)", label: "--sp-24" },
  // Border radius tokens
  { property: "borderRadius", pattern: /^4px$/, token: "var(--radius-xs)", label: "--radius-xs" },
  { property: "borderRadius", pattern: /^8px$/, token: "var(--radius-sm)", label: "--radius-sm" },
  { property: "borderRadius", pattern: /^12px$/, token: "var(--radius-md)", label: "--radius-md" },
  { property: "borderRadius", pattern: /^16px$/, token: "var(--radius-lg)", label: "--radius-lg" },
  { property: "borderRadius", pattern: /^9999px$/, token: "var(--radius-pill)", label: "--radius-pill" },
  // Font size tokens
  { property: "fontSize", pattern: /^10px$/, token: "var(--font-size-2xs)", label: "--font-size-2xs" },
  { property: "fontSize", pattern: /^12px$/, token: "var(--font-size-xs)", label: "--font-size-xs" },
  { property: "fontSize", pattern: /^14px$/, token: "var(--font-size-sm)", label: "--font-size-sm" },
  { property: "fontSize", pattern: /^16px$/, token: "var(--font-size-base)", label: "--font-size-base" },
  { property: "fontSize", pattern: /^18px$/, token: "var(--font-size-lg)", label: "--font-size-lg" },
  // Color tokens
  { property: "color", pattern: /^#0A84FF$/i, token: "var(--accent)", label: "--accent" },
  { property: "color", pattern: /^#ffffff$/i, token: "var(--color-text-primary)", label: "--color-text-primary" },
  { property: "backgroundColor", pattern: /^#1e293b$/i, token: "var(--surface-1)", label: "--surface-1" },
  { property: "backgroundColor", pattern: /^#0f172a$/i, token: "var(--color-bg-primary)", label: "--color-bg-primary" },
];

// ── Types ───────────────────────────────────────────────

interface StyleChange {
  readonly property: string;
  readonly oldValue: string;
  readonly newValue: string;
  readonly suggestedToken: string | null;
}

interface StyleEditorProps {
  /** Pending changes from the VisualInspector (property -> new value). */
  readonly changes: ReadonlyArray<{ readonly property: string; readonly value: string }>;
  /** Current computed styles of the selected element (property -> old value). */
  readonly currentStyles: Readonly<Record<string, string>>;
  /** Callback when user clicks "Apply" with the final set of changes. */
  readonly onApply: (changes: ReadonlyArray<{ readonly property: string; readonly value: string }>) => void;
  /** Callback when user clicks "Reset" to discard all pending changes. */
  readonly onReset: () => void;
}

// ── Helpers ─────────────────────────────────────────────

function findTokenSuggestion(property: string, value: string): string | null {
  const match = DESIGN_TOKENS.find(
    (t) => t.property === property && t.pattern.test(value.trim()),
  );
  return match?.label ?? null;
}

// ── Component ───────────────────────────────────────────

export function StyleEditor({ changes, currentStyles, onApply, onReset }: StyleEditorProps) {
  const [useTokens, setUseTokens] = useState<Readonly<Record<string, boolean>>>({});

  /** Enrich each change with the old value and a token suggestion. */
  const enrichedChanges: readonly StyleChange[] = useMemo(
    () =>
      changes.map((c) => ({
        property: c.property,
        oldValue: currentStyles[c.property] ?? "",
        newValue: c.value,
        suggestedToken: findTokenSuggestion(c.property, c.value),
      })),
    [changes, currentStyles],
  );

  const toggleToken = useCallback((property: string) => {
    setUseTokens((prev) => ({ ...prev, [property]: !prev[property] }));
  }, []);

  const handleApply = useCallback(() => {
    const finalChanges = enrichedChanges.map((c) => {
      const tokenMatch = DESIGN_TOKENS.find(
        (t) => t.property === c.property && t.pattern.test(c.newValue.trim()),
      );
      const shouldUseToken = useTokens[c.property] && tokenMatch;
      return {
        property: c.property,
        value: shouldUseToken ? tokenMatch.token : c.newValue,
      };
    });
    onApply(finalChanges);
  }, [enrichedChanges, useTokens, onApply]);

  if (enrichedChanges.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <p
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            textAlign: "center",
          }}
        >
          No pending style changes. Edit properties in the Inspector to see a diff preview.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }} role="region" aria-label="Style editor with change preview">
      {/* Header */}
      <h4
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          marginBottom: 12,
        }}
      >
        Change Preview
      </h4>

      {/* Diff list */}
      <div style={{ marginBottom: 16 }}>
        {enrichedChanges.map((change) => (
          <div
            key={change.property}
            style={{
              padding: "8px 10px",
              marginBottom: 6,
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              boxShadow: "var(--shadow-ring)",
            }}
          >
            {/* Property name */}
            <div
              style={{
                fontSize: "var(--font-size-2xs)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--color-text-dim)",
                marginBottom: 4,
              }}
            >
              {change.property}
            </div>

            {/* Old -> New diff */}
            <div className="flex items-center gap-2" style={{ fontSize: "var(--font-size-xs)", fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--red)", textDecoration: "line-through" }}>
                {change.oldValue || "(empty)"}
              </span>
              <span style={{ color: "var(--color-text-dim)" }}>&rarr;</span>
              <span style={{ color: "var(--green)" }}>{change.newValue}</span>
            </div>

            {/* Token suggestion */}
            {change.suggestedToken && (
              <button
                onClick={() => toggleToken(change.property)}
                style={{
                  marginTop: 6,
                  padding: "2px 8px",
                  fontSize: "var(--font-size-2xs)",
                  fontWeight: 500,
                  borderRadius: "var(--radius-xs)",
                  background: useTokens[change.property]
                    ? "var(--accent-muted)"
                    : "var(--surface-2)",
                  color: useTokens[change.property]
                    ? "var(--accent)"
                    : "var(--color-text-muted)",
                  border: "none",
                  cursor: "pointer",
                }}
                aria-pressed={useTokens[change.property] ?? false}
                aria-label={`Use design token ${change.suggestedToken} instead`}
              >
                {useTokens[change.property] ? "Using" : "Suggest"}: {change.suggestedToken}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleApply}
          className="btn-press flex-1"
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent)",
            color: "white",
            border: "none",
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          onClick={onReset}
          className="btn-press flex-1"
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            color: "var(--color-text-secondary)",
            boxShadow: "var(--shadow-ring)",
            border: "none",
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
