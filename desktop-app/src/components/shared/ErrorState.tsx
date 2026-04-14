/**
 * Error State -- reusable error display with retry button.
 * Also provides DisconnectedBanner and EmptyState.
 */

interface ErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
  /** Inline SVG string for the icon (no emoji). */
  readonly icon?: string;
}

const DEFAULT_ERROR_ICON = '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5L1 13.5h14L8 1.5z"/><path d="M8 6.5v3M8 11.5v.5"/></svg>';

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  icon = DEFAULT_ERROR_ICON,
}: ErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center animate-fadeIn"
      style={{ padding: "48px var(--space-lg)" }}
      role="alert"
      aria-live="assertive"
    >
      {/* SVG icon is a trusted internal string, not user input */}
      <div style={{ marginBottom: "var(--space-sm)", color: "var(--color-warning)" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />
      <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: "var(--space-xs)" }}>{title}</h3>
      <p style={{ fontSize: "var(--font-size-xs)", maxWidth: 384, color: "var(--color-text-muted)", marginBottom: "var(--space-md)" }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-press transition-colors"
          style={{
            padding: "6px var(--space-md)",
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            color: "white",
            borderRadius: "var(--radius-md)",
            background: "var(--gradient-accent)",
            border: "none",
            cursor: "pointer",
          }}
          aria-label="Retry the failed action"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

/** Disconnected banner for top of views */
export function DisconnectedBanner({ onRetry }: { readonly onRetry?: () => void }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: "8px 16px",
        background: "var(--color-warning-muted)",
        borderBottom: "1px solid var(--color-warning-muted)",
        minWidth: 0,
      }}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center min-w-0" style={{ gap: 8 }}>
        <div className="shrink-0" style={{ width: 6, height: 6, borderRadius: 9999, background: "var(--color-warning)" }} aria-hidden="true" />
        <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--color-text-muted)" }}>
          Engine disconnected
        </span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-press"
          style={{
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            color: "var(--color-warning)",
            background: "var(--color-warning-muted)",
            border: "1px solid var(--color-warning-muted)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 8px",
            cursor: "pointer",
            flexShrink: 0,
            whiteSpace: "nowrap",
            transition: "var(--transition-fast)",
          }}
          aria-label="Attempt to reconnect to the engine"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

/** Empty state with inline SVG icon and helpful message */
interface EmptyStateProps {
  /** Inline SVG string for the icon (no emoji). */
  readonly icon?: string;
  readonly title?: string;
  readonly message: string;
  readonly action?: { label: string; onClick: () => void };
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center animate-fadeIn" style={{ padding: "48px var(--space-lg)" }}>
      {icon && (
        <div
          className="flex items-center justify-center mx-auto"
          style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius-lg)",
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            color: "var(--color-text-muted)",
            marginBottom: "var(--space-sm)",
          }}
          aria-hidden="true"
          /* SVG icon is a trusted internal string, not user input */
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      )}
      {title && <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: "var(--space-xs)" }}>{title}</h3>}
      <p style={{ fontSize: "var(--font-size-xs)", maxWidth: 384, color: "var(--color-text-muted)" }}>{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-press transition-colors"
          style={{
            marginTop: "var(--space-md)",
            padding: "6px var(--space-md)",
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            color: "white",
            borderRadius: "var(--radius-md)",
            background: "var(--gradient-accent)",
            border: "none",
            cursor: "pointer",
          }}
          aria-label={action.label}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
