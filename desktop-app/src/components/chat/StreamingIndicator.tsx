/**
 * Animated typing indicator shown during streaming responses.
 * Features: gentle pulsing dots, blinking cursor, token counter.
 * Uses inline CSS keyframes to avoid modifying globals.css.
 */

interface StreamingIndicatorProps {
  readonly tokensGenerated?: number;
}

/** Inline keyframes style tag — rendered once, scoped via unique animation names */
const STREAMING_KEYFRAMES = `
@keyframes streamDotPulse {
  0%, 100% { opacity: 0.3; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}
@keyframes streamCursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
`;

export function StreamingIndicator({ tokensGenerated }: StreamingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 py-1" role="status" aria-live="polite" aria-label="Generating response">
      {/* Scoped keyframes */}
      <style>{STREAMING_KEYFRAMES}</style>

      {/* Pulsing dots — staggered with gentle opacity + scale */}
      <div className="flex gap-1" aria-hidden="true">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--accent)",
            animation: "streamDotPulse 1.4s ease-in-out infinite",
            animationDelay: "0ms",
          }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--accent)",
            animation: "streamDotPulse 1.4s ease-in-out infinite",
            animationDelay: "200ms",
          }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--accent)",
            animation: "streamDotPulse 1.4s ease-in-out infinite",
            animationDelay: "400ms",
          }}
        />
      </div>

      {/* Static label */}
      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
        Generating
      </span>

      {/* Smooth blinking cursor */}
      <span
        className="w-[2px] h-3"
        style={{
          background: "var(--color-primary)",
          animation: "streamCursorBlink 1s ease-in-out infinite",
        }}
        aria-hidden="true"
      />

      {/* Token counter */}
      {tokensGenerated !== undefined && tokensGenerated > 0 && (
        <span className="text-[9px] ml-1" style={{ color: "var(--color-text-dim)" }}>
          {tokensGenerated.toLocaleString()} tok
        </span>
      )}
    </div>
  );
}
