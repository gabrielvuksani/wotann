/**
 * ComposerInput — Cursor-style chat composer with inline @-reference chips.
 *
 * Behavior:
 * - Typing `@file:`, `@symbol:`, `@git:`, `@memory:`, `@skill:`, or `@web:`
 *   opens the AtReferences popover anchored at the caret.
 * - Selecting an item replaces the raw `@prefix:query` token with a styled
 *   chip (like `[File: runtime.ts]`) embedded inline in the textarea text.
 * - Chips render visually as pills via a CSS-backed overlay layer, and are
 *   removed with Backspace when the caret is just after the chip.
 * - Enter submits, Shift+Enter inserts a newline, 8-row auto-grow height.
 *
 * Design tokens:
 * - Dark bg #000000, chip bg #1C1C1E with #0A84FF accent border
 * - SF Pro system font, 15pt body text
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AtReferences,
  findActiveAtToken,
  type AtCaretAnchor,
  type AtItem,
  type AtPrefix,
  type AtTokenMatch,
} from "./AtReferences";

// ── Public props ─────────────────────────────────────────────────────────

export interface ComposerChipValue {
  readonly kind: AtPrefix;
  readonly value: string;
  readonly label: string;
}

export interface ComposerInputProps {
  /** Controlled plain-text value (chips serialize to `[File: runtime.ts]`). */
  readonly value?: string;
  /** Called on every text change. */
  readonly onChange?: (value: string) => void;
  /** Called when the user submits (Enter without Shift). */
  readonly onSubmit?: (value: string, chips: readonly ComposerChipValue[]) => void;
  /** Placeholder text shown when empty. */
  readonly placeholder?: string;
  /** Disable input and submission. */
  readonly disabled?: boolean;
  /** Max visual rows before the textarea starts scrolling. Defaults to 8. */
  readonly maxRows?: number;
}

// ── Constants ────────────────────────────────────────────────────────────

const ACCENT = "#0A84FF";
const CHIP_BG = "#1C1C1E";
const MAX_ROWS_DEFAULT = 8;
const ROW_HEIGHT_PX = 22; // 15pt body * ~1.5 line-height
const MIN_ROWS = 1;

// Serialization format for chips embedded in plain text.
// Example:  [File: runtime.ts]   [Memory: cases/hooks]
// A regex extracts these back out when the user removes one with Backspace.
const CHIP_LABELS: Readonly<Record<AtPrefix, string>> = {
  file: "File",
  symbol: "Symbol",
  git: "Commit",
  memory: "Memory",
  skill: "Skill",
  web: "Web",
};

// Match any `[Label: body]` chip where Label is one of the known prefixes.
// Body is any run of chars that isn't `]` or a newline.
const CHIP_PATTERN = /\[(File|Symbol|Commit|Memory|Skill|Web): ([^\]\n]+)\]/g;

const LABEL_TO_PREFIX: Readonly<Record<string, AtPrefix>> = {
  File: "file",
  Symbol: "symbol",
  Commit: "git",
  Memory: "memory",
  Skill: "skill",
  Web: "web",
};

function chipToText(chip: ComposerChipValue): string {
  return `[${CHIP_LABELS[chip.kind]}: ${chip.label}]`;
}

// Parse chips out of the current text value so callers can receive structured
// data on submit. Only recognises the serialized `[Label: body]` form.
function parseChips(text: string): readonly ComposerChipValue[] {
  const chips: ComposerChipValue[] = [];
  for (const m of text.matchAll(CHIP_PATTERN)) {
    const labelRaw = m[1];
    const bodyRaw = m[2];
    if (!labelRaw || !bodyRaw) continue;
    const kind = LABEL_TO_PREFIX[labelRaw];
    if (!kind) continue;
    chips.push({ kind, value: bodyRaw, label: bodyRaw });
  }
  return chips;
}

// ── Chip overlay rendering ───────────────────────────────────────────────
// We can't put real DOM elements inside a <textarea>. Instead we render an
// invisible overlay that mirrors the textarea's wrapped text and replaces
// each `[Label: body]` match with a styled pill. The textarea sits on top
// with transparent text so only the caret + selection show through.

interface OverlaySegment {
  readonly kind: "text" | "chip";
  readonly content: string;
  readonly prefix?: AtPrefix;
  readonly label?: string;
}

function segmentText(text: string): readonly OverlaySegment[] {
  const segments: OverlaySegment[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(CHIP_PATTERN)) {
    const matchIndex = m.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ kind: "text", content: text.slice(lastIndex, matchIndex) });
    }
    const labelRaw = m[1];
    const bodyRaw = m[2];
    if (labelRaw && bodyRaw) {
      const prefix = LABEL_TO_PREFIX[labelRaw];
      if (prefix) {
        segments.push({
          kind: "chip",
          content: m[0],
          prefix,
          label: bodyRaw,
        });
        lastIndex = matchIndex + m[0].length;
        continue;
      }
    }
    segments.push({ kind: "text", content: m[0] });
    lastIndex = matchIndex + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

