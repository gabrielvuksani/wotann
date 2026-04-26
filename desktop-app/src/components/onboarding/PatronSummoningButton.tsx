/**
 * PatronSummoningButton — V9 R-05 emitter for `wotann:open-patron`.
 *
 * The PatronSummoning sheet (mounted in App.tsx) listens for a
 * `wotann:open-patron` window CustomEvent to bring itself up. The
 * 2026-04-25 V9 unified gap audit (R-05) flagged that the listener
 * had ZERO emitters in the desktop-app source tree — this button is
 * the canonical one.
 *
 * The button is intended to live inside Settings (Advanced section
 * or Onboarding section, depending on where the SettingsView UX
 * decides to surface it). The component is presentation-only — it
 * dispatches the event and returns control. Persisting the chosen
 * patron is done by the sheet's `onSelect` handler in App.tsx.
 *
 * USAGE
 * ─────
 *
 *     <PatronSummoningButton />
 *
 * Or, with custom label / styling:
 *
 *     <PatronSummoningButton
 *       label="Re-summon patron"
 *       className="my-settings-button"
 *     />
 *
 * QUALITY BARS
 * ────────────
 *  - QB #6 honest stubs: when `window` is undefined (SSR / test
 *    sandbox without a DOM), the button still renders but the
 *    onClick is a no-op. NEVER throws.
 *  - QB #11 sibling-site safety: this is the SOLE button-shaped
 *    emitter for `wotann:open-patron` in desktop-app/src/. Other
 *    surfaces (CommandPalette, daemon-driven onboarding nags) can
 *    fire the same event directly via `emitOpenPatron()`.
 */

import { useCallback, type CSSProperties, type JSX } from "react";

// ── Public types ────────────────────────────────────────────

export interface PatronSummoningButtonProps {
  /**
   * Visible label for the button. Defaults to "Choose patron" so the
   * Settings UX reads as an action verb, not a navigation noun.
   */
  readonly label?: string;
  /**
   * Optional className merged onto the root <button>. Lets the
   * Settings panel apply its own pill / card / panel styling without
   * the button shipping with opinionated chrome.
   */
  readonly className?: string;
  /**
   * Optional inline style merged onto the root <button>. Same
   * rationale as `className` — the button doesn't ship with
   * opinionated default styling.
   */
  readonly style?: CSSProperties;
  /**
   * Optional callback fired AFTER the window event has been
   * dispatched. Useful when the parent wants to track the click
   * (e.g. analytics, "you've seen this once" flags) without coupling
   * to the patron sheet itself.
   */
  readonly onAfterClick?: () => void;
}

// ── Public emitter (also used by tests) ─────────────────────

/** Window event name this button dispatches. */
export const OPEN_PATRON_EVENT = "wotann:open-patron" as const;

/**
 * Dispatch `wotann:open-patron` directly without rendering a button.
 * Returns true when the event was dispatched, false in environments
 * without a usable EventTarget (e.g. SSR).
 */
export function emitOpenPatron(): boolean {
  if (typeof globalThis === "undefined") return false;
  const g = globalThis as { window?: EventTarget };
  const target = g.window ?? (globalThis as unknown as EventTarget);
  if (typeof target.dispatchEvent !== "function") return false;
  return target.dispatchEvent(new CustomEvent(OPEN_PATRON_EVENT));
}

// ── Component ───────────────────────────────────────────────

/**
 * Default styles — kept minimal so the host (Settings) controls
 * the visual register. The button mirrors the WOTANN secondary
 * pill so it composes cleanly with the existing Advanced section
 * card surface.
 */
const DEFAULT_STYLE: CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-subtle, rgba(255,255,255,0.12))",
  background: "var(--bg-surface, rgba(255,255,255,0.04))",
  color: "var(--color-text-primary, #f6f6f8)",
  cursor: "pointer",
  fontWeight: 500,
  transition: "background 120ms ease",
};

export function PatronSummoningButton(
  props: PatronSummoningButtonProps = {},
): JSX.Element {
  const { label, className, style, onAfterClick } = props;

  const handleClick = useCallback(() => {
    emitOpenPatron();
    if (onAfterClick) {
      try {
        onAfterClick();
      } catch {
        // Best-effort callback — failures here must not abort the
        // event dispatch (the sheet has already opened).
      }
    }
  }, [onAfterClick]);

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label="Open the Choose-Patron sheet"
      data-wotann-emit="open-patron"
      style={{ ...DEFAULT_STYLE, ...style }}
    >
      {label ?? "Choose patron"}
    </button>
  );
}
