/**
 * WOTANN Desktop — Root application component.
 * Sets up the AppShell, keyboard shortcuts, theme management,
 * and the global notification toast overlay.
 *
 * V9 T14.4 — Norse motif wiring:
 *   - TwinRavenSplit       → cmd+shift+2 toggles split mode (passed via AppShell prop)
 *   - ConversationBraids   → cmd+shift+B opens a sheet rendered as a global modal
 *   - RavensFlightAnimation → mounted globally, listens to `wotann:dispatch-fired`
 *   - PatronSummoning      → opt-in via `wotann:open-patron` window event
 *   - SigilStamp + CostGlint are wired further down in FileTree / StatusBar
 *     (see those components for the import sites).
 */

import { useState, useCallback, useEffect } from "react";
import { useShortcuts } from "./hooks/useShortcuts";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useTheme } from "./hooks/useTheme";
import { useEngine } from "./hooks/useEngine";
import { useStreamListener } from "./hooks/useStreaming";
import { AppShell } from "./components/layout/AppShell";
import { NotificationToast, type ToastData } from "./components/notifications/NotificationToast";
import { Runering, emitRuneEvent, type RuneKind } from "./components/wotann/Runering";
import { KeyboardShortcutsOverlay } from "./components/shared/KeyboardShortcutsOverlay";
import { McpAppOverlay } from "./components/mcp-apps/McpAppOverlay";
import { ConversationBraids, type BraidThread } from "./components/chat/ConversationBraids";
import {
  RavensFlightAnimation,
  type RavenFlight,
} from "./components/chat/RavensFlightAnimation";
import { PatronSummoning, type Patron } from "./components/onboarding/PatronSummoning";

/**
 * Dispatch-fired event payload for RavensFlightAnimation. Pages or
 * RPC handlers `dispatchEvent(new CustomEvent("wotann:dispatch-fired",
 * { detail: { id, from?, to? } }))` to trigger a raven flight.
 */
interface DispatchFiredDetail {
  readonly id?: string;
  readonly from?: { x: number; y: number };
  readonly to?: { x: number; y: number };
}

