/**
 * Global keyboard shortcut registration.
 *
 * Shortcuts (redesigned):
 * - Cmd+1/2: Chat / Editor (primary views)
 * - Cmd+J: Toggle terminal panel
 * - Cmd+Shift+D: Toggle diff/changes panel
 * - Cmd+K: Command palette
 * - Cmd+B: Toggle sidebar
 * - Cmd+.: Toggle context panel
 * - Cmd+,: Settings
 * - Cmd+N: New conversation
 * - Cmd+P: File search in command palette
 * - Cmd+M: Toggle model picker
 * - Cmd+Shift+E: Enter code mode
 * - Cmd+Shift+M: Toggle meet mode
 * - Cmd+Shift+A: Quick actions
 * - Escape: Close overlays
 */

import { useEffect, useCallback } from "react";
import { useStore } from "../store";

export function useShortcuts() {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleContextPanel = useStore((s) => s.toggleContextPanel);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const toggleTerminalPanel = useStore((s) => s.toggleTerminalPanel);
  const toggleDiffPanel = useStore((s) => s.toggleDiffPanel);
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const activeOverlay = useStore((s) => s.activeOverlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const setView = useStore((s) => s.setView);
  const enterCodeMode = useStore((s) => s.enterCodeMode);
  const addConversation = useStore((s) => s.addConversation);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const currentProvider = useStore((s) => s.provider);
  const currentModel = useStore((s) => s.model);

  const createNewChat = useCallback(() => {
    const id = `conv-${Date.now()}`;
    addConversation({
      id,
      title: "New conversation",
      preview: "",
      updatedAt: Date.now(),
      // Provider neutrality fix (no anthropic default — empty signals not-configured).
      provider: currentProvider || "",
      model: currentModel || "",
      cost: 0,
      messageCount: 0,
    });
    setActiveConversation(id);
    setView("chat");
  }, [addConversation, setActiveConversation, setView, currentProvider, currentModel]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // ── Shift-modified shortcuts ──

      // Cmd+Shift+E: Enter Code Mode
      if (meta && e.shiftKey && e.key === "E") {
        e.preventDefault();
        enterCodeMode();
        return;
      }

      // Cmd+Shift+M: Toggle Meet Mode
      if (meta && e.shiftKey && e.key === "M") {
        e.preventDefault();
        const store = useStore.getState();
        store.setLayoutMode(store.layoutMode === "meet" ? "chat" : "meet");
        return;
      }

      // Cmd+Shift+A: Quick Actions overlay
      if (meta && e.shiftKey && e.key === "A") {
        e.preventDefault();
        openOverlay("quickActions");
        return;
      }

      // Cmd+Shift+D: Toggle diff/changes panel
      if (meta && e.shiftKey && e.key === "D") {
        e.preventDefault();
        toggleDiffPanel();
        return;
      }

      // Cmd+Shift+F: Search in files (opens command palette in file mode)
      if (meta && e.shiftKey && e.key === "F") {
        e.preventDefault();
        useStore.setState({ commandPaletteMode: "file-search" });
        const store = useStore.getState();
        if (!store.commandPaletteOpen) {
          store.toggleCommandPalette();
        }
        return;
      }

      // Cmd+Shift+L: Toggle Focus Mode (conversation 3-line collapse)
      if (meta && e.shiftKey && e.key === "L") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("wotann:toggle-focus-mode"));
        return;
      }

      // Cmd+Shift+T: Toggle The Well — shadow-git timeline scrubber
      // pinned to the editor footer. Matches the binding advertised in
      // KeyboardShortcutsOverlay.
      if (meta && e.shiftKey && e.key === "T") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("wotann:toggle-well"));
        return;
      }

      // Cmd+3 / Cmd+4: Workshop / Exploit (session-10 UX audit TD-8.1).
      // Cmd+1 / Cmd+2 already bound to Chat / Editor further down.
      if (meta && !e.shiftKey && e.key === "3") {
        e.preventDefault();
        setView("workshop");
        return;
      }
      if (meta && !e.shiftKey && e.key === "4") {
        e.preventDefault();
        setView("exploit");
        return;
      }

      // ── Standard shortcuts ──

      // Cmd+K: Command palette
      if (meta && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd+J: Toggle terminal panel
      if (meta && e.key === "j") {
        e.preventDefault();
        toggleTerminalPanel();
        return;
      }

      // Cmd+B: Toggle sidebar
      if (meta && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+.: Toggle context panel
      if (meta && e.key === ".") {
        e.preventDefault();
        toggleContextPanel();
        return;
      }

      // Cmd+,: Settings
      if (meta && e.key === ",") {
        e.preventDefault();
        setView("settings");
        return;
      }

      // Cmd+N: New conversation
      if (meta && e.key === "n") {
        e.preventDefault();
        createNewChat();
        return;
      }

      // Cmd+P: File search mode in command palette
      if (meta && e.key === "p") {
        e.preventDefault();
        useStore.setState({ commandPaletteMode: "file-search" });
        if (!commandPaletteOpen) {
          toggleCommandPalette();
        }
        return;
      }

      // Cmd+M: Toggle model picker overlay
      if (meta && e.key === "m") {
        e.preventDefault();
        if (activeOverlay === "modelPicker") {
          closeOverlay();
        } else {
          openOverlay("modelPicker");
        }
        return;
      }

      // Cmd+1/2: Primary view switching (Chat / Editor)
      if (meta && e.key === "1") { e.preventDefault(); setView("chat"); return; }
      if (meta && e.key === "2") { e.preventDefault(); setView("editor"); return; }

      // Cmd+`: Toggle terminal (legacy — also mapped to Cmd+J now)
      if (meta && e.key === "`") {
        e.preventDefault();
        toggleTerminalPanel();
        return;
      }

      // Escape: Close any active overlay
      if (e.key === "Escape") {
        if (activeOverlay) {
          closeOverlay();
          return;
        }
        if (commandPaletteOpen) {
          toggleCommandPalette();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    toggleSidebar, toggleContextPanel, toggleCommandPalette, toggleTerminalPanel, toggleDiffPanel,
    commandPaletteOpen, activeOverlay, openOverlay, closeOverlay,
    setView, enterCodeMode, createNewChat,
  ]);
}
