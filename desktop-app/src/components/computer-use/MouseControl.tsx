/**
 * Mouse control — x/y inputs and a Click button.
 * Invokes `execute_mouse_action` with action=click and x/y coords.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { color } from "../../design/tokens.generated";

type MouseAction = "click" | "double_click" | "right_click" | "move";

interface InputResult {
  readonly success: boolean;
  readonly error?: string | null;
}

export function MouseControl() {
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [action, setAction] = useState<MouseAction>("click");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      setStatus({ ok: false, text: "Enter numeric x and y" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await invoke<InputResult>("execute_mouse_action", {
        action,
        x: px,
        y: py,
      });
      if (res?.success) {
        setStatus({ ok: true, text: `${action} at ${px}, ${py}` });
      } else {
        setStatus({ ok: false, text: res?.error ?? "Mouse action failed" });
      }
    } catch (err) {
      setStatus({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }, [x, y, action]);

  const inputStyle: React.CSSProperties = {
    background: color("background"),
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    color: "var(--color-text-primary)",
    outline: "none",
    fontFamily: "var(--font-mono)",
    width: "100%",
  };

  return (
    <div
      style={{
        background: color("surface"),
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
        Mouse Control
      </h3>

      <div className="grid grid-cols-3 gap-2">
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-text-dim)" }}>
          x
          <input
            type="number"
            value={x}
            onChange={(e) => setX(e.target.value)}
            placeholder="200"
            style={inputStyle}
            aria-label="Mouse x coordinate"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-text-dim)" }}>
          y
          <input
            type="number"
            value={y}
            onChange={(e) => setY(e.target.value)}
            placeholder="200"
            style={inputStyle}
            aria-label="Mouse y coordinate"
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-text-dim)" }}>
          action
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as MouseAction)}
            style={inputStyle}
            aria-label="Mouse action type"
          >
            <option value="click">click</option>
            <option value="double_click">double</option>
            <option value="right_click">right</option>
            <option value="move">move</option>
          </select>
        </label>
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="btn-press"
        style={{
          minHeight: 44,
          padding: "0 16px",
          borderRadius: 10,
          fontSize: 15,
          fontWeight: 500,
          border: "none",
          background: color("accent"),
          color: color("text"),
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
        aria-label={`Execute ${action}`}
      >
        {busy ? "..." : `Execute ${action.replace("_", " ")}`}
      </button>

      {status && (
        <p
          role="status"
          style={{
            fontSize: 12,
            // TODO(design-token): --color-success/--color-error fallbacks use Apple SF palette; wotann tokens are close but distinct
            color: status.ok
              ? `var(--color-success, ${color("success")})`
              : `var(--color-error, ${color("error")})`,
            margin: 0,
          }}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
