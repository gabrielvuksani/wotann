/**
 * Prompt input: text input with history, slash command hints,
 * Ctrl+C abort, and visual feedback during streaming.
 *
 * V9 design polish:
 *   - Border + cursor colors come from the design tokens so theme
 *     switches stay coherent with the rest of the surface.
 *   - Slash autocomplete hint moved into a tiny KeyHint-style row that
 *     reads "Tab → /command — description" instead of the cramped
 *     literal joiner.
 *   - Streaming feedback uses the Spinner primitive plus a runic
 *     "ᚠ" mark — the same glyph the StartupScreen + ContextHUD use,
 *     reinforcing the cyan signature.
 *   - Mode badge upgraded to use the Pill primitive when active so
 *     the mode prompt visually agrees with the StatusBar's mode pill.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone, glyph, rune } from "../theme/tokens.js";
import { Pill, Spinner } from "./primitives/index.js";

interface PromptInputProps {
  readonly onSubmit: (value: string) => void;
  readonly onChange?: (value: string) => void;
  readonly onAbort?: () => void;
  readonly disabled?: boolean;
  readonly isStreaming?: boolean;
  readonly placeholder?: string;
  readonly history?: readonly string[];
  readonly mode?: string;
  readonly value?: string;
}

const SLASH_COMMANDS: readonly { readonly cmd: string; readonly desc: string }[] = [
  // Session
  { cmd: "/help", desc: "Show commands" },
  { cmd: "/clear", desc: "Clear conversation + reset" },
  { cmd: "/exit", desc: "Exit WOTANN" },
  { cmd: "/quit", desc: "Quit (alias)" },
  { cmd: "/history", desc: "Show recent prompts" },
  { cmd: "/compact", desc: "Compact context window" },
  // Configuration
  { cmd: "/config", desc: "View/edit config" },
  { cmd: "/providers", desc: "Auth status" },
  { cmd: "/model", desc: "Switch model" },
  { cmd: "/mode", desc: "Switch mode" },
  { cmd: "/thinking", desc: "Reasoning effort" },
  { cmd: "/theme", desc: "Switch theme" },
  { cmd: "/permission", desc: "Approval mode" },
  // Intelligence
  { cmd: "/context", desc: "Context budget" },
  { cmd: "/inspect", desc: "Context inspector" },
  { cmd: "/skills", desc: "List skills" },
  { cmd: "/memory", desc: "Search memory" },
  { cmd: "/learnings", desc: "Session learnings" },
  { cmd: "/persona", desc: "Identity system" },
  { cmd: "/council", desc: "Multi-model council" },
  { cmd: "/enhance", desc: "Enhance prompt" },
  { cmd: "/search", desc: "Unified search" },
  // Tools
  { cmd: "/lsp", desc: "LSP symbol ops" },
  { cmd: "/mcp", desc: "MCP server registry" },
  { cmd: "/freeze", desc: "Freeze file" },
  { cmd: "/healing", desc: "Self-healing pipeline" },
  { cmd: "/canvas", desc: "Hunk-level editor" },
  { cmd: "/deeplink", desc: "Deep link handler" },
  // Execution
  { cmd: "/autonomous", desc: "Autonomous mode" },
  { cmd: "/arena", desc: "Blind model arena" },
  { cmd: "/branch", desc: "Conversation branch" },
  { cmd: "/merge", desc: "Merge branch" },
  { cmd: "/waves", desc: "Progressive execution" },
  { cmd: "/research", desc: "Research mode" },
  // Channels
  { cmd: "/inbox", desc: "Dispatch inbox" },
  { cmd: "/channels", desc: "Channel list" },
  { cmd: "/dispatch", desc: "Dispatch task" },
  // Training
  { cmd: "/train", desc: "Training pipeline" },
  // Diagnostics
  { cmd: "/stats", desc: "Session stats" },
  { cmd: "/cost", desc: "Cost tracking" },
  { cmd: "/doctor", desc: "Health check" },
  { cmd: "/trace", desc: "Trace analysis" },
  { cmd: "/voice", desc: "Voice mode" },
  { cmd: "/replay", desc: "Replay session" },
  { cmd: "/dream", desc: "Learning extraction" },
  { cmd: "/audit", desc: "Session audit trail" },
  { cmd: "/roe", desc: "Rules of engagement" },
];

export function PromptInput({
  onSubmit,
  onChange,
  onAbort,
  disabled = false,
  isStreaming = false,
  placeholder = "Message WOTANN... (/ for commands)",
  history = [],
  mode = "default",
  value: controlledValue,
}: PromptInputProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [internalValue, setInternalValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Esc-Esc edit-prev (Codex pattern): track the time of the last
  // standalone Escape press so a quick double-tap (within 500ms) on
  // an empty input recalls the most recent prompt for editing.
  // Single Esc still clears the input as before.
  const [lastEscapeAt, setLastEscapeAt] = useState(0);
  const value = controlledValue ?? internalValue;
  const setValue = useCallback(
    (next: string | ((prev: string) => string)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: string) => string)(value) : next;
      if (controlledValue === undefined) {
        setInternalValue(resolved);
      }
      onChange?.(resolved);
    },
    [controlledValue, onChange, value],
  );

  // Find matching slash commands for autocomplete hint
  const slashHint =
    value.startsWith("/") && value.length > 1 && value.length < 12
      ? SLASH_COMMANDS.find(
          (c) => c.cmd.startsWith(value.toLowerCase()) && c.cmd !== value.toLowerCase(),
        )
      : null;

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    setValue("");
    setHistoryIndex(-1);
  }, [value, onSubmit]);

  useInput((input, key) => {
    // Ctrl+C aborts streaming or exits
    if (key.ctrl && input === "c") {
      if (isStreaming && onAbort) {
        onAbort();
      }
      return;
    }

    if (disabled && !isStreaming) return;

    // During streaming, only Ctrl+C works
    if (isStreaming) return;

    if (key.return) {
      handleSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    // Tab: autocomplete slash command
    if (key.tab && slashHint) {
      setValue(slashHint.cmd);
      return;
    }

    if (key.upArrow && history.length > 0) {
      const newIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(newIndex);
      setValue(history[newIndex] ?? "");
      return;
    }

    if (key.downArrow) {
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      setValue(newIndex >= 0 ? (history[newIndex] ?? "") : "");
      return;
    }

    if (key.escape) {
      const now = Date.now();
      // Esc-Esc edit-prev: empty input + double-tap within 500ms
      // recalls the most recent prompt. Mirrors Codex CLI's pattern
      // ("Esc Esc edit prev when empty"); footer hint surfaces it
      // when the input is empty.
      if (value.length === 0 && now - lastEscapeAt < 500 && history.length > 0) {
        const last = history[0] ?? "";
        if (last.length > 0) {
          setValue(last);
          setHistoryIndex(0);
        }
        setLastEscapeAt(0);
        return;
      }
      // Single Esc clears input + resets history cursor
      setValue("");
      setHistoryIndex(-1);
      setLastEscapeAt(now);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  // Border tone reflects state — streaming green, slash command warning,
  // default brand cyan. Pulled from tokens so theme cycling stays coherent.
  const borderTone = isStreaming
    ? tone.success
    : value.startsWith("/")
      ? tone.warning
      : tone.primary;

  return (
    <Box flexDirection="column">
      {/* Slash command autocomplete hint */}
      {slashHint && (
        <Box paddingX={2} gap={1}>
          <Text color={tone.muted}>Tab</Text>
          <Text color={tone.primary}>{glyph.arrowRight}</Text>
          <Text color={tone.warning} bold>
            {slashHint.cmd}
          </Text>
          <Text color={tone.muted}>
            {glyph.bullet} {slashHint.desc}
          </Text>
        </Box>
      )}

      {/* Input box */}
      <Box borderStyle="round" borderColor={borderTone} paddingX={1}>
        {isStreaming ? (
          <Box gap={1}>
            <Spinner tone={tone} accent="success" />
            <Text color={tone.muted}>Streaming...</Text>
            <Text color={tone.muted}>Press</Text>
            <Text color={tone.warning} bold>
              Ctrl+C
            </Text>
            <Text color={tone.muted}>to abort</Text>
          </Box>
        ) : (
          <Box>
            {mode === "default" ? (
              <Box gap={1}>
                <Text color={tone.rune} bold>
                  {rune.ask}
                </Text>
                <Text color={borderTone} bold>
                  {">"}
                </Text>
              </Box>
            ) : (
              <Box gap={1}>
                <Pill tone={tone} label={mode} variant="info" />
                <Text color={borderTone} bold>
                  {">"}
                </Text>
              </Box>
            )}
            <Text> </Text>
            {value.length > 0 ? (
              <Text>
                {value.startsWith("/") ? (
                  <Text color={tone.warning}>{value}</Text>
                ) : (
                  <Text color={tone.text}>{value}</Text>
                )}
                <Text color={tone.primary}>{glyph.cursorBlock}</Text>
              </Text>
            ) : (
              <Text>
                <Text color={tone.muted}>{placeholder}</Text>
                <Text color={tone.primary}>{glyph.cursorBlock}</Text>
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
