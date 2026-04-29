/**
 * Operations Panel — admin/dev tools clustered into one view.
 *
 * Surfaces 5 of the V3 competitor ports as tabbed tools so they don't
 * fragment the sidebar. Each tab is a self-contained mini-tool:
 *
 *   - Inspect:  magic-byte / magika file-type detection
 *   - Attest:   Ed25519 audit signing + verification
 *   - Policy:   Cedar-style permit/forbid evaluator
 *   - Canary:   post-deploy probe-based metric capture
 *   - Evolve:   placeholder pointer at the CLI evolve workflow
 *
 * Why one panel with tabs instead of 5 sidebar entries:
 *   - These are infrequent admin tools, not daily-use surfaces.
 *   - Tab grouping keeps the sidebar focused on chat/editor/blocks
 *     while still giving the GUI parity the user asked for.
 */

import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { commands } from "../../hooks/useTauriCommand";

type TabKey = "inspect" | "attest" | "policy" | "canary" | "evolve";

const TABS: ReadonlyArray<{ readonly key: TabKey; readonly label: string; readonly hint: string }> = [
  { key: "inspect", label: "Inspect", hint: "Detect file type via magic bytes + optional ML" },
  { key: "attest", label: "Attest", hint: "Ed25519-signed audit envelopes" },
  { key: "policy", label: "Policy", hint: "Cedar-style permit/forbid evaluator" },
  { key: "canary", label: "Canary", hint: "Post-deploy metric baseline + monitor" },
  { key: "evolve", label: "Evolve", hint: "GEPA-style skill optimizer" },
];

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--surface-1)",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace), monospace",
  fontSize: 13,
  padding: "6px 10px",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  background: "var(--surface-0)",
  color: "var(--text-primary)",
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--border-default)",
  background: "var(--accent-muted)",
  color: "var(--text-primary)",
  cursor: "pointer",
};

