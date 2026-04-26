/**
 * PluginManagerView — local plugin browser sourced from the daemon
 * `plugins.list` RPC.
 *
 * RPC surface:
 *  - plugins.list -> { ok: true, plugins, skipped } | { ok: false, error }
 *
 * Each plugin entry exposes (from the daemon's LoadedPlugin shape):
 *  - name        : kebab-case plugin name
 *  - root        : on-disk plugin directory
 *  - bins        : readonly LoadedBin[] — runnable entries
 *  - manifestPath: absolute path to plugin.json|manifest.json
 *
 * The daemon does NOT currently project version/description from the
 * manifest into the response; the UI defensively reads `version` and
 * `description` if either appears (forward-compatible) and otherwise
 * shows what the loader actually returns. Skipped entries (malformed
 * plugins, missing manifests, etc.) are surfaced under a collapsed
 * "Issues" section so the user can correct them.
 *
 * Style mirrors AutomationsPanel.tsx: design tokens for color, Tailwind
 * for layout. Per-mount state, no module globals. Errors render via the
 * shared <ErrorState/>; loading uses shared <Skeleton/> bars.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { commands } from "../../hooks/useTauriCommand";
import { ErrorState, EmptyState } from "../shared/ErrorState";
import { Skeleton } from "../shared/Skeleton";

// ── Types ────────────────────────────────────────────────────

interface LoadedBin {
  readonly pluginName: string;
  readonly name: string;
  readonly executable: string;
  readonly description?: string;
}

/**
 * Mirrors the daemon's `LoadedPlugin` shape with two forward-compatible
 * fields (`version`, `description`) that the loader does not yet project
 * but the manifest declares. Reading them defensively means the UI
 * "lights up" the moment the daemon decides to expose them, with no
 * extra change required here.
 */
interface PluginEntry {
  readonly name: string;
  readonly root: string;
  readonly bins: readonly LoadedBin[];
  readonly manifestPath: string;
  readonly version?: string;
  readonly description?: string;
}

interface SkippedEntry {
  readonly dir: string;
  readonly reason: string;
}

interface ListOk {
  readonly ok: true;
  readonly plugins: readonly PluginEntry[];
  readonly skipped: readonly SkippedEntry[];
}

interface ListErr {
  readonly ok: false;
  readonly error: string;
}

const EMPTY_ICON =
  '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 8h4M8 6v4"/></svg>';

// ── Parsing ──────────────────────────────────────────────────

function parseBin(raw: unknown): LoadedBin | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const pluginName = typeof e["pluginName"] === "string" ? (e["pluginName"] as string) : null;
  const name = typeof e["name"] === "string" ? (e["name"] as string) : null;
  const executable =
    typeof e["executable"] === "string" ? (e["executable"] as string) : null;
  if (pluginName === null || name === null || executable === null) return null;
  const description =
    typeof e["description"] === "string" ? (e["description"] as string) : undefined;
  return { pluginName, name, executable, description };
}

function parsePlugin(raw: unknown): PluginEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const name = typeof e["name"] === "string" ? (e["name"] as string) : null;
  const root = typeof e["root"] === "string" ? (e["root"] as string) : null;
  const manifestPath =
    typeof e["manifestPath"] === "string" ? (e["manifestPath"] as string) : null;
  if (name === null || root === null || manifestPath === null) return null;
  const binsRaw = Array.isArray(e["bins"]) ? (e["bins"] as readonly unknown[]) : [];
  const bins: LoadedBin[] = [];
  for (const b of binsRaw) {
    const parsed = parseBin(b);
    if (parsed !== null) bins.push(parsed);
  }
  const version =
    typeof e["version"] === "string" ? (e["version"] as string) : undefined;
  const description =
    typeof e["description"] === "string" ? (e["description"] as string) : undefined;
  return { name, root, bins, manifestPath, version, description };
}

function parseSkipped(raw: unknown): SkippedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const dir = typeof e["dir"] === "string" ? (e["dir"] as string) : null;
  const reason = typeof e["reason"] === "string" ? (e["reason"] as string) : null;
  if (dir === null || reason === null) return null;
  return { dir, reason };
}

