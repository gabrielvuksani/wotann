/**
 * iOS Companion App Types — architecture for the WOTANN iOS application.
 *
 * WOTANN iOS connects to the user's desktop WOTANN instance via the
 * CompanionServer (WebSocket + TLS). It provides:
 *
 * CORE FEATURES (matching Claude iOS + ChatGPT iOS):
 * - Conversation management (create, list, search, delete)
 * - Streaming text responses with markdown rendering
 * - Voice input (native iOS speech recognition + Whisper)
 * - Image/file attachment (camera, photo library, files)
 * - Conversation history sync with desktop
 * - Push notifications on autonomous task completion
 * - Siri Shortcuts integration
 * - Home screen widget (context usage, active task, cost)
 * - Share extension (share text/images from other apps)
 * - Dark mode / dynamic type / accessibility
 *
 * UNIQUE WOTANN FEATURES (not in any competitor):
 * - Prompt enhancer (✨ button)
 * - Arena mode viewer (compare model responses)
 * - Council deliberation viewer
 * - Autonomous task monitor with live progress
 * - Cost tracker with budget alerts
 * - Provider health dashboard
 * - Secure QR pairing with desktop
 * - File sharing both ways (iOS → Desktop context)
 * - Remote slash commands (trigger /autonomous, /research, etc.)
 * - Multi-provider model switcher
 * - Context window gauge
 * - Voice memo → transcription → prompt pipeline
 *
 * ARCHITECTURE:
 * - Swift/SwiftUI native app
 * - MVVM architecture
 * - Combine for reactive data flow
 * - WebSocket client (URLSessionWebSocketTask)
 * - Keychain for secure storage
 * - Core Data for local conversation cache
 * - AVFoundation for voice recording
 * - Speech framework for on-device transcription
 * - WidgetKit for home screen widgets
 * - ActivityKit for Live Activities (autonomous tasks)
 * - Intents framework for Siri Shortcuts
 * - UserNotifications for push notifications
 */

// ── Screen Definitions ──────────────────────────────────

export type IOSScreen =
  | "splash"
  | "onboarding"
  | "pairing"        // QR code scanner + manual PIN
  | "conversations"   // List of all conversations
  | "chat"           // Active conversation with streaming
  | "voice"          // Voice input mode (full screen)
  | "arena"          // Side-by-side model comparison
  | "council"        // Deliberation results
  | "autonomous"     // Task monitor
  | "settings"       // App settings
  | "providers"      // Provider health dashboard
  | "cost"           // Cost tracker + budget
  | "skills"         // Available skills browser
  | "projects"       // Project workspace browser
  | "artifacts"      // Generated artifacts viewer
  | "knowledge"      // Memory / knowledge base
  | "channels"       // Multi-agent channels
  | "search";        // Cross-session search

// ── Conversation Types ──────────────────────────────────

export interface IOSConversation {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly messageCount: number;
  readonly lastMessageAt: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly tags: readonly string[];
}

export interface IOSMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly timestamp: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tokensUsed?: number;
  readonly cost?: number;
  readonly attachments?: readonly IOSAttachment[];
  readonly isStreaming?: boolean;
}

export interface IOSAttachment {
  readonly id: string;
  readonly type: "image" | "file" | "voice" | "code";
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
  readonly thumbnailUrl?: string;
  readonly localPath?: string;
}

// ── Voice Input ─────────────────────────────────────────

export interface IOSVoiceConfig {
  readonly useOnDeviceRecognition: boolean; // iOS Speech framework
  readonly useWhisper: boolean;             // Send to desktop for Whisper
  readonly language: string;
  readonly continuousListening: boolean;
  readonly hapticFeedback: boolean;
}

export interface IOSVoiceResult {
  readonly transcript: string;
  readonly confidence: number;
  readonly language: string;
  readonly durationSeconds: number;
  readonly method: "on-device" | "whisper-remote" | "vibevoice-remote";
}

// ── Widget Types ────────────────────────────────────────

export type WidgetFamily = "systemSmall" | "systemMedium" | "systemLarge" | "accessoryCircular" | "accessoryRectangular";

export interface IOSWidget {
  readonly family: WidgetFamily;
  readonly content: WidgetContent;
}

export type WidgetContent =
  | ContextGaugeWidget
  | ActiveTaskWidget
  | CostTrackerWidget
  | QuickActionWidget;

