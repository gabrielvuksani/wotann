/**
 * Valknut Spinner — WOTANN's signature loading indicator.
 *
 * Session-6 UI signature per docs/UI_DESIGN_SPEC_2026-04-16.md §4.
 * Odin's three-interlocked-triangles symbol, rotated over a gentle
 * ease-standard curve at 1600ms. Replaces every generic CSS spinner
 * across the app so loading states carry WOTANN's visual identity
 * rather than the ubiquitous Bootstrap/Tailwind circle-dash.
 *
 * Colour and size are prop-driven (defaults match the `accent.rune`
 * token). Respects `prefers-reduced-motion` — when set, the spinner
 * renders statically (no rotation) but remains visible as a presence
 * indicator so users who disable motion still see "something's
 * happening".
 */

import { useId, type JSX } from "react";

export interface ValknutSpinnerProps {
  /** Diameter in px. Default 32. */
  readonly size?: number;
  /** CSS colour for the triangle strokes. Default `currentColor`. */
  readonly color?: string;
  /** Stroke width in user-units (viewBox is -16..16). Default 1.5. */
  readonly strokeWidth?: number;
  /** Optional className for additional styling hooks. */
  readonly className?: string;
  /** ARIA label for screen readers. Default "Loading". */
  readonly label?: string;
}

export function ValknutSpinner({
  size = 32,
  color = "currentColor",
  strokeWidth = 1.5,
  className,
  label = "Loading",
}: ValknutSpinnerProps): JSX.Element {
  // Stable ID for aria-labelledby — avoids SSR mismatches.
  const id = useId();
  return (
    <svg
      role="status"
      aria-labelledby={id}
      width={size}
      height={size}
      viewBox="-16 -16 32 32"
      className={className}
      style={{
        animation:
          "wotann-valknut-spin var(--wotann-duration-valknut, 1600ms) var(--wotann-ease-standard, cubic-bezier(0.4, 0.14, 0.3, 1)) infinite",
      }}
    >
      <title id={id}>{label}</title>
      <polygon
        points="0,-12 10.39,6 -10.39,6"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <polygon
        points="0,-12 10.39,6 -10.39,6"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        transform="rotate(120)"
      />
      <polygon
        points="0,-12 10.39,6 -10.39,6"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        transform="rotate(240)"
      />
    </svg>
  );
}

/**
 * Ruune-Forge Thinking indicator — three Elder Futhark glyphs stroke-
 * dash in sequence. Session-6 design-spec §6 micro-interaction #2.
 * Replaces the three-dot "..." spinner ubiquitous across AI chat UIs
 * with a visually unique runic alternative.
 */
export interface RuneForgeIndicatorProps {
  readonly size?: number;
  readonly color?: string;
  readonly className?: string;
  readonly label?: string;
}

export function RuneForgeIndicator({
  size = 40,
  color = "currentColor",
  className,
  label = "Thinking",
}: RuneForgeIndicatorProps): JSX.Element {
  const id = useId();
  return (
    <span
      role="status"
      aria-labelledby={id}
      className={className}
      style={{
        display: "inline-flex",
        gap: "0.2em",
        fontFamily: "var(--wotann-font-rune, 'Noto Sans Runic', system-ui)",
        fontSize: `${size * 0.5}px`,
        color,
        letterSpacing: "0.08em",
      }}
    >
      <span id={id} style={{ position: "absolute", left: "-9999px" }}>
        {label}
      </span>
      <span
        style={{
          animation:
            "wotann-rune-forge 960ms var(--wotann-ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)) 0s infinite",
        }}
      >
        ᚠ
      </span>
      <span
        style={{
          animation:
            "wotann-rune-forge 960ms var(--wotann-ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)) 320ms infinite",
        }}
      >
        ᛉ
      </span>
      <span
        style={{
          animation:
            "wotann-rune-forge 960ms var(--wotann-ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)) 640ms infinite",
        }}
      >
        ᚹ
      </span>
    </span>
  );
}

/**
 * Inject the CSS keyframes into the document head. Call once from the
 * app entry point. Deliberately a one-off side effect rather than a
 * <style jsx> tag — WOTANN's Tauri bundle avoids runtime CSS-in-JS.
 */
export function injectValknutKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("wotann-valknut-keyframes")) return;
  const style = document.createElement("style");
  style.id = "wotann-valknut-keyframes";
  style.textContent = `
@keyframes wotann-valknut-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes wotann-rune-forge {
  0%   { opacity: 0.25; transform: translateY(0); }
  30%  { opacity: 1;    transform: translateY(-2px); }
  60%  { opacity: 1;    transform: translateY(0); }
  100% { opacity: 0.25; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes wotann-valknut-spin {
    from, to { transform: rotate(0deg); }
  }
  @keyframes wotann-rune-forge {
    0%, 100% { opacity: 0.7; transform: none; }
  }
}
`;
  document.head.appendChild(style);
}
