/**
 * Editor Tabs — multi-tab file editing with close, pin, drag reorder.
 */

import { useCallback } from "react";
import type { OpenFile } from "../../types";
import { getLanguageFromPath } from "./MonacoEditor";

// Language → accent color for tab indicator (CSS variables with fallbacks)
const LANG_COLORS: Record<string, string> = {
  typescript: "var(--color-info, #3b82f6)", typescriptreact: "var(--color-info, #3b82f6)",
  javascript: "var(--color-warning, #FF9F0A)", javascriptreact: "var(--color-warning, #FF9F0A)",
  python: "var(--color-success, #30D158)", rust: "var(--color-warning, #FF9F0A)",
  go: "var(--cyan, #06b6d4)", swift: "var(--color-warning, #fb923c)",
  json: "var(--color-text-muted, #a1a1aa)", yaml: "var(--color-text-muted, #a1a1aa)",
  markdown: "var(--color-text-dim, #71717a)", css: "var(--color-primary, #0A84FF)",
  html: "var(--color-error, #FF453A)", sql: "var(--color-info, #5AC8FA)",
};

interface EditorTabsProps {
  readonly files: readonly OpenFile[];
  readonly activeIndex: number;
  readonly onSelectTab: (index: number) => void;
  readonly onCloseTab: (index: number) => void;
}

export function EditorTabs({ files, activeIndex, onSelectTab, onCloseTab }: EditorTabsProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex items-center border-b overflow-x-auto" style={{ background: "var(--color-bg-primary)", borderColor: "var(--border-subtle)" }} role="tablist" aria-label="Open files">
      {files.map((file, i) => {
        const isActive = i === activeIndex;
        const lang = getLanguageFromPath(file.path);
        const langColor = LANG_COLORS[lang] ?? "var(--color-text-ghost, #52525b)";

        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={isActive}
            aria-label={`${file.name}${file.modified ? " (modified)" : ""}`}
            className="group flex items-center gap-1.5 px-3 cursor-pointer relative"
            style={{
              borderRight: "1px solid var(--border-subtle)",
              borderRadius: "10px 10px 0 0",
              height: 36,
              transition: "background 200ms var(--ease-expo), color 200ms var(--ease-expo)",
              fontSize: "var(--font-size-xs)",
              ...(isActive
                ? { background: "var(--accent-muted)", color: "var(--color-text-primary)" }
                : { background: "#1C1C1E", color: "var(--color-text-muted)" }),
            }}
            onClick={() => onSelectTab(i)}
          >
            {/* Language color indicator */}
            {isActive && (
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: langColor }} />
            )}

            {/* File name + modified indicator */}
            <span className="truncate max-w-[120px]">{file.name}</span>
            {file.modified && (
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--color-primary)" }} />
            )}

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(i);
              }}
              aria-label={`Close ${file.name}`}
              className={`ml-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] transition-colors ${
                isActive
                  ? "hover:bg-white/10"
                  : "opacity-0 group-hover:opacity-100 hover:bg-white/10"
              }`}
              style={{ color: isActive ? "var(--color-text-secondary)" : "var(--color-text-muted)" }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
