/**
 * Dispatch Inbox — triage, snooze, escalate inbound messages from all channels.
 *
 * Every inbound message (channel, phone, webhook) becomes a routed dispatch event.
 * This component shows the inbox with actions: reply, snooze, escalate, forward to agent.
 */

import { useState, useCallback, useEffect } from "react";
import { useStore } from "../../store";
import { Skeleton } from "../shared/Skeleton";

interface DispatchItem {
  readonly id: string;
  readonly channel: string;
  readonly sender: string;
  readonly content: string;
  readonly timestamp: number;
  readonly priority: "high" | "medium" | "low";
  readonly status: "pending" | "snoozed" | "escalated" | "replied" | "forwarded";
}

export function DispatchInbox() {
  const engineConnected = useStore((s) => s.engineConnected);
  const [items, setItems] = useState<readonly DispatchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "snoozed">("all");

  // Load dispatch items from the engine on mount when connected
  useEffect(() => {
    if (!engineConnected) return;

    let cancelled = false;
    async function loadDispatchItems() {
      setIsLoading(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<readonly DispatchItem[]>("get_dispatch_items");
        if (!cancelled && result) {
          setItems(result);
        }
      } catch {
        // Engine may not support this command yet — keep empty state
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    loadDispatchItems();
    return () => { cancelled = true; };
  }, [engineConnected]);

  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    return item.status === filter;
  });

  const handleAction = useCallback((id: string, action: "reply" | "snooze" | "escalate" | "forward") => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: action === "reply" ? "replied" as const : action === "snooze" ? "snoozed" as const : action === "escalate" ? "escalated" as const : "forwarded" as const }
          : item,
      ),
    );
  }, []);

  const priorityColor = (p: DispatchItem["priority"]) => {
    switch (p) {
      case "high": return "var(--color-error)";
      case "medium": return "var(--color-warning)";
      case "low": return "var(--color-connected)";
    }
  };

  const channelIcon = (ch: string) => {
    switch (ch.toLowerCase()) {
      case "telegram": return "T";
      case "discord": return "D";
      case "slack": return "S";
      case "whatsapp": return "W";
      case "phone": return "P";
      case "webhook": return "H";
      default: return ch[0]?.toUpperCase() ?? "?";
    }
  };

  if (!engineConnected) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--color-text-muted)" }}>
        <p style={{ fontSize: "var(--font-size-sm)" }}>Connect to engine to see dispatch inbox</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton height="48px" />
        <Skeleton height="48px" />
        <Skeleton height="48px" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div
        className="flex items-center gap-2 shrink-0"
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
        }}
      >
        <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-text-secondary)" }}>Inbox</span>
        <div className="flex gap-1 ml-2" style={{ background: "var(--surface-2)", borderRadius: "var(--radius-sm)", padding: 2 }}>
          {(["all", "pending", "snoozed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-label={`Filter dispatch items: ${f}`}
              aria-pressed={filter === f}
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-xs)",
                fontSize: "var(--font-size-2xs)",
                fontWeight: 500,
                color: filter === f ? "var(--color-primary)" : "var(--color-text-dim)",
                background: filter === f ? "var(--accent-muted)" : "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: "var(--font-size-2xs)", color: "var(--color-text-ghost)" }}>
          {filteredItems.length} items
        </span>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "var(--color-text-muted)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 12h-6l-2 3H10l-2-3H2" />
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
            </svg>
            <p style={{ fontSize: "var(--font-size-sm)" }}>Inbox empty</p>
            <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>Messages from channels will appear here</p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 transition-colors"
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-subtle)",
                background: item.status === "pending" ? "var(--surface-1)" : "transparent",
              }}
            >
              {/* Channel badge */}
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--accent-muted)",
                  color: "var(--color-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {channelIcon(item.channel)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "var(--font-size-xs)", fontWeight: 500, color: "var(--color-text-primary)" }}>{item.sender}</span>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: priorityColor(item.priority) }} />
                  <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-ghost)", marginLeft: "auto" }}>
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="truncate" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: 2 }}>
                  {item.content}
                </p>
              </div>

              {/* Actions */}
              {item.status === "pending" && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleAction(item.id, "reply")}
                    style={{ padding: "2px 6px", borderRadius: "var(--radius-xs)", fontSize: "var(--font-size-2xs)", background: "var(--accent-muted)", color: "var(--color-primary)", border: "none", cursor: "pointer" }}
                    aria-label={`Reply to dispatch from ${item.channel} by ${item.sender}`}
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => handleAction(item.id, "forward")}
                    style={{ padding: "2px 6px", borderRadius: "var(--radius-xs)", fontSize: "var(--font-size-2xs)", background: "var(--surface-2)", color: "var(--color-text-muted)", border: "none", cursor: "pointer" }}
                    aria-label={`Forward to agent: dispatch from ${item.channel} by ${item.sender}`}
                  >
                    Agent
                  </button>
                  <button
                    onClick={() => handleAction(item.id, "snooze")}
                    style={{ padding: "2px 6px", borderRadius: "var(--radius-xs)", fontSize: "var(--font-size-2xs)", background: "var(--surface-2)", color: "var(--color-text-dim)", border: "none", cursor: "pointer" }}
                    aria-label={`Snooze dispatch from ${item.channel} by ${item.sender}`}
                  >
                    Snooze
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
