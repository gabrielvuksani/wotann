/**
 * React Error Boundary — catches render errors and shows recovery UI.
 * Wraps AppShell to prevent entire app from crashing to white screen.
 */

import { Component, type ReactNode, type ErrorInfo } from "react";
import { color } from "../../design/tokens.generated";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
  readonly errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Log to crash reporting if available
    console.error("[WOTANN ErrorBoundary]", error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleDismiss = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          width: "100vw",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans)",
          padding: "var(--space-2xl)",
        }}
        role="alert"
        aria-live="assertive"
      >
        {/* Error icon */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "var(--radius-xl)",
            background: "var(--color-error-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--space-xl)",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="12" stroke="var(--color-error)" strokeWidth="2" />
            <path d="M14 8v8M14 19v1" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <h1 style={{ fontSize: "var(--font-size-xl)", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "var(--font-size-base)", color: "var(--color-text-muted)", marginBottom: "var(--space-xl)", textAlign: "center", maxWidth: 480 }}>
          WOTANN encountered an unexpected error. Your data is safe. Try reloading the app, or dismiss to attempt recovery.
        </p>

        {/* Error details (collapsed by default) */}
        {this.state.error && (
          <details
            style={{
              width: "100%",
              maxWidth: 600,
              marginBottom: "var(--space-xl)",
              background: "var(--surface-2)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-md)",
            }}
          >
            <summary style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", cursor: "pointer" }}>
              Error details
            </summary>
            <pre
              style={{
                marginTop: "var(--space-sm)",
                fontSize: "var(--font-size-xs)",
                color: "var(--color-error)",
                fontFamily: "var(--font-mono)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {this.state.error.message}
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
        )}

        {/* Action buttons */}
        <div className="flex items-center" style={{ gap: "var(--space-sm)" }}>
          <button
            onClick={this.handleReload}
            className="btn-press"
            style={{
              padding: "8px 24px",
              borderRadius: "var(--radius-md)",
              background: "var(--gradient-accent)",
              color: color("text"),
              border: "none",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "var(--shadow-glow)",
            }}
          >
            Reload App
          </button>
          <button
            onClick={this.handleDismiss}
            className="btn-press"
            style={{
              padding: "8px 24px",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-2)",
              color: "var(--color-text-secondary)",
              boxShadow: "0px 0px 0px 1px rgba(255,255,255,0.1)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try to Recover
          </button>
        </div>
      </div>
    );
  }
}
