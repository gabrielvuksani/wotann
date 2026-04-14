/**
 * Visual Inspector — sidebar panel for editing element styles.
 * Part of Design Mode (Cursor 3 parity).
 *
 * Shows computed styles for the selected element. Editable fields for:
 * color, padding/margin, font size/weight, border-radius, opacity.
 * Changes write back to source file via the editor.
 */

import { useState, useCallback } from "react";

interface ElementInfo {
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

interface VisualInspectorProps {
  readonly element: ElementInfo | null;
  readonly onStyleChange?: (property: string, value: string) => void;
  readonly onClose: () => void;
}

function StyleRow({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
      <label style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", width: 80 }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-glow"
        style={{
          width: 100,
          height: 24,
          padding: "0 8px",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-primary)",
          background: "var(--bg-surface)",
          boxShadow: "var(--shadow-ring)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          outline: "none",
          fontFamily: "var(--font-mono)",
        }}
      />
    </div>
  );
}

export function VisualInspector({ element, onStyleChange, onClose }: VisualInspectorProps) {
  const [localStyles, setLocalStyles] = useState(element?.styles ?? {
    color: "",
    backgroundColor: "",
    padding: "",
    margin: "",
    fontSize: "",
    fontWeight: "",
    borderRadius: "",
    opacity: "",
  });

  const handleChange = useCallback(
    (prop: string, value: string) => {
      setLocalStyles((prev) => ({ ...prev, [prop]: value }));
      onStyleChange?.(prop, value);
    },
    [onStyleChange],
  );

  if (!element) {
    return (
      <div style={{ padding: 16 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>Inspector</h3>
          <button onClick={onClose} className="header-icon-btn" style={{ width: 20, height: 20 }} aria-label="Close inspector">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textAlign: "center" }}>
          Click an element in the preview to inspect it
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>Inspector</h3>
        <button onClick={onClose} className="header-icon-btn" style={{ width: 20, height: 20 }} aria-label="Close inspector">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Element info */}
      <div
        style={{
          padding: 8,
          marginBottom: 16,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-surface)",
          boxShadow: "var(--shadow-ring)",
          border: "none",
        }}
      >
        <span style={{ fontSize: "var(--font-size-xs)", fontFamily: "var(--font-mono)", color: "var(--blue)" }}>
          &lt;{element.tag}&gt;
        </span>
        {element.className && (
          <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)", marginLeft: 4 }}>
            .{element.className.split(" ")[0]}
          </span>
        )}
        {element.text && (
          <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            "{element.text.slice(0, 40)}"
          </p>
        )}
      </div>

      {/* Style editors */}
      <h4 style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: "var(--color-text-dim)", marginBottom: 8 }}>
        Layout
      </h4>
      <StyleRow label="Padding" value={localStyles.padding} onChange={(v) => handleChange("padding", v)} />
      <StyleRow label="Margin" value={localStyles.margin} onChange={(v) => handleChange("margin", v)} />
      <StyleRow label="Radius" value={localStyles.borderRadius} onChange={(v) => handleChange("borderRadius", v)} />

      <h4 style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: "var(--color-text-dim)", marginBottom: 8, marginTop: 16 }}>
        Typography
      </h4>
      <StyleRow label="Color" value={localStyles.color} onChange={(v) => handleChange("color", v)} />
      <StyleRow label="Size" value={localStyles.fontSize} onChange={(v) => handleChange("fontSize", v)} />
      <StyleRow label="Weight" value={localStyles.fontWeight} onChange={(v) => handleChange("fontWeight", v)} />

      <h4 style={{ fontSize: "var(--font-size-2xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: "var(--color-text-dim)", marginBottom: 8, marginTop: 16 }}>
        Appearance
      </h4>
      <StyleRow label="Background" value={localStyles.backgroundColor} onChange={(v) => handleChange("backgroundColor", v)} />
      <StyleRow label="Opacity" value={localStyles.opacity} onChange={(v) => handleChange("opacity", v)} />

      {/* Action buttons */}
      <div className="flex gap-2" style={{ marginTop: 16 }}>
        <button
          className="btn-press flex-1"
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent)",
            color: "white",
            border: "none",
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          className="btn-press flex-1"
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            color: "var(--color-text-secondary)",
            boxShadow: "var(--shadow-ring)",
            border: "none",
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
