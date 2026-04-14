/**
 * Design Mode Panel -- full split-view layout for visual editing.
 *
 * Layout:
 *   Top row: Monaco editor (50%) | BrowserPreview (50%)
 *   Bottom: VisualInspector (selected element) + StyleEditor (change preview)
 *
 * Toggled from the editor toolbar via the "Design" button.
 * Uses CSS variables from the design system throughout.
 */

import { useState, useCallback } from "react";
import { BrowserPreview } from "./BrowserPreview";
import { VisualInspector } from "./VisualInspector";
import { StyleEditor } from "./StyleEditor";

type ViewMode = "code" | "design";

interface SelectedElement {
  readonly tag: string;
  readonly className: string;
  readonly text: string;
  readonly styles: {
    readonly color: string;
    readonly backgroundColor: string;
    readonly padding: string;
    readonly margin: string;
    readonly fontSize: string;
    readonly fontWeight: string;
    readonly borderRadius: string;
    readonly opacity: string;
  };
}

interface DesignModePanelProps {
  /** Dev server URL for the browser preview */
  readonly previewUrl?: string;
  /** Callback when "Apply Changes" is clicked with pending style changes */
  readonly onApplyChanges?: (styles: ReadonlyArray<{ property: string; value: string }>) => void;
  /** Callback to exit design mode */
  readonly onClose: () => void;
}

export function DesignModePanel({
  previewUrl = "http://localhost:3000",
  onApplyChanges,
  onClose,
}: DesignModePanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("design");
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [pendingChanges, setPendingChanges] = useState<ReadonlyArray<{ property: string; value: string }>>([]);

  const handleElementSelect = useCallback(
    (info: { tag: string; className: string; text: string; rect: DOMRect }) => {
      setSelectedElement({
        tag: info.tag,
        className: info.className,
        text: info.text,
        styles: {
          color: "",
          backgroundColor: "",
          padding: "",
          margin: "",
          fontSize: "",
          fontWeight: "",
          borderRadius: "",
          opacity: "",
        },
      });
      // Clear pending changes when selecting a new element
      setPendingChanges([]);
    },
    [],
  );

  const handleStyleChange = useCallback((property: string, value: string) => {
    setPendingChanges((prev) => {
      const existing = prev.filter((c) => c.property !== property);
      return [...existing, { property, value }];
    });
  }, []);

  const handleApply = useCallback(
    (changes: ReadonlyArray<{ property: string; value: string }>) => {
      onApplyChanges?.(changes);
      setPendingChanges([]);
    },
    [onApplyChanges],
  );

  const handleReset = useCallback(() => {
    setPendingChanges([]);
  }, []);

  const handleInspectorClose = useCallback(() => {
    setSelectedElement(null);
    onClose();
  }, [onClose]);

  // Build a flat record of current styles for the StyleEditor
  const currentStyleRecord: Record<string, string> = selectedElement
    ? { ...selectedElement.styles }
    : {};

  return (
    <div
      className="flex flex-col"
      style={{
        height: 380,
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--color-bg-primary)",
      }}
      role="region"
      aria-label="Design mode panel"
    >
      {/* Header with mode toggle and close */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          height: 36,
          padding: "0 12px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
        }}
      >
        {/* Mode toggle: Code | Design */}
        <div
          className="flex items-center"
          style={{
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            padding: 2,
          }}
          role="tablist"
          aria-label="View mode"
        >
          <button
            role="tab"
            aria-selected={viewMode === "code"}
            aria-label="Switch to code view"
            onClick={() => setViewMode("code")}
            style={{
              padding: "3px 12px",
              fontSize: "var(--font-size-2xs)",
              fontWeight: viewMode === "code" ? 600 : 400,
              color: viewMode === "code" ? "var(--color-text-primary)" : "var(--color-text-muted)",
              background: viewMode === "code" ? "var(--surface-1)" : "transparent",
              borderRadius: "var(--radius-xs)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Code
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "design"}
            aria-label="Switch to design view"
            onClick={() => setViewMode("design")}
            style={{
              padding: "3px 12px",
              fontSize: "var(--font-size-2xs)",
              fontWeight: viewMode === "design" ? 600 : 400,
              color: viewMode === "design" ? "var(--color-text-primary)" : "var(--color-text-muted)",
              background: viewMode === "design" ? "var(--surface-1)" : "transparent",
              borderRadius: "var(--radius-xs)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Design
          </button>
        </div>

        {/* Right side: pending count + close */}
        <div className="flex items-center gap-2">
          {pendingChanges.length > 0 && (
            <span
              style={{
                fontSize: "var(--font-size-2xs)",
                color: "var(--color-text-dim)",
              }}
            >
              {pendingChanges.length} change{pendingChanges.length !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={onClose}
            className="header-icon-btn"
            aria-label="Close design mode"
            style={{ width: 22, height: 22 }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {viewMode === "design" ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Top row: Monaco (50%) | BrowserPreview (50%) */}
            <div className="flex flex-1 min-h-0">
              {/* Left: Monaco editor placeholder (the actual Monaco is in the parent EditorPanel) */}
              <div
                className="flex items-center justify-center"
                style={{
                  width: "50%",
                  borderRight: "1px solid var(--border-subtle)",
                  background: "var(--color-bg-primary)",
                }}
              >
                <div style={{ textAlign: "center", padding: 16 }}>
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ marginBottom: 8, opacity: 0.4, display: "inline-block", color: "var(--color-text-dim)" }}
                  >
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                    Live editor synced above
                  </p>
                  <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", marginTop: 2 }}>
                    Changes reflect in preview instantly
                  </p>
                </div>
              </div>

              {/* Right: BrowserPreview (50%) */}
              <div style={{ width: "50%" }} className="min-w-0">
                <BrowserPreview
                  url={previewUrl}
                  onElementSelect={handleElementSelect}
                />
              </div>
            </div>

            {/* Bottom: Inspector + StyleEditor */}
            {selectedElement && (
              <div
                className="flex shrink-0"
                style={{
                  height: 160,
                  borderTop: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                {/* VisualInspector -- element properties */}
                <div
                  className="overflow-y-auto"
                  style={{
                    width: "50%",
                    borderRight: "1px solid var(--border-subtle)",
                  }}
                >
                  <VisualInspector
                    element={selectedElement}
                    onStyleChange={handleStyleChange}
                    onClose={handleInspectorClose}
                  />
                </div>

                {/* StyleEditor -- change preview with token suggestions */}
                <div
                  className="overflow-y-auto"
                  style={{ width: "50%" }}
                >
                  <StyleEditor
                    changes={pendingChanges}
                    currentStyles={currentStyleRecord}
                    onApply={handleApply}
                    onReset={handleReset}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Code view -- directs user back to the main editor */
          <div
            className="flex-1 flex items-center justify-center"
            style={{ color: "var(--color-text-muted)" }}
          >
            <div style={{ textAlign: "center" }}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginBottom: 12, opacity: 0.4, display: "inline-block" }}
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
                Code view is active
              </p>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)", marginTop: 4 }}>
                Edit in the main editor above. Switch to Design to preview live.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
