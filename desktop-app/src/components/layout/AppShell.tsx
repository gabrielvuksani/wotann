/**
 * Root layout shell — the entire app structure.
 *
 * Layout: sidebar | header + main workspace + optional panels | context panel
 *
 * Panel architecture (redesign):
 * - Chat & Editor: the two primary views (pills in header)
 * - Terminal: bottom panel, toggles independently (Cmd+J)
 * - Diff/Changes: right panel, toggles independently (Cmd+Shift+D)
 * - Both panels work on ANY view and can be open simultaneously
 * - Workshop is accessed via Worker Pill in sidebar
 * - Exploit/Compare/Settings/Memory/Cost are accessed via Cmd+K or StatusBar
 */

import { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
import { useStore } from "../../store";
import { initializeFromEngine } from "../../store/engine";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { ContextPanel } from "./ContextPanel";
import { TerminalPanel } from "./TerminalPanel";
import { DiffPanel } from "./DiffPanel";
import { ChatView } from "../chat/ChatView";
import { DisconnectedBanner } from "../shared/ErrorState";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { QuickActionsOverlay } from "../palette/QuickActionsOverlay";
import { TwinRavenSplit } from "./TwinRavenSplit";
import { SigilStamp, type SigilKind } from "../editor/SigilStamp";
import { CostGlint } from "../cost/CostGlint";

// ── V9 T14.4 helpers ─────────────────────────────────────────

/** Shape of a `wotann:agent-edit` window event detail. */
interface AgentEditDetail {
  readonly path: string;
  readonly kind: SigilKind; // "modified" | "created" | "deleted"
}

/** Free-tier provider names. Matches the canonical FREE_PROVIDERS list in
 *  src/providers/fallback-chain.ts so the CostGlint sheen only fires for
 *  paid (BYOK) keys. Anything else (anthropic, openai, openrouter, etc.)
 *  is treated as paid. */
const FREE_PROVIDERS = new Set<string>([
  "gemini",
  "ollama",
  "free",
  "lmstudio",
  "lm-studio",
  "gpt4all",
]);

/** Format a USD cost for the CostGlint badge. */
function formatCost(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

/** Recently-edited entry for the Creations strip. */
interface CreationEntry {
  readonly id: string;
  readonly path: string;
  readonly kind: SigilKind;
  readonly at: number;
}

/** Truncate a filesystem path to its final 28 characters or so for the strip. */
function shortPath(path: string): string {
  if (path.length <= 32) return path;
  const segments = path.split(/[\\/]/);
  if (segments.length <= 2) return `…${path.slice(-30)}`;
  return `…/${segments.slice(-2).join("/")}`;
}

/* Lazy-loaded heavy views (code-split for faster initial load).
 *
 * Wave-4D: SettingsView/MemoryInspector/CostDashboard/CommandPalette/
 * OnboardingView/MeetPanel were previously eager imports — they're
 * conditionally rendered but their modules (and every dep they pull,
 * e.g. qrcode.react via SettingsView, the full OnboardingView wizard)
 * landed in the entry chunk. Making them lazy drops them into their
 * own chunks, which is the main lever for getting index.js under the
 * 500 kB budget. */
const SettingsView = lazy(() => import("../settings/SettingsView").then((m) => ({ default: m.SettingsView })));
const MemoryInspector = lazy(() => import("../memory/MemoryInspector").then((m) => ({ default: m.MemoryInspector })));
const CostDashboard = lazy(() => import("../health/CostDashboard").then((m) => ({ default: m.CostDashboard })));
const CommandPalette = lazy(() => import("../palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const OnboardingView = lazy(() => import("../onboarding/OnboardingView").then((m) => ({ default: m.OnboardingView })));
const MeetPanel = lazy(() => import("../meet/MeetPanel").then((m) => ({ default: m.MeetPanel })));
const EditorPanel = lazy(() => import("../editor/EditorPanel").then((m) => ({ default: m.EditorPanel })));
const ArenaView = lazy(() => import("../arena/ArenaView").then((m) => ({ default: m.ArenaView })));
const ExploitView = lazy(() => import("../exploit/ExploitView").then((m) => ({ default: m.ExploitView })));
const WorkshopView = lazy(() => import("../workshop/WorkshopView").then((m) => ({ default: m.WorkshopView })));
const IntelligenceDashboard = lazy(() => import("../intelligence/IntelligenceDashboard").then((m) => ({ default: m.IntelligenceDashboard })));
const CanvasView = lazy(() => import("../canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const AgentFleetDashboard = lazy(() => import("../agents/AgentFleetDashboard").then((m) => ({ default: m.AgentFleetDashboard })));
const ConnectorsGUI = lazy(() => import("../connectors/ConnectorsGUI").then((m) => ({ default: m.ConnectorsGUI })));
const ProjectList = lazy(() => import("../projects/ProjectList").then((m) => ({ default: m.ProjectList })));
const DispatchInbox = lazy(() => import("../dispatch/DispatchInbox").then((m) => ({ default: m.DispatchInbox })));
const ExecApprovals = lazy(() => import("../security/ExecApprovals").then((m) => ({ default: m.ExecApprovals })));
const PluginManager = lazy(() => import("../plugins/PluginManager").then((m) => ({ default: m.PluginManager })));
const DesignModePanel = lazy(() => import("../design/DesignModePanel").then((m) => ({ default: m.DesignModePanel })));
const CodePlayground = lazy(() => import("../playground/CodePlayground").then((m) => ({ default: m.CodePlayground })));
const ScheduledTasks = lazy(() => import("../tasks/ScheduledTasks").then((m) => ({ default: m.ScheduledTasks })));
const ComputerUsePanel = lazy(() => import("../computer-use/ComputerUsePanel").then((m) => ({ default: m.ComputerUsePanel })));
const CouncilView = lazy(() => import("../council/CouncilView").then((m) => ({ default: m.CouncilView })));
const TrainingReview = lazy(() => import("../intelligence/TrainingReview").then((m) => ({ default: m.TrainingReview })));
const TrustView = lazy(() => import("../trust/TrustView").then((m) => ({ default: m.TrustView })));
const IntegrationsView = lazy(() => import("../integrations/IntegrationsView").then((m) => ({ default: m.IntegrationsView })));
// V9 T10.3 — agentic Browse tab (was ZERO callers per audit).
const BrowsePanel = lazy(() => import("../browse/BrowsePanel").then((m) => ({ default: m.BrowsePanel })));
// V9 T5.12 — cross-device Fleet Dashboard (separate from local AgentFleetDashboard).
const FleetDashboard = lazy(() => import("../fleet/FleetDashboard").then((m) => ({ default: m.FleetDashboard })));

// ── Resizable Panel Hook ───────────────────────────────────────────

function useResizable(
  initialSize: number,
  minSize: number,
  maxSize: number,
  storageKey: string,
  axis: "vertical" | "horizontal",
) {
  const [size, setSize] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored ? parseInt(stored, 10) : initialSize;
  });
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      startPosRef.current = axis === "vertical" ? e.clientY : e.clientX;
      startSizeRef.current = size;
      document.body.style.userSelect = "none";
      document.body.style.cursor = axis === "vertical" ? "row-resize" : "col-resize";
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [size, axis],
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const pos = axis === "vertical" ? e.clientY : e.clientX;
      // For vertical (terminal): dragging up = larger; for horizontal (diff): dragging left = larger
      const delta = startPosRef.current - pos;
      const newSize = Math.max(minSize, Math.min(maxSize, startSizeRef.current + delta));
      setSize(newSize);
    };
    const onPointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(storageKey, String(size));
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [minSize, maxSize, storageKey, size, axis]);

  return { size, isDragging, onPointerDown };
}

/** Loading placeholder for lazy-loaded views. */
function ViewSkeleton() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      color: "var(--text-dim)",
    }}>
      Loading...
    </div>
  );
}

