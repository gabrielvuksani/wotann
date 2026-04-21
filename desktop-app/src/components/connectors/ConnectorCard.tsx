/**
 * ConnectorCard — left-pane card showing connector status and configure action.
 * Obsidian Precision styling: token-backed surfaces, accent border, 12px radius.
 */

import type { ConnectorInfo } from "../../hooks/useTauriCommand";

export interface ConnectorCardProps {
  readonly connector: ConnectorInfo;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

export function ConnectorCard({ connector, selected, onSelect }: ConnectorCardProps) {
  const connected = connector.connected;
  const badgeColor = connected ? "var(--color-success)" : "var(--color-text-muted)";
  const badgeBg = connected
    ? "rgba(48, 209, 88, 0.12)"
    : "rgba(142, 142, 147, 0.12)";
  const borderColor = selected ? "var(--color-primary)" : "var(--border-subtle)";
  const background = selected ? "rgba(10, 132, 255, 0.08)" : "var(--surface-2)";

  return (
    <button
      type="button"
      onClick={() => onSelect(connector.id)}
      aria-pressed={selected}
      aria-label={`Configure ${connector.name}`}
      className="w-full text-left rounded-xl border p-3 transition-colors"
      style={{
        background,
        borderColor,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0" aria-hidden="true">
            {connector.icon || "\uD83D\uDD17"}
          </span>
          <div className="min-w-0">
            <h4
              className="text-sm font-medium truncate"
              style={{ color: "var(--color-text-primary)" }}
            >
              {connector.name}
            </h4>
            {connector.documentsCount > 0 && (
              <p
                className="text-xs mt-0.5"
                style={{ color: "var(--color-text-muted)" }}
              >
                {connector.documentsCount} docs
              </p>
            )}
          </div>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
          style={{
            color: badgeColor,
            background: badgeBg,
          }}
        >
          {connected ? "Connected" : "Not configured"}
        </span>
      </div>
      <div
        className="mt-2 text-xs font-medium"
        style={{ color: selected ? "var(--color-primary)" : "var(--color-text-muted)" }}
      >
        {selected ? "Editing\u2026" : "Configure \u2192"}
      </div>
    </button>
  );
}
