/**
 * Left sidebar — Project-grouped conversations (T3 Code inspired).
 *
 * Structure (top to bottom):
 * 1. Brand row: W logo + "WOTANN" + New Chat + Settings gear
 * 2. Search bar with Cmd+K hint
 * 3. Project groups (collapsible, colored icon)
 *    - Each project: conversations with status dots + title + time
 *    - Active conversation: thin violet left bar with glow
 * 4. Worker Pill (ambient, compact)
 *
 * Sub-tabs (Threads/Files/Workers/Findings) are REMOVED.
 * Files live in Editor view only. Workers are in the Worker Pill.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useStore } from "../../store";
import type { ConversationSummary } from "../../types";
import { WorkerPill } from "./WorkerPill";

// ── Relative time formatting ───────────────────────────

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Project grouping ──────────────────────────────────

/** A project group with collapsible conversations. */
interface ProjectGroup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly items: readonly ConversationSummary[];
}

/** Colors for project icons (first letter circle). */
/** Group conversations into project groups.
 * For now, pinned conversations get their own "Pinned" group,
 * and the rest go into a "Workspace" group. When projects are
 * available from the engine, this will use real project assignments.
 */
function groupByProject(conversations: readonly ConversationSummary[]): readonly ProjectGroup[] {
  const pinned: ConversationSummary[] = [];
  const workspace: ConversationSummary[] = [];

  for (const conv of conversations) {
    if (conv.pinned) {
      pinned.push(conv);
    } else {
      workspace.push(conv);
    }
  }

  const groups: ProjectGroup[] = [];
  if (pinned.length > 0) {
    groups.push({ id: "pinned", name: "Pinned", color: "#f59e0b", items: pinned });
  }
  if (workspace.length > 0) {
    groups.push({ id: "workspace", name: "Workspace", color: "#0A84FF", items: workspace });
  }
  return groups;
}

// ── Conversation status ────────────────────────────────

type ConversationStatus = "working" | "pending" | "done" | "idle";

// ── Component ──────────────────────────────────────────

