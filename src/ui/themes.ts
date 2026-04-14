/**
 * Theme system: 65+ themes with dark/light auto-switch.
 * Each theme defines colors for all UI elements.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Theme {
  readonly name: string;
  readonly variant: "dark" | "light";
  readonly colors: ThemeColors;
}

export interface ThemeColors {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
  readonly text: string;
  readonly textDim: string;
  readonly border: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;

  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly systemMessage: string;
  readonly toolMessage: string;

  readonly statusBar: string;
  readonly hudGreen: string;
  readonly hudYellow: string;
  readonly hudRed: string;
}

export interface PersistedUIState {
  readonly theme?: string;
  readonly panel?: string;
}

const DARK_BASE: ThemeColors = {
  primary: "#6366f1",
  secondary: "#8b5cf6",
  accent: "#a855f7",
  background: "#1e1e2e",
  text: "#cdd6f4",
  textDim: "#6c7086",
  border: "#45475a",
  success: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  info: "#89b4fa",
  userMessage: "#89b4fa",
  assistantMessage: "#a6e3a1",
  systemMessage: "#f9e2af",
  toolMessage: "#cba6f7",
  statusBar: "#313244",
  hudGreen: "#a6e3a1",
  hudYellow: "#f9e2af",
  hudRed: "#f38ba8",
};

const LIGHT_BASE: ThemeColors = {
  primary: "#4f46e5",
  secondary: "#7c3aed",
  accent: "#9333ea",
  background: "#eff1f5",
  text: "#4c4f69",
  textDim: "#9ca0b0",
  border: "#ccd0da",
  success: "#40a02b",
  warning: "#df8e1d",
  error: "#d20f39",
  info: "#1e66f5",
  userMessage: "#1e66f5",
  assistantMessage: "#40a02b",
  systemMessage: "#df8e1d",
  toolMessage: "#8839ef",
  statusBar: "#dce0e8",
  hudGreen: "#40a02b",
  hudYellow: "#df8e1d",
  hudRed: "#d20f39",
};

// ── Built-in Themes ─────────────────────────────────────────

const THEMES: readonly Theme[] = [
  { name: "default", variant: "dark", colors: DARK_BASE },
  { name: "default-light", variant: "light", colors: LIGHT_BASE },
  { name: "catppuccin-mocha", variant: "dark", colors: DARK_BASE },
  { name: "catppuccin-latte", variant: "light", colors: LIGHT_BASE },
  { name: "dracula", variant: "dark", colors: { ...DARK_BASE, primary: "#bd93f9", accent: "#ff79c6", success: "#50fa7b", error: "#ff5555" } },
  { name: "nord", variant: "dark", colors: { ...DARK_BASE, primary: "#88c0d0", secondary: "#81a1c1", accent: "#5e81ac", background: "#2e3440" } },
  { name: "gruvbox-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#fe8019", accent: "#fabd2f", success: "#b8bb26", error: "#fb4934" } },
  { name: "gruvbox-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#d65d0e", accent: "#d79921", success: "#79740e", error: "#cc241d" } },
  { name: "solarized-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#268bd2", background: "#002b36", text: "#839496" } },
  { name: "solarized-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#268bd2", background: "#fdf6e3", text: "#657b83" } },
  { name: "tokyo-night", variant: "dark", colors: { ...DARK_BASE, primary: "#7aa2f7", accent: "#bb9af7", background: "#1a1b26" } },
  { name: "one-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#61afef", accent: "#c678dd", success: "#98c379" } },
  { name: "monokai", variant: "dark", colors: { ...DARK_BASE, primary: "#66d9ef", accent: "#f92672", success: "#a6e22e", warning: "#fd971f" } },
  { name: "github-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#58a6ff", background: "#0d1117", border: "#30363d" } },
  { name: "github-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#0969da", background: "#ffffff" } },
  { name: "material", variant: "dark", colors: { ...DARK_BASE, primary: "#82aaff", accent: "#c792ea", background: "#263238" } },
  { name: "ayu-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#ffb454", accent: "#ff8f40", background: "#0a0e14" } },
  { name: "ayu-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#ff8f40", background: "#fafafa" } },
  { name: "everforest-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#a7c080", accent: "#d699b6", background: "#2d353b" } },
  { name: "rose-pine", variant: "dark", colors: { ...DARK_BASE, primary: "#c4a7e7", accent: "#eb6f92", background: "#191724" } },
  { name: "rose-pine-moon", variant: "dark", colors: { ...DARK_BASE, primary: "#c4a7e7", accent: "#ea9a97", background: "#232136" } },
  { name: "rose-pine-dawn", variant: "light", colors: { ...LIGHT_BASE, primary: "#907aa9", accent: "#b4637a", background: "#faf4ed" } },
  { name: "vesper", variant: "dark", colors: { ...DARK_BASE, primary: "#ffc799", accent: "#ff8080", background: "#101010" } },
  { name: "kanagawa", variant: "dark", colors: { ...DARK_BASE, primary: "#7e9cd8", accent: "#957fb8", background: "#1f1f28" } },
  { name: "nightfox", variant: "dark", colors: { ...DARK_BASE, primary: "#719cd6", accent: "#9d79d6", background: "#192330" } },
  { name: "dayfox", variant: "light", colors: { ...LIGHT_BASE, primary: "#4d688e", accent: "#955f82", background: "#f6f2ee" } },
  { name: "oxocarbon", variant: "dark", colors: { ...DARK_BASE, primary: "#78a9ff", accent: "#be95ff", background: "#161616" } },
  { name: "synthwave", variant: "dark", colors: { ...DARK_BASE, primary: "#36f9f6", accent: "#ff7edb", background: "#2b213a" } },
  { name: "cyberpunk", variant: "dark", colors: { ...DARK_BASE, primary: "#00ff9f", accent: "#ff003c", background: "#0d0221" } },
  { name: "midnight", variant: "dark", colors: { ...DARK_BASE, primary: "#569cd6", background: "#1e1e1e", text: "#d4d4d4" } },
  { name: "horizon", variant: "dark", colors: { ...DARK_BASE, primary: "#e95678", accent: "#fab795", background: "#1c1e26" } },
  { name: "palenight", variant: "dark", colors: { ...DARK_BASE, primary: "#82aaff", accent: "#c792ea", background: "#292d3e" } },
  { name: "panda", variant: "dark", colors: { ...DARK_BASE, primary: "#19f9d8", accent: "#ff75b5", background: "#292a2b" } },
  { name: "shades-of-purple", variant: "dark", colors: { ...DARK_BASE, primary: "#fad000", accent: "#ff628c", background: "#1e1e3f" } },
  { name: "winter-is-coming", variant: "dark", colors: { ...DARK_BASE, primary: "#89ddff", background: "#011627" } },
  { name: "cobalt2", variant: "dark", colors: { ...DARK_BASE, primary: "#ffc600", accent: "#f2777a", background: "#193549" } },
  { name: "night-owl", variant: "dark", colors: { ...DARK_BASE, primary: "#82aaff", accent: "#c792ea", background: "#011627" } },
  { name: "night-owl-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#4876d6", background: "#fbfbfb" } },
  { name: "atom-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#61afef", background: "#282c34" } },
  { name: "atom-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#4078f2", background: "#fafafa" } },
  { name: "vim-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#b8bb26", accent: "#fe8019", background: "#282828" } },
  { name: "helix", variant: "dark", colors: { ...DARK_BASE, primary: "#a6da95", accent: "#f5a97f", background: "#24273a" } },
  { name: "zed-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#3B9FFF", accent: "#c678dd", background: "#1e2025" } },
  { name: "zed-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#0366D6", background: "#ffffff" } },
  { name: "fleet-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#87C3FF", accent: "#AF9CFF", background: "#181818" } },
  { name: "jetbrains-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#6897BB", background: "#2B2B2B" } },
  { name: "jetbrains-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#0000FF", background: "#FFFFFF" } },
  { name: "vscode-dark", variant: "dark", colors: { ...DARK_BASE, primary: "#569cd6", background: "#1e1e1e" } },
  { name: "vscode-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#0000FF", background: "#FFFFFF" } },
  { name: "sublime", variant: "dark", colors: { ...DARK_BASE, primary: "#66d9ef", accent: "#f92672", background: "#272822" } },
  { name: "oceanic", variant: "dark", colors: { ...DARK_BASE, primary: "#6699cc", accent: "#99c794", background: "#1b2b34" } },
  { name: "aurora", variant: "dark", colors: { ...DARK_BASE, primary: "#88c0d0", accent: "#b48ead", background: "#2e3440" } },
  { name: "arctic", variant: "light", colors: { ...LIGHT_BASE, primary: "#5e81ac", background: "#eceff4" } },
  { name: "aura", variant: "dark", colors: { ...DARK_BASE, primary: "#a277ff", accent: "#61ffca", background: "#15141b" } },
  { name: "moonlight", variant: "dark", colors: { ...DARK_BASE, primary: "#82aaff", background: "#222436" } },
  { name: "blueberry", variant: "dark", colors: { ...DARK_BASE, primary: "#7aa2f7", background: "#17171f" } },
  { name: "ember", variant: "dark", colors: { ...DARK_BASE, primary: "#ff6c6b", accent: "#da8548", background: "#21242b" } },
  { name: "forest", variant: "dark", colors: { ...DARK_BASE, primary: "#98c379", accent: "#56b6c2", background: "#1e2127" } },
  { name: "lavender", variant: "dark", colors: { ...DARK_BASE, primary: "#c4a7e7", accent: "#ebbcba", background: "#232136" } },
  { name: "slate", variant: "dark", colors: { ...DARK_BASE, primary: "#94a3b8", background: "#0f172a" } },
  { name: "monochrome", variant: "dark", colors: { ...DARK_BASE, primary: "#ffffff", secondary: "#cccccc", accent: "#ffffff", background: "#000000" } },
  { name: "monochrome-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#000000", secondary: "#333333", accent: "#000000", background: "#ffffff" } },
  { name: "high-contrast", variant: "dark", colors: { ...DARK_BASE, primary: "#00ff00", accent: "#ffff00", background: "#000000", text: "#ffffff" } },
  { name: "high-contrast-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#0000ff", accent: "#ff0000", background: "#ffffff", text: "#000000" } },
  { name: "wotann", variant: "dark", colors: { ...DARK_BASE, primary: "#8b5cf6", accent: "#06b6d4", background: "#08080c" } },
  { name: "wotann-light", variant: "light", colors: { ...LIGHT_BASE, primary: "#8b5cf6", accent: "#06b6d4", background: "#fafafa" } },
];

export class ThemeManager {
  private currentTheme: Theme;
  private readonly themes: Map<string, Theme>;
  private readonly storagePath?: string;

  constructor(initialTheme: string = "default", storagePath?: string) {
    this.themes = new Map(THEMES.map((t) => [t.name, t]));
    this.storagePath = storagePath;
    const persisted = storagePath ? readPersistedUIState(storagePath) : {};
    const resolvedTheme = persisted.theme ?? initialTheme;
    this.currentTheme = this.themes.get(resolvedTheme) ?? THEMES[0]!;
  }

  getCurrent(): Theme {
    return this.currentTheme;
  }

  setTheme(name: string): boolean {
    const theme = this.themes.get(name);
    if (!theme) return false;
    this.currentTheme = theme;
    this.persist({ theme: theme.name });
    return true;
  }

  getThemeNames(): readonly string[] {
    return [...this.themes.keys()];
  }

  getThemeCount(): number {
    return this.themes.size;
  }

  addCustomTheme(theme: Theme): void {
    this.themes.set(theme.name, theme);
  }

  getByVariant(variant: "dark" | "light"): readonly Theme[] {
    return [...this.themes.values()].filter((t) => t.variant === variant);
  }

  autoDetectVariant(): "dark" | "light" {
    const colorScheme = process.env["COLORFGBG"];
    if (colorScheme) {
      const parts = colorScheme.split(";");
      const bg = parseInt(parts[parts.length - 1] ?? "0", 10);
      return bg > 8 ? "light" : "dark";
    }
    return "dark";
  }

  readPersistedState(): PersistedUIState {
    return this.storagePath ? readPersistedUIState(this.storagePath) : {};
  }

  persist(next: PersistedUIState): void {
    if (!this.storagePath) return;

    const current = readPersistedUIState(this.storagePath);
    const merged = { ...current, ...next };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, JSON.stringify(merged, null, 2));
  }
}

function readPersistedUIState(storagePath: string): PersistedUIState {
  if (!existsSync(storagePath)) return {};

  try {
    const raw = readFileSync(storagePath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedUIState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
