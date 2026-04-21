/**
 * A2UI Canvas — Agent-to-User Interface visual workspace.
 * The agent renders interactive HTML/CSS/JS content via a declarative protocol.
 * All content is sandboxed in an iframe with strict CSP for security.
 *
 * Protocol (from OpenClaw A2UI pattern):
 * - Agent sends: { action: "surfaceUpdate", surface: { id, html, css, scripts, dataModel } }
 * - Canvas renders in sandboxed iframe
 * - Data model updates via postMessage (no full re-render)
 *
 * Use cases: dashboards (45%), interactive forms (30%), monitors (15%), calculators (10%)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useStore } from "../../store";
import { EmptyState } from "../shared/ErrorState";
import { color } from "../../design/tokens.generated";

interface CanvasSurface {
  readonly id: string;
  readonly html: string;
  readonly css: string;
  readonly scripts: string;
  readonly dataModel: Readonly<Record<string, unknown>>;
  readonly title?: string;
  readonly updatedAt: number;
}

/**
 * Build a sandboxed HTML document from a surface definition.
 * CSP: no network, no storage, scripts only inline.
 */
function buildSandboxedHtml(surface: CanvasSurface): string {
  // Read CSS variable values from the host document to inject into the sandboxed iframe.
  // TODO(design-token): iframe is sandboxed; CSS vars don't cross the boundary.
  // We read from host on build, substitute the resolved string into iframe CSS.
  // Fallbacks stay literal because the iframe can't resolve var() at runtime.
  const style = getComputedStyle(document.documentElement);
  const cssVar = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  const bgBase = cssVar("--bg-base", "#09090b");
  const textPrimary = cssVar("--color-text-primary", "#fafafa");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: ${bgBase};
      color: ${textPrimary};
      padding: 16px;
      font-size: 14px;
      line-height: 1.5;
    }
    ${surface.css}
  </style>
</head>
<body>
  ${surface.html}
  <script>
    // Data model — accessible to surface scripts
    let __dataModel = ${JSON.stringify(surface.dataModel)};

    // Listen for data model updates from parent
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'dataModelUpdate') {
        Object.assign(__dataModel, e.data.updates);
        // Dispatch custom event for surface scripts to react
        window.dispatchEvent(new CustomEvent('dataUpdate', { detail: __dataModel }));
      }
    });

    // Surface scripts
    ${surface.scripts}
  </script>
</body>
</html>`;
}

export function CanvasView() {
  const [surfaces, setSurfaces] = useState<readonly CanvasSurface[]>([]);
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const engineConnected = useStore((s) => s.engineConnected);

  const activeSurface = surfaces.find((s) => s.id === activeSurfaceId) ?? surfaces[0] ?? null;

  // Add a new surface (called by the agent via chat tool calls)
  const addSurface = useCallback((surface: CanvasSurface) => {
    setSurfaces((prev) => {
      const existing = prev.findIndex((s) => s.id === surface.id);
      if (existing >= 0) {
        // Update existing surface
        return prev.map((s, i) => (i === existing ? surface : s));
      }
      return [...prev, surface];
    });
    setActiveSurfaceId(surface.id);
  }, []);

  // Update data model of the active surface (surgical update, no re-render)
  const updateDataModel = useCallback(
    (updates: Readonly<Record<string, unknown>>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "dataModelUpdate", updates },
        "*",
      );
    },
    [],
  );

  // Expose addSurface globally for the engine to call
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__wotannCanvas = { addSurface, updateDataModel };
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__wotannCanvas;
    };
  }, [addSurface, updateDataModel]);

  // Remove a surface
  const removeSurface = useCallback((id: string) => {
    setSurfaces((prev) => prev.filter((s) => s.id !== id));
    if (activeSurfaceId === id) {
      setActiveSurfaceId(null);
    }
  }, [activeSurfaceId]);

  // Demo surface for testing
  // TODO(design-token): the demo HTML embeds literal hex for use inside a
  // sandboxed iframe. The iframe has no access to the host's `--wotann-color-*`
  // CSS vars (sandbox="allow-scripts" + CSP default-src 'none'), so tokens
  // can't be injected here. These literals are test-only demo swatches.
  const addDemoSurface = useCallback(() => {
    addSurface({
      id: `demo-${Date.now()}`,
      title: "Demo Dashboard",
      html: `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
          <div style="background: rgba(10,132,255,0.1); border: 1px solid rgba(10,132,255,0.2); border-radius: 8px; padding: 16px;">
            <div style="font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Workers</div>
            <div style="font-size: 24px; font-weight: 700; color: #0A84FF;" id="worker-count">3</div>
          </div>
          <div style="background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); border-radius: 8px; padding: 16px;">
            <div style="font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Tasks Done</div>
            <div style="font-size: 24px; font-weight: 700; color: #4ade80;">12</div>
          </div>
          <div style="background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.2); border-radius: 8px; padding: 16px;">
            <div style="font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Cost Today</div>
            <div style="font-size: 24px; font-weight: 700; color: #38bdf8;">$1.47</div>
          </div>
        </div>
        <div style="background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 16px;">
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 12px;">Activity Log</div>
          <div style="font-size: 12px; color: #a1a1aa; line-height: 1.8;">
            <div>Agent "auth-fix" completed in 2m 34s</div>
            <div>Agent "test-suite" started running tests</div>
            <div>Cost alert: Today's spending reached $1.47</div>
          </div>
        </div>
      `,
      css: "",
      scripts: `
        window.addEventListener('dataUpdate', (e) => {
          const el = document.getElementById('worker-count');
          if (el && e.detail.workers) el.textContent = String(e.detail.workers);
        });
      `,
      dataModel: { workers: 3, tasksDone: 12, costToday: 1.47 },
      updatedAt: Date.now(),
    });
  }, [addSurface]);

  if (!activeSurface) {
    return (
      <div className="h-full flex flex-col" style={{ background: "var(--color-bg-primary)" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div>
            <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)" }}>Canvas</h2>
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Agent-rendered visual workspace</p>
          </div>
          <button
            onClick={addDemoSurface}
            className="btn-press"
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent-muted)",
              color: "var(--accent)",
              border: "none",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Demo Dashboard
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title="No canvas active"
            message={engineConnected
              ? "Ask the agent to render a dashboard, form, or visualization"
              : "Connect to the engine to use Canvas"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-bg-primary)" }}>
      {/* Tab bar for multiple surfaces */}
      <div className="flex items-center shrink-0" style={{ padding: "0 12px", borderBottom: "1px solid var(--border-subtle)", height: 36 }}>
        <div className="flex items-center gap-1 flex-1 overflow-x-auto">
          {surfaces.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSurfaceId(s.id)}
              className="btn-press flex items-center gap-1.5 shrink-0"
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-xs)",
                fontWeight: activeSurfaceId === s.id ? 600 : 400,
                color: activeSurfaceId === s.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
                background: activeSurfaceId === s.id ? "var(--bg-surface-active)" : "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              {s.title ?? s.id}
              <span
                onClick={(e) => { e.stopPropagation(); removeSurface(s.id); }}
                style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-ghost)", cursor: "pointer", padding: "0 2px" }}
                aria-label={`Close ${s.title ?? s.id}`}
              >
                x
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={addDemoSurface}
          className="header-icon-btn"
          style={{ width: 24, height: 24 }}
          aria-label="Add demo surface"
          title="Add demo"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Sandboxed iframe renderer */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts"
          srcDoc={buildSandboxedHtml(activeSurface)}
          title={activeSurface.title ?? "Canvas surface"}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            background: `var(--bg-base, ${color("background")})`,
          }}
        />
      </div>
    </div>
  );
}
