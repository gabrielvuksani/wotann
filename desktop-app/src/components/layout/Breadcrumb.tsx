/**
 * Contextual breadcrumb for the header.
 * Shows current space + context (conversation title, file name, etc.)
 *
 * Examples:
 * - Chat space: "Chat > Auth flow refactor"
 * - Editor space: "Editor > src/app.tsx"
 * - Workshop space: "Workshop"
 * - Exploit space: "Security Research > api.example.com"
 * - Settings: "Settings"
 */

import { useStore } from "../../store";

const VIEW_LABELS: Record<string, string> = {
  chat: "Chat",
  editor: "Editor",
  workshop: "Workshop",
  exploit: "Security Research",
  compare: "Compare",
  memory: "Memory",
  cost: "Cost Dashboard",
  settings: "Settings",
};

export function Breadcrumb() {
  const currentView = useStore((s) => s.currentView);
  const activeConvTitle = useStore((s) => {
    const id = s.activeConversationId;
    if (!id) return "";
    return s.conversations.find((c) => c.id === id)?.title ?? "";
  });

  const viewLabel = VIEW_LABELS[currentView] ?? "WOTANN";

  // Determine the secondary breadcrumb based on current view
  let secondary = "";
  if (currentView === "chat" && activeConvTitle) {
    secondary = activeConvTitle;
  }
  // Editor: would show active file name (from editor store when available)
  // Exploit: would show engagement target (from exploit state when available)

  return (
    <div className="flex items-center gap-1.5 min-w-0" aria-label="Breadcrumb navigation">
      <span
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          flexShrink: 0,
        }}
      >
        {viewLabel}
      </span>
      {secondary && (
        <>
          <span style={{ color: "var(--color-text-ghost)", fontSize: "var(--font-size-sm)" }}>›</span>
          <span
            className="truncate"
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-muted)",
              maxWidth: 200,
            }}
          >
            {secondary}
          </span>
        </>
      )}
    </div>
  );
}
