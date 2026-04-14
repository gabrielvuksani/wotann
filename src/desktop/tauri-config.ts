/**
 * Tauri v2 Desktop App Configuration
 *
 * This module defines the configuration for the WOTANN macOS desktop app.
 * The actual Tauri project lives in desktop-app/ (separate from the harness).
 * This file provides the TypeScript-side configuration that Tauri commands use.
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────┐
 * │ Tauri v2 Shell (Rust)                           │
 * │ - System tray with quick actions                │
 * │ - Global hotkey (Cmd+Shift+N)                   │
 * │ - Native notifications                          │
 * │ - File system access                            │
 * │ - Window management                             │
 * ├─────────────────────────────────────────────────┤
 * │ React WebView (TypeScript)                      │
 * │ - Conversation UI with streaming                │
 * │ - Sidebar: conversations, projects, skills      │
 * │ - Command palette (Cmd+K)                       │
 * │ - Artifact viewer with syntax highlighting      │
 * │ - Context inspector panel                       │
 * │ - Diff viewer with accept/reject                │
 * │ - Arena/Council side-by-side view               │
 * │ - Settings with theme picker                    │
 * ├─────────────────────────────────────────────────┤
 * │ WotannRuntime (TypeScript)                       │
 * │ - Same runtime as CLI — direct import           │
 * │ - All 79 subsystems available                   │
 * │ - Provider routing, memory, channels, etc.      │
 * └─────────────────────────────────────────────────┘
 *
 * WHY TAURI v2:
 * - Native performance (Rust backend, ~3MB binary vs ~150MB Electron)
 * - macOS native APIs (system tray, notifications, file dialogs)
 * - Security: sandboxed WebView, no Node.js in renderer
 * - Multi-window support (main, settings, companion pairing)
 * - Auto-updater built in
 * - Future iOS/Android support via Tauri Mobile
 */

// ── Tauri Window Configuration ──────────────────────────

export interface TauriWindowConfig {
  readonly label: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly resizable: boolean;
  readonly transparent: boolean;
  readonly decorations: boolean;
  readonly alwaysOnTop: boolean;
  readonly center: boolean;
  readonly url: string;
}

export const MAIN_WINDOW: TauriWindowConfig = {
  label: "main",
  title: "WOTANN",
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  resizable: true,
  transparent: false,
  decorations: true,
  alwaysOnTop: false,
  center: true,
  url: "/",
};

export const SETTINGS_WINDOW: TauriWindowConfig = {
  label: "settings",
  title: "WOTANN Settings",
  width: 600,
  height: 500,
  minWidth: 400,
  minHeight: 400,
  resizable: true,
  transparent: false,
  decorations: true,
  alwaysOnTop: false,
  center: true,
  url: "/settings",
};

export const COMPANION_WINDOW: TauriWindowConfig = {
  label: "companion",
  title: "Pair iOS Device",
  width: 400,
  height: 500,
  minWidth: 350,
  minHeight: 450,
  resizable: false,
  transparent: false,
  decorations: true,
  alwaysOnTop: true,
  center: true,
  url: "/companion",
};

// ── System Tray Configuration ───────────────────────────

export interface TrayMenuItem {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly separator?: boolean;
  readonly disabled?: boolean;
}

export const TRAY_MENU: readonly TrayMenuItem[] = [
  { id: "new-chat", label: "New Chat", shortcut: "Cmd+N" },
  { id: "enhance", label: "Enhance Prompt", shortcut: "Cmd+E" },
  { id: "voice", label: "Voice Input", shortcut: "Cmd+Shift+V" },
  { id: "separator-1", label: "", separator: true },
  { id: "autonomous", label: "Start Autonomous Task..." },
  { id: "arena", label: "Run Arena..." },
  { id: "council", label: "Run Council..." },
  { id: "separator-2", label: "", separator: true },
  { id: "cost", label: "Cost: $0.00" },
  { id: "context", label: "Context: 0%" },
  { id: "separator-3", label: "", separator: true },
  { id: "pair-device", label: "Pair iOS Device..." },
  { id: "channels", label: "Channel Status" },
  { id: "separator-4", label: "", separator: true },
  { id: "settings", label: "Settings...", shortcut: "Cmd+," },
  { id: "quit", label: "Quit WOTANN", shortcut: "Cmd+Q" },
];

// ── Global Hotkey Configuration ─────────────────────────

export interface GlobalHotkey {
  readonly id: string;
  readonly keys: string;
  readonly description: string;
}

