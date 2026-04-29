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

/**
 * Slash popup row cap — Codex CLI uses similar bound. Keeping the
 * popup tight prevents it from eating half the terminal when a
 * generic prefix like `/` shows everything.
 */
const MAX_SLASH_ROWS = 8;

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
  // Slash popup cursor — index into the filtered match list. Reset
  // to 0 whenever the value changes so freshly-typed characters
  // start from the top match.
  const [slashIndex, setSlashIndex] = useState(0);
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
      // Any input change resets the popup cursor to the top match so
      // typing further never leaves the highlight stranded on a row
      // that's been filtered out.
      setSlashIndex(0);
      onChange?.(resolved);
    },
    [controlledValue, onChange, value],
  );

  // Slash popup matches — Codex-style multi-row picker. Upgrade from
  // the prior "show one hint" pattern: now we surface up to 8 matches
  // ordered by exact > prefix > substring, with arrow-key navigation
  // and Tab autocompletes the highlighted entry.
  const slashMatches = (() => {
    if (!value.startsWith("/")) return [] as readonly { cmd: string; desc: string }[];
    const query = value.toLowerCase();
    if (query === "/") {
      // Bare "/" shows the full menu (most-used commands first)
      return SLASH_COMMANDS.slice(0, MAX_SLASH_ROWS);
    }
    const exact: (typeof SLASH_COMMANDS)[number][] = [];
    const prefix: (typeof SLASH_COMMANDS)[number][] = [];
    const substring: (typeof SLASH_COMMANDS)[number][] = [];
    for (const cmd of SLASH_COMMANDS) {
      if (cmd.cmd === query) exact.push(cmd);
      else if (cmd.cmd.startsWith(query)) prefix.push(cmd);
      else if (cmd.cmd.includes(query.slice(1))) substring.push(cmd);
    }
    return [...exact, ...prefix, ...substring].slice(0, MAX_SLASH_ROWS);
  })();
  const showSlashPopup = slashMatches.length > 0 && value.startsWith("/");
  // Clamp the cursor whenever the match set shrinks
  const clampedSlashIndex = Math.min(slashIndex, Math.max(0, slashMatches.length - 1));
  const slashHint = showSlashPopup ? slashMatches[clampedSlashIndex] : null;

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

    // Pre-2026-04-29 the input was hard-blocked during streaming
    // (`if (isStreaming) return;`). Removed to enable the open-swe
    // check_message_queue port (commit 0ca2fd3 + follow-up): user can
    // type while the agent streams, and handleSubmit at App.tsx:3509
    // routes the typed message into the per-session pending queue,
    // which the runtime drains before the next model.complete() call.
    // Slash commands and `wotann://` deep links still fire immediately
    // (handled by App.tsx handleSubmit's mid-stream branch).

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

    // Arrow nav routes to the slash popup when it's active so users
    // can pick from the multi-row dropdown without their muscle-memory
    // history-recall behaviour collapsing the popup. When the popup
    // is closed (no leading "/"), arrows resume their history-walk
    // role.
    if (key.upArrow) {
      if (showSlashPopup) {
        setSlashIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setValue(history[newIndex] ?? "");
        return;
      }
    }

    if (key.downArrow) {
      if (showSlashPopup) {
        setSlashIndex((prev) => Math.min(slashMatches.length - 1, prev + 1));
        return;
      }
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
      {/*
        Slash popup — Codex/Claude-Code-style multi-row picker.
        Shows up to MAX_SLASH_ROWS matches with the highlighted row
        rendered bold + arrow indicator. Arrow keys navigate within
        the popup (instead of the history walk); Tab autocompletes
        the highlighted row's command into the input.
      */}
      {showSlashPopup && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={tone.warning}
          paddingX={1}
          marginBottom={0}
        >
          {slashMatches.map((entry, idx) => {
            const isActive = idx === clampedSlashIndex;
            return (
              <Box key={entry.cmd} gap={1}>
                <Text color={isActive ? tone.warning : tone.border}>
                  {isActive ? glyph.arrowRight : " "}
                </Text>
                <Text color={isActive ? tone.warning : tone.muted} bold={isActive}>
                  {entry.cmd}
                </Text>
                <Text color={tone.muted}>{glyph.bullet}</Text>
                <Text color={tone.muted}>{entry.desc}</Text>
              </Box>
            );
          })}
          <Box gap={1} marginTop={0}>
            <Text color={tone.muted} dimColor>
              ↑/↓ navigate · Tab fill · Enter run
            </Text>
          </Box>
        </Box>
      )}

      {/* Input box — during streaming, render BOTH a status row + the
          live input so users can queue a next-turn message via the
          open-swe check_message_queue port. */}
      <Box borderStyle="round" borderColor={borderTone} paddingX={1} flexDirection="column">
        {isStreaming && (
          <Box gap={1}>
            <Spinner tone={tone} accent="success" />
            <Text color={tone.muted}>Streaming —</Text>
            <Text color={tone.warning} bold>
              Ctrl+C
            </Text>
            <Text color={tone.muted}>aborts; typing queues for next turn</Text>
          </Box>
        )}
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
              <Text color={tone.muted}>
                {isStreaming ? "Type to queue for next turn..." : placeholder}
              </Text>
              <Text color={tone.primary}>{glyph.cursorBlock}</Text>
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
