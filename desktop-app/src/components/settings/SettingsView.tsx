/**
 * Full settings panels: Providers, Theme, Shortcuts, Security.
 */

import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { getChannelsStatus, stopEngine, startEngine, initializeFromEngine, runDoctor, triggerDream } from "../../store/engine";
import { commands, type CompanionDeviceInfo, type CompanionPairingInfo } from "../../hooks/useTauriCommand";
import { ProviderConfig } from "./ProviderConfig";
import { ShortcutEditor } from "./ShortcutEditor";
// V9 Wave 2-M (R-05) — surface the SettingsAdvancedSection sub-panel.
// The sub-panel hosts the PatronSummoningButton, which is the canonical
// `wotann:open-patron` emitter (consumed by App.tsx). Was an orphan
// component until this wire — see SettingsAdvancedSection.tsx header.
import { SettingsAdvancedSection } from "./SettingsAdvancedSection";
import { WORKSPACE_PRESETS } from "../../lib/workspace-presets";
import type { WorkspacePreset } from "../../types";
import { ConnectorsGUI } from "../connectors/ConnectorsGUI";
import { PluginManager } from "../plugins/PluginManager";
import { ExecApprovals } from "../security/ExecApprovals";
import { QRCodeSVG } from "qrcode.react";
import { RemoteControlView } from "../companion/RemoteControlView";
import { WotannThemePicker } from "../wotann/WotannThemePicker";
import { ValknutSpinner } from "../wotann/ValknutSpinner";

interface SettingsSection {
  readonly id: string;
  readonly label: string;
}

const SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "appearance", label: "Appearance" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security & Guards" },
  { id: "devices", label: "Linked Devices" },
  { id: "voice", label: "Voice" },
  { id: "memory", label: "Memory" },
  { id: "connectors", label: "Connectors" },
  { id: "plugins", label: "Plugins" },
  { id: "channels", label: "Channels" },
  { id: "knowledge", label: "Knowledge & Learning" },
  { id: "filesharing", label: "File Sharing" },
  { id: "automations", label: "Automations" },
  { id: "advanced", label: "Advanced" },
];

