/**
 * Live screenshot preview — invokes `capture_screenshot` and renders the PNG.
 * Has a manual refresh button and optional auto-refresh toggle.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { color } from "../../design/tokens.generated";

interface Screenshot {
  readonly data: string;        // base64 PNG
  readonly width: number;
  readonly height: number;
  readonly timestamp?: number;
}

export function ScreenPreview() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ w: number; h: number; ts: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef<number | null>(null);

  const capture = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const shot = await invoke<Screenshot>("capture_screenshot", {});
      if (shot?.data) {
        const bytes = shot.data.startsWith("data:")
          ? shot.data
          : `data:image/png;base64,${shot.data}`;
        setDataUrl(bytes);
        setMeta({ w: shot.width ?? 0, h: shot.height ?? 0, ts: Date.now() });
      } else {
        setError("No screenshot data returned");
      }
    } catch (err) {
      setError(String(err ?? "Screenshot failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    capture();
    timerRef.current = window.setInterval(capture, 2000);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autoRefresh, capture]);

  return (
    <div
      style={{
        background: color("surface"),
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            Screen Preview
          </h3>
          {meta && (
            <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: "2px 0 0" }}>
              {meta.w}x{meta.h} · {new Date(meta.ts).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              aria-label="Auto refresh screen preview every 2s"
            />
            Auto
          </label>
          <button
            onClick={capture}
            disabled={loading}
            className="btn-press"
            style={{
              minHeight: 32,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(255,255,255,0.08)",
              background: color("accent"),
              color: color("text"),
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
            aria-label="Capture screenshot"
          >
            {loading ? "Capturing..." : "Capture"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: color("background"),
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          aspectRatio: "16 / 10",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {error ? (
          <p style={{ color: `var(--color-error, ${color("error")})`, fontSize: 13, padding: 12 }}>{error}</p>
        ) : dataUrl ? (
          /* eslint-disable-next-line jsx-a11y/alt-text */
          <img
            src={dataUrl}
            alt="Live screen capture"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <p style={{ color: "var(--color-text-dim)", fontSize: 13 }}>
            {loading ? "Capturing..." : "Click Capture to preview your screen"}
          </p>
        )}
      </div>
    </div>
  );
}
