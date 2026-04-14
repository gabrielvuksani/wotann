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

  // Expose a global function so any component can push toasts without prop drilling.
  // Components call: window.__wotannToast?.({ type, title, message? })
  if (typeof window !== "undefined") {
    (window as any).__wotannToast = (toast: Omit<ToastData, "id">) => {
      const newToast: ToastData = { ...toast, id: `toast-${Date.now()}-${crypto.randomUUID().slice(0, 6)}` };
      setToasts((prev) => [...prev, newToast]);
    };
  }

  return (
    <>
      <AppShell />
      <NotificationToast toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
