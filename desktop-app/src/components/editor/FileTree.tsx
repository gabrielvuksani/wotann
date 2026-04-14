/**
 * File Tree — VS Code-style project browser with colored file icons,
 * indentation guides, git status dots, and smooth expand/collapse.
 * Drag files into chat to add as context.
 */

import type React from "react";
import { useState, useRef, useEffect } from "react";
import type { FileTreeNode } from "../../types";

/** Inline style tag for file tree hover — avoids modifying globals.css */
const FILE_TREE_HOVER_STYLES = `
.file-tree-item:not([data-selected="true"]):hover {
  background: var(--bg-surface-hover) !important;
}
`;

// ── File Icon Color Map ─────────────────────────────────────────────

interface FileIconDef {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
}

const FILE_ICON_MAP: Record<string, FileIconDef> = {
  ts:   { label: "TS", bg: "var(--color-info-muted, rgba(59,130,246,0.15))",  fg: "var(--color-info, #3b82f6)" },
  tsx:  { label: "TS", bg: "var(--color-info-muted, rgba(59,130,246,0.15))",  fg: "var(--color-info, #3b82f6)" },
  js:   { label: "JS", bg: "var(--color-warning-muted, rgba(255,159,10,0.15))", fg: "var(--color-warning, #FF9F0A)" },
  jsx:  { label: "JX", bg: "var(--color-warning-muted, rgba(255,159,10,0.15))", fg: "var(--color-warning, #FF9F0A)" },
  py:   { label: "PY", bg: "var(--color-success-muted, rgba(48,209,88,0.15))", fg: "var(--color-success, #30D158)" },
  rs:   { label: "RS", bg: "var(--color-warning-muted, rgba(255,159,10,0.15))", fg: "var(--color-warning, #FF9F0A)" },
  go:   { label: "GO", bg: "var(--color-info-muted, rgba(6,182,212,0.15))",   fg: "var(--color-info, #06b6d4)" },
  java: { label: "JV", bg: "var(--color-error-muted, rgba(255,69,58,0.15))",   fg: "var(--color-error, #FF453A)" },
  swift:{ label: "SW", bg: "var(--color-warning-muted, rgba(255,159,10,0.15))", fg: "var(--color-warning, #FF9F0A)" },
  json: { label: "{}", bg: "var(--surface-3, rgba(161,161,170,0.12))",         fg: "var(--color-text-muted, #a1a1aa)" },
  yaml: { label: "YM", bg: "var(--surface-3, rgba(161,161,170,0.12))",         fg: "var(--color-text-muted, #a1a1aa)" },
  yml:  { label: "YM", bg: "var(--surface-3, rgba(161,161,170,0.12))",         fg: "var(--color-text-muted, #a1a1aa)" },
  md:   { label: "MD", bg: "var(--color-success-muted, rgba(20,184,166,0.15))", fg: "var(--color-success, #14b8a6)" },
  css:  { label: "CS", bg: "var(--accent-muted, rgba(10,132,255,0.15))",        fg: "var(--color-primary, #0A84FF)" },
  scss: { label: "SC", bg: "var(--accent-muted, rgba(10,132,255,0.15))",       fg: "var(--color-primary, #0A84FF)" },
  html: { label: "HT", bg: "var(--color-warning-muted, rgba(255,159,10,0.15))", fg: "var(--color-warning, #FF9F0A)" },
  sql:  { label: "SQ", bg: "var(--color-info-muted, rgba(59,130,246,0.15))",  fg: "var(--color-info, #3b82f6)" },
  sh:   { label: "SH", bg: "var(--color-success-muted, rgba(48,209,88,0.15))", fg: "var(--color-success, #30D158)" },
  toml: { label: "TM", bg: "var(--surface-3, rgba(161,161,170,0.12))",         fg: "var(--color-text-muted, #a1a1aa)" },
  lock: { label: "LK", bg: "var(--surface-3, rgba(113,113,122,0.12))",         fg: "var(--color-text-dim, #71717a)" },
};

function getFileIconDef(name: string): FileIconDef {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICON_MAP[ext] ?? { label: "", bg: "var(--surface-3, rgba(113,113,122,0.1))", fg: "var(--color-text-dim, #71717a)" };
}

