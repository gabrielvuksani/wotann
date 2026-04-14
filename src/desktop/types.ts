/**
 * Desktop App Types — shared types for the macOS desktop application.
 *
 * WOTANN Desktop is a Tauri-based macOS application that wraps the CLI
 * with a native GUI, adding features impossible in terminal:
 * - Prompt enhancer button
 * - Visual diff viewer with syntax highlighting
 * - Drag-and-drop file attachments
 * - System tray with quick actions
 * - Native notifications
 * - Spotlight-like command palette
 * - Multi-window conversation management
 * - iOS companion app pairing
 *
 * Architecture: Tauri (Rust + WebView) for native performance
 * Frontend: React + Tailwind CSS (reuses TUI component logic)
 * Backend: Calls WotannRuntime directly via Tauri commands
 */

// ── Window Types ────────────────────────────────────────

export interface DesktopWindow {
  readonly id: string;
  readonly type: WindowType;
  readonly title: string;
  readonly bounds: WindowBounds;
  readonly isActive: boolean;
  readonly sessionId: string | null;
}

export type WindowType =
  | "main"           // Primary chat window
  | "diff"           // Visual diff viewer
  | "canvas"         // Collaborative code editor
  | "arena"          // Side-by-side model comparison
  | "council"        // Multi-model deliberation view
  | "settings"       // Configuration
  | "companion";     // iOS companion pairing

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ── System Tray ─────────────────────────────────────────

export interface TrayConfig {
  readonly showCost: boolean;
  readonly showActiveProvider: boolean;
  readonly showContextPercent: boolean;
  readonly quickActions: readonly TrayQuickAction[];
}

export interface TrayQuickAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly command: string; // Maps to TUI slash command
  readonly shortcut?: string;
}

export const DEFAULT_TRAY_ACTIONS: readonly TrayQuickAction[] = [
  { id: "new-chat", label: "New Chat", icon: "plus", command: "/clear", shortcut: "Cmd+N" },
  { id: "voice", label: "Voice Input", icon: "mic", command: "/voice capture", shortcut: "Cmd+Shift+V" },
  { id: "enhance", label: "Enhance Prompt", icon: "sparkles", command: "/enhance", shortcut: "Cmd+E" },
  { id: "autonomous", label: "Autonomous Mode", icon: "robot", command: "/autonomous", shortcut: "Cmd+Shift+A" },
  { id: "cost", label: "View Cost", icon: "dollar", command: "/cost" },
  { id: "context", label: "Context Inspector", icon: "gauge", command: "/inspect" },
];

// ── Prompt Enhancer ─────────────────────────────────────

export interface PromptEnhancerConfig {
  readonly enabled: boolean;
  readonly autoEnhance: boolean; // Auto-enhance on submit
  readonly showDiff: boolean;    // Show before/after diff
  readonly model: string | "best-available";
  readonly enhancementStyle: EnhancementStyle;
}

export type EnhancementStyle =
  | "concise"      // Make shorter and more direct
  | "detailed"     // Add specificity and context
  | "technical"    // Add technical precision
  | "creative"     // Make more creative/exploratory
  | "structured";  // Add structure (steps, criteria)

export interface PromptEnhancerResult {
  readonly originalPrompt: string;
  readonly enhancedPrompt: string;
  readonly model: string;
  readonly provider: string;
  readonly style: EnhancementStyle;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly improvements: readonly string[];
}

// ── Command Palette ─────────────────────────────────────

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: CommandCategory;
  readonly shortcut?: string;
  readonly action: string; // Slash command or internal action
  readonly icon?: string;
  readonly keywords: readonly string[];
}

export type CommandCategory =
  | "session"
  | "configuration"
  | "intelligence"
  | "tools"
  | "execution"
  | "channels"
  | "diagnostics"
  | "training";

// ── Companion Pairing (iOS ↔ Desktop) ──────────────────

export interface CompanionDevice {
  readonly id: string;
  readonly name: string;
  readonly platform: "ios" | "android";
  readonly lastSeen: string; // ISO timestamp
  readonly paired: boolean;
  readonly capabilities: readonly CompanionCapability[];
}

export type CompanionCapability =
  | "voice-input"     // Can send voice recordings
  | "push-notify"     // Can receive push notifications
  | "file-share"      // Can share files
  | "screen-share"    // Can share screen
  | "remote-control"  // Can send commands
  | "sync-history";   // Can sync conversation history

export interface PairingRequest {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: "ios" | "android";
  readonly publicKey: string;
  readonly pin: string;
  readonly timestamp: string;
  readonly expiresAt: string;
}

export interface PairingSession {
  readonly id: string;
  readonly device: CompanionDevice;
  readonly establishedAt: string;
  readonly protocol: "websocket-tls" | "grpc-mtls";
  readonly status: "connecting" | "active" | "paused" | "disconnected";
  readonly messagesExchanged: number;
}

// ── Desktop App Config ──────────────────────────────────

export interface DesktopConfig {
  readonly theme: "system" | "light" | "dark";
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly tray: TrayConfig;
  readonly promptEnhancer: PromptEnhancerConfig;
  readonly notifications: NotificationConfig;
  readonly companion: CompanionConfig;
  readonly startup: StartupConfig;
}

export interface NotificationConfig {
  readonly enabled: boolean;
  readonly onComplete: boolean;    // Notify when autonomous task completes
  readonly onError: boolean;       // Notify on critical errors
  readonly onChannel: boolean;     // Notify on channel messages
  readonly sound: boolean;
  readonly badge: boolean;
}

export interface CompanionConfig {
  readonly enabled: boolean;
  readonly autoAcceptPairing: boolean;
  readonly syncHistory: boolean;
  readonly maxDevices: number;
  readonly serverPort: number;
}

export interface StartupConfig {
  readonly openOnLogin: boolean;
  readonly restoreLastSession: boolean;
  readonly showWelcome: boolean;
  readonly checkForUpdates: boolean;
}

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  theme: "system",
  fontSize: 14,
  fontFamily: "SF Mono, Menlo, monospace",
  tray: {
    showCost: true,
    showActiveProvider: true,
    showContextPercent: true,
    quickActions: [...DEFAULT_TRAY_ACTIONS],
  },
  promptEnhancer: {
    enabled: true,
    autoEnhance: false,
    showDiff: true,
    model: "best-available",
    enhancementStyle: "detailed",
  },
  notifications: {
    enabled: true,
    onComplete: true,
    onError: true,
    onChannel: true,
    sound: true,
    badge: true,
  },
  companion: {
    enabled: true,
    autoAcceptPairing: false,
    syncHistory: true,
    maxDevices: 3,
    serverPort: 3849,
  },
  startup: {
    openOnLogin: false,
    restoreLastSession: true,
    showWelcome: true,
    checkForUpdates: true,
  },
};