function ChipPill({ prefix, label }: { readonly prefix: AtPrefix; readonly label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        margin: "0 1px",
        borderRadius: 6,
        background: CHIP_BG,
        border: `1px solid ${ACCENT}40`,
        boxShadow: `inset 0 0 0 1px ${ACCENT}14`,
        color: "#E6E6EB",
        fontSize: 13,
        lineHeight: 1.25,
        fontWeight: 500,
        whiteSpace: "nowrap",
        verticalAlign: "baseline",
      }}
    >
      <span style={{ color: ACCENT, fontSize: 11, letterSpacing: "0.02em", textTransform: "uppercase" }}>
        {CHIP_LABELS[prefix]}
      </span>
      <span style={{ opacity: 0.35 }}>:</span>
      <span>{label}</span>
    </span>
  );
}

// ── Caret geometry ───────────────────────────────────────────────────────
// Compute the viewport-relative position of the textarea caret by mirroring
// the textarea into a hidden <div> with the same styles. This is the same
// technique used by Cursor, GitHub, and Notion for inline autocompletes.

interface CaretGeometry {
  readonly top: number;
  readonly left: number;
}

const MIRROR_STYLE_PROPS: readonly (keyof CSSStyleDeclaration)[] = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
];

function measureCaret(el: HTMLTextAreaElement, position: number): CaretGeometry {
  const mirror = document.createElement("div");
  const style = mirror.style;
  const computed = window.getComputedStyle(el);
  for (const prop of MIRROR_STYLE_PROPS) {
    style[prop as any] = computed[prop as any];
  }
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "-9999px";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";

  const before = el.value.slice(0, position);
  const after = el.value.slice(position) || ".";
  const beforeNode = document.createTextNode(before);
  const span = document.createElement("span");
  span.textContent = after[0] ?? ".";
  const afterNode = document.createTextNode(after.slice(1));
  mirror.appendChild(beforeNode);
  mirror.appendChild(span);
  mirror.appendChild(afterNode);
  document.body.appendChild(mirror);

  const rect = el.getBoundingClientRect();
  const scrollTop = el.scrollTop;
  const scrollLeft = el.scrollLeft;
  const top = rect.top + span.offsetTop - scrollTop;
  const left = rect.left + span.offsetLeft - scrollLeft;

  document.body.removeChild(mirror);
  return { top, left };
}

// ── Component ────────────────────────────────────────────────────────────