export interface ContextGaugeWidget {
  readonly type: "context-gauge";
  readonly contextPercent: number;
  readonly provider: string;
  readonly model: string;
  readonly maxTokens: number;
}

export interface ActiveTaskWidget {
  readonly type: "active-task";
  readonly taskDescription: string;
  readonly progress: number; // 0-1
  readonly status: "running" | "verifying" | "complete" | "failed";
  readonly cyclesUsed: number;
  readonly maxCycles: number;
}

export interface CostTrackerWidget {
  readonly type: "cost-tracker";
  readonly todayCost: number;
  readonly monthCost: number;
  readonly budget: number | null;
  readonly budgetPercent: number;
}

export interface QuickActionWidget {
  readonly type: "quick-action";
  readonly actions: readonly { label: string; command: string; icon: string }[];
}

// ── Siri Shortcuts ──────────────────────────────────────

export interface SiriShortcut {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly suggestedPhrase: string;
  readonly command: string; // Maps to slash command
  readonly parameterizable: boolean;
}

export const DEFAULT_SIRI_SHORTCUTS: readonly SiriShortcut[] = [
  {
    id: "wotann-ask",
    title: "Ask WOTANN",
    subtitle: "Send a prompt to your WOTANN agent",
    suggestedPhrase: "Hey WOTANN",
    command: "/query",
    parameterizable: true,
  },
  {
    id: "wotann-enhance",
    title: "Enhance Prompt",
    subtitle: "Enhance a prompt using the best model",
    suggestedPhrase: "Enhance my prompt",
    command: "/enhance",
    parameterizable: true,
  },
  {
    id: "wotann-cost",
    title: "Check Cost",
    subtitle: "View today's AI spending",
    suggestedPhrase: "How much have I spent",
    command: "/cost",
    parameterizable: false,
  },
  {
    id: "wotann-autonomous",
    title: "Start Task",
    subtitle: "Start an autonomous coding task",
    suggestedPhrase: "Start autonomous task",
    command: "/autonomous",
    parameterizable: true,
  },
  {
    id: "wotann-arena",
    title: "Arena Battle",
    subtitle: "Compare multiple models on a task",
    suggestedPhrase: "Run arena",
    command: "/arena",
    parameterizable: true,
  },
];

// ── Live Activity (Dynamic Island) ──────────────────────

export interface LiveActivityState {
  readonly taskId: string;
  readonly taskDescription: string;
  readonly status: "running" | "verifying" | "complete" | "failed";
  readonly progress: number;
  readonly cyclesCompleted: number;
  readonly maxCycles: number;
  readonly elapsedSeconds: number;
  readonly currentStep: string;
  readonly costSoFar: number;
}

// ── Share Extension ─────────────────────────────────────

export interface ShareExtensionInput {
  readonly type: "text" | "url" | "image" | "file";
  readonly content: string;
  readonly metadata?: Record<string, string>;
}

// ── App Config ──────────────────────────────────────────

export interface IOSAppConfig {
  readonly pairedDesktop: {
    readonly host: string;
    readonly port: number;
    readonly sessionId: string;
    readonly deviceName: string;
  } | null;
  readonly voice: IOSVoiceConfig;
  readonly appearance: {
    readonly theme: "system" | "light" | "dark";
    readonly fontSize: "small" | "medium" | "large" | "dynamic";
    readonly codeFont: string;
    readonly haptics: boolean;
  };
  readonly notifications: {
    readonly enabled: boolean;
    readonly taskCompletion: boolean;
    readonly errors: boolean;
    readonly channelMessages: boolean;
    readonly budgetAlerts: boolean;
  };
  readonly privacy: {
    readonly biometricLock: boolean; // Face ID / Touch ID
    readonly autoLockSeconds: number;
    readonly clearOnBackground: boolean;
  };
}

export const DEFAULT_IOS_CONFIG: IOSAppConfig = {
  pairedDesktop: null,
  voice: {
    useOnDeviceRecognition: true,
    useWhisper: false,
    language: "en",
    continuousListening: false,
    hapticFeedback: true,
  },
  appearance: {
    theme: "system",
    fontSize: "dynamic",
    codeFont: "SF Mono",
    haptics: true,
  },
  notifications: {
    enabled: true,
    taskCompletion: true,
    errors: true,
    channelMessages: true,
    budgetAlerts: true,
  },
  privacy: {
    biometricLock: true,
    autoLockSeconds: 300,
    clearOnBackground: false,
  },
};