/** Resolve the view component for the main workspace area.
 *
 * `twinRavenSplit`: when true and the current view is "chat", wrap the
 * chat surface in <TwinRavenSplit/> with Huginn (chat) on the left and
 * Muninn (memory recall) on the right. The split is layout-only — both
 * panes still get the live chat / memory state via their own components.
 */
function WorkspaceContent({
  view,
  twinRavenSplit = false,
}: {
  readonly view: string;
  readonly twinRavenSplit?: boolean;
}) {
  switch (view) {
    case "chat":
      if (twinRavenSplit) {
        return (
          <ErrorBoundary>
            <TwinRavenSplit
              left={<ChatView />}
              right={
                <Suspense fallback={<ViewSkeleton />}>
                  <MemoryInspector />
                </Suspense>
              }
              className="twin-raven-split--chat"
              style={{ height: "100%" }}
            />
          </ErrorBoundary>
        );
      }
      return <ErrorBoundary><ChatView /></ErrorBoundary>;
    case "editor":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><EditorPanel /></Suspense></ErrorBoundary>;
    case "workshop":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><WorkshopView /></Suspense></ErrorBoundary>;
    case "exploit":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ExploitView /></Suspense></ErrorBoundary>;
    case "compare":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ArenaView /></Suspense></ErrorBoundary>;
    case "settings":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><SettingsView /></Suspense></ErrorBoundary>;
    case "memory":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><MemoryInspector /></Suspense></ErrorBoundary>;
    case "cost":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><CostDashboard /></Suspense></ErrorBoundary>;
    case "intelligence":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><IntelligenceDashboard /></Suspense></ErrorBoundary>;
    case "canvas":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><CanvasView /></Suspense></ErrorBoundary>;
    case "agents":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><AgentFleetDashboard /></Suspense></ErrorBoundary>;
    case "connectors":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ConnectorsGUI /></Suspense></ErrorBoundary>;
    case "projects":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ProjectList /></Suspense></ErrorBoundary>;
    case "dispatch":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><DispatchInbox /></Suspense></ErrorBoundary>;
    case "approvals":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ExecApprovals /></Suspense></ErrorBoundary>;
    case "plugins":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><PluginManager /></Suspense></ErrorBoundary>;
    case "design":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><DesignModePanel onClose={() => useStore.getState().setView("chat")} /></Suspense></ErrorBoundary>;
    case "playground":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><CodePlayground /></Suspense></ErrorBoundary>;
    case "schedule":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ScheduledTasks /></Suspense></ErrorBoundary>;
    case "computer-use":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><ComputerUsePanel /></Suspense></ErrorBoundary>;
    case "council":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><CouncilView /></Suspense></ErrorBoundary>;
    case "training":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><TrainingReview /></Suspense></ErrorBoundary>;
    case "trust":
    case "proofs":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><TrustView /></Suspense></ErrorBoundary>;
    case "integrations":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><IntegrationsView /></Suspense></ErrorBoundary>;
    case "browse":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><BrowsePanel /></Suspense></ErrorBoundary>;
    case "fleet":
      return <ErrorBoundary><Suspense fallback={<ViewSkeleton />}><FleetDashboard /></Suspense></ErrorBoundary>;
    default:
      return <ErrorBoundary><ChatView /></ErrorBoundary>;
  }
}

