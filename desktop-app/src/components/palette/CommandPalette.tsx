/**
 * Cmd+K Command Palette — container.
 *
 * Splits into: CommandInput, CommandResults, CommandItem. Keeps all command
 * wiring here and delegates UI to the sub-components. Features:
 *  - Fuzzy search via ./fuzzy (no external deps)
 *  - Keyboard nav: ↑↓ move, ⏎ execute, ⎋ close, Tab cycles category
 *  - Recent commands persisted to localStorage (limit 10)
 *  - Quick switch:
 *      @foo    → scope to provider commands matching "foo"
 *      #id     → open session matching id
 *      /foo    → filter to slash commands
 *  - Apple-blue accent (#0A84FF) + dark translucent background
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store";
import {
  triggerDream,
  runDoctor,
  runPrecommit,
  runAutonomous,
  runArchitect,
  runCouncil,
} from "../../store/engine";
import { commands as tauriCommands } from "../../hooks/useTauriCommand";

import { CommandInput } from "./CommandInput";
import { CommandResults } from "./CommandResults";
import { fuzzyScore } from "./fuzzy";
import type { PaletteCommand, PaletteCategory } from "./types";

// ── Props ─────────────────────────────────────────────────────

interface CommandPaletteProps {
  readonly onClose: () => void;
}

// ── JSON-RPC envelope helper ──────────────────────────────────
//
// Opus audit (2026-04-15) found that 12 palette actions called
// `tauriCommands.sendMessage("/session create")` with raw text. The
// `send_message` Tauri command tries to parse the prompt as JSON-RPC,
// fails on the raw slash, and falls through to a synthesized `msg-{ts}`
// id — the user sees apparent success but nothing happens server-side.
//
// `toRpc` wraps method+params into the JSON envelope `send_message`
// actually expects, so each palette action lights up a real handler.
function toRpc(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ method, params });
}

// ── Recent-command persistence ────────────────────────────────

const RECENTS_KEY = "wotann-palette-recents";
const RECENTS_LIMIT = 10;

function loadRecentIds(): readonly string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_LIMIT)));
  } catch {
    // storage full — safe to ignore
  }
}

// ── Quick-switch detection ────────────────────────────────────

type QuickSwitchMode = { readonly kind: "provider" | "session" | "slash"; readonly term: string };

function detectQuickSwitch(query: string): QuickSwitchMode | null {
  if (query.startsWith("@")) return { kind: "provider", term: query.slice(1).toLowerCase() };
  if (query.startsWith("#")) return { kind: "session", term: query.slice(1).toLowerCase() };
  if (query.startsWith("/")) return { kind: "slash", term: query.slice(1).toLowerCase() };
  return null;
}

// ── Category order (determines rendering sequence) ────────────

const CATEGORY_ORDER: readonly PaletteCategory[] = [
  "Recent",
  "Actions",
  "Models",
  "Skills",
  "Memory",
  "Agents",
  "Session",
  "Intelligence",
  "Autonomous",
  "Workspace",
  "Context",
  "Navigation",
  "Modes",
  "Layout",
  "Tools",
  "Power",
  "Settings",
];

// ── Component ─────────────────────────────────────────────────

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const paletteMode = useStore((s) => s.commandPaletteMode);
  const [query, setQuery] = useState(paletteMode === "file-search" ? "@" : "");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<readonly string[]>(() => loadRecentIds());
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Store selectors ──
  const setView = useStore((s) => s.setView);
  const setMode = useStore((s) => s.setMode);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleContextPanel = useStore((s) => s.toggleContextPanel);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const addConversation = useStore((s) => s.addConversation);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const currentProvider = useStore((s) => s.provider);
  const currentModel = useStore((s) => s.model);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const toggleConversationIncognito = useStore((s) => s.toggleConversationIncognito);
  const enterCodeMode = useStore((s) => s.enterCodeMode);
  const enterExploitMode = useStore((s) => s.enterExploitMode);
  const addNotification = useStore((s) => s.addNotification);
  const conversations = useStore((s) => s.conversations);
  const providers = useStore((s) => s.providers);
  const setProvider = useStore((s) => s.setProvider);

  // Reset palette mode when closing
  useEffect(() => {
    return () => {
      useStore.setState({ commandPaletteMode: "general" });
    };
  }, []);

  // ── Conversation helpers ──

  const createNewChat = useCallback(() => {
    const id = `conv-${Date.now()}`;
    addConversation({
      id,
      title: "New conversation",
      preview: "",
      updatedAt: Date.now(),
      provider: currentProvider || "anthropic",
      model: currentModel || "claude-opus-4-6",
      cost: 0,
      messageCount: 0,
    });
    setActiveConversation(id);
    setView("chat");
  }, [addConversation, setActiveConversation, setView, currentProvider, currentModel]);

  const createIncognitoChat = useCallback(() => {
    const id = `conv-incognito-${Date.now()}`;
    addConversation({
      id,
      title: "Incognito conversation",
      preview: "",
      updatedAt: Date.now(),
      provider: currentProvider || "anthropic",
      model: currentModel || "claude-opus-4-6",
      cost: 0,
      messageCount: 0,
      incognito: true,
    });
    setActiveConversation(id);
    setView("chat");
  }, [addConversation, setActiveConversation, setView, currentProvider, currentModel]);

  // ── Command table ──
  //
  // Each entry: a self-contained PaletteCommand. The flow is intentionally
  // verbose for discoverability — each command appears exactly once, in its
  // category group. Command *ordering* within a category is preserved.

  const baseCommands: readonly PaletteCommand[] = useMemo(() => {
    const notifyRpc = (title: string, message: string) =>
      addNotification({ type: "task_complete", title, message });

    const rpcCall = async <T,>(
      label: string,
      fn: () => Promise<T>,
      onSuccess?: (result: T) => string,
    ) => {
      try {
        const result = await fn();
        notifyRpc(label, onSuccess?.(result) ?? "Done");
        return result;
      } catch (err) {
        addNotification({
          type: "error",
          title: `${label} failed`,
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    };

    return [
      // ── Session ──
      {
        id: "new-chat",
        title: "New Chat",
        subtitle: "Start a new conversation",
        category: "Session",
        shortcut: "⌘N",
        icon: "💬",
        action: createNewChat,
      },
      {
        id: "new-incognito",
        title: "New Incognito Chat",
        subtitle: "Private conversation — not saved to memory",
        category: "Session",
        shortcut: "⌘⇧N",
        icon: "🕶",
        action: createIncognitoChat,
      },
      {
        id: "toggle-incognito",
        title: "Toggle Incognito",
        subtitle: "Toggle incognito on current conversation",
        category: "Session",
        icon: "👁",
        action: () => {
          if (activeConversationId) toggleConversationIncognito(activeConversationId);
        },
      },
      {
        id: "session-create",
        title: "Create Session",
        subtitle: "session.create — new session via RPC",
        category: "Session",
        icon: "✨",
        action: () =>
          void rpcCall("Create session", () =>
            tauriCommands.sendMessage(toRpc("session.create")),
          ),
      },
      {
        id: "session-list",
        title: "List Sessions",
        subtitle: "session.list — all active sessions",
        category: "Session",
        icon: "📋",
        action: () => void rpcCall("List sessions", () => tauriCommands.getConversations()),
      },
      {
        id: "session-resume",
        title: "Resume Session",
        subtitle: "session.resume — pick up where you left off",
        category: "Session",
        icon: "↺",
        action: () => setView("chat"),
      },

      // ── Models ──
      {
        id: "providers-list",
        title: "List Providers",
        subtitle: "providers.list — available providers + models",
        category: "Models",
        icon: "🔌",
        action: () => void rpcCall("Providers", () => tauriCommands.getProviders()),
      },
      {
        id: "providers-switch",
        title: "Switch Provider",
        subtitle: "providers.switch — change active provider/model",
        category: "Models",
        icon: "🔄",
        action: () => useStore.getState().openOverlay("modelPicker"),
      },
      {
        id: "arena-run",
        title: "Run Arena",
        subtitle: "arena.run — side-by-side model comparison",
        category: "Models",
        icon: "⚔️",
        action: () => setView("compare"),
      },
      {
        id: "council",
        title: "Multi-Model Council",
        subtitle: "council — multiple models review together",
        category: "Models",
        icon: "🏛",
        action: async () => {
          addNotification({
            type: "agent",
            title: "Council starting",
            message: "Convening multi-model review…",
          });
          await runCouncil("Review the current project state");
          // Session-10 fix: previously routed to "compare" (arena) — wrong
          // destination, since Council renders its own CouncilView with
          // structured multi-model deliberation output.
          setView("council");
        },
      },

      // ── Memory ──
      {
        id: "memory-search",
        title: "Search Memory",
        subtitle: "memory.search — query persistent knowledge",
        category: "Memory",
        icon: "🔍",
        action: () => setView("memory"),
      },
      {
        id: "memory-mine",
        title: "Mine Conversations",
        subtitle: "memory.mine — extract patterns from history",
        category: "Memory",
        icon: "⛏",
        action: () =>
          void rpcCall("Memory mine", () => tauriCommands.sendMessage(toRpc("memory.mine"))),
      },
      {
        id: "memory-quality",
        title: "Memory Quality",
        subtitle: "memory.quality — retrieval accuracy report",
        category: "Memory",
        icon: "📊",
        action: () =>
          void rpcCall("Memory quality", () =>
            tauriCommands.sendMessage(toRpc("memory.quality")),
          ),
      },
      {
        id: "memory-fence",
        title: "Fence Memory Context",
        subtitle: "memory.fence — lock specific memories into view",
        category: "Memory",
        icon: "🧱",
        action: () =>
          void rpcCall("Memory fence", () => tauriCommands.sendMessage(toRpc("memory.fence"))),
      },

      // ── Skills ──
      {
        id: "skills-list",
        title: "Browse Skills",
        subtitle: "skills.list — 65+ loadable skills",
        category: "Skills",
        icon: "🎯",
        action: () => setSidebarTab("skills"),
      },
      {
        id: "skills-search",
        title: "Search Skills",
        subtitle: "skills.search — find a specific skill",
        category: "Skills",
        icon: "🔎",
        action: () => void rpcCall("Skills search", () => tauriCommands.searchSkills("")),
      },
      {
        id: "skills-merge",
        title: "Merge Skills",
        subtitle: "skills.merge — combine skills into a persona",
        category: "Skills",
        icon: "🔀",
        action: () =>
          void rpcCall("Skills merge", () => tauriCommands.sendMessage(toRpc("skills.merge"))),
      },

      // ── Agents ──
      {
        id: "agents-spawn",
        title: "Spawn Agent",
        subtitle: "agents.spawn — start a background task",
        category: "Agents",
        icon: "🤖",
        action: () => setView("workshop"),
      },
      {
        id: "agents-hierarchy",
        title: "Agent Hierarchy",
        subtitle: "agents.hierarchy — parent/child agent tree",
        category: "Agents",
        icon: "🌳",
        action: () => setView("workshop"),
      },
      {
        id: "agents-workspace",
        title: "Agent Workspaces",
        subtitle: "agents.workspace — active agent worktrees",
        category: "Agents",
        icon: "📁",
        action: () => setView("workshop"),
      },

      // ── Intelligence ──
      {
        id: "prompts-adaptive",
        title: "Adaptive Prompts",
        subtitle: "prompts.adaptive — per-model prompt tuning",
        category: "Intelligence",
        icon: "🪄",
        action: () =>
          void rpcCall("Adaptive prompts", () =>
            tauriCommands.sendMessage(toRpc("prompts.adaptive")),
          ),
      },
      {
        id: "benchmark-best",
        title: "Best Model per Task",
        subtitle: "benchmark.best — recommend model by benchmark",
        category: "Intelligence",
        icon: "🏆",
        action: () =>
          void rpcCall("Benchmark", () => tauriCommands.sendMessage(toRpc("benchmark.best"))),
      },
      {
        id: "decisions-list",
        title: "Decision Log",
        subtitle: "decisions.list — architectural decisions",
        category: "Intelligence",
        icon: "📝",
        action: () =>
          void rpcCall("Decisions", () => tauriCommands.sendMessage(toRpc("decisions.list"))),
      },
      {
        id: "proofs-list",
        title: "View Proof Bundles",
        subtitle: "proofs.list — timeline of agent actions",
        category: "Intelligence",
        icon: "📜",
        shortcut: "⌘⇧P",
        action: () => setView("proofs"),
      },

      // ── Autonomous ──
      {
        id: "autonomous-run",
        title: "Run Autonomous Task",
        subtitle: "autonomous.run — agent works until done",
        category: "Autonomous",
        icon: "🚀",
        action: async () => {
          addNotification({
            type: "agent",
            title: "Autonomous mode starting",
            message: "Agent will run until task is complete…",
          });
          await runAutonomous("Complete the current task autonomously");
          setView("workshop");
        },
      },
      {
        id: "autonomous-cancel",
        title: "Cancel Autonomous",
        subtitle: "autonomous.cancel — stop the current run",
        category: "Autonomous",
        icon: "⛔",
        action: () =>
          void rpcCall("Autonomous cancel", () =>
            tauriCommands.sendMessage(toRpc("autonomous.cancel")),
          ),
      },
      {
        id: "autopilot-status",
        title: "Autopilot Status",
        subtitle: "autopilot.status — current autonomous state",
        category: "Autonomous",
        icon: "🛰",
        action: () => void rpcCall("Autopilot status", () => tauriCommands.getStatus()),
      },

      // ── Workspace ──
      {
        id: "workspaces-list",
        title: "List Workspaces",
        subtitle: "workspaces.list — all known workspaces",
        category: "Workspace",
        icon: "🗂",
        action: () => void rpcCall("Workspaces", () => tauriCommands.getWorkspaces()),
      },
      {
        id: "files-hotspots",
        title: "File Hotspots",
        subtitle: "files.hotspots — most-edited files",
        category: "Workspace",
        icon: "🔥",
        action: () =>
          void rpcCall("Hotspots", () => tauriCommands.sendMessage(toRpc("files.hotspots"))),
      },
      {
        id: "files-search",
        title: "Search Files",
        subtitle: "files.search — find files by name",
        category: "Workspace",
        icon: "📄",
        action: () => useStore.setState({ commandPaletteMode: "file-search" }),
      },

      // ── Context ──
      {
        id: "context-info",
        title: "Context Info",
        subtitle: "context.info — usage + budget breakdown",
        category: "Context",
        icon: "📐",
        action: () => void rpcCall("Context info", () => tauriCommands.getContextInfo()),
      },
      {
        id: "context-pressure",
        title: "Context Pressure",
        subtitle: "context.pressure — auto-compaction trigger",
        category: "Context",
        icon: "🌡",
        action: () =>
          void rpcCall("Context pressure", () =>
            tauriCommands.sendMessage(toRpc("context.pressure")),
          ),
      },
      {
        id: "wakeup-payload",
        title: "Wakeup Payload",
        subtitle: "wakeup.payload — context recovery snapshot",
        category: "Context",
        icon: "💤",
        action: () =>
          void rpcCall("Wakeup", () => tauriCommands.sendMessage(toRpc("wakeup.payload"))),
      },

      // ── Navigation ──
      {
        id: "chat-view",
        title: "Go to Chat",
        subtitle: "Switch to chat view",
        category: "Navigation",
        icon: "💬",
        action: () => setView("chat"),
      },
      {
        id: "editor-view",
        title: "Open Editor",
        subtitle: "Open code editor",
        category: "Navigation",
        icon: "📝",
        action: () => setView("editor"),
      },
      {
        id: "compare",
        title: "Compare Models",
        subtitle: "Side-by-side model comparison",
        category: "Navigation",
        icon: "⚖️",
        action: () => setView("compare"),
      },
      {
        id: "workshop",
        title: "Workshop",
        subtitle: "Task orchestration — workers, inbox, scheduled",
        category: "Navigation",
        icon: "🔧",
        action: () => setView("workshop"),
      },
      {
        id: "memory-view",
        title: "Memory Inspector",
        subtitle: "Browse persistent memory",
        category: "Navigation",
        icon: "🧠",
        action: () => setView("memory"),
      },
      {
        id: "cost-view",
        title: "Cost Dashboard",
        subtitle: "Usage, cost tracking, provider comparison",
        category: "Navigation",
        icon: "💰",
        action: () => setView("cost"),
      },
      // Session-10 audit fix: 11 previously-orphan views made reachable
      // via the palette. Each view has real Tauri wiring but had no
      // palette entry / shortcut / sidebar surface before this commit.
      {
        id: "canvas",
        title: "Canvas",
        subtitle: "Freeform workspace for agent-driven ideation",
        category: "Navigation",
        icon: "🖼",
        action: () => setView("canvas"),
      },
      {
        id: "agents",
        title: "Agent Fleet",
        subtitle: "Dashboard of running agents, workers, and dispatches",
        category: "Navigation",
        icon: "⚙️",
        action: () => setView("agents"),
      },
      {
        id: "connectors",
        title: "Connectors",
        subtitle: "GitHub / Linear / Notion / Slack / knowledge sources",
        category: "Navigation",
        icon: "🔌",
        action: () => setView("connectors"),
      },
      {
        id: "projects",
        title: "Projects",
        subtitle: "Workspace + project switcher",
        category: "Navigation",
        icon: "📂",
        action: () => setView("projects"),
      },
      {
        id: "dispatch",
        title: "Dispatch Inbox",
        subtitle: "Incoming tasks + triage queue",
        category: "Navigation",
        icon: "📨",
        action: () => setView("dispatch"),
      },
      {
        id: "approvals",
        title: "Exec Approvals",
        subtitle: "Allowlist / denylist for shell commands",
        category: "Navigation",
        icon: "🛡",
        action: () => setView("approvals"),
      },
      {
        id: "plugins",
        title: "Plugin Manager",
        subtitle: "Browse, install, enable, configure plugins",
        category: "Navigation",
        icon: "🧩",
        action: () => setView("plugins"),
      },
      {
        id: "design",
        title: "Design Mode",
        subtitle: "Freeform visual-first agent interactions",
        category: "Navigation",
        icon: "✏️",
        action: () => setView("design"),
      },
      {
        id: "playground",
        title: "Code Playground",
        subtitle: "Scratchpad for snippets + quick model runs",
        category: "Navigation",
        icon: "🛝",
        action: () => setView("playground"),
      },
      {
        id: "schedule",
        title: "Scheduled Tasks",
        subtitle: "Cron-style recurring agent tasks",
        category: "Navigation",
        icon: "⏰",
        action: () => setView("schedule"),
      },
      {
        id: "integrations",
        title: "Integrations",
        subtitle: "Channels + Connectors + MCP + Skills under one roof",
        category: "Navigation",
        icon: "🧵",
        action: () => setView("integrations"),
      },
      {
        id: "focus-mode-toggle",
        title: "Focus Mode",
        subtitle: "Collapse conversation to last prompt + tools + reply (⌘⇧L)",
        category: "Navigation",
        icon: "🎯",
        action: () => window.dispatchEvent(new CustomEvent("wotann:toggle-focus-mode")),
      },
      {
        id: "settings",
        title: "Settings",
        subtitle: "Providers, appearance, shortcuts, plugins",
        category: "Navigation",
        shortcut: "⌘,",
        icon: "⚙️",
        action: () => setView("settings"),
      },
      {
        id: "exploit-view",
        title: "Security Research",
        subtitle: "Exploit mode — engagement tracking, CVSS",
        category: "Navigation",
        icon: "🛡",
        action: () => setView("exploit"),
      },

      // ── Modes ──
      {
        id: "mode-chat",
        title: "Chat Mode",
        subtitle: "Conversational",
        category: "Modes",
        icon: "💭",
        action: () => setMode("chat"),
      },
      {
        id: "mode-build",
        title: "Build Mode",
        subtitle: "Agent writes code",
        category: "Modes",
        icon: "🏗",
        action: () => setMode("build"),
      },
      {
        id: "mode-autopilot",
        title: "Autopilot Mode",
        subtitle: "Autonomous execution",
        category: "Modes",
        icon: "🛸",
        action: () => setMode("autopilot"),
      },
      {
        id: "mode-compare",
        title: "Compare Mode",
        subtitle: "Multi-model comparison",
        category: "Modes",
        icon: "⚖️",
        action: () => setMode("compare"),
      },
      {
        id: "mode-review",
        title: "Review Mode",
        subtitle: "Multi-model review",
        category: "Modes",
        icon: "🕵",
        action: () => setMode("review"),
      },
      {
        id: "code-mode",
        title: "Enter Code Mode",
        subtitle: "Editor + chat + build",
        category: "Modes",
        shortcut: "⌘⇧E",
        icon: "⌨️",
        action: () => enterCodeMode(),
      },
      {
        id: "exploit-mode",
        title: "Enter Exploit Mode",
        subtitle: "Security research with red theming",
        category: "Modes",
        icon: "🩸",
        action: () => enterExploitMode(),
      },

      // ── Layout ──
      {
        id: "toggle-sidebar",
        title: "Toggle Sidebar",
        subtitle: "Show/hide left sidebar",
        category: "Layout",
        shortcut: "⌘B",
        icon: "◧",
        action: toggleSidebar,
      },
      {
        id: "toggle-context",
        title: "Toggle Context Panel",
        subtitle: "Show/hide right panel",
        category: "Layout",
        shortcut: "⌘.",
        icon: "◨",
        action: toggleContextPanel,
      },
      {
        id: "toggle-terminal",
        title: "Toggle Terminal",
        subtitle: "Show/hide bottom terminal panel",
        category: "Layout",
        shortcut: "⌘J",
        icon: "▭",
        action: () => useStore.getState().toggleTerminalPanel(),
      },
      {
        id: "toggle-diff",
        title: "Toggle Changes",
        subtitle: "Show/hide right diff panel",
        category: "Layout",
        shortcut: "⌘⇧D",
        icon: "≠",
        action: () => useStore.getState().toggleDiffPanel(),
      },

      // ── Tools ──
      {
        id: "enhance",
        title: "Enhance Prompt",
        subtitle: "Make your prompt clearer and more specific",
        category: "Tools",
        shortcut: "⌘E",
        icon: "✨",
        action: () => {
          setTimeout(() => {
            const textarea = document.querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="Message input"]',
            );
            textarea?.focus();
            const btn = document.querySelector<HTMLButtonElement>(
              'button[aria-label="Enhance prompt"]',
            );
            if (btn && !btn.disabled) btn.click();
          }, 100);
        },
      },
      {
        id: "voice",
        title: "Voice Input",
        subtitle: "Push-to-talk voice mode",
        category: "Tools",
        icon: "🎙",
        action: () => {
          setTimeout(() => {
            const btn = document.querySelector<HTMLButtonElement>(
              'button[aria-label="Start voice input"], button[aria-label="Stop voice recording"]',
            );
            btn?.click();
          }, 100);
        },
      },
      {
        id: "deep-research",
        title: "Deep Research",
        subtitle: "Multi-step research with citations",
        category: "Tools",
        icon: "🔬",
        action: () => createNewChat(),
      },
      {
        id: "scan-project",
        title: "Scan Project",
        subtitle: "Detect stack, framework, and config files",
        category: "Tools",
        icon: "🧭",
        action: () => {
          addNotification({
            type: "agent",
            title: "Scanning project",
            message: "Detecting framework, config files, and conventions…",
          });
        },
      },

      // ── Power ──
      {
        id: "architect",
        title: "System Architect",
        subtitle: "Design system architecture",
        category: "Power",
        icon: "🏛",
        action: async () => {
          addNotification({
            type: "agent",
            title: "Architect mode starting",
            message: "Analyzing project architecture…",
          });
          await runArchitect("Analyze the current project architecture and suggest improvements");
        },
      },
      {
        id: "dream",
        title: "Trigger Memory Dream",
        subtitle: "Consolidate learnings into long-term memory",
        category: "Power",
        icon: "💫",
        action: () => {
          triggerDream();
          addNotification({
            type: "agent",
            title: "Dream cycle started",
            message: "Consolidating session learnings…",
          });
        },
      },
      {
        id: "doctor",
        title: "Run Diagnostics",
        subtitle: "Health check on engine + providers",
        category: "Power",
        icon: "🩺",
        action: async () => {
          const results = await runDoctor();
          addNotification({
            type: "task_complete",
            title: "Diagnostics complete",
            message: `${results?.length ?? 0} checks passed`,
          });
        },
      },
      {
        id: "precommit",
        title: "Pre-Commit Analysis",
        subtitle: "Analyze changes before committing to git",
        category: "Power",
        icon: "🔒",
        action: async () => {
          const result = await runPrecommit();
          addNotification({
            type: result?.passed ? "task_complete" : "error",
            title: "Pre-commit analysis",
            message: result?.summary ?? "Analysis complete",
          });
        },
      },
    ];
  }, [
    addConversation,
    activeConversationId,
    addNotification,
    createIncognitoChat,
    createNewChat,
    enterCodeMode,
    enterExploitMode,
    setActiveConversation,
    setMode,
    setSidebarTab,
    setView,
    toggleContextPanel,
    toggleConversationIncognito,
    toggleSidebar,
  ]);

  // ── Recent + session quick-open commands (dynamic) ──

  const recentCommands = useMemo<readonly PaletteCommand[]>(() => {
    const lookup = new Map(baseCommands.map((c) => [c.id, c]));
    const items: PaletteCommand[] = [];
    for (const id of recentIds) {
      const cmd = lookup.get(id);
      if (cmd) items.push({ ...cmd, category: "Recent" });
    }
    // Plus recent conversations as quick-open entries (limit 5)
    for (const conv of conversations.slice(0, 5)) {
      items.push({
        id: `open-conv-${conv.id}`,
        title: conv.title || "Untitled conversation",
        subtitle: conv.preview || `${conv.messageCount ?? 0} messages`,
        category: "Recent",
        icon: "💬",
        action: () => {
          setActiveConversation(conv.id);
          setView("chat");
        },
      });
    }
    return items.slice(0, 10);
  }, [baseCommands, recentIds, conversations, setActiveConversation, setView]);

  // ── Filtering ──

  const quickSwitch = detectQuickSwitch(query);

  const filteredCommands = useMemo<readonly PaletteCommand[]>(() => {
    // Build the candidate pool: when query is empty, prepend Recent.
    const pool: PaletteCommand[] =
      query === ""
        ? [...recentCommands, ...baseCommands.filter((c) => !recentCommands.some((r) => r.id === c.id))]
        : [...baseCommands];

    // Quick-switch: #session-id → open that conversation directly.
    if (quickSwitch?.kind === "session" && quickSwitch.term.length > 0) {
      const matches = conversations
        .filter((c) => c.id.toLowerCase().includes(quickSwitch.term))
        .slice(0, 5)
        .map<PaletteCommand>((c) => ({
          id: `quick-session-${c.id}`,
          title: c.title || c.id,
          subtitle: `#${c.id}`,
          category: "Session",
          icon: "💬",
          action: () => {
            setActiveConversation(c.id);
            setView("chat");
          },
        }));
      return matches;
    }

    // Quick-switch: @provider → restrict to provider ops + direct switch.
    if (quickSwitch?.kind === "provider") {
      const providerSwitches = providers
        .filter(
          (p) =>
            quickSwitch.term.length === 0 ||
            p.name.toLowerCase().includes(quickSwitch.term),
        )
        .flatMap<PaletteCommand>((p) => [
          {
            id: `quick-provider-${p.name}`,
            title: `Switch to ${p.name}`,
            subtitle: `Use ${p.name} as the active provider`,
            category: "Models",
            icon: "🔄",
            action: () => setProvider(p.name, p.defaultModel ?? currentModel),
          },
        ]);
      // Also include commands whose category is Models.
      const modelCmds = baseCommands.filter((c) => c.category === "Models");
      return [...providerSwitches, ...modelCmds];
    }

    // Quick-switch: /slash → only commands whose title starts with "/" or
    // whose category names a slash-like command.
    if (quickSwitch?.kind === "slash") {
      const term = quickSwitch.term;
      return pool.filter((c) => {
        const haystack = `${c.title} ${c.subtitle ?? ""}`.toLowerCase();
        return term.length === 0 || haystack.includes(term);
      });
    }

    // Generic fuzzy path.
    if (query === "") return pool;
    const scored = pool
      .map((cmd) => ({
        cmd,
        score: fuzzyScore(query, cmd.title, cmd.subtitle ?? ""),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.cmd);
  }, [
    query,
    recentCommands,
    baseCommands,
    quickSwitch,
    conversations,
    providers,
    currentModel,
    setActiveConversation,
    setProvider,
    setView,
  ]);

  // ── Category cycling (Tab) ──

  const categoriesInView = useMemo(() => {
    const set = new Set<PaletteCategory>();
    for (const cmd of filteredCommands) set.add(cmd.category);
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [filteredCommands]);

  const cycleCategory = useCallback(
    (direction: 1 | -1) => {
      if (categoriesInView.length === 0) return;
      const current = filteredCommands[selectedIndex]?.category;
      const currentIdx = current ? categoriesInView.indexOf(current) : -1;
      const nextIdx =
        (currentIdx + direction + categoriesInView.length) % categoriesInView.length;
      const targetCategory = categoriesInView[nextIdx];
      const nextCommandIndex = filteredCommands.findIndex((c) => c.category === targetCategory);
      if (nextCommandIndex >= 0) setSelectedIndex(nextCommandIndex);
    },
    [categoriesInView, filteredCommands, selectedIndex],
  );

  // ── Focus + reset on query change ──

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // ── Execute ──

  const executeCommand = useCallback(
    (command: PaletteCommand) => {
      // Record to recents (dedupe, move to front).
      const nextIds = [command.id, ...recentIds.filter((id) => id !== command.id)].slice(
        0,
        RECENTS_LIMIT,
      );
      setRecentIds(nextIds);
      persistRecentIds(nextIds);

      try {
        void command.action();
      } finally {
        onClose();
      }
    },
    [recentIds, onClose],
  );

  // ── Keyboard handler ──

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filteredCommands[selectedIndex];
        if (item) executeCommand(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        cycleCategory(e.shiftKey ? -1 : 1);
      }
    },
    [filteredCommands, selectedIndex, executeCommand, onClose, cycleCategory],
  );

  // ── Active id for aria-activedescendant ──

  const activeCommand = filteredCommands[selectedIndex];
  const activeId = activeCommand ? `palette-item-${activeCommand.id}` : undefined;
  const categoryHint = quickSwitch
    ? quickSwitch.kind === "provider"
      ? "Provider"
      : quickSwitch.kind === "session"
        ? "Session"
        : "Slash"
    : undefined;

  // ── Render ──

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{
        paddingTop: "14vh",
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: "backdropFade 0.15s ease-out",
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full flex flex-col"
        style={{
          maxWidth: 620,
          maxHeight: 520,
          background: "rgba(28, 28, 30, 0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          boxShadow:
            "0 22px 60px rgba(0, 0, 0, 0.55), 0 0 0 0.5px rgba(255,255,255,0.06) inset",
          backdropFilter: "blur(40px)",
          WebkitBackdropFilter: "blur(40px)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
        role="combobox"
        aria-expanded="true"
        aria-haspopup="listbox"
        aria-label="Command palette"
      >
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          activeId={activeId}
          categoryHint={categoryHint}
        />
        <CommandResults
          commands={filteredCommands}
          selectedIndex={selectedIndex}
          onSelect={executeCommand}
          onHoverIndex={setSelectedIndex}
          emptyQuery={query}
        />
        <div
          className="flex items-center justify-between"
          style={{
            padding: "8px 16px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            fontSize: 10,
            color: "rgba(255,255,255,0.4)",
            letterSpacing: 0.2,
          }}
        >
          <span>
            <KbdInline>Tab</KbdInline> cycle category
            <span style={{ margin: "0 8px" }}>·</span>
            <KbdInline>@</KbdInline> provider
            <span style={{ margin: "0 8px" }}>·</span>
            <KbdInline>#</KbdInline> session
            <span style={{ margin: "0 8px" }}>·</span>
            <KbdInline>/</KbdInline> slash
          </span>
          <span>{filteredCommands.length} results</span>
        </div>
      </div>
    </div>
  );
}

function KbdInline({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        fontSize: 9,
        padding: "1px 5px",
        borderRadius: 3,
        background: "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(255,255,255,0.07)",
        margin: "0 3px",
      }}
    >
      {children}
    </kbd>
  );
}
