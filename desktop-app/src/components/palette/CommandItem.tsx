/**
 * Single row in the command palette. Pure presentation — state lives
 * in the CommandResults parent (so hover/keyboard both drive selection).
 */

import type { PaletteCommand } from "./types";

interface CommandItemProps {
  readonly command: PaletteCommand;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onFocus: () => void;
  readonly dataIndex: number;
}

const APPLE_BLUE = "#0A84FF";

export function CommandItem({ command, selected, onSelect, onFocus, dataIndex }: CommandItemProps) {
  return (
    <button
      type="button"
      id={`palette-item-${command.id}`}
      role="option"
      aria-selected={selected}
      data-index={dataIndex}
      className="w-full flex items-center gap-3 text-left"
      style={{
        padding: "0 12px",
        height: 44,
        borderRadius: 8,
        color: selected ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.82)",
        background: selected ? "rgba(10,132,255,0.14)" : "transparent",
        borderLeft: selected ? `2px solid ${APPLE_BLUE}` : "2px solid transparent",
        transition: "background 100ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onClick={onSelect}
      onMouseMove={onFocus}
    >
      {/* Icon */}
      <div
        style={{
          width: 22,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          color: selected ? APPLE_BLUE : "rgba(255,255,255,0.55)",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {command.icon ?? "◆"}
      </div>

      {/* Title + subtitle */}
      <div className="min-w-0 flex-1">
        <div
          className="truncate"
          style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}
        >
          {command.title}
        </div>
        {command.subtitle && (
          <div
            className="truncate"
            style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", marginTop: 1 }}
          >
            {command.subtitle}
          </div>
        )}
      </div>

      {/* Category badge (small) */}
      <span
        style={{
          fontSize: 9,
          padding: "2px 6px",
          borderRadius: 4,
          background: "rgba(255,255,255,0.05)",
          color: "rgba(255,255,255,0.4)",
          textTransform: "uppercase",
          letterSpacing: 0.3,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {command.category}
      </span>

      {/* Shortcut hint — monospace */}
      {command.shortcut && (
        <kbd
          className="shrink-0"
          style={{
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            fontSize: 10,
            padding: "3px 7px",
            borderRadius: 5,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1,
            letterSpacing: 0.2,
          }}
        >
          {command.shortcut}
        </kbd>
      )}
    </button>
  );
}
