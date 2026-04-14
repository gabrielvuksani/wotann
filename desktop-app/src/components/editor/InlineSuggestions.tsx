/**
 * Inline Suggestions — keyboard hint overlay for FIM ghost text completions.
 *
 * The actual completion provider lives in MonacoEditor.tsx (registered as a
 * Monaco InlineCompletionsProvider). This component is a lightweight overlay
 * that shows keyboard shortcuts when a suggestion is visible:
 *
 *   Tab         — accept the full suggestion
 *   Cmd+Right   — accept the next word
 *   Esc         — dismiss the suggestion
 *
 * Visibility is driven by the parent (MonacoEditor) which tracks whether
 * Monaco's inline suggestion widget is active.
 */

interface InlineSuggestionsProps {
  /** Whether an inline completion is currently shown in the editor. */
  readonly visible: boolean;
}

export function InlineSuggestions({ visible }: InlineSuggestionsProps) {
  if (!visible) return null;

  return (
    <div
      className="inline-suggestion-hints"
      style={{
        position: "absolute",
        bottom: 8,
        right: 8,
        display: "flex",
        alignItems: "center",
        gap: 4,
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      <span
        className="px-1.5 py-0.5 text-[9px] rounded"
        style={{
          background: "var(--surface-2)",
          color: "var(--color-text-muted)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        Tab to accept
      </span>
      <span
        className="px-1.5 py-0.5 text-[9px] rounded"
        style={{
          background: "var(--surface-2)",
          color: "var(--color-text-muted)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        Cmd+Right next word
      </span>
      <span
        className="px-1.5 py-0.5 text-[9px] rounded"
        style={{
          background: "var(--surface-2)",
          color: "var(--color-text-muted)",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        Esc
      </span>
    </div>
  );
}