function parseResponse(result: unknown): ListOk | ListErr {
  if (!result || typeof result !== "object") {
    return { ok: false, error: "Invalid response from daemon" };
  }
  const r = result as Record<string, unknown>;
  if (r["ok"] === false) {
    const err = typeof r["error"] === "string" ? (r["error"] as string) : "Unknown error";
    return { ok: false, error: err };
  }
  if (r["ok"] !== true) {
    const err = typeof r["error"] === "string" ? (r["error"] as string) : "Unknown error";
    return { ok: false, error: err };
  }
  const pluginsRaw = Array.isArray(r["plugins"]) ? (r["plugins"] as readonly unknown[]) : [];
  const skippedRaw = Array.isArray(r["skipped"]) ? (r["skipped"] as readonly unknown[]) : [];
  const plugins: PluginEntry[] = [];
  for (const p of pluginsRaw) {
    const parsed = parsePlugin(p);
    if (parsed !== null) plugins.push(parsed);
  }
  const skipped: SkippedEntry[] = [];
  for (const s of skippedRaw) {
    const parsed = parseSkipped(s);
    if (parsed !== null) skipped.push(parsed);
  }
  return { ok: true, plugins: Object.freeze(plugins), skipped: Object.freeze(skipped) };
}

// ── Component ────────────────────────────────────────────────

