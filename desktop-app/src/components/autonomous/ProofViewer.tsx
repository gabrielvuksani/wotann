/**
 * Proof Bundle Viewer — desktop web version.
 * Displays test results, typecheck output, diff summary, cost breakdown after autonomous runs.
 * Wire into TaskMonitor agent cards to show proof of work.
 */

interface ProofBundle {
  readonly sessionId: string;
  readonly timestamp: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly testsTotal: number;
  readonly typecheckClean: boolean;
  readonly typecheckOutput?: string;
  readonly diffSummary: {
    readonly filesChanged: number;
    readonly additions: number;
    readonly deletions: number;
  };
  readonly cost: number;
  readonly elapsed: number; // seconds
  readonly errors: readonly string[];
}

interface ProofViewerProps {
  readonly proof: ProofBundle | null;
  readonly onClose?: () => void;
}

export function ProofViewer({ proof, onClose }: ProofViewerProps) {
  if (!proof) {
    return (
      <div
        style={{
          padding: "var(--space-xl)",
          textAlign: "center",
          color: "var(--color-text-muted)",
        }}
      >
        <p style={{ fontSize: "var(--font-size-sm)" }}>No proof bundle available</p>
      </div>
    );
  }

  const allTestsPassed = proof.testsFailed === 0 && proof.testsTotal > 0;
  const passRate = proof.testsTotal > 0 ? ((proof.testsPassed / proof.testsTotal) * 100).toFixed(0) : "N/A";
  const elapsed = proof.elapsed < 60
    ? `${proof.elapsed}s`
    : `${Math.floor(proof.elapsed / 60)}m ${proof.elapsed % 60}s`;

  return (
    <div
      className="animate-fadeIn"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-md)",
        maxWidth: 480,
      }}
      role="region"
      aria-label="Proof bundle"
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: "var(--space-md)" }}>
        <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Proof Bundle
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="btn-press"
            style={{
              padding: 4,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
            aria-label="Close proof viewer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Status grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
        {/* Tests */}
        <StatusCard
          label="Tests"
          value={`${proof.testsPassed}/${proof.testsTotal} (${passRate}%)`}
          status={allTestsPassed ? "success" : proof.testsFailed > 0 ? "error" : "info"}
        />
        {/* Typecheck */}
        <StatusCard
          label="Typecheck"
          value={proof.typecheckClean ? "Clean" : "Errors"}
          status={proof.typecheckClean ? "success" : "error"}
        />
        {/* Diff */}
        <StatusCard
          label="Changes"
          value={`${proof.diffSummary.filesChanged} files (+${proof.diffSummary.additions} -${proof.diffSummary.deletions})`}
          status="info"
        />
        {/* Cost & Time */}
        <StatusCard
          label="Cost / Time"
          value={`$${proof.cost.toFixed(3)} / ${elapsed}`}
          status="info"
        />
      </div>

      {/* Errors */}
      {proof.errors.length > 0 && (
        <div style={{ marginBottom: "var(--space-md)" }}>
          <h4 style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-error)", marginBottom: "var(--space-xs)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Errors ({proof.errors.length})
          </h4>
          {proof.errors.map((err, i) => (
            <div
              key={i}
              style={{
                padding: "6px 8px",
                background: "var(--color-error-muted)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-xs)",
                fontFamily: "var(--font-mono)",
                color: "var(--color-error)",
                marginBottom: "var(--space-xs)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Typecheck output (if errors) */}
      {!proof.typecheckClean && proof.typecheckOutput && (
        <details style={{ marginBottom: "var(--space-sm)" }}>
          <summary style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", cursor: "pointer" }}>
            Typecheck output
          </summary>
          <pre style={{
            marginTop: "var(--space-xs)",
            padding: "var(--space-sm)",
            background: "var(--surface-2)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-secondary)",
            maxHeight: 150,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}>
            {proof.typecheckOutput}
          </pre>
        </details>
      )}

      {/* Session ID */}
      <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-ghost)", fontFamily: "var(--font-mono)" }}>
        {proof.sessionId} - {new Date(proof.timestamp).toLocaleString()}
      </div>
    </div>
  );
}

function StatusCard({ label, value, status }: { readonly label: string; readonly value: string; readonly status: "success" | "error" | "info" }) {
  const colors = {
    success: { bg: "var(--color-success-muted)", color: "var(--color-success)", icon: "M5 9l3 3 5-5" },
    error: { bg: "var(--color-error-muted)", color: "var(--color-error)", icon: "M4 4l6 6M10 4l-6 6" },
    info: { bg: "var(--surface-2)", color: "var(--color-text-secondary)", icon: "M7 3v4M7 9v1" },
  };
  const c = colors[status];

  return (
    <div
      style={{
        padding: "var(--space-sm)",
        background: c.bg,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex items-center" style={{ gap: 4, marginBottom: 2 }}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d={c.icon} stroke={c.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, color: c.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-primary)", fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}
