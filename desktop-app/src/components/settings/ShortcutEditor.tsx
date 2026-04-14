/**
 * Keyboard Shortcut Editor — view and customize keyboard shortcuts.
 */

import { useState, useEffect, useCallback } from "react";

interface ShortcutEntry {
  readonly id: string;
  readonly keys: string;
  readonly action: string;
  readonly scope: "global" | "app" | "editor";
}

const DEFAULT_SHORTCUTS: readonly ShortcutEntry[] = [
  { id: "s1", keys: "⌘K", action: "Open command palette", scope: "app" },
  { id: "s2", keys: "⌘B", action: "Toggle sidebar", scope: "app" },
  { id: "s3", keys: "⌘.", action: "Toggle context panel", scope: "app" },
  { id: "s4", keys: "⌘,", action: "Open settings", scope: "app" },
  { id: "s5", keys: "⌘⇧N", action: "Toggle WOTANN window", scope: "global" },
  { id: "s6", keys: "⌘⇧Space", action: "Quick prompt", scope: "global" },
  { id: "s7", keys: "⌘⇧V", action: "Push-to-talk voice", scope: "global" },
  { id: "s8", keys: "⌘Enter", action: "Send message", scope: "app" },
  { id: "s9", keys: "⌘S", action: "Save file", scope: "editor" },
  { id: "s10", keys: "⌘P", action: "Quick file open", scope: "editor" },
  { id: "s11", keys: "⌘⇧F", action: "Search in files", scope: "editor" },
  { id: "s12", keys: "⌘/", action: "Toggle comment", scope: "editor" },
];

const SCOPE_LABELS: Record<string, string> = {
  global: "System-wide",
  app: "Application",
  editor: "Code Editor",
};

/**
 * Converts a KeyboardEvent into a human-readable key combo string
 * using macOS-style symbols.
 */
function formatKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("\u2318");
  if (e.shiftKey) parts.push("\u21E7");
  if (e.altKey) parts.push("\u2325");

  // Map special keys to display names
  const keyMap: Record<string, string> = {
    Enter: "Enter",
    Backspace: "Backspace",
    Tab: "Tab",
    " ": "Space",
    ArrowUp: "\u2191",
    ArrowDown: "\u2193",
    ArrowLeft: "\u2190",
    ArrowRight: "\u2192",
    Escape: "Esc",
  };

  // Skip if only modifier keys are pressed (no primary key yet)
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return "";

  const displayKey = keyMap[e.key] ?? e.key.toUpperCase();
  parts.push(displayKey);
  return parts.join("");
}

export function ShortcutEditor() {
  const [shortcuts, setShortcuts] = useState<readonly ShortcutEntry[]>(DEFAULT_SHORTCUTS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "global" | "app" | "editor">("all");

  // Keydown listener for capturing new key bindings
  const handleCapture = useCallback(
    (e: KeyboardEvent) => {
      if (!editingId) return;

      e.preventDefault();
      e.stopPropagation();

      // Escape cancels editing without changing the binding
      if (e.key === "Escape") {
        setEditingId(null);
        return;
      }

      const combo = formatKeyCombo(e);
      // Ignore bare modifier presses (combo is empty when only modifiers held)
      if (!combo) return;

      // Update the shortcut with the new key combo (immutable)
      setShortcuts((prev) =>
        prev.map((s) => (s.id === editingId ? { ...s, keys: combo } : s)),
      );
      setEditingId(null);
    },
    [editingId],
  );

  useEffect(() => {
    if (!editingId) return;
    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [editingId, handleCapture]);

  const filtered = filter === "all" ? shortcuts : shortcuts.filter((s) => s.scope === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>Keyboard Shortcuts</h3>
        <div className="flex gap-1">
          {(["all", "global", "app", "editor"] as const).map((scope) => (
            <button
              key={scope}
              onClick={() => setFilter(scope)}
              className="px-2 py-0.5 text-[10px] rounded-full transition-colors"
              style={filter === scope
                ? { background: "var(--color-primary)", color: "white" }
                : { background: "var(--surface-3)", color: "var(--color-text-muted)" }
              }
            >
              {scope === "all" ? "All" : SCOPE_LABELS[scope]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {filtered.map((shortcut) => (
          <div
            key={shortcut.id}
            className="flex items-center justify-between px-3 py-2 rounded-lg transition-colors group shortcut-row-hover"
          >
            <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{shortcut.action}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>{SCOPE_LABELS[shortcut.scope]}</span>
              {editingId === shortcut.id ? (
                <div className="px-2 py-0.5 rounded text-xs animate-pulse" style={{ background: "var(--accent-glow)", borderColor: "var(--border-focus)", border: "1px solid var(--border-focus)", color: "var(--color-primary)" }}>
                  Press keys...
                </div>
              ) : (
                <button
                  onClick={() => setEditingId(shortcut.id)}
                  className="px-2 py-0.5 rounded text-xs font-mono shortcut-key-btn"
                  style={{ color: "var(--color-text-dim)" }}
                >
                  {shortcut.keys}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] mt-2" style={{ color: "var(--color-text-dim)" }}>
        Click a shortcut to rebind it. Press Escape to cancel.
      </p>
    </div>
  );
}
