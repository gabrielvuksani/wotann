/**
 * BrowsePanel — V9 Tier 10 T10.3 mount wrapper.
 *
 * Audit-identified gap (2026-04-24): `BrowseTab.tsx` (738 LOC,
 * 27 unit tests) had ZERO non-test consumers in desktop-app/src/.
 * AppShell never registered a `case "browse"` so the 5th primary
 * tab promised by V9 was unreachable. This wrapper closes the loop:
 * AppShell now has `case "browse"` returning <BrowsePanel /> and
 * the user can navigate to the tab.
 *
 * Design: the inner BrowseTab is presentation-only; it accepts a
 * session + pendingApprovals + four callbacks. This wrapper is the
 * data-layer boundary. For the initial mount we provide empty
 * defaults — the daemon RPC subscription (browse.task / browse.events
 * SSE) is a follow-up wire so this commit doesn't tangle two changes.
 *
 * QB #6 honest stub: when the user submits a task without a connected
 * daemon, we surface a clear "no agentic browser session — connect
 * the daemon first" message rather than silently swallowing.
 *
 * QB #7 per-mount state: every render is a fresh closure. No module-
 * global state.
 */

import { useState, useCallback, type JSX } from "react";
import { BrowseTab } from "./BrowseTab.js";

/**
 * Standalone wrapper. Renders the BrowseTab in its empty-state shape
 * by default. Future commits will swap the local stubs for real
 * daemon RPC subscriptions.
 */
export function BrowsePanel(): JSX.Element {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const onApprove = useCallback((id: string) => {
    setStatusMessage(`approval ${id} — not yet wired to daemon`);
  }, []);
  const onDeny = useCallback((id: string) => {
    setStatusMessage(`denial ${id} — not yet wired to daemon`);
  }, []);
  const onTaskSubmit = useCallback((task: string) => {
    setStatusMessage(
      `task accepted (offline preview): "${task.slice(0, 80)}". ` +
        "Connect the WOTANN daemon to dispatch a real agentic browse session.",
    );
  }, []);
  const onAbort = useCallback(() => {
    setStatusMessage("abort acknowledged — no active session to halt");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {statusMessage !== null && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "8px 14px",
            background: "rgba(255, 200, 80, 0.08)",
            color: "var(--w-text, #e6e6ea)",
            fontSize: 12,
            borderBottom: "1px solid rgba(255, 200, 80, 0.15)",
          }}
        >
          {statusMessage}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <BrowseTab
          session={null}
          pendingApprovals={[]}
          onApprove={onApprove}
          onDeny={onDeny}
          onTaskSubmit={onTaskSubmit}
          onAbort={onAbort}
        />
      </div>
    </div>
  );
}
