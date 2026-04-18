/**
 * WOTANN Desktop — Root application component.
 * Sets up the AppShell, keyboard shortcuts, theme management,
 * and the global notification toast overlay.
 */

import { useState, useCallback } from "react";
import { useShortcuts } from "./hooks/useShortcuts";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useTheme } from "./hooks/useTheme";
import { useEngine } from "./hooks/useEngine";
import { useStreamListener } from "./hooks/useStreaming";
import { AppShell } from "./components/layout/AppShell";
import { NotificationToast, type ToastData } from "./components/notifications/NotificationToast";
import { Runering, emitRuneEvent, type RuneKind } from "./components/wotann/Runering";
import { KeyboardShortcutsOverlay } from "./components/shared/KeyboardShortcutsOverlay";

export function App() {
  useShortcuts();
  useGlobalShortcuts();
  useTheme();
  useEngine();
  useStreamListener(); // ONE global listener for stream-chunk events

  const [toasts, setToasts] = useState<readonly ToastData[]>([]);

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

  return (
    <>
      <AppShell />
      <NotificationToast toasts={toasts} onDismiss={dismissToast} />
      {/* Signature WOTANN UI layers — global overlays. Each is self-contained
          and renders null when idle so they cost nothing when unused. */}
      <Runering />
      <KeyboardShortcutsOverlay />
    </>
  );
}