// ── Git Status Dot Colors ───────────────────────────────────────────

const GIT_DOT_COLORS: Record<string, string> = {
  modified: "var(--color-warning)",
  staged: "var(--color-success)",
  untracked: "var(--info)",
};

// ── SVG Icons ───────────────────────────────────────────────────────

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 150ms ease",
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon({ expanded }: { readonly expanded: boolean }) {
  if (expanded) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path
          d="M1.5 3.5A1 1 0 012.5 2.5h3.172a1 1 0 01.707.293L7.5 3.914a1 1 0 00.707.293H13.5a1 1 0 011 1V5.5H2.5v-2zM1.5 5.5h13l-1.5 7.5H3L1.5 5.5z"
          fill="#fbbf24"
          opacity="0.9"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M2 3a1 1 0 011-1h3.172a1 1 0 01.707.293L8 3.414A1 1 0 008.707 3.707.5.5 0 008.5 4H14a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z"
        fill="#fbbf24"
        opacity="0.85"
      />
    </svg>
  );
}

function FileIconBadge({ name }: { readonly name: string }) {
  const def = getFileIconDef(name);

  // Default file: small gray dot
  if (!def.label) {
    return (
      <span style={{
        width: 16,
        height: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <span style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: def.fg,
          opacity: 0.6,
        }} />
      </span>
    );
  }

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 16,
      height: 16,
      borderRadius: 3,
      background: def.bg,
      color: def.fg,
      fontSize: 7,
      fontWeight: 700,
      fontFamily: "var(--font-mono)",
      letterSpacing: "-0.02em",
      lineHeight: 1,
      flexShrink: 0,
    }}>
      {def.label}
    </span>
  );
}

function GitStatusDot({ gitStatus }: { readonly gitStatus?: "modified" | "staged" | "untracked" | "none" }) {
  if (!gitStatus || gitStatus === "none") return null;
  const color = GIT_DOT_COLORS[gitStatus];
  if (!color) return null;

  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        marginLeft: "auto",
      }}
      title={gitStatus}
      aria-label={`Git status: ${gitStatus}`}
    />
  );
}

// ── Indentation Guide Lines ─────────────────────────────────────────

function IndentGuides({ depth }: { readonly depth: number }) {
  if (depth === 0) return null;

  const guides: React.ReactNode[] = [];
  for (let i = 0; i < depth; i++) {
    guides.push(
      <span
        key={i}
        style={{
          position: "absolute",
          left: 12 + i * 16,
          top: 0,
          bottom: 0,
          width: 1,
          background: "var(--border-subtle)",
          opacity: 0.5,
        }}
        aria-hidden="true"
      />
    );
  }

  return <>{guides}</>;
}

// ── Animated Folder Children ────────────────────────────────────────

function AnimatedChildren({
  expanded,
  children,
}: {
  readonly expanded: boolean;
  readonly children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<string>(expanded ? "none" : "0px");
  const [overflow, setOverflow] = useState<string>(expanded ? "visible" : "hidden");
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (expanded) {
        setMaxHeight("none");
        setOverflow("visible");
      }
      return;
    }

    const el = contentRef.current;
    if (!el) return;

    if (expanded) {
      const height = el.scrollHeight;
      setMaxHeight(`${height}px`);
      setOverflow("hidden");
      const timer = setTimeout(() => {
        setMaxHeight("none");
        setOverflow("visible");
      }, 200);
      return () => clearTimeout(timer);
    } else {
      // Force a reflow so the browser registers the current height
      const height = el.scrollHeight;
      setMaxHeight(`${height}px`);
      setOverflow("hidden");
      // Use requestAnimationFrame to ensure the transition triggers
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setMaxHeight("0px");
        });
      });
    }
  }, [expanded]);

  return (
    <div
      ref={contentRef}
      style={{
        maxHeight,
        overflow,
        transition: "max-height 200ms ease",
      }}
    >
      {children}
    </div>
  );
}

// ── Props ───────────────────────────────────────────────────────────

type ChangeKind = "added" | "modified" | "deleted";