function ResultBlock({ data, error }: { readonly data?: unknown; readonly error?: string | null }): React.JSX.Element | null {
  if (error) {
    return (
      <pre
        style={{
          background: "var(--color-warning-muted)",
          color: "var(--color-warning)",
          padding: 12,
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {error}
      </pre>
    );
  }
  if (data === undefined) return null;
  return (
    <pre
      style={{
        background: "var(--surface-0)",
        padding: 12,
        borderRadius: 6,
        border: "1px solid var(--border-default)",
        fontSize: 12,
        whiteSpace: "pre-wrap",
        overflow: "auto",
        maxHeight: 320,
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function InspectTab(): React.JSX.Element {
  const [path, setPath] = useState("");
  const [declared, setDeclared] = useState("");
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);

  const onRun = useCallback(async () => {
    if (!path.trim()) {
      setError("Path is required.");
      return;
    }
    setError(null);
    try {
      const r = await commands.inspectPath(path.trim(), declared.trim() || undefined);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [path, declared]);

  return (
    <div style={cardStyle}>
      <div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Absolute path to inspect</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/path/to/file"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Declared type (optional — we'll flag mismatches)
        </label>
        <input
          value={declared}
          onChange={(e) => setDeclared(e.target.value)}
          placeholder="image/png, text/plain, etc."
          style={inputStyle}
        />
      </div>
      <button type="button" onClick={onRun} style={buttonStyle}>Inspect</button>
      <ResultBlock data={result} error={error} />
    </div>
  );
}

function AttestTab(): React.JSX.Element {
  const [recordJson, setRecordJson] = useState('{"action":"deploy","actor":"agent:builder"}');
  const [keyId, setKeyId] = useState("default");
  const [envelope, setEnvelope] = useState<unknown>();
  const [verifyResult, setVerifyResult] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);

  const onSign = useCallback(async () => {
    setError(null);
    try {
      const record = JSON.parse(recordJson) as Record<string, unknown>;
      const r = await commands.attestSign(record, keyId);
      setEnvelope(r);
      setVerifyResult(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [recordJson, keyId]);

  const onVerify = useCallback(async () => {
    if (!envelope || typeof envelope !== "object") return;
    setError(null);
    try {
      const r = await commands.attestVerify(envelope as Record<string, unknown>);
      setVerifyResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [envelope]);

  const onGenkey = useCallback(async () => {
    setError(null);
    try {
      const r = await commands.attestGenkey(keyId);
      setEnvelope(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [keyId]);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Key id</label>
        <input
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          style={{ ...inputStyle, maxWidth: 200 }}
        />
        <button type="button" onClick={onGenkey} style={buttonStyle}>Generate / load key</button>
      </div>
      <div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Record JSON</label>
        <textarea
          value={recordJson}
          onChange={(e) => setRecordJson(e.target.value)}
          rows={4}
          style={{ ...inputStyle, fontFamily: "var(--font-mono, ui-monospace), monospace" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onSign} style={buttonStyle}>Sign</button>
        <button type="button" onClick={onVerify} disabled={!envelope} style={{ ...buttonStyle, opacity: envelope ? 1 : 0.5 }}>
          Verify
        </button>
      </div>
      <ResultBlock data={verifyResult ?? envelope} error={error} />
    </div>
  );
}

function PolicyTab(): React.JSX.Element {
  const [policy, setPolicy] = useState(
    `permit(principal == "agent:reviewer", action == "tool:Read");
forbid(principal == "*", action == "tool:Bash", resource ~ "rm -rf");`,
  );
  const [principal, setPrincipal] = useState("agent:reviewer");
  const [action, setAction] = useState("tool:Read");
  const [resource, setResource] = useState("src/foo.ts");
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);

  const onRun = useCallback(async () => {
    setError(null);
    try {
      const r = await commands.policyEvaluate(policy, principal, action, resource);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [policy, principal, action, resource]);

  return (
    <div style={cardStyle}>
      <div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Policy</label>
        <textarea
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
          rows={6}
          style={{ ...inputStyle, fontFamily: "var(--font-mono, ui-monospace), monospace" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <input value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="principal" style={inputStyle} />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="action" style={inputStyle} />
        <input value={resource} onChange={(e) => setResource(e.target.value)} placeholder="resource" style={inputStyle} />
      </div>
      <button type="button" onClick={onRun} style={buttonStyle}>Evaluate</button>
      <ResultBlock data={result} error={error} />
    </div>
  );
}

function CanaryTab(): React.JSX.Element {
  const [probeUrl, setProbeUrl] = useState("");
  const [samples, setSamples] = useState("5");
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);

  const onRun = useCallback(async () => {
    if (!probeUrl.trim()) {
      setError("Probe URL is required.");
      return;
    }
    setError(null);
    try {
      const r = await commands.canaryCaptureBaseline(probeUrl.trim(), Number(samples) || 5);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [probeUrl, samples]);

  return (
    <div style={cardStyle}>
      <div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Probe URL (returns metric JSON)</label>
        <input
          value={probeUrl}
          onChange={(e) => setProbeUrl(e.target.value)}
          placeholder="http://localhost:3000/metrics"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Samples</label>
        <input
          value={samples}
          onChange={(e) => setSamples(e.target.value)}
          type="number"
          min={1}
          style={{ ...inputStyle, maxWidth: 120 }}
        />
      </div>
      <button type="button" onClick={onRun} style={buttonStyle}>Capture baseline</button>
      <ResultBlock data={result} error={error} />
    </div>
  );
}

function EvolveTab(): React.JSX.Element {
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Skill Evolution</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
        The GEPA-style skill optimizer runs as an offline CLI workflow because each generation issues real LLM calls and is cost-bounded. Trigger it with:
      </p>
      <pre style={{ background: "var(--surface-0)", padding: 12, borderRadius: 6, fontSize: 12 }}>
        wotann evolve {"<path/to/skill.md>"} --generations 3 --write
      </pre>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
        The `--write` flag archives the original under `~/.wotann/evolution-archive/` and replaces the skill file with the winning variant when the new score beats baseline.
      </p>
    </div>
  );
}

export function OperationsPanel(): React.JSX.Element {
  const [active, setActive] = useState<TabKey>("inspect");
  const [daemonError, setDaemonError] = useState<string | null>(null);

  // Probe the daemon once at mount so the user sees a single top-level
  // banner rather than 5 different per-tab errors. Audit caught:
  // OperationsPanel previously surfaced raw `[WOTANN IPC] RPC error...`
  // strings inside individual ResultBlock instances, leaving the user
  // confused about whether the daemon was the issue.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The cheapest authenticated round-trip we have right now.
        await commands.listBlockKinds();
        if (!cancelled) setDaemonError(null);
      } catch (err) {
        if (!cancelled) setDaemonError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16, gap: 16 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Operations</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", maxWidth: 720 }}>
          Admin and audit tools for safe deploys, signed audit logs, file-type validation, and policy gates. These complement the daemon — they operate on local files / RPC, not the chat session.
        </p>
        {daemonError && (
          <div
            style={{
              fontSize: 12,
              padding: 8,
              borderRadius: 4,
              background: "var(--color-warning-muted)",
              color: "var(--color-warning)",
            }}
          >
            Could not reach daemon: {daemonError}. Make sure <code>wotann daemon start</code> is running.
          </div>
        )}
      </header>
      <nav style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border-default)" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            title={t.hint}
            style={{
              border: "none",
              borderBottom: `2px solid ${active === t.key ? "var(--color-primary)" : "transparent"}`,
              padding: "8px 12px",
              background: "transparent",
              color: active === t.key ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1, overflow: "auto" }}>
        {active === "inspect" && <InspectTab />}
        {active === "attest" && <AttestTab />}
        {active === "policy" && <PolicyTab />}
        {active === "canary" && <CanaryTab />}
        {active === "evolve" && <EvolveTab />}
      </div>
    </div>
  );
}
