/**
 * Keyboard control — text typing and key press (with modifiers).
 * Invokes `execute_keyboard_action`.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface InputResult {
  readonly success: boolean;
  readonly error?: string | null;
}

const MODIFIERS = ["cmd", "ctrl", "alt", "shift"] as const;
type Modifier = typeof MODIFIERS[number];

export function KeyboardControl() {
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [mods, setMods] = useState<ReadonlySet<Modifier>>(new Set());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleMod = useCallback((m: Modifier) => {
    setMods((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }, []);

  const runType = useCallback(async () => {
    if (!text) {
      setStatus({ ok: false, text: "Enter text to type" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await invoke<InputResult>("execute_keyboard_action", {
        action: "type",
        text,
      });
      setStatus(res?.success
        ? { ok: true, text: `Typed ${text.length} chars` }
        : { ok: false, text: res?.error ?? "Type failed" });
    } catch (err) {
      setStatus({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }, [text]);

  const runPress = useCallback(async () => {
    if (!key) {
      setStatus({ ok: false, text: "Enter a key" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const modifiers = Array.from(mods);
      const res = await invoke<InputResult>("execute_keyboard_action", {
        action: modifiers.length > 0 ? "shortcut" : "press",
        text: key,
        modifiers: modifiers.length > 0 ? [...modifiers, key] : [key],
      });
      const combo = modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;
      setStatus(res?.success
        ? { ok: true, text: `Pressed ${combo}` }
        : { ok: false, text: res?.error ?? "Press failed" });
    } catch (err) {
      setStatus({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }, [key, mods]);

  const inputStyle: React.CSSProperties = {
    background: "#000",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    color: "var(--color-text-primary)",
    outline: "none",
    width: "100%",
  };

  return (
    <div
      style={{
        background: "#1C1C1E",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
        Keyboard
      </h3>

      {/* Type text */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11, color: "var(--color-text-dim)" }}>Type text</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Hello, world"
            style={inputStyle}
            aria-label="Text to type"
            onKeyDown={(e) => e.key === "Enter" && runType()}
          />
          <button
            onClick={runType}
            disabled={busy || !text}
            className="btn-press"
            style={{
              minHeight: 40,
              padding: "0 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#0A84FF",
              color: "#fff",
              cursor: busy || !text ? "not-allowed" : "pointer",
              opacity: busy || !text ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
            aria-label="Type text"
          >
            Type
          </button>
        </div>
      </div>

      {/* Key press / shortcut */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11, color: "var(--color-text-dim)" }}>Key press + modifiers</label>
        <div className="flex flex-wrap gap-1.5">
          {MODIFIERS.map((m) => {
            const active = mods.has(m);
            return (
              <button
                key={m}
                onClick={() => toggleMod(m)}
                style={{
                  minHeight: 28,
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "var(--font-mono)",
                  border: `1px solid ${active ? "#0A84FF" : "rgba(255,255,255,0.08)"}`,
                  background: active ? "rgba(10,132,255,0.15)" : "#000",
                  color: active ? "#0A84FF" : "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
                aria-pressed={active}
                aria-label={`Toggle ${m} modifier`}
              >
                {m}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="enter, space, a, F5..."
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
            aria-label="Key to press"
            onKeyDown={(e) => e.key === "Enter" && runPress()}
          />
          <button
            onClick={runPress}
            disabled={busy || !key}
            className="btn-press"
            style={{
              minHeight: 40,
              padding: "0 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#0A84FF",
              color: "#fff",
              cursor: busy || !key ? "not-allowed" : "pointer",
              opacity: busy || !key ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
            aria-label="Press key combination"
          >
            Press
          </button>
        </div>
      </div>

      {status && (
        <p
          role="status"
          style={{
            fontSize: 12,
            color: status.ok ? "var(--color-success, #30d158)" : "var(--color-error, #ff453a)",
            margin: 0,
          }}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
