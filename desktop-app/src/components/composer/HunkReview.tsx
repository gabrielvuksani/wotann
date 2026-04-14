/**
 * HunkReview — single hunk with accept/reject buttons + inline diff lines.
 * Red bg for removed (`-`) lines, green bg for added (`+`) lines.
 * Monospace 15pt, Cursor-Composer styling.
 */

import type { Hunk } from "../../types";

interface HunkReviewProps {
  readonly hunk: Hunk;
  readonly onToggle: (hunkId: string, accepted: boolean) => void;
}

const COLOR_ADD = "#30D158";
const COLOR_REMOVE = "#FF453A";
const COLOR_BLUE = "#0A84FF";
const BG_ADD = "rgba(48, 209, 88, 0.12)";
const BG_REMOVE = "rgba(255, 69, 58, 0.12)";
const BORDER_ADD = "rgba(48, 209, 88, 0.45)";
const BORDER_REMOVE = "rgba(255, 69, 58, 0.45)";

export function HunkReview({ hunk, onToggle }: HunkReviewProps) {
  const accepted = hunk.accepted === true;
  const rejected = hunk.accepted === false;

  return (
    <div
      className="group"
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        opacity: rejected ? 0.5 : 1,
      }}
    >
      {/* Hunk header: line marker + tiny buttons */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: "rgba(255,255,255,0.03)" }}
      >
        <span
          style={{
            fontSize: "11px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          @@ line {hunk.startLine} @@
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => onToggle(hunk.id, true)}
            aria-label="Accept hunk"
            aria-pressed={accepted}
            style={{
              padding: "2px 8px",
              fontSize: "10px",
              fontWeight: 600,
              borderRadius: "4px",
              border: "none",
              cursor: "pointer",
              background: accepted ? COLOR_ADD : BG_ADD,
              color: accepted ? "#000" : COLOR_ADD,
              transition: "all 120ms ease",
            }}
          >
            Accept
          </button>
          <button
            onClick={() => onToggle(hunk.id, false)}
            aria-label="Reject hunk"
            aria-pressed={rejected}
            style={{
              padding: "2px 8px",
              fontSize: "10px",
              fontWeight: 600,
              borderRadius: "4px",
              border: "none",
              cursor: "pointer",
              background: rejected ? COLOR_REMOVE : BG_REMOVE,
              color: rejected ? "#000" : COLOR_REMOVE,
              transition: "all 120ms ease",
            }}
          >
            Reject
          </button>
        </div>
      </div>

      {/* Diff lines */}
      <div
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "15px",
          lineHeight: 1.5,
        }}
      >
        {hunk.oldLines.map((line, i) => (
          <div
            key={`old-${i}`}
            style={{
              padding: "1px 12px 1px 8px",
              background: BG_REMOVE,
              borderLeft: `2px solid ${BORDER_REMOVE}`,
              color: COLOR_REMOVE,
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          >
            <span style={{ display: "inline-block", width: "16px", opacity: 0.6 }}>-</span>
            {line}
          </div>
        ))}
        {hunk.newLines.map((line, i) => (
          <div
            key={`new-${i}`}
            style={{
              padding: "1px 12px 1px 8px",
              background: BG_ADD,
              borderLeft: `2px solid ${BORDER_ADD}`,
              color: COLOR_ADD,
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          >
            <span style={{ display: "inline-block", width: "16px", opacity: 0.6 }}>+</span>
            {line}
          </div>
        ))}
      </div>

      {/* Status indicator */}
      {(accepted || rejected) && (
        <div
          className="flex items-center gap-1 px-3 py-1"
          style={{
            fontSize: "10px",
            color: accepted ? COLOR_ADD : COLOR_REMOVE,
            fontWeight: 500,
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <span style={{ color: COLOR_BLUE }}>●</span>
          {accepted ? "Accepted" : "Rejected"}
        </div>
      )}
    </div>
  );
}
