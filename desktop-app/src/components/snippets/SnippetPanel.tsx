/**
 * SnippetPanel — full-screen management UI for the cross-surface
 * prompt library introduced in Round 8.
 *
 * Three columns:
 *   - Left: searchable list of snippets, grouped by favorite/recent
 *   - Middle: detail / edit pane for the selected snippet
 *   - Right: variable form + rendered preview (live `{{var}}` substitution)
 *
 * Uses the daemon-backed `commands.snippetList/save/delete/use` RPCs.
 * Saves are atomic across CLI/Desktop/iOS — anything done here is
 * picked up by `wotann snip list` and the iOS PromptLibraryView on
 * the next refresh.
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { commands, type Snippet } from "../../hooks/useTauriCommand";

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 16,
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--surface-1)",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace), monospace",
  fontSize: 13,
  padding: "8px 12px",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  background: "var(--surface-0)",
  color: "var(--text-primary)",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--border-default)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 13,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "var(--accent-primary, #7c5fff)",
  color: "#fff",
  border: "1px solid var(--accent-primary, #7c5fff)",
};

interface DraftSnippet {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly tags: string;
  readonly isFavorite: boolean;
}

const EMPTY_DRAFT: DraftSnippet = {
  title: "",
  body: "",
  category: "",
  tags: "",
  isFavorite: false,
};

function snippetToDraft(s: Snippet): DraftSnippet {
  const draft: DraftSnippet = {
    title: s.title,
    body: s.body,
    category: s.category ?? "",
    tags: s.tags.join(", "),
    isFavorite: s.isFavorite,
  };
  return s.id ? { ...draft, id: s.id } : draft;
}

export function SnippetPanel(): React.ReactElement {
  const [snippets, setSnippets] = useState<readonly Snippet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showFavOnly, setShowFavOnly] = useState<boolean>(false);
  const [draft, setDraft] = useState<DraftSnippet>(EMPTY_DRAFT);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [renderedPreview, setRenderedPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const filter: { favOnly?: boolean; query?: string } = {};
      if (showFavOnly) filter.favOnly = true;
      if (searchQuery.trim().length > 0) filter.query = searchQuery.trim();
      const result = await commands.snippetList(filter);
      setSnippets(result.snippets);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, showFavOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedSnippet = useMemo(
    () => snippets.find((s) => s.id === selectedId) ?? null,
    [snippets, selectedId],
  );

  // When the user picks a snippet from the list, hydrate the draft
  // and reset the variables form.
  useEffect(() => {
    if (selectedSnippet && !isCreating) {
      setDraft(snippetToDraft(selectedSnippet));
      setVars(Object.fromEntries(selectedSnippet.variables.map((v) => [v, ""])));
      setRenderedPreview("");
    }
  }, [selectedSnippet, isCreating]);

  const startNew = useCallback(() => {
    setIsCreating(true);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setVars({});
    setRenderedPreview("");
  }, []);

  const cancelEdit = useCallback(() => {
    setIsCreating(false);
    if (selectedSnippet) {
      setDraft(snippetToDraft(selectedSnippet));
    } else {
      setDraft(EMPTY_DRAFT);
    }
  }, [selectedSnippet]);

  const save = useCallback(async (): Promise<void> => {
    if (draft.title.trim().length === 0 || draft.body.trim().length === 0) {
      setError("title and body required");
      return;
    }
    setError(null);
    try {
      const tagsList = draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const saveInput: {
        title: string;
        body: string;
        id?: string;
        category?: string;
        tags: readonly string[];
        isFavorite: boolean;
      } = {
        title: draft.title.trim(),
        body: draft.body,
        tags: tagsList,
        isFavorite: draft.isFavorite,
      };
      if (draft.id) saveInput.id = draft.id;
      if (draft.category.trim().length > 0) saveInput.category = draft.category.trim();
      const result = await commands.snippetSave(saveInput);
      setIsCreating(false);
      setSelectedId(result.snippet.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [draft, refresh]);

  const remove = useCallback(async (): Promise<void> => {
    if (!selectedSnippet) return;
    if (!window.confirm(`Delete "${selectedSnippet.title}"?`)) return;
    setError(null);
    try {
      await commands.snippetDelete(selectedSnippet.id);
      setSelectedId(null);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedSnippet, refresh]);

  const toggleFav = useCallback(async (): Promise<void> => {
    if (!selectedSnippet) return;
    setError(null);
    try {
      await commands.snippetSave({
        id: selectedSnippet.id,
        title: selectedSnippet.title,
        body: selectedSnippet.body,
        category: selectedSnippet.category ?? undefined,
        tags: selectedSnippet.tags,
        isFavorite: !selectedSnippet.isFavorite,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedSnippet, refresh]);

  const renderPreview = useCallback(async (): Promise<void> => {
    if (!selectedSnippet) return;
    try {
      const result = await commands.snippetUse(selectedSnippet.id, vars);
      setRenderedPreview(result.rendered);
      if (result.missingVars.length > 0) {
        setError(`Unbound variables: ${result.missingVars.join(", ")}`);
      } else {
        setError(null);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedSnippet, vars, refresh]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr 320px",
        gap: 12,
        padding: 12,
        height: "100%",
        background: "var(--surface-0)",
        color: "var(--text-primary)",
      }}
    >
      {/* ── Left: Snippet List ───────────────────────────── */}
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Search snippets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => setShowFavOnly((f) => !f)}
            style={{
              ...buttonStyle,
              background: showFavOnly
                ? "var(--accent-primary, #7c5fff)"
                : "var(--surface-1)",
              color: showFavOnly ? "#fff" : "var(--text-primary)",
            }}
            title="Show favorites only"
          >
            ★
          </button>
        </div>
        <button onClick={startNew} style={primaryButtonStyle}>
          + New Snippet
        </button>
        <div style={{ overflow: "auto", flex: 1, marginTop: 8 }}>
          {isLoading && snippets.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-secondary)", fontSize: 13 }}>
              Loading…
            </div>
          )}
          {!isLoading && snippets.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-secondary)", fontSize: 13 }}>
              No snippets yet. Click + New Snippet to create one, or save via{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>wotann snip save</code> from
              the CLI.
            </div>
          )}
          {snippets.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSelectedId(s.id);
                setIsCreating(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: 10,
                marginBottom: 4,
                borderRadius: 6,
                border:
                  s.id === selectedId
                    ? "1px solid var(--accent-primary, #7c5fff)"
                    : "1px solid transparent",
                background:
                  s.id === selectedId ? "var(--surface-2)" : "var(--surface-1)",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  marginBottom: 2,
                }}
              >
                {s.isFavorite && <span style={{ color: "var(--accent-primary)" }}>★</span>}
                <span>{s.title}</span>
                {s.category && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--surface-2)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {s.category}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.body.replace(/\n/g, " ")}
              </div>
              {s.useCount > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                  used {s.useCount}×
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Middle: Edit / Detail Pane ──────────────────── */}
      <div style={{ ...cardStyle, overflow: "auto" }}>
        {!selectedSnippet && !isCreating ? (
          <div style={{ color: "var(--text-secondary)", padding: 24, textAlign: "center" }}>
            Select a snippet on the left or click + New Snippet to create one.
          </div>
        ) : (
          <>
            <input
              placeholder="Snippet title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="Category (optional)"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                placeholder="Tags (comma-separated)"
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                style={{ ...inputStyle, flex: 2 }}
              />
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              <input
                type="checkbox"
                checked={draft.isFavorite}
                onChange={(e) => setDraft({ ...draft, isFavorite: e.target.checked })}
              />
              Favorite
            </label>
            <textarea
              placeholder="Prompt body. Use {{variable}} for substitution."
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              style={{
                ...inputStyle,
                minHeight: 200,
                fontFamily: "var(--font-mono, ui-monospace), monospace",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={save} style={primaryButtonStyle}>
                {isCreating ? "Create" : "Save"}
              </button>
              {(isCreating || selectedSnippet) && (
                <button onClick={cancelEdit} style={buttonStyle}>
                  Cancel
                </button>
              )}
              {!isCreating && selectedSnippet && (
                <>
                  <button onClick={toggleFav} style={buttonStyle}>
                    {selectedSnippet.isFavorite ? "Unfavorite" : "Favorite"}
                  </button>
                  <button
                    onClick={remove}
                    style={{ ...buttonStyle, color: "#ef4444", marginLeft: "auto" }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {error && (
              <div
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.1)",
                  color: "#ef4444",
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Right: Variable Form + Render Preview ───────── */}
      <div style={{ ...cardStyle, overflow: "auto" }}>
        {!selectedSnippet || isCreating ? (
          <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Select a saved snippet to render with variable substitution.
          </div>
        ) : selectedSnippet.variables.length === 0 ? (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              This snippet has no variables. Click <strong>Render</strong> to see the
              prompt and bump its use-count.
            </div>
            <button onClick={renderPreview} style={primaryButtonStyle}>
              Render
            </button>
            {renderedPreview && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  background: "var(--surface-0)",
                  padding: 12,
                  borderRadius: 6,
                  marginTop: 8,
                }}
              >
                {renderedPreview}
              </pre>
            )}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Variables ({selectedSnippet.variables.length})
            </div>
            {selectedSnippet.variables.map((v) => (
              <div key={v}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
                  {v}
                </div>
                <input
                  value={vars[v] ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
                  style={{ ...inputStyle, width: "100%" }}
                  placeholder={`Value for ${v}`}
                />
              </div>
            ))}
            <button onClick={renderPreview} style={primaryButtonStyle}>
              Render
            </button>
            {renderedPreview && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    marginTop: 8,
                  }}
                >
                  Rendered prompt
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    background: "var(--surface-0)",
                    padding: 12,
                    borderRadius: 6,
                    border: "1px solid var(--border-default)",
                  }}
                >
                  {renderedPreview}
                </pre>
                <button
                  onClick={() => void navigator.clipboard.writeText(renderedPreview)}
                  style={buttonStyle}
                >
                  Copy to clipboard
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