export function App() {
  useShortcuts();
  useGlobalShortcuts();
  useTheme();
  useEngine();
  useStreamListener(); // ONE global listener for stream-chunk events

  const [toasts, setToasts] = useState<readonly ToastData[]>([]);

  // ── T14.4 motif state (kept local to App; AppShell receives a prop) ──

  /**
   * Twin-raven split toggle. Cmd+Shift+2 flips this — when true, the
   * AppShell renders the chat workspace inside <TwinRavenSplit/> with
   * Huginn (current chat) on the left and Muninn (memory recall) on the
   * right. Default off so the existing single-pane layout stays the
   * primary surface.
   */
  const [twinRavenSplit, setTwinRavenSplit] = useState(false);

  /** ConversationBraids modal toggle — cmd+shift+B. */
  const [braidsOpen, setBraidsOpen] = useState(false);

  /** PatronSummoning sheet toggle — opt-in via Settings or window event. */
  const [patronOpen, setPatronOpen] = useState(false);

  /** Active raven flights. Pruned by RavensFlightAnimation's onFlightComplete. */
  const [flights, setFlights] = useState<readonly RavenFlight[]>([]);

  // T14.4 keybindings — kept here so they live alongside the motif state.
  // The base keybinding map is in src/hooks/useShortcuts.ts; we layer the
  // motif bindings on top so they don't bloat that file with one-off motif
  // state. Both handlers are gated on cmd/ctrl + shift to avoid clashing
  // with text input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey) return;
      // Cmd+Shift+2 — toggle TwinRavenSplit on the chat workspace.
      if (e.key === "2" || e.code === "Digit2") {
        e.preventDefault();
        setTwinRavenSplit((prev) => !prev);
        return;
      }
      // Cmd+Shift+B — toggle the ConversationBraids modal.
      if (e.key === "B") {
        e.preventDefault();
        setBraidsOpen((prev) => !prev);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // RavensFlightAnimation subscriber. Anything in the app (RPC handler,
  // ChatView reducer, sidebar action) emits a `wotann:dispatch-fired`
  // CustomEvent and we add a flight to the list. Coordinates default to
  // viewport edges so the bird crosses the screen meaningfully even when
  // the dispatcher doesn't know exact pixel positions.
  useEffect(() => {
    function onDispatch(evt: Event) {
      const detail = (evt as CustomEvent<DispatchFiredDetail>).detail ?? {};
      const id =
        detail.id ?? `flight-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const h = typeof window !== "undefined" ? window.innerHeight : 800;
      const from = detail.from ?? { x: 0, y: h - 80 };
      const to = detail.to ?? { x: w, y: 80 };
      setFlights((prev) => [...prev, { id, from, to }]);
    }
    window.addEventListener("wotann:dispatch-fired", onDispatch);
    return () => window.removeEventListener("wotann:dispatch-fired", onDispatch);
  }, []);

  // PatronSummoning open-trigger subscriber. Settings (or any future
  // surface) emits `wotann:open-patron` to bring the sheet up.
  useEffect(() => {
    function onOpen() {
      setPatronOpen(true);
    }
    window.addEventListener("wotann:open-patron", onOpen);
    return () => window.removeEventListener("wotann:open-patron", onOpen);
  }, []);

  const handleFlightComplete = useCallback((flightId: string) => {
    setFlights((prev) => prev.filter((f) => f.id !== flightId));
  }, []);

  const handlePatronSelect = useCallback((patron: Patron) => {
    // Persist the choice locally so the app remembers across reloads.
    // The Settings UI is the canonical authority; this is just a quick
    // path so picking a patron from the sheet has a durable effect.
    try {
      localStorage.setItem("wotann-patron", patron);
    } catch {
      // localStorage can throw in private browsing — best-effort only.
    }
    // Mirror to the toast / rune system so the choice is acknowledged.
    if (typeof window !== "undefined") {
      const w = window as unknown as {
        __wotannToast?: (t: { type: ToastData["type"]; title: string; message?: string }) => void;
      };
      w.__wotannToast?.({
        type: "success",
        title: "Patron selected",
        message: `WOTANN will respond in the way of ${patron}.`,
      });
    }
    setPatronOpen(false);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Expose global helpers for non-prop-drilled dispatch. Components call:
  //   window.__wotannToast?.({ type, title, message? })  — push a toast
  //   window.__wotannEmitRune?.(kind, message?)           — trigger Runering
  //
  // The rune bridge is load-bearing for the Runering signature ritual: daemon
  // notification streams, CommandPalette actions, RPC handlers, and tool-use
  // reducers all dispatch via this function. The Runering component listens
  // to the `wotann:rune-event` window event the function emits, so no direct
  // React coupling is needed. Session-10 audit fix: previously mounted with
  // zero producers.
  if (typeof window !== "undefined") {
    (window as any).__wotannToast = (toast: Omit<ToastData, "id">) => {
      const newToast: ToastData = { ...toast, id: `toast-${Date.now()}-${crypto.randomUUID().slice(0, 6)}` };
      setToasts((prev) => [...prev, newToast]);
      // Auto-bridge memory-related toasts to a rune glyph so the ritual
      // fires for every memory save / recall event surfaced via toast.
      const title = (toast.title ?? "").toLowerCase();
      const msg = (toast.message ?? "").toLowerCase();
      const body = `${title} ${msg}`;
      const kind: RuneKind | null =
        body.includes("decision") || body.includes("decided") ? "decision" :
        body.includes("pattern") ? "pattern" :
        body.includes("discover") ? "discovery" :
        body.includes("blocker") || body.includes("stuck") ? "blocker" :
        body.includes("case") || body.includes("bug fix") ? "case" :
        body.includes("feedback") || body.includes("correction") ? "feedback" :
        body.includes("reference") || body.includes("link") ? "reference" :
        body.includes("memory") || body.includes("saved") ? "project" :
        null;
      if (kind) emitRuneEvent(kind, toast.title);
    };
    (window as any).__wotannEmitRune = emitRuneEvent;
  }

  // Demo seed for the ConversationBraids surface — three lanes with a
  // few events each. Kept inline because the modal is the only consumer
  // and we don't want to thread a fresh route just for this. When the
  // braids surface is wired to real data, this seed becomes the empty-
  // state fallback.
  const braidsSeed: readonly BraidThread[] = [
    {
      id: "main",
      title: "main",
      events: [
        { id: "m0", kind: "message", tick: 0 },
        { id: "m1", kind: "tool", tick: 1 },
        { id: "m2", kind: "fork", tick: 2, partnerThreadId: "side" },
        { id: "m3", kind: "message", tick: 4 },
      ],
    },
    {
      id: "side",
      title: "exploration",
      events: [
        { id: "s0", kind: "message", tick: 2 },
        { id: "s1", kind: "tool", tick: 3 },
        { id: "s2", kind: "merge", tick: 5, partnerThreadId: "main" },
      ],
    },
    {
      id: "memo",
      title: "memory",
      events: [
        { id: "k0", kind: "message", tick: 1 },
        { id: "k1", kind: "tool", tick: 3 },
        { id: "k2", kind: "message", tick: 5 },
      ],
    },
  ];

  return (
    <>
      <AppShell twinRavenSplit={twinRavenSplit} />
      <NotificationToast toasts={toasts} onDismiss={dismissToast} />
      {/* Signature WOTANN UI layers — global overlays. Each is self-contained
          and renders null when idle so they cost nothing when unused. */}
      <Runering />
      <KeyboardShortcutsOverlay />
      {/* V9 T4.2 — MCP App overlay. Listens to `wotann:mcp-app-mount`
          window events and renders sandboxed iframe Apps. Without this
          mount the McpAppHost component existed in isolation. */}
      <McpAppOverlay />

      {/* ── V9 T14.4 Norse motifs — wired global layers ─────────────── */}

      {/*
        RavensFlightAnimation: rendered at the document root so the bird
        can fly across the entire viewport regardless of layout. The
        component is fixed-positioned by its CSS so this mount point is
        purely about z-order and lifecycle.
      */}
      <RavensFlightAnimation
        flights={flights}
        onFlightComplete={handleFlightComplete}
      />

      {/*
        ConversationBraids modal. Cmd+Shift+B opens; clicking the
        backdrop or pressing Escape closes. We use a simple inline
        modal rather than the existing OverlayManager so the braid
        surface stays self-contained and the overlay system isn't
        coupled to a brand-new view enum.
      */}
      {braidsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Conversation braids"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBraidsOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setBraidsOpen(false);
          }}
          tabIndex={-1}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 9, 15, 0.78)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 32,
          }}
        >
          <div
            style={{
              width: "min(1100px, 100%)",
              maxHeight: "min(720px, 100%)",
              overflow: "auto",
              background: "var(--surface-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                Conversation braids
              </h2>
              <button
                type="button"
                aria-label="Close braids"
                onClick={() => setBraidsOpen(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--color-text-secondary)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </header>
            <ConversationBraids threads={braidsSeed} />
          </div>
        </div>
      )}

      {/*
        PatronSummoning modal. Open via `wotann:open-patron` window
        event (e.g., a "Choose patron" button in Settings). The sheet
        persists the user's pick to localStorage on select.
      */}
      {patronOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose patron"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPatronOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPatronOpen(false);
          }}
          tabIndex={-1}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 9, 15, 0.78)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "stretch",
            justifyContent: "center",
            zIndex: 1000,
            padding: 32,
          }}
        >
          <div
            style={{
              width: "min(1100px, 100%)",
              maxHeight: "100%",
              overflow: "auto",
              background: "var(--surface-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
            }}
          >
            <PatronSummoning
              onSelect={handlePatronSelect}
              initial={
                (typeof localStorage !== "undefined"
                  ? (localStorage.getItem("wotann-patron") as Patron | null)
                  : null) ?? undefined
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