export function ComposerInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...  Use @file: @symbol: @git: @memory: @skill: @web:",
  disabled = false,
  maxRows = MAX_ROWS_DEFAULT,
}: ComposerInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? "");
  const isControlled = value !== undefined;
  const currentValue = isControlled ? (value ?? "") : internalValue;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [atMatch, setAtMatch] = useState<AtTokenMatch | null>(null);
  const [caretAnchor, setCaretAnchor] = useState<AtCaretAnchor>({ top: 0, left: 0 });

  // Keep uncontrolled state in sync when caller stops passing `value`.
  useEffect(() => {
    if (isControlled) return;
    // noop — internalValue owned locally
  }, [isControlled]);

  const applyValue = useCallback(
    (next: string) => {
      if (!isControlled) setInternalValue(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  // Recompute the @-token and caret geometry on any input change.
  const refreshAtMatch = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setAtMatch(null);
      return;
    }
    const cursor = el.selectionStart ?? el.value.length;
    const match = findActiveAtToken(el.value, cursor);
    setAtMatch(match);
    if (match) {
      const geo = measureCaret(el, match.endIndex);
      setCaretAnchor({ top: geo.top, left: geo.left });
    }
  }, []);

  // Keep overlay scroll locked to textarea scroll so chips don't drift.
  const handleScroll = useCallback(() => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // Auto-grow height between 1 and `maxRows` rows.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = maxRows * ROW_HEIGHT_PX + 20;
    const next = Math.max(MIN_ROWS * ROW_HEIGHT_PX + 20, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows]);

  useLayoutEffect(() => {
    resize();
  }, [currentValue, resize]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      applyValue(e.target.value);
      // schedule a refresh after React commits so selectionStart is accurate
      queueMicrotask(refreshAtMatch);
    },
    [applyValue, refreshAtMatch],
  );

  const handleSelect = useCallback(() => {
    refreshAtMatch();
  }, [refreshAtMatch]);

  const handleClick = useCallback(() => {
    refreshAtMatch();
  }, [refreshAtMatch]);

  const dismissPopover = useCallback(() => {
    setAtMatch(null);
  }, []);

  // Insert a chip at the active @-token position.
  const insertChip = useCallback(
    (item: AtItem) => {
      const el = textareaRef.current;
      if (!el) return;
      const match = atMatch;
      if (!match) return;
      const chipText = chipToText({
        kind: item.kind,
        value: item.value,
        label: item.chipLabel,
      });
      const before = el.value.slice(0, match.startIndex);
      const after = el.value.slice(match.endIndex);
      const needsSpace = after.length === 0 || !/^\s/.test(after);
      const insertion = `${chipText}${needsSpace ? " " : ""}`;
      const nextValue = `${before}${insertion}${after}`;
      applyValue(nextValue);
      // Restore caret to just after the inserted chip/space.
      const nextCursor = before.length + insertion.length;
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(nextCursor, nextCursor);
        refreshAtMatch();
      });
      setAtMatch(null);
    },
    [atMatch, applyValue, refreshAtMatch],
  );

  // Backspace a whole chip when the caret is immediately after `]`.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = textareaRef.current;
      if (!el) return;

      // Popover is open: let AtReferences own Enter/Escape/ArrowUp/ArrowDown.
      if (atMatch) {
        if (e.key === "Tab") {
          e.preventDefault();
          return;
        }
        if (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowUp" || e.key === "ArrowDown") {
          // Popover handles these at capture stage; stop the textarea default.
          return;
        }
      }

      // Submit on Enter (no Shift) when popover is NOT open.
      if (!atMatch && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (disabled) return;
        const trimmed = el.value.trim();
        if (!trimmed) return;
        const chips = parseChips(el.value);
        onSubmit?.(el.value, chips);
        return;
      }

      // Chip-aware Backspace: if the caret is right after `]` and the text
      // ending at that position matches a chip, wipe the whole chip atomically.
      if (e.key === "Backspace" && el.selectionStart === el.selectionEnd) {
        const cursor = el.selectionStart ?? 0;
        if (cursor > 0 && el.value[cursor - 1] === "]") {
          const before = el.value.slice(0, cursor);
          const pattern = /\[(File|Symbol|Commit|Memory|Skill|Web): ([^\]\n]+)\]$/;
          const m = before.match(pattern);
          if (m) {
            e.preventDefault();
            const chipStart = cursor - m[0].length;
            const next = el.value.slice(0, chipStart) + el.value.slice(cursor);
            applyValue(next);
            requestAnimationFrame(() => {
              const node = textareaRef.current;
              if (!node) return;
              node.focus();
              node.setSelectionRange(chipStart, chipStart);
              refreshAtMatch();
            });
            return;
          }
        }
      }
    },
    [atMatch, disabled, onSubmit, applyValue, refreshAtMatch],
  );

  const overlaySegments = useMemo(() => segmentText(currentValue), [currentValue]);

  // Hide the popover when the textarea loses focus (unless focus went to the
  // popover itself, which keeps onSelect functional via onMouseDown).
  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    const next = e.relatedTarget as HTMLElement | null;
    if (next && next.closest && next.closest('[role="listbox"]')) return;
    setAtMatch(null);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        padding: 12,
        borderRadius: 14,
        background: "#000000",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
        font: "15px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
        color: "#F2F2F7",
      }}
    >
      {/* Visual overlay — renders chips as pills underneath the textarea. */}
      <div
        ref={overlayRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 12,
          pointerEvents: "none",
          overflow: "hidden",
          fontSize: 15,
          lineHeight: `${ROW_HEIGHT_PX}px`,
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
          color: "rgba(255,255,255,0.92)",
        }}
      >
        {overlaySegments.map((seg, i) => {
          if (seg.kind === "chip" && seg.prefix && seg.label) {
            return <ChipPill key={`c-${i}`} prefix={seg.prefix} label={seg.label} />;
          }
          return (
            <span
              key={`t-${i}`}
              style={{ color: "transparent" }}
              // The textarea provides the real caret; we render transparent
              // text here purely to preserve the layout of wrapped lines so
              // chips land in the right visual location.
            >
              {seg.content}
            </span>
          );
        })}
      </div>

      <textarea
        ref={textareaRef}
        value={currentValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleClick}
        onScroll={handleScroll}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        spellCheck={false}
        aria-label="Message composer"
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          width: "100%",
          minHeight: ROW_HEIGHT_PX + 4,
          maxHeight: maxRows * ROW_HEIGHT_PX + 20,
          margin: 0,
          padding: 0,
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          fontFamily: "inherit",
          fontSize: 15,
          lineHeight: `${ROW_HEIGHT_PX}px`,
          color: "transparent",
          caretColor: "#F2F2F7",
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
        }}
      />

      {atMatch && (
        <AtReferences
          prefix={atMatch.prefix}
          query={atMatch.query}
          open={atMatch !== null}
          anchor={caretAnchor}
          onSelect={insertChip}
          onDismiss={dismissPopover}
        />
      )}
    </div>
  );
}
