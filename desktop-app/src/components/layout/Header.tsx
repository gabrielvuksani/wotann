/**
 * Top header — Chat|Editor pills + Terminal/Diff toggle icons.
 *
 * Layout:
 * [hamburger] [Chat|Editor] (spacer) [Terminal] [Diff] [Model] [Notif] [Settings] [Cmd+K]
 *
 * The 4-tab header (Chat|Editor|Workshop|Exploit) is eliminated.
 * Workshop is accessed via the Worker Pill in the sidebar.
 * Exploit is accessed via the command palette or settings.
 * Terminal + Diff are independent toggle icon buttons.
 */

import { useState } from "react";
import { useStore } from "../../store";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { ModelPicker } from "../input/ModelPicker";
import type { AppView } from "../../types";

/** The four primary view pills. Session-10 UX audit TD-3.1: Workshop
 * and Exploit were only reachable from the palette / sidebar workerpill
 * despite being peer-level "spaces". Adding them as top-pill gives
 * first-time users a visible path and matches the ⌘1-⌘4 shortcut
 * binding introduced in the same session. */
const VIEW_PILLS: readonly { readonly id: AppView; readonly label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "editor", label: "Editor" },
  { id: "workshop", label: "Workshop" },
  { id: "exploit", label: "Exploit" },
];

export function Header() {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const toggleContextPanel = useStore((s) => s.toggleContextPanel);
  const contextPanelOpen = useStore((s) => s.contextPanelOpen);
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const notifications = useStore((s) => s.notifications);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Panel toggles
  const terminalPanelOpen = useStore((s) => s.terminalPanelOpen);
  const diffPanelOpen = useStore((s) => s.diffPanelOpen);
  const toggleTerminalPanel = useStore((s) => s.toggleTerminalPanel);
  const toggleDiffPanel = useStore((s) => s.toggleDiffPanel);

  return (
    <header
      className="flex items-center shrink-0"
      style={{
        height: "var(--header-height, 36px)",
        padding: "0 12px",
        paddingLeft: "env(titlebar-area-x, 78px)", /* macOS traffic light inset */
        position: "relative",
        zIndex: 50,
        background: "var(--color-bg-primary)",
        borderBottom: "1px solid var(--border-subtle)",
        backdropFilter: "blur(40px) saturate(1.5)",
        WebkitBackdropFilter: "blur(40px) saturate(1.5)",
      }}
      role="banner"
    >
      {/* Left: Hamburger */}
      <div className="flex items-center shrink-0">
        <button onClick={toggleSidebar} className="header-icon-btn" aria-label="Toggle sidebar" title="Cmd+B">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Center: Chat | Editor pill group */}
      <nav
        className="flex items-center"
        role="tablist"
        aria-label="Primary views"
        style={{
          marginLeft: 8,
          padding: "1px",
          borderRadius: "var(--radius-xs)",
          background: "var(--bg-surface)",
          border: "1px solid rgba(255,255,255,0.015)",
        }}
      >
        {VIEW_PILLS.map((pill) => {
          const isActive = currentView === pill.id;
          return (
            <button
              key={pill.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(pill.id)}
              className="btn-press"
              style={{
                padding: "3px 10px",
                borderRadius: "var(--radius-xs)",
                fontSize: "var(--font-size-xs)",
                fontWeight: isActive ? 500 : 400,
                cursor: "pointer",
                border: "none",
                transition: "all 80ms ease",
                background: isActive ? "var(--accent-muted)" : "transparent",
                color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
                letterSpacing: "-0.01em",
              }}
            >
              {pill.label}
            </button>
          );
        })}
      </nav>

      {/* Spacer — drag region for window */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Right: Panel toggles + controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Terminal toggle — icon highlights when active */}
        <button
          onClick={toggleTerminalPanel}
          className="header-icon-btn"
          aria-label={terminalPanelOpen ? "Hide terminal" : "Show terminal"}
          title="Cmd+J"
          style={{ color: terminalPanelOpen ? "var(--accent)" : undefined }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4 7l3 2-3 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 11h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        {/* Diff/Changes toggle — icon highlights when active */}
        <button
          onClick={toggleDiffPanel}
          className="header-icon-btn"
          aria-label={diffPanelOpen ? "Hide changes" : "Show changes"}
          title="Cmd+Shift+D"
          style={{ color: diffPanelOpen ? "var(--accent)" : undefined }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 2v12" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 7l-1.5 1.5L5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11 7l1.5 1.5L11 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span style={{ width: 1, height: 16, background: "var(--border-subtle)", margin: "0 4px" }} aria-hidden="true" />

        {/* Model picker */}
        <div className="relative">
          <ModelPicker />
        </div>

        {/* Context panel toggle */}
        <button
          onClick={toggleContextPanel}
          className="header-icon-btn"
          aria-label={contextPanelOpen ? "Hide context panel" : "Show context panel"}
          title="Cmd+."
          style={{ color: contextPanelOpen ? "var(--accent)" : undefined }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 2v12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        {/* Notifications */}
        <div className="relative">
          <button onClick={() => setNotifOpen(!notifOpen)} className="header-icon-btn relative" aria-label="Notifications">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1.5a4 4 0 014 4v2.5l1.5 2H2.5L4 8V5.5a4 4 0 014-4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 12a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-white text-[8px] flex items-center justify-center font-bold"
                style={{ background: "var(--gradient-accent)" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <NotificationCenter isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>

        {/* Settings gear */}
        <button
          onClick={() => setView("settings")}
          className="header-icon-btn"
          aria-label="Settings"
          title="Cmd+,"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Command palette */}
        <button
          onClick={toggleCommandPalette}
          className="header-kbd-btn shrink-0"
          style={{
            background: "var(--surface-1)",
            boxShadow: "var(--shadow-ring)",
            whiteSpace: "nowrap",
          }}
          aria-label="Command palette (Cmd+K)"
        >
          <kbd style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>Cmd+K</kbd>
        </button>
      </div>
    </header>
  );
}
