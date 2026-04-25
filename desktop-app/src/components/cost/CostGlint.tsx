/**
 * CostGlint — V9 T14.4 motif #6.
 *
 * Specular sheen that sweeps across a cost number when the active
 * provider key is a paid (BYOK) key. The sheen reads as "this number
 * is real money" — not a tax that screams at the user, just a quiet
 * material affordance like polished metal.
 *
 * Behaviour:
 *   - When `paid={true}`, a CSS pseudo-element sweeps a linear-gradient
 *     highlight across the value once every ~6s.
 *   - When `paid={false}`, no animation runs (free / local provider).
 *   - The sheen has a subtle hue rotate baked into the keyframes so it
 *     reads as iridescent rather than a flat white smear.
 *
 * The animation is pure CSS — no state, no timer, no JS hot path. The
 * component just gates the animation on a data attribute.
 *
 * The component does not format the value — the parent supplies the
 * already-formatted text (e.g. "$0.0042"). This keeps the component
 * locale- and currency-agnostic.
 */

import { type CSSProperties, type JSX, type ReactNode } from "react";
import "../../styles/norse-motifs.css";

// ── Types ────────────────────────────────────────────────

export interface CostGlintProps {
  /** Whether the active provider is a paid (BYOK) key. Drives the sheen. */
  readonly paid: boolean;
  /** The already-formatted cost string (e.g. "$0.0042"). */
  readonly value: string;
  /** Optional custom title attribute (e.g. "Total session cost"). */
  readonly title?: string;
  /** Optional class merged onto the root span. */
  readonly className?: string;
  /** Optional inline style override. */
  readonly style?: CSSProperties;
  /** Optional prefix node, rendered before the value (e.g., a coin glyph). */
  readonly prefix?: ReactNode;
}

// ── Component ────────────────────────────────────────────

export function CostGlint({
  paid,
  value,
  title,
  className,
  style,
  prefix,
}: CostGlintProps): JSX.Element {
  return (
    <span
      className={`cost-glint${className ? ` ${className}` : ""}`}
      data-paid={paid ? "true" : "false"}
      title={title}
      style={style}
      aria-label={title ?? `Cost: ${value}`}
    >
      <span className="cost-glint__value">
        {prefix && (
          <span aria-hidden="true" style={{ marginRight: 4 }}>
            {prefix}
          </span>
        )}
        {value}
      </span>
    </span>
  );
}