/**
 * AppShell props.
 *
 * `twinRavenSplit` is the V9 T14.4 motif toggle owned by `App.tsx`.
 * When true, chat workspace renders inside the dual-pane Huginn/Muninn
 * surface. We accept it as a prop (rather than reading from the store)
 * so the motif state stays local to App.tsx where the keybinding lives.
 */
export interface AppShellProps {
  readonly twinRavenSplit?: boolean;
}

export function AppShell({ twinRavenSplit = false }: AppShellProps = {}) {
  const [sidebarWidth] = useState(250);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const contextPanelOpen = useStore((s) => s.contextPanelOpen);
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const activeOverlay = useStore((s) => s.activeOverlay);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const currentView = useStore((s) => s.currentView);
  const layoutMode = useStore((s) => s.layoutMode);
  const setLayoutMode = useStore((s) => s.setLayoutMode);
  const engineConnected = useStore((s) => s.engineConnected);
  const onboardingComplete = useStore((s) => s.onboardingComplete);
  const terminalPanelOpen = useStore((s) => s.terminalPanelOpen);
  const diffPanelOpen = useStore((s) => s.diffPanelOpen);
  const isMeetActive = layoutMode === "meet";

  // ── V9 T14.4 — SigilStamp wiring ──────────────────────────
  //
  // Subscribe to `wotann:agent-edit` window events emitted by tool-use
  // handlers / RPC handlers when the agent modifies the workspace. We
  // keep the most recent 5 entries and render them as a "Creations"
  // strip just above the StatusBar. Each entry uses SigilStamp to mark
  // the filename with the appropriate gold/moss/blood underline.
  //
  // The strip is opt-in: it stays empty (and renders nothing) until at
  // least one event fires, so existing layouts are unaffected.
  const [creations, setCreations] = useState<readonly CreationEntry[]>([]);
  useEffect(() => {
    function onEdit(evt: Event) {
      const detail = (evt as CustomEvent<AgentEditDetail>).detail;
      if (!detail || typeof detail.path !== "string") return;
      const kind: SigilKind =
        detail.kind === "created" || detail.kind === "deleted" ? detail.kind : "modified";
      const entry: CreationEntry = {
        id: `${Date.now()}-${detail.path}`,
        path: detail.path,
        kind,
        at: Date.now(),
      };
      setCreations((prev) => {
        // Drop any earlier entry for the same path so the latest kind
        // is the one we surface, then keep the trailing 5 most recent.
        const filtered = prev.filter((c) => c.path !== detail.path);
        const next = [...filtered, entry];
        return next.length > 5 ? next.slice(next.length - 5) : next;
      });
    }
    window.addEventListener("wotann:agent-edit", onEdit);
    return () => window.removeEventListener("wotann:agent-edit", onEdit);
  }, []);

  // ── V9 T14.4 — CostGlint wiring ───────────────────────────
  //
  // The sheen reads as "this number is real money" — we only flip
  // `paid={true}` when the active provider is a BYOK key. Free / local
  // providers (ollama, gemini free tier, etc.) keep the sheen quiet so
  // running locally never feels visually taxed.
  const provider = useStore((s) => s.provider);
  const cost = useStore((s) => s.cost);
  const isPaidProvider =
    provider !== "" && !FREE_PROVIDERS.has(provider.toLowerCase());

  const terminalResize = useResizable(220, 120, 500, "wotann-terminal-height", "vertical");
  const diffResize = useResizable(380, 280, 600, "wotann-diff-width", "horizontal");

  // Dev: ?reset=1 clears onboarding state
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("reset")) {
    localStorage.removeItem("wotann-onboarded");
    window.location.href = window.location.pathname;
    return null;
  }

  // Show onboarding on first launch
  if (!onboardingComplete) {
    return (
      <Suspense fallback={<ViewSkeleton />}>
        <OnboardingView />
      </Suspense>
    );
  }

  // `data-space` drives dynamic glass tinting (liquid-glass.css). The
  // four primary spaces each project a different tint so glass chrome
  // tracks the active mode. Anything else maps to "chat" for a safe
  // default instead of unstyled neutral.
  const glassSpace: "chat" | "editor" | "workshop" | "exploit" =
    currentView === "editor" || currentView === "workshop" || currentView === "exploit"
      ? currentView
      : "chat";

  return (
    <ErrorBoundary>
      <div
        className="flex h-screen w-screen overflow-hidden relative"
        style={{ background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
        role="application"
        aria-label="WOTANN Desktop"
        data-space={glassSpace}
      >
        {/* Ambient glow */}
        <div
          className="pointer-events-none fixed top-0 right-0 z-0"
          style={{
            width: 400,
            height: 400,
            background: `radial-gradient(circle at center, var(--ambient-glow), transparent 70%)`,
          }}
          aria-hidden="true"
        />

        {/* Skip to main content link */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:text-white focus:rounded-lg"
          style={{ background: "var(--color-primary)" }}
        >
          Skip to main content
        </a>

        {/* Left sidebar */}
        <nav
          aria-label="Sidebar navigation"
          className="sidebar-slide shrink-0"
          style={{
            width: sidebarOpen ? sidebarWidth : 0,
            overflow: "hidden",
            transition: "width var(--transition-normal)",
            background: "var(--surface-1)",
            borderRight: sidebarOpen ? "1px solid var(--border-subtle)" : "none",
          }}
        >
          <div
            className={`h-full ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          >
            <Sidebar />
          </div>
        </nav>

        {/* Main content area */}
        <main
          id="main-content"
          className="flex-1 flex flex-col min-w-0"
          aria-label="Main content"
        >
          <Header />

          {/* Disconnected banner. Rendered unconditionally so the component can
              reset its dismissed-flag in localStorage when the engine reconnects
              — otherwise a user who dismissed once stays dismissed forever. */}
          <DisconnectedBanner
            engineConnected={engineConnected}
            onRetry={async () => {
              // Previous wiring just re-ran initializeFromEngine() which
              // queries the daemon but never respawns it. When the daemon
              // was dead (socket missing / stale), Reconnect did nothing
              // visible. Now: ask Rust to actually restart the sidecar,
              // then refresh state once the socket is up.
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("restart_engine");
              } catch {
                /* fall through to init — worst case the watchdog
                   eventually catches up on its next tick */
              }
              await initializeFromEngine();
            }}
          />

          {/* Content + panels area */}
          <div className="flex-1 flex min-h-0">
            {/* Main workspace + terminal (vertical stack) */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Workspace view (takes remaining height).
                  `key={currentView}` forces React to re-mount so the
                  view-enter animation replays on every tab switch. */}
              <div key={currentView} className="flex-1 min-h-0 flex flex-col view-enter">
                <WorkspaceContent view={currentView} twinRavenSplit={twinRavenSplit} />
              </div>

              {/* Terminal bottom panel — independent toggle, resizable from AppShell */}
              {terminalPanelOpen && (
                <div
                  className="flex flex-col shrink-0"
                  style={{
                    height: terminalResize.size,
                    transition: terminalResize.isDragging ? "none" : "height var(--transition-normal)",
                  }}
                >
                  <div
                    onPointerDown={terminalResize.onPointerDown}
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize terminal panel"
                    tabIndex={0}
                    style={{
                      height: 4,
                      cursor: "row-resize",
                      background: terminalResize.isDragging ? "var(--color-primary)" : "var(--border-subtle)",
                      transition: terminalResize.isDragging ? "none" : "background var(--transition-fast)",
                      flexShrink: 0,
                    }}
                  />
                  <div className="flex-1 min-h-0">
                    <TerminalPanel />
                  </div>
                </div>
              )}
            </div>

            {/* Diff/Changes right panel — independent toggle, resizable from AppShell */}
            {diffPanelOpen && (
              <div
                className="flex shrink-0 h-full"
                style={{
                  width: diffResize.size,
                  transition: diffResize.isDragging ? "none" : "width var(--transition-normal)",
                }}
              >
                <div
                  onPointerDown={diffResize.onPointerDown}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize changes panel"
                  tabIndex={0}
                  style={{
                    width: 4,
                    cursor: "col-resize",
                    background: diffResize.isDragging ? "var(--color-primary)" : "var(--border-subtle)",
                    transition: diffResize.isDragging ? "none" : "background var(--transition-fast)",
                    flexShrink: 0,
                  }}
                />
                <div className="flex-1 min-w-0 h-full">
                  <DiffPanel />
                </div>
              </div>
            )}

            {/* Meet panel — slides in when meet mode is active */}
            {isMeetActive && (
              <Suspense fallback={<ViewSkeleton />}>
                <MeetPanel onClose={() => setLayoutMode("chat")} />
              </Suspense>
            )}

            {/* Context panel */}
            {!isMeetActive && (
              <aside
                aria-label="Context panel"
                className="shrink-0"
                style={{
                  width: contextPanelOpen ? 288 : 0,
                  overflow: "hidden",
                  transition: "width var(--transition-normal)",
                  borderLeft: contextPanelOpen ? "1px solid var(--border-subtle)" : "none",
                }}
              >
                <div
                  className={`w-72 h-full context-panel-slide ${contextPanelOpen ? "context-panel-visible" : "context-panel-hidden"}`}
                >
                  <ContextPanel />
                </div>
              </aside>
            )}
          </div>

          {/*
            V9 T14.4 — Creations strip. Sits between the workspace area and
            the StatusBar. Renders only when at least one agent edit has
            fired so existing layouts stay unchanged. Each entry is a
            <SigilStamp/> badge with the gold/moss/blood underline that
            matches the change kind.
          */}
          {creations.length > 0 && (
            <div
              className="creations-strip"
              role="status"
              aria-label="Recent agent edits"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "4px 12px",
                background: "var(--surface-1)",
                borderTop: "1px solid var(--border-subtle)",
                fontSize: 11,
                color: "var(--color-text-secondary)",
                overflowX: "auto",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <span style={{ opacity: 0.7, fontWeight: 600, letterSpacing: "0.04em" }}>
                Creations
              </span>
              {creations.map((entry) => (
                <SigilStamp
                  key={entry.id}
                  filename={shortPath(entry.path)}
                  kind={entry.kind}
                />
              ))}
            </div>
          )}

          {/*
            V9 T14.4 — Cost glint. Mirrors the active session cost just
            above the StatusBar so the sheen reads alongside the rest of
            the chrome. The StatusBar still owns the canonical cost text
            — this is the polished-metal accent that signals BYOK. We
            only render when the user has at least an entered provider so
            the glance line stays empty during onboarding.
          */}
          {provider !== "" && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "2px 12px",
                background: "transparent",
                fontSize: 11,
                pointerEvents: "none",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <CostGlint
                paid={isPaidProvider}
                value={formatCost(cost.sessionCost)}
                title={
                  isPaidProvider
                    ? `Session cost — paid (${provider})`
                    : `Session cost — free (${provider})`
                }
              />
            </div>
          )}

          <StatusBar />
        </main>

        {/* Command palette overlay */}
        {commandPaletteOpen && (
          <div role="dialog" aria-modal="true" aria-label="Command palette">
            <Suspense fallback={<ViewSkeleton />}>
              <CommandPalette onClose={toggleCommandPalette} />
            </Suspense>
          </div>
        )}

        {/* Quick actions overlay (Cmd+Shift+A) */}
        {activeOverlay === "quickActions" && (
          <QuickActionsOverlay onClose={closeOverlay} />
        )}
      </div>
    </ErrorBoundary>
  );
}