const CHANGE_DOT_COLORS: Record<ChangeKind, string> = {
  added: "var(--color-success)",
  deleted: "var(--color-error)",
  modified: "var(--color-warning)",
};

interface FileTreeProps {
  readonly tree: readonly FileTreeNode[];
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleDir: (path: string) => void;
  readonly changedFiles?: ReadonlyMap<string, ChangeKind>;
}

// ── Main File Tree Component ────────────────────────────────────────

export function FileTree({ tree, selectedPath, onSelectFile, onToggleDir, changedFiles }: FileTreeProps) {
  return (
    <div
      className="h-full overflow-y-auto select-none"
      role="tree"
      aria-label="File explorer"
      style={{ fontSize: "var(--font-size-sm)", fontFamily: "var(--font-mono)" }}
    >
      <style>{FILE_TREE_HOVER_STYLES}</style>
      <div style={{
        padding: "8px 12px 6px",
        fontSize: "var(--font-size-2xs)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-muted)",
      }}>
        Explorer
      </div>
      <div style={{ padding: "0 4px 8px" }}>
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onToggleDir={onToggleDir}
            changedFiles={changedFiles}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tree Node (recursive) ───────────────────────────────────────────

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelectFile,
  onToggleDir,
  changedFiles,
}: {
  readonly node: FileTreeNode;
  readonly depth: number;
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleDir: (path: string) => void;
  readonly changedFiles?: ReadonlyMap<string, ChangeKind>;
}) {
  const isSelected = node.path === selectedPath;
  const paddingLeft = 8 + depth * 16;

  // ── Directory ─────────────────────────────────────────

  if (node.type === "directory") {
    const isExpanded = node.expanded ?? false;

    return (
      <div role="treeitem" aria-expanded={isExpanded}>
        <button
          onClick={() => onToggleDir(node.path)}
          className="file-tree-item"
          data-selected={isSelected}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 4,
            paddingLeft,
            paddingRight: 8,
            height: 32,
            borderRadius: "var(--radius-xs)",
            border: "none",
            background: isSelected ? "var(--accent-muted)" : "transparent",
            cursor: "pointer",
            position: "relative",
            transition: "background 200ms var(--ease-expo)",
          }}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${node.name}`}
        >
          <IndentGuides depth={depth} />
          <ChevronIcon expanded={isExpanded} />
          <FolderIcon expanded={isExpanded} />
          <span style={{
            color: "var(--color-text-primary)",
            fontWeight: 500,
            fontSize: "var(--font-size-sm)",
            lineHeight: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {node.name}
          </span>
        </button>

        <AnimatedChildren expanded={isExpanded}>
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              changedFiles={changedFiles}
            />
          ))}
        </AnimatedChildren>
      </div>
    );
  }

  // ── File ──────────────────────────────────────────────

  return (
    <button
      role="treeitem"
      aria-selected={isSelected}
      onClick={() => onSelectFile(node.path)}
      className="file-tree-item"
      data-selected={isSelected}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: paddingLeft + 20, // offset for chevron width alignment with folder content
        paddingRight: 8,
        height: 32,
        borderRadius: "var(--radius-xs)",
        border: "none",
        background: isSelected ? "var(--accent-muted)" : "transparent",
        borderLeft: isSelected ? "2px solid var(--color-primary)" : "2px solid transparent",
        color: isSelected ? "var(--color-primary)" : "var(--color-text-secondary)",
        cursor: "pointer",
        position: "relative",
        transition: "background 200ms var(--ease-expo), border-color 200ms var(--ease-expo), color 200ms var(--ease-expo)",
        fontSize: "var(--font-size-sm)",
        fontWeight: 400,
        fontFamily: "var(--font-mono)",
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", `@file:${node.path}`);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <IndentGuides depth={depth} />
      <FileIconBadge name={node.name} />
      <span style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}>
        {node.name}
      </span>
      {changedFiles?.has(node.path) && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: CHANGE_DOT_COLORS[changedFiles.get(node.path)!],
          }}
          title={`Agent change: ${changedFiles.get(node.path)}`}
          aria-label={`Agent change: ${changedFiles.get(node.path)}`}
        />
      )}
      <GitStatusDot gitStatus={node.gitStatus} />
    </button>
  );
}
