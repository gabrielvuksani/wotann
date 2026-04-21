/**
 * ConnectorFormFields — primitive field components and per-type field renderers.
 * Extracted from ConnectorConfigForm to keep each file focused.
 * Obsidian Precision: token-backed surfaces, accent focus, 12px radius.
 */

import type { SupportedConnectorType } from "./ConnectorConfigForm";

export type ConfigValue = string | boolean;
export type ConfigState = Readonly<Record<string, ConfigValue>>;

export const INITIAL_STATE: Readonly<Record<SupportedConnectorType, ConfigState>> = {
  "google-drive": { folderIds: "", syncInterval: "hourly", oauthConnected: false },
  "notion": { workspaceId: "", databaseIds: "", includeArchived: false },
  "github": { repos: "", includeIssues: true, includePRs: true, includeWiki: false, token: "" },
  "slack": { workspace: "", channelAllowlist: "", ignoreBots: true },
  "linear": { teamId: "", projectIds: "", includeCancelled: false },
  "jira": { baseUrl: "", projectKeys: "", email: "", apiToken: "" },
};

export function validateConfig(
  type: SupportedConnectorType,
  config: ConfigState,
): ReadonlySet<string> {
  const invalid = new Set<string>();
  const req = (k: string) => {
    if (!String(config[k] || "").trim()) invalid.add(k);
  };
  switch (type) {
    case "jira":
      req("baseUrl"); req("email"); req("apiToken"); break;
    case "github":
      req("repos"); break;
    case "notion":
      req("workspaceId"); break;
    case "slack":
      req("workspace"); break;
    case "linear":
      req("teamId"); break;
    case "google-drive":
      break;
  }
  return invalid;
}

// ── Primitive field components ───────────────────────────────

const fieldStyle = {
  background: "var(--surface-2)",
  borderColor: "var(--border-subtle)",
  borderRadius: "12px",
  color: "var(--color-text-primary)",
};

export function TextField(props: {
  label: string; name: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
  type?: string; invalid?: boolean;
}) {
  const id = `conn-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
        {props.label}
      </label>
      <input
        id={id}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-invalid={props.invalid ? "true" : "false"}
        className="w-full text-sm px-3 py-1.5 border outline-none focus:border-[var(--color-primary)]"
        style={{ ...fieldStyle, borderColor: props.invalid ? "var(--color-error)" : fieldStyle.borderColor }}
      />
    </div>
  );
}

export function TextAreaField(props: {
  label: string; name: string; value: string;
  onChange: (v: string) => void; placeholder?: string; invalid?: boolean;
}) {
  const id = `conn-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
        {props.label}
      </label>
      <textarea
        id={id}
        rows={4}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-invalid={props.invalid ? "true" : "false"}
        className="w-full text-sm px-3 py-1.5 border outline-none font-mono focus:border-[var(--color-primary)]"
        style={{ ...fieldStyle, borderColor: props.invalid ? "var(--color-error)" : fieldStyle.borderColor }}
      />
    </div>
  );
}

