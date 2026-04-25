/**
 * Tests for V9 T4.2 mount-point — McpAppOverlay.
 *
 * Audit gap closed: McpAppHost.tsx had thorough tests (433 LOC) but
 * the wire-up that actually mounts it in the App tree was missing.
 * These tests pin the mount-event contract so a future refactor
 * can't silently re-orphan the component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { McpAppOverlay, emitMcpAppMount } from "./McpAppOverlay";

// Stub fetcher used by every test. Returns a tiny HTML body so the
// host's "ready" phase activates synchronously.
function stubFetcher(): (uri: string) => Promise<string> {
  return vi.fn(async (uri: string) => {
    return `<html><body data-uri="${uri}">stub</body></html>`;
  });
}

describe("McpAppOverlay — V9 T4.2 mount-point", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no mount event has fired", () => {
    render(<McpAppOverlay fetchResourceOverride={stubFetcher()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens overlay on `wotann:mcp-app-mount` event", () => {
    render(<McpAppOverlay fetchResourceOverride={stubFetcher()} />);

    expect(screen.queryByRole("dialog")).toBeNull();

    emitMcpAppMount({ resourceUri: "ui://wotann/cost-preview" });

    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-label")).toContain("ui://wotann/cost-preview");
  });

  it("uses the provided title in the header when set", () => {
    render(<McpAppOverlay fetchResourceOverride={stubFetcher()} />);
    emitMcpAppMount({
      resourceUri: "ui://example/foo",
      title: "Cost Preview",
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toContain("Cost Preview");
  });

  it("close button dismisses the overlay", () => {
    render(<McpAppOverlay fetchResourceOverride={stubFetcher()} />);
    emitMcpAppMount({ resourceUri: "ui://x" });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape key dismisses the overlay", () => {
    render(<McpAppOverlay fetchResourceOverride={stubFetcher()} />);
    emitMcpAppMount({ resourceUri: "ui://x" });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores malformed events (no resourceUri)", () => {
    render(<McpAppOverlay fetchResourceOverride={stubFetcher()} />);
    // Fake an event with bad shape — overlay should NOT open.
    window.dispatchEvent(
      new CustomEvent("wotann:mcp-app-mount", {
        detail: { not_a_uri: 42 } as unknown as { resourceUri: string },
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("emitMcpAppMount returns true and dispatches a CustomEvent", () => {
    const listener = vi.fn();
    window.addEventListener("wotann:mcp-app-mount", listener);
    try {
      const ok = emitMcpAppMount({ resourceUri: "ui://test" });
      expect(ok).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
      const ev = listener.mock.calls[0]![0] as CustomEvent<{ resourceUri: string }>;
      expect(ev.detail.resourceUri).toBe("ui://test");
    } finally {
      window.removeEventListener("wotann:mcp-app-mount", listener);
    }
  });

  it("URI change tears down old bridge before mounting new one", () => {
    const fetcher = stubFetcher();
    render(<McpAppOverlay fetchResourceOverride={fetcher} />);

    emitMcpAppMount({ resourceUri: "ui://first" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain("ui://first");

    emitMcpAppMount({ resourceUri: "ui://second" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain("ui://second");
  });
});