export function PluginManagerView(): ReactElement {
  const [plugins, setPlugins] = useState<readonly PluginEntry[]>([]);
  const [skipped, setSkipped] = useState<readonly SkippedEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const raw = await commands.rpcCall("plugins.list");
      const parsed = parseResponse(raw);
      if (parsed.ok) {
        setPlugins(parsed.plugins);
        setSkipped(parsed.skipped);
      } else {
        setPlugins([]);
        setSkipped([]);
        setErrorMsg(parsed.error);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const total = plugins.length;
    const totalBins = plugins.reduce((acc, p) => acc + p.bins.length, 0);
    return { total, totalBins };
  }, [plugins]);

  return (
    <div
      className="h-full flex flex-col"
      style={{
        background: "var(--color-bg-primary)",
        color: "var(--color-text-primary)",
      }}
    >
      <header
        className="flex items-center justify-between"
        style={{
          padding: "var(--space-md, 16px) var(--space-lg, 24px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "var(--font-size-lg, 16px)",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            Plugins
          </h2>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: "var(--font-size-xs, 11px)",
              color: "var(--color-text-secondary)",
            }}
          >
            {loading
              ? "Loading…"
              : summary.total === 0
                ? "No plugins installed."
                : `${summary.total} plugin${summary.total === 1 ? "" : "s"} · ${summary.totalBins} bin${summary.totalBins === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh plugin list"
          disabled={loading}
          className="btn-press"
          style={{
            minHeight: 36,
            padding: "0 14px",
            borderRadius: "var(--radius-md, 8px)",
            border: "1px solid var(--border-subtle)",
            background: "transparent",
            color: "var(--color-text-primary)",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 500,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          Refresh
        </button>
      </header>

      <main
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: "var(--space-md, 16px) var(--space-lg, 24px)" }}
      >
        {errorMsg !== null && !loading && plugins.length === 0 ? (
          <ErrorState
            title="Could not load plugins"
            message={errorMsg}
            onRetry={() => void load()}
          />
        ) : loading ? (
          <div
            className="flex flex-col"
            style={{ gap: 8 }}
            aria-label="Loading plugins"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  background: "var(--surface-2)",
                  borderRadius: "var(--radius-md, 8px)",
                  border: "1px solid var(--border-subtle)",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <Skeleton width="40%" height="14px" />
                <Skeleton width="70%" height="11px" />
              </div>
            ))}
          </div>
        ) : plugins.length === 0 && skipped.length === 0 ? (
          <EmptyState
            icon={EMPTY_ICON}
            title="No plugins installed"
            message="Drop a plugin directory into ~/.wotann/plugins/ to install. Each plugin needs a plugin.json or manifest.json at its root."
          />
        ) : (
          <>
            {errorMsg !== null && (
              <div
                role="alert"
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: "var(--color-error-muted)",
                  color: "var(--color-error)",
                  fontSize: "var(--font-size-xs, 11px)",
                }}
              >
                {errorMsg}
              </div>
            )}
            <div className="flex flex-col" style={{ gap: 8 }}>
              {plugins.map((p) => (
                <PluginRow key={p.root} plugin={p} />
              ))}
            </div>
            {skipped.length > 0 && (
              <SkippedSection
                skipped={skipped}
                open={issuesOpen}
                onToggle={() => setIssuesOpen((v) => !v)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────

function PluginRow({ plugin }: { readonly plugin: PluginEntry }): ReactElement {
  const binCount = plugin.bins.length;
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--radius-md, 8px)",
        border: "1px solid var(--border-subtle)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div className="flex items-center" style={{ gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "var(--radius-xs)",
            flexShrink: 0,
            background: "var(--color-success)",
            boxShadow: "0 0 6px var(--color-success)",
          }}
        />
        <div
          style={{
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {plugin.name}
        </div>
        {plugin.version !== undefined && (
          <span
            style={{
              padding: "2px 8px",
              background: "var(--surface-3)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--font-size-2xs, 10px)",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              textTransform: "lowercase",
              letterSpacing: "0.02em",
            }}
          >
            v{plugin.version}
          </span>
        )}
        <span
          style={{
            marginLeft: "auto",
            padding: "2px 8px",
            background: "var(--surface-3)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-2xs, 10px)",
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {binCount} {binCount === 1 ? "bin" : "bins"}
        </span>
      </div>
      {plugin.description !== undefined && plugin.description.length > 0 && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
            lineHeight: 1.45,
          }}
        >
          {plugin.description}
        </p>
      )}
      <div
        style={{
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-muted)",
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          wordBreak: "break-all",
        }}
        title={plugin.root}
      >
        {plugin.root}
      </div>
      {binCount > 0 && (
        <ul
          style={{
            margin: "4px 0 0 0",
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
          aria-label={`Bin entries for ${plugin.name}`}
        >
          {plugin.bins.map((b) => (
            <li
              key={`${b.pluginName}/${b.name}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "var(--font-size-2xs, 10px)",
                color: "var(--color-text-secondary)",
                fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              }}
            >
              <span style={{ opacity: 0.5 }}>•</span>
              <span style={{ color: "var(--color-text-primary)" }}>{b.name}</span>
              {b.description !== undefined && b.description.length > 0 && (
                <span style={{ opacity: 0.7 }}>— {b.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Skipped Section ─────────────────────────────────────────

function SkippedSection({
  skipped,
  open,
  onToggle,
}: {
  readonly skipped: readonly SkippedEntry[];
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  return (
    <div
      style={{
        marginTop: 16,
        background: "var(--surface-2)",
        borderRadius: "var(--radius-md, 8px)",
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="plugin-issues-list"
        aria-label={open ? "Hide plugin issues" : "Show plugin issues"}
        className="btn-press"
        style={{
          width: "100%",
          minHeight: 40,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          color: "var(--color-text-primary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "var(--font-size-sm, 13px)",
          fontWeight: 600,
        }}
      >
        <span className="flex items-center" style={{ gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "var(--radius-xs)",
              background: "var(--color-warning)",
              boxShadow: "0 0 6px var(--color-warning)",
            }}
          />
          Issues
          <span
            style={{
              padding: "2px 8px",
              background: "var(--surface-3)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--font-size-2xs, 10px)",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
            }}
          >
            {skipped.length}
          </span>
        </span>
        <span
          aria-hidden="true"
          style={{
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 180ms ease",
          }}
        >
          ›
        </span>
      </button>
      {open && (
        <ul
          id="plugin-issues-list"
          style={{
            margin: 0,
            padding: "0 14px 12px 14px",
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {skipped.map((s, i) => (
            <li
              key={`${s.dir}-${i}`}
              style={{
                background: "var(--color-bg-primary)",
                borderRadius: "var(--radius-sm, 6px)",
                border: "1px solid var(--border-subtle)",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span
                style={{
                  fontSize: "var(--font-size-2xs, 10px)",
                  color: "var(--color-text-muted)",
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  wordBreak: "break-all",
                }}
                title={s.dir}
              >
                {s.dir}
              </span>
              <span
                style={{
                  fontSize: "var(--font-size-xs, 11px)",
                  color: "var(--color-warning)",
                }}
              >
                {s.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
