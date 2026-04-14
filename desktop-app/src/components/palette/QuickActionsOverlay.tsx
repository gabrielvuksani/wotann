/**
 * Quick Actions Overlay — accessible from anywhere via Cmd+Shift+A.
 * Shows 2×3 grid of workspace-preset-driven action cards.
 * Same actions as the Welcome Screen but available at any time.
 */

import { useEffect } from "react";
import { useStore } from "../../store";
import { OverlayBackdrop } from "../shared/OverlayBackdrop";
import { WORKSPACE_PRESETS, type QuickActionConfig } from "../../lib/workspace-presets";

const ACTION_ROUTES: Record<string, { type: string; target: string }> = {
  editor: { type: "view", target: "editor" },
  test: { type: "mode", target: "build" },
  review: { type: "mode", target: "review" },
  research: { type: "mode", target: "chat" },
  compare: { type: "view", target: "compare" },
  cost: { type: "view", target: "cost" },
  exploit: { type: "view", target: "exploit" },
  tasks: { type: "view", target: "workshop" },
  dispatch: { type: "view", target: "workshop" },
  scheduled: { type: "view", target: "workshop" },
  playground: { type: "view", target: "editor" },
  arbitrage: { type: "view", target: "cost" },
};

function getActionIcon(icon: string): React.ReactNode {
  const iconMap: Record<string, React.ReactNode> = {
    code: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M7 6L3 10l4 4M13 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    play: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M6 4l10 6-10 6V4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    diff: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    search: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="9" cy="9" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    columns: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="7" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="11" y="3" width="7" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    dollar: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 3v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M13 6.5c0-.5-1-2-3-2s-3 1.5-3 2.5c0 1.5 1.5 2 3 2.5s3 1 3 2.5c0 1-1 2.5-3 2.5s-3-1.5-3-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    shield: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 2L4 5v5c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V5l-6-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    tasks: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 7h6M7 10h4M7 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  };
  return iconMap[icon] ?? iconMap["code"];
}

interface QuickActionsOverlayProps {
  readonly onClose: () => void;
}

export function QuickActionsOverlay({ onClose }: QuickActionsOverlayProps) {
  const settings = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const setMode = useStore((s) => s.setMode);

  const preset = WORKSPACE_PRESETS[settings.workspacePreset];
  const actions = preset.quickActions.slice(0, 6);

  function executeAction(action: QuickActionConfig) {
    const route = ACTION_ROUTES[action.action];
    if (route) {
      if (route.type === "view") {
        setView(route.target);
      } else if (route.type === "mode") {
        setMode(route.target as "chat" | "build" | "autopilot" | "compare" | "review");
      }
    }
    onClose();
  }

  // Wire 1-6 number key shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= actions.length) {
        e.preventDefault();
        executeAction(actions[num - 1]!);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <OverlayBackdrop onClose={onClose} placement="center" ariaLabel="Quick Actions" maxWidth={480} maxHeight={400}>
      <div style={{ padding: 24 }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>
            Quick Actions
          </h2>
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
            {preset.label} preset — <button onClick={onClose} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: "var(--font-size-xs)" }}>Cmd+Shift+A</button>
          </p>
        </div>

        {/* 2×3 Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          {actions.map((action) => (
            <button
              key={action.action}
              onClick={() => executeAction(action)}
              className="btn-press"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 150ms ease",
              }}
              aria-label={action.label}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--accent-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent)",
                  flexShrink: 0,
                }}
              >
                {getActionIcon(action.icon)}
              </div>
              <div>
                <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {action.label}
                </div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginTop: 2 }}>
                  {action.description}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Keyboard hint */}
        <div style={{ marginTop: 16, textAlign: "center", fontSize: "var(--font-size-2xs)", color: "var(--color-text-ghost)" }}>
          Press 1-6 to select — Escape to close
        </div>
      </div>
    </OverlayBackdrop>
  );
}
