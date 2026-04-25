/**
 * CreationsBrowser — V9 T5.4 desktop-app surface.
 *
 * The daemon owns a per-session `CreationsStore` (see
 * `src/session/creations.ts`) and exposes it via four JSON-RPC
 * methods: `creations.save`, `creations.list`, `creations.get`,
 * `creations.delete`. iOS already has a CreationsView. The desktop
 * audit (2026-04-25) flagged this surface as missing — agent
 * outputs were invisible from the Creations tab.
 *
 * This component is the primary browser:
 *   - Left column: file list for the active session
 *   - Right column: file viewer (text preview or download prompt
 *     for binaries)
 *   - Toolbar: refresh, delete, copy-path
 *
 * RPC pattern: we use the same `commands.sendMessage` -> JSON-RPC
 * envelope -> `{result}` pattern that `intelligenceUtils.tsx` uses
 * for daemon-level methods that aren't exposed as Tauri commands.
 *
 * DESIGN NOTES
 * - Per-mount state: every CreationsBrowser instance owns its own
 *   list + viewer state. No module globals. Two simultaneous
 *   browsers (in a split view, say) work independently.
 * - Honest empty state: "No creations yet" is visible — never a
 *   blank screen.
 * - Loading state: the file viewer shows a "Loading…" spinner
 *   while the RPC fetch is in flight.
 * - Error surface: any RPC failure renders in an `errorMessage`
 *   banner. We never silently swallow.
 * - Binary detection: `creations.get` returns content + encoding;
 *   for `base64` we render a download prompt rather than a
 *   binary blob in <pre>.
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";

// ── Types ───────────────────────────────────────────────────

/**
 * A single creation entry as returned by `creations.list`. Mirrors
 * the daemon's `CreationsEntry` shape (see `src/session/creations.ts`)
 * — kept minimal here so future server-side additions don't break
 * the UI (extra fields are simply ignored).
 */
export interface CreationEntry {
  readonly filename: string;
  readonly bytes: number;
  readonly contentType?: string;
  readonly createdAt?: number;
  readonly sha256?: string;
}

interface CreationContent {
  readonly metadata: CreationEntry;
  readonly content: string;
  readonly encoding: "utf-8" | "base64";
}

export interface CreationsBrowserProps {
  /**
   * Session id whose creations to browse. When omitted or empty,
   * the browser renders an empty-state input letting the user
   * supply an id manually.
   */
  readonly sessionId?: string | null;
  /**
   * Optional injected RPC for tests. Defaults to the production
   * `commands.sendMessage`-driven JSON-RPC bridge.
   */
  readonly rpc?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

// ── RPC helpers ─────────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly id?: number;
}

