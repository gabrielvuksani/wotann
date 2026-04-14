/**
 * Editor Panel — the full IDE-like experience.
 * 3-column layout: File Tree | Editor + Tabs + Terminal | Chat Panel
 * This is what makes WOTANN compete with Cursor and VS Code.
 */

import { useState, useCallback, useEffect } from "react";
import { useMonaco } from "@monaco-editor/react";
import { FileTree } from "./FileTree";
import { EditorTabs } from "./EditorTabs";
import { MonacoEditor, getLanguageFromPath } from "./MonacoEditor";
import { EditorTerminal } from "./EditorTerminal";
import { SearchReplace } from "./SearchReplace";
import { DiffOverlay, useDiffActions } from "./DiffOverlay";
import { SymbolOutline } from "./SymbolOutline";
import { DesignModePanel } from "../design/DesignModePanel";
import type { FileTreeNode, OpenFile, EditorDiff } from "../../types";
import { readDirectory, readFile } from "../../store/engine";
import { createInlineProvider } from "./InlineCompletion";

/**
 * Language IDs receiving Cursor-style ghost-text completions. Only languages
 * where short code snippets add real value are enabled — prose formats
 * (markdown, plaintext) are intentionally excluded.
 */
const INLINE_COMPLETION_LANGUAGES: readonly string[] = [
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
  "python",
  "rust",
  "go",
];

