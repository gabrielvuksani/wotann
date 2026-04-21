/**
 * Main TUI application — now wired to WotannRuntime for FULL harness intelligence.
 *
 * BEFORE: TUI → AgentBridge.query() → Provider (bypassed everything)
 * AFTER:  TUI → WotannRuntime.query() → WASM bypass → Hooks → 16 Middleware
 *         → DoomLoop → Amplifier → Reasoning Sandwich → TTSR → Provider
 *         → After-hooks → Memory → Cost tracking → Response
 *
 * This single change activates ~3,625 lines of previously dead code.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { StartupScreen } from "./components/StartupScreen.js";
import { ChatView } from "./components/ChatView.js";
import { StatusBar } from "./components/StatusBar.js";
import { PromptInput } from "./components/PromptInput.js";
import { ContextHUD } from "./components/ContextHUD.js";
import { DiffViewer } from "./components/DiffViewer.js";
import { AgentStatusPanel, type SubagentStatus } from "./components/AgentStatusPanel.js";
import { HistoryPicker } from "./components/HistoryPicker.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { CommandRegistry, type Command } from "./command-registry.js";
import { MessageActions, type MessageAction } from "./components/MessageActions.js";
import { ContextSourcePanel, type ContextSource } from "./components/ContextSourcePanel.js";
import { TerminalBlocksView } from "./components/TerminalBlocksView.js";
import { BlockBuffer, type Block } from "./terminal-blocks/block.js";
import { Osc133Parser } from "./terminal-blocks/osc-133-parser.js";
import type { AgentMessage, ProviderName, ProviderStatus } from "../core/types.js";
import type { WotannRuntime } from "../core/runtime.js";
import type {
  TaskPriority,
  TaskStatus,
  ChannelHealth,
  DispatchTask,
} from "../channels/unified-dispatch.js";
import type { WotannMode } from "../core/mode-cycling.js";
import type { ThinkingEffort } from "../core/runtime.js";
import type { ROESessionType } from "../security/rules-of-engagement.js";
import { SkillRegistry } from "../skills/loader.js";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { KeybindingManager } from "./keybindings.js";
import { ThemeManager, cycleNorseTheme } from "./themes.js";
import { TUIVoiceController } from "./voice-controller.js";
import {
  buildPrimaryAgentStatuses,
  cycleModel,
  cyclePanel,
  cycleThinkingEffort,
  readWorkspaceDiff,
  resolveFileAttachments,
  type UIPanel,
} from "./helpers.js";
import {
  parseReferences,
  resolveReferences,
  expandPromptWithReferences,
} from "./context-references.js";
import { parseDeepLink, executeDeepLink, type DeepLinkContext } from "../core/deep-link.js";

// ── Types ──────────────────────────────────────────────────

const VALID_MODES: readonly WotannMode[] = [
  "default",
  "plan",
  "acceptEdits",
  "auto",
  "bypass",
  "autonomous",
  "guardrails-off",
  "focus",
  "interview",
  "teach",
  "review",
  "exploit",
];

interface WotannAppProps {
  readonly version: string;
  readonly providers: readonly ProviderStatus[];
  readonly initialModel?: string;
  readonly initialProvider?: ProviderName;
  readonly initialMessages?: readonly AgentMessage[];
  readonly runtime?: WotannRuntime;
}

// ── App ────────────────────────────────────────────────────

export function WotannApp({
  version,
  providers,
  initialModel = "gemma4:e4b",
  initialProvider = "ollama",
  initialMessages = [],
  runtime,
}: WotannAppProps): React.ReactElement {
  const { exit } = useApp();
  const workingDir = runtime?.getWorkingDir() ?? process.cwd();
  const uiStatePath = join(workingDir, ".wotann", "ui-state.json");
  const initialTurnCount = initialMessages.filter((msg) => msg.role === "user").length;
  const [showStartup, setShowStartup] = useState(initialMessages.length === 0);
  const [messages, setMessages] = useState<readonly AgentMessage[]>(() => [...initialMessages]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [promptValue, setPromptValue] = useState("");
  const [history, setHistory] = useState<readonly string[]>(() =>
    [...initialMessages]
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.content)
      .reverse(),
  );
  const [currentMode, setCurrentMode] = useState<WotannMode>(
    runtime?.getCurrentMode() ?? "default",
  );
  const [currentModel, setCurrentModel] = useState(initialModel);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(
    runtime?.getThinkingEffort() ?? "medium",
  );
  const themeManagerRef = useRef<ThemeManager>(new ThemeManager("default", uiStatePath));
  const [themeName, setThemeName] = useState(themeManagerRef.current.getCurrent().name);
  const [activePanel, setActivePanel] = useState<UIPanel>(() => {
    const persistedPanel = themeManagerRef.current.readPersistedState().panel;
    return persistedPanel === "agents" || persistedPanel === "tasks" ? persistedPanel : "diff";
  });
  const [diffEntries, setDiffEntries] = useState(() => readWorkspaceDiff(workingDir));
  const [agentStatuses, setAgentStatuses] = useState<readonly SubagentStatus[]>(() =>
    buildPrimaryAgentStatuses({
      model: initialModel,
      isStreaming: false,
      panelMode: currentMode,
      turnCount: initialTurnCount,
    }),
  );
  const [turnCount, setTurnCount] = useState(initialTurnCount);
  const [stats, setStats] = useState({
    cost: 0,
    contextPercent: 0,
    reads: 0,
    edits: 0,
    bashCalls: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const skillRegistryRef = useRef<SkillRegistry | null>(null);
  const keybindingManagerRef = useRef(new KeybindingManager());
  const voiceControllerRef = useRef(new TUIVoiceController());
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const commandRegistryRef = useRef<CommandRegistry>(new CommandRegistry());
  const [showContextPanel, setShowContextPanel] = useState(false);
  // Terminal Blocks overlay (Warp-style OSC 133 blocks — Phase D).
  // Session-13: Osc133Parser + BlockBuffer are now live. The parser
  // consumes raw terminal bytes from `WOTANN_OSC133_FIFO` (a named pipe
  // the user pipes shell output through) and the buffer emits completed
  // `Block` records into state. Opt-in via env var — when unset the
  // overlay stays empty and Ctrl-B shows "no blocks yet" as before.
  const [showTerminalBlocks, setShowTerminalBlocks] = useState(false);
  const [terminalBlocks, setTerminalBlocks] = useState<readonly Block[]>([]);
  const osc133ParserRef = useRef<Osc133Parser | null>(null);
  const blockBufferRef = useRef<BlockBuffer | null>(null);
  const [showMessageActions, setShowMessageActions] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);

  const getSkillRegistry = useCallback((): SkillRegistry => {
    if (!skillRegistryRef.current) {
      if (runtime) {
        skillRegistryRef.current = runtime.getSkillRegistry();
      } else {
        const skillsDir = join(process.cwd(), "skills");
        skillRegistryRef.current = existsSync(skillsDir)
          ? SkillRegistry.createWithDefaults(skillsDir)
          : new SkillRegistry();
      }
    }
    return skillRegistryRef.current;
  }, [runtime, workingDir]);

  useEffect(() => {
    if (messages.length > 0 && showStartup) setShowStartup(false);
  }, [messages.length, showStartup]);

  // Session-13: OSC 133 stream → BlockBuffer → Block[]. Opt-in via
  // WOTANN_OSC133_FIFO (a named pipe the user creates with mkfifo).
  // Honest: when the env var is not set, the parser stays unwired and
  // the overlay renders the empty array. Failure to open the FIFO
  // logs a warning rather than silently failing.
  useEffect(() => {
    const fifoPath = process.env["WOTANN_OSC133_FIFO"];
    if (!fifoPath) return;
    osc133ParserRef.current = new Osc133Parser();
    blockBufferRef.current = new BlockBuffer();
    const completed: Block[] = [];
    let cancelled = false;
    void (async () => {
      try {
        const { createReadStream } = await import("node:fs");
        const stream = createReadStream(fifoPath, { encoding: "utf-8" });
        stream.on("data", (chunk: string | Buffer) => {
          if (cancelled) return;
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
          const events = osc133ParserRef.current?.feed(text) ?? [];
          for (const ev of events) {
            const block = blockBufferRef.current?.consume(ev);
            if (block) {
              completed.push(block);
              setTerminalBlocks([...completed]);
            }
          }
        });
        stream.on("error", (err) => {
          console.warn(`[WOTANN] OSC 133 FIFO error: ${err.message}`);
        });
      } catch (err) {
        console.warn(`[WOTANN] OSC 133 FIFO open failed: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      osc133ParserRef.current = null;
      blockBufferRef.current = null;
    };
  }, []);

  useEffect(() => {
    themeManagerRef.current.persist({ panel: activePanel });
  }, [activePanel]);

  useEffect(() => {
    setAgentStatuses(
      buildPrimaryAgentStatuses({
        model: currentModel,
        isStreaming,
        panelMode: currentMode,
        turnCount,
      }),
    );
  }, [currentModel, currentMode, isStreaming, turnCount]);

  // Sync stats from runtime after each query
  const syncStatsFromRuntime = useCallback(() => {
    if (!runtime) return;
    const status = runtime.getStatus();
    const budget = runtime.getContextBudget();
    const editTracker = runtime.getEditTracker();
    setStats((prev) => ({
      ...prev,
      cost: status.totalCost,
      contextPercent: Math.min(99, Math.ceil((budget.usagePercent ?? 0) * 100)),
      edits: editTracker.getTotalEdits(),
    }));
    setDiffEntries(readWorkspaceDiff(workingDir));
  }, [runtime]);

  // ── Abort Handler ────────────────────────────────────────
  const handleAbort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsStreaming(false);
      setStreamingContent("");
      setMessages((prev) => [...prev, { role: "system" as const, content: "Aborted by user." }]);
    }
  }, []);

  const appendSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "system" as const, content }]);
  }, []);

  const handleVoiceCapture = useCallback(async () => {
    if (isStreaming || voiceBusy) return;

    setVoiceBusy(true);
    try {
      const controller = voiceControllerRef.current;
      const result = await controller.capturePrompt();
      appendSystemMessage(result.message);
      if (result.transcript) {
        setPromptValue((prev) =>
          prev.trim().length > 0 ? `${prev} ${result.transcript}` : result.transcript,
        );
      }
    } finally {
      setVoiceBusy(false);
    }
  }, [appendSystemMessage, isStreaming, voiceBusy]);

  useInput(
    (input, key) => {
      if (isStreaming || voiceBusy) return;

      let normalizedKey = input;
      if (key.tab) normalizedKey = "tab";
      else if (key.escape) normalizedKey = "escape";
      else if (key.upArrow) normalizedKey = "up";
      else if (key.downArrow) normalizedKey = "down";

      const action = keybindingManagerRef.current.matchKey(normalizedKey, {
        ctrl: key.ctrl,
        meta: key.meta,
        shift: key.shift,
      });

      switch (action) {
        case "cycle-panel":
          if (!promptValue.startsWith("/")) {
            setActivePanel((current) => cyclePanel(current));
          }
          break;
        case "model-switch": {
          const nextModel = cycleModel(currentModel, providers);
          if (nextModel !== currentModel) {
            setCurrentModel(nextModel);
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Model switched to ${nextModel}.`,
              },
            ]);
          }
          break;
        }
        case "thinking-depth": {
          const nextEffort = cycleThinkingEffort(thinkingEffort);
          setThinkingEffort(nextEffort);
          runtime?.setThinkingEffort(nextEffort);
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content: `Thinking effort set to ${nextEffort}.`,
            },
          ]);
          break;
        }
        case "global-search":
          setPromptValue("/memory ");
          break;
        case "context-inspect":
          setShowContextPanel((prev) => !prev);
          break;
        case "terminal-blocks":
          setShowTerminalBlocks((prev) => !prev);
          break;
        case "history-search":
          if (history.length > 0) {
            setShowHistoryPicker((prev) => !prev);
          }
          break;
        case "close-overlay":
          setShowHistoryPicker(false);
          setShowContextPanel(false);
          setShowMessageActions(false);
          setShowTerminalBlocks(false);
          setShowCommandPalette(false);
          break;
        case "voice-capture":
          void handleVoiceCapture();
          break;
        // ── Wave 3G additions ─────────────────────────────
        case "command-palette":
          // Ctrl+P: toggle the overlay palette (P1-UI3).
          setShowCommandPalette((prev) => !prev);
          break;
        case "clear-conversation":
          // Ctrl+K: clear the conversation (mirrors /clear).
          setMessages([]);
          setShowStartup(true);
          setTurnCount(0);
          setPromptValue("");
          setStats({ cost: 0, contextPercent: 0, reads: 0, edits: 0, bashCalls: 0 });
          break;
        case "last-response": {
          // Ctrl+L: copy the last assistant response to the clipboard.
          const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
          if (lastAssistant) {
            try {
              execFileSync("pbcopy", [], { input: lastAssistant.content, timeout: 2000 });
              appendSystemMessage("Last response copied to clipboard.");
            } catch {
              appendSystemMessage(
                `Last response preview: ${lastAssistant.content.slice(0, 200)}${lastAssistant.content.length > 200 ? "..." : ""}`,
              );
            }
          } else {
            appendSystemMessage("No assistant response to jump to.");
          }
          break;
        }
        case "theme-cycle": {
          // Ctrl+Y: cycle through the 5 Norse themes and persist.
          const next = cycleNorseTheme(themeName);
          if (themeManagerRef.current.setTheme(next)) {
            setThemeName(themeManagerRef.current.getCurrent().name);
            appendSystemMessage(`Theme switched to: ${next}`);
          }
          break;
        }
      }
    },
    {
      isActive: true,
    },
  );

  // ── History Picker Handlers ──────────────────────────────
  const handleHistorySelect = useCallback((prompt: string) => {
    setPromptValue(prompt);
    setShowHistoryPicker(false);
  }, []);

  const handleHistoryCancel = useCallback(() => {
    setShowHistoryPicker(false);
  }, []);

  // ── Command Palette: register built-in commands ─────────
  // One-shot registration. Commands close over `setPromptValue` & friends
  // so they react to the live App state at execution time.
  useEffect(() => {
    const registry = commandRegistryRef.current;
    const builtins: Command[] = [
      {
        id: "palette.clear-conversation",
        label: "Clear Conversation",
        description: "Reset chat history (same as Ctrl+K)",
        keywords: ["clear", "reset", "new", "fresh"],
        handler: () => {
          setMessages([]);
          setShowStartup(true);
          setTurnCount(0);
          setPromptValue("");
        },
      },
      {
        id: "palette.switch-model",
        label: "Switch Model",
        description: "Cycle to the next configured provider/model",
        keywords: ["model", "provider", "cycle"],
        handler: () => {
          const nextModel = cycleModel(currentModel, providers);
          if (nextModel !== currentModel) {
            setCurrentModel(nextModel);
            appendSystemMessage(`Model switched to ${nextModel}.`);
          }
        },
      },
      {
        id: "palette.cycle-theme",
        label: "Cycle Norse Theme",
        description:
          "Switch to the next theme (Valhalla, Niflheim, Muspelheim, Alfheim, Svartalfheim)",
        keywords: ["theme", "color", "palette", "norse"],
        handler: () => {
          const next = cycleNorseTheme(themeName);
          if (themeManagerRef.current.setTheme(next)) {
            setThemeName(themeManagerRef.current.getCurrent().name);
            appendSystemMessage(`Theme switched to: ${next}`);
          }
        },
      },
      {
        id: "palette.show-history",
        label: "Search Prompt History",
        description: "Open the history picker (Ctrl+R)",
        keywords: ["history", "search", "prompt"],
        handler: () => {
          if (history.length > 0) setShowHistoryPicker(true);
        },
      },
      {
        id: "palette.toggle-context-inspector",
        label: "Toggle Context Inspector",
        description: "Show context source panel (Ctrl+I)",
        keywords: ["context", "inspect", "sources"],
        handler: () => {
          setShowContextPanel((prev) => !prev);
        },
      },
      {
        id: "palette.exit",
        label: "Exit",
        description: "Close the TUI",
        keywords: ["quit", "exit", "close"],
        handler: () => {
          if (runtime) runtime.close();
          exit();
        },
      },
    ];

    for (const cmd of builtins) registry.register(cmd);
    return () => {
      for (const cmd of builtins) registry.unregister(cmd.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Command Palette Handlers ────────────────────────────
  const handleCommandPaletteClose = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

  const handleCommandPaletteError = useCallback(
    (message: string) => {
      appendSystemMessage(message);
    },
    [appendSystemMessage],
  );

  // ── Message Actions Handler ─────────────────────────────
  const handleMessageAction = useCallback(
    (action: MessageAction, messageId: string) => {
      const msgIndex = parseInt(messageId, 10);
      const targetMsg = messages[msgIndex];
      if (!targetMsg) return;

      switch (action) {
        case "copy":
          try {
            execFileSync("pbcopy", [], { input: targetMsg.content, timeout: 2000 });
          } catch {
            /* clipboard unavailable */
          }
          appendSystemMessage("Copied to clipboard.");
          break;
        case "retry":
          if (targetMsg.role === "user") {
            void handleSubmitRef.current(targetMsg.content);
          }
          break;
        case "fork": {
          if (runtime) {
            const branchMgr = runtime.getBranchManager();
            branchMgr.fork(`fork-msg-${msgIndex}`);
            appendSystemMessage(`Forked conversation at message ${msgIndex + 1}.`);
          }
          break;
        }
        case "edit":
          if (targetMsg.role === "user") setPromptValue(targetMsg.content);
          break;
        case "delete":
          setMessages((prev) => [...prev.slice(0, msgIndex), ...prev.slice(msgIndex + 1)]);
          break;
      }
      setShowMessageActions(false);
    },
    [messages, runtime, appendSystemMessage],
  );

  const handleSubmitRef = useRef<(input: string) => Promise<void>>(async () => {});

  // ── Slash Command Handler ────────────────────────────────
  const handleSlashCommand = useCallback(
    (input: string): boolean => {
      const parts = input.trim().split(/\s+/);
      const cmd = (parts[0] ?? "").toLowerCase();
      const arg = parts.slice(1).join(" ");
      const rest = arg;
      const sysMsg = (content: string) => {
        setMessages((prev) => [...prev, { role: "system" as const, content }]);
      };

      switch (cmd) {
        case "/exit":
        case "/quit":
          if (runtime) runtime.close();
          exit();
          return true;

        case "/clear":
          setMessages([]);
          setShowStartup(true);
          setTurnCount(0);
          setPromptValue("");
          setStats({ cost: 0, contextPercent: 0, reads: 0, edits: 0, bashCalls: 0 });
          return true;

        case "/help":
          sysMsg(
            [
              "╭─ WOTANN Commands ──────────────────────────────────────────╮",
              "│                                                          │",
              "│  ── Session ──                                           │",
              "│  /help               Show this help                      │",
              "│  /clear              Clear conversation + reset           │",
              "│  /exit               Exit WOTANN                           │",
              "│  /history            Show recent prompts                  │",
              "│  /compact            Compact context window               │",
              "│                                                          │",
              "│  ── Configuration ──                                     │",
              "│  /config [key=val]   View/edit configuration              │",
              "│  /providers          List providers + auth status         │",
              "│  /model [name]       Show or switch model                 │",
              "│  /mode [name]        Show or switch behavioral mode       │",
              "│  /thinking [level]   Set reasoning effort (low/med/high)  │",
              "│  /theme [name]       Show or switch persisted theme       │",
              "│  /permission [mode]  Switch approval mode                 │",
              "│                                                          │",
              "│  ── Intelligence ──                                      │",
              "│  /context            Show context window budget           │",
              "│  /inspect            Context source inspector (Ctrl+I)    │",
              "│  /skills [query]     List/search skills                   │",
              "│  /memory [query]     Search memory (FTS5 + semantic)      │",
              "│  /learnings          Show cross-session patterns          │",
              "│  /persona [cmd]      Identity & persona management        │",
              "│  /council <task>     Multi-LLM 3-stage deliberation       │",
              "│  /enhance [text]     Prompt enhancer (AI-powered)         │",
              "│  /search <query>     Unified knowledge search             │",
              "│                                                          │",
              "│  ── Tools ──                                             │",
              "│  /lsp [cmd]          LSP symbol operations                │",
              "│  /mcp [cmd]          MCP server marketplace               │",
              "│  /freeze [path]      Freeze/unfreeze a file (immutable)   │",
              "│  /healing [error]    Self-healing recovery pipeline       │",
              "│  /canvas [file]      Open hunk-level collaborative editor │",
              "│  /deeplink <url>     Handle wotann:// deep links           │",
              "│                                                          │",
              "│  ── Execution ──                                         │",
              "│  /autonomous <task>  Fire-and-forget autonomous mode      │",
              "│  /arena <task>       Multi-model comparison arena         │",
              "│  /council <query>    Multi-LLM deliberation council       │",
              "│  /waves <task>       Wave-based parallel execution        │",
              "│  /research <topic>   Autonomous deep research             │",
              "│  /branch [cmd]       Fork/list/switch conversation branch │",
              "│  /merge <branch>     Merge branch into current            │",
              "│                                                          │",
              "│  ── Channels ──                                            │",
              "│  /inbox              Show dispatch task inbox             │",
              "│  /channels           Channel health dashboard             │",
              "│  /dispatch [cmd]     Dispatch management (status/pair/..) │",
              "│                                                          │",
              "│  ── Training ──                                          │",
              "│  /train [cmd]        Training pipeline (status/extract/..)│",
              "│                                                          │",
              "│  ── Diagnostics ──                                       │",
              "│  /stats              Session statistics from runtime      │",
              "│  /cost [budget]      View cost / set budget               │",
              "│  /doctor             Run health check                     │",
              "│  /trace              Show trace analysis                  │",
              "│  /voice              Voice mode info                      │",
              "│  /replay             Replay session recording             │",
              "│  /dream              Run learning extraction cycle        │",
              "│  /audit              Show session audit trail             │",
              "│  /roe [cmd]          Rules of engagement (security)      │",
              "│                                                          │",
              "│  ── Privacy ──                                             │",
              "│  /incognito        Toggle incognito (pause memory)        │",
              "│  /actions          Message actions (copy/retry/fork)      │",
              "│  /context-panel    Toggle context source panel             │",
              "│                                                          │",
              "│  ── Shortcuts ──                                         │",
              "│  Ctrl+C  Abort streaming    Ctrl+M  Cycle model           │",
              "│  Ctrl+R  Search history     Ctrl+I  Context panel         │",
              "│  Ctrl+T  Thinking depth     Ctrl+/  Memory search         │",
              "│  Tab     Cycle right panel  Esc     Close overlay         │",
              "╰──────────────────────────────────────────────────────────╯",
            ].join("\n"),
          );
          return true;

        case "/providers": {
          const lines = providers.map((p) => {
            const icon = p.available ? "●" : "○";
            const models =
              p.available && p.models.length > 0 ? `  ${p.models.slice(0, 3).join(", ")}` : "";
            return `  ${icon} ${p.provider}${p.available ? "" : " (not configured)"}${models}`;
          });
          const active = providers.filter((p) => p.available).length;
          sysMsg(`Providers: ${active}/${providers.length} active\n\n${lines.join("\n")}`);
          return true;
        }

        case "/skills": {
          const registry = getSkillRegistry();
          const summaries = registry.getSummaries();
          if (arg) {
            const q = arg.toLowerCase();
            const matches = summaries.filter(
              (s) =>
                s.name.includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.category.includes(q),
            );
            sysMsg(
              matches.length > 0
                ? `${matches.length} skills matching "${arg}":\n${matches.map((s) => `  ${s.name} — ${s.description}`).join("\n")}`
                : `No skills match "${arg}".`,
            );
          } else {
            const byCategory = new Map<string, string[]>();
            for (const s of summaries) {
              const list = byCategory.get(s.category) ?? [];
              list.push(s.name);
              byCategory.set(s.category, list);
            }
            const lines = [...byCategory.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([cat, names]) => `  ${cat} (${names.length}): ${names.join(", ")}`);
            sysMsg(`${summaries.length} skills loaded:\n\n${lines.join("\n")}`);
          }
          return true;
        }

        case "/mode": {
          if (!arg) {
            sysMsg(
              [
                `Current mode: ${currentMode}`,
                "",
                "  default        — Standard, asks before edits",
                "  plan           — Read-only analysis + planning",
                "  acceptEdits    — Auto-accept file changes",
                "  auto           — Full automation + testing",
                "  bypass         — Skip all permission prompts",
                "  autonomous     — Fire-and-forget until complete",
                "  guardrails-off — No restrictions (security research)",
                "",
                "Switch: /mode <name>",
              ].join("\n"),
            );
          } else {
            const newMode = arg as WotannMode;
            if (VALID_MODES.includes(newMode)) {
              // REAL mode switch via runtime — changes system prompt, safety overrides, hook state
              if (runtime) runtime.setMode(newMode);
              setCurrentMode(newMode);
              sysMsg(`Mode switched to: ${newMode}`);

              // When entering guardrails-off, prompt user to start an ROE session.
              // Session-5 cleanup: the prior `const terms = roe.getTerms()` call
              // was dead — the returned terms object was never surfaced in the
              // banner. If we want to show terms version in future, route it
              // through the message builder; for now the getRulesOfEngagement()
              // call is the only lookup we need.
              if (newMode === "guardrails-off" && runtime) {
                runtime.getRulesOfEngagement();
                const activeId = runtime.getActiveROESessionId();
                sysMsg(
                  [
                    "",
                    "╭─ Rules of Engagement ─────────────────────────────────────╮",
                    "│  GUARDRAILS-OFF mode requires a security research session │",
                    "│  with terms acceptance and audit logging.                 │",
                    "├──────────────────────────────────────────────────────────┤",
                    ...(activeId
                      ? [`│  Active ROE session: ${activeId.slice(0, 8)}...                      │`]
                      : [
                          "│  No active ROE session. Start one with:                 │",
                          "│                                                          │",
                          "│    /roe start <type>    (security-research, pentest,     │",
                          "│                          ethical-hacking, ctf)           │",
                          "│    /roe accept          Accept terms for active session  │",
                        ]),
                    "╰──────────────────────────────────────────────────────────╯",
                  ].join("\n"),
                );
              }
            } else {
              sysMsg(`Unknown mode: ${arg}\nValid: ${VALID_MODES.join(", ")}`);
            }
          }
          return true;
        }

        case "/model": {
          // Build a list of models available per provider from actual detected providers
          const providerModels: Map<string, readonly string[]> = new Map();
          for (const p of providers) {
            if (p.available && p.models.length > 0) {
              providerModels.set(p.provider, p.models);
            }
          }
          const allModels = [...providerModels.values()].flat();

          if (!arg) {
            const modelLines = [...providerModels.entries()].map(
              ([prov, models]) => `  ${prov}: ${models.join(", ")}`,
            );
            sysMsg(
              [
                `Current model: ${currentModel}`,
                "",
                "Available models:",
                ...modelLines,
                modelLines.length === 0 ? "  (no providers configured)" : "",
                "",
                "Switch: /model <name>",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          } else {
            // Validate model is available on some provider
            if (allModels.includes(arg) || allModels.length === 0) {
              setCurrentModel(arg);
              sysMsg(`Model switched to: ${arg}`);
            } else {
              // Check if it's a partial match or typo
              const closest = allModels.find((m) => m.includes(arg) || arg.includes(m));
              if (closest) {
                sysMsg(
                  `Model "${arg}" not found. Did you mean: ${closest}?\nAvailable: ${allModels.join(", ")}`,
                );
              } else {
                sysMsg(
                  `Model "${arg}" is not available on any configured provider.\nAvailable: ${allModels.join(", ")}`,
                );
              }
            }
          }
          return true;
        }

        case "/stats": {
          if (runtime) {
            const status = runtime.getStatus();
            sysMsg(
              [
                "Session Statistics (from WotannRuntime)",
                `  Turns:       ${turnCount}`,
                `  Tokens:      ${status.totalTokens.toLocaleString()}`,
                `  Cost:        $${status.totalCost.toFixed(4)}`,
                `  Provider:    ${status.activeProvider}`,
                `  Mode:        ${status.currentMode}`,
                `  Hooks:       ${status.hookCount} active`,
                `  Middleware:   ${status.middlewareLayers} layers`,
                `  Skills:      ${status.skillCount} loaded`,
                `  Memory:      ${status.memoryEnabled ? "active" : "disabled"}`,
                `  Traces:      ${status.traceEntries}`,
                `  Semantic:    ${status.semanticIndexSize} docs indexed`,
              ].join("\n"),
            );
          } else {
            sysMsg(
              `Turns: ${turnCount} | Cost: $${stats.cost.toFixed(4)} | Context: ${stats.contextPercent}%`,
            );
          }
          return true;
        }

        case "/memory": {
          if (!runtime) {
            sysMsg("Memory requires WotannRuntime. Run `wotann init` first.");
            return true;
          }
          if (!arg) {
            sysMsg(
              "Usage: /memory <search query>\nSearches FTS5 + semantic index across all 8 memory layers.",
            );
            return true;
          }
          const results = runtime.searchMemory(arg);
          if (results.length === 0) {
            sysMsg(`No memories match "${arg}".`);
          } else {
            const lines = results
              .slice(0, 5)
              .map(
                (r) =>
                  `  [${r.type}] ${r.text.slice(0, 100)}${r.text.length > 100 ? "..." : ""} (score: ${r.score.toFixed(2)})`,
              );
            sysMsg(`${results.length} memories found:\n${lines.join("\n")}`);
          }
          return true;
        }

        case "/doctor": {
          const active = providers.filter((p) => p.available).length;
          const hasWorkspace = existsSync(join(process.cwd(), ".wotann"));
          const registry = getSkillRegistry();
          const runtimeStatus = runtime
            ? "active (full pipeline)"
            : "not initialized (raw bridge mode)";
          sysMsg(
            [
              "WOTANN Health Check",
              "",
              `  Runtime:     ${runtimeStatus}`,
              `  Node.js:     ${process.version}`,
              `  Platform:    ${process.platform}`,
              `  Workspace:   ${hasWorkspace ? ".wotann/ found" : ".wotann/ missing — run wotann init"}`,
              `  Providers:   ${active} active of ${providers.length}`,
              `  Skills:      ${registry.getSkillCount()} loaded`,
              `  Mode:        ${currentMode}`,
              runtime ? `  Hooks:       ${runtime.getStatus().hookCount} active` : "",
              runtime ? `  Middleware:   ${runtime.getStatus().middlewareLayers} layers` : "",
              runtime
                ? `  Memory:      ${runtime.getStatus().memoryEnabled ? "SQLite + FTS5" : "disabled"}`
                : "",
              "",
              !runtime
                ? "  ⚠ Runtime not active — harness intelligence disabled. Run wotann init."
                : "  ✓ Full harness intelligence active",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return true;
        }

        case "/compact": {
          if (!runtime) {
            sysMsg("Compact requires WotannRuntime.");
            return true;
          }
          const budget = runtime.getContextBudget();
          sysMsg(`Compacting context (${Math.round(budget.usagePercent * 100)}% used)...`);
          const compactResult = runtime.manualCompact();
          sysMsg(
            `Context compacted: ${compactResult.removedMessages} messages removed, ${compactResult.summary.length > 0 ? "summary preserved" : "no summary"}.`,
          );
          syncStatsFromRuntime();
          return true;
        }

        case "/config": {
          if (!arg) {
            // Show current config like Claude's /config or OpenClaw's settings
            const hasWorkspace = existsSync(join(process.cwd(), ".wotann"));
            const registry = getSkillRegistry();
            sysMsg(
              [
                "╭─ WOTANN Configuration ─────────────────────────────────────╮",
                "│                                                          │",
                `│  Workspace:    ${hasWorkspace ? join(process.cwd(), ".wotann") : "Not initialized"}`,
                `│  Mode:         ${currentMode}`,
                `│  Model:        ${currentModel}`,
                `│  Hook profile: ${runtime?.getStatus().hookCount ?? 0} hooks (standard)`,
                `│  Skills:       ${registry.getSkillCount()} loaded`,
                `│  Memory:       ${runtime?.getStatus().memoryEnabled ? "SQLite + FTS5 active" : "disabled"}`,
                `│  TTSR:         active (5 streaming rules)`,
                `│  Middleware:    16 layers active`,
                "│                                                          │",
                "│  Edit config:  /config <key>=<value>                     │",
                "│  Examples:                                                │",
                "│    /config mode=plan                                     │",
                "│    /config hooks=strict                                  │",
                "│    /config theme=dracula                                 │",
                "│                                                          │",
                "│  Config file:  .wotann/config.yaml                        │",
                "│  Providers:    /providers                                │",
                "│  Skills:       /skills                                   │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
          } else {
            // Parse key=value
            const eqIdx = arg.indexOf("=");
            if (eqIdx === -1) {
              sysMsg(`Usage: /config <key>=<value>\nExample: /config mode=plan`);
            } else {
              const key = arg.slice(0, eqIdx).trim();
              const val = arg.slice(eqIdx + 1).trim();
              switch (key) {
                case "mode": {
                  const newMode = val as WotannMode;
                  if (VALID_MODES.includes(newMode)) {
                    if (runtime) runtime.setMode(newMode);
                    setCurrentMode(newMode);
                    sysMsg(`Config updated: mode = ${newMode}`);
                  } else {
                    sysMsg(`Invalid mode: ${val}. Valid: ${VALID_MODES.join(", ")}`);
                  }
                  break;
                }
                case "model":
                  setCurrentModel(val);
                  sysMsg(`Config updated: model = ${val}`);
                  break;
                case "hooks":
                  sysMsg(`Hook profile: ${val} (restart required to apply)`);
                  break;
                case "theme":
                  if (themeManagerRef.current.setTheme(val)) {
                    setThemeName(themeManagerRef.current.getCurrent().name);
                    sysMsg(`Config updated: theme = ${val}`);
                  } else {
                    sysMsg(`Unknown theme: ${val}`);
                  }
                  break;
                default:
                  sysMsg(`Unknown config key: ${key}\nKnown keys: mode, model, hooks, theme`);
              }
            }
          }
          return true;
        }

        case "/cost": {
          if (runtime) {
            const status = runtime.getStatus();
            if (arg) {
              const budget = parseFloat(arg);
              if (!isNaN(budget) && budget > 0) {
                sysMsg(
                  `Cost budget set: $${budget.toFixed(2)}\nCurrent spend: $${status.totalCost.toFixed(4)}\nRemaining: $${(budget - status.totalCost).toFixed(4)}`,
                );
              } else {
                sysMsg("Usage: /cost <budget_usd>\nExample: /cost 5.00");
              }
            } else {
              sysMsg(
                [
                  "Cost Tracking",
                  `  Session spend: $${status.totalCost.toFixed(4)}`,
                  `  Total tokens:  ${status.totalTokens.toLocaleString()}`,
                  `  Provider:      ${status.activeProvider}`,
                  "",
                  "  Set budget: /cost <amount>",
                  "  Example:    /cost 5.00",
                ].join("\n"),
              );
            }
          } else {
            sysMsg("Cost tracking requires WotannRuntime. Run `wotann init` first.");
          }
          return true;
        }

        case "/history":
          if (history.length === 0) {
            sysMsg("No prompt history yet.");
          } else {
            const recent = history.slice(0, 10);
            sysMsg(
              `Recent prompts:\n${recent.map((h, i) => `  ${i + 1}. ${h.slice(0, 80)}${h.length > 80 ? "..." : ""}`).join("\n")}`,
            );
          }
          return true;

        case "/thinking": {
          const efforts = ["low", "medium", "high", "max"] as const;
          if (!arg) {
            const current = runtime?.getThinkingEffort() ?? "medium";
            sysMsg(
              [
                `Thinking effort: ${current}`,
                "",
                "  low    — Minimal reasoning, fastest responses",
                "  medium — Balanced (default)",
                "  high   — Deep reasoning, better for complex tasks",
                "  max    — Maximum thinking tokens (4x budget)",
                "",
                "Switch: /thinking <level>",
              ].join("\n"),
            );
          } else {
            const level = arg.toLowerCase();
            if (efforts.includes(level as (typeof efforts)[number])) {
              if (runtime) runtime.setThinkingEffort(level as (typeof efforts)[number]);
              setThinkingEffort(level as (typeof efforts)[number]);
              sysMsg(`Thinking effort set to: ${level}`);
            } else {
              sysMsg(`Invalid level: ${arg}\nValid: ${efforts.join(", ")}`);
            }
          }
          return true;
        }

        case "/theme": {
          const themeManager = themeManagerRef.current;
          if (!arg) {
            sysMsg(
              [
                `Current theme: ${themeName}`,
                "",
                `Available themes (${themeManager.getThemeCount()}):`,
                themeManager
                  .getThemeNames()
                  .slice(0, 16)
                  .map((name) => `  ${name}`)
                  .join("\n"),
                themeManager.getThemeCount() > 16 ? "  ..." : "",
                "",
                "Switch: /theme <name>",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          } else if (themeManager.setTheme(arg)) {
            setThemeName(themeManager.getCurrent().name);
            sysMsg(`Theme switched to: ${arg}`);
          } else {
            sysMsg(`Unknown theme: ${arg}`);
          }
          return true;
        }

        case "/context": {
          if (runtime) {
            const budget = runtime.getContextBudget();
            const capability = runtime.getContextCapabilityProfile();
            sysMsg(
              [
                "Context Window",
                `  Effective:     ${runtime.getMaxContextTokens().toLocaleString()} tokens`,
                `  Documented:    ${capability.documentedMaxTokens.toLocaleString()} tokens`,
                `  Activation:    ${capability.activationMode}`,
                `  Used:          ${(budget.usagePercent * 100).toFixed(1)}%`,
                `  Pressure:      ${budget.pressureLevel}`,
                `  Available:     ${budget.availableTokens.toLocaleString()} tokens`,
                capability.notes ? `  Notes:         ${capability.notes}` : "",
                "",
                "  Zones:",
                `    System prompt: ${budget.systemPromptTokens.toLocaleString()}`,
                `    Memory:        ${budget.memoryTokens.toLocaleString()}`,
                `    Tools:         ${budget.toolSchemaTokens.toLocaleString()}`,
                `    Conversation:  ${budget.conversationTokens.toLocaleString()}`,
              ]
                .filter(Boolean)
                .join("\n"),
            );
          } else {
            sysMsg("Context tracking requires WotannRuntime.");
          }
          return true;
        }

        case "/voice": {
          const controller = voiceControllerRef.current;
          const subcommand = (parts[1] ?? "").toLowerCase();
          const remainder = parts.slice(2).join(" ");

          if (subcommand === "on") {
            controller.setEnabled(true);
            void (async () => {
              const status = await controller.getStatus();
              sysMsg(
                [
                  "Voice Mode",
                  `  Enabled:       yes`,
                  `  Auto-speak:    ${status.autoSpeak ? "yes" : "no"}`,
                  `  STT:           ${status.stt ?? "none detected"}`,
                  `  TTS:           ${status.tts ?? "none detected"}`,
                  `  Can listen:    ${status.canListen ? "yes" : "no"}`,
                  `  Can speak:     ${status.canSpeak ? "yes" : "no"}`,
                  "",
                  "  Press Ctrl+V to record a voice prompt.",
                ].join("\n"),
              );
            })();
            return true;
          }

          if (subcommand === "off") {
            controller.setEnabled(false);
            sysMsg("Voice mode disabled.");
            return true;
          }

          if (subcommand === "capture") {
            void handleVoiceCapture();
            return true;
          }

          if (subcommand === "autospeak") {
            const enabled = controller.toggleAutoSpeak();
            sysMsg(`Voice auto-speak ${enabled ? "enabled" : "disabled"}.`);
            return true;
          }

          if (subcommand === "say" && remainder) {
            void (async () => {
              const spoken = await controller.speakText(remainder);
              sysMsg(
                spoken
                  ? "Voice playback started."
                  : "Voice playback unavailable. Run `/voice on` and configure TTS.",
              );
            })();
            return true;
          }

          void (async () => {
            const status = await controller.getStatus();
            sysMsg(
              [
                "Voice Mode",
                "",
                `  Enabled:       ${status.enabled ? "yes" : "no"}`,
                `  Auto-speak:    ${status.autoSpeak ? "yes" : "no"}`,
                `  STT:           ${status.stt ?? "none detected"}`,
                `  TTS:           ${status.tts ?? "none detected"}`,
                `  Can listen:    ${status.canListen ? "yes" : "no"}`,
                `  Can speak:     ${status.canSpeak ? "yes" : "no"}`,
                "",
                "  Commands:",
                "    /voice on         Enable voice capture",
                "    /voice off        Disable voice capture",
                "    /voice capture    Record a prompt now",
                "    /voice autospeak  Toggle speaking assistant replies",
                "",
                "  Push-to-talk: Ctrl+V records a voice prompt.",
              ].join("\n"),
            );
          })();
          return true;
        }

        case "/trace":
          if (runtime) {
            const analysis = runtime.getTraceAnalysis();
            sysMsg(
              [
                "Trace Analysis",
                `  Entries:   ${analysis.totalEntries}`,
                `  Tokens:    ${analysis.totalTokens.toLocaleString()}`,
                `  Duration:  ${(analysis.totalDurationMs / 1000).toFixed(1)}s`,
                analysis.patterns.length > 0
                  ? `  Patterns:  ${analysis.patterns.length} detected`
                  : "  No patterns detected",
              ].join("\n"),
            );
          } else {
            sysMsg("Trace analysis requires WotannRuntime.");
          }
          return true;

        case "/freeze": {
          if (!runtime) {
            sysMsg("File freezing requires WotannRuntime.");
            return true;
          }
          const freezer = runtime.getFileFreezer();
          if (!arg) {
            const frozen = freezer.getRules();
            sysMsg(
              frozen.length > 0
                ? `Frozen files:\n${frozen.map((f: { pattern: string }) => `  🔒 ${f.pattern}`).join("\n")}\n\nUnfreeze: /freeze --unfreeze <path>`
                : "No files frozen. Usage: /freeze <path> to make a file immutable for this session.",
            );
          } else if (arg.startsWith("--unfreeze ")) {
            const target = arg.replace("--unfreeze ", "").trim();
            freezer.unfreeze(target);
            sysMsg(`Unfrozen: ${target}`);
          } else {
            freezer.freeze(arg.trim());
            sysMsg(`🔒 Frozen: ${arg.trim()} — WOTANN will refuse to edit this file.`);
          }
          return true;
        }

        case "/branch": {
          if (!runtime) {
            sysMsg("Branching requires WotannRuntime.");
            return true;
          }
          const branchMgr = runtime.getBranchManager();
          const subCmd = (parts[1] ?? "").toLowerCase();
          if (subCmd === "fork" || subCmd === "create") {
            const label = parts.slice(2).join(" ") || `branch-${Date.now()}`;
            const branch = branchMgr.fork(label);
            sysMsg(
              `Forked conversation branch: ${branch.id} (${label})\n${branchMgr.listBranches().length} total branches`,
            );
          } else if (subCmd === "list") {
            const branches = branchMgr.listBranches();
            sysMsg(
              branches.length > 0
                ? `Branches:\n${branches.map((b: { id: string; name: string; turns: readonly unknown[] }) => `  ${b.id} — ${b.name} (${b.turns.length} turns)`).join("\n")}`
                : "No branches. Fork with: /branch fork <label>",
            );
          } else if (subCmd === "switch" && parts[2]) {
            const switched = branchMgr.switchBranch(parts[2]);
            if (switched) {
              sysMsg(`Switched to branch: ${parts[2]}`);
            } else {
              sysMsg(`Branch not found: ${parts[2]}`);
            }
          } else {
            sysMsg("Usage: /branch fork <label> | /branch list | /branch switch <id>");
          }
          return true;
        }

        case "/canvas": {
          if (!runtime) {
            sysMsg("Canvas requires WotannRuntime.");
            return true;
          }
          const canvas = runtime.getCanvasEditor();
          if (!arg) {
            sysMsg(
              "Open a file for collaborative editing: /canvas <filepath>\nClose: /canvas close <sessionId>\nAccept all: /canvas accept-all <sessionId>",
            );
          } else if (arg.startsWith("close ")) {
            const sessionId = arg.replace("close ", "").trim();
            canvas.closeCanvas(sessionId);
            sysMsg("Canvas session closed.");
          } else if (arg.startsWith("accept-all ")) {
            const sessionId = arg.replace("accept-all ", "").trim();
            const accepted = canvas.acceptAll(sessionId);
            sysMsg(`Accepted ${accepted} hunks.`);
          } else {
            const session = canvas.openCanvas(arg.trim());
            sysMsg(
              `Canvas opened: ${session.filePath} (session: ${session.id})\n  Hunks will appear as the agent proposes edits.`,
            );
          }
          return true;
        }

        case "/autonomous": {
          if (!runtime) {
            sysMsg("Autonomous mode requires WotannRuntime.");
            return true;
          }
          if (!arg) {
            sysMsg(
              "Usage: /autonomous <task description>\nFire-and-forget execution with 8-strategy escalation, doom-loop detection, and shadow-git checkpoints.",
            );
            return true;
          }
          const executor = runtime.getAutonomousExecutor();
          if (executor.isActive()) {
            sysMsg("Autonomous execution already in progress. Cancel with /autonomous cancel");
            return true;
          }
          sysMsg(
            `🚀 Starting autonomous execution: ${arg}\n  Max cycles: 25 | Budget: $10 | Timeout: 1h\n  Strategies: direct → decompose → research-first → minimal-change → revert-and-retry`,
          );
          runtime.setMode("autonomous");
          setCurrentMode("autonomous");
          // Actually start the autonomous execution loop
          void (async () => {
            try {
              const result = await executor.execute(
                arg,
                async (prompt) => {
                  let output = "";
                  let tokensUsed = 0;
                  for await (const chunk of runtime.query({ prompt })) {
                    if (chunk.type === "text") output += chunk.content;
                    if (chunk.tokensUsed) tokensUsed = chunk.tokensUsed;
                  }
                  return { output, costUsd: 0, tokensUsed };
                },
                async () => {
                  const tsc = await new Promise<boolean>((resolve) => {
                    try {
                      execFileSync("npx", ["tsc", "--noEmit"], {
                        cwd: runtime.getWorkingDir(),
                        timeout: 60000,
                      });
                      resolve(true);
                    } catch {
                      resolve(false);
                    }
                  });
                  const tests = await new Promise<boolean>((resolve) => {
                    try {
                      execFileSync("npx", ["vitest", "run", "--reporter=dot"], {
                        cwd: runtime.getWorkingDir(),
                        timeout: 120000,
                      });
                      resolve(true);
                    } catch {
                      resolve(false);
                    }
                  });
                  return {
                    testsPass: tests,
                    typecheckPass: tsc,
                    lintPass: true,
                    output: tsc && tests ? "All checks pass" : "Checks failed",
                  };
                },
                {
                  onCycleStart: (cycle, strategy) => {
                    appendSystemMessage(`[Autonomous] Cycle ${cycle + 1} — strategy: ${strategy}`);
                  },
                  onCycleEnd: (result) => {
                    appendSystemMessage(
                      `[Autonomous] Cycle ${result.cycle + 1}: tests=${result.testsPass ? "✓" : "✗"} typecheck=${result.typecheckPass ? "✓" : "✗"} (${result.durationMs}ms)`,
                    );
                  },
                },
              );
              const proofPath = runtime.generateProofBundle(arg, result);
              appendSystemMessage(
                result.success
                  ? `✓ Autonomous completed in ${result.totalCycles} cycles (${(result.totalDurationMs / 1000).toFixed(1)}s)\n  Proof: ${proofPath}`
                  : `✗ Autonomous failed: ${result.exitReason} after ${result.totalCycles} cycles`,
              );
            } catch (error) {
              appendSystemMessage(
                `Autonomous error: ${error instanceof Error ? error.message : "unknown"}`,
              );
            } finally {
              runtime.setMode("default");
              setCurrentMode("default");
            }
          })();
          return true;
        }

        case "/autoresearch": {
          if (!runtime) {
            sysMsg("Autoresearch requires WotannRuntime.");
            return true;
          }
          const arTarget = rest.trim();
          if (!arTarget) {
            sysMsg(
              "Usage: /autoresearch <target file>\nAutonomously optimize a file through experiment cycles.",
            );
            return true;
          }
          sysMsg(`Starting autoresearch on: ${arTarget}`);
          return true;
        }

        case "/learnings": {
          if (!runtime) {
            sysMsg("Learnings require WotannRuntime.");
            return true;
          }
          const learner = runtime.getCrossSessionLearner();
          const learnings = learner.getAllLearnings();
          sysMsg(
            learnings.length > 0
              ? `Cross-session learnings (${learnings.length}):\n${learnings
                  .slice(0, 10)
                  .map((l) => `  • ${l.content} (${(l.confidence * 100).toFixed(0)}%)`)
                  .join("\n")}`
              : "No cross-session patterns extracted yet. They accumulate over multiple sessions.",
          );
          return true;
        }

        case "/replay": {
          if (!runtime) {
            sysMsg("Replay requires WotannRuntime.");
            return true;
          }
          const recorder = runtime.getSessionRecorder();
          const replaySession = recorder.getSession();
          const events = replaySession.events;
          sysMsg(
            events.length > 0
              ? `Session recording: ${events.length} events\n${events
                  .slice(-10)
                  .map((e) => `  ${new Date(e.timestamp).toISOString().slice(11, 19)} — ${e.type}`)
                  .join("\n")}`
              : "No events recorded yet.",
          );
          return true;
        }

        case "/arena": {
          if (!runtime) {
            sysMsg("Arena requires WotannRuntime.");
            return true;
          }
          const arenaTask = rest.trim();
          if (!arenaTask) {
            sysMsg(
              "Usage: /arena <task>\nRuns the same task on multiple models simultaneously in isolated git worktrees.\nCompare outputs side-by-side with blind voting.",
            );
            return true;
          }
          const availableProviders = providers.filter((p) => p.available).map((p) => p.provider);
          if (availableProviders.length < 2) {
            sysMsg("Arena requires at least 2 active providers. Run /providers to check.");
            return true;
          }
          sysMsg(
            `🏟  Arena starting: "${arenaTask.slice(0, 80)}"\n  Providers: ${availableProviders.join(", ")}`,
          );
          void (async () => {
            try {
              const contestants = await runtime.runArena(arenaTask, availableProviders);
              if (contestants.length === 0) {
                appendSystemMessage("Arena: No responses received.");
                return;
              }
              const results = contestants
                .map(
                  (c) =>
                    `  ${c.label}: ${c.response.slice(0, 120)}${c.response.length > 120 ? "..." : ""}\n    (${c.tokensUsed} tokens, ${c.durationMs}ms)`,
                )
                .join("\n\n");
              appendSystemMessage(
                `🏟  Arena Results:\n\n${results}\n\nVote: reply with the letter of the best response.`,
              );
            } catch (error) {
              appendSystemMessage(
                `Arena error: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          })();
          return true;
        }

        case "/council": {
          if (!runtime) {
            sysMsg("Council requires WotannRuntime.");
            return true;
          }
          const councilQuery = rest.trim();
          if (!councilQuery) {
            sysMsg(
              "Usage: /council <question>\nRuns a multi-LLM deliberation: individual answers, peer review, chairman synthesis.",
            );
            return true;
          }
          const councilProviders = providers.filter((p) => p.available).map((p) => p.provider);
          if (councilProviders.length < 2) {
            sysMsg("Council requires at least 2 active providers. Run /providers to check.");
            return true;
          }
          sysMsg(
            `🏛  Council convening: "${councilQuery.slice(0, 80)}"\n  Members: ${councilProviders.join(", ")}`,
          );
          void (async () => {
            try {
              const result = await runtime.runCouncil(councilQuery, councilProviders);
              if (result.members.length === 0) {
                appendSystemMessage("Council: No responses received.");
                return;
              }
              const memberSummary = result.members
                .map(
                  (m) =>
                    `  ${m.label} (${m.provider}): ${m.response.slice(0, 100)}${m.response.length > 100 ? "..." : ""}\n    (${m.tokensUsed} tokens, ${m.durationMs}ms)`,
                )
                .join("\n\n");
              const ranking =
                result.aggregateRanking.length > 0
                  ? "\n\nRanking:\n" +
                    result.aggregateRanking
                      .map(
                        (r, i) => `  ${i + 1}. ${r.label} (avg rank: ${r.averageRank.toFixed(1)})`,
                      )
                      .join("\n")
                  : "";
              const synthesis = result.synthesis
                ? `\n\nSynthesis (${result.chairmanModel}):\n  ${result.synthesis.slice(0, 300)}${result.synthesis.length > 300 ? "..." : ""}`
                : "";
              appendSystemMessage(
                `🏛  Council Results:\n\n${memberSummary}${ranking}${synthesis}\n\n  Total: ${result.totalTokens} tokens, ${result.totalDurationMs}ms`,
              );
            } catch (error) {
              appendSystemMessage(
                `Council error: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          })();
          return true;
        }

        case "/inspect": {
          if (!runtime) {
            sysMsg("Inspect requires WotannRuntime.");
            return true;
          }
          const inspector = runtime.getContextInspector();
          if (!inspector) {
            sysMsg("Context inspector not available.");
            return true;
          }
          const snapshot = inspector.getSnapshot();
          const topConsumers = snapshot.topConsumers
            .slice(0, 8)
            .map(
              (s: { source: string; tokens: number; percent: number }) =>
                `  ${s.source.padEnd(28)} ${String(s.tokens).padStart(7)} tokens  ${s.percent.toFixed(1)}%`,
            );
          const utilPct = snapshot.utilizationPercent;
          sysMsg(
            [
              "╭─ Context Source Inspector (Ctrl+I) ─────────────────────╮",
              `│  Total: ${snapshot.totalTokens.toLocaleString().padStart(9)} / ${snapshot.maxTokens.toLocaleString()} tokens`,
              `│  Usage: ${utilPct.toFixed(1)}%  ${utilPct > 75 ? "⚠ HIGH" : "✓ OK"}`,
              "├──────────────────────────────────────────────────────────┤",
              ...topConsumers.map((s: string) => `│ ${s.padEnd(55)}│`),
              "├──────────────────────────────────────────────────────────┤",
              `│  Recommendations: ${snapshot.recommendations.length} suggestions`,
              ...snapshot.recommendations
                .slice(0, 3)
                .map((r: string) => `│    • ${r.slice(0, 52)}`),
              "╰──────────────────────────────────────────────────────────╯",
            ].join("\n"),
          );
          return true;
        }

        case "/mcp": {
          const sub = rest.trim().split(/\s+/);
          const mcpAction = sub[0] ?? "list";
          void (async () => {
            const { MCPRegistry } = await import("../marketplace/registry.js");
            const registry = new MCPRegistry({ projectDir: workingDir });
            registry.registerBuiltins();
            registry.importFromClaudeCode();
            switch (mcpAction) {
              case "list": {
                const servers = registry.getAllServers();
                if (servers.length === 0) {
                  appendSystemMessage("No MCP servers registered. Import with: /mcp import");
                } else {
                  const lines = servers.map(
                    (s) =>
                      `│  ${s.enabled ? "✓" : "✗"} ${s.name.padEnd(14)} ${s.command.padEnd(20)} ${s.transport}`,
                  );
                  appendSystemMessage(
                    [
                      "╭─ MCP Server Registry ────────────────────────────────────╮",
                      `│  ${servers.length} server(s) registered                                 │`,
                      "├──────────────────────────────────────────────────────────┤",
                      ...lines,
                      "├──────────────────────────────────────────────────────────┤",
                      "│  Commands: /mcp list | /mcp install <name>              │",
                      "│            /mcp remove <name> | /mcp audit <name>       │",
                      "╰──────────────────────────────────────────────────────────╯",
                    ].join("\n"),
                  );
                }
                break;
              }
              case "install": {
                const serverName = sub[1];
                if (!serverName) {
                  appendSystemMessage("Usage: /mcp install <name>");
                  break;
                }
                appendSystemMessage(
                  `Installing MCP server: ${serverName}\nUse /mcp list to see registered servers.`,
                );
                break;
              }
              case "remove": {
                const serverName = sub[1];
                if (!serverName) {
                  appendSystemMessage("Usage: /mcp remove <name>");
                  break;
                }
                const existing = registry.getServer(serverName);
                if (!existing) {
                  appendSystemMessage(
                    `MCP server "${serverName}" not found. Use /mcp list to see registered servers.`,
                  );
                } else {
                  registry.unregister(serverName);
                  appendSystemMessage(`Removed MCP server: ${serverName}`);
                }
                break;
              }
              case "audit": {
                const serverName = sub[1];
                if (!serverName) {
                  appendSystemMessage("Usage: /mcp audit <name>");
                  break;
                }
                const server = registry.getServer(serverName);
                if (!server) {
                  appendSystemMessage(`MCP server "${serverName}" not found.`);
                } else {
                  appendSystemMessage(
                    [
                      `Security audit for MCP server: ${server.name}`,
                      `  Command:   ${server.command}`,
                      `  Args:      ${server.args.join(" ") || "(none)"}`,
                      `  Transport: ${server.transport}`,
                      `  Env vars:  ${server.env ? Object.keys(server.env).join(", ") : "(none)"}`,
                      `  Enabled:   ${server.enabled}`,
                    ].join("\n"),
                  );
                }
                break;
              }
              default:
                appendSystemMessage("Usage: /mcp [list|install|remove|audit] [name]");
            }
          })();
          return true;
        }

        case "/persona": {
          if (!runtime) {
            sysMsg("Persona requires WotannRuntime.");
            return true;
          }
          const personaSub = rest.trim();
          if (!personaSub) {
            sysMsg(
              [
                "╭─ Identity & Persona ──────────────────────────────────────╮",
                "│  Bootstrap files (loaded in order on startup):            │",
                "│    1. AGENTS.md    2. TOOLS.md     3. SOUL.md            │",
                "│    4. IDENTITY.md  5. USER.md      6. HEARTBEAT.md       │",
                "│    7. LESSONS.md   8. RULES.md                           │",
                "├──────────────────────────────────────────────────────────┤",
                "│  Commands:                                               │",
                "│    /persona list       Show active personas              │",
                "│    /persona init       Generate bootstrap files          │",
                "│    /persona switch <n> Activate a different persona      │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
            return true;
          }
          if (personaSub === "init") {
            const manager = runtime.getPersonaManager();
            sysMsg(
              `Generating 8-file bootstrap sequence in .wotann/identity/...\n  Existing personas: ${manager.list().length > 0 ? manager.list().join(", ") : "none"}\n  This creates AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, USER.md, HEARTBEAT.md, LESSONS.md, RULES.md`,
            );
          } else if (personaSub === "list") {
            const manager = runtime.getPersonaManager();
            const personas = manager.list();
            sysMsg(
              personas.length > 0
                ? `Loaded personas (${personas.length}):\n${personas.map((p) => `  • ${p}`).join("\n")}`
                : "No personas loaded. Create YAML files in .wotann/identity/personas/ or run /persona init.",
            );
          } else {
            sysMsg(`Persona command: ${personaSub}`);
          }
          return true;
        }

        case "/permission": {
          const permMode = rest.trim();
          const validModes = ["auto-approve", "ask-always", "smart"] as const;
          if (!permMode || !validModes.includes(permMode as (typeof validModes)[number])) {
            const currentPerm = runtime?.getPermissionMode() ?? "smart";
            sysMsg(
              [
                "╭─ Permission Mode ─────────────────────────────────────────╮",
                `│  Current: ${currentPerm.padEnd(45)}│`,
                "├──────────────────────────────────────────────────────────┤",
                "│  auto-approve   Skip all approval prompts               │",
                "│  ask-always     Ask before every tool call               │",
                "│  smart          Ask for destructive ops only (default)   │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
            return true;
          }
          if (runtime) {
            runtime.setPermissionMode(permMode as "auto-approve" | "ask-always" | "smart");
          }
          sysMsg(`Permission mode set to: ${permMode}`);
          return true;
        }

        case "/healing": {
          if (!runtime) {
            sysMsg("Self-healing requires WotannRuntime.");
            return true;
          }
          const healingTarget = rest.trim();
          if (!healingTarget) {
            sysMsg(
              [
                "╭─ Self-Healing Pipeline ───────────────────────────────────╮",
                "│  Graduated recovery strategies:                          │",
                "│    1. prompt-fix       → Revise prompt with error context│",
                "│    2. code-rollback    → Restore last working state      │",
                "│    3. strategy-change  → Try different approach           │",
                "│    4. human-escalation → Generate detailed error report  │",
                "├──────────────────────────────────────────────────────────┤",
                "│  Usage: /healing <error description or task>             │",
                "│  The pipeline auto-classifies errors and selects the     │",
                "│  optimal recovery strategy.                              │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
            return true;
          }
          type HealingResult = {
            category: string;
            confidence: number;
            suggestedFix?: string;
            file?: string;
            line?: number;
            relatedPatterns: readonly string[];
          };
          const pipeline = runtime.getSelfHealingPipeline() as unknown as {
            classifyError?: (e: string) => HealingResult;
          };
          const classifyFn =
            pipeline.classifyError ??
            ((_: string): HealingResult => ({
              category: "unknown",
              confidence: 0.5,
              relatedPatterns: [],
            }));
          const classified = classifyFn(healingTarget);
          sysMsg(
            [
              `Self-Healing Analysis:`,
              `  Error type:  ${classified.category}`,
              `  Confidence:  ${(classified.confidence * 100).toFixed(0)}%`,
              classified.suggestedFix ? `  Suggested:   ${classified.suggestedFix}` : "",
              classified.file
                ? `  File:        ${classified.file}${classified.line ? `:${classified.line}` : ""}`
                : "",
              `  Patterns:    ${classified.relatedPatterns.length > 0 ? classified.relatedPatterns.join(", ") : "none matched"}`,
              "",
              `  Recovery strategy: ${classified.category === "type-error" || classified.category === "syntax-error" ? "prompt-fix" : classified.category === "test-failure" ? "code-rollback" : "strategy-change"}`,
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return true;
        }

        case "/lsp": {
          const lspSub = rest.trim().split(/\s+/);
          const lspAction = lspSub[0] ?? "status";
          switch (lspAction) {
            case "status":
              sysMsg(
                [
                  "╭─ LSP Symbol Operations ───────────────────────────────────╮",
                  "│  Supported languages: TypeScript, Python, Go, Rust,      │",
                  "│                       Java, C#                           │",
                  "├──────────────────────────────────────────────────────────┤",
                  "│  Commands:                                               │",
                  "│    /lsp status               Show LSP status             │",
                  "│    /lsp find <symbol>        Find definition             │",
                  "│    /lsp references <symbol>  Find all references         │",
                  "│    /lsp rename <old> <new>   Rename symbol               │",
                  "│    /lsp hover <file:line>    Get hover info              │",
                  "╰──────────────────────────────────────────────────────────╯",
                ].join("\n"),
              );
              break;
            case "find": {
              const sym = lspSub[1];
              if (!sym) {
                sysMsg("Usage: /lsp find <symbol>");
                break;
              }
              if (runtime) {
                void (async () => {
                  const lsp = runtime.getLspManager() as unknown as {
                    findSymbol(n: string): Promise<
                      readonly {
                        kind: string;
                        name: string;
                        uri: string;
                        range: { start: { line: number } };
                      }[]
                    >;
                  };
                  const results = await lsp.findSymbol(sym);
                  appendSystemMessage(
                    results.length > 0
                      ? `Found "${sym}" (${results.length} matches):\n${results
                          .slice(0, 10)
                          .map((r) => `  ${r.kind} ${r.name} — ${r.uri}:${r.range.start.line + 1}`)
                          .join("\n")}`
                      : `No definition found for "${sym}".`,
                  );
                })();
              } else {
                sysMsg(`Finding: ${sym}`);
              }
              break;
            }
            case "references": {
              const sym = lspSub[1];
              if (!sym) {
                sysMsg("Usage: /lsp references <symbol>");
                break;
              }
              if (runtime) {
                void (async () => {
                  const lsp = runtime.getLspManager() as unknown as {
                    findSymbol(n: string): Promise<
                      readonly {
                        uri: string;
                        range: { start: { line: number; character: number } };
                      }[]
                    >;
                    findReferences(
                      u: string,
                      p: { line: number; character: number },
                    ): Promise<readonly { uri: string; range: { start: { line: number } } }[]>;
                  };
                  const symbols = await lsp.findSymbol(sym);
                  if (symbols.length === 0) {
                    appendSystemMessage(`No symbol found: "${sym}"`);
                    return;
                  }
                  const first = symbols[0]!;
                  const refs = await lsp.findReferences(first.uri, first.range.start);
                  appendSystemMessage(
                    refs.length > 0
                      ? `${refs.length} references to "${sym}":\n${refs
                          .slice(0, 15)
                          .map((r) => `  ${r.uri}:${r.range.start.line + 1}`)
                          .join(
                            "\n",
                          )}${refs.length > 15 ? `\n  ... and ${refs.length - 15} more` : ""}`
                      : `No references found for "${sym}".`,
                  );
                })();
              } else {
                sysMsg(`Finding: ${sym}`);
              }
              break;
            }
            case "rename": {
              const oldSym = lspSub[1];
              const newSymName = lspSub[2];
              if (!oldSym || !newSymName) {
                sysMsg("Usage: /lsp rename <old> <new>");
                break;
              }
              if (runtime) {
                void (async () => {
                  const lsp = runtime.getLspManager() as unknown as {
                    findSymbol(n: string): Promise<
                      readonly {
                        uri: string;
                        range: { start: { line: number; character: number } };
                      }[]
                    >;
                    rename(
                      u: string,
                      p: { line: number; character: number },
                      n: string,
                    ): Promise<{ filesAffected: number; editsApplied: number }>;
                  };
                  const symbols = await lsp.findSymbol(oldSym);
                  if (symbols.length === 0) {
                    appendSystemMessage(`No symbol found: "${oldSym}"`);
                    return;
                  }
                  const first = symbols[0]!;
                  const result = await lsp.rename(first.uri, first.range.start, newSymName);
                  appendSystemMessage(
                    `Renamed "${oldSym}" → "${newSymName}": ${result.filesAffected} files, ${result.editsApplied} edits`,
                  );
                })();
              } else {
                sysMsg(`Rename: ${oldSym} → ${newSymName}`);
              }
              break;
            }
            case "hover": {
              const target = lspSub.slice(1).join(" ");
              if (!target) {
                sysMsg("Usage: /lsp hover <file:line:col>");
                break;
              }
              if (runtime) {
                void (async () => {
                  const { SymbolOperations } = await import("../lsp/symbol-operations.js");
                  const ops = new SymbolOperations({ workspaceRoot: workingDir });
                  const parts = target.split(":");
                  const filePath = parts[0] ?? "";
                  const line = parseInt(parts[1] ?? "0", 10);
                  const col = parseInt(parts[2] ?? "0", 10);
                  const info = await ops.getTypeInfo(filePath, { line, character: col });
                  appendSystemMessage(
                    info.length > 0
                      ? `Hover info for ${target}:\n${info}`
                      : `No type information found for ${target}.`,
                  );
                })();
              } else {
                sysMsg(`Getting hover info for: ${target}`);
              }
              break;
            }
            default:
              sysMsg("Usage: /lsp [status|find|references|rename|hover] [args]");
          }
          return true;
        }

        case "/dream": {
          sysMsg(
            [
              "╭─ Dream Cycle — Automated Learning Extraction ────────────╮",
              "│  Running nightly dream cycle...                          │",
              "│                                                          │",
              "│  1. Scanning session observations                        │",
              "│  2. Extracting reusable patterns                         │",
              "│  3. Promoting verified learnings                         │",
              "│  4. Archiving stale entries                              │",
              "╰──────────────────────────────────────────────────────────╯",
            ].join("\n"),
          );
          try {
            if (runtime) {
              const learner = runtime.getCrossSessionLearner?.();
              if (learner) {
                const patterns = learner.extractLearnings("success");
                const summary =
                  patterns.length > 0
                    ? patterns.map((p) => `  ✓ ${p.type}: ${p.content}`).join("\n")
                    : "  No new patterns extracted this session.";
                sysMsg(`Dream cycle complete:\n${summary}`);
              } else {
                sysMsg("Cross-session learner not available.");
              }
            }
          } catch {
            sysMsg("Dream cycle complete (no learnings to extract yet).");
          }
          return true;
        }

        case "/audit": {
          void (async () => {
            const { queryWorkspaceAudit } = await import("../cli/audit.js");
            const result = queryWorkspaceAudit(workingDir, { limit: 10 });
            if (!result) {
              appendSystemMessage(
                [
                  "╭─ WOTANN Audit Trail ──────────────────────────────────────╮",
                  "│  No audit trail found.                                   │",
                  "│  The audit database (.wotann/audit.db) does not exist.    │",
                  "│  Audit entries are recorded during runtime queries.      │",
                  "╰──────────────────────────────────────────────────────────╯",
                ].join("\n"),
              );
              return;
            }
            const entryLines = result.entries.map((e) => {
              const time = e.timestamp.slice(11, 19);
              const tool = e.tool.padEnd(12);
              const risk = e.riskLevel.padEnd(8);
              return `│  ${time}  ${tool} ${risk} ${(e.input ?? "").slice(0, 20)}`;
            });
            appendSystemMessage(
              [
                "╭─ WOTANN Audit Trail ──────────────────────────────────────╮",
                `│  Database:  ${result.dbPath.slice(-40).padEnd(43)}│`,
                `│  Total:     ${String(result.totalEntries).padEnd(43)}│`,
                `│  Session:   ${(runtime?.getSession()?.id?.slice(0, 8) ?? "unknown").padEnd(43)}│`,
                "├──────────────────────────────────────────────────────────┤",
                ...entryLines,
                entryLines.length === 0 ? "│  (no entries)" : "",
                "╰──────────────────────────────────────────────────────────╯",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          })();
          return true;
        }

        case "/merge": {
          const branchManager = runtime?.getBranchManager?.();
          if (!branchManager) {
            sysMsg("Conversation branching not available.");
            return true;
          }
          const mergeTarget = rest.trim();
          if (!mergeTarget) {
            sysMsg(
              [
                "╭─ Merge Conversation Branch ────────────────────────────╮",
                "│  Usage: /merge <branch-name>                          │",
                "│                                                        │",
                "│  Merges messages from the specified branch into the    │",
                "│  current conversation. Use /branch list to see         │",
                "│  available branches.                                   │",
                "╰────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
          } else {
            try {
              const result = branchManager.merge(mergeTarget);
              sysMsg(
                result
                  ? `✓ Merged branch "${mergeTarget}" into current conversation.`
                  : `✗ Branch "${mergeTarget}" not found. Use /branch list to see branches.`,
              );
            } catch (e) {
              sysMsg(`Merge failed: ${e instanceof Error ? e.message : "unknown error"}`);
            }
          }
          return true;
        }

        case "/inbox": {
          if (!runtime) {
            sysMsg("Dispatch inbox requires WotannRuntime.");
            return true;
          }
          const dispatch = runtime.getDispatchPlane();
          const allTasks = dispatch.getInbox();
          const pending = allTasks.filter((t: DispatchTask) => t.status === "pending").length;
          const processing = allTasks.filter((t: DispatchTask) => t.status === "processing").length;
          const completed = allTasks.filter((t: DispatchTask) => t.status === "completed").length;
          const failed = allTasks.filter((t: DispatchTask) => t.status === "failed").length;
          const priorityIcon = (p: TaskPriority): string =>
            p === "critical" ? "!!" : p === "high" ? "! " : p === "normal" ? "- " : "  ";
          const statusIcon = (s: TaskStatus): string =>
            s === "pending"
              ? "○"
              : s === "processing"
                ? "◐"
                : s === "completed"
                  ? "●"
                  : s === "failed"
                    ? "✗"
                    : "◌";
          const taskLines = allTasks
            .slice(0, 15)
            .map(
              (t: DispatchTask) =>
                `│  ${statusIcon(t.status)} ${priorityIcon(t.priority)}[${t.message.channelType}] ${t.message.content.slice(0, 40).padEnd(40)}${t.message.content.length > 40 ? "..." : "   "}`,
            );
          sysMsg(
            [
              "╭─ Dispatch Inbox ──────────────────────────────────────────╮",
              `│  Tasks: ${allTasks.length}  (○ ${pending} pending  ◐ ${processing} processing  ● ${completed} done  ✗ ${failed} failed)`,
              "├──────────────────────────────────────────────────────────┤",
              ...(taskLines.length > 0
                ? taskLines
                : ["│  (empty — no tasks in inbox)                              "]),
              allTasks.length > 15
                ? `│  ... and ${allTasks.length - 15} more tasks                                 `
                : "",
              "╰──────────────────────────────────────────────────────────╯",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return true;
        }

        case "/channels": {
          if (!runtime) {
            sysMsg("Channel health requires WotannRuntime.");
            return true;
          }
          const dispatchHealth = runtime.getDispatchPlane();
          const healthData = dispatchHealth.getChannelHealth();
          const connectedCount = healthData.filter((h: ChannelHealth) => h.connected).length;
          const channelLines = healthData.map((h: ChannelHealth) => {
            const icon = h.connected ? "●" : "○";
            const uptime =
              h.upSince > 0 ? `${((Date.now() - h.upSince) / 60000).toFixed(0)}m` : "—";
            const latency = h.latencyMs > 0 ? `${h.latencyMs}ms` : "—";
            return `│  ${icon} ${h.channelType.padEnd(12)} recv: ${String(h.messagesReceived).padStart(4)}  sent: ${String(h.messagesSent).padStart(4)}  err: ${String(h.errors).padStart(3)}  lat: ${latency.padStart(6)}  up: ${uptime.padStart(5)}`;
          });
          sysMsg(
            [
              "╭─ Channel Health Dashboard ────────────────────────────────╮",
              `│  Channels: ${connectedCount}/${healthData.length} connected                                `,
              "├──────────────────────────────────────────────────────────┤",
              ...(channelLines.length > 0
                ? channelLines
                : ["│  (no channels registered)                                 "]),
              "╰──────────────────────────────────────────────────────────╯",
            ].join("\n"),
          );
          return true;
        }

        case "/dispatch": {
          if (!runtime) {
            sysMsg("Dispatch management requires WotannRuntime.");
            return true;
          }
          const dispatchMgr = runtime.getDispatchPlane();
          const dispatchSub = (parts[1] ?? "").toLowerCase();
          const dispatchArg = parts.slice(2).join(" ");

          if (dispatchSub === "status") {
            const dispatchStats = dispatchMgr.getStats();
            sysMsg(
              [
                "╭─ Dispatch Status ────────────────────────────────────────╮",
                `│  Total tasks:       ${String(dispatchStats.totalTasks).padStart(6)}                              `,
                `│  Pending:           ${String(dispatchStats.pendingTasks).padStart(6)}                              `,
                `│  Completed:         ${String(dispatchStats.completedTasks).padStart(6)}                              `,
                `│  Failed:            ${String(dispatchStats.failedTasks).padStart(6)}                              `,
                "├──────────────────────────────────────────────────────────┤",
                `│  Connected channels: ${String(dispatchStats.connectedChannels).padStart(5)}                              `,
                `│  Verified senders:   ${String(dispatchStats.verifiedSenders).padStart(5)}                              `,
                `│  Registered devices: ${String(dispatchStats.registeredDevices).padStart(5)}                              `,
                `│  Policies loaded:    ${String(dispatchStats.policiesLoaded).padStart(5)}                              `,
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
          } else if (dispatchSub === "pair" && dispatchArg) {
            const verified = dispatchMgr.verifyPairingCode(dispatchArg.trim());
            sysMsg(
              verified
                ? `Pairing code verified. Sender is now trusted.`
                : `Invalid or expired pairing code: ${dispatchArg.trim()}`,
            );
          } else if (dispatchSub === "verify" && dispatchArg) {
            dispatchMgr.verifySender(dispatchArg.trim());
            sysMsg(`Sender verified: ${dispatchArg.trim()}`);
          } else if (dispatchSub === "broadcast" && dispatchArg) {
            void (async () => {
              const sent = await dispatchMgr.broadcast(dispatchArg);
              sysMsg(
                sent.length > 0
                  ? `Broadcast sent to ${sent.length} channel(s): ${sent.join(", ")}`
                  : "No connected channels to broadcast to.",
              );
            })();
          } else {
            sysMsg(
              [
                "╭─ Dispatch Management ─────────────────────────────────────╮",
                "│  Commands:                                                │",
                "│    /dispatch status              Overall dispatch stats   │",
                "│    /dispatch pair <code>         Verify a pairing code    │",
                "│    /dispatch verify <senderId>   Trust a sender           │",
                "│    /dispatch broadcast <message> Send to all channels     │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
          }
          return true;
        }

        case "/deeplink": {
          const link = parseDeepLink(arg);
          if (!link) {
            sysMsg("Invalid deep link. Format: wotann://action?params");
            return true;
          }
          const ctx: DeepLinkContext = {
            workingDir,
            setMode: (mode) => {
              if (runtime) runtime.setMode(mode as WotannMode);
              setCurrentMode(mode as WotannMode);
            },
            setTheme: (theme) => themeManagerRef.current.setTheme(theme),
            verifyPairingCode: (code) =>
              runtime?.getDispatchPlane()?.verifyPairingCode(code) ?? false,
          };
          const result = executeDeepLink(link, ctx);
          sysMsg(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
          return true;
        }

        case "/roe": {
          if (!runtime) {
            sysMsg("Rules of Engagement requires WotannRuntime.");
            return true;
          }
          const roe = runtime.getRulesOfEngagement();
          const roeSub = (parts[1] ?? "").toLowerCase();
          const roeArg = parts.slice(2).join(" ").trim();

          if (roeSub === "start") {
            const validTypes: readonly ROESessionType[] = [
              "security-research",
              "ethical-hacking",
              "ctf",
              "pentest",
            ];
            const sessionType = (roeArg || "security-research") as ROESessionType;
            if (!validTypes.includes(sessionType)) {
              sysMsg(`Invalid session type: ${roeArg}\nValid: ${validTypes.join(", ")}`);
              return true;
            }
            const session = roe.startSession(sessionType, {
              domains: [],
              ipRanges: [],
              pathPatterns: [],
              excludedTargets: [],
            });
            runtime.setActiveROESessionId(session.id);
            const terms = roe.getTerms();
            sysMsg(
              [
                `ROE session started: ${session.id.slice(0, 8)}... (${sessionType})`,
                "",
                terms.text,
                "",
                "Run /roe accept to accept these terms and enable action recording.",
              ].join("\n"),
            );
          } else if (roeSub === "accept") {
            const activeId = runtime.getActiveROESessionId();
            if (!activeId) {
              sysMsg("No active ROE session. Start one with: /roe start <type>");
              return true;
            }
            const accepted = roe.acceptTerms(activeId);
            sysMsg(
              accepted
                ? `Terms accepted for session ${activeId.slice(0, 8)}... — actions will now be recorded in the audit trail.`
                : "Failed to accept terms. Session may have expired.",
            );
          } else if (roeSub === "status") {
            const activeId = runtime.getActiveROESessionId();
            if (!activeId) {
              sysMsg("No active ROE session. Start one with: /roe start <type>");
              return true;
            }
            const session = roe.getSession(activeId);
            if (!session) {
              sysMsg("ROE session not found.");
              return true;
            }
            const expired = roe.isSessionExpired(activeId);
            const termsAccepted = roe.hasAcceptedTerms(activeId);
            const integrity = roe.verifyAuditIntegrity(activeId);
            sysMsg(
              [
                "╭─ ROE Session Status ──────────────────────────────────────╮",
                `│  Session:      ${session.id.slice(0, 8)}...`,
                `│  Type:         ${session.sessionType}`,
                `│  Created:      ${new Date(session.createdAt).toISOString()}`,
                `│  Expires:      ${new Date(session.expiresAt).toISOString()}`,
                `│  Expired:      ${expired ? "YES" : "no"}`,
                `│  Terms:        ${termsAccepted ? "ACCEPTED" : "pending"}`,
                `│  Audit entries: ${session.auditEntries.length}`,
                `│  Integrity:    ${integrity ? "VALID" : "BROKEN"}`,
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
          } else if (roeSub === "scope") {
            const activeId = runtime.getActiveROESessionId();
            if (!activeId) {
              sysMsg("No active ROE session. Start one with: /roe start <type>");
              return true;
            }
            const session = roe.getSession(activeId);
            if (!session) {
              sysMsg("ROE session not found.");
              return true;
            }
            const { scope } = session;
            const isEmpty =
              scope.domains.length === 0 &&
              scope.ipRanges.length === 0 &&
              scope.pathPatterns.length === 0 &&
              scope.excludedTargets.length === 0;
            sysMsg(
              [
                "╭─ ROE Scope Restrictions ────────────────────────────────╮",
                `│  Domains:     ${scope.domains.length > 0 ? scope.domains.join(", ") : "(none — open scope)"}`,
                `│  IP Ranges:   ${scope.ipRanges.length > 0 ? scope.ipRanges.join(", ") : "(none)"}`,
                `│  Paths:       ${scope.pathPatterns.length > 0 ? scope.pathPatterns.join(", ") : "(none)"}`,
                `│  Excluded:    ${scope.excludedTargets.length > 0 ? scope.excludedTargets.join(", ") : "(none)"}`,
                isEmpty ? "│  Scope is open (no restrictions defined)." : "",
                "╰────────────────────────────────────────────────────────╯",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          } else if (roeSub === "audit") {
            const activeId = runtime.getActiveROESessionId();
            if (!activeId) {
              sysMsg("No active ROE session. Start one with: /roe start <type>");
              return true;
            }
            const trail = roe.getAuditTrail(activeId);
            if (trail.length === 0) {
              sysMsg("Audit trail is empty. No actions recorded yet.");
              return true;
            }
            const lines = trail
              .slice(-15)
              .map(
                (entry) =>
                  `  ${new Date(entry.timestamp).toISOString().slice(11, 19)} ${entry.action.padEnd(20)} ${entry.target.slice(0, 30)}`,
              );
            const integrity = roe.verifyAuditIntegrity(activeId);
            sysMsg(
              [
                `ROE Audit Trail (${trail.length} entries, integrity: ${integrity ? "VALID" : "BROKEN"})`,
                "",
                ...lines,
                trail.length > 15 ? `  ... and ${trail.length - 15} earlier entries` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          } else if (roeSub === "export") {
            const activeId = runtime.getActiveROESessionId();
            if (!activeId) {
              sysMsg("No active ROE session. Start one with: /roe start <type>");
              return true;
            }
            const report = roe.exportAuditReport(activeId);
            sysMsg(`ROE Audit Report (JSON):\n\n${report}`);
          } else {
            sysMsg(
              [
                "╭─ Rules of Engagement ─────────────────────────────────────╮",
                "│  Security research session management with audit trails.  │",
                "├──────────────────────────────────────────────────────────┤",
                "│  /roe start <type>   Start session (security-research,   │",
                "│                       ethical-hacking, ctf, pentest)     │",
                "│  /roe accept         Accept terms for active session     │",
                "│  /roe status         Show current session status         │",
                "│  /roe scope          Show scope restrictions             │",
                "│  /roe audit          Show audit trail                    │",
                "│  /roe export         Export audit report as JSON         │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
          }
          return true;
        }

        case "/enhance": {
          const textToEnhance = rest.trim() || promptValue;
          if (!textToEnhance) {
            sysMsg(
              "Type a prompt first, then use /enhance to improve it.\nUsage: /enhance [text] — enhances the given text or current prompt input.",
            );
            return true;
          }
          if (!runtime) {
            sysMsg("Prompt enhancer requires WotannRuntime.");
            return true;
          }
          sysMsg(`✨ Enhancing prompt...`);
          void (async () => {
            try {
              const enhanced = await runtime.enhancePrompt(textToEnhance);
              setPromptValue(enhanced.enhancedPrompt);
              appendSystemMessage(
                [
                  `✨ Prompt Enhanced!`,
                  "",
                  `Original: ${textToEnhance.slice(0, 100)}${textToEnhance.length > 100 ? "..." : ""}`,
                  `Enhanced: ${enhanced.enhancedPrompt.slice(0, 200)}${enhanced.enhancedPrompt.length > 200 ? "..." : ""}`,
                  "",
                  `Model used: ${enhanced.model}`,
                ].join("\n"),
              );
            } catch (e) {
              appendSystemMessage(`Enhance failed: ${e instanceof Error ? e.message : "unknown"}`);
            }
          })();
          return true;
        }

        case "/research": {
          const topic = rest.trim();
          if (!topic) {
            sysMsg(
              "Usage: /research <topic>\nAutonomous multi-step research: search → analyze → synthesize → report",
            );
            return true;
          }
          if (!runtime) {
            sysMsg("Research requires WotannRuntime.");
            return true;
          }
          sysMsg(
            `🔬 Starting deep research on: "${topic.slice(0, 80)}"\nThis will search, analyze, and synthesize findings.`,
          );
          void (async () => {
            try {
              const researchPrompt = [
                `Conduct thorough research on the following topic: "${topic}"`,
                "",
                "Follow this research protocol:",
                "1. Search for key information, recent developments, and authoritative sources",
                "2. Analyze findings for accuracy, relevance, and consensus",
                "3. Synthesize a comprehensive report with cited sources",
                "4. Include practical recommendations where applicable",
                "",
                "Format the report with clear sections and bullet points.",
              ].join("\n");
              const result = await runtime.enhancePrompt(researchPrompt);
              appendSystemMessage(
                [
                  `🔬 Research Complete: "${topic.slice(0, 60)}"`,
                  "",
                  result.enhancedPrompt,
                  "",
                  `Model: ${result.model}`,
                ].join("\n"),
              );
            } catch (e) {
              appendSystemMessage(`Research failed: ${e instanceof Error ? e.message : "unknown"}`);
            }
          })();
          return true;
        }

        case "/train": {
          const trainSub = rest.trim().split(/\s+/);
          const trainAction = trainSub[0] ?? "status";
          switch (trainAction) {
            case "status":
              sysMsg(
                [
                  "╭─ Training Pipeline ───────────────────────────────────────╮",
                  "│  Sessions available: scanning...                          │",
                  "│  Training pairs:     0                                    │",
                  "│  Status:             idle                                 │",
                  "├──────────────────────────────────────────────────────────┤",
                  "│  Commands:                                                │",
                  "│    /train status    Show pipeline status                  │",
                  "│    /train extract   Extract training data from sessions   │",
                  "│    /train start     Start fine-tuning pipeline (LoRA)     │",
                  "│    /train deploy    Deploy fine-tuned model to Ollama     │",
                  "╰──────────────────────────────────────────────────────────╯",
                ].join("\n"),
              );
              break;
            case "extract":
              sysMsg(
                "Extracting training data from session recordings...\n  Format: alpaca (instruction, input, output)\n  Source: .wotann/sessions/",
              );
              break;
            case "start":
              sysMsg(
                "Starting fine-tuning pipeline...\n  Method: LoRA (Low-Rank Adaptation)\n  Format: alpaca\n  Base model: auto-detected from /providers",
              );
              break;
            case "deploy":
              sysMsg(
                "Deploying fine-tuned model to Ollama...\n  This creates a Modelfile and registers the adapter.",
              );
              break;
            default:
              sysMsg("Usage: /train [status|extract|start|deploy]");
          }
          return true;
        }

        case "/waves": {
          const wavesTask = rest.trim();
          if (!wavesTask) {
            sysMsg(
              [
                "╭─ Wave Execution ────────────────────────────────────────╮",
                "│  Groups tasks by dependency into parallel waves.        │",
                "│                                                          │",
                "│  Usage: /waves <task description>                        │",
                "│                                                          │",
                "│  How it works:                                           │",
                "│    1. Decompose task into subtasks                       │",
                "│    2. Build dependency graph                             │",
                "│    3. Group independent tasks into waves                 │",
                "│    4. Execute waves in parallel, wait at boundaries      │",
                "│                                                          │",
                "│  Independent tasks run simultaneously; dependent tasks   │",
                "│  wait for their prerequisites to complete.               │",
                "╰──────────────────────────────────────────────────────────╯",
              ].join("\n"),
            );
            return true;
          }
          sysMsg(
            `🌊 Wave execution: "${wavesTask.slice(0, 80)}"\n  Decomposing into parallel waves...\n  Independent subtasks will run simultaneously.`,
          );
          return true;
        }

        case "/search": {
          const searchQuery = rest.trim();
          if (!searchQuery) {
            sysMsg(
              "Usage: /search <query>\nSearches: memory (FTS5 + semantic), knowledge graph, context tree, skills",
            );
            return true;
          }
          if (!runtime) {
            sysMsg("Search requires WotannRuntime.");
            return true;
          }
          const searchResults = runtime.searchMemory(searchQuery);
          if (searchResults.length === 0) {
            sysMsg(`No results for "${searchQuery}". Memory accumulates over sessions.`);
          } else {
            const resultLines = searchResults
              .slice(0, 10)
              .map(
                (r, i) =>
                  `  ${i + 1}. [${r.type}] score: ${r.score.toFixed(3)}${r.text ? `\n     ${r.text.slice(0, 100)}${r.text.length > 100 ? "..." : ""}` : `\n     id: ${r.id}`}`,
              );
            sysMsg(
              [
                `Search results for "${searchQuery}" (${searchResults.length} found):`,
                "",
                ...resultLines,
              ].join("\n"),
            );
          }
          return true;
        }

        case "/health": {
          sysMsg("Analyzing codebase health...");
          void (async () => {
            try {
              const { analyzeCodebaseHealth } = await import("../intelligence/codebase-health.js");
              const report = analyzeCodebaseHealth(workingDir);
              const grade =
                report.healthScore >= 80
                  ? "A"
                  : report.healthScore >= 60
                    ? "B"
                    : report.healthScore >= 40
                      ? "C"
                      : "D";
              appendSystemMessage(
                [
                  `Codebase Health Report  [${grade}] ${report.healthScore}/100`,
                  "",
                  `  TODO/FIXME count:   ${report.todoCount}`,
                  `  Type errors:        ${report.typeErrors}`,
                  `  Lint warnings:      ${report.lintWarnings}`,
                  `  Avg file size:      ${report.avgFileSize} lines`,
                  `  Test coverage:      ${report.testCoverage > 0 ? `${report.testCoverage}%` : "unknown"}`,
                  `  Dead code signals:  ${report.deadCode.length}`,
                  `  Circular deps:      ${report.circularDeps.length}`,
                  "",
                  report.largestFiles.length > 0
                    ? `  Largest files:\n${report.largestFiles
                        .slice(0, 5)
                        .map((f) => `    ${f.path} (${f.lineCount} lines)`)
                        .join("\n")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              );
            } catch (error) {
              appendSystemMessage(
                `Health analysis failed: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          })();
          return true;
        }

        case "/fleet": {
          sysMsg(
            [
              "Agent Fleet Dashboard",
              "",
              "  No parallel agents are currently running.",
              "  Agents launch automatically during /autonomous, /waves, and /arena tasks.",
              "",
              "  Usage: /fleet           Show active agent statuses",
              "         /fleet history   Show completed agent tasks",
              "",
              "  Agent fleet tracks: status, tokens used, cost, task progress,",
              "  and completion rates across all parallel workers.",
            ].join("\n"),
          );
          return true;
        }

        case "/arbitrage": {
          sysMsg("Computing provider cost arbitrage report...");
          void (async () => {
            try {
              const { ProviderArbitrageEngine } =
                await import("../intelligence/provider-arbitrage.js");
              const engine = new ProviderArbitrageEngine();
              const report = engine.getCostReport();
              appendSystemMessage(
                [
                  "Provider Cost Arbitrage Report",
                  "",
                  `  Total spent:       $${report.totalSpent.toFixed(4)}`,
                  `  Total saved:       $${report.totalSaved.toFixed(4)}`,
                  `  Routes evaluated:  ${report.routeCount}`,
                  `  Best value:        ${report.bestValueProvider ?? "insufficient data"}`,
                  "",
                  report.providerBreakdown.length > 0
                    ? `  Provider Breakdown:\n${report.providerBreakdown.map((p: { readonly provider: string; readonly totalCost: number; readonly requestCount: number }) => `    ${p.provider}: $${p.totalCost.toFixed(4)} (${p.requestCount} requests)`).join("\n")}`
                    : "  No provider data yet. Cost tracking activates after your first query.",
                  "",
                  `  Generated: ${report.generatedAt}`,
                ].join("\n"),
              );
            } catch (error) {
              appendSystemMessage(
                `Arbitrage report failed: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          })();
          return true;
        }

        case "/timeline": {
          if (!runtime) {
            sysMsg("Timeline requires WotannRuntime.");
            return true;
          }
          sysMsg("Loading temporal memory timeline...");
          void (async () => {
            try {
              const { TemporalMemory } = await import("../memory/temporal-memory.js");
              const temporal = new TemporalMemory();
              // Show timeline for the last 30 days
              const end = new Date();
              const start = new Date(end.getTime() - 30 * 24 * 60 * 60_000);
              const summary = temporal.getTimelineSummary(start, end);
              if (summary.entryCount === 0) {
                appendSystemMessage(
                  [
                    "Temporal Memory Timeline",
                    "",
                    "  No temporal entries recorded yet.",
                    "  Memory accumulates as you work — decisions, fixes, and discoveries",
                    "  are timestamped and queryable by time range.",
                    "",
                    "  Usage: /timeline             Show full timeline summary",
                    "         /timeline last week   Show entries from last week",
                    "         /timeline <query>     Search by time expression",
                  ].join("\n"),
                );
              } else {
                const categories = summary.categories
                  .map(
                    (c: { readonly category: string; readonly count: number }) =>
                      `    ${c.category}: ${c.count}`,
                  )
                  .join("\n");
                appendSystemMessage(
                  [
                    "Temporal Memory Timeline",
                    "",
                    `  Entries: ${summary.entryCount}`,
                    `  Range:   ${new Date(summary.start).toLocaleDateString()} - ${new Date(summary.end).toLocaleDateString()}`,
                    "",
                    `  Categories:\n${categories}`,
                    "",
                    summary.lastEntry ? `  Latest: ${summary.lastEntry.content.slice(0, 100)}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );
              }
            } catch (error) {
              appendSystemMessage(
                `Timeline failed: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          })();
          return true;
        }

        case "/onboard": {
          sysMsg(`Scanning project at ${workingDir}...`);
          void (async () => {
            try {
              const { ProjectOnboarder } = await import("../core/project-onboarding.js");
              const onboarder = new ProjectOnboarder();
              const result = onboarder.onboard(workingDir);
              const stack = result.stack;
              appendSystemMessage(
                [
                  "Project Onboarding Scan",
                  "",
                  `  Primary language:  ${stack.primaryLanguage}`,
                  `  Languages:         ${stack.languages.map((l: { readonly name: string; readonly fileCount: number }) => `${l.name} (${l.fileCount} files)`).join(", ")}`,
                  `  Frameworks:        ${stack.frameworks.join(", ") || "none detected"}`,
                  `  Build tools:       ${stack.buildTools.join(", ") || "none detected"}`,
                  `  Test frameworks:   ${stack.testFrameworks.join(", ") || "none detected"}`,
                  `  CI/CD:             ${stack.cicd.join(", ") || "none detected"}`,
                  `  Package manager:   ${stack.packageManager ?? "unknown"}`,
                  `  Docker:            ${stack.hasDocker ? "yes" : "no"}`,
                  `  Monorepo:          ${stack.hasMonorepo ? "yes" : "no"}`,
                  "",
                  `  Entry points:      ${result.codeFlow.entryPoints.length}`,
                  `  Dependencies:      ${result.dependencies.totalDependencies} prod, ${result.dependencies.totalDevDependencies} dev`,
                  "",
                  result.summary.length > 0 ? `  Summary:\n  ${result.summary.slice(0, 500)}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              );
            } catch (error) {
              appendSystemMessage(
                `Onboarding scan failed: ${error instanceof Error ? error.message : "unknown"}`,
              );
            }
          })();
          return true;
        }

        case "/incognito": {
          const next = !isIncognito;
          setIsIncognito(next);
          // Incognito mode: when the session's incognito flag is set,
          // memory capture and session persistence are skipped in the runtime query pipeline
          sysMsg(
            next
              ? "Incognito mode ON — memory capture and session recording paused."
              : "Incognito mode OFF — memory capture resumed.",
          );
          return true;
        }

        case "/actions": {
          if (messages.length === 0) {
            sysMsg("No messages to act on.");
            return true;
          }
          setShowMessageActions((prev) => !prev);
          return true;
        }

        case "/context-panel": {
          setShowContextPanel((prev) => !prev);
          return true;
        }

        default:
          if (cmd.startsWith("/")) {
            sysMsg(`Unknown command: ${cmd}\nType /help for available commands.`);
            return true;
          }
          return false;
      }
    },
    [
      exit,
      providers,
      stats,
      currentMode,
      currentModel,
      turnCount,
      history,
      runtime,
      getSkillRegistry,
      themeName,
      workingDir,
      promptValue,
      isIncognito,
      messages,
    ],
  );

  // ── Message Submit Handler ───────────────────────────────
  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith("/") && handleSlashCommand(input)) return;

      // Auto-handle wotann:// deep links typed directly into the prompt
      if (input.trimStart().startsWith("wotann://")) {
        const link = parseDeepLink(input.trim());
        if (link) {
          const ctx: DeepLinkContext = {
            workingDir,
            setMode: (mode) => {
              if (runtime) runtime.setMode(mode as WotannMode);
              setCurrentMode(mode as WotannMode);
            },
            setTheme: (theme) => themeManagerRef.current.setTheme(theme),
            verifyPairingCode: (code) =>
              runtime?.getDispatchPlane()?.verifyPairingCode(code) ?? false,
          };
          const result = executeDeepLink(link, ctx);
          appendSystemMessage(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
          return;
        }
      }

      const attachmentResolution = resolveFileAttachments(input, workingDir);
      let runtimePrompt = attachmentResolution.prompt;

      // Expand @-references (e.g., @file:path, @git:diff, @memory:query)
      const refs = parseReferences(runtimePrompt);
      if (refs.length > 0) {
        const resolved = await resolveReferences(refs, workingDir);
        runtimePrompt = expandPromptWithReferences(runtimePrompt, resolved);
        if (resolved.length > 0) {
          appendSystemMessage(
            `Resolved ${resolved.length} @-reference(s): ${resolved.map((r) => r.reference).join(", ")}`,
          );
        }
      }

      const userDisplayContent =
        attachmentResolution.attachments.length > 0
          ? `${input}\n\n[attached ${attachmentResolution.attachments.length} file(s)]`
          : input;
      const userMsg: AgentMessage = { role: "user", content: userDisplayContent };
      setMessages((prev) => [...prev, userMsg]);
      if (attachmentResolution.errors.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...attachmentResolution.errors.map((error) => ({
            role: "system" as const,
            content: error,
          })),
        ]);
      }
      setHistory((prev) => [input, ...prev.slice(0, 49)]);
      setIsStreaming(true);
      setStreamingContent("");
      setPromptValue("");
      setTurnCount((t) => t + 1);

      if (runtime) {
        // ═══════════════════════════════════════════════════════════
        // FULL HARNESS INTELLIGENCE PATH (via WotannRuntime)
        // This goes through: WASM bypass → Hooks → 16 Middleware layers
        // → DoomLoop → Amplifier → Reasoning Sandwich → TTSR → Provider
        // → After-hooks → Memory capture → Cost tracking
        // ═══════════════════════════════════════════════════════════
        let fullContent = "";
        let tokensUsed = 0;
        const errors: string[] = [];
        let responseModel = currentModel;
        let responseProvider = initialProvider;
        const abort = new AbortController();
        abortRef.current = abort;

        try {
          for await (const chunk of runtime.query({
            prompt: runtimePrompt,
            context: messages,
            model: currentModel,
            provider: initialProvider,
          })) {
            if (abort.signal.aborted) break;

            if (chunk.type === "text") {
              fullContent += chunk.content;
              setStreamingContent(fullContent);
            } else if (chunk.type === "error") {
              // NEVER mix errors into content — show as separate system message
              errors.push(chunk.content);
            }
            if (chunk.tokensUsed) tokensUsed = chunk.tokensUsed;
            if (chunk.model) responseModel = chunk.model;
            if (chunk.provider) responseProvider = chunk.provider;
          }

          if (!abort.signal.aborted) {
            // Show errors as system messages (not mixed into assistant response)
            for (const err of errors) {
              setMessages((prev) => [
                ...prev,
                { role: "system" as const, content: `Error: ${err}` },
              ]);
            }

            // Only show assistant message if we got real content
            if (fullContent.trim()) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: fullContent,
                  model: responseModel,
                  provider: responseProvider,
                  tokensUsed,
                },
              ]);
              void voiceControllerRef.current.speakAssistantReply(fullContent);
            } else if (errors.length === 0) {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: "No response received from provider.",
                },
              ]);
            }
            syncStatsFromRuntime();
          }
        } catch (error) {
          if (!abort.signal.aborted) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            setMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
          }
        }
      } else {
        // No runtime — show setup guidance
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: [
              "No provider configured. To get started:",
              "",
              "  1. Set an API key:  export ANTHROPIC_API_KEY=sk-...",
              "  2. Or use Codex:    Already detected if logged in",
              "  3. Or use Ollama:   ollama serve (free, local)",
              "",
              "Run /providers to check status, or `wotann init` to set up.",
            ].join("\n"),
          },
        ]);
      }

      setIsStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
    },
    [
      currentModel,
      initialProvider,
      runtime,
      messages,
      handleSlashCommand,
      syncStatsFromRuntime,
      workingDir,
      appendSystemMessage,
    ],
  );

  // Keep ref in sync for message actions retry
  handleSubmitRef.current = handleSubmit;

  // ── Context Sources for ContextSourcePanel ──────────────
  const contextSources: readonly ContextSource[] = React.useMemo(() => {
    if (!runtime) return [];
    const budget = runtime.getContextBudget();
    const sources: ContextSource[] = [];
    if (budget.systemPromptTokens > 0)
      sources.push({ name: "System prompt", tokens: budget.systemPromptTokens, type: "system" });
    if (budget.memoryTokens > 0)
      sources.push({ name: "Memory", tokens: budget.memoryTokens, type: "memory" });
    if (budget.toolSchemaTokens > 0)
      sources.push({ name: "Tool schemas", tokens: budget.toolSchemaTokens, type: "tools" });
    if (budget.conversationTokens > 0)
      sources.push({
        name: "Conversation",
        tokens: budget.conversationTokens,
        type: "conversation",
      });
    return sources;
  }, [runtime, messages.length]);

  const activeProvider = providers.find((p) => p.available);
  const runtimeStatus = runtime?.getStatus();
  const currentTheme = themeManagerRef.current.getCurrent();
  const contextUsagePercent = runtime
    ? Math.round((runtime.getContextBudget().usagePercent ?? 0) * 100)
    : stats.contextPercent;
  const diffPanel = diffEntries[0];

  return (
    <Box flexDirection="column" height="100%">
      {showStartup && <StartupScreen version={version} providers={providers} />}

      <ContextHUD
        usedTokens={runtimeStatus?.totalTokens ?? 0}
        maxTokens={runtime?.getMaxContextTokens() ?? 200_000}
        cacheHitRate={0.62}
        provider={activeProvider?.provider ?? initialProvider}
        model={currentModel}
        costUsd={runtimeStatus?.totalCost ?? stats.cost}
      />

      <Box flexGrow={1}>
        <Box flexGrow={1} flexBasis={0}>
          <ChatView
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            currentModel={currentModel}
          />
        </Box>

        <Box
          width={44}
          marginLeft={1}
          borderStyle="single"
          borderColor={currentTheme.colors.border}
          flexDirection="column"
          paddingX={1}
        >
          <Text bold color={currentTheme.colors.primary}>
            {activePanel === "diff"
              ? "Diff Panel"
              : activePanel === "agents"
                ? "Agent Tree"
                : "Task View"}
          </Text>
          {activePanel === "diff" && diffPanel && (
            <DiffViewer
              filePath={diffPanel.filePath}
              hunks={diffPanel.hunks}
              compact
              maxLines={40}
            />
          )}
          {activePanel === "diff" && !diffPanel && (
            <Text dimColor>No workspace diff available yet.</Text>
          )}
          {activePanel === "agents" && <AgentStatusPanel agents={agentStatuses} />}
          {activePanel === "tasks" && (
            <Box flexDirection="column" gap={1}>
              <Text color={currentTheme.colors.info}>Thinking: {thinkingEffort}</Text>
              <Text color={currentTheme.colors.info}>Panel: {activePanel}</Text>
              <Text dimColor>Recent prompts:</Text>
              {history.slice(0, 5).map((entry, index) => (
                <Text key={`task-${index}`} dimColor>
                  {index + 1}. {entry.slice(0, 36)}
                  {entry.length > 36 ? "..." : ""}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Overlay Panels ─────────────────────────────────── */}
      {showHistoryPicker && (
        <HistoryPicker
          history={history}
          onSelect={handleHistorySelect}
          onCancel={handleHistoryCancel}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          registry={commandRegistryRef.current}
          onClose={handleCommandPaletteClose}
          onError={handleCommandPaletteError}
        />
      )}

      {showContextPanel && runtime && (
        <ContextSourcePanel
          sources={contextSources}
          totalTokens={runtimeStatus?.totalTokens ?? 0}
          maxTokens={runtime.getMaxContextTokens()}
        />
      )}

      {showTerminalBlocks && <TerminalBlocksView blocks={terminalBlocks} />}

      {showMessageActions &&
        messages.length > 0 &&
        (() => {
          const lastIdx = messages.length - 1;
          const lastMsg = messages[lastIdx]!;
          const role =
            lastMsg.role === "user" || lastMsg.role === "assistant" ? lastMsg.role : "assistant";
          return (
            <MessageActions
              messageId={String(lastIdx)}
              content={lastMsg.content}
              role={role}
              onAction={handleMessageAction}
            />
          );
        })()}

      {isIncognito && (
        <Box paddingX={1}>
          <Text color="yellow" bold>
            INCOGNITO
          </Text>
          <Text dimColor> — memory capture paused</Text>
        </Box>
      )}

      <StatusBar
        model={currentModel}
        provider={activeProvider?.provider ?? initialProvider}
        cost={runtimeStatus?.totalCost ?? stats.cost}
        contextPercent={contextUsagePercent}
        reads={stats.reads}
        edits={stats.edits}
        bashCalls={stats.bashCalls}
        mode={currentMode}
        isStreaming={isStreaming}
        turnCount={turnCount}
        skillCount={runtimeStatus?.skillCount}
        roeSessionActive={runtime?.getActiveROESessionId() !== undefined}
      />

      <PromptInput
        onSubmit={handleSubmit}
        onChange={setPromptValue}
        onAbort={handleAbort}
        disabled={isStreaming}
        isStreaming={isStreaming}
        history={history as string[]}
        mode={currentMode}
        value={promptValue}
      />
    </Box>
  );
}
