/**
 * Keyboard Shortcuts — global and local shortcut management for the desktop app.
 *
 * Supports three scopes:
 * - global: system-wide (via Tauri global shortcut API)
 * - app: active when the app window is focused
 * - editor: active when the prompt editor is focused
 *
 * Shortcut format: "Cmd+K", "Cmd+Shift+E", "Ctrl+Enter", etc.
 * Modifiers: Cmd, Ctrl, Shift, Alt, Option (alias for Alt on macOS)
 */

// ── Types ──────────────────────────────────────────────

export type ShortcutScope = "global" | "app" | "editor";

export interface KeyboardShortcut {
  readonly id: string;
  readonly keys: string;
  readonly label: string;
  readonly action: string;
  readonly scope: ShortcutScope;
}

export interface ShortcutConflict {
  readonly keys: string;
  readonly existing: KeyboardShortcut;
  readonly incoming: KeyboardShortcut;
}

// ── Default Shortcuts ──────────────────────────────────

export const DEFAULT_SHORTCUTS: readonly KeyboardShortcut[] = [
  { id: "command-palette", keys: "Cmd+K", label: "Command Palette", action: "toggleCommandPalette", scope: "app" },
  { id: "new-conversation", keys: "Cmd+N", label: "New Conversation", action: "createConversation", scope: "app" },
  { id: "enhance-prompt", keys: "Cmd+E", label: "Enhance Prompt", action: "enhancePrompt", scope: "editor" },
  { id: "send-message", keys: "Cmd+Enter", label: "Send Message", action: "sendMessage", scope: "editor" },
  { id: "voice-input", keys: "Cmd+Shift+V", label: "Voice Input", action: "toggleVoice", scope: "app" },
  { id: "focus-prompt", keys: "Cmd+/", label: "Focus Prompt", action: "focusPrompt", scope: "app" },
  { id: "prev-conversation", keys: "Cmd+[", label: "Previous Conversation", action: "prevConversation", scope: "app" },
  { id: "next-conversation", keys: "Cmd+]", label: "Next Conversation", action: "nextConversation", scope: "app" },
  { id: "autonomous-mode", keys: "Cmd+Shift+A", label: "Autonomous Mode", action: "startAutonomous", scope: "app" },
  { id: "context-panel", keys: "Cmd+Shift+C", label: "Toggle Context Panel", action: "toggleContextPanel", scope: "app" },
  { id: "settings", keys: "Cmd+,", label: "Settings", action: "openSettings", scope: "app" },
  { id: "close-overlay", keys: "Escape", label: "Close Overlay", action: "closeOverlay", scope: "app" },
  { id: "toggle-sidebar", keys: "Cmd+B", label: "Toggle Sidebar", action: "toggleSidebar", scope: "app" },
  { id: "diff-viewer", keys: "Cmd+D", label: "Toggle Diff Viewer", action: "toggleDiffViewer", scope: "app" },
  { id: "search", keys: "Cmd+F", label: "Search Conversations", action: "searchConversations", scope: "app" },
];

// ── Shortcut Normalization ─────────────────────────────

/**
 * Normalize a shortcut string for consistent comparison.
 * Orders modifiers: Cmd > Ctrl > Shift > Alt > key
 */
export function normalizeShortcut(keys: string): string {
  const parts = keys.split("+").map((p) => p.trim());
  const modifiers: string[] = [];
  let mainKey = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "cmd" || lower === "meta" || lower === "command") {
      if (!modifiers.includes("Cmd")) modifiers.push("Cmd");
    } else if (lower === "ctrl" || lower === "control") {
      if (!modifiers.includes("Ctrl")) modifiers.push("Ctrl");
    } else if (lower === "shift") {
      if (!modifiers.includes("Shift")) modifiers.push("Shift");
    } else if (lower === "alt" || lower === "option") {
      if (!modifiers.includes("Alt")) modifiers.push("Alt");
    } else {
      mainKey = part;
    }
  }

  const order = ["Cmd", "Ctrl", "Shift", "Alt"];
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return [...modifiers, mainKey].join("+");
}

// ── Shortcut Registry ──────────────────────────────────

export class ShortcutRegistry {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private readonly keyIndex: Map<string, string> = new Map(); // normalized keys -> id

  constructor(initial?: readonly KeyboardShortcut[]) {
    const shortcuts = initial ?? DEFAULT_SHORTCUTS;
    for (const shortcut of shortcuts) {
      this.register(shortcut);
    }
  }

  /**
   * Register a new shortcut. Returns a conflict if the keys are already bound.
   */
  register(shortcut: KeyboardShortcut): ShortcutConflict | null {
    const normalized = normalizeShortcut(shortcut.keys);
    const scopedKey = `${shortcut.scope}:${normalized}`;
    const existingId = this.keyIndex.get(scopedKey);

    if (existingId !== undefined && existingId !== shortcut.id) {
      const existing = this.shortcuts.get(existingId);
      if (existing !== undefined) {
        return { keys: shortcut.keys, existing, incoming: shortcut };
      }
    }

    // Remove old key binding if the shortcut was re-registered with different keys
    const oldShortcut = this.shortcuts.get(shortcut.id);
    if (oldShortcut !== undefined) {
      const oldNormalized = normalizeShortcut(oldShortcut.keys);
      this.keyIndex.delete(`${oldShortcut.scope}:${oldNormalized}`);
    }

    this.shortcuts.set(shortcut.id, shortcut);
    this.keyIndex.set(scopedKey, shortcut.id);
    return null;
  }

  /**
   * Unregister a shortcut by ID.
   */
  unregister(id: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (shortcut === undefined) return false;

    const normalized = normalizeShortcut(shortcut.keys);
    this.keyIndex.delete(`${shortcut.scope}:${normalized}`);
    this.shortcuts.delete(id);
    return true;
  }

  /**
   * Find the action for a given key combination and scope.
   */
  resolve(keys: string, scope: ShortcutScope): string | null {
    const normalized = normalizeShortcut(keys);
    const id = this.keyIndex.get(`${scope}:${normalized}`);
    if (id === undefined) return null;
    return this.shortcuts.get(id)?.action ?? null;
  }

  /**
   * Get all shortcuts, optionally filtered by scope.
   */
  getAll(scope?: ShortcutScope): readonly KeyboardShortcut[] {
    const all = Array.from(this.shortcuts.values());
    if (scope === undefined) return all;
    return all.filter((s) => s.scope === scope);
  }

  /**
   * Get a shortcut by ID.
   */
  getById(id: string): KeyboardShortcut | undefined {
    return this.shortcuts.get(id);
  }

  /**
   * Rebind a shortcut to new keys. Returns a conflict if the new keys collide.
   */
  rebind(id: string, newKeys: string): ShortcutConflict | null {
    const existing = this.shortcuts.get(id);
    if (existing === undefined) return null;

    const updated: KeyboardShortcut = { ...existing, keys: newKeys };
    return this.register(updated);
  }

  /**
   * Total number of registered shortcuts.
   */
  get size(): number {
    return this.shortcuts.size;
  }
}