export function EditorPanel() {
  const [fileTree, setFileTree] = useState<readonly FileTreeNode[]>([]);
  const [openFiles, setOpenFiles] = useState<readonly OpenFile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [designMode, setDesignMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeDiff, setActiveDiff] = useState<EditorDiff | null>(null);

  const activeFile = openFiles[activeIndex] ?? null;

  // Monaco instance — null until the first Monaco editor mounts. Once
  // available, we register our Cursor-style inline-completion provider so
  // every MonacoEditor instance inside this panel shares the same provider.
  const monaco = useMonaco();

  // Register the ghost-text inline-completions provider on Monaco mount.
  // We scope it to code languages where small completions add value and
  // resolve the active model on every call via monaco.editor.getEditors(),
  // so tab switches transparently re-target the currently focused buffer.
  useEffect(() => {
    if (!monaco) return;
    const disposable = monaco.languages.registerInlineCompletionsProvider(
      INLINE_COMPLETION_LANGUAGES,
      createInlineProvider(() => {
        // Prefer the focused editor; fall back to any live editor. This keeps
        // the provider functional even when focus briefly leaves the editor
        // (for example, when a completion is being previewed).
        const editors = monaco.editor.getEditors();
        const focused = editors.find((e) => e.hasTextFocus()) ?? editors[0];
        return focused?.getModel() ?? null;
      }),
    );
    return () => disposable.dispose();
  }, [monaco]);

  // Diff actions hook — only active when a diff is present
  const diffActions = useDiffActions(
    activeDiff ?? { filePath: "", hunks: [], additions: 0, deletions: 0 },
    activeFile?.content ?? "",
  );

  const handleDiffAccepted = useCallback(async () => {
    const wrote = await diffActions.writeAccepted();
    if (wrote) {
      setActiveDiff(null);
    }
  }, [diffActions]);

  // Listen for agent-generated diffs via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<EditorDiff>).detail;
      if (detail) {
        setActiveDiff(detail);
      }
    };
    window.addEventListener("wotann:editor-diff", handler);
    return () => window.removeEventListener("wotann:editor-diff", handler);
  }, []);

  // Listen for terminal toggle event (dispatched by Cmd+` shortcut)
  useEffect(() => {
    const handler = () => {
      setTerminalOpen((prev) => !prev);
    };
    window.addEventListener("wotann:toggle-terminal", handler);
    return () => window.removeEventListener("wotann:toggle-terminal", handler);
  }, []);

  // Load initial directory tree from engine
  useEffect(() => {
    let cancelled = false;
    async function loadTree() {
      setLoading(true);
      const tree = await readDirectory(".");
      if (!cancelled) {
        setFileTree(tree);
        setLoading(false);
      }
    }
    loadTree();
    return () => { cancelled = true; };
  }, []);

  const toggleDir = useCallback((path: string) => {
    setFileTree((prev) => toggleTreeNode(prev, path));
  }, []);

  const selectFile = useCallback(async (path: string) => {
    setSelectedPath(path);
    // Check if already open
    const existingIndex = openFiles.findIndex((f) => f.path === path);
    if (existingIndex >= 0) {
      setActiveIndex(existingIndex);
      return;
    }
    // Load file content from engine
    const name = path.split("/").pop() ?? path;
    const content = await readFile(path);
    const newFile: OpenFile = {
      path,
      name,
      language: getLanguageFromPath(path),
      content: content ?? `// Could not load ${path}`,
      modified: false,
    };
    setOpenFiles((prev) => [...prev, newFile]);
    setActiveIndex(openFiles.length);
  }, [openFiles]);

  const closeTab = useCallback((index: number) => {
    setOpenFiles((prev) => prev.filter((_, i) => i !== index));
    if (activeIndex >= index && activeIndex > 0) {
      setActiveIndex(activeIndex - 1);
    }
  }, [activeIndex]);

  const handleContentChange = useCallback((value: string) => {
    setOpenFiles((prev) =>
      prev.map((f, i) =>
        i === activeIndex ? { ...f, content: value, modified: true } : f,
      ),
    );
  }, [activeIndex]);

  return (
    <div className="flex h-full" style={{ background: "var(--color-bg-primary)" }} role="region" aria-label="Code editor">
      {/* File Tree — collapses when no project open */}
      <div className="border-r flex-shrink-0" style={{ width: fileTree.length > 0 ? 220 : 160, borderColor: "var(--border-subtle)", background: "#000000", transition: "width 200ms var(--ease-expo)" }} role="navigation" aria-label="File explorer">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading files...</span>
          </div>
        ) : fileTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-4 gap-3">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-dim)", opacity: 0.5 }}>
              <path d="M2 3h5l2 2h5v8H2V3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
              No project open
            </p>
            <button
              onClick={async () => {
                try {
                  const { open } = await import("@tauri-apps/plugin-dialog");
                  const selected = await open({ directory: true, multiple: false });
                  if (selected) {
                    const tree = await readDirectory(selected as string);
                    setFileTree(tree);
                  }
                } catch {
                  // Fallback: load current directory
                  const tree = await readDirectory(".");
                  setFileTree(tree);
                }
              }}
              className="btn-press"
              style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, padding: "4px 12px", borderRadius: "var(--radius-sm)", background: "var(--bg-surface)", color: "var(--color-text-secondary)", border: "1px solid var(--border-subtle)", cursor: "pointer" }}
            >
              Open Folder
            </button>
          </div>
        ) : (
          <FileTree
            tree={fileTree}
            selectedPath={selectedPath}
            onSelectFile={selectFile}
            onToggleDir={toggleDir}
          />
        )}
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <EditorTabs
          files={openFiles}
          activeIndex={activeIndex}
          onSelectTab={setActiveIndex}
          onCloseTab={closeTab}
        />

        {/* Diff Overlay — shown when agent proposes changes */}
        {activeDiff && (
          <div className="p-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <DiffOverlay
              diff={activeDiff}
              {...diffActions.handlers}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                onClick={handleDiffAccepted}
                className="px-3 py-1 text-xs font-medium text-white rounded-md transition-colors"
                style={{ background: "var(--color-success)" }}
              >
                Apply Accepted
              </button>
              <button
                onClick={() => setActiveDiff(null)}
                className="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                style={{ background: "var(--surface-3)", color: "var(--color-text-secondary)" }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Monaco Editor */}
        <div className="flex-1 min-h-0">
          {activeFile ? (
            <MonacoEditor
              filePath={activeFile.path}
              content={activeFile.content}
              language={activeFile.language}
              onChange={handleContentChange}
            />
          ) : (
            <div className="h-full flex items-center justify-center" style={{ color: "var(--color-text-muted)" }}>
              <div className="text-center">
                <div style={{ marginBottom: 16, opacity: 0.4 }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                    <polyline points="13 2 13 9 20 9" />
                    <line x1="10" y1="13" x2="14" y2="13" />
                    <line x1="10" y1="17" x2="14" y2="17" />
                  </svg>
                </div>
                <p style={{ fontSize: "var(--font-size-base)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Select a file to edit</p>
                <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
                  Choose from the file tree or drag files into chat
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Panel — uses real shell execution via Tauri */}
        {terminalOpen && (
          <div className="h-[200px] border-t relative" style={{ borderColor: "var(--border-subtle)" }}>
            <button
              onClick={() => setTerminalOpen(false)}
              className="absolute top-1 right-2 z-10 text-xs transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              aria-label="Close terminal"
            >
              ✕
            </button>
            <EditorTerminal />
          </div>
        )}

        {/* Design Mode Panel — shows BrowserPreview + VisualInspector */}
        {designMode && (
          <DesignModePanel
            onClose={() => setDesignMode(false)}
          />
        )}

        {/* Bottom toolbar: Terminal + Search + Design Mode buttons */}
        {!terminalOpen && (
          <div className="flex items-center border-t" style={{ borderColor: "var(--border-subtle)", height: 32, background: "#1C1C1E" }}>
            <button
              onClick={() => setTerminalOpen(true)}
              className="flex items-center gap-1.5 px-3 text-xs"
              style={{ color: "var(--color-text-muted)", height: 32, transition: "color 200ms var(--ease-expo)" }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M5 7l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Terminal
            </button>
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="flex items-center gap-1.5 px-3 text-xs"
              style={{ color: searchOpen ? "var(--color-primary)" : "var(--color-text-muted)", height: 32, transition: "color 200ms var(--ease-expo)" }}
              aria-label="Toggle search panel"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Search
            </button>
            <button
              onClick={() => setDesignMode(!designMode)}
              className="flex items-center gap-1.5 px-3 text-xs"
              style={{ color: designMode ? "var(--color-primary)" : "var(--color-text-muted)", height: 32, transition: "color 200ms var(--ease-expo)" }}
              aria-label={designMode ? "Close design mode" : "Open design mode"}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 6h4v4H6z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Design
            </button>
            <button
              onClick={() => setOutlineOpen(!outlineOpen)}
              className="flex items-center gap-1.5 px-3 text-xs"
              style={{ color: outlineOpen ? "var(--color-primary)" : "var(--color-text-muted)", height: 32, transition: "color 200ms var(--ease-expo)" }}
              aria-label={outlineOpen ? "Close outline" : "Open outline"}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 4h10M3 8h7M3 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Outline
            </button>
          </div>
        )}
      </div>

      {/* Search Panel — right sidebar in editor */}
      {searchOpen && (
        <div className="w-[300px] border-l flex-shrink-0" style={{ borderColor: "var(--border-subtle)" }}>
          <SearchReplace />
        </div>
      )}

      {/* Outline Panel — LSP symbol outline (D8) */}
      {outlineOpen && (
        <div className="flex-shrink-0" style={{ width: 280 }}>
          <SymbolOutline filePath={activeFile?.path ?? null} />
        </div>
      )}
    </div>
  );
}

// Helper: toggle expanded state of a directory node
function toggleTreeNode(nodes: readonly FileTreeNode[], path: string): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === path && node.type === "directory") {
      return { ...node, expanded: !node.expanded };
    }
    if (node.children) {
      return { ...node, children: toggleTreeNode(node.children, path) };
    }
    return node;
  });
}
