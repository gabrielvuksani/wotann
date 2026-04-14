/**
 * Full chat view — Depth design direction.
 * Matches design-depth.html mockup:
 * - Welcome: 56px logo with breathing animation, 24px heading, 14px description, 2x2 quick-action grid
 * - Quick actions: 14px 16px padding, 34px icon boxes, 10px gap, hover lift + shadow
 * - Keyboard hint at bottom: kbd styling with surface bg, border, mono font
 * - Messages: max-w-3xl centered, 24px horizontal padding
 * - Scroll-to-bottom floating circle FAB with arrow icon
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { useStore } from "../../store";
import { MessageBubble } from "./MessageBubble";
import { ComposerInput, type ComposerChipValue } from "./ComposerInput";
import { useStreaming } from "../../hooks/useStreaming";
// StreamingIndicator rendered inside MessageBubble — not needed here
import type { ChatMode } from "../../types";
import { WORKSPACE_PRESETS, getQuickActionVisual, getActionRoute } from "../../lib/workspace-presets";
import type { QuickActionConfig } from "../../lib/workspace-presets";

/** Lock icon for incognito mode. */
function LockIcon({ size = 12 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* Inject breathing animation keyframes once */
const BREATHING_KEYFRAMES_ID = "wotann-breathing-keyframes";
if (typeof document !== "undefined" && !document.getElementById(BREATHING_KEYFRAMES_ID)) {
  const style = document.createElement("style");
  style.id = BREATHING_KEYFRAMES_ID;
  style.textContent = `
    @keyframes logoBreathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.02); }
    }
  `;
  document.head.appendChild(style);
}

function WelcomeScreen() {
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const setMode = useStore((s) => s.setMode);
  const setView = useStore((s) => s.setView);
  const addConversation = useStore((s) => s.addConversation);
  const addMessage = useStore((s) => s.addMessage);
  const toggleConversationIncognito = useStore((s) => s.toggleConversationIncognito);
  const currentProvider = useStore((s) => s.provider);
  const currentModel = useStore((s) => s.model);
  const workspacePreset = useStore((s) => s.settings.workspacePreset);
  const [incognitoNext, setIncognitoNext] = useState(false);

  const presetConfig = WORKSPACE_PRESETS[workspacePreset];
  const quickActions = presetConfig.quickActions;

  const handleQuickAction = useCallback(
    (action: QuickActionConfig) => {
      const route = getActionRoute(action.action);

      // For view-type routes, navigate directly
      if (route.type === "view") {
        setView(route.target as any);
        return;
      }

      // For mode-type routes, create a conversation and set mode
      const id = `conv-${Date.now()}`;
      const title = route.engineAction === "deep_research"
        ? "Deep Research"
        : "New conversation";
      addConversation({
        id,
        title,
        preview: "",
        updatedAt: Date.now(),
        provider: currentProvider || "anthropic",
        model: currentModel || "claude-opus-4-6",
        cost: 0,
        messageCount: 0,
      });
      if (incognitoNext) {
        toggleConversationIncognito(id);
      }
      setActiveConversation(id);
      setMode(route.target as ChatMode);

      // For deep research, add a system hint so the user knows to type a topic
      if (route.engineAction === "deep_research") {
        addMessage(id, {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: "What topic would you like me to research? I will perform a multi-step investigation with iterative query refinement and provide a report with citations.",
          timestamp: Date.now(),
        });
      }
    },
    [addConversation, setActiveConversation, setMode, setView, addMessage, toggleConversationIncognito, incognitoNext, currentProvider, currentModel],
  );

  return (
    <div
      className="flex-1 flex items-center justify-center relative overflow-hidden"
      style={{ background: "transparent", padding: 24 }}
    >
      <div className="text-center" style={{ maxWidth: 460 }}>
        {/* Logo — compact with blue gradient, glow, and breathing animation */}
        <div
          className="inline-flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "linear-gradient(135deg, var(--color-primary), #0066CC)",
            boxShadow: "0 2px 12px rgba(10,132,255,0.15), inset 0 1px 0 rgba(255,255,255,0.08)",
            marginBottom: 16,
            animation: "logoBreathe 4s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 800, color: "white", lineHeight: 1 }}>W</span>
        </div>

        {/* Heading — clean, tight */}
        <h2 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-text-primary)", letterSpacing: "-0.5px", marginBottom: 6, lineHeight: 1.2 }}>
          What would you like to build?
        </h2>

        {/* Description */}
        <p style={{ fontSize: 15, color: "var(--color-text-secondary)", lineHeight: 1.5, marginBottom: 24, maxWidth: 380, margin: "0 auto 24px" }}>
          Multi-provider AI with autonomous agents, desktop control, and full tool use.
        </p>

        {/* Quick actions — compact 2x3 grid */}
        <div
          className="grid grid-cols-2"
          style={{ gap: 6, maxWidth: 400, margin: "0 auto 16px" }}
          role="group"
          aria-label="Quick actions"
        >
          {quickActions.map((action, i) => {
            const visual = getQuickActionVisual(action.icon);
            /* visual.svg is trusted static SVG from workspace-presets.ts — not user input */
            return (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action)}
                className={`text-left animate-stagger-${Math.min(i + 1, 6)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 12,
                  cursor: "pointer",
                  transition: "transform 200ms ease, box-shadow 200ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: "var(--surface-2)",
                    color: "var(--color-text-dim)",
                  }}
                  dangerouslySetInnerHTML={{ __html: visual.svg }}
                  aria-hidden="true"
                />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", lineHeight: 1.3, letterSpacing: "-0.01em" }}>{action.label}</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-dim)", marginTop: 1, lineHeight: 1.3 }}>{action.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Incognito toggle — minimal */}
        <div className="flex items-center justify-center" style={{ marginTop: 12 }}>
          <button
            onClick={() => setIncognitoNext((prev) => !prev)}
            className="inline-flex items-center gap-1.5"
            style={{
              padding: "3px 10px",
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 500,
              background: incognitoNext ? "var(--accent-muted)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${incognitoNext ? "rgba(10,132,255,0.15)" : "rgba(255,255,255,0.04)"}`,
              color: incognitoNext ? "var(--color-primary)" : "var(--color-text-dim)",
              cursor: "pointer",
            }}
            aria-pressed={incognitoNext}
            aria-label="Toggle incognito mode for next conversation"
            title="Incognito — conversation won't be saved to memory"
          >
            <LockIcon size={8} />
            <span>Incognito</span>
          </button>
        </div>

        {/* Keyboard hints — whisper-level */}
        <div
          className="flex items-center justify-center gap-4"
          style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 16 }}
        >
          {[
            { key: "\u2318K", label: "commands" },
            { key: "\u2318N", label: "new chat" },
            { key: "\u2318J", label: "terminal" },
            { key: "\u2318B", label: "sidebar" },
          ].map((hint) => (
            <span key={hint.key} className="inline-flex items-center gap-1">
              <kbd
                style={{
                  padding: "2px 5px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-dim)",
                }}
              >
                {hint.key}
              </kbd>
              <span>{hint.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Composer bar — thin adapter that owns the ComposerInput value and wires
 * submission back into the existing streaming + conversation-autocreate flow.
 * Preserves prior behavior: auto-create a conversation on first send, forward
 * parsed chips as bracketed references, and route everything through the
 * existing useStreaming hook (same handler used by PromptInput).
 */
function ChatComposerBar() {
  const [value, setValue] = useState("");
  const activeConversationId = useStore((s) => s.activeConversationId);
  const addConversation = useStore((s) => s.addConversation);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const isStreaming = useStore((s) => s.isStreaming);
  const { sendMessage } = useStreaming();

  const handleSubmit = useCallback(
    (text: string, _chips: readonly ComposerChipValue[]) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Auto-create conversation if none exists (parity with PromptInput).
      let convId = activeConversationId;
      if (!convId) {
        convId = `conv-${Date.now()}`;
        const preview = trimmed.slice(0, 80);
        addConversation({
          id: convId,
          title: preview || "New Chat",
          preview,
          updatedAt: Date.now(),
          provider: useStore.getState().provider || "ollama",
          model: useStore.getState().model || "",
          cost: 0,
          messageCount: 0,
        });
        setActiveConversation(convId);
      }
      sendMessage(convId, trimmed);
      setValue("");
    },
    [activeConversationId, addConversation, setActiveConversation, sendMessage],
  );

  return (
    <div style={{ padding: "12px 24px 16px", flexShrink: 0 }}>
      <div style={{ maxWidth: "var(--chat-max-width, 720px)", margin: "0 auto" }}>
        <ComposerInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          disabled={isStreaming && !value.trim()}
          maxRows={8}
        />
      </div>
    </div>
  );
}

export function ChatView() {
  const activeConversationId = useStore((s) => s.activeConversationId);
  const messages = useStore((s) =>
    activeConversationId ? (s.messages[activeConversationId] ?? []) : [],
  );
  const engineConnected = useStore((s) => s.engineConnected);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  /* Auto-scroll to bottom when new messages arrive or content streams */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distanceFromBottom > 100);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  if (!activeConversationId) {
    return (
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <div className="flex-1 flex items-center justify-center overflow-y-auto min-h-0">
          <WelcomeScreen />
        </div>
        <div className="shrink-0">
          <ChatComposerBar />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Connection status banner */}
      {!engineConnected && (
        <div
          role="alert"
          style={{
            padding: "8px 24px",
            background: "var(--color-warning-muted)",
            borderBottom: "1px solid var(--color-warning)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-warning)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5v3M8 10v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Engine disconnected — responses require a running WOTANN engine
        </div>
      )}
      {/* Messages — simple scroll, no virtualizer */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto min-h-0"
        onScroll={handleScroll}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        <div
          className="mx-auto w-full"
          style={{ maxWidth: "var(--chat-max-width, 720px)", padding: "16px 24px" }}
        >
          {messages.length === 0 && (
            <div className="flex items-center justify-center py-20 animate-fadeIn">
              <p style={{ fontSize: "var(--font-size-base)", color: "var(--color-text-muted)" }}>
                Start the conversation by typing a message below.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              <MessageBubble
                message={msg}
                conversationId={activeConversationId ?? undefined}
                onRetry={msg.role === "assistant" ? async () => {
                  const prevUserMsg = messages.slice(0, i).reverse().find((m) => m.role === "user");
                  if (prevUserMsg) {
                    const { sendMessage: engineSend } = await import("../../store/engine");
                    engineSend(prevUserMsg.content);
                  }
                } : undefined}
              />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Scroll-to-bottom floating circle FAB */}
      {showScrollBtn && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 animate-fadeIn">
          <button
            onClick={scrollToBottom}
            className="scroll-bottom-btn"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--surface-3)",
              color: "var(--color-text-secondary)",
              boxShadow: "var(--shadow-md)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              cursor: "pointer",
              transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            aria-label="Scroll to latest message"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Input bar */}
      <ChatComposerBar />
    </div>
  );
}
