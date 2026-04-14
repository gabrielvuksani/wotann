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
import { SettingsView } from "../settings/SettingsView";
import { MemoryInspector } from "../memory/MemoryInspector";
import { CostDashboard } from "../health/CostDashboard";
import { CommandPalette } from "../palette/CommandPalette";
import { DisconnectedBanner } from "../shared/ErrorState";
import { OnboardingView } from "../onboarding/OnboardingView";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { QuickActionsOverlay } from "../palette/QuickActionsOverlay";
import { MeetPanel } from "../meet/MeetPanel";

/* Lazy-loaded heavy views (code-split for faster initial load) */
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

/** Resolve the view component for the main workspace area. */
function WorkspaceContent({ view }: { readonly view: string }) {
  switch (view) {
    case "chat":
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
      return <ErrorBoundary><SettingsView /></ErrorBoundary>;
    case "memory":
      return <ErrorBoundary><MemoryInspector /></ErrorBoundary>;
    case "cost":
      return <ErrorBoundary><CostDashboard /></ErrorBoundary>;
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
    default:
      return <ErrorBoundary><ChatView /></ErrorBoundary>;
  }
}

export function AppShell() {
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
    return <OnboardingView />;
  }

  return (
    <ErrorBoundary>
      <div
        className="flex h-screen w-screen overflow-hidden relative"
        style={{ background: "var(--color-bg-primary)", color: "var(--color-text-primary)" }}
        role="application"
        aria-label="WOTANN Desktop"
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

          {/* Disconnected banner */}
          {!engineConnected && (
            <DisconnectedBanner onRetry={() => initializeFromEngine()} />
          )}

          {/* Content + panels area */}
          <div className="flex-1 flex min-h-0">
            {/* Main workspace + terminal (vertical stack) */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Workspace view (takes remaining height) */}
              <div className="flex-1 min-h-0 flex flex-col">
                <WorkspaceContent view={currentView} />
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
              <MeetPanel onClose={() => setLayoutMode("chat")} />
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

          <StatusBar />
        </main>

        {/* Command palette overlay */}
        {commandPaletteOpen && (
          <div role="dialog" aria-modal="true" aria-label="Command palette">
            <CommandPalette onClose={toggleCommandPalette} />
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
