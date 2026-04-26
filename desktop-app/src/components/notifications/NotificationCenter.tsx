/**
 * Notification Center -- bell icon dropdown showing all events.
 * Supports per-type filtering, mark-as-read, slide-in panel animation.
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useStore } from "../../store";

export interface AppNotification {
  readonly id: string;
  readonly type: "task_complete" | "error" | "approval" | "cost_alert" | "companion" | "agent";
  readonly title: string;
  readonly message: string;
  readonly timestamp: number;
  readonly read: boolean;
  readonly actionUrl?: string;
}

const TYPE_ICONS: Record<AppNotification["type"], React.ReactNode> = {
  task_complete: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--green)" strokeWidth="1.5"/>
      <path d="M5 8l2 2 4-4" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--red)" strokeWidth="1.5"/>
      <path d="M6 6l4 4M10 6l-4 4" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  approval: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2l1.5 3h3l-2.5 2 1 3L8 8.5 4.5 10l1-3-2.5-2h3L8 2z" stroke="var(--amber)" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  ),
  cost_alert: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L14 13H2L8 2z" stroke="var(--amber)" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M8 7v3M8 11.5v.5" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  companion: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="4" y="2" width="8" height="12" rx="2" stroke="var(--accent)" strokeWidth="1.5"/>
      <path d="M7 12h2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  agent: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L3 4v4l5 3 5-3V4L8 1z" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="8" cy="6" r="1.5" fill="var(--accent)"/>
    </svg>
  ),
};


function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

interface NotificationCenterProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const notifications = useStore((s) => s.notifications ?? []);
  const markNotificationRead = useStore((s) => s.markNotificationRead);
  const clearNotifications = useStore((s) => s.clearNotifications);
  const [filter, setFilter] = useState<AppNotification["type"] | "all">("all");
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape and trap focus
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab cycles within the panel
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last!.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first!.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    // Auto-focus the panel
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    return notifications.filter((n) => n.type === filter);
  }, [notifications, filter]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="absolute right-0 top-full mt-1 overflow-hidden z-50 flex flex-col animate-slideDown focus:outline-none notification-glass"
      style={{ width: 360, maxHeight: 520, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Notification center"
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Notifications</h3>
          {unreadCount > 0 && (
            <span style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--color-primary)", color: "white" }} aria-label={`${unreadCount} unread`}>
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && (
            <button
              onClick={() => clearNotifications?.()}
              className="text-xs"
              style={{ color: "var(--color-text-secondary)", transition: "color 200ms var(--ease-expo)" }}
              aria-label="Clear all notifications"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            aria-label="Close notifications"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 px-4 py-2 border-b overflow-x-auto" style={{ borderColor: "var(--border-subtle)" }} role="group" aria-label="Filter notifications by type">
        {(["all", "task_complete", "error", "approval", "cost_alert", "agent"] as const).map((type) => {
          const labelMap: Record<string, string> = {
            all: "All",
            task_complete: "Completed",
            error: "Errors",
            approval: "Approvals",
            cost_alert: "Cost",
            agent: "Agents",
          };
          const dotColorMap: Record<string, string> = {
            task_complete: "var(--green)",
            error: "var(--red)",
            approval: "var(--amber)",
            cost_alert: "var(--amber)",
            agent: "var(--accent)",
          };
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className="px-2 py-1 text-xs rounded-full whitespace-nowrap transition-colors flex items-center gap-1.5"
              style={filter === type
                ? { background: "var(--color-primary)", color: "white" }
                : { background: "var(--surface-3)", color: "var(--color-text-secondary)" }
              }
              aria-pressed={filter === type}
            >
              {type !== "all" && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: filter === type ? "white" : dotColorMap[type],
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
              )}
              {labelMap[type]}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto" role="list" aria-label="Notifications">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-2" style={{ background: "var(--surface-3)" }} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-dim)" }}>
                <path d="M8 1.5a4 4 0 014 4v2.5l1.5 2H2.5L4 8V5.5a4 4 0 014-4z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 12a2 2 0 004 0" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 3l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No notifications</p>
          </div>
        ) : (
          filtered.map((notification) => (
            <button
              key={notification.id}
              role="listitem"
              onClick={() => markNotificationRead?.(notification.id)}
              className="w-full text-left px-4 py-3 border-b"
              style={{
                borderColor: "var(--border-subtle)",
                background: !notification.read ? "var(--surface-2)" : "transparent",
                transition: "background 200ms var(--ease-expo)",
              }}
              aria-label={`${notification.read ? "" : "Unread: "}${notification.title}: ${notification.message}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5" aria-hidden="true">
                  {TYPE_ICONS[notification.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium" style={{ color: !notification.read ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>
                      {notification.title}
                    </p>
                    <span className="text-xs ml-2 flex-shrink-0" style={{ color: "var(--color-text-muted)" }}>
                      <time dateTime={new Date(notification.timestamp).toISOString()}>
                        {formatTime(notification.timestamp)}
                      </time>
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--color-text-muted)" }}>
                    {notification.message}
                  </p>
                </div>
                {!notification.read && (
                  <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: "var(--color-primary)" }} aria-hidden="true" />
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
