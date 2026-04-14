/**
 * Exec Approvals — allowlist/denylist management for shell commands.
 * Controls which commands the agent can run automatically vs needing approval.
 */

import type React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { getApprovalRules } from "../../store/engine";
import type { ApprovalRule } from "../../hooks/useTauriCommand";

const ACTION_STYLES: Record<string, React.CSSProperties> = {
  allow: { background: "var(--color-success-muted)", color: "var(--color-success)", borderColor: "rgba(16, 185, 129, 0.15)" },
  deny: { background: "rgba(239, 68, 68, 0.15)", color: "var(--color-error)", borderColor: "rgba(239, 68, 68, 0.15)" },
  ask: { background: "rgba(245, 158, 11, 0.15)", color: "var(--color-warning)", borderColor: "rgba(245, 158, 11, 0.15)" },
};

export function ExecApprovals() {
  const [rules, setRules] = useState<readonly ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "allow" | "deny" | "ask">("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newAction, setNewAction] = useState<"allow" | "deny" | "ask">("ask");
  const [newDescription, setNewDescription] = useState("");

  const handleAddRule = useCallback(() => {
    if (!newPattern.trim()) return;
    const rule: ApprovalRule = {
      id: `rule-${Date.now()}`,
      pattern: newPattern.trim(),
      action: newAction,
      scope: "project",
      description: newDescription.trim() || `Custom ${newAction} rule`,
    };
    setRules((prev) => [...prev, rule]);
    setNewPattern("");
    setNewAction("ask");
    setNewDescription("");
    setShowAddForm(false);
  }, [newPattern, newAction, newDescription]);

  useEffect(() => {
    let cancelled = false;
    async function loadRules() {
      setLoading(true);
      const result = await getApprovalRules();
      if (!cancelled) {
        setRules(result);
        setLoading(false);
      }
    }
    loadRules();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rules;
    return rules.filter((r) => r.action === filter);
  }, [rules, filter]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>Exec Approvals</h2>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>Control which commands run automatically</p>
        </div>
        <button
          onClick={() => setShowAddForm((prev) => !prev)}
          className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
          style={{ background: "var(--color-primary)" }}
          aria-label="Add new approval rule"
        >
          {showAddForm ? "Cancel" : "+ Add Rule"}
        </button>
      </div>

      {/* Inline add-rule form */}
      {showAddForm && (
        <div className="rounded-xl border p-4 mb-4" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-secondary)" }}>Pattern (glob or regex)</label>
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="e.g. rm -rf *, git push --force"
                className="w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none"
                style={{ background: "var(--color-bg-primary)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
                aria-label="Rule pattern"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-secondary)" }}>Action</label>
              <select
                value={newAction}
                onChange={(e) => setNewAction(e.target.value as "allow" | "deny" | "ask")}
                className="w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none"
                style={{ background: "var(--color-bg-primary)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
                aria-label="Rule action"
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="ask">Ask</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-secondary)" }}>Description (optional)</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What this rule does"
                className="w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none"
                style={{ background: "var(--color-bg-primary)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
                aria-label="Rule description"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleAddRule}
                disabled={!newPattern.trim()}
                className="px-4 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
                style={{ background: newPattern.trim() ? "var(--color-primary)" : "var(--surface-3)" }}
              >
                Add Rule
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-4">
        {(["all", "allow", "deny", "ask"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-2.5 py-1 text-xs rounded-full transition-colors"
            style={filter === f ? { background: "var(--color-primary)", color: "white" } : { background: "var(--surface-3)", color: "var(--color-text-secondary)" }}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({rules.filter((r) => f === "all" || r.action === f).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }} />
            Loading approval rules...
          </div>
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-xl border flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
              <path d="M8 2l5 3v6l-5 3-5-3V5l5-3z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 8l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No approval rules configured</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Add rules to control which commands the agent can execute
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between rounded-xl border p-3" style={ACTION_STYLES[rule.action]}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono bg-black/20 px-2 py-0.5 rounded">{rule.pattern}</span>
                <span className="text-xs opacity-70">{rule.description}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] opacity-50">{rule.scope}</span>
                <span className="text-xs font-medium uppercase">{rule.action}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
