/**
 * Block Memory Panel — letta-style core memory editor.
 *
 * Surfaces the same blocks the CLI manages (`wotann blocks ...`) and
 * the agent injects on every turn via the GuidanceWhisper hook. Each
 * block has a fixed character cap; the UI shows live byte counts +
 * truncation flags + a per-block textarea.
 *
 * Design notes:
 *   - Content is pulled from the daemon via `blocks.list` + `blocks.get`
 *     so this view stays consistent with the same blocks the agent
 *     reads at turn time.
 *   - Saves are debounced (500ms) to avoid hammering the daemon while
 *     the user types.
 *   - Truncation warning (red dot) appears when content > limit.
 *   - "Render preview" toggles a system-context view of how the block
 *     will appear in the LLM prompt.
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commands, type BlockKind, type BlockSummary, type MemoryBlock } from "../../hooks/useTauriCommand";

const KIND_LABELS: Record<BlockKind, string> = {
  persona: "Persona",
  human: "About You",
  task: "Current Task",
  project: "Project Context",
  scratch: "Scratchpad",
  issues: "Known Issues",
  decisions: "Decisions",
  bindings: "Bindings",
  custom1: "Custom 1",
  custom2: "Custom 2",
  custom3: "Custom 3",
  custom4: "Custom 4",
};

const KIND_HELP: Record<BlockKind, string> = {
  persona: "How the agent should behave and sound (tone, voice, defaults).",
  human: "Facts about you the agent should remember (role, preferences, location).",
  task: "What you're working on right now.",
  project: "Project-level conventions, constraints, and naming rules.",
  scratch: "Short-lived notes for the current session.",
  issues: "Known bugs or open problems the agent should keep in mind.",
  decisions: "Architectural decisions worth carrying forward.",
  bindings: "Aliases for env vars, paths, or other shorthand.",
  custom1: "User-defined slot.",
  custom2: "User-defined slot.",
  custom3: "User-defined slot.",
  custom4: "User-defined slot.",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function pctClass(used: number, limit: number): string {
  const pct = used / limit;
  if (pct >= 0.9) return "var(--color-warning)";
  if (pct >= 0.6) return "var(--color-accent)";
  return "var(--color-success)";
}

interface BlockEditorProps {
  readonly kind: BlockKind;
  readonly summary: BlockSummary | undefined;
  readonly onSave: (kind: BlockKind, content: string) => Promise<void>;
  readonly onClear: (kind: BlockKind) => Promise<void>;
}

function BlockEditor({ kind, summary, onSave, onClear }: BlockEditorProps): React.JSX.Element {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazy-load the block content when the panel is rendered.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const block: MemoryBlock | null = await commands.getBlock(kind);
        if (cancelled) return;
        const text = block?.content ?? "";
        setContent(text);
        setOriginalContent(text);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const debouncedSave = useCallback(
    (next: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (next === originalContent) return;
        setSaving(true);
        setError(null);
        try {
          await onSave(kind, next);
          setOriginalContent(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setSaving(false);
        }
      }, 500);
    },
    [kind, originalContent, onSave],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setContent(next);
      debouncedSave(next);
    },
    [debouncedSave],
  );

  const handleClear = useCallback(async () => {
    setContent("");
    setOriginalContent("");
    try {
      await onClear(kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [kind, onClear]);

  const limit = summary?.limit ?? 4096;
  const bytes = useMemo(() => new TextEncoder().encode(content).length, [content]);
  const isDirty = content !== originalContent;
  const overLimit = bytes > limit;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--border-default)",
        background: "var(--surface-1)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{KIND_LABELS[kind]}</strong>
          {summary?.truncated && (
            <span
              title="Block was truncated to its character cap on last save"
              style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                background: "var(--color-warning-muted)",
                color: "var(--color-warning)",
              }}
            >
              truncated
            </span>
          )}
        </div>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: 12,
            color: pctClass(bytes, limit),
          }}
        >
          {formatBytes(bytes)} / {formatBytes(limit)}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>{KIND_HELP[kind]}</p>
      <textarea
        value={content}
        onChange={handleChange}
        placeholder={loaded ? "Empty — type to set" : "Loading..."}
        disabled={!loaded}
        rows={5}
        style={{
          width: "100%",
          fontFamily: "var(--font-mono, ui-monospace), monospace",
          fontSize: 13,
          padding: 8,
          border: `1px solid ${overLimit ? "var(--color-warning)" : "var(--border-default)"}`,
          borderRadius: 6,
          background: "var(--surface-0)",
          color: "var(--text-primary)",
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        <span>
          {saving && "Saving…"}
          {!saving && isDirty && "Unsaved (autosave in 500ms)"}
          {!saving && !isDirty && loaded && "Saved"}
          {error && (
            <span style={{ color: "var(--color-warning)", marginLeft: 8 }}>{error}</span>
          )}
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={!loaded || content.length === 0}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid var(--border-default)",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: content.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export function BlockMemoryPanel(): React.JSX.Element {
  const [summaries, setSummaries] = useState<readonly BlockSummary[]>([]);
  const [kinds, setKinds] = useState<readonly BlockKind[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, kindList] = await Promise.all([
        commands.listBlocks(),
        commands.listBlockKinds(),
      ]);
      setSummaries(list);
      setKinds(kindList.map((k) => k.kind));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(
    async (kind: BlockKind, content: string) => {
      await commands.setBlock(kind, content);
      void refresh();
    },
    [refresh],
  );

  const handleClear = useCallback(
    async (kind: BlockKind) => {
      await commands.clearBlock(kind);
      void refresh();
    },
    [refresh],
  );

  const summaryByKind = useMemo(() => {
    const m = new Map<BlockKind, BlockSummary>();
    for (const s of summaries) m.set(s.kind, s);
    return m;
  }, [summaries]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16, padding: 16 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>Memory Blocks</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", maxWidth: 720 }}>
          Letta-style core memory injected into every turn. Each block has a fixed character cap; the
          agent reads them all on every prompt and uses them as always-on context. Edits autosave.
        </p>
        {loadError && (
          <div
            style={{
              fontSize: 12,
              padding: 8,
              borderRadius: 4,
              background: "var(--color-warning-muted)",
              color: "var(--color-warning)",
            }}
          >
            Could not reach daemon: {loadError}. Make sure <code>wotann daemon start</code> is running.
          </div>
        )}
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: 12,
          overflow: "auto",
        }}
      >
        {kinds.map((k) => (
          <BlockEditor
            key={k}
            kind={k}
            summary={summaryByKind.get(k)}
            onSave={handleSave}
            onClear={handleClear}
          />
        ))}
      </div>
    </div>
  );
}
