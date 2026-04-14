/**
 * MultiFileDiff — renders a single file's hunks as unified diff.
 * Wraps each hunk in HunkReview for per-hunk accept/reject controls.
 */

import type { Hunk } from "../../types";
import { HunkReview } from "./HunkReview";

interface MultiFileDiffProps {
  readonly hunks: readonly Hunk[];
  readonly onToggleHunk: (hunkId: string, accepted: boolean) => void;
}

export function MultiFileDiff({ hunks, onToggleHunk }: MultiFileDiffProps) {
  if (hunks.length === 0) {
    return (
      <div
        style={{
          padding: "16px",
          fontSize: "12px",
          color: "rgba(255,255,255,0.45)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        No changes in this file.
      </div>
    );
  }

  return (
    <div style={{ background: "#000000" }}>
      {hunks.map((hunk) => (
        <HunkReview key={hunk.id} hunk={hunk} onToggle={onToggleHunk} />
      ))}
    </div>
  );
}
