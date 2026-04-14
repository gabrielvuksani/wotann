/**
 * Streaming hook — receives real stream events from the Tauri backend.
 *
 * Architecture:
 * 1. Frontend calls Tauri `send_message` command with the prompt
 * 2. Rust backend emits `stream-chunk` events with { type, content, provider, model, message_id }
 * 3. This hook listens for those events and updates the Zustand store in real-time
 * 4. When type === "done", streaming ends and final metadata (tokens, cost) is applied
 *
 * Falls back to invoke-based streaming if Tauri events aren't available (e.g., dev mode in browser).
 */

import { useCallback, useEffect, useRef } from "react";
import { useStore } from "../store";
import type { Message, StreamChunk } from "../types";

/** Alias for event handler signatures within this module */
type StreamChunkEvent = StreamChunk;

// Static imports — avoids dynamic chunk-loading issues in Tauri's webview
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

function isInsideTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type UnlistenFn = () => void;

async function tauriListen(
  event: string,
  handler: (payload: StreamChunkEvent) => void,
): Promise<UnlistenFn> {
  if (!isInsideTauri()) return () => {};
  try {
    return listen<StreamChunkEvent>(event, (e) => handler(e.payload));
  } catch {
    return () => {};
  }
}

async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  if (!isInsideTauri()) return browserFallback(cmd, args);
  try {
    return invoke(cmd, args);
  } catch {
    return browserFallback(cmd, args);
  }
}

/**
 * Browser fallback — NO mock data.
 * When not running in Tauri, shows a clear "not connected" message.
 */
let pendingHandler: ((chunk: StreamChunkEvent) => void) | null = null;

function browserFallback(cmd: string, _args?: Record<string, unknown>): Promise<unknown> {
  if (cmd !== "send_message") return Promise.resolve(null);

  const messageId = `msg-${Date.now() + 1}`;

  // Show a real error — never fake a response
  if (pendingHandler) {
    const handler = pendingHandler;
    setTimeout(() => {
      handler({
        type: "error",
        content: "WOTANN Engine is not running. Start the engine with `wotann engine start` or launch it from the app menu.",
        provider: "",
        model: "",
        message_id: messageId,
      });
    }, 100);
  }

  return Promise.resolve(messageId);
}

// ── Shared state for stream processing ─────────────────

/** Shared content buffer — accessible by both the listener and sendMessage */
const sharedContentBuffer: Record<string, string> = {};

/** Global singleton flag to prevent duplicate listener registration */
let globalListenerActive = false;

// ── Stream Listener Hook (call ONCE in App.tsx) ────────

/**
 * Sets up the global Tauri event listener for stream-chunk events.
 * Must be called exactly ONCE at the app root level.
 */
