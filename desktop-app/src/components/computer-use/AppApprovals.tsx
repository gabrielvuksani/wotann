/**
 * App approval list — shows apps that have been granted computer-use access.
 * Lets the user approve a new app or revoke access.
 *
 * Backend commands used (all exist in Tauri invoke_handler):
 * - approve_cu_app(app_name): grants approval
 * - is_cu_app_approved(app_name): checks approval
 * - is_cu_sentinel_app(app_name): flags dangerous apps
 *
 * NOTE: There is no `list_granted_apps` command in the backend — granted apps
 * are tracked per-session in AppState.computer_use. We display a locally-
 * tracked list in this component instead.
 */

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { color } from "../../design/tokens.generated";

interface ApprovedApp {
  readonly name: string;
  readonly approved: boolean;
  readonly sentinel: boolean;
  readonly grantedAt: number;
}

const STORAGE_KEY = "wotann-cu-granted-apps";

function loadFromStorage(): readonly ApprovedApp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ApprovedApp[];
  } catch {
    return [];
  }
}

function saveToStorage(apps: readonly ApprovedApp[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
  } catch {
    /* storage unavailable */
  }
}

export function AppApprovals() {
  const [apps, setApps] = useState<readonly ApprovedApp[]>(() => loadFromStorage());
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* On mount, re-validate each app's approval status with the backend. */
  useEffect(() => {
    let cancelled = false;
    async function sync() {
      const updates = await Promise.all(
        apps.map(async (app) => {
          try {
            const approved = await invoke<boolean>("is_cu_app_approved", { appName: app.name });
            return { ...app, approved };
          } catch {
            return app;
          }
        }),
      );
      if (!cancelled) setApps(updates);
    }
    if (apps.length > 0) sync();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grant = useCallback(async (name: string) => {
    setError(null);
    setBusy(true);
    try {
      const sentinel = await invoke<boolean>("is_cu_sentinel_app", { appName: name });
      if (sentinel) {
        const confirmed = window.confirm(
          `${name} is a sentinel (sensitive) app — granting control is risky. Continue?`,
        );
        if (!confirmed) {
          setBusy(false);
          return;
        }
      }
      const ok = await invoke<boolean>("approve_cu_app", { appName: name });
      const now = Date.now();
      setApps((prev) => {
        const filtered = prev.filter((a) => a.name !== name);
        const next: ApprovedApp[] = [...filtered, { name, approved: ok, sentinel, grantedAt: now }];
        saveToStorage(next);
        return next;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const revoke = useCallback((name: string) => {
    setApps((prev) => {
      const next = prev.filter((a) => a.name !== name);
      saveToStorage(next);
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Enter an app name (e.g. Safari, Terminal)");
      return;
    }
    setNewName("");
    grant(trimmed);
  }, [newName, grant]);

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
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
        App Approvals
      </h3>

      {/* Grant input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="App name (e.g. Safari)"
          style={{
            flex: 1,
            background: color("background"),
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "var(--radius-md)",
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--color-text-primary)",
            outline: "none",
          }}
          aria-label="Application name to grant"
        />
        <button
          onClick={submit}
          disabled={busy || !newName.trim()}
          className="btn-press"
          style={{
            minHeight: 40,
            padding: "0 16px",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            fontWeight: 500,
            border: "none",
            background: color("accent"),
            color: color("text"),
            cursor: busy || !newName.trim() ? "not-allowed" : "pointer",
            opacity: busy || !newName.trim() ? 0.6 : 1,
          }}
          aria-label="Grant access"
        >
          Grant
        </button>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: 12, color: `var(--color-error, ${color("error")})`, margin: 0 }}>{error}</p>
      )}

      {/* Approved list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {apps.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", margin: "4px 0", fontStyle: "italic" }}>
            No apps granted yet.
          </p>
        ) : (
          apps.map((app) => (
            <div
              key={app.name}
              className="flex items-center justify-between"
              style={{
                padding: "8px 12px",
                background: color("background"),
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                <span
                  aria-label={app.approved ? "approved" : "revoked"}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    // TODO(design-token): map to semantic token — SF system green/grey differ from wotann success/muted
                    background: app.approved ? "#30d158" : "#8e8e93",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {app.name}
                </span>
                {app.sentinel && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 5px",
                      borderRadius: "var(--radius-xs)",
                      background: "rgba(255,69,58,0.15)",
                      color: color("error"),
                      letterSpacing: "0.02em",
                    }}
                  >
                    SENTINEL
                  </span>
                )}
              </div>
              <button
                onClick={() => revoke(app.name)}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "transparent",
                  color: "var(--color-text-dim)",
                  cursor: "pointer",
                }}
                aria-label={`Revoke access to ${app.name}`}
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
