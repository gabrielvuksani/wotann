/**
 * Honest-stub helper — graceful rendering of in-development daemon
 * features.
 *
 * The daemon registers placeholder handlers for features whose UI ships
 * before the implementation does (agentless / build / deploy / offload /
 * recipe / sop). Those handlers return a structured envelope:
 *
 *   { error: "not_implemented", feature, status, message }
 *
 * Without this helper, panel code that does `result.providers.map(...)`
 * crashes against the envelope, and the user sees a generic React
 * boundary error. With it, each panel can detect the envelope and
 * render a quiet, on-brand "Coming soon" banner — Quality Bar #2:
 * honest stubs over silent success.
 *
 * Per CLAUDE.md the WOTANN philosophy is "automagical by default" —
 * but automagic should never become deceptive. A feature that doesn't
 * exist must say so.
 */

import type { ReactElement } from "react";

export interface NotImplementedEnvelope {
  readonly error: "not_implemented";
  readonly feature: string;
  readonly status: "planned" | "in-progress" | "alpha";
  readonly message: string;
}

/**
 * Type guard: is this RPC result a not_implemented envelope?
 */
export function isNotImplemented(
  value: unknown,
): value is NotImplementedEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj["error"] === "not_implemented" && typeof obj["feature"] === "string";
}

/**
 * Banner component for not-implemented panels. Renders a clean,
 * quiet card with the feature name + status + message instead of
 * the panel's normal output.
 *
 * Designed to drop into any panel via:
 *   if (isNotImplemented(result)) {
 *     return <NotImplementedBanner envelope={result} />;
 *   }
 *
 * Visual style intentionally matches the rest of the WOTANN dark
 * UI — single-color border, no emoji, monospace status pill.
 */
export function NotImplementedBanner({
  envelope,
  panelTitle,
}: {
  readonly envelope: NotImplementedEnvelope;
  readonly panelTitle?: string;
}): ReactElement {
  const statusColor: Record<NotImplementedEnvelope["status"], string> = {
    planned: "#5e5d63",
    "in-progress": "#7c6f46",
    alpha: "#3d6f4a",
  };
  return (
    <div
      style={{
        padding: "32px",
        margin: "24px",
        border: "1px solid #2a2a2e",
        borderRadius: "8px",
        backgroundColor: "#1c1c1f",
        color: "#d4d4d8",
        maxWidth: "640px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 500,
            color: "#f4f4f5",
          }}
        >
          {panelTitle ?? envelope.feature}
        </h3>
        <span
          style={{
            padding: "2px 10px",
            borderRadius: "10px",
            backgroundColor: statusColor[envelope.status],
            color: "#fafafa",
            fontFamily: "ui-monospace, monospace",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {envelope.status}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          lineHeight: 1.55,
          color: "#a1a1aa",
        }}
      >
        {envelope.message}
      </p>
      <p
        style={{
          marginTop: "16px",
          marginBottom: 0,
          fontSize: "12px",
          color: "#71717a",
        }}
      >
        The daemon handler is registered as a stub so this panel doesn't
        silently dead-letter; full implementation is tracked in the
        master plan.
      </p>
    </div>
  );
}