export function useStreamListener() {
  const updateMessage = useStore((s) => s.updateMessage);
  const setStreaming = useStore((s) => s.setStreaming);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    // CRITICAL: Only ONE listener globally. Skip if already active.
    if (globalListenerActive) return;
    globalListenerActive = true;

    const setup = async () => {
      unlistenRef.current?.();
      unlistenRef.current = await tauriListen("stream-chunk", (chunk) => {
        if (!mountedRef.current) return;

        const { type, content, message_id: chunkMsgId, provider, model, tokens_used, cost_usd } = chunk;
        const convId = useStore.getState().activeConversationId ?? "";
        const messages = useStore.getState().messages[convId] ?? [];
        const streamingMsg = messages.find(m => m.id === chunkMsgId && m.isStreaming)
          ?? [...messages].reverse().find(m => m.role === "assistant" && m.isStreaming);
        const msgId = streamingMsg?.id ?? chunkMsgId;

        if (type === "text" || type === "thinking") {
          const prev = sharedContentBuffer[msgId] ?? "";
          // Guard: if the content we're about to append would create a duplication pattern, skip it
          // This catches cases where the event fires twice for the same chunk
          if (prev.length > 0 && prev.endsWith(content) && content.length > 0) {
            // This chunk was already appended — skip duplicate
            return;
          }
          const updated = prev + content;
          sharedContentBuffer[msgId] = updated;
          updateMessage(convId, msgId, { content: updated });
        } else if (type === "tool_use") {
          // Parse tool call details from the content payload
          let toolName = "unknown";
          let toolInput: string | undefined;
          let toolInputObj: Record<string, unknown> | null = null;
          try {
            const parsed = JSON.parse(content);
            toolName = parsed.name ?? parsed.tool ?? "unknown";
            toolInputObj = (parsed.input ?? null) as Record<string, unknown> | null;
            toolInput = toolInputObj != null ? JSON.stringify(toolInputObj, null, 2) : undefined;
          } catch {
            // Content is not JSON — use it as the tool name directly
            toolName = content || "unknown";
          }
          // Surface file edits in the Changes panel even before the daemon sends hunks.
          if (toolInputObj && /^(edit_file|write_file|write|edit|str_replace_editor)$/.test(toolName)) {
            const path =
              (toolInputObj.path as string | undefined) ??
              (toolInputObj.file_path as string | undefined) ??
              (toolInputObj.filename as string | undefined);
            if (path && typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("wotann:diff-update", {
                  detail: { path, additions: 0, deletions: 0, hunks: [] },
                }),
              );
            }
          }
          const prev = sharedContentBuffer[msgId] ?? "";
          let toolIndicator = `\n\n> **Tool call:** \`${toolName}\`\n`;
          if (toolInput) {
            toolIndicator += `\n\`\`\`json\n${toolInput}\n\`\`\`\n`;
          }
          const updated = prev + toolIndicator;
          sharedContentBuffer[msgId] = updated;
          updateMessage(convId, msgId, { content: updated });
        } else if (type === "done") {
          const finalContent = sharedContentBuffer[msgId] ?? "";
          delete sharedContentBuffer[msgId];
          updateMessage(convId, msgId, {
            content: finalContent,
            isStreaming: false,
            provider: provider || undefined,
            model: model || undefined,
            tokensUsed: tokens_used,
            costUsd: cost_usd,
          });
          setStreaming(false);

          // TTS: speak the response if voice output is enabled
          const voiceEnabled = useStore.getState().settings.voiceOutput;
          if (voiceEnabled && finalContent && typeof window !== "undefined" && window.speechSynthesis) {
            // Cancel any previous speech
            window.speechSynthesis.cancel();
            // Strip markdown/code blocks for cleaner speech
            const cleanText = finalContent
              .replace(/```[\s\S]*?```/g, " code block omitted ")
              .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
              .replace(/[#*_~>]/g, "")
              .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
              .trim();
            if (cleanText) {
              const utterance = new SpeechSynthesisUtterance(cleanText);
              utterance.rate = 1.0;
              utterance.pitch = 1.0;
              window.speechSynthesis.speak(utterance);
            }
          }
        } else if (type === "error") {
          updateMessage(convId, msgId, { content: content || "An error occurred", isStreaming: false });
          setStreaming(false);
        }
      });
    };

    setup();

    return () => {
      mountedRef.current = false;
      globalListenerActive = false;
      unlistenRef.current?.();
    };
  }, [updateMessage, setStreaming]);
}

// ── Send Message Hook (call per PromptInput) ───────────

/**
 * Provides sendMessage and stopStreaming.
 * Event listening is handled by useStreamListener (called once in App.tsx).
 */
export function useStreaming() {
  const addMessage = useStore((s) => s.addMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const setStreaming = useStore((s) => s.setStreaming);

  const stopStreaming = useCallback(() => {
    setStreaming(false);
    // Clear shared content buffer
    for (const key of Object.keys(sharedContentBuffer)) {
      delete sharedContentBuffer[key];
    }
  }, [setStreaming]);

  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      // Add user message
      const userMsg: Message = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };
      addMessage(conversationId, userMsg);

      // Create placeholder assistant message
      const assistantId = `msg-${Date.now() + 1}`;
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        model: useStore.getState().model,
        provider: useStore.getState().provider,
        isStreaming: true,
      };
      addMessage(conversationId, assistantMsg);
      setStreaming(true);

      // Initialize shared content buffer for this message
      sharedContentBuffer[assistantId] = "";

      // Call Tauri command — pass our messageId so Rust uses it for stream chunks
      try {
        // Pass provider/model directly — don't rely on Rust AppState sync
        const currentProvider = useStore.getState().provider;
        const currentModel = useStore.getState().model;
        await tauriInvoke("send_message_streaming", {
          prompt: content,
          provider: currentProvider || null,
          model: currentModel || null,
        });
      } catch (err) {
        updateMessage(conversationId, assistantId, {
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          isStreaming: false,
        });
        setStreaming(false);
      }
    },
    [addMessage, updateMessage, setStreaming],
  );

  return { sendMessage, stopStreaming };
}