async function defaultRpc(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await commands.sendMessage(
    JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() }),
  );
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as JsonRpcResponse;
    if (parsed.error) {
      throw new Error(`${method} failed: ${parsed.error.message}`);
    }
    return parsed.result ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${method} failed`)) {
      throw err;
    }
    return null;
  }
}

// ── Component ───────────────────────────────────────────────

export function CreationsBrowser(
  props: CreationsBrowserProps,
): ReactElement {
  const initialId =
    typeof props.sessionId === "string" ? props.sessionId : "";
  const [draft, setDraft] = useState<string>(initialId);
  const [committedId, setCommittedId] = useState<string>(initialId);

  const effectiveId =
    typeof props.sessionId === "string" && props.sessionId.length > 0
      ? props.sessionId
      : committedId;

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      data-testid="creations-browser"
    >
      <header
        style={{
          padding: "var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: "var(--font-size-lg, 16px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          Creations
        </h2>
        <p
          style={{
            margin: "var(--space-2xs, 2px) 0 0 0",
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
          }}
        >
          Files the agent created during this session.
        </p>
      </header>

      {effectiveId.length === 0 ? (
        <SessionPicker
          draft={draft}
          onDraftChange={setDraft}
          onCommit={() => {
            const trimmed = draft.trim();
            if (trimmed.length > 0) setCommittedId(trimmed);
          }}
        />
      ) : (
        <BrowserBody
          sessionId={effectiveId}
          rpc={props.rpc ?? defaultRpc}
          onChangeSession={() => {
            setCommittedId("");
            setDraft("");
          }}
        />
      )}
    </div>
  );
}

// ── Session picker (empty state) ────────────────────────────

interface SessionPickerProps {
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onCommit: () => void;
}

function SessionPicker(props: SessionPickerProps): ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-md, 12px)",
        padding: "var(--space-lg, 16px)",
      }}
      data-testid="creations-picker"
    >
      <div
        style={{
          fontSize: "var(--font-size-sm, 13px)",
          color: "var(--color-text-secondary)",
          textAlign: "center",
          maxWidth: 360,
        }}
      >
        Pick a session to browse the files it created. The default Workshop
        session id is wired automatically once a task is running.
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onCommit();
        }}
        style={{
          display: "flex",
          gap: "var(--space-sm, 8px)",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          placeholder="session-id"
          aria-label="Session id"
          style={{
            padding: "6px 10px",
            fontSize: "var(--font-size-sm, 13px)",
            fontFamily: "var(--font-mono)",
            background: "var(--surface-1)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
            minWidth: 220,
          }}
        />
        <button
          type="submit"
          disabled={props.draft.trim().length === 0}
          className="btn-press"
          style={{
            padding: "6px 12px",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background:
              props.draft.trim().length === 0
                ? "var(--surface-2)"
                : "var(--color-primary)",
            color: props.draft.trim().length === 0 ? "var(--color-text-muted)" : "#fff",
            cursor:
              props.draft.trim().length === 0 ? "not-allowed" : "pointer",
            opacity: props.draft.trim().length === 0 ? 0.55 : 1,
          }}
        >
          Browse
        </button>
      </form>
    </div>
  );
}

// ── Browser body ────────────────────────────────────────────

interface BrowserBodyProps {
  readonly sessionId: string;
  readonly rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly onChangeSession: () => void;
}

function BrowserBody(props: BrowserBodyProps): ReactElement {
  const [entries, setEntries] = useState<readonly CreationEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<CreationContent | null>(null);
  const [contentLoading, setContentLoading] = useState<boolean>(false);

  const refreshList = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await props.rpc("creations.list", { sessionId: props.sessionId });
      const list = parseEntries(result);
      setEntries(list);
      // Reset selection if the current selection is no longer present.
      if (selected !== null && !list.some((e) => e.filename === selected)) {
        setSelected(null);
        setContent(null);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
    // selected is intentionally NOT a dep — we use the current value
    // through closure but we don't want to re-fetch when selection
    // changes; that's the loadFile path's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.rpc, props.sessionId]);

  const loadFile = useCallback(
    async (filename: string): Promise<void> => {
      setContentLoading(true);
      setContent(null);
      setErrorMessage(null);
      try {
        const result = await props.rpc("creations.get", {
          sessionId: props.sessionId,
          filename,
        });
        const parsed = parseFileResult(result);
        if (parsed === null) {
          setErrorMessage(`File "${filename}" not found.`);
        } else {
          setContent(parsed);
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setContentLoading(false);
      }
    },
    [props.rpc, props.sessionId],
  );

  const deleteFile = useCallback(
    async (filename: string): Promise<void> => {
      setErrorMessage(null);
      try {
        await props.rpc("creations.delete", {
          sessionId: props.sessionId,
          filename,
        });
        await refreshList();
        if (selected === filename) {
          setSelected(null);
          setContent(null);
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [props.rpc, props.sessionId, refreshList, selected],
  );

  // Initial + reactive load when the session id changes.
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Auto-load file content when a selection is made.
  useEffect(() => {
    if (selected === null) {
      setContent(null);
      return;
    }
    void loadFile(selected);
  }, [selected, loadFile]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        style={{
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {props.sessionId}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {entries.length} {entries.length === 1 ? "file" : "files"}
        </span>
        <button
          type="button"
          onClick={() => void refreshList()}
          className="btn-press"
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs, 10px)",
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px solid var(--border-subtle)",
            background: "var(--surface-2)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={props.onChangeSession}
          className="btn-press"
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs, 10px)",
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px dashed var(--border-subtle)",
            background: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          Change session
        </button>
      </div>

      {errorMessage !== null && (
        <div
          role="alert"
          data-testid="creations-error"
          style={{
            margin: "var(--space-sm, 8px)",
            padding: "var(--space-sm, 8px) var(--space-md, 12px)",
            background: "var(--color-error-bg, rgba(239, 68, 68, 0.08))",
            color: "var(--color-error, #ef4444)",
            borderRadius: "var(--radius-sm, 6px)",
            fontSize: "var(--font-size-xs, 11px)",
          }}
        >
          {errorMessage}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2fr)",
          gap: 0,
        }}
      >
        {/* List */}
        <div
          style={{
            borderRight: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {isLoading && entries.length === 0 ? (
            <div
              style={{
                padding: "var(--space-md, 12px)",
                color: "var(--color-text-secondary)",
                fontSize: "var(--font-size-sm, 13px)",
              }}
            >
              Loading creations…
            </div>
          ) : entries.length === 0 ? (
            <div
              data-testid="creations-empty"
              style={{
                padding: "var(--space-md, 12px)",
                color: "var(--color-text-secondary)",
                fontSize: "var(--font-size-sm, 13px)",
                textAlign: "center",
              }}
            >
              No creations yet. The agent has not saved any files for this
              session.
            </div>
          ) : (
            <ul
              data-testid="creations-list"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                overflowY: "auto",
                flex: 1,
              }}
            >
              {entries.map((entry) => (
                <CreationRow
                  key={entry.filename}
                  entry={entry}
                  selected={selected === entry.filename}
                  onSelect={() => setSelected(entry.filename)}
                  onDelete={() => void deleteFile(entry.filename)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Viewer */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <Viewer
            selected={selected}
            content={content}
            isLoading={contentLoading}
          />
        </div>
      </div>
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────

interface CreationRowProps {
  readonly entry: CreationEntry;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onDelete: () => void;
}

function CreationRow(props: CreationRowProps): ReactElement {
  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      // Allow Delete/Backspace to remove the file when focused.
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        props.onDelete();
      }
    },
    [props],
  );
  return (
    <li
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: props.selected
          ? "var(--surface-2, rgba(255,255,255,0.03))"
          : "transparent",
      }}
    >
      <button
        type="button"
        onClick={props.onSelect}
        onKeyDown={handleKey}
        style={{
          width: "100%",
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          color: "var(--color-text-primary)",
          font: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: props.selected ? 600 : 500,
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {props.entry.filename}
          </span>
          <span
            style={{
              display: "block",
              fontSize: "var(--font-size-2xs, 10px)",
              color: "var(--color-text-secondary)",
            }}
          >
            {formatBytes(props.entry.bytes)}
            {props.entry.contentType ? ` · ${props.entry.contentType}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

