/**
 * CursorTrailOverlay — V9 T5.2 desktop UI mount.
 *
 * Renders a 30fps cursor trail layer for cross-surface synergy. The
 * upstream `CursorStream` (`src/session/cursor-stream.ts`) coalesces
 * raw move events at 33ms (~30fps) and broadcasts UnifiedEvents of
 * type "cursor" via the F11 dispatch plane. This component
 * subscribes to those events over SSE (`/events/computer-session`
 * with the cursor variant) and renders a fading trail of the most
 * recent N positions plus a primary cursor dot.
 *
 * DESIGN NOTES
 * - Pure presentation: every input is a prop. The component owns no
 *   network state; either the parent supplies events directly via
 *   the `samples` prop, OR it supplies a `sessionId` + `baseUrl` and
 *   the overlay opens its own EventSource. This keeps the surface
 *   testable without a daemon.
 * - SVG over canvas: SVG matches React's declarative model and the
 *   trail rarely exceeds 60 nodes (2s × 30fps × decay window). A
 *   canvas would only beat SVG above ~500 nodes/frame.
 * - 30fps cap: the upstream `CursorStream` already coalesces. We
 *   add a render throttle here too so a reconnect storm or a
 *   misconfigured server can't drag the renderer below 30fps.
 * - Pointer-events: none. The overlay never intercepts clicks.
 * - Honest empty state: zero samples renders an invisible (but
 *   accessibility-labeled) layer instead of a cosmetic fallback.
 *   The Workshop tab decides if/when to show user-facing copy.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

// ── Types ───────────────────────────────────────────────────

/**
 * A single cursor sample for rendering. Coordinates are in screen-
 * native pixels (see `cursor-stream.ts`). The `screenId` field is
 * surfaced so multi-monitor layouts can route samples to the right
 * canvas surface — the overlay itself ignores it (one screen).
 */
export interface CursorSampleView {
  readonly x: number;
  readonly y: number;
  readonly action: "move" | "click" | "scroll";
  readonly timestamp: number;
  readonly deviceId?: string;
  readonly screenId?: string | null;
}

export interface CursorTrailOverlayProps {
  /**
   * Direct samples — used when the parent owns the subscription.
   * If supplied, the overlay does NOT open its own EventSource.
   */
  readonly samples?: readonly CursorSampleView[];
  /**
   * Optional session id. When set AND `samples` is omitted, the
   * overlay opens its own SSE connection to the daemon and filters
   * cursor events by this id.
   */
  readonly sessionId?: string;
  /** Daemon base URL — defaults to `http://localhost:7531`. */
  readonly baseUrl?: string;
  /**
   * Maximum trail length — older samples are dropped. Default 60
   * (≈2s of 30fps history). Capped at 240 to bound the SVG size.
   */
  readonly maxTrail?: number;
  /**
   * Trail decay window in ms. Samples older than this fade to
   * transparent. Default 1500ms.
   */
  readonly decayMs?: number;
  /**
   * Width / height in CSS pixels. Defaults to 100% of parent.
   */
  readonly width?: number | string;
  readonly height?: number | string;
  /**
   * Test hook — inject a clock for deterministic decay.
   */
  readonly now?: () => number;
  /**
   * Test hook — inject an EventSource factory.
   */
  readonly eventSourceFactory?: (url: string) => EventSource;
}

// ── Constants ───────────────────────────────────────────────

const DEFAULT_BASE_URL = "http://localhost:7531";
const SSE_PATH = "/events/computer-session";
const DEFAULT_MAX_TRAIL = 60;
const HARD_CAP_TRAIL = 240;
const DEFAULT_DECAY_MS = 1500;
const RENDER_FRAME_MS = 33; // 30fps

// ── Component ───────────────────────────────────────────────

