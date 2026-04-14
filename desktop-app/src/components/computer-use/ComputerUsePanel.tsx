/**
 * Computer Use (Desktop Control) Panel — D1.
 *
 * Composes four sub-components:
 *  - ScreenPreview: live PNG capture
 *  - MouseControl: click/move with x,y
 *  - KeyboardControl: type text + key combos
 *  - AppApprovals: grant/revoke per-app access
 *
 * Each sub-component invokes its own Tauri command directly.
 */

import { ScreenPreview } from "./ScreenPreview";
import { MouseControl } from "./MouseControl";
import { KeyboardControl } from "./KeyboardControl";
import { AppApprovals } from "./AppApprovals";

export function ComputerUsePanel() {
  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      style={{ background: "var(--color-bg-primary, #000)" }}
      role="region"
      aria-label="Computer Use control panel"
    >
      {/* Header */}
      <div
        style={{
          height: 44,
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="#0A84FF" strokeWidth="1.5" />
            <path d="M5 14h6M8 11.5v2.5" stroke="#0A84FF" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <h2
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            Desktop Control
          </h2>
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-dim)",
              marginLeft: 8,
            }}
          >
            See and control the screen
          </span>
        </div>
      </div>

      {/* Main grid — screen preview on left (wider), controls on right */}
      <div
        className="flex-1 overflow-auto"
        style={{ padding: 24 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 1fr)",
            gap: 16,
            maxWidth: 1400,
            margin: "0 auto",
          }}
        >
          {/* Left column: screen preview (sticky-ish) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ScreenPreview />
          </div>

          {/* Right column: stacked controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <MouseControl />
            <KeyboardControl />
            <AppApprovals />
          </div>
        </div>
      </div>
    </div>
  );
}
