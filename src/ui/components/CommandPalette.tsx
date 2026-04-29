/**
 * Command Palette — TUI ⌘P overlay.
 *
 * Triggered from App.tsx by the "command-palette" keybinding action
 * (Ctrl+P by default). Behaves like VSCode / Sublime:
 *   - Text input filters the registry via fuzzy match.
 *   - Up / Down navigates, Enter executes, Esc cancels.
 *   - Handler errors surface via `onError` (App shows a system message).
 *
 * V9 design polish:
 *   - Wrapped in the Card primitive for a consistent rounded panel.
 *   - Footer rendered with KeyHintBar so the keys + descriptions
 *     match the rest of the surface (history picker, message actions).
 *   - Pointer glyph + cursor pulled from design tokens.
 */

import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { CommandRegistry, Command } from "../command-registry.js";
import { CommandExecutionError } from "../command-registry.js";
import type { Palette } from "../themes.js";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Card, KeyHintBar } from "./primitives/index.js";

interface CommandPaletteProps {
  readonly registry: CommandRegistry;
  readonly onClose: () => void;
  readonly onError?: (message: string) => void;
  readonly maxVisible?: number;
  /**
   * Active palette — passed from App so Ctrl+Y (theme cycle) flows through
   * to the overlay. Falls back to the dark canonical palette when unset
   * to keep the standalone-render path (tests / harness previews) green.
   */
  readonly palette?: Palette;
}

const DEFAULT_MAX_VISIBLE = 8;

const FOOTER_HINTS = [
  { keys: "Enter", description: "run" },
  { keys: "Esc", description: "close" },
  { keys: "Arrows", description: "navigate" },
];

export function CommandPalette({
  registry,
  onClose,
  onError,
  maxVisible = DEFAULT_MAX_VISIBLE,
  palette,
}: CommandPaletteProps): React.ReactElement {
  const tone = buildTone(palette ?? PALETTES.dark);
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
    <Card
      tone={tone}
      title="Command Palette"
      meta={`${results.length}/${registry.size}`}
      accent="primary"
    >
      <Box gap={1}>
        <Text color={tone.primary}>{">"}</Text>
        <Text color={tone.text}>{query}</Text>
        <Text color={tone.primary}>{glyph.cursorBlock}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.length === 0 && <Text color={tone.muted}>No matching commands</Text>}
        {visibleEntries.map((entry, displayIdx) => {
          const absoluteIdx = visibleStart + displayIdx;
          const isSelected = absoluteIdx === clampedIndex;
          return (
            <Box key={`cmd-${entry.command.id}`} gap={1}>
              <Text color={isSelected ? tone.primary : tone.border}>
                {isSelected ? glyph.pointer : " "}
              </Text>
              <Text bold={isSelected} color={isSelected ? tone.text : tone.text}>
                {entry.command.label}
              </Text>
              {entry.command.description !== undefined && (
                <Text color={tone.muted}>— {entry.command.description}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <KeyHintBar bindings={FOOTER_HINTS} tone={tone} />
      </Box>
    </Card>
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
