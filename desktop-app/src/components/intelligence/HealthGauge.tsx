/**
 * Reusable SVG circular gauge for health/score display.
 *
 * Renders a ring with stroke-dasharray progress, color-coded by score:
 *   - Red (--color-error) for < 40
 *   - Warning (--color-warning) for 40-70
 *   - Green (--color-success) for > 70
 */

import { useMemo } from "react";

// ── Types ─────────────────────────────────────────────

interface HealthGaugeProps {
  readonly score: number;
  readonly size?: number;
  readonly label?: string;
}

// ── Color logic ───────────────────────────────────────

function scoreColor(score: number): string {
  if (score < 40) return "var(--color-error)";
  if (score <= 70) return "var(--color-warning)";
  return "var(--color-success)";
}

// ── Component ─────────────────────────────────────────

export function HealthGauge({ score, size = 120, label }: HealthGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const strokeWidth = size * 0.08;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const color = scoreColor(clampedScore);

  const dashOffset = useMemo(
    () => circumference - (clampedScore / 100) * circumference,
    [circumference, clampedScore],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-xs)",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-label={`Health score: ${clampedScore} out of 100`}
        role="img"
      >
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={strokeWidth}
        />

        {/* Progress ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "center",
            transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease",
          }}
        />

        {/* Score number */}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: size * 0.28,
            fontWeight: 700,
            fill: color,
            fontFamily: "var(--font-mono)",
          }}
        >
          {clampedScore}
        </text>
      </svg>

      {label && (
        <span
          style={{
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-muted)",
            textAlign: "center",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
