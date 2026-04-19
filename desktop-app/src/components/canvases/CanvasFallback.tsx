/**
 * Canvas fallbacks — honest empty states for:
 *   1. Unknown canvas type (registry lookup missed)
 *   2. Invalid payload (canvas received malformed data)
 *   3. Loading (while the lazy component is still fetching)
 *
 * All fallbacks read from WOTANN design tokens — no hardcoded hex.
 */

import type { ReactNode } from "react";
import type { CanvasProps } from "../../lib/canvas-registry";

/** Thin shell around EmptyState-style chrome with canvas semantics. */
function CanvasMessage({
  title,
  message,
  variant = "info",
  children,
}: {
  readonly title: string;
  readonly message: string;
  readonly variant?: "info" | "warn" | "error";
  readonly children?: ReactNode;
}) {
  const color =
    variant === "error"
      ? "var(--color-error)"
      : variant === "warn"
        ? "var(--color-warning)"
        : "var(--color-text-muted)";

  return (
    <div
      className="liquid-glass"
      data-glass-tier="subtle"
      style={{
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md, 10px)",
        margin: "var(--space-sm) 0",
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 9999,
            background: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          lineHeight: 1.5,
        }}
      >
        {message}
      </div>
      {children ? (
        <div style={{ marginTop: "var(--space-sm)" }}>{children}</div>
      ) : null}
    </div>
  );
}

/**
 * Default fallback used when the registry has no entry for the
 * requested canvas type. Renders a raw JSON viewer so the agent's
 * output is never lost, just un-styled.
 */
export function UnknownCanvas({
  data,
  type,
}: {
  readonly data: unknown;
  readonly type: string;
}) {
  const pretty = formatJson(data);
  return (
    <CanvasMessage
      title={`Unknown canvas: ${type}`}
      message="No renderer registered for this canvas type. Showing raw payload for debugging."
      variant="warn"
    >
      <pre
        style={{
          margin: 0,
          padding: "var(--space-sm)",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-sm, 6px)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-secondary)",
          overflow: "auto",
          maxHeight: 240,
          border: "1px solid var(--border-subtle)",
        }}
      >
        {pretty}
      </pre>
    </CanvasMessage>
  );
}

/** Rendered by a canvas when its payload is not the expected shape. */
export function InvalidPayload({
  canvasLabel,
  reason,
  data,
}: {
  readonly canvasLabel: string;
  readonly reason: string;
  readonly data: unknown;
}) {
  return (
    <CanvasMessage
      title={`${canvasLabel} — invalid payload`}
      message={reason}
      variant="error"
    >
      <pre
        style={{
          margin: 0,
          padding: "var(--space-sm)",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-sm, 6px)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-2xs)",
          color: "var(--color-text-muted)",
          overflow: "auto",
          maxHeight: 180,
          border: "1px solid var(--border-subtle)",
        }}
      >
        {formatJson(data)}
      </pre>
    </CanvasMessage>
  );
}

/** Suspense fallback while a lazy canvas loads. */
export function CanvasLoading({ label }: { readonly label?: string }) {
  return (
    <CanvasMessage
      title={label ? `Loading ${label}…` : "Loading canvas…"}
      message="Fetching interactive component."
    />
  );
}

/** Generic empty-state for canvases whose data is valid but empty. */
export function EmptyPayload({
  canvasLabel,
  hint,
}: {
  readonly canvasLabel: string;
  readonly hint: string;
}) {
  return (
    <CanvasMessage title={`${canvasLabel} — nothing to show`} message={hint} />
  );
}

/**
 * Props helper — narrows `CanvasProps.data` to an object shape with
 * a type guard. Canvases use this as their first line of defense.
 */
export function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Re-export so consumers don't need a second import. */
export type { CanvasProps };

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
