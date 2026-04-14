/**
 * Command palette search input.
 *
 * Renders the magnifying-glass icon, the search box, and a keyboard-hint
 * cluster on the right (↑↓ to move, ⏎ to execute, ⎋ to close). The hints
 * use the monospace system font to match Apple's own HIG usage.
 */

import { forwardRef } from "react";

interface CommandInputProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly activeId?: string;
  readonly placeholder?: string;
  readonly categoryHint?: string;
}

export const CommandInput = forwardRef<HTMLInputElement, CommandInputProps>(
  function CommandInput(props, ref) {
    const {
      value,
      onChange,
      onKeyDown,
      activeId,
      placeholder = "Search commands, models, skills…",
      categoryHint,
    } = props;
    return (
      <div
        className="flex items-center gap-3"
        style={{
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          height: 52,
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          style={{ color: "rgba(255,255,255,0.45)" }}
          className="shrink-0"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent focus:outline-none"
          style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.95)",
            fontWeight: 400,
            height: 44,
          }}
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls="palette-results"
          aria-activedescendant={activeId}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {categoryHint && (
          <span
            style={{
              fontSize: 10,
              padding: "3px 7px",
              borderRadius: 5,
              background: "rgba(10,132,255,0.18)",
              color: "#0A84FF",
              fontWeight: 500,
              letterSpacing: 0.2,
              textTransform: "uppercase",
            }}
          >
            {categoryHint}
          </span>
        )}
        <div className="flex items-center gap-1.5 text-[10px]">
          <KbdHint>↑</KbdHint>
          <KbdHint>↓</KbdHint>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>move</span>
          <KbdHint>⏎</KbdHint>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>go</span>
          <KbdHint>⎋</KbdHint>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>close</span>
        </div>
      </div>
    );
  },
);

function KbdHint({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(255,255,255,0.08)",
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  );
}
