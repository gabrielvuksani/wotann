/**
 * RavensFlightAnimation — V9 T14.4 motif #4.
 *
 * Parabolic-arc raven that flies across the screen when iOS dispatches
 * a task to desktop (or vice versa). Three-phase motion:
 *
 *   - 50ms takeoff lift   (rises 6px, scales in from 85%).
 *   - 600ms parabolic arc (apex at peak-y, eased standard).
 *   - 150ms landing       (drops 4px, fades out).
 *
 * Total ~800ms. Pure CSS keyframes drive the motion — no framer-motion
 * dependency since `package.json` doesn't ship one and the spec
 * permits CSS as the fallback.
 *
 * Wiring:
 *   - The `flights` prop is a list of active flights. Each flight has
 *     a stable id, a `from` viewport coord, a `to` viewport coord, and
 *     an optional peak height (defaults to 120px above the midpoint).
 *   - When a flight enters the list it animates immediately.
 *   - The component fires `onFlightComplete(id)` after total ~800ms
 *     so the caller can prune the flight from state.
 *
 * Out-of-scope for T14.4 (per spec): the actual `dispatch.event` RPC
 * subscription. That wiring is downstream — this component just
 * renders the visual layer.
 */

import { useEffect, useRef, type CSSProperties, type JSX } from "react";
import "../../styles/norse-motifs.css";

// ── Types ────────────────────────────────────────────────

export interface FlightCoord {
  /** Viewport pixel x. */
  readonly x: number;
  /** Viewport pixel y. */
  readonly y: number;
}

export interface RavenFlight {
  /** Stable id — used as React key and for completion callbacks. */
  readonly id: string;
  /** Source position (typically the "send from" surface). */
  readonly from: FlightCoord;
  /** Destination position (typically the "land at" surface). */
  readonly to: FlightCoord;
  /** Optional peak Y (in viewport pixels). Defaults to midpoint - 120. */
  readonly peakY?: number;
  /** Optional override for the bird tint colour. */
  readonly color?: string;
}

export interface RavensFlightAnimationProps {
  /** Currently active flights. Mount + un-mount triggers the animation. */
  readonly flights: readonly RavenFlight[];
  /** Called ~800ms after a flight first appears so the parent can prune. */
  readonly onFlightComplete?: (id: string) => void;
}

// ── Constants ────────────────────────────────────────────

const TOTAL_DURATION_MS = 800;
const DEFAULT_PEAK_LIFT = 120;

// ── Subcomponent: a single raven ──────────────────────────

function FlightingRaven({
  flight,
  onComplete,
}: {
  readonly flight: RavenFlight;
  readonly onComplete?: (id: string) => void;
}): JSX.Element {
  // Schedule the completion callback exactly once after the total
  // animation duration. Using a ref + effect pattern keeps the timer
  // idempotent across React Strict Mode double-mounts.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (!onComplete) return;
    const timer = window.setTimeout(() => onComplete(flight.id), TOTAL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [flight.id, onComplete]);

  const peakY =
    flight.peakY ?? Math.min(flight.from.y, flight.to.y) - DEFAULT_PEAK_LIFT;

  // The keyframes consume four CSS variables for the geometry. We
  // pin the container at (0, 0) and let the bird animate via
  // translate() so the arc keyframe can interpolate cleanly.
  const containerStyle: CSSProperties = {
    left: 0,
    top: 0,
    // CSS custom properties consumed by `wotann-norse-flight-*` keyframes.
    // Cast through a Record so TS accepts the unknown css var names.
    ...({
      "--norse-flight-from-x": `${flight.from.x}px`,
      "--norse-flight-from-y": `${flight.from.y}px`,
      "--norse-flight-to-x": `${flight.to.x}px`,
      "--norse-flight-to-y": `${flight.to.y}px`,
      "--norse-flight-peak-y": `${peakY}px`,
    } as Record<string, string>),
  };

  const birdStyle: CSSProperties = flight.color
    ? { color: flight.color }
    : {};

  return (
    <div
      className="ravens-flight"
      style={containerStyle}
      aria-hidden="true"
      data-flight-id={flight.id}
    >
      <svg
        className="ravens-flight__bird"
        style={birdStyle}
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        {/* Stylised raven mid-flight with wings spread. */}
        <path d="M2.5 13 c1.6-2.6 4.3-3.6 6.7-2.8 c1.2 0.4 2.1 1.1 2.8 1.9 l3.6-3.6 l-0.6 3.4 l3.6 0.4 l-3.0 1.8 c0.4 1.2 0.4 2.4-0.1 3.5 c-0.9 2.0-3.0 2.9-5.2 2.7 c-2.0-0.2-3.7-1.3-4.6-2.6 l-2.1 0.7 l0.6-2.0 c-0.6-0.5-1.0-1.4-1.7-3.4 z" />
      </svg>
    </div>
  );
}

// ── Component ────────────────────────────────────────────

export function RavensFlightAnimation({
  flights,
  onFlightComplete,
}: RavensFlightAnimationProps): JSX.Element {
  return (
    <>
      {flights.map((flight) => (
        <FlightingRaven
          key={flight.id}
          flight={flight}
          onComplete={onFlightComplete}
        />
      ))}
    </>
  );
}
