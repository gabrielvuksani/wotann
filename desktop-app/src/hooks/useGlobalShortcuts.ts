/**
 * Global keyboard shortcuts — system-wide, work even when app is not focused.
 * Registered via @tauri-apps/plugin-global-shortcut (Tauri v2).
 *
 * Shortcuts:
 * - Cmd+Shift+N → Toggle WOTANN window visibility
 * - Cmd+Shift+Space → Open quick prompt overlay
 * - Cmd+Shift+Escape → Emergency stop all Computer Use actions
 *
 * These are GLOBAL (OS-level) shortcuts, not app-scoped.
 * They degrade gracefully if the plugin is unavailable.
 */

import { useEffect } from "react";
import { useStore } from "../store";

export function useGlobalShortcuts() {
  const openOverlay = useStore((s) => s.openOverlay);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    async function registerGlobalShortcuts() {
      try {
        const { register, unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");

        // Cmd+Shift+N → Toggle window visibility
        await register("CommandOrControl+Shift+N", async () => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const win = getCurrentWindow();
            const visible = await win.isVisible();
            if (visible) {
              await win.hide();
            } else {
              await win.show();
              await win.setFocus();
            }
          } catch { /* window API unavailable */ }
        });

        // Cmd+Shift+Space → Quick prompt overlay
        await register("CommandOrControl+Shift+Space", () => {
          openOverlay("quickActions");
        });

        // Cmd+Shift+Escape → Emergency stop all Computer Use actions
        await register("CommandOrControl+Shift+Escape", async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("stop_computer_use");
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const win = getCurrentWindow();
            await win.emit("cu-emergency-stop", {});
          } catch { /* CU not active or API unavailable */ }
        });

        cleanup = () => {
          unregisterAll().catch(() => {});
        };
      } catch {
        // Plugin unavailable (not in Tauri context, or Rust crate disabled)
        // Global shortcuts will not work — app-scoped shortcuts in useShortcuts.ts still function
      }
    }

    // Defer registration to avoid interfering with app startup
    const timer = setTimeout(registerGlobalShortcuts, 1000);

    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [openOverlay]);
}