export function SelectField(props: {
  label: string; name: string; value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  const id = `conn-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full text-sm px-3 py-1.5 border outline-none focus:border-[var(--color-primary)]"
        style={fieldStyle}
      >
        {props.options.map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>
    </div>
  );
}

export function ToggleField(props: {
  label: string; name: string; value: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = `conn-${props.name}`;
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm" style={{ color: "var(--color-text-primary)" }}>
      <span>{props.label}</span>
      <input
        id={id}
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.target.checked)}
        className="w-4 h-4 cursor-pointer"
        style={{ accentColor: "var(--color-primary)" }}
      />
    </label>
  );
}

// ── Per-connector field renderers ────────────────────────────

export function renderFields(
  type: SupportedConnectorType,
  config: ConfigState,
  setField: (k: string, v: ConfigValue) => void,
  invalid: (k: string) => boolean,
) {
  const s = (k: string) => String(config[k] ?? "");
  const b = (k: string) => Boolean(config[k]);

  switch (type) {
    case "google-drive":
      return (
        <>
          <TextField label="Folder IDs (comma-separated)" name="folderIds" value={s("folderIds")} onChange={(v) => setField("folderIds", v)} placeholder="1aBc..., 2xYz..." invalid={invalid("folderIds")} />
          <SelectField label="Sync interval" name="syncInterval" value={s("syncInterval")} onChange={(v) => setField("syncInterval", v)} options={[["5min","Every 5 minutes"],["15min","Every 15 minutes"],["hourly","Hourly"],["daily","Daily"]]} />
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            OAuth: {b("oauthConnected") ? "Connected" : "Not connected"}
          </div>
        </>
      );
    case "notion":
      return (
        <>
          <TextField label="Workspace ID" name="workspaceId" value={s("workspaceId")} onChange={(v) => setField("workspaceId", v)} placeholder="ws_..." invalid={invalid("workspaceId")} />
          <TextAreaField label="Database IDs (one per line)" name="databaseIds" value={s("databaseIds")} onChange={(v) => setField("databaseIds", v)} placeholder="db_xyz..." invalid={invalid("databaseIds")} />
          <ToggleField label="Include archived pages" name="includeArchived" value={b("includeArchived")} onChange={(v) => setField("includeArchived", v)} />
        </>
      );
    case "github":
      return (
        <>
          <TextAreaField label="Repos (owner/repo per line)" name="repos" value={s("repos")} onChange={(v) => setField("repos", v)} placeholder="octocat/hello-world" invalid={invalid("repos")} />
          <ToggleField label="Include issues" name="includeIssues" value={b("includeIssues")} onChange={(v) => setField("includeIssues", v)} />
          <ToggleField label="Include pull requests" name="includePRs" value={b("includePRs")} onChange={(v) => setField("includePRs", v)} />
          <ToggleField label="Include wiki" name="includeWiki" value={b("includeWiki")} onChange={(v) => setField("includeWiki", v)} />
          <TextField label="Personal access token" name="token" value={s("token")} onChange={(v) => setField("token", v)} placeholder="ghp_..." type="password" invalid={invalid("token")} />
        </>
      );
    case "slack":
      return (
        <>
          <TextField label="Workspace name" name="workspace" value={s("workspace")} onChange={(v) => setField("workspace", v)} placeholder="my-company" invalid={invalid("workspace")} />
          <TextAreaField label="Channel allowlist (one per line)" name="channelAllowlist" value={s("channelAllowlist")} onChange={(v) => setField("channelAllowlist", v)} placeholder="#general" invalid={invalid("channelAllowlist")} />
          <ToggleField label="Ignore bot messages" name="ignoreBots" value={b("ignoreBots")} onChange={(v) => setField("ignoreBots", v)} />
        </>
      );
    case "linear":
      return (
        <>
          <TextField label="Team ID" name="teamId" value={s("teamId")} onChange={(v) => setField("teamId", v)} placeholder="TEAM-ABC" invalid={invalid("teamId")} />
          <TextField label="Project IDs (comma-separated)" name="projectIds" value={s("projectIds")} onChange={(v) => setField("projectIds", v)} placeholder="proj-1, proj-2" invalid={invalid("projectIds")} />
          <ToggleField label="Include cancelled issues" name="includeCancelled" value={b("includeCancelled")} onChange={(v) => setField("includeCancelled", v)} />
        </>
      );
    case "jira":
      return (
        <>
          <TextField label="Base URL" name="baseUrl" value={s("baseUrl")} onChange={(v) => setField("baseUrl", v)} placeholder="https://example.atlassian.net" invalid={invalid("baseUrl")} />
          <TextField label="Project keys (comma-separated)" name="projectKeys" value={s("projectKeys")} onChange={(v) => setField("projectKeys", v)} placeholder="WOT, AGENT" invalid={invalid("projectKeys")} />
          <TextField label="Email" name="email" value={s("email")} onChange={(v) => setField("email", v)} placeholder="you@example.com" type="email" invalid={invalid("email")} />
          <TextField label="API token" name="apiToken" value={s("apiToken")} onChange={(v) => setField("apiToken", v)} type="password" invalid={invalid("apiToken")} />
        </>
      );
  }
}