export function CursorTrailOverlay(
  props: CursorTrailOverlayProps,
): ReactElement {
  const maxTrail = Math.min(
    props.maxTrail ?? DEFAULT_MAX_TRAIL,
    HARD_CAP_TRAIL,
  );
  const decayMs = props.decayMs ?? DEFAULT_DECAY_MS;
  const now = props.now ?? (() => Date.now());

  // The samples buffer is duplicated to local state so the overlay
  // can re-render at its own throttled cadence rather than every
  // time the upstream stream pulses an event.
  const [trail, setTrail] = useState<readonly CursorSampleView[]>(
    () => freezeBuffer(props.samples ?? []),
  );

  // Sync prop-driven samples into state whenever the parent owns
  // the subscription. We can't always trust referential equality
  // (parents may rebuild the array), so we hash by length+latest.
  useEffect(() => {
    if (!props.samples) return;
    const next = props.samples.slice(-maxTrail);
    setTrail(freezeBuffer(next));
  }, [props.samples, maxTrail]);

  // Self-managed SSE path — only when the parent did NOT supply
  // direct samples and a sessionId is provided.
  const selfSubscribed = !props.samples && typeof props.sessionId === "string";
  useEffect(() => {
    if (!selfSubscribed) return undefined;
    const sessionId = props.sessionId as string;
    const baseUrl = props.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl}${SSE_PATH}?sessionId=${encodeURIComponent(sessionId)}`;

    const factory =
      props.eventSourceFactory ??
      ((u: string): EventSource => {
        const ctor = (globalThis as unknown as {
          EventSource?: new (u: string) => EventSource;
        }).EventSource;
        if (!ctor) {
          throw new Error(
            "EventSource unavailable — provide eventSourceFactory in test envs",
          );
        }
        return new ctor(u);
      });

    let es: EventSource | null = null;
    try {
      es = factory(url);
    } catch {
      return undefined;
    }

    const handler = (evt: MessageEvent): void => {
      const data = evt.data;
      if (typeof data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const sample = extractCursorSample(parsed);
      if (!sample) return;
      setTrail((prev) => {
        const next = prev.length >= maxTrail
          ? [...prev.slice(prev.length - maxTrail + 1), sample]
          : [...prev, sample];
        return freezeBuffer(next);
      });
    };

    es.addEventListener("message", handler as EventListener);
    return () => {
      try {
        es?.removeEventListener("message", handler as EventListener);
      } catch {
        /* some EventSource stubs don't support removal — ignore */
      }
      try {
        es?.close();
      } catch {
        /* idempotent close */
      }
    };
  }, [
    selfSubscribed,
    props.sessionId,
    props.baseUrl,
    props.eventSourceFactory,
    maxTrail,
  ]);

  // 30fps render throttle — we ask for a re-render at most every
  // RENDER_FRAME_MS so the SVG stays smooth even if events burst.
  const [renderTick, setRenderTick] = useState<number>(0);
  const tickRef = useRef<number>(0);
  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      tickRef.current += 1;
      setRenderTick(tickRef.current);
    };
    const handle = window.setInterval(tick, RENDER_FRAME_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const visible = useMemo(() => {
    // Re-derive the visible set whenever either the trail or the
    // tick changes. The tick re-render keeps decay smooth.
    const t = now();
    void renderTick; // referenced so React doesn't tree-shake the dep
    return trail
      .map((sample) => {
        const age = Math.max(0, t - sample.timestamp);
        const alpha = age >= decayMs ? 0 : 1 - age / decayMs;
        return { sample, alpha };
      })
      .filter((entry) => entry.alpha > 0);
  }, [trail, decayMs, now, renderTick]);

  const headSample: CursorSampleView | null =
    trail.length > 0 ? (trail[trail.length - 1] ?? null) : null;

  return (
    <div
      data-testid="cursor-trail-overlay"
      aria-label="Cursor trail overlay"
      role="img"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        width: props.width ?? "100%",
        height: props.height ?? "100%",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={undefined}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-hidden
      >
        {visible.map(({ sample, alpha }, idx) => (
          <circle
            key={`${sample.timestamp}-${idx}`}
            cx={sample.x}
            cy={sample.y}
            r={sample.action === "click" ? 12 : 4}
            fill={
              sample.action === "click"
                ? "var(--color-warning, #ff9f0a)"
                : "var(--color-primary, #7b5cff)"
            }
            opacity={alpha * (sample.action === "click" ? 0.45 : 0.7)}
          />
        ))}
        {headSample !== null && (
          <circle
            cx={headSample.x}
            cy={headSample.y}
            r={6}
            fill="var(--color-primary, #7b5cff)"
            stroke="#fff"
            strokeWidth={1}
            opacity={0.95}
          />
        )}
      </svg>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function freezeBuffer(
  buffer: readonly CursorSampleView[],
): readonly CursorSampleView[] {
  return Object.freeze(buffer.slice());
}

/**
 * Pull a `CursorSampleView` out of an arbitrary SSE frame. The
 * server emits cursor events under `type: "cursor"` with payload
 * `{ x, y, action, deviceId?, screenId? }`. We tolerate both the
 * raw-payload shape and the wrapped `{ type, payload }` shape so
 * the overlay works against the legacy and the F11 unified
 * dispatch plane.
 */
function extractCursorSample(payload: unknown): CursorSampleView | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  // Shape 1: server-frame style { type: "cursor", payload: {...}, timestamp }
  if (obj["type"] === "cursor" && typeof obj["payload"] === "object" && obj["payload"] !== null) {
    const p = obj["payload"] as Record<string, unknown>;
    const sample = readCursorFields(p);
    if (sample === null) return null;
    const ts =
      typeof obj["timestamp"] === "number" ? (obj["timestamp"] as number) : Date.now();
    return { ...sample, timestamp: ts };
  }
  // Shape 2: bare cursor event { x, y, action, ... }
  return readCursorFields(obj);
}

function readCursorFields(p: Record<string, unknown>): CursorSampleView | null {
  const x = p["x"];
  const y = p["y"];
  const action = p["action"];
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  if (action !== "move" && action !== "click" && action !== "scroll") return null;
  const ts =
    typeof p["timestamp"] === "number" && Number.isFinite(p["timestamp"] as number)
      ? (p["timestamp"] as number)
      : Date.now();
  const sample: CursorSampleView = {
    x,
    y,
    action,
    timestamp: ts,
    deviceId: typeof p["deviceId"] === "string" ? (p["deviceId"] as string) : undefined,
    screenId:
      typeof p["screenId"] === "string"
        ? (p["screenId"] as string)
        : p["screenId"] === null
          ? null
          : undefined,
  };
  return sample;
}
