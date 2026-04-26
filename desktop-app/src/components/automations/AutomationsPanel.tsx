/**
 * AutomationsPanel — list/create/update/delete user automations.
 *
 * RPC surface (daemon-owned):
 *  - automations.list                     -> readonly Automation[]
 *  - automations.create { name, trigger, enabled }   -> Automation | { id }
 *  - automations.update { id, ...partial }           -> void
 *  - automations.delete { id }                       -> void
 *
 * Layout/style mirrors MCPTab + ExecApprovals — design tokens for color,
 * Tailwind for layout. Per-mount state (no module globals); errors render
 * via shared <ErrorState/>; loading uses shared <Skeleton/> bars.
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

export type TriggerKind = "schedule" | "event" | "manual" | "webhook";

export interface Automation {
  readonly id: string;
  readonly name: string;
  readonly trigger: TriggerKind | string;
  readonly enabled: boolean;
  readonly lastRun?: number;
  readonly description?: string;
}

interface Draft {
  readonly name: string;
  readonly trigger: TriggerKind;
  readonly enabled: boolean;
}

const EMPTY_DRAFT: Draft = { name: "", trigger: "manual", enabled: true };

const TRIGGER_OPTIONS: readonly { readonly value: TriggerKind; readonly label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "schedule", label: "Schedule (cron)" },
  { value: "event", label: "Event (system signal)" },
  { value: "webhook", label: "Webhook (HTTP)" },
];

const EMPTY_ICON =
  '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>';

// ── Parsing ──────────────────────────────────────────────────

function parseAutomations(result: unknown): readonly Automation[] {
  if (!Array.isArray(result)) return [];
  const out: Automation[] = [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const id = typeof e["id"] === "string" ? (e["id"] as string) : null;
    const name = typeof e["name"] === "string" ? (e["name"] as string) : null;
    if (id === null || name === null) continue;
    const trigger =
      typeof e["trigger"] === "string" ? (e["trigger"] as string) : "manual";
    const enabled = e["enabled"] !== false;
    const lastRun = typeof e["lastRun"] === "number" ? (e["lastRun"] as number) : undefined;
    const description =
      typeof e["description"] === "string"
        ? (e["description"] as string)
        : undefined;
    out.push({ id, name, trigger, enabled, lastRun, description });
  }
  return Object.freeze(out);
}

function isValidName(s: string): boolean {
  return s.trim().length > 0 && s.trim().length <= 80;
}

// ── Component ────────────────────────────────────────────────

export function AutomationsPanel(): ReactElement {
  const [items, setItems] = useState<readonly Automation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await commands.rpcCall("automations.list");
      setItems(parseAutomations(result));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((a: Automation) => {
    setEditingId(a.id);
    setDraft({
      name: a.name,
      trigger: ((["manual", "schedule", "event", "webhook"] as const).find(
        (t) => t === a.trigger,
      ) ?? "manual") as TriggerKind,
      enabled: a.enabled,
    });
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (!isValidName(draft.name)) return;
    const params = {
      name: draft.name.trim(),
      trigger: draft.trigger,
      enabled: draft.enabled,
    };
    setErrorMsg(null);
    try {
      if (editingId !== null) {
        await commands.rpcCall("automations.update", { id: editingId, ...params });
      } else {
        await commands.rpcCall("automations.create", params);
      }
      closeModal();
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [draft, editingId, closeModal, load]);

  const toggle = useCallback(
    async (a: Automation): Promise<void> => {
      setBusy((prev) => ({ ...prev, [a.id]: true }));
      setErrorMsg(null);
      try {
        await commands.rpcCall("automations.update", {
          id: a.id,
          name: a.name,
          trigger: a.trigger,
          enabled: !a.enabled,
        });
        await load();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[a.id];
          return next;
        });
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setBusy((prev) => ({ ...prev, [id]: true }));
      setErrorMsg(null);
      try {
        await commands.rpcCall("automations.delete", { id });
        setConfirmDelete(null);
        await load();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [load],
  );

  const summary = useMemo(() => {
    const total = items.length;
    const active = items.filter((a) => a.enabled).length;
    return { total, active };
  }, [items]);

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
            Automations
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
                ? "No automations yet."
                : `${summary.active} active of ${summary.total}`}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          aria-label="Create new automation"
          className="btn-press"
          style={{
            minHeight: 36,
            padding: "0 14px",
            borderRadius: "var(--radius-md, 8px)",
            border: "none",
            background: "var(--color-primary)",
            color: "#FFFFFF",
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New Automation
        </button>
      </header>

      <main
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ padding: "var(--space-md, 16px) var(--space-lg, 24px)" }}
      >
        {errorMsg !== null && !loading && items.length === 0 ? (
          <ErrorState
            title="Could not load automations"
            message={errorMsg}
            onRetry={() => void load()}
          />
        ) : loading ? (
          <div className="flex flex-col" style={{ gap: 8 }} aria-label="Loading automations">
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
        ) : items.length === 0 ? (
          <EmptyState
            icon={EMPTY_ICON}
            title="No automations yet"
            message="Create automations to run tasks on a schedule, in response to events, or via webhook."
            action={{ label: "+ New Automation", onClick: openCreate }}
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
              {items.map((a) => (
                <AutomationRow
                  key={a.id}
                  automation={a}
                  busy={busy[a.id] === true}
                  onToggle={() => void toggle(a)}
                  onEdit={() => openEdit(a)}
                  onRequestDelete={() => setConfirmDelete(a.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {modalOpen && (
        <AutomationModal
          editing={editingId !== null}
          draft={draft}
          onChange={setDraft}
          onCancel={closeModal}
          onSave={() => void save()}
        />
      )}

      {confirmDelete !== null && (
        <ConfirmDeleteModal
          name={items.find((a) => a.id === confirmDelete)?.name ?? "this automation"}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove(confirmDelete)}
        />
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────

function AutomationRow({
  automation,
  busy,
  onToggle,
  onEdit,
  onRequestDelete,
}: {
  readonly automation: Automation;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onRequestDelete: () => void;
}): ReactElement {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--radius-md, 8px)",
        border: "1px solid var(--border-subtle)",
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span
        aria-label={automation.enabled ? "Enabled" : "Disabled"}
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          flexShrink: 0,
          background: automation.enabled ? "var(--color-success)" : "var(--color-text-muted)",
          boxShadow: automation.enabled ? "0 0 6px var(--color-success)" : "none",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "var(--font-size-sm, 13px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {automation.name}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 4,
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
            alignItems: "center",
          }}
        >
          <span
            style={{
              padding: "2px 8px",
              background: "var(--surface-3)",
              borderRadius: 6,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {automation.trigger}
          </span>
          {automation.lastRun !== undefined && (
            <span>
              Last run {new Date(automation.lastRun).toLocaleString()}
            </span>
          )}
        </div>
      </div>
      <Toggle
        enabled={automation.enabled}
        busy={busy}
        onToggle={onToggle}
        ariaLabel={automation.enabled ? "Disable automation" : "Enable automation"}
      />
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        aria-label={`Edit ${automation.name}`}
        className="btn-press"
        style={{
          minHeight: 32,
          padding: "0 10px",
          borderRadius: "var(--radius-sm, 6px)",
          border: "1px solid var(--border-subtle)",
          background: "transparent",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-xs, 11px)",
          fontWeight: 500,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        disabled={busy}
        aria-label={`Delete ${automation.name}`}
        className="btn-press"
        style={{
          minHeight: 32,
          padding: "0 10px",
          borderRadius: "var(--radius-sm, 6px)",
          border: "1px solid var(--border-subtle)",
          background: "transparent",
          color: "var(--color-error)",
          fontSize: "var(--font-size-xs, 11px)",
          fontWeight: 500,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        Delete
      </button>
    </div>
  );
}

// ── Toggle ───────────────────────────────────────────────────

function Toggle({
  enabled,
  busy,
  onToggle,
  ariaLabel,
}: {
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly ariaLabel: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={enabled}
      onClick={onToggle}
      disabled={busy}
      style={{
        minHeight: 32,
        minWidth: 51,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: busy ? "wait" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "block",
          width: 44,
          height: 26,
          borderRadius: 18,
          background: enabled ? "var(--color-success)" : "var(--surface-3)",
          transition: "background 180ms ease",
          position: "relative",
          opacity: busy ? 0.5 : 1,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: enabled ? 20 : 2,
            width: 22,
            height: 22,
            borderRadius: 12,
            background: "#FFFFFF",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
            transition: "left 180ms ease",
          }}
        />
      </span>
    </button>
  );
}

// ── Modal: create/edit ──────────────────────────────────────

function AutomationModal({
  editing,
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  readonly editing: boolean;
  readonly draft: Draft;
  readonly onChange: (d: Draft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): ReactElement {
  const valid = isValidName(draft.name);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Edit automation" : "Create automation"}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "92vw",
          background: "var(--color-bg-secondary)",
          borderRadius: "var(--radius-lg, 12px)",
          border: "1px solid var(--border-subtle)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "var(--font-size-md, 14px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {editing ? "Edit Automation" : "New Automation"}
        </h3>
        <ModalField label="Name">
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="My automation"
            aria-label="Automation name"
            style={inputStyle}
          />
        </ModalField>
        <ModalField label="Trigger type">
          <select
            value={draft.trigger}
            onChange={(e) =>
              onChange({ ...draft, trigger: e.target.value as TriggerKind })
            }
            aria-label="Trigger type"
            style={inputStyle}
          >
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </ModalField>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
            aria-label="Enabled"
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          Enable immediately
        </label>
        <div className="flex" style={{ gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="btn-press"
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: "var(--radius-md, 8px)",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-primary)",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!valid}
            aria-label={editing ? "Save changes" : "Create automation"}
            className="btn-press"
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: "var(--radius-md, 8px)",
              border: "none",
              background: valid ? "var(--color-primary)" : "var(--surface-3)",
              color: valid ? "#FFFFFF" : "var(--color-text-muted)",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              cursor: valid ? "pointer" : "not-allowed",
            }}
          >
            {editing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "8px 10px",
  borderRadius: "var(--radius-sm, 6px)",
  background: "var(--color-bg-primary)",
  border: "1px solid var(--border-subtle)",
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-sm, 13px)",
  outline: "none",
  width: "100%",
};

function ModalField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: "var(--font-size-2xs, 10px)",
          color: "var(--color-text-secondary)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Modal: delete confirmation ──────────────────────────────

function ConfirmDeleteModal({
  name,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactElement {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm delete"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: "92vw",
          background: "var(--color-bg-secondary)",
          borderRadius: "var(--radius-lg, 12px)",
          border: "1px solid var(--border-subtle)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "var(--font-size-md, 14px)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Delete automation?
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: "var(--font-size-xs, 11px)",
            color: "var(--color-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          This will permanently delete <strong style={{ color: "var(--color-text-primary)" }}>{name}</strong>. This action cannot be undone.
        </p>
        <div className="flex" style={{ gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel delete"
            className="btn-press"
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: "var(--radius-md, 8px)",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-primary)",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            aria-label="Confirm delete"
            className="btn-press"
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: "var(--radius-md, 8px)",
              border: "none",
              background: "var(--color-error)",
              color: "#FFFFFF",
              fontSize: "var(--font-size-sm, 13px)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
