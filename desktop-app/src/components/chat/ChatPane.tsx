/**
 * ChatPane — Narrow persistent chat sidebar for workspace views.
 * Reuses ChatView internals (messages + input) in a 360px container.
 * Shows alongside Editor, Workshop, Exploit views.
 * Includes mode pills (Build/Review/Research) in its header.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { useStore } from "../../store";
import { MessageBubble } from "./MessageBubble";
import { PromptInput } from "../input/PromptInput";
import { StreamingIndicator } from "./StreamingIndicator";
import type { ChatMode } from "../../types";

const MODES: readonly { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "build", label: "Build" },
  { id: "autopilot", label: "Autopilot" },
  { id: "compare", label: "Compare" },
  { id: "review", label: "Review" },
];

/** Compact mode dropdown — replaces the bulky pill tabs */
function ModeSelector() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="btn-press"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          fontSize: "var(--font-size-xs)",
          fontWeight: 600,
          borderRadius: "var(--radius-xs)",
          background: "transparent",
          color: "var(--color-text-secondary)",
          border: "none",
          cursor: "pointer",
        }}
      >
        {MODES.find((m) => m.id === mode)?.label ?? "Chat"}
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.5 }}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 z-50 animate-scaleIn"
          style={{
            marginTop: 4,
            width: 120,
            background: "var(--color-bg-primary)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            padding: 4,
          }}
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setOpen(false); }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                fontSize: "var(--font-size-xs)",
                borderRadius: "var(--radius-xs)",
                border: "none",
                cursor: "pointer",
                background: mode === m.id ? "var(--bg-surface)" : "transparent",
                color: mode === m.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
                fontWeight: mode === m.id ? 600 : 400,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPane() {
  const activeConversationId = useStore((s) => s.activeConversationId);
  const messages = useStore((s) =>
    activeConversationId ? (s.messages[activeConversationId] ?? []) : [],
  );
  const isStreaming = useStore((s) => s.isStreaming);
  const toggleChatPane = useStore((s) => s.toggleChatPane);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distanceFromBottom > 100);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        background: "var(--color-bg-primary)",
        borderLeft: "1px solid var(--border-subtle)",
      }}
    >
      {/* Pane header — mode selector + close */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          height: 36,
          padding: "0 8px 0 12px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
        }}
      >
        <ModeSelector />
        <button
          onClick={toggleChatPane}
          className="header-icon-btn"
          aria-label="Close chat pane"
          title="Close"
          style={{ width: 24, height: 24 }}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Messages area */}
      {!activeConversationId ? (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ padding: 16 }}
        >
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", textAlign: "center" }}>
            Select a conversation or start a new chat to see messages here.
          </p>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto space-y-3 relative"
          style={{ padding: "12px 12px" }}
          onScroll={handleScroll}
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
                Type a message below to start.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id}>
              <MessageBubble message={msg} />
            </div>
          ))}

          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.isStreaming && !messages[messages.length - 1]?.content && (
            <StreamingIndicator />
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <div className="relative">
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={scrollToBottom}
              className="px-2 py-1 rounded-full text-[10px] shadow-lg backdrop-blur-sm transition-all hover:opacity-90"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                color: "var(--color-text-secondary)",
              }}
              aria-label="Scroll to latest message"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="inline-block mr-0.5" aria-hidden="true">
                <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              New
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <PromptInput />
    </div>
  );
}