export function SettingsView() {
  const [activeSection, setActiveSection] = useState("general");
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const setView = useStore((s) => s.setView);
  const setWorkspacePreset = useStore((s) => s.setWorkspacePreset);

  return (
    <div className="flex h-full" style={{ background: "var(--color-bg-primary)" }}>
      {/* Settings sidebar */}
      <nav
        className="shrink-0"
        style={{
          width: 180,
          borderRight: "1px solid var(--border-subtle)",
          padding: "10px 0",
          overflowY: "auto",
        }}
        aria-label="Settings sections"
      >
        <button
          onClick={() => setView("chat")}
          className="btn-press"
          style={{
            width: "100%",
            textAlign: "left",
            padding: "8px 16px",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            marginBottom: 8,
          }}
          aria-label="Back to Chat"
        >
          &larr; Back to Chat
        </button>
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            aria-current={activeSection === section.id ? "page" : undefined}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 16px",
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
              border: "none",
              borderLeft: activeSection === section.id ? "2px solid var(--accent)" : "2px solid transparent",
              background: activeSection === section.id ? "var(--bg-surface)" : "transparent",
              color: activeSection === section.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
            }}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {/* Settings content */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: "20px 24px", maxWidth: 640 }}
      >
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 16, letterSpacing: "var(--tracking-tight)" }}>
          {SECTIONS.find((s) => s.id === activeSection)?.label ?? "Settings"}
        </h2>

        {activeSection === "general" && (
          <div className="space-y-6">
            {/* Workspace Preset Picker */}
            <div>
              <div className="text-sm mb-1" style={{ color: "var(--color-text-primary)" }}>Workspace Preset</div>
              <div className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
                Reorders quick actions and sidebar emphasis for your role. All features remain accessible.
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(WORKSPACE_PRESETS) as readonly [WorkspacePreset, typeof WORKSPACE_PRESETS[WorkspacePreset]][]).map(
                  ([key, preset]) => {
                    const isSelected = settings.workspacePreset === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setWorkspacePreset(key)}
                        className="btn-press"
                        style={{
                          textAlign: "left",
                          padding: 12,
                          borderRadius: "var(--radius-md)",
                          cursor: "pointer",
                          background: isSelected ? "var(--bg-surface)" : "transparent",
                          border: `1px solid ${isSelected ? "var(--border-default)" : "var(--border-subtle)"}`,
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${preset.label} workspace preset: ${preset.description}`}
                      >
                        <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>
                          {preset.label}
                        </div>
                        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginTop: 4 }}>
                          {preset.description}
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }} />

            <SettingRow label="Auto-enhance prompts" description="Automatically improve vague prompts before sending">
              <Toggle checked={settings.autoEnhance} onChange={(v) => updateSetting("autoEnhance", v)} />
            </SettingRow>
            <SettingRow label="Auto-verify changes" description="Run typecheck and tests after each code change">
              <Toggle checked={settings.autoVerify} onChange={(v) => updateSetting("autoVerify", v)} />
            </SettingRow>
            <SettingRow label="Auto-select provider" description="Let WOTANN pick the best model for each task">
              <Toggle checked={settings.autoSelectProvider} onChange={(v) => updateSetting("autoSelectProvider", v)} />
            </SettingRow>
            <SettingRow label="Launch at login" description="Start WOTANN Engine when you log in">
              <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSetting("launchAtLogin", v)} />
            </SettingRow>
            <SettingRow label="Monthly budget limit" description="Set a spending cap (leave empty for unlimited)">
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>$</span>
                <input
                  type="number"
                  value={settings.budgetLimit ?? ""}
                  onChange={(e) => updateSetting("budgetLimit", e.target.value ? Number(e.target.value) : null)}
                  className="w-20 border rounded-md px-2 py-1 text-sm focus:outline-none"
                  style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
                  placeholder="50"
                />
              </div>
            </SettingRow>
          </div>
        )}

        {activeSection === "providers" && <ProviderConfig />}

        {activeSection === "appearance" && (
          <div className="space-y-6">
            <SettingRow label="Theme" description="Choose your preferred theme">
              <select
                value={settings.theme}
                onChange={(e) => updateSetting("theme", e.target.value as "dark" | "midnight" | "true-black" | "light" | "system")}
                className="border rounded-md px-3 py-1.5 text-sm focus:outline-none"
                style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
              >
                <option value="dark">WOTANN Dark</option>
                <option value="midnight">Midnight</option>
                <option value="true-black">True Black</option>
                <option value="light">WOTANN Light</option>
                <option value="system">System</option>
              </select>
            </SettingRow>
            <SettingRow
              label="Signature palette"
              description="WOTANN's Norse-themed overlay — sits on top of the base theme"
            >
              <WotannThemePicker />
            </SettingRow>
            <SettingRow label="Accent color" description="Primary color used across the interface">
              <div className="flex items-center gap-2">
                {(["violet", "blue", "emerald", "amber", "rose", "cyan"] as const).map((color) => {
                  // Accent picker swatches are user-selectable distinct colors —
                  // each is the identity of a choice, not a theme token. Pre-2026-04-29
                  // "violet" was wired to #0A84FF (Apple systemBlue) — fixed to a real
                  // violet so the label matches the swatch.
                  const colorMap: Record<string, string> = {
                    violet: "#7c3aed",
                    blue: "#3b82f6",
                    emerald: "#10b981",
                    amber: "#f59e0b",
                    rose: "#f43f5e",
                    cyan: "#06b6d4",
                  };
                  const isSelected = settings.accentColor === color;
                  return (
                    <button
                      key={color}
                      onClick={() => updateSetting("accentColor", color)}
                      className="w-6 h-6 rounded-full transition-transform focus-ring"
                      style={{
                        background: colorMap[color],
                        outline: isSelected ? `2px solid ${colorMap[color]}` : "none",
                        outlineOffset: 2,
                        transform: isSelected ? "scale(1.15)" : "scale(1)",
                      }}
                      aria-label={`${color} accent color`}
                      aria-pressed={isSelected}
                    />
                  );
                })}
              </div>
            </SettingRow>
            <SettingRow label="Font size" description="Editor and chat font size">
              <select
                value={settings.fontSize}
                onChange={(e) => updateSetting("fontSize", Number(e.target.value))}
                className="border rounded-md px-3 py-1.5 text-sm focus:outline-none"
                style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
              >
                {[12, 13, 14, 15, 16].map((size) => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label="Code font" description="Font for code blocks and editor">
              <select
                value={settings.codeFont}
                onChange={(e) => updateSetting("codeFont", e.target.value)}
                className="border rounded-md px-3 py-1.5 text-sm focus:outline-none"
                style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
              >
                {["JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono"].map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
            </SettingRow>
          </div>
        )}

        {activeSection === "shortcuts" && <ShortcutEditor />}

        {activeSection === "notifications" && (
          <div className="space-y-6">
            <SettingRow label="Enable notifications" description="Show macOS notifications for completed tasks">
              <Toggle checked={settings.notificationsEnabled} onChange={(v) => updateSetting("notificationsEnabled", v)} />
            </SettingRow>
            <SettingRow label="Sound alerts" description="Play sound when a task finishes">
              <Toggle checked={settings.soundAlerts} onChange={(v) => updateSetting("soundAlerts", v)} />
            </SettingRow>
            <SettingRow label="Budget alerts" description="Notify when approaching budget limit">
              <Toggle checked={settings.budgetAlerts} onChange={(v) => updateSetting("budgetAlerts", v)} />
            </SettingRow>
          </div>
        )}

        {activeSection === "security" && (
          <div className="space-y-6">
            <SettingRow label="Dangerous command guard" description="Warn before rm -rf, git reset --hard, DROP TABLE">
              <Toggle checked={settings.dangerousCommandGuard} onChange={(v) => updateSetting("dangerousCommandGuard", v)} />
            </SettingRow>
            <SettingRow label="Block --no-verify" description="Prevent skipping git hooks">
              <Toggle checked={settings.blockNoVerify} onChange={(v) => updateSetting("blockNoVerify", v)} />
            </SettingRow>
            <SettingRow label="Config protection" description="Block modification of linter/formatter configs">
              <Toggle checked={settings.configProtection} onChange={(v) => updateSetting("configProtection", v)} />
            </SettingRow>
            <SettingRow label="Loop detection" description="Warn at 3, block at 5 identical consecutive calls">
              <Toggle checked={settings.loopDetection} onChange={(v) => updateSetting("loopDetection", v)} />
            </SettingRow>

            {/* Exec Approvals — absorbed from standalone view */}
            <div className="pt-4 mt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>Command Approval Rules</p>
              <ExecApprovals />
            </div>
          </div>
        )}

        {activeSection === "devices" && (
          <DevicesSection />
        )}

        {activeSection === "voice" && (
          <div className="space-y-6">
            <SettingRow label="Voice input" description="Enable push-to-talk microphone input">
              <Toggle checked={settings.voiceInput} onChange={(v) => updateSetting("voiceInput", v)} />
            </SettingRow>
            <SettingRow label="Voice output" description="Enable text-to-speech for responses">
              <Toggle checked={settings.voiceOutput} onChange={(v) => updateSetting("voiceOutput", v)} />
            </SettingRow>
          </div>
        )}

        {activeSection === "memory" && (
          <div className="space-y-6">
            <SettingRow label="Persistent memory" description="Store decisions, bugs, and patterns across sessions">
              <Toggle checked={settings.persistentMemory} onChange={(v) => updateSetting("persistentMemory", v)} />
            </SettingRow>
            <SettingRow label="Auto-save discoveries" description="Automatically save root causes and fixes to memory">
              <Toggle checked={settings.autoSaveDiscoveries} onChange={(v) => updateSetting("autoSaveDiscoveries", v)} />
            </SettingRow>
            <div className="pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <button
                className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                style={{ background: "var(--surface-3)", color: "var(--color-text-secondary)" }}
                onClick={async () => {
                  try {
                    const { commands } = await import("../../hooks/useTauriCommand");
                    await commands.clearMemory();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).__wotannToast?.({ type: "success", title: "Memory cleared", message: "All memory entries have been removed" });
                  } catch (e) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).__wotannToast?.({ type: "error", title: "Failed", message: String(e) });
                  }
                }}
              >
                Clear Memory Database
              </button>
            </div>
          </div>
        )}

        {activeSection === "connectors" && (
          <div className="space-y-4">
            <ConnectorsGUI />
          </div>
        )}

        {activeSection === "plugins" && (
          <div className="space-y-4">
            <PluginManager />
          </div>
        )}

        {activeSection === "channels" && (
          <ChannelsSection />
        )}

        {activeSection === "knowledge" && (
          <KnowledgeLearningSection />
        )}

        {activeSection === "filesharing" && (
          <FileSharingSection />
        )}

        {activeSection === "automations" && (
          <AutomationsSection />
        )}

        {activeSection === "advanced" && (
          <>
            <AdvancedSection />
            {/* V9 Wave 2-M — Choose-Patron entry point. The sub-panel is
                self-contained (header + helper + button) so the rest of
                the Advanced section stays untouched. */}
            <SettingsAdvancedSection />
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared Components ────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: "12px 0", borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div style={{ marginRight: 16, flex: 1 }}>
        <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{label}</div>
        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: 2 }}>{description}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: "var(--radius-lg)",
        background: checked ? "var(--accent)" : "var(--surface-3)",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "var(--radius-md)",
          background: "white",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

// ── Devices Section (QR Pairing + Remote Control) ──────

function DevicesSection() {
  const [showQr, setShowQr] = useState(false);
  const [pairing, setPairing] = useState<CompanionPairingInfo | null>(null);
  const [devices, setDevices] = useState<readonly CompanionDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  const refreshDevices = async () => {
    try {
      const nextDevices = await commands.getCompanionDevices();
      setDevices(nextDevices);
    } catch {
      setDevices([]);
    }
  };

  useEffect(() => {
    void refreshDevices();
  }, []);

  const toggleQr = async () => {
    if (showQr) {
      setShowQr(false);
      setPairing(null);
      return;
    }

    setLoadingQr(true);
    setError(null);
    try {
      const nextPairing = await commands.getCompanionPairing();
      if (!nextPairing) {
        throw new Error("Companion server unavailable");
      }
      setPairing(nextPairing);
      setShowQr(true);
      await refreshDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate pairing QR");
    } finally {
      setLoadingQr(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", border: "none", boxShadow: "var(--shadow-ring)" }}>
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
            <rect x="4" y="1" width="8" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm mb-1" style={{ color: "var(--color-text-secondary)" }}>
          {devices.length > 0 ? `${devices.length} device${devices.length === 1 ? "" : "s"} linked` : "No devices linked"}
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          Pair your phone to control WOTANN remotely, dispatch tasks, and get notifications.
        </p>
        <button
          onClick={() => { void toggleQr(); }}
          className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors"
          style={{ background: "var(--gradient-accent)" }}
          aria-label={showQr ? "Hide QR code" : "Show QR code for device pairing"}
          disabled={loadingQr}
        >
          {loadingQr ? "Preparing QR..." : showQr ? "Hide QR Code" : "Show QR Code"}
        </button>
        {showQr && (
          <div className="mt-4 inline-flex flex-col items-center gap-3">
            {/* TODO(design-token): QR code bg must be pure white for scanner contrast regardless of theme */}
            <div style={{ padding: 12, background: "#ffffff", borderRadius: "var(--radius-md)" }}>
              <QRCodeSVG value={pairing?.qrData ?? "wotann://pair"} size={180} level="M" />
            </div>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Scan with the WOTANN iOS app
            </p>
            <p className="text-xs font-mono" style={{ color: "var(--color-primary)" }}>
              PIN: {pairing?.pin ?? "------"}
            </p>
            {pairing?.expiresAt && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="text-xs mt-3" style={{ color: "var(--color-error)" }}>
            {error}
          </p>
        )}
        <p className="text-xs mt-3" style={{ color: "var(--color-text-muted)" }}>
          Or run <code style={{ color: "var(--color-primary)", background: "var(--accent-muted)", padding: "2px 6px", borderRadius: "var(--radius-xs)" }}>wotann link</code> in your terminal
        </p>
      </div>

      {/* Linked Devices — RemoteControlView shows active sessions */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-md)" }}>
        <RemoteControlView />
      </div>
    </div>
  );
}

// ── Channels Section ────────────────────────────────────
const CHANNEL_ADAPTERS = [
  { id: "telegram", name: "Telegram", icon: "T", description: "Bot API — long polling" },
  { id: "discord", name: "Discord", icon: "D", description: "WebSocket gateway" },
  { id: "slack", name: "Slack", icon: "S", description: "Web API + Socket Mode" },
  { id: "webchat", name: "WebChat", icon: "W", description: "HTTP + SSE streaming" },
  { id: "github", name: "GitHub Bot", icon: "G", description: "Webhook — @wotann mention handler (port 7743)" },
  { id: "ide-bridge", name: "IDE Bridge", icon: "I", description: "JSON-RPC — VS Code/Cursor integration (port 7742)" },
] as const;

function ChannelsSection() {
  const [channels, setChannels] = useState<readonly { readonly id: string; readonly connected: boolean }[]>([]);
  const engineConnected = useStore((s) => s.engineConnected);

  useEffect(() => {
    if (engineConnected) {
      getChannelsStatus().then((entries) => setChannels(entries.map((e) => ({ id: e.id, connected: e.connected })))).catch(() => {});
    }
  }, [engineConnected]);

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Channel Adapters</p>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        Configure messaging channels to receive and respond to messages through WOTANN.
      </p>
      <div className="space-y-2">
        {CHANNEL_ADAPTERS.map((ch) => {
          const status = channels.find((c) => c.id === ch.id);
          const isConnected = status?.connected === true;
          return (
            <div
              key={ch.id}
              className="flex items-center justify-between"
              style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-1)", border: "none", boxShadow: "var(--shadow-ring)" }}
            >
              <div className="flex items-center gap-3">
                <span style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-text-secondary)" }}>{ch.icon}</span>
                <div>
                  <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{ch.name}</div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>{ch.description}</div>
                </div>
              </div>
              <span style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-lg)", background: isConnected ? "rgba(var(--green-rgb), 0.1)" : "var(--surface-2)", color: isConnected ? "var(--green)" : "var(--color-text-dim)" }}>
                {isConnected ? "Connected" : "Not configured"}
              </span>
            </div>
          );
        })}
      </div>
      {/* GitHub Bot configuration */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, marginTop: 12 }}>
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>GitHub Bot Configuration</p>
        <div className="flex items-center gap-2 mb-2">
          <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)", minWidth: 140, flexShrink: 0 }}>GITHUB_WEBHOOK_SECRET</label>
          <input
            type="password"
            placeholder="whsec_..."
            className="depth-input-container"
            style={{ padding: "4px 8px", fontSize: "var(--font-size-xs)", flex: 1, color: "var(--color-text-primary)", background: "var(--surface-1)", borderRadius: "var(--radius-sm)" }}
            aria-label="GitHub webhook secret"
          />
        </div>
        <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
          Required for @wotann mentions in GitHub issues and PRs. Set via env var or enter above.
        </p>
      </div>

      {/* IDE Bridge status */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12, marginTop: 12 }}>
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>IDE Bridge</p>
        <div className="flex items-center justify-between" style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-1)", boxShadow: "var(--shadow-ring)" }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>JSON-RPC Server</span>
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>localhost:7742</span>
          </div>
          <span style={{
            fontSize: "var(--font-size-2xs)",
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "var(--radius-lg)",
            background: engineConnected ? "rgba(var(--green-rgb), 0.1)" : "var(--surface-2)",
            color: engineConnected ? "var(--green)" : "var(--color-text-dim)",
          }}>
            {engineConnected ? "Listening" : "Inactive"}
          </span>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--color-text-dim)" }}>
          Install the WOTANN extension in VS Code or Cursor to connect automatically.
        </p>
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-dim)", marginTop: 8 }}>
        Set API tokens via environment variables (TELEGRAM_BOT_TOKEN, DISCORD_TOKEN, etc.) or in .wotann/wotann.yaml.
      </p>
    </div>
  );
}

// ── Knowledge & Learning Section ───────────────────────

function KnowledgeLearningSection() {
  const [dreamRunning, setDreamRunning] = useState(false);
  const [dreamMessage, setDreamMessage] = useState("");

  const handleTriggerDream = async () => {
    setDreamRunning(true);
    setDreamMessage("Running dream cycle...");
    try {
      const result = await triggerDream();
      if (result) {
        const dreamData = result as unknown as Record<string, unknown>;
        setDreamMessage(`Dream cycle complete: ${(dreamData["promoted"] as number | undefined) ?? 0} patterns promoted, ${(dreamData["rejected"] as number | undefined) ?? 0} rejected.`);
      } else {
        setDreamMessage("Dream cycle completed.");
      }
    } catch (e) {
      setDreamMessage(`Dream cycle failed: ${String(e)}`);
    } finally {
      setDreamRunning(false);
      setTimeout(() => setDreamMessage(""), 8000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Learned Patterns */}
      <div>
        <p className="text-sm mb-1" style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
          Learned Patterns
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          WOTANN learns from your corrections, confirmations, and coding patterns.
          Insights are consolidated during dream cycles.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleTriggerDream}
            disabled={dreamRunning}
            className="btn-press"
            style={{
              padding: "6px 16px",
              borderRadius: "var(--radius-sm)",
              background: dreamRunning ? "var(--surface-3)" : "var(--accent)",
              color: dreamRunning ? "var(--color-text-secondary)" : "white",
              border: "none",
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              cursor: dreamRunning ? "default" : "pointer",
            }}
            aria-label="Trigger dream cycle for learning extraction"
          >
            {dreamRunning ? "Running..." : "Trigger Dream Cycle"}
          </button>
        </div>
        {dreamMessage && (
          <p
            className="mt-2"
            style={{
              fontSize: "var(--font-size-xs)",
              color: dreamMessage.includes("failed") ? "var(--red)" : "var(--green)",
            }}
          >
            {dreamMessage}
          </p>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }} />

      {/* Correction History */}
      <div>
        <p className="text-sm mb-1" style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
          Correction History
        </p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          Corrections are automatically detected and fed into the learning pipeline.
          Patterns with &gt;80% confidence become instincts.
        </p>
      </div>

      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }} />

      {/* Context Intelligence */}
      <div>
        <p className="text-sm mb-2" style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
          Context Intelligence
        </p>
        <div className="space-y-2">
          <div
            className="flex items-center justify-between"
            style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-1)", boxShadow: "var(--shadow-ring)" }}
          >
            <div>
              <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>TurboQuant</div>
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                KV cache compression: Active for Ollama models (6x effective context)
              </div>
            </div>
            <span style={{
              fontSize: "var(--font-size-2xs)",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "var(--radius-lg)",
              background: "rgba(var(--green-rgb), 0.1)",
              color: "var(--green)",
            }}>
              Active
            </span>
          </div>
          <div
            className="flex items-center justify-between"
            style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-1)", boxShadow: "var(--shadow-ring)" }}
          >
            <div>
              <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>VirtualContext</div>
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                Context archiving: Active at 80% pressure threshold
              </div>
            </div>
            <span style={{
              fontSize: "var(--font-size-2xs)",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "var(--radius-lg)",
              background: "rgba(var(--green-rgb), 0.1)",
              color: "var(--green)",
            }}>
              Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── File Sharing (LocalSend) Section ────────────────────

interface LocalSendDevice {
  readonly alias: string;
  readonly deviceType: string;
  readonly port: number;
  readonly fingerprint: string;
}

function FileSharingSection() {
  const [devices, setDevices] = useState<readonly LocalSendDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startDiscovery = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const { commands } = await import("../../hooks/useTauriCommand");
      const found = await commands.discoverLocalSendDevices();
      setDevices(found);
    } catch (e) {
      setError(`Discovery failed: ${String(e)}`);
    }
    setDiscovering(false);
  };

  const stopDiscovery = async () => {
    try {
      const { commands } = await import("../../hooks/useTauriCommand");
      await commands.stopLocalSendDiscovery();
    } catch {
      // Best effort
    }
    setDiscovering(false);
  };

  const sendFile = async (fingerprint: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false });
      if (!selected) return;

      setSendingTo(fingerprint);
      setError(null);
      const { commands } = await import("../../hooks/useTauriCommand");
      await commands.sendFileLocalSend(fingerprint, selected as string);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__wotannToast?.({ type: "success", title: "File sent", message: "Transfer complete." });
    } catch (e) {
      setError(`Send failed: ${String(e)}`);
    }
    setSendingTo(null);
  };

  const deviceIcon = (type: string): string => {
    switch (type.toLowerCase()) {
      case "phone": return "P";
      case "tablet": return "T";
      case "desktop": return "D";
      case "laptop": return "L";
      default: return "?";
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>File Sharing (LocalSend)</p>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        Discover nearby devices on your local network and send files using the LocalSend protocol. No internet required.
      </p>

      {/* Status + Discover button */}
      <div className="flex items-center gap-3">
        <button
          onClick={discovering ? stopDiscovery : startDiscovery}
          className="btn-press"
          style={{
            padding: "6px 16px",
            borderRadius: "var(--radius-sm)",
            background: discovering ? "var(--surface-3)" : "var(--accent)",
            color: discovering ? "var(--color-text-secondary)" : "white",
            border: "none",
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            cursor: "pointer",
          }}
          aria-label={discovering ? "Stop discovering devices" : "Discover nearby devices"}
        >
          {discovering ? "Stop Discovery" : "Discover Devices"}
        </button>
        <span style={{
          fontSize: "var(--font-size-2xs)",
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: "var(--radius-lg)",
          background: discovering ? "rgba(var(--amber-rgb, 245, 158, 11), 0.1)" : "var(--surface-2)",
          color: discovering ? "var(--amber)" : "var(--color-text-dim)",
        }}>
          {discovering ? "Discovering..." : "Idle"}
        </span>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs" style={{ color: "var(--red)", padding: "4px 0" }}>{error}</p>
      )}

      {/* Device list */}
      {devices.length > 0 ? (
        <div className="space-y-2">
          {devices.map((device) => (
            <div
              key={device.fingerprint}
              className="flex items-center justify-between"
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-1)",
                border: "none",
                boxShadow: "var(--shadow-ring)",
              }}
            >
              <div className="flex items-center gap-3">
                <span style={{
                  width: 28,
                  height: 28,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-surface)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                }}>
                  {deviceIcon(device.deviceType)}
                </span>
                <div>
                  <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {device.alias}
                  </div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                    {device.deviceType} &middot; port {device.port}
                  </div>
                </div>
              </div>
              <button
                onClick={() => sendFile(device.fingerprint)}
                disabled={sendingTo === device.fingerprint}
                className="btn-press"
                style={{
                  padding: "4px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: sendingTo === device.fingerprint ? "var(--surface-3)" : "var(--accent-muted)",
                  color: sendingTo === device.fingerprint ? "var(--color-text-dim)" : "var(--accent)",
                  border: "none",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  cursor: sendingTo === device.fingerprint ? "default" : "pointer",
                }}
                aria-label={`Send file to ${device.alias}`}
              >
                {sendingTo === device.fingerprint ? "Sending..." : "Send File"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        !discovering && (
          <div
            className="flex items-center justify-center"
            style={{
              padding: "20px 16px",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-1)",
              boxShadow: "var(--shadow-ring)",
            }}
          >
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textAlign: "center" }}>
              No devices found. Click "Discover Devices" to scan your local network.
            </p>
          </div>
        )
      )}

      <p className="text-xs" style={{ color: "var(--color-text-dim)", marginTop: 8 }}>
        Devices must be on the same local network with LocalSend enabled. Files are transferred directly, peer-to-peer.
      </p>
    </div>
  );
}

// ── Automations Section ─────────────────────────────────
interface AutomationRule {
  readonly id: string;
  readonly name: string;
  readonly trigger: string;
  readonly schedule?: string;
  readonly enabled: boolean;
}

function AutomationsSection() {
  const [automations, setAutomations] = useState<readonly AutomationRule[]>([]);

  // Load automations from engine on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { getCronJobs } = await import("../../store/engine");
        const jobs = await getCronJobs();
        if (!cancelled && jobs) {
          setAutomations(jobs.map((j) => ({
            id: j.id,
            name: j.name,
            trigger: "cron" as const,
            schedule: j.schedule,
            enabled: j.enabled,
          })));
        }
      } catch { /* engine not available */ }
    }
    load();
    return () => { cancelled = true; };
  }, []);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("cron");

  const toggleAutomation = (id: string) => {
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const addRule = () => {
    if (!newName.trim()) return;
    const rule: AutomationRule = {
      id: `auto-${Date.now()}`,
      name: newName.trim(),
      trigger: newTrigger,
      schedule: newTrigger === "cron" ? "0 9 * * *" : undefined,
      enabled: true,
    };
    setAutomations((prev) => [...prev, rule]);
    setNewName("");
    setShowNewForm(false);
  };

  const removeRule = (id: string) => {
    setAutomations((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>Automations</p>
        <button
          className="depth-ghost-btn"
          style={{ padding: "4px 12px", fontSize: "var(--font-size-xs)", fontWeight: 600, borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--color-primary)" }}
          onClick={() => setShowNewForm(!showNewForm)}
        >
          {showNewForm ? "Cancel" : "+ New Rule"}
        </button>
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        Event-driven agents triggered by GitHub PRs, Slack messages, cron schedules, or file changes.
      </p>

      {showNewForm && (
        <div className="flex items-center gap-2" style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", border: "1px solid var(--border-default)" }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Rule name..."
            autoFocus
            className="depth-input-container"
            style={{ padding: "4px 8px", fontSize: "var(--font-size-xs)", flex: 1, color: "var(--color-text-primary)", background: "var(--surface-1)" }}
            onKeyDown={(e) => { if (e.key === "Enter") addRule(); }}
          />
          <select
            value={newTrigger}
            onChange={(e) => setNewTrigger(e.target.value)}
            style={{ padding: "4px 8px", fontSize: "var(--font-size-xs)", borderRadius: "var(--radius-sm)", background: "var(--surface-1)", color: "var(--color-text-secondary)", border: "none", boxShadow: "var(--shadow-ring)" }}
          >
            <option value="cron">Cron</option>
            <option value="github">GitHub</option>
            <option value="filesystem">File Watch</option>
            <option value="slack">Slack</option>
          </select>
          <button onClick={addRule} className="depth-ghost-btn" style={{ padding: "4px 12px", fontSize: "var(--font-size-xs)", fontWeight: 600, borderRadius: "var(--radius-sm)", cursor: "pointer" }}>Add</button>
        </div>
      )}

      <div className="space-y-2">
        {automations.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between"
            style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-1)", border: "none", boxShadow: "var(--shadow-ring)" }}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{a.name}</div>
                <button
                  onClick={() => removeRule(a.id)}
                  style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}
                  aria-label={`Remove ${a.name}`}
                >
                  x
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span style={{ fontSize: "var(--font-size-2xs)", padding: "1px 6px", borderRadius: "var(--radius-xs)", background: "var(--bg-surface)", color: "var(--color-text-dim)", fontWeight: 500 }}>{a.trigger}</span>
                {a.schedule && <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>{a.schedule}</span>}
              </div>
            </div>
            <Toggle checked={a.enabled} onChange={() => toggleAutomation(a.id)} />
          </div>
        ))}
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
        Rules are stored in .wotann/triggers.yaml and executed by the KAIROS daemon.
      </p>
    </div>
  );
}

// ── Recommended models — derived from daemon's auto-update.ts ──
// `models.recommended` returns the canonical curated list (single source
// of truth, kept in src/daemon/auto-update.ts). The friendly-name table
// below adds display metadata for known IDs; unknown IDs fall back to
// title-case of the ID. Adding a model only requires editing
// auto-update.ts — no UI edit needed for it to appear here.
interface RecommendedModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}
const MODEL_DISPLAY_OVERRIDES: Readonly<Record<string, { name: string; description: string }>> = {
  // Coding-focused
  "qwen3-coder-next": { name: "Qwen3 Coder Next", description: "Alibaba's frontier coding model — top of HumanEval" },
  "devstral": { name: "Devstral", description: "Mistral's coding model with deep IDE awareness" },
  "codestral": { name: "Codestral", description: "Mistral's code-specialized model" },
  "deepseek-coder-v2:16b": { name: "DeepSeek Coder V2 16B", description: "Strong coding benchmarks at 16B scale" },
  "codellama:7b": { name: "Code Llama 7B", description: "Meta's code-specialized 7B model" },
  // General
  "gemma4": { name: "Gemma 4", description: "Google's efficient general model" },
  "gemma4:2b": { name: "Gemma 4 2B", description: "Tiny variant for ultra-fast local inference" },
  "gemma3:4b": { name: "Gemma 3 4B", description: "Google's efficient 4B model" },
  "llama4": { name: "Llama 4", description: "Meta's flagship general model" },
  "llama4:scout": { name: "Llama 4 Scout", description: "Smaller Llama 4 variant" },
  "llama3.2:3b": { name: "Llama 3.2 3B", description: "Meta's compact 3B model — fast local inference" },
  "phi-4": { name: "Phi-4", description: "Microsoft's reasoning-focused compact model" },
  "phi-4-mini": { name: "Phi-4 Mini", description: "Tiny Phi-4 variant for low-RAM hardware" },
  "mistral-large": { name: "Mistral Large", description: "Mistral AI's flagship general model" },
  "mistral:7b": { name: "Mistral 7B", description: "Mistral AI's balanced 7B model" },
  "qwen3:4b": { name: "Qwen 3 4B", description: "Alibaba's strong multilingual 4B model" },
  // Reasoning
  "deepseek-r1": { name: "DeepSeek R1", description: "Reasoning model with strong chain-of-thought" },
  "qwen3.5:27b": { name: "Qwen 3.5 27B", description: "Reasoning + multilingual 27B model" },
  // Multilingual
  "glm-5": { name: "GLM-5", description: "Tsinghua/Zhipu multilingual model" },
  "glm-5.1": { name: "GLM-5.1", description: "Updated GLM with stronger English" },
};
function decorateModel(id: string): RecommendedModel {
  const meta = MODEL_DISPLAY_OVERRIDES[id];
  if (meta) return { id, name: meta.name, description: meta.description };
  // Fallback: title-case the model id; no canned description so we never
  // lie about a model we haven't curated.
  const name = id
    .split(/[:\-_]/)
    .map((part) => (part.length ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
  return { id, name, description: "Local model (Ollama)" };
}

// ── Advanced Section ────────────────────────────────────
function AdvancedSection() {
  const engineConnected = useStore((s) => s.engineConnected);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const [restarting, setRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [diagnostics, setDiagnostics] = useState<readonly { name: string; passed: boolean; message: string }[]>([]);
  const [runningDiag, setRunningDiag] = useState(false);
  const [camoufoxAvailable, setCamoufoxAvailable] = useState<boolean | null>(null);

  // Model Updates state
  const [installedModels, setInstalledModels] = useState<readonly string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullMessage, setPullMessage] = useState("");
  // Recommended models — fetched from daemon `models.recommended` RPC so
  // a new entry in auto-update.ts surfaces here without a Desktop edit.
  const [recommendedModels, setRecommendedModels] = useState<readonly RecommendedModel[]>([]);

  // Fetch recommended models from daemon on mount.
  useEffect(() => {
    let cancelled = false;
    async function loadRecommended() {
      try {
        const { commands } = await import("../../hooks/useTauriCommand");
        const response = await commands.rpcCall("models.recommended");
        if (cancelled) return;
        const ids = Array.isArray((response as { models?: unknown }).models)
          ? ((response as { models: unknown[] }).models.filter(
              (x): x is string => typeof x === "string",
            ))
          : [];
        setRecommendedModels(ids.map(decorateModel));
      } catch {
        if (!cancelled) setRecommendedModels([]);
      }
    }
    loadRecommended();
    return () => { cancelled = true; };
  }, []);

  // Derive installed Ollama models from providers store data
  const ollamaProvider = providers.find((p) => p.id === "ollama");
  const ollamaModelIds = ollamaProvider?.models.map((m) => m.id) ?? [];

  // Check Camoufox availability on mount
  useEffect(() => {
    let cancelled = false;
    async function checkCamoufox() {
      try {
        const { commands: cmds } = await import("../../hooks/useTauriCommand");
        const result = await cmds.getCamoufoxStatus();
        if (!cancelled) setCamoufoxAvailable(result.available);
      } catch {
        if (!cancelled) setCamoufoxAvailable(false);
      }
    }
    checkCamoufox();
    return () => { cancelled = true; };
  }, []);

  const checkForModels = async () => {
    setLoadingModels(true);
    try {
      const { commands } = await import("../../hooks/useTauriCommand");
      const models = await commands.listOllamaModels();
      setInstalledModels(models);
    } catch {
      // Use provider store data as fallback
      setInstalledModels(ollamaModelIds);
    } finally {
      setLoadingModels(false);
    }
  };

  const handlePullModel = async (modelId: string) => {
    setPullingModel(modelId);
    setPullMessage(`Pulling ${modelId}...`);
    try {
      const { commands } = await import("../../hooks/useTauriCommand");
      const result = await commands.pullOllamaModel(modelId);
      setPullMessage(result || `${modelId} installed successfully`);
      // Refresh model list
      await checkForModels();
    } catch (e) {
      setPullMessage(`Failed to pull ${modelId}: ${String(e)}`);
    } finally {
      setPullingModel(null);
      setTimeout(() => setPullMessage(""), 5000);
    }
  };

  // Combine installed from both sources
  const allInstalled = [...new Set([...installedModels, ...ollamaModelIds])];
  const notInstalled = recommendedModels.filter(
    (m) => !allInstalled.some((installed) => installed.includes(m.id.split(":")[0] ?? "")),
  );

  const handleRestart = async () => {
    setRestarting(true);
    setRestartMessage("Stopping engine...");
    try {
      await stopEngine();
      setRestartMessage("Starting engine...");
      await startEngine();
      setRestartMessage("Reconnecting...");
      await initializeFromEngine();
      setRestartMessage("Engine restarted successfully");
    } catch (e) {
      setRestartMessage(`Restart failed: ${String(e)}`);
    } finally {
      setRestarting(false);
      setTimeout(() => setRestartMessage(""), 5000);
    }
  };

  const handleDiagnostics = async () => {
    setRunningDiag(true);
    try {
      const results = await runDoctor();
      setDiagnostics(results?.map((r) => ({ name: r.name ?? "Check", passed: r.status === "ok" || r.status === "pass", message: r.detail ?? "" })) ?? []);
    } catch {
      setDiagnostics([{ name: "Error", passed: false, message: "Failed to run diagnostics" }]);
    } finally {
      setRunningDiag(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Engine Controls */}
      <div>
        <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)", marginBottom: "var(--space-sm)" }}>
          Engine Controls
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between card-surface" style={{ padding: "var(--space-md)" }}>
            <div>
              <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>KAIROS Daemon</div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: engineConnected ? "var(--green)" : "var(--red)",
                    boxShadow: engineConnected ? "0 0 6px rgba(74,222,128,0.4)" : "none",
                  }}
                />
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                  {engineConnected ? "Running" : "Not running"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRestart}
                disabled={restarting}
                className="btn-secondary"
                style={{ fontSize: "var(--font-size-xs)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
              >
                {restarting ? (
                  <ValknutSpinner size={12} color="var(--color-primary)" label="Restarting" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2 8a6 6 0 0110.89-3.48M14 8a6 6 0 01-10.89 3.48M14 2v4h-4M2 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {restarting ? "Restarting..." : "Restart Engine"}
              </button>
            </div>
          </div>
          {restartMessage && (
            <p style={{ fontSize: "var(--font-size-xs)", color: restartMessage.includes("fail") ? "var(--red)" : "var(--green)", padding: "0 var(--space-md)" }}>
              {restartMessage}
            </p>
          )}
        </div>
      </div>

      {/* Diagnostics */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: "var(--space-sm)" }}>
          <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
            Diagnostics
          </p>
          <button
            onClick={handleDiagnostics}
            disabled={runningDiag}
            className="btn-pill"
            style={{ fontSize: "var(--font-size-2xs)" }}
          >
            {runningDiag ? "Running..." : "Run Health Check"}
          </button>
        </div>
        {diagnostics.length > 0 && (
          <div className="space-y-1">
            {diagnostics.map((d) => (
              <div
                key={d.name}
                className="flex items-center justify-between"
                style={{ padding: "4px var(--space-sm)", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}
              >
                <span className="flex items-center gap-2">
                  <span style={{ color: d.passed ? "var(--green)" : "var(--red)" }}>{d.passed ? "PASS" : "FAIL"}</span>
                  {d.name}
                </span>
                {d.message && <span style={{ color: "var(--color-text-dim)", fontSize: "var(--font-size-2xs)" }}>{d.message}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Model Updates */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: "var(--space-sm)" }}>
          <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
            Model Updates
          </p>
          <button
            onClick={checkForModels}
            disabled={loadingModels}
            className="btn-pill"
            style={{ fontSize: "var(--font-size-2xs)" }}
          >
            {loadingModels ? "Checking..." : "Check for Updates"}
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
          Manage local Ollama models. Installed models are available for offline use.
        </p>

        {/* Currently installed models */}
        {allInstalled.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>Installed</p>
            <div className="flex flex-wrap gap-1.5">
              {allInstalled.map((modelId) => (
                <span
                  key={modelId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
                  style={{ fontSize: "var(--font-size-2xs)", background: "var(--surface-2)", color: "var(--color-text-secondary)", border: "none", boxShadow: "var(--shadow-ring)" }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", flexShrink: 0 }} />
                  {modelId}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Recommended models not yet installed */}
        {notInstalled.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>Recommended</p>
            {notInstalled.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between card-surface"
                style={{ padding: "10px 12px" }}
              >
                <div className="flex-1 min-w-0 mr-3">
                  <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {model.name}
                  </div>
                  <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginTop: 2 }}>
                    {model.description}
                  </div>
                </div>
                <button
                  onClick={() => handlePullModel(model.id)}
                  disabled={pullingModel !== null}
                  className="btn-secondary"
                  style={{
                    fontSize: "var(--font-size-xs)",
                    padding: "4px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  {pullingModel === model.id ? (
                    <ValknutSpinner
                      size={10}
                      color="var(--color-primary)"
                      label={`Pulling ${model.id}`}
                    />
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M8 2v8M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  )}
                  {pullingModel === model.id ? "Pulling..." : "Pull"}
                </button>
              </div>
            ))}
          </div>
        )}

        {allInstalled.length === 0 && notInstalled.length === 0 && !loadingModels && (
          <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Click "Check for Updates" to scan available models.
          </p>
        )}

        {pullMessage && (
          <p
            className="mt-2"
            style={{
              fontSize: "var(--font-size-xs)",
              color: pullMessage.includes("Failed") ? "var(--red)" : "var(--green)",
              padding: "0 var(--space-sm)",
            }}
          >
            {pullMessage}
          </p>
        )}
      </div>

      {/* Stealth Browsing (Camoufox) */}
      <div>
        <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)", marginBottom: "var(--space-sm)" }}>
          Stealth Browsing
        </p>
        <div className="card-surface" style={{ padding: "var(--space-md)" }}>
          <SettingRow
            label="Stealth Browsing (Camoufox)"
            description="Use anti-detect browser for web tasks. Requires camoufox Python package."
          >
            <div className="flex items-center gap-3">
              {camoufoxAvailable !== null && (
                <span
                  className="flex items-center gap-1.5"
                  style={{ fontSize: "var(--font-size-2xs)", color: camoufoxAvailable ? "var(--green)" : "var(--color-text-dim)" }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: camoufoxAvailable ? "var(--green)" : "var(--color-text-dim)",
                      flexShrink: 0,
                    }}
                  />
                  {camoufoxAvailable ? "Installed" : "Not installed"}
                </span>
              )}
              <Toggle
                checked={(settings as unknown as Record<string, unknown>)["stealthBrowsing"] as boolean ?? false}
                onChange={(v) => updateSetting("stealthBrowsing" as keyof typeof settings, v as never)}
              />
            </div>
          </SettingRow>
          {!camoufoxAvailable && camoufoxAvailable !== null && (
            <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", marginTop: "var(--space-xs)" }}>
              Install with: pip install camoufox &amp;&amp; python -m camoufox fetch
            </p>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div>
        <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--red)", marginBottom: "var(--space-sm)" }}>
          Danger Zone
        </p>
        <div className="card-surface space-y-3" style={{ padding: "var(--space-md)", boxShadow: "0px 0px 0px 1px rgba(var(--red-rgb), 0.2)" }}>
          <SettingRow label="Reset onboarding" description="Re-run the first-launch setup wizard">
            <button
              onClick={() => { localStorage.removeItem("wotann-onboarding-complete"); window.location.reload(); }}
              className="btn-danger"
              style={{ fontSize: "var(--font-size-xs)", padding: "4px 12px" }}
            >
              Reset
            </button>
          </SettingRow>
          <SettingRow label="Clear all data" description="Delete memory database, settings, and conversation history">
            <button
              onClick={() => setShowClearConfirm(true)}
              className="btn-danger"
              style={{ fontSize: "var(--font-size-xs)", padding: "4px 12px" }}
            >
              Clear All
            </button>
          </SettingRow>
          {/* PHASE C — GDPR Article 20 + 17. Calls the daemon directly via
              the new generic Tauri rpc_call bridge — no clipboard hack. */}
          <SettingRow label="Export My Data (GDPR Article 20)" description="Bundles ~/.wotann (memory, settings, conversations) into a tar.gz on the desktop.">
            <button
              onClick={async () => {
                try {
                  const result = (await commands.rpcCall("gdpr.export")) as
                    | { path?: string }
                    | null;
                  alert(
                    result?.path
                      ? `Exported to: ${result.path}`
                      : "Export started — check ~/.wotann/exports/ for the bundle.",
                  );
                } catch (err) {
                  alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              style={{ fontSize: "var(--font-size-xs)", padding: "4px 12px", borderRadius: "var(--radius-md)", background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--color-text-secondary)", cursor: "pointer" }}
            >
              Export Now
            </button>
          </SettingRow>
          <SettingRow label="Delete Everything (GDPR Article 17)" description="Wipes ~/.wotann (memory, cache, credentials). No recovery. Run Export first if you want a backup.">
            <button
              onClick={async () => {
                if (!confirm("Permanently delete ~/.wotann? This is irreversible.")) return;
                try {
                  await commands.rpcCall("gdpr.delete", { confirm: true });
                  alert("Deleted. Restart WOTANN to re-initialise from scratch.");
                } catch (err) {
                  alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              className="btn-danger"
              style={{ fontSize: "var(--font-size-xs)", padding: "4px 12px" }}
            >
              Delete Now
            </button>
          </SettingRow>
          <SettingRow label="Trusted Workspaces" description="View and manage which workspaces have command-execution trust on the daemon.">
            <button
              onClick={async () => {
                try {
                  const result = (await commands.rpcCall("workspace.trust.list")) as
                    | { workspaces?: { path: string; trustedAt: number }[] }
                    | null;
                  const list = result?.workspaces ?? [];
                  alert(
                    list.length === 0
                      ? "No trusted workspaces yet. Use the CLI to add one: wotann trust <path>"
                      : `Trusted workspaces:\n${list.map((w) => "• " + w.path).join("\n")}`,
                  );
                } catch (err) {
                  alert(`Failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              style={{ fontSize: "var(--font-size-xs)", padding: "4px 12px", borderRadius: "var(--radius-md)", background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--color-text-secondary)", cursor: "pointer" }}
            >
              View List
            </button>
          </SettingRow>
        </div>
      </div>

      {/* Version Info */}
      <div style={{ paddingTop: "var(--space-md)", borderTop: "1px solid var(--border-subtle)" }}>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>WOTANN Desktop v0.1.0</p>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginTop: 4 }}>
          Tauri v2 · React 19 · Tailwind v4 · Zustand 4
        </p>
        <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-ghost)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
          wotann.com
        </p>
      </div>

      {/* Clear data confirmation modal */}
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowClearConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm clear all data"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-xl)",
              padding: "var(--space-lg)",
              maxWidth: 400,
              width: "90%",
              boxShadow: "var(--shadow-xl, 0 8px 32px rgba(0,0,0,0.4))",
            }}
          >
            <h3 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-sm)" }}>
              Clear All Data?
            </h3>
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", marginBottom: "var(--space-lg)", lineHeight: 1.5 }}>
              This will permanently delete your memory database, settings, conversation history, and all WOTANN data. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{ padding: "8px 16px", borderRadius: "var(--radius-md)", background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--color-text-secondary)", fontSize: "var(--font-size-sm)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowClearConfirm(false);
                  const { commands: cmds } = await import("../../hooks/useTauriCommand");
                  await cmds.clearMemory();
                  localStorage.clear();
                  window.location.reload();
                }}
                className="btn-danger"
                style={{ padding: "8px 16px", borderRadius: "var(--radius-md)", fontSize: "var(--font-size-sm)" }}
              >
                Delete Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
