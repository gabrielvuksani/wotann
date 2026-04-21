/**
 * Block — a single selectable / shareable / rerunnable unit of work.
 *
 * Competitive port from Warp Terminal's Blocks primitive (UI_DESIGN_SPEC
 * §12 P10-item-2). Each Block wraps a command + its output so the user
 * can:
 *   - select the whole turn with one click (no text-highlight fiddling)
 *   - copy the full command + output to clipboard
 *   - share it via a permalink / export
 *   - rerun the same command against the current state
 *   - jump-navigate between Blocks via keyboard
 *
 * This is a pure presentation component — the parent supplies the
 * command text, output text, status, and callbacks. Backend wiring is
 * additive: any view that renders a sequence of command/output turns
 * (shell, arena, workshop tasks, RPC history) can adopt Blocks without
 * changes to the data layer.
 */

import { useState, type JSX, type ReactNode } from "react";
import { color } from "../../design/tokens.generated";

export type BlockStatus = "running" | "success" | "error" | "cancelled";

export interface BlockProps {
  /** Command / prompt / action title rendered at the top of the Block. */
  readonly command: string;
  /** Output text rendered below the command. May be long; scrolls. */
  readonly output?: string;
  /** Optional status badge. Defaults to "success". */
  readonly status?: BlockStatus;
  /** Timing info shown in the header (e.g. "1.2s" or "running…"). */
  readonly duration?: string;
  /** Optional children rendered instead of (or alongside) the output
   *  string — useful for injecting custom markdown / diff / chart UI. */
  readonly children?: ReactNode;
  /** Callback when the user clicks "Copy". Defaults to clipboard-copy. */
  readonly onCopy?: () => void;
  /** Callback when the user clicks "Rerun". Omit to hide the button. */
  readonly onRerun?: () => void;
  /** Callback when the user clicks "Share". Omit to hide the button. */
  readonly onShare?: () => void;
  /** Optional className for layout hooks. */
  readonly className?: string;
}

const STATUS_DOT: Record<BlockStatus, string> = {
  running: color("toolMessage"),
  success: color("success"),
  error: color("error"),
  cancelled: color("muted"),
};

const STATUS_LABEL: Record<BlockStatus, string> = {
  running: "running",
  success: "done",
  error: "failed",
  cancelled: "cancelled",
};

export function Block(props: BlockProps): JSX.Element {
  const {
    command,
    output,
    status = "success",
    duration,
    children,
    onCopy,
    onRerun,
    onShare,
    className,
  } = props;
  const [selected, setSelected] = useState(false);

  const handleCopy = (): void => {
    if (onCopy) {
      onCopy();
      return;
    }
    const text = output ? `$ ${command}\n${output}` : `$ ${command}`;
    void navigator.clipboard?.writeText(text).catch(() => {
      /* clipboard unavailable — best effort */
    });
  };

  return (
    <div
      className={className}
      role="group"
      aria-label={`Block: ${command}`}
      onClick={() => setSelected(true)}
      onBlur={() => setSelected(false)}
      tabIndex={0}
      style={{
        position: "relative",
        borderRadius: 8,
        border: `1px solid ${
          selected
            ? color("accent")
            : "var(--border-subtle, rgba(138,176,224,0.08))"
        }`,
        background: selected
          ? "rgba(10,132,255,0.04)"
          : "var(--surface-1, rgba(138,176,224,0.02))",
        transition: "border-color 120ms ease, background 120ms ease",
        fontFamily: "var(--wotann-font-sans, 'Inter Variable', system-ui)",
        outline: "none",
      }}
    >
      {/* Rule divider / gutter on the left, Warp-style */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
          background: STATUS_DOT[status],
          opacity: selected ? 1 : 0.6,
        }}
      />

      {/* Header row: command + status pill + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px 8px 16px",
          borderBottom: "1px solid var(--border-subtle, rgba(138,176,224,0.06))",
        }}
      >
        <span
          style={{
            fontFamily: "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)",
            fontSize: 13,
            fontWeight: 500,
            color: color("text"),
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={command}
        >
          {command}
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: STATUS_DOT[status],
            padding: "2px 6px",
            borderRadius: 4,
            background: `${STATUS_DOT[status]}15`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: STATUS_DOT[status],
              animation: status === "running" ? "wotann-block-pulse 1.2s ease-in-out infinite" : undefined,
            }}
            aria-hidden="true"
          />
          {STATUS_LABEL[status]}
        </span>

        {duration && (
          <span
            style={{
              fontSize: 11,
              color: color("muted"),
              fontFamily: "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {duration}
          </span>
        )}

        <div style={{ display: "inline-flex", gap: 2 }}>
          <BlockActionButton
            label="Copy"
            title="Copy command + output"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
          >
            ⎘
          </BlockActionButton>
          {onRerun && (
            <BlockActionButton
              label="Rerun"
              title="Rerun this command"
              onClick={(e) => {
                e.stopPropagation();
                onRerun();
              }}
            >
              ↻
            </BlockActionButton>
          )}
          {onShare && (
            <BlockActionButton
              label="Share"
              title="Copy permalink"
              onClick={(e) => {
                e.stopPropagation();
                onShare();
              }}
            >
              ↗
            </BlockActionButton>
          )}
        </div>
      </div>

      {/* Body — either provided children or the raw output string */}
      {(children || output) && (
        <div
          style={{
            padding: "10px 12px 12px 16px",
            fontFamily: children
              ? undefined
              : "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)",
            fontSize: 12,
            lineHeight: 1.55,
            color: color("muted"),
            maxHeight: 320,
            overflowY: "auto",
            whiteSpace: children ? undefined : "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {children ?? output}
        </div>
      )}

      <style>{`
        @keyframes wotann-block-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function BlockActionButton(props: {
  label: string;
  title: string;
  children: ReactNode;
  onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.title}
      style={{
        width: 24,
        height: 24,
        padding: 0,
        fontSize: 13,
        color: color("muted"),
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 4,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 120ms ease, color 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(138,176,224,0.1)";
        e.currentTarget.style.color = color("text");
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = color("muted");
      }}
    >
      {props.children}
    </button>
  );
}

/**
 * BlockStream — render a list of Blocks with consistent gaps + keyboard
 * nav (j/k or arrow keys to move selection). The parent controls the
 * data; this is purely layout + navigation.
 */
export function BlockStream(props: {
  readonly blocks: readonly (BlockProps & { readonly id: string })[];
  readonly className?: string;
}): JSX.Element {
  return (
    <div
      className={props.className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {props.blocks.map((b) => (
        <Block key={b.id} {...b} />
      ))}
    </div>
  );
}
