/**
 * F2 — Agent config, skill browser, per-agent model override, and active
 * workers list. Composed into the Workshop tab as an additional "Config"
 * sub-tab. The data source is the Tauri command bridge — we rely on the
 * existing `getAgents` and `getSkills` commands and degrade gracefully when
 * new RPCs (`agents.config`, `workers.status`) are missing on older daemons.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { commands, type SkillInfo } from "../../hooks/useTauriCommand";
import { useStore } from "../../store";
import type { AgentInfo } from "../../types";

// ── Agent config shape returned by the daemon ───────────

interface AgentConfig {
  readonly agentId: string;
  readonly model: string;
  readonly provider: string;
  readonly allowedTools: readonly string[];
}

interface WorkerStatus {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly runtimeMs?: number;
}

// ── Provider/model dropdown catalogue ────────────────────
//
// Static list lets the UI offer a full override surface without depending on
// a provider-discovery RPC. Daemons that support `providers.list` will still
// surface the same names for each of these options.
const MODEL_CHOICES: readonly { readonly provider: string; readonly model: string }[] = [
  { provider: "anthropic", model: "claude-opus-4-6" },
  { provider: "anthropic", model: "claude-sonnet-4-6" },
  { provider: "anthropic", model: "claude-haiku-4-6" },
  { provider: "openai", model: "gpt-4.1" },
  { provider: "openai", model: "o4-mini" },
  { provider: "google", model: "gemini-2.5-pro" },
  { provider: "ollama", model: "qwen3-coder:30b" },
  { provider: "ollama", model: "devstral:24b" },
];

// ── Helpers ──────────────────────────────────────────────

async function safeInvoke<T>(name: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const bridge = commands as unknown as Record<
      string,
      (args?: Record<string, unknown>) => Promise<T>
    >;
    const fn = bridge[name];
    if (typeof fn === "function") return await fn(args);
    return null;
  } catch {
    return null;
  }
}

// ── Component ────────────────────────────────────────────

export function AgentConfigPanel(): JSX.Element {
  const agents = useStore((s) => s.agents);
  const [configs, setConfigs] = useState<Record<string, AgentConfig>>({});
  const [skills, setSkills] = useState<readonly SkillInfo[]>([]);
  const [workers, setWorkers] = useState<readonly WorkerStatus[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgResult, skillList, workerResult] = await Promise.all([
        safeInvoke<Record<string, AgentConfig>>("agentsConfig"),
        commands.getSkills().catch(() => [] as readonly SkillInfo[]),
        safeInvoke<{ workers: readonly WorkerStatus[] }>("workersStatus"),
      ]);
      if (cfgResult) setConfigs(cfgResult);
      setSkills(skillList);
      if (workerResult) setWorkers(workerResult.workers ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredSkills = useMemo(() => {
    if (!skillSearch) return skills;
    const needle = skillSearch.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        (s.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [skills, skillSearch]);

  const agentConfig = selectedAgent ? configs[selectedAgent] : null;

  return (
    <div className="flex-1 flex overflow-hidden" style={{ gap: "var(--space-md)", padding: "var(--space-md)" }}>
      {/* Left: Agent roster + model override */}
      <div
        style={{
          width: 320,
          flexShrink: 0,
          background: "var(--surface-2)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-md)",
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: "var(--space-sm)" }}>
          <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Agents
          </h3>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="btn-press"
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-1)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--border-subtle)",
              fontSize: "var(--font-size-2xs)",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {agents.length === 0 ? (
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
            No agents registered yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                config={configs[agent.id]}
                selected={selectedAgent === agent.id}
                onSelect={() => setSelectedAgent(agent.id)}
                override={overrides[agent.id]}
                onOverrideChange={(value) =>
                  setOverrides((prev) => ({ ...prev, [agent.id]: value }))
                }
              />
            ))}
          </div>
        )}

        {selectedAgent && agentConfig && (
          <div style={{ marginTop: "var(--space-md)", paddingTop: "var(--space-sm)", borderTop: "1px solid var(--border-subtle)" }}>
            <h4 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>
              {selectedAgent}
            </h4>
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              Provider: {agentConfig.provider} · Model: {agentConfig.model}
            </div>
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: 4 }}>
              Tools ({agentConfig.allowedTools.length}): {agentConfig.allowedTools.slice(0, 6).join(", ")}
              {agentConfig.allowedTools.length > 6 ? ", ..." : ""}
            </div>
          </div>
        )}
      </div>

      {/* Middle: skill browser */}
      <div
        style={{
          flex: 1,
          background: "var(--surface-2)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-md)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: "var(--space-sm)" }}>
          <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Skill Browser
          </h3>
          <input
            value={skillSearch}
            onChange={(e) => setSkillSearch(e.target.value)}
            placeholder="Search skills..."
            style={{
              padding: "4px 8px",
              background: "var(--surface-1)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text-primary)",
              fontSize: "var(--font-size-xs)",
              width: 180,
            }}
            aria-label="Search skills"
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          {filteredSkills.length === 0 ? (
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              {skills.length === 0 ? "No skills available." : "No skills match the filter."}
            </p>
          ) : (
            filteredSkills.map((skill) => (
              <div
                key={skill.name}
                style={{
                  padding: "var(--space-sm)",
                  background: "var(--surface-1)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ fontSize: "var(--font-size-xs)", fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", fontWeight: 600 }}>
                  {skill.name}
                </div>
                {skill.description && (
                  <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", margin: "2px 0 0" }}>
                    {skill.description}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: active workers */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          background: "var(--surface-2)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-md)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-sm)" }}>
          Active Workers
        </h3>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          {workers.length === 0 ? (
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
              No workers running.
            </p>
          ) : (
            workers.map((w) => (
              <div
                key={w.id}
                style={{
                  padding: "var(--space-sm)",
                  background: "var(--surface-1)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {w.name}
                </div>
                <div style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)", marginTop: 2 }}>
                  State: {w.state}
                  {w.runtimeMs !== undefined ? ` · ${Math.round(w.runtimeMs / 1000)}s` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Agent row with override dropdown ─────────────────────

function AgentRow(props: {
  readonly agent: AgentInfo;
  readonly config?: AgentConfig;
  readonly selected: boolean;
  readonly override?: string;
  readonly onSelect: () => void;
  readonly onOverrideChange: (value: string) => void;
}): JSX.Element {
  const { agent, config, selected, override, onSelect, onOverrideChange } = props;
  const currentKey = override ?? (config ? `${config.provider}:${config.model}` : "");
  return (
    <div
      style={{
        padding: "var(--space-sm)",
        background: selected ? "var(--surface-1)" : "transparent",
        borderRadius: "var(--radius-sm)",
        border: selected ? "1px solid var(--accent)" : "1px solid transparent",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-primary)", fontWeight: 500 }}>
          {agent.name ?? agent.id}
        </span>
        <span
          style={{
            fontSize: "var(--font-size-2xs)",
            padding: "1px 6px",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-2)",
            color: "var(--color-text-muted)",
          }}
        >
          {agent.status ?? "idle"}
        </span>
      </div>
      <select
        value={currentKey}
        onChange={(e) => {
          e.stopPropagation();
          onOverrideChange(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          padding: "3px 6px",
          background: "var(--surface-2)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-2xs)",
        }}
        aria-label={`Model override for ${agent.id}`}
      >
        <option value="">(use default)</option>
        {MODEL_CHOICES.map((m) => (
          <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
            {m.provider} / {m.model}
          </option>
        ))}
      </select>
    </div>
  );
}
