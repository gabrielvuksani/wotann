/**
 * Side-by-side diff viewer with accept/reject buttons.
 */

interface DiffViewerProps {
  readonly filename: string;
  readonly original: string;
  readonly modified: string;
  readonly onAccept?: () => void;
  readonly onReject?: () => void;
}

function diffLines(original: string, modified: string): readonly { type: "same" | "add" | "remove"; content: string }[] {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const result: { type: "same" | "add" | "remove"; content: string }[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i];
    const modLine = modLines[i];

    if (origLine === modLine) {
      result.push({ type: "same", content: origLine ?? "" });
    } else {
      if (origLine !== undefined) {
        result.push({ type: "remove", content: origLine });
      }
      if (modLine !== undefined) {
        result.push({ type: "add", content: modLine });
      }
    }
  }

  return result;
}

export function DiffViewer({ filename, original, modified, onAccept, onReject }: DiffViewerProps) {
  const lines = diffLines(original, modified);
  const additions = lines.filter((l) => l.type === "add").length;
  const deletions = lines.filter((l) => l.type === "remove").length;

  return (
    <div className="rounded-xl overflow-hidden my-3" style={{ border: "1px solid var(--border-subtle)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-warning)" }}>
            <path d="M2 2h8l4 4v8H2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-medium font-mono" style={{ color: "var(--color-text-secondary)" }}>{filename}</span>
          <span className="text-[10px]" style={{ color: "var(--color-success)" }}>+{additions}</span>
          <span className="text-[10px]" style={{ color: "var(--color-error)" }}>-{deletions}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {onAccept && (
            <button
              onClick={onAccept}
              className="px-2.5 py-1 text-[10px] rounded-md border transition-colors"
              style={{ background: "var(--color-success-muted)", color: "var(--color-success)", borderColor: "rgba(16, 185, 129, 0.2)" }}
            >
              Accept
            </button>
          )}
          {onReject && (
            <button
              onClick={onReject}
              className="px-2.5 py-1 text-[10px] rounded-md border transition-colors"
              style={{ background: "var(--color-error-muted)", color: "var(--color-error)", borderColor: "rgba(239, 68, 68, 0.2)" }}
            >
              Reject
            </button>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        {lines.map((line, i) => (
          <div
            key={i}
            className="flex text-xs font-mono"
            style={{
              background: line.type === "add"
                ? "var(--color-success-muted)"
                : line.type === "remove"
                  ? "var(--color-error-muted)"
                  : undefined,
            }}
          >
            <span className="w-8 shrink-0 text-right pr-2 py-0.5 select-none" style={{ color: "var(--color-text-ghost)", borderRight: "1px solid var(--border-subtle)" }}>
              {i + 1}
            </span>
            <span className="w-5 shrink-0 text-center py-0.5 select-none">
              {line.type === "add" ? (
                <span style={{ color: "var(--color-success)" }}>+</span>
              ) : line.type === "remove" ? (
                <span style={{ color: "var(--color-error)" }}>-</span>
              ) : (
                <span style={{ color: "var(--color-text-ghost)" }}>&nbsp;</span>
              )}
            </span>
            <span
              className="flex-1 py-0.5 pr-4"
              style={{
                color: line.type === "add"
                  ? "var(--color-success)"
                  : line.type === "remove"
                    ? "var(--color-error)"
                    : "var(--color-text-dim)",
              }}
            >
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
