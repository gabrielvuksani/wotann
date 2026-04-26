/**
 * Prompt input bar — Obsidian Precision design.
 * Apple-native dark aesthetic:
 * - Container: token `surface` bg, 12px radius, 1px solid rgba(255,255,255,0.06) border
 * - Focus: blue border + subtle glow
 * - Send button: filled circle, token `accent` when text present
 * - Action buttons: 32px ghost touch targets
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useStore } from "../../store";
import { color } from "../../design/tokens.generated";
import { useStreaming } from "../../hooks/useStreaming";
import { readDirectory, readFile } from "../../store/engine";
import { AttachButton } from "./AttachButton";
import { EnhanceButton } from "./EnhanceButton";
import { VoiceButton } from "./VoiceButton";
import type { FileTreeNode } from "../../types";

interface AttachedFile {
  readonly name: string;
  readonly type: "text" | "image";
  readonly content: string;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"]);
const PDF_EXTENSION = ".pdf";

const AT_MENU_MAX_ITEMS = 8;

/** Cached flat file list from readDirectory — avoids re-fetching on every keystroke */
let cachedFileList: readonly string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

function flattenTree(nodes: readonly FileTreeNode[]): readonly string[] {
  const result: string[] = [];
  for (const node of nodes) {
    result.push(node.path);
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

async function getFileList(): Promise<readonly string[]> {
  const now = Date.now();
  if (cachedFileList && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedFileList;
  }
  try {
    const tree = await readDirectory(".");
    cachedFileList = flattenTree(tree);
    cacheTimestamp = now;
    return cachedFileList;
  } catch {
    return cachedFileList ?? [];
  }
}

function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function PromptInput() {
  const [inputValue, setInputValue] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachments, setAttachments] = useState<readonly AttachedFile[]>([]);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [showAtMenu, setShowAtMenu] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [, setAtQuery] = useState("");
  const [atFiles, setAtFiles] = useState<string[]>([]);
  const [atIndex, setAtIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useStore((s) => s.isStreaming);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const addConversation = useStore((s) => s.addConversation);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const { sendMessage, stopStreaming } = useStreaming();

  const processFiles = useCallback(async (files: FileList) => {
    const newAttachments: AttachedFile[] = [];
    for (const file of Array.from(files)) {
      try {
        if (isImageFile(file.name)) {
          // Convert image to base64
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          newAttachments.push({ name: file.name, type: "image", content: base64 });
        } else if (file.name.toLowerCase().endsWith(PDF_EXTENSION)) {
          // Extract text from PDF via engine command
          try {
            const { commands } = await import("../../hooks/useTauriCommand");
            const filePath = (file as unknown as { path?: string }).path ?? file.name;
            const result = await commands.processPdf(filePath);
            const header = `[PDF: ${file.name} | ${result.pageCount} pages]\n`;
            const outline = result.outline.length > 0
              ? `Outline: ${result.outline.join(" > ")}\n\n`
              : "";
            const truncated = result.text.length > 10000
              ? result.text.slice(0, 10000) + "\n... (truncated, PDF too large)"
              : result.text;
            newAttachments.push({ name: file.name, type: "text", content: header + outline + truncated });
          } catch {
            // Fallback: read as binary and note it's a PDF
            newAttachments.push({ name: file.name, type: "text", content: `[PDF: ${file.name} — could not extract text. Install poppler-utils for PDF support.]` });
          }
        } else {
          // Read text content
          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(file);
          });
          const truncated = text.length > 10000
            ? text.slice(0, 10000) + "\n... (truncated, file too large)"
            : text;
          newAttachments.push({ name: file.name, type: "text", content: truncated });
        }
      } catch {
        // Fallback for unreadable files
        newAttachments.push({ name: file.name, type: "text", content: `[Could not read ${file.name}]` });
      }
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeConversationId]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputValue(value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;

    // Detect @-mention: find the last @ that isn't followed by a space/newline before cursor
    const cursorPos = target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const afterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // If there's a space or newline in afterAt, the @-mention is complete — close menu
      if (/[\s\n]/.test(afterAt)) {
        setShowAtMenu(false);
        return;
      }
      const query = afterAt;
      setAtQuery(query);
      setAtIndex(0);
      // Fetch and filter file list
      getFileList().then((files) => {
        const lowerQuery = query.toLowerCase();
        const filtered = files
          .filter((f) => f.toLowerCase().includes(lowerQuery))
          .slice(0, AT_MENU_MAX_ITEMS);
        setAtFiles([...filtered]);
        setShowAtMenu(filtered.length > 0);
      });
    } else {
      setShowAtMenu(false);
    }
  }, []);

  // @-mention: select a file from the autocomplete menu
  const selectAtFile = useCallback(async (filePath: string) => {
    setShowAtMenu(false);

    // Replace the @query in the input with the file reference
    const cursorPos = inputRef.current?.selectionStart ?? inputValue.length;
    const textBeforeCursor = inputValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
    if (lastAtIndex === -1) return;

    const before = inputValue.slice(0, lastAtIndex);
    const after = inputValue.slice(cursorPos);
    const newInput = `${before}@${filePath} ${after}`;
    setInputValue(newInput);

    // Read the file and add as attachment
    try {
      const content = await readFile(filePath);
      if (content != null) {
        const truncated = content.length > 10000
          ? content.slice(0, 10000) + "\n... (truncated, file too large)"
          : content;
        const fileType: "text" | "image" = isImageFile(filePath) ? "image" : "text";
        const fileName = filePath.split("/").pop() ?? filePath;
        setAttachments((prev) => [...prev, { name: fileName, type: fileType, content: truncated }]);
      }
    } catch {
      // File read failed — the @reference in text is still useful
    }
  }, [inputValue]);

  // Handle native file dialog paths from AttachButton
  const handleAttachPaths = useCallback(async (paths: readonly string[]) => {
    for (const path of paths) {
      try {
        const content = await readFile(path);
        if (content != null) {
          const truncated = content.length > 10000
            ? content.slice(0, 10000) + "\n... (truncated, file too large)"
            : content;
          const fileName = path.split("/").pop() ?? path;
          const fileType: "text" | "image" = isImageFile(fileName) ? "image" : "text";
          setAttachments((prev) => [...prev, { name: fileName, type: fileType, content: truncated }]);
        }
      } catch {
        const fileName = path.split("/").pop() ?? path;
        setAttachments((prev) => [...prev, { name: fileName, type: "text", content: `[Could not read ${path}]` }]);
      }
    }
  }, []);

  // Auto-send queued message when streaming completes (pi-mono pattern)
  useEffect(() => {
    if (!isStreaming && queuedMessage && activeConversationId) {
      sendMessage(activeConversationId, queuedMessage);
      setQueuedMessage(null);
    }
  }, [isStreaming, queuedMessage, activeConversationId, sendMessage]);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() && attachments.length === 0) return;

    // Auto-create a conversation if none exists
    let convId = activeConversationId;
    if (!convId) {
      convId = `conv-${Date.now()}`;
      const preview = inputValue.trim().slice(0, 80);
      addConversation({
        id: convId,
        title: preview || "New Chat",
        preview,
        updatedAt: Date.now(),
        // Empty-string sentinel when no provider is selected — daemon
        // routes via discovery instead of biasing toward Ollama.
        provider: useStore.getState().provider || "",
        model: useStore.getState().model || "",
        cost: 0,
        messageCount: 0,
      });
      setActiveConversation(convId);
    }
    if (isStreaming) {
      // During streaming: if input has text, send it as a steering message (interrupt + redirect).
      // If input is empty, stop the stream.
      if (inputValue.trim()) {
        // Steer: stop current generation and send the new message
        stopStreaming();
        // Small delay to ensure stop propagates before sending new message
        setTimeout(() => {
          sendMessage(convId, inputValue.trim());
          setInputValue("");
          if (inputRef.current) inputRef.current.style.height = "auto";
        }, 50);
        return;
      }
      stopStreaming();
      return;
    }
    // Build message with attachment context
    let fullMessage = inputValue.trim();
    if (attachments.length > 0) {
      const attachmentContext = attachments
        .filter((a) => a.type === "text")
        .map((a) => `@file:${a.name}\n\`\`\`\n${a.content}\n\`\`\``)
        .join("\n\n");
      const imageRefs = attachments
        .filter((a) => a.type === "image")
        .map((a) => `[Image: ${a.name}]`)
        .join(" ");
      if (attachmentContext) {
        fullMessage = `${attachmentContext}\n\n${fullMessage}`;
      }
      if (imageRefs) {
        fullMessage = `${fullMessage}\n${imageRefs}`;
      }
    }
    sendMessage(convId, fullMessage);
    setInputValue("");
    setAttachments([]);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [inputValue, attachments, activeConversationId, isStreaming, sendMessage, stopStreaming, addConversation, setActiveConversation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // @-menu navigation
      if (showAtMenu && atFiles.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtIndex((prev) => (prev + 1) % atFiles.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtIndex((prev) => (prev - 1 + atFiles.length) % atFiles.length);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          selectAtFile(atFiles[atIndex]!);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowAtMenu(false);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          selectAtFile(atFiles[atIndex]!);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();

        // Alt+Enter: Queue message for after current response completes
        if (e.altKey && isStreaming && inputValue.trim()) {
          setQueuedMessage(inputValue.trim());
          setInputValue("");
          if (inputRef.current) inputRef.current.style.height = "auto";
          return;
        }

        // Enter: Send immediately (steers the agent if streaming)
        handleSend();
      }
    },
    [handleSend, isStreaming, inputValue, showAtMenu, atFiles, atIndex, selectAtFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Read actual file content via Tauri command (not just filenames)
      for (const file of Array.from(files)) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // For text files: read content and inject inline
          const path = (file as any).path ?? file.name;
          const content = await invoke<string>("read_file", { path });
          if (content) {
            const truncated = content.length > 10000
              ? content.slice(0, 10000) + "\n... (truncated, file too large)"
              : content;
            setInputValue((prev) =>
              `${prev}${prev ? "\n" : ""}@file:${file.name}\n\`\`\`\n${truncated}\n\`\`\``
            );
          } else {
            setInputValue((prev) => `${prev}${prev ? "\n" : ""}[Attached: ${file.name}]`);
          }
        } catch {
          // Fallback: just include filename if Tauri read fails (e.g., binary file)
          setInputValue((prev) => `${prev}${prev ? "\n" : ""}[Attached: ${file.name}]`);
        }
      }
    }
  }, []);

  // Cost prediction — debounced call to predict_cost
  const [predictedCost, setPredictedCost] = useState<string | null>(null);
  useEffect(() => {
    if (!inputValue.trim()) {
      setPredictedCost(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
          const result = await invoke<{ estimated_cost: number }>("predict_cost", { prompt: inputValue });
          if (result?.estimated_cost != null) {
            setPredictedCost(`~$${result.estimated_cost.toFixed(2)}`);
          }
        }
      } catch {
        // Tauri unavailable or command failed — silently skip
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const charCount = inputValue.length;

  return (
    <div style={{ padding: "12px 24px 16px", background: "var(--color-bg-primary)", position: "relative", zIndex: 1, flexShrink: 0 }}>
      {/* Input container — mockup-aligned compact */}
      <div
        className={`${isStreaming ? " depth-input-streaming" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 16px",
          maxWidth: "var(--chat-max-width, 620px)",
          margin: "0 auto",
          position: "relative",
          background: color("surface"),
          border: `1px solid ${isDragOver ? "rgba(10,132,255,0.4)" : isStreaming ? "rgba(10,132,255,0.2)" : "transparent"}`,
          borderRadius: "var(--radius-lg)",
          transition: "border-color 150ms ease, box-shadow 150ms ease",
          boxShadow: isDragOver || isStreaming ? "0 0 0 3px rgba(10, 132, 255, 0.3)" : "none",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <AttachButton
          onAttach={(files) => {
            if (files) {
              processFiles(files);
            }
          }}
          onAttachPaths={handleAttachPaths}
        />

        {/* @-mention autocomplete dropdown */}
        {showAtMenu && atFiles.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 20,
              marginBottom: 4,
              background: `var(--surface-2, ${color("surface")})`,
              border: `1px solid var(--border-subtle, ${color("border")})`,
              borderRadius: "var(--radius-md, 8px)",
              padding: "4px 0",
              minWidth: 240,
              maxWidth: 400,
              zIndex: 50,
              boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
            }}
            role="listbox"
            aria-label="File suggestions"
          >
            {atFiles.map((file, idx) => (
              <button
                key={file}
                onClick={() => selectAtFile(file)}
                role="option"
                aria-selected={idx === atIndex}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "6px 12px",
                  border: "none",
                  background: idx === atIndex ? "var(--surface-3, rgba(255,255,255,0.08))" : "transparent",
                  color: idx === atIndex ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-sm, 13px)",
                  textAlign: "left",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, color: "var(--color-text-dim)" }}>
                  <path d="M3 1h5.5L12 4.5V13H3V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
                <span className="truncate">{file}</span>
              </button>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming
              ? "Type to steer... (Alt+Enter to queue follow-up)"
              : "Message WOTANN..."
          }
          className="flex-1 bg-transparent resize-none focus:outline-none min-h-[24px] max-h-[200px] placeholder:text-[var(--color-text-dim)]"
          style={{ fontSize: "var(--font-size-base, 15px)", color: "var(--color-text-primary)", caretColor: "var(--color-primary)", lineHeight: 1.5, outline: "none", border: "none", WebkitAppearance: "none" }}
          rows={1}
          aria-label="Message input"
        />

        {/* Action buttons — 32px ghost touch targets */}
        <div className="flex gap-1.5 items-center">
          <EnhanceButton
            onClick={async () => {
              if (!inputValue.trim()) return;
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                const result = await invoke<{ enhanced: string }>("enhance_prompt", { prompt: inputValue });
                if (result?.enhanced) setInputValue(result.enhanced);
              } catch {
                // Tauri not available
              }
            }}
            disabled={!inputValue.trim()}
          />
          <VoiceButton onTranscript={(text) => {
            setInputValue((prev) => `${prev}${prev ? " " : ""}${text}`);
          }} />

          {/* Send / Stop button */}
          <button
            onClick={handleSend}
            disabled={!isStreaming && !inputValue.trim()}
            className="shrink-0 flex items-center justify-center transition-all"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "none",
              background: isStreaming
                ? "var(--color-error)"
                : inputValue.trim()
                  ? color("accent")
                  : color("surface"),
              color: isStreaming || inputValue.trim() ? color("text") : "var(--color-text-dim)",
              boxShadow: inputValue.trim() && !isStreaming ? "0 2px 8px rgba(10, 132, 255, 0.25)" : "none",
              cursor: !isStreaming && !inputValue.trim() ? "default" : "pointer",
            }}
            aria-label={isStreaming ? "Stop generating" : "Send message"}
          >
            {isStreaming ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 12V4M4 7l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* File attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 px-1">
          {attachments.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-subtle)",
                color: "var(--color-text-secondary)",
              }}
            >
              <span style={{ color: file.type === "image" ? "var(--color-accent)" : "var(--color-primary)", display: "flex", alignItems: "center" }}>
                {file.type === "image" ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="4.5" cy="5.5" r="1.5" fill="currentColor"/>
                    <path d="M1 10l3-3 2 2 3-3 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 1h5.5L12 4.5V13H3V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button
                onClick={() => removeAttachment(index)}
                className="ml-0.5 hover:opacity-80 transition-opacity"
                style={{ color: "var(--color-text-muted)" }}
                aria-label={`Remove ${file.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Queued message indicator */}
      {queuedMessage && (
        <div
          className="flex items-center justify-between"
          style={{
            maxWidth: 860,
            margin: "8px auto 0",
            padding: "4px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            fontSize: "var(--font-size-xs)",
          }}
        >
          <span style={{ color: "var(--accent)", fontWeight: 500 }}>
            Queued: {queuedMessage.length > 60 ? `${queuedMessage.slice(0, 60)}...` : queuedMessage}
          </span>
          <button
            onClick={() => setQueuedMessage(null)}
            style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "var(--font-size-2xs)", padding: "2px 6px" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Bottom info bar — cost prediction + char count (model/mode shown in StatusBar) */}
      <div className="flex items-center justify-end px-1" style={{ maxWidth: 860, margin: "8px auto 0" }}>
        <div className="flex items-center gap-3" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
          {isDragOver && <span style={{ color: "var(--color-primary)" }}>Drop files to attach</span>}
          {predictedCost && (
            <span style={{ color: "var(--color-text-dim)" }} title="Estimated cost for this message">
              {predictedCost}
            </span>
          )}
          {charCount > 0 && (
            <span style={{ color: charCount > 10000 ? "var(--color-warning)" : "var(--color-text-dim)" }}>
              {charCount.toLocaleString()} chars
            </span>
          )}
        </div>
      </div>

      {/* Keyboard hints (shown when input is focused or has content) */}
      {(charCount > 0 || isStreaming) && (
        <div style={{ maxWidth: 860, margin: "4px auto 0", display: "flex", gap: 12, fontSize: 11, color: "var(--color-text-dim)" }}>
          <span><kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: "var(--radius-xs)", fontSize: 11 }}>Enter</kbd> {isStreaming ? "steer" : "send"}</span>
          <span><kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: "var(--radius-xs)", fontSize: 11 }}>Shift+Enter</kbd> new line</span>
          {isStreaming && <span><kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: "var(--radius-xs)", fontSize: 11 }}>Alt+Enter</kbd> queue</span>}
          <span><kbd style={{ background: "var(--surface-1)", padding: "1px 4px", borderRadius: "var(--radius-xs)", fontSize: 11 }}>@</kbd> mention file</span>
        </div>
      )}
    </div>
  );
}