export const GLOBAL_HOTKEYS: readonly GlobalHotkey[] = [
  { id: "toggle-window", keys: "Cmd+Shift+N", description: "Toggle WOTANN window" },
  { id: "quick-prompt", keys: "Cmd+Shift+Space", description: "Quick prompt (mini window)" },
  { id: "voice-capture", keys: "Cmd+Shift+V", description: "Push-to-talk voice input" },
];

// ── App Metadata ────────────────────────────────────────

export const APP_METADATA = {
  name: "WOTANN",
  version: "0.1.0",
  identifier: "com.wotann.desktop",
  description: "The Unified AI Agent Harness",
  authors: ["WOTANN Contributors"],
  license: "MIT",
  homepage: "https://wotann.com",
  repository: "https://github.com/wotann/wotann",
  category: "DeveloperTool",
} as const;

// ── Theme Configuration ─────────────────────────────────

export interface DesktopTheme {
  readonly id: string;
  readonly name: string;
  readonly isDark: boolean;
  readonly colors: ThemeColors;
}

export interface ThemeColors {
  readonly background: string;
  readonly foreground: string;
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly border: string;
  readonly error: string;
  readonly warning: string;
  readonly success: string;
  readonly muted: string;
  readonly codeBackground: string;
  readonly sidebarBackground: string;
  readonly headerBackground: string;
}

export const WOTANN_DARK_THEME: DesktopTheme = {
  id: "wotann-dark",
  name: "WOTANN Dark",
  isDark: true,
  colors: {
    background: "#0d1117",
    foreground: "#e6edf3",
    primary: "#8b5cf6",
    secondary: "#6366f1",
    accent: "#a855f7",
    border: "#30363d",
    error: "#f85149",
    warning: "#d29922",
    success: "#3fb950",
    muted: "#8b949e",
    codeBackground: "#161b22",
    sidebarBackground: "#010409",
    headerBackground: "#0d1117",
  },
};

export const WOTANN_LIGHT_THEME: DesktopTheme = {
  id: "wotann-light",
  name: "WOTANN Light",
  isDark: false,
  colors: {
    background: "#ffffff",
    foreground: "#1f2328",
    primary: "#7c3aed",
    secondary: "#4f46e5",
    accent: "#9333ea",
    border: "#d0d7de",
    error: "#cf222e",
    warning: "#bf8700",
    success: "#1a7f37",
    muted: "#656d76",
    codeBackground: "#f6f8fa",
    sidebarBackground: "#f6f8fa",
    headerBackground: "#ffffff",
  },
};

// ── Tauri Command Definitions ───────────────────────────

/**
 * These map to Tauri's invoke() commands that bridge
 * the WebView frontend to the Rust backend and WotannRuntime.
 */
export type TauriCommand =
  | "get_runtime_status"
  | "send_message"
  | "enhance_prompt"
  | "start_autonomous"
  | "cancel_autonomous"
  | "run_arena"
  | "run_council"
  | "search_memory"
  | "get_conversations"
  | "create_conversation"
  | "delete_conversation"
  | "get_projects"
  | "create_project"
  | "switch_model"
  | "switch_mode"
  | "get_cost"
  | "get_context"
  | "pair_device"
  | "voice_capture"
  | "voice_stop"
  | "open_settings"
  | "check_updates"
  | "export_conversation"
  | "import_conversation";

/**
 * Generate the Tauri JSON configuration.
 * This would be written to src-tauri/tauri.conf.json in the actual Tauri project.
 */
export function generateTauriConfig(): Record<string, unknown> {
  return {
    $schema: "https://raw.githubusercontent.com/nicoh-dev/tauri-plugin-schema/refs/heads/main/tauri.conf.schema.json",
    productName: APP_METADATA.name,
    version: APP_METADATA.version,
    identifier: APP_METADATA.identifier,
    build: {
      frontendDist: "../dist",
      devUrl: "http://localhost:5173",
      beforeDevCommand: "npm run dev",
      beforeBuildCommand: "npm run build",
    },
    app: {
      windows: [MAIN_WINDOW],
      security: {
        csp: "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
      },
      trayIcon: {
        iconPath: "icons/tray.png",
        iconAsTemplate: true,
      },
    },
    bundle: {
      active: true,
      targets: "all",
      icon: [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
      ],
      macOS: {
        minimumSystemVersion: "13.0",
        frameworks: [],
        signingIdentity: null,
        entitlements: null,
      },
    },
    plugins: {
      updater: {
        endpoints: ["https://releases.wotann.com/{{target}}/{{arch}}/{{current_version}}"],
        pubkey: "",
      },
    },
  };
}