export function Sidebar() {
  const conversations = useStore((s) => s.conversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const addConversation = useStore((s) => s.addConversation);
  const setView = useStore((s) => s.setView);
  const engineConnected = useStore((s) => s.engineConnected);
  const agents = useStore((s) => s.agents);
  const isStreaming = useStore((s) => s.isStreaming);
  const currentProvider = useStore((s) => s.provider);
  const currentModel = useStore((s) => s.model);
  const notifications = useStore((s) => s.notifications);

  const [searchQuery, setSearchQuery] = useState("");
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());

  // Mark initial load as done
  useEffect(() => {
    if (engineConnected && !initialLoadDone) {
      const timer = setTimeout(() => setInitialLoadDone(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [engineConnected, initialLoadDone]);

  useEffect(() => {
    if (conversations.length > 0 && !initialLoadDone) {
      setInitialLoadDone(true);
    }
  }, [conversations.length, initialLoadDone]);

  // Pending approval detection
  const pendingApprovalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of notifications) {
      if (n.type === "approval" && !n.read && activeConversationId) {
        ids.add(activeConversationId);
      }
    }
    return ids;
  }, [notifications, activeConversationId]);

  const getConversationStatus = useCallback(
    (convId: string): ConversationStatus => {
      if (convId === activeConversationId && isStreaming) return "working";
      if (pendingApprovalIds.has(convId)) return "pending";
      if (convId === activeConversationId && agents.some((a) => a.status === "running")) return "working";
      return "idle";
    },
    [activeConversationId, isStreaming, pendingApprovalIds, agents],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  // Group filtered results by project
  const projectGroups = useMemo(() => groupByProject(filtered), [filtered]);

  const handleNewChat = useCallback(() => {
    const id = `conv-${Date.now()}`;
    addConversation({
      id,
      title: "New conversation",
      preview: "",
      updatedAt: Date.now(),
      provider: currentProvider || "anthropic",
      model: currentModel || "claude-opus-4-6",
      cost: 0,
      messageCount: 0,
    });
    setActiveConversation(id);
    setView("chat");
  }, [addConversation, setActiveConversation, setView, currentProvider, currentModel]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  return (
    <aside
      className="sidebar-container"
      aria-label="Sidebar"
    >
      {/* 1. Brand bar + actions */}
      <div className="sidebar-brand" style={{ justifyContent: "space-between" }}>
        <div className="flex items-center gap-2">
          <div className="sidebar-brand-logo" aria-hidden="true">
            <span style={{ fontSize: 8, fontWeight: 800, lineHeight: 1 }}>W</span>
          </div>
          <span className="sidebar-brand-text">WOTANN</span>
        </div>

        {/* New Chat + Intelligence + Settings — compact icon buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewChat}
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: "rgba(255,255,255,0.015)", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-ghost)", cursor: "pointer",
            }}
            aria-label="New conversation"
            title="Cmd+N"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => setView("intelligence")}
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: "rgba(255,255,255,0.015)", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-ghost)", cursor: "pointer",
            }}
            aria-label="Intelligence"
            title="Intelligence Dashboard"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1C5.2 1 3 3.2 3 6c0 1.7.8 3.1 2 4v2a1 1 0 001 1h4a1 1 0 001-1v-2c1.2-.9 2-2.3 2-4 0-2.8-2.2-5-5-5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M6 14h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M6 15h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => setView("computer-use")}
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: "rgba(255,255,255,0.015)", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-ghost)", cursor: "pointer",
            }}
            aria-label="Desktop Control"
            title="Desktop Control"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 14h6M8 11.5v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => setView("council")}
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: "rgba(255,255,255,0.015)", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-ghost)", cursor: "pointer",
            }}
            aria-label="Council"
            title="Council Deliberation"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="5" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="11" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" />
              <path d="M2 13c0-2 1.5-3 3-3s3 1 3 3M8 13c0-2 1.5-3 3-3s3 1 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => setView("training")}
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: "rgba(255,255,255,0.015)", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-ghost)", cursor: "pointer",
            }}
            aria-label="Training"
            title="Training & Evolution"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2l2 4 4 .5-3 3 .7 4L8 11.5 4.3 13.5 5 9.5 2 6.5 6 6l2-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => setView("settings")}
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: "rgba(255,255,255,0.015)", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-ghost)", cursor: "pointer",
            }}
            aria-label="Settings"
            title="Cmd+,"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.2" />
              <path d="M13 8a5 5 0 01-10 0 5 5 0 0110 0z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>

      {/* 2. Search bar — mockup-compact */}
      <div
        style={{
          margin: "0 6px 4px",
          padding: "4px 8px",
          background: "rgba(255,255,255,0.01)",
          border: "1px solid rgba(255,255,255,0.015)",
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: "none",
            border: "none",
            outline: "none",
            fontSize: 13,
            color: "var(--color-text-muted)",
            width: "100%",
            fontFamily: "var(--font-sans)",
          }}
          aria-label="Search conversations"
        />
        <kbd style={{
          fontSize: 11,
          color: "var(--color-text-invisible)",
          background: "rgba(255,255,255,0.015)",
          padding: "0 3px",
          borderRadius: 2,
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
        }}>
          Cmd+K
        </kbd>
      </div>

      {/* 3. Project-grouped conversation list */}
      <div className="sidebar-conversations" role="list" aria-label="Conversations">
        {filtered.length === 0 ? (
          <div className="sidebar-empty">
            {searchQuery ? "No conversations match" : (
              engineConnected && !initialLoadDone ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <span className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }} />
                  <span>Loading...</span>
                </div>
              ) : "No conversations yet"
            )}
          </div>
        ) : (
          projectGroups.map((group) => (
            <ProjectGroupSection
              key={group.id}
              group={group}
              collapsed={collapsedGroups.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              activeConversationId={activeConversationId}
              getStatus={getConversationStatus}
              onSelect={(convId) => { setActiveConversation(convId); setView("chat"); }}
            />
          ))
        )}
      </div>

      {/* 4. Worker Pill — ambient workshop entry point */}
      <WorkerPill />
    </aside>
  );
}

// ── Project Group Section ─────────────────────────────

interface ProjectGroupSectionProps {
  readonly group: ProjectGroup;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly activeConversationId: string | null;
  readonly getStatus: (id: string) => ConversationStatus;
  readonly onSelect: (id: string) => void;
}

function ProjectGroupSection({ group, collapsed, onToggle, activeConversationId, getStatus, onSelect }: ProjectGroupSectionProps) {
  return (
    <div role="group" aria-label={group.name}>
      {/* Group header — mockup-compact: colored icon + name + count + chevron */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full text-left"
        style={{
          padding: "5px 8px 3px",
          borderRadius: 4,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          margin: "1px 4px",
          position: "relative",
          zIndex: 1,
        }}
        aria-expanded={!collapsed}
      >
        {/* Colored project icon (first letter) */}
        <span
          className="shrink-0 flex items-center justify-center"
          style={{
            width: 20, height: 20,
            borderRadius: 5,
            background: `${group.color}15`,
            color: group.color,
            fontSize: 11,
            fontWeight: 700,
          }}
          aria-hidden="true"
        >
          {group.name.charAt(0).toUpperCase()}
        </span>

        <span
          className="flex-1 truncate"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text-dim)",
          }}
        >
          {group.name}
        </span>

        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-invisible)",
            background: "rgba(255,255,255,0.012)",
            padding: "0 3px",
            borderRadius: 2,
            fontFamily: "var(--font-mono)",
          }}
        >
          {group.items.length}
        </span>

        <svg
          width="6" height="6" viewBox="0 0 16 16" fill="none"
          style={{
            color: "var(--color-text-invisible)",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0)",
            transition: "transform 100ms ease",
          }}
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Conversation list under this group */}
      {!collapsed && (
        <div style={{ paddingLeft: 4 }}>
          {group.items.map((conv) => (
            <SidebarConversationRow
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeConversationId}
              status={getStatus(conv.id)}
              onSelect={() => onSelect(conv.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conversation Row ───────────────────────────────────

interface SidebarConversationRowProps {
  readonly conversation: ConversationSummary;
  readonly isActive: boolean;
  readonly status: ConversationStatus;
  readonly onSelect: () => void;
}

function SidebarConversationRow({ conversation, isActive, status, onSelect }: SidebarConversationRowProps) {
  const deleteConversation = useStore((s) => s.deleteConversation);
  const forkConversation = useStore((s) => s.forkConversation);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    window.addEventListener("click", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("click", handleClose); window.removeEventListener("keydown", handleKeyDown); };
  }, [contextMenu]);

  return (
    <>
      <button
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={`sidebar-conv-row ${isActive ? "sidebar-conv-row--active" : "sidebar-conv-row--inactive"}`}
        aria-label={`${conversation.title}. ${formatTimeAgo(conversation.updatedAt)}`}
        aria-current={isActive ? "true" : undefined}
        role="listitem"
      >
        {/* Active indicator — thin violet left bar */}
        {isActive && (
          <div
            className="sidebar-conv-accent"
            style={{ boxShadow: "0 0 8px rgba(10, 132, 255, 0.3)" }}
            aria-hidden="true"
          />
        )}

        <div className="sidebar-conv-content">
          {/* Top row: status dot + title + time */}
          <div className="flex items-center gap-1" style={{ minWidth: 0 }}>
            {status !== "idle" && <StatusDot status={status} />}
            <span
              className="flex-1 truncate"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: isActive ? "#d4d4d8" : "var(--color-text-secondary)",
              }}
            >
              {isRenaming ? (
                <input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim()) {
                      useStore.getState().updateConversation(conversation.id, { title: renameValue.trim() });
                    }
                    setIsRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setIsRenaming(false);
                  }}
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-focus)", borderRadius: 3, padding: "0 3px", outline: "none", width: "100%", fontSize: 13, color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}
                  aria-label="Rename conversation"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : conversation.title}
            </span>
            <time
              style={{ fontSize: 11, color: "var(--color-text-invisible)", flexShrink: 0 }}
              dateTime={new Date(conversation.updatedAt).toISOString()}
            >
              {formatTimeAgo(conversation.updatedAt)}
            </time>
          </div>

          {/* Preview text — only on active, mockup-compact */}
          {isActive && conversation.preview && (
            <p style={{
              fontSize: 11,
              color: "var(--color-text-ghost)",
              marginTop: 1,
              paddingLeft: status !== "idle" ? 8 : 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {conversation.preview}
            </p>
          )}
        </div>
      </button>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Conversation actions"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 999,
            minWidth: 160,
            padding: "4px 0",
            borderRadius: "var(--radius-md)",
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.4))",
          }}
        >
          {[
            { label: "Rename", action: () => {
              setRenameValue(conversation.title);
              setIsRenaming(true);
              setTimeout(() => renameRef.current?.focus(), 50);
            }},
            { label: conversation.pinned ? "Unpin" : "Pin", action: () => {
              useStore.getState().updateConversation(conversation.id, { pinned: !conversation.pinned });
            }},
            { label: "Fork", action: () => {
              forkConversation(conversation.id, "");
            }},
            { label: "Copy ID", action: () => {
              navigator.clipboard.writeText(conversation.id).catch(() => {});
            }},
            { label: "Delete", action: () => {
              deleteConversation(conversation.id);
            }, danger: true },
          ].map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); (item as { action: () => void }).action(); setContextMenu(null); }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "6px 12px",
                fontSize: "var(--font-size-xs)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: (item as { danger?: boolean }).danger ? "var(--color-error)" : "var(--color-text-secondary)",
              }}
              aria-label={`${item.label} conversation`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Status Dot — minimal inline indicator ─────────────

function StatusDot({ status }: { readonly status: Exclude<ConversationStatus, "idle"> }) {
  const colors: Record<Exclude<ConversationStatus, "idle">, { bg: string; shadow: string; pulse: boolean }> = {
    working: { bg: "#38bdf8", shadow: "0 0 3px rgba(56,189,248,0.2)", pulse: true },
    pending: { bg: "#fbbf24", shadow: "0 0 2px rgba(251,191,36,0.15)", pulse: false },
    done: { bg: "#4ade80", shadow: "0 0 2px rgba(74,222,128,0.08)", pulse: false },
  };
  const config = colors[status];

  return (
    <span
      className={`shrink-0 ${config.pulse ? "animate-pulse" : ""}`}
      style={{
        width: 4,
        height: 4,
        borderRadius: "50%",
        background: config.bg,
        boxShadow: config.shadow,
        display: "inline-block",
      }}
      aria-label={status}
    />
  );
}
