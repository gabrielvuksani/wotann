/**
 * Keyboard Shortcuts Overlay — triggered with `?` from anywhere.
 *
 * UX gap (SESSION_8 audit): the desktop app has 15+ registered shortcuts in
 * `useShortcuts.ts` but no cheatsheet surface — users discover them only by
 * reading source or the command palette. This overlay renders a grouped
 * table in a modal dialog, dismissible with Esc or click-outside.
 *
 * Shortcut discovery is the single cheapest differentiator for a keyboard-
 * centric product. Cursor and Claude Code both ship something similar;
 * WOTANN now matches.
 */

import { useEffect, useState, useCallback, type JSX } from "react";
import { color } from "../../design/tokens.generated";

interface ShortcutEntry {
  readonly shortcut: string;
  readonly description: string;
}

interface ShortcutGroup {
  readonly title: string;
  readonly entries: readonly ShortcutEntry[];
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Navigation",
    entries: [
      { shortcut: "⌘K", description: "Open command palette" },
      { shortcut: "⌘,", description: "Open settings" },
      { shortcut: "⌘1", description: "Switch to Chat view" },
      { shortcut: "⌘2", description: "Switch to Editor view" },
      { shortcut: "⌘B", description: "Toggle sidebar" },
      { shortcut: "⌘.", description: "Toggle context panel" },
      { shortcut: "⌘J / ⌘`", description: "Toggle terminal" },
    ],
  },
  {
    title: "Actions",
    entries: [
      { shortcut: "⌘N", description: "Start a new conversation" },
      { shortcut: "⌘P", description: "Quick file search" },
      { shortcut: "⌘M", description: "Open model picker overlay" },
      { shortcut: "⌘⇧A", description: "Open quick-actions overlay" },
      { shortcut: "⌘⇧D", description: "Toggle diff panel" },
      { shortcut: "⌘⇧F", description: "Project-wide search" },
    ],
  },
  {
    title: "Power user",
    entries: [
      { shortcut: "⌘⇧E", description: "Enter Code Mode (multi-tool-call per turn)" },
      { shortcut: "⌘⇧M", description: "Toggle Meet Mode" },
      { shortcut: "⌘⇧C", description: "Summon Council (multi-model consensus)" },
      { shortcut: "⌘⇧B", description: "Open Braids view (parallel threads)" },
      { shortcut: "⌘⇧T", description: "Toggle shadow-git timeline scrubber" },
      { shortcut: "⇧⇥", description: "Cycle agent profile (Write / Ask / Minimal)" },
    ],
  },
  {
    title: "Safety",
    entries: [
      { shortcut: "⌘⇧⎋", description: "Emergency stop — kills all running tools" },
      { shortcut: "⎋", description: "Dismiss overlay / cancel action" },
      { shortcut: "?", description: "Show this cheatsheet" },
    ],
  },
];

export function KeyboardShortcutsOverlay(): JSX.Element | null {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Ignore when user is typing in an input / textarea / contenteditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      // `?` with no modifiers opens / toggles the overlay
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setOpen((prev) => !prev);
        e.preventDefault();
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: 24,
        animation: "wotann-ksf-fade 160ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "80vh",
          overflowY: "auto",
          background: color("background"),
          border: "1px solid var(--border-subtle, rgba(138,176,224,0.08))",
          borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,168,67,0.06)",
          padding: 24,
          fontFamily: "var(--wotann-font-sans, 'Inter Variable', system-ui)",
          color: color("text"),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close shortcuts overlay"
            style={{
              background: "transparent",
              border: "1px solid var(--border-subtle, rgba(138,176,224,0.12))",
              color: color("muted"),
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Esc
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: color("muted"),
                  marginBottom: 8,
                }}
              >
                {group.title}
              </h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {group.entries.map((e) => (
                  <li
                    key={e.shortcut}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid rgba(138,176,224,0.04)",
                      fontSize: 13,
                      gap: 12,
                    }}
                  >
                    <span style={{ color: color("muted") }}>{e.description}</span>
                    <kbd
                      style={{
                        fontFamily: "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)",
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "rgba(138,176,224,0.06)",
                        border: "1px solid rgba(138,176,224,0.15)",
                        color: color("text"),
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.shortcut}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p
          style={{
            marginTop: 18,
            fontSize: 11,
            color: color("muted"),
            textAlign: "center",
            letterSpacing: "0.02em",
          }}
        >
          Press <kbd style={{ fontFamily: "var(--wotann-font-mono, ui-monospace)" }}>?</kbd> again to toggle.
        </p>
      </div>
      <style>{`
        @keyframes wotann-ksf-fade {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
