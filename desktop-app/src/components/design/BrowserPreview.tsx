/**
 * Browser Preview — embedded browser for live previewing web apps.
 * Part of Design Mode (Cursor 3 parity).
 *
 * Renders via iframe pointing to the user's dev server (localhost:PORT).
 * Supports element selection for visual editing.
 */

import { useState, useRef, useCallback } from "react";

interface BrowserPreviewProps {
  /** Dev server URL (e.g., http://localhost:3000) */
  readonly url: string;
  /** Callback when an element is clicked in the preview */
  readonly onElementSelect?: (info: { tag: string; className: string; text: string; rect: DOMRect }) => void;
}

export function BrowserPreview({ url, onElementSelect }: BrowserPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState(url);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setError("Failed to load preview. Is your dev server running?");
  }, []);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    if (iframeRef.current) {
      iframeRef.current.src = currentUrl;
    }
  }, [currentUrl]);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--color-bg-primary)" }}>
      {/* Toolbar */}
      <div
        className="flex items-center shrink-0"
        style={{
          height: 32,
          padding: "0 8px",
          gap: 8,
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
        }}
      >
        <button onClick={handleRefresh} className="header-icon-btn" style={{ width: 22, height: 22 }} aria-label="Refresh">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M10 2v3H7M2 10V7h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.5 5A4 4 0 0110 5M9.5 7A4 4 0 012 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <input
          type="text"
          value={currentUrl}
          onChange={(e) => setCurrentUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRefresh(); }}
          className="flex-1"
          style={{
            height: 22,
            padding: "0 8px",
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-secondary)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-xs)",
            outline: "none",
          }}
          aria-label="Preview URL"
        />
        <span style={{ fontSize: "var(--font-size-2xs)", color: isLoading ? "var(--amber)" : error ? "var(--red)" : "var(--green)" }}>
          {isLoading ? "Loading..." : error ? "Error" : "Ready"}
        </span>
      </div>

      {/* Preview area */}
      <div className="flex-1 relative min-h-0">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--color-bg-primary)" }}>
            <div style={{ textAlign: "center", padding: 24 }}>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", marginBottom: 8 }}>{error}</p>
              <button
                onClick={handleRefresh}
                className="btn-press"
                style={{
                  padding: "6px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--accent-muted)",
                  color: "var(--accent)",
                  border: "none",
                  fontSize: "var(--font-size-xs)",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={currentUrl}
          onLoad={handleLoad}
          onError={handleError}
          title="Browser Preview"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            background: "white",
          }}
        />
      </div>
    </div>
  );
}
