/**
 * Command Palette — TUI ⌘P overlay.
 *
 * Triggered from App.tsx by the "command-palette" keybinding action
 * (Ctrl+P by default). Behaves like VSCode / Sublime:
 *   - Text input filters the registry via fuzzy match.
 *   - Up / Down navigates, Enter executes, Esc cancels.
 *   - Handler errors surface via `onError` (App shows a system message).
 */

import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CommandRegistry, Command } from "../command-registry.js";
import { CommandExecutionError } from "../command-registry.js";

interface CommandPaletteProps {
  readonly registry: CommandRegistry;
  readonly onClose: () => void;
  readonly onError?: (message: string) => void;
  readonly maxVisible?: number;
}

const DEFAULT_MAX_VISIBLE = 8;

export function CommandPalette({
  registry,
  onClose,
  onError,
  maxVisible = DEFAULT_MAX_VISIBLE,
}: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(() => registry.search(query), [registry, query]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  const executeSelected = useCallback(() => {
    const scored = results[clampedIndex];
    if (!scored) return;

    // Close the palette BEFORE running the handler — the handler may
    // itself mutate state or open another overlay.
    onClose();

    void registry.execute(scored.command.id).catch((err: unknown) => {
      const message =
        err instanceof CommandExecutionError
          ? err.message
          : `Command failed: ${err instanceof Error ? err.message : String(err)}`;
      onError?.(message);
    });
  }, [results, clampedIndex, registry, onClose, onError]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      executeSelected();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(results.length - 1, prev + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    // Plain text — do not swallow ctrl/meta combos so App keeps its bindings.
    if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
      setSelectedIndex(0);
    }
  });

  const visibleStart = Math.max(0, clampedIndex - Math.floor(maxVisible / 2));
  const visibleEntries = results.slice(visibleStart, visibleStart + maxVisible);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Box gap={1} marginBottom={1}>
        <Text color="magenta" bold>
          Command Palette
        </Text>
        <Text dimColor>
          ({results.length}/{registry.size})
        </Text>
      </Box>

      <Box gap={1}>
        <Text color="magenta">{">"}</Text>
        <Text>{query}</Text>
        <Text color="magenta">|</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.length === 0 && <Text dimColor>No matching commands</Text>}
        {visibleEntries.map((entry, displayIdx) => {
          const absoluteIdx = visibleStart + displayIdx;
          const isSelected = absoluteIdx === clampedIndex;
          return (
            <Box key={`cmd-${entry.command.id}`} gap={1}>
              <Text color={isSelected ? "magenta" : "gray"}>{isSelected ? ">" : " "}</Text>
              <Text bold={isSelected} color={isSelected ? "white" : undefined}>
                {entry.command.label}
              </Text>
              {entry.command.description !== undefined && (
                <Text dimColor>— {entry.command.description}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} gap={1}>
        <Text dimColor>Enter: run</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Esc: close</Text>
        <Text dimColor>|</Text>
        <Text dimColor>Arrows: navigate</Text>
      </Box>
    </Box>
  );
}

/**
 * Small helper so App.tsx can register the built-in TUI commands in one call.
 * Kept here (and not in App.tsx) so feature modules that import the registry
 * don't inherit React/Ink deps.
 */
export function registerBuiltinCommands(
  registry: CommandRegistry,
  commands: readonly Command[],
): void {
  for (const cmd of commands) {
    registry.register(cmd);
  }
}
