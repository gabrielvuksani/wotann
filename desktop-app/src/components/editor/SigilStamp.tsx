/**
 * SigilStamp — V9 T14.4 motif #2.
 *
 * A small gold underline + chevron rendered beneath the filename of any
 * file the agent has touched. Communicates "I changed this" without
 * stealing focus from the file label itself.
 *
 * Animated reveal:
 *   - 200ms underline trace, scaleX(0) → scaleX(1), eased.
 *   - Chevron pop in 240ms with a gentle overshoot, 80ms after the
 *     underline starts.
 *   - Whole stamp fades + lifts 2px on enter (240ms).
 *
 * The stamp inherits text colour from its parent, so the filename above
 * doesn't need restyling. The mark variants are:
 *
 *   modified — gold underline + chevron-right (default).
 *   created  — moss-green underline + plus glyph.
 *   deleted  — blood-red underline + minus glyph.
 *
 * The component is purely presentational. The parent supplies the file
 * name and the kind of change.
 */

import { type JSX } from "react";
import "../../styles/norse-motifs.css";

// ── Types ────────────────────────────────────────────────

export type SigilKind = "modified" | "created" | "deleted";

export interface SigilStampProps {
  /** The filename to display above the sigil mark. */
  readonly filename: string;
  /** Which kind of change this stamp represents. Defaults to "modified". */
  readonly kind?: SigilKind;
  /** Whether to underline only, hiding the inline glyph. Defaults to false. */
  readonly underlineOnly?: boolean;
  /** Optional className merged onto the root element. */
  readonly className?: string;
  /** Optional element id (useful for aria-describedby wiring). */
  readonly id?: string;
}

// ── Glyphs ────────────────────────────────────────────────

/**
 * Tiny inline SVG glyph beside the filename. Each glyph is sized to
 * 10x10 so it tucks into the line height without forcing a reflow.
 */
function SigilGlyph({ kind }: { readonly kind: SigilKind }): JSX.Element {
  if (kind === "created") {
    return (
      <svg
        className="sigil-stamp__chevron"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M6 2v8M2 6h8" />
      </svg>
    );
  }
  if (kind === "deleted") {
    return (
      <svg
        className="sigil-stamp__chevron"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 6h6" />
      </svg>
    );
  }
  // "modified" — chevron pointing right (next-step style).
  return (
    <svg
      className="sigil-stamp__chevron"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}

// ── A11y label ────────────────────────────────────────────

const KIND_DESCRIPTION: Record<SigilKind, string> = {
  modified: "modified by agent",
  created: "created by agent",
  deleted: "deleted by agent",
};

// ── Component ─────────────────────────────────────────────

export function SigilStamp({
  filename,
  kind = "modified",
  underlineOnly = false,
  className,
  id,
}: SigilStampProps): JSX.Element {
  const ariaLabel = `${filename} — ${KIND_DESCRIPTION[kind]}`;

  return (
    <span
      id={id}
      className={`sigil-stamp${className ? ` ${className}` : ""}`}
      data-kind={kind}
      role="img"
      aria-label={ariaLabel}
    >
      <span className="sigil-stamp__filename" style={{ position: "relative" }}>
        {filename}
        <span className="sigil-stamp__underline" aria-hidden="true" />
      </span>
      {!underlineOnly && <SigilGlyph kind={kind} />}
    </span>
  );
}
