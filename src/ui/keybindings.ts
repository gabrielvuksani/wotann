/**
 * Keybinding system: configurable shortcuts for TUI navigation.
 * Ctrl+M model switch, Ctrl+T thinking depth, Ctrl+/ search, Tab panels.
 */

export interface Keybinding {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly action: string;
  readonly description: string;
}

const DEFAULT_KEYBINDINGS: readonly Keybinding[] = [
  { key: "return", action: "send", description: "Send prompt" },
  { key: "r", ctrl: true, action: "history-search", description: "Search prompt history" },
  { key: "m", ctrl: true, action: "model-switch", description: "Switch model/provider" },
  { key: "t", ctrl: true, action: "thinking-depth", description: "Cycle thinking depth" },
  { key: "v", ctrl: true, action: "voice-capture", description: "Capture voice prompt" },
  { key: "/", ctrl: true, action: "global-search", description: "Global search" },
  { key: "i", ctrl: true, action: "context-inspect", description: "Context source inspector" },
  { key: "b", ctrl: true, action: "terminal-blocks", description: "Toggle terminal blocks view" },
  // Wave 3G additions — command palette, clear convo, last response.
  { key: "p", ctrl: true, action: "command-palette", description: "Open command palette" },
  { key: "k", ctrl: true, action: "clear-conversation", description: "Clear conversation" },
  { key: "l", ctrl: true, action: "last-response", description: "Copy last assistant response" },
  { key: "y", ctrl: true, action: "theme-cycle", description: "Cycle Norse themes" },
  { key: "c", ctrl: true, action: "cancel", description: "Cancel / Exit" },
  { key: "d", ctrl: true, action: "exit", description: "Exit" },
  { key: "tab", action: "cycle-panel", description: "Cycle panel focus" },
  { key: "escape", action: "close-overlay", description: "Close overlay" },
  { key: "up", action: "history-prev", description: "Previous history" },
  { key: "down", action: "history-next", description: "Next history" },
];

export class KeybindingManager {
  private readonly bindings: Map<string, Keybinding> = new Map();

  constructor(customBindings?: readonly Keybinding[]) {
    const bindings = customBindings ?? DEFAULT_KEYBINDINGS;
    for (const b of bindings) {
      this.bindings.set(this.keySignature(b), b);
    }
  }

  private keySignature(b: Pick<Keybinding, "key" | "ctrl" | "meta" | "shift">): string {
    const parts: string[] = [];
    if (b.ctrl) parts.push("ctrl");
    if (b.meta) parts.push("meta");
    if (b.shift) parts.push("shift");
    parts.push(b.key);
    return parts.join("+");
  }

  matchKey(input: string, key: { ctrl?: boolean; meta?: boolean; shift?: boolean }): string | null {
    const sig = this.keySignature({ key: input, ...key });
    const binding = this.bindings.get(sig);
    return binding?.action ?? null;
  }

  getBindings(): readonly Keybinding[] {
    return [...this.bindings.values()];
  }

  getBindingForAction(action: string): Keybinding | undefined {
    return [...this.bindings.values()].find((b) => b.action === action);
  }

  rebind(action: string, newKey: Omit<Keybinding, "action" | "description">): boolean {
    const existing = [...this.bindings.entries()].find(([_, b]) => b.action === action);
    if (!existing) return false;

    const [oldSig, oldBinding] = existing;
    this.bindings.delete(oldSig);

    const newBinding: Keybinding = {
      ...newKey,
      action: oldBinding.action,
      description: oldBinding.description,
    };
    this.bindings.set(this.keySignature(newBinding), newBinding);
    return true;
  }
}