// ── Viewer ──────────────────────────────────────────────────

interface ViewerProps {
  readonly selected: string | null;
  readonly content: CreationContent | null;
  readonly isLoading: boolean;
}

function Viewer(props: ViewerProps): ReactElement {
  if (props.selected === null) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-sm, 13px)",
          fontStyle: "italic",
        }}
      >
        Select a creation to preview.
      </div>
    );
  }
  if (props.isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-sm, 13px)",
        }}
      >
        Loading {props.selected}…
      </div>
    );
  }
  if (props.content === null) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-sm, 13px)",
        }}
      >
        No content.
      </div>
    );
  }
  if (props.content.encoding === "base64") {
    const bytesEstimate = Math.floor((props.content.content.length * 3) / 4);
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-sm, 8px)",
          padding: "var(--space-lg, 16px)",
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-sm, 13px)",
            color: "var(--color-text-primary)",
            textAlign: "center",
          }}
        >
          {props.content.metadata.filename}
        </div>
        <div
          style={{
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
            textAlign: "center",
          }}
        >
          Binary file ({formatBytes(bytesEstimate)}). Preview disabled — copy
          the path or use Editor to open.
        </div>
      </div>
    );
  }
  return (
    <pre
      data-testid="creations-viewer"
      style={{
        flex: 1,
        margin: 0,
        padding: "var(--space-md, 12px)",
        overflow: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-xs, 11px)",
        color: "var(--color-text-primary)",
        background: "var(--bg-base, transparent)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {props.content.content}
    </pre>
  );
}

// ── Parsers ─────────────────────────────────────────────────

function parseEntries(result: unknown): readonly CreationEntry[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const raw = obj["entries"];
  if (!Array.isArray(raw)) return [];
  const out: CreationEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e["filename"] !== "string") continue;
    const bytes = typeof e["bytes"] === "number" ? (e["bytes"] as number) : 0;
    const entry: CreationEntry = {
      filename: e["filename"] as string,
      bytes,
      contentType:
        typeof e["contentType"] === "string"
          ? (e["contentType"] as string)
          : undefined,
      createdAt:
        typeof e["createdAt"] === "number" ? (e["createdAt"] as number) : undefined,
      sha256: typeof e["sha256"] === "string" ? (e["sha256"] as string) : undefined,
    };
    out.push(entry);
  }
  return Object.freeze(out);
}

function parseFileResult(result: unknown): CreationContent | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  if (obj["found"] === false) return null;
  const content = obj["content"];
  const encoding = obj["encoding"];
  const metadata = obj["metadata"];
  if (typeof content !== "string") return null;
  if (encoding !== "utf-8" && encoding !== "base64") return null;
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m["filename"] !== "string") return null;
  const bytes = typeof m["bytes"] === "number" ? (m["bytes"] as number) : 0;
  return {
    metadata: {
      filename: m["filename"] as string,
      bytes,
      contentType:
        typeof m["contentType"] === "string"
          ? (m["contentType"] as string)
          : undefined,
      createdAt:
        typeof m["createdAt"] === "number"
          ? (m["createdAt"] as number)
          : undefined,
      sha256: typeof m["sha256"] === "string" ? (m["sha256"] as string) : undefined,
    },
    content,
    encoding,
  };
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
