/**
 * CommandResults — list of palette commands, grouped by category.
 *
 * Receives the flat command list + selection state from the parent
 * CommandPalette. Keeps the DOM ordering identical to the flat list so
 * the selectedIndex maps 1:1 to item position.
 */

import { useEffect, useRef } from "react";
import { CommandItem } from "./CommandItem";
import type { PaletteCommand, PaletteCategory } from "./types";

interface CommandResultsProps {
  readonly commands: readonly PaletteCommand[];
  readonly selectedIndex: number;
  readonly onSelect: (command: PaletteCommand) => void;
  readonly onHoverIndex: (index: number) => void;
  readonly emptyQuery: string;
}

export function CommandResults({
  commands,
  selectedIndex,
  onSelect,
  onHoverIndex,
  emptyQuery,
}: CommandResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view when selectedIndex changes.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (commands.length === 0) {
    return (
      <div
        ref={listRef}
        id="palette-results"
        role="listbox"
        className="overflow-y-auto flex-1"
        style={{ padding: "24px 16px", textAlign: "center" }}
      >
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
          No commands found for <span style={{ color: "rgba(255,255,255,0.7)" }}>{emptyQuery}</span>
        </div>
      </div>
    );
  }

  // Group commands by category, preserving order.
  const grouped = new Map<PaletteCategory, PaletteCommand[]>();
  for (const cmd of commands) {
    const existing = grouped.get(cmd.category) ?? [];
    grouped.set(cmd.category, [...existing, cmd]);
  }

  let flatIndex = 0;

  return (
    <div
      ref={listRef}
      id="palette-results"
      role="listbox"
      className="overflow-y-auto flex-1"
      style={{ padding: "4px 8px" }}
    >
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category} role="group" aria-label={category}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)",
              padding: "10px 14px 6px",
            }}
          >
            {category}
          </div>
          {items.map((item) => {
            const currentIndex = flatIndex++;
            const selected = currentIndex === selectedIndex;
            return (
              <CommandItem
                key={item.id}
                command={item}
                selected={selected}
                dataIndex={currentIndex}
                onSelect={() => onSelect(item)}
                onFocus={() => onHoverIndex(currentIndex)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
