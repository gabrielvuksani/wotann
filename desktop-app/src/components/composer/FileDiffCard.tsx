/**
 * FileDiffCard — collapsible card per file.
 * Shows filename + diff stats (+N -M), expand toggles inline MultiFileDiff.
 * Per-card "Accept all hunks" and "Reject all" buttons.
 */

import { useMemo, useState } from "react";
import type { FileEdit, Hunk } from "../../types";
import { MultiFileDiff } from "./MultiFileDiff";

interface FileDiffCardProps {
  readonly edit: FileEdit;
  readonly onHunksChange: (path: string, hunks: readonly Hunk[]) => void;
}

const COLOR_ADD = "#30D158";
const COLOR_REMOVE = "#FF453A";
const COLOR_BLUE = "#0A84FF";
const CARD_BG = "#1C1C1E";

export function FileDiffCard({ edit, onHunksChange }: FileDiffCardProps) {
  const [expanded, setExpanded] = useState(true);

  const { additions, deletions } = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const h of edit.hunks) {
      adds += h.newLines.length;
      dels += h.oldLines.length;
    }
    return { additions: adds, deletions: dels };
  }, [edit.hunks]);

  const acceptedCount = useMemo(
    () => edit.hunks.filter((h) => h.accepted === true).length,
    [edit.hunks],
  );

  const handleToggleHunk = (hunkId: string, accepted: boolean): void => {
    const next = edit.hunks.map((h) =>
      h.id === hunkId ? { ...h, accepted } : h,
    );
    onHunksChange(edit.path, next);
  };

  const handleAcceptAll = (): void => {
    const next = edit.hunks.map((h) => ({ ...h, accepted: true }));
    onHunksChange(edit.path, next);
  };

  const handleRejectAll = (): void => {
    const next = edit.hunks.map((h) => ({ ...h, accepted: false }));
    onHunksChange(edit.path, next);
  };

  const basename = edit.path.split("/").pop() ?? edit.path;
  const dirname = edit.path.slice(0, edit.path.length - basename.length);

  return (
    <div
      style={{
        background: CARD_BG,
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
        marginBottom: "10px",
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "10px 14px",
          background: "rgba(255,255,255,0.02)",
          borderBottom: expanded ? "1px solid rgba(255,255,255,0.06)" : "none",
        }}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse file" : "Expand file"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "10px",
              width: "12px",
              textAlign: "center",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}
          >
            ▶
          </span>
          <div style={{ textAlign: "left", minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#FFFFFF",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {basename}
            </div>
            {dirname.length > 0 && (
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {dirname}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
            <span
              style={{
                fontSize: "12px",
                color: COLOR_ADD,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 500,
              }}
            >
              +{additions}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: COLOR_REMOVE,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 500,
              }}
            >
              −{deletions}
            </span>
            {acceptedCount > 0 && (
              <span
                style={{
                  fontSize: "10px",
                  color: COLOR_BLUE,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background: "rgba(10, 132, 255, 0.15)",
                }}
              >
                {acceptedCount}/{edit.hunks.length}
              </span>
            )}
          </div>
        </button>

        <div className="flex gap-1" style={{ marginLeft: "10px" }}>
          <button
            onClick={handleAcceptAll}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              background: "rgba(48, 209, 88, 0.15)",
              color: COLOR_ADD,
              transition: "background 120ms ease",
            }}
          >
            Accept all
          </button>
          <button
            onClick={handleRejectAll}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              background: "rgba(255, 69, 58, 0.15)",
              color: COLOR_REMOVE,
              transition: "background 120ms ease",
            }}
          >
            Reject all
          </button>
        </div>
      </div>

      {/* Expanded diff body */}
      {expanded && (
        <MultiFileDiff hunks={edit.hunks} onToggleHunk={handleToggleHunk} />
      )}
    </div>
  );
}
