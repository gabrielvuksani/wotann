/**
 * ConnectorConfigForm — per-connector configuration form.
 * Obsidian Precision styling. State is local until Save.
 *
 * RPC contract (with graceful fallback):
 *   invoke("connector_save_config", { connectorType, config })
 *   invoke("connector_test_connection", { connectorType, config })
 * Falls back to set_config("connectors.<type>", JSON.stringify(config))
 * when the dedicated RPC is unavailable.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  INITIAL_STATE,
  renderFields,
  validateConfig,
  type ConfigState,
  type ConfigValue,
} from "./ConnectorFormFields";

export type SupportedConnectorType =
  | "google-drive"
  | "notion"
  | "github"
  | "slack"
  | "linear"
  | "jira";

export interface ConnectorConfigFormProps {
  readonly connectorType: SupportedConnectorType;
  readonly connectorName: string;
  readonly connected: boolean;
}

type BannerKind = "success" | "error";
interface Banner { readonly kind: BannerKind; readonly text: string }

async function callSave(
  connectorType: SupportedConnectorType,
  config: ConfigState,
): Promise<void> {
  try {
    await invoke("connector_save_config", { connectorType, config });
    return;
  } catch {
    await invoke("set_config", {
      key: `connectors.${connectorType}`,
      value: JSON.stringify(config),
    });
  }
}

async function callTest(
  connectorType: SupportedConnectorType,
  config: ConfigState,
): Promise<boolean> {
  try {
    const ok = await invoke<boolean>("connector_test_connection", { connectorType, config });
    return Boolean(ok);
  } catch {
    return false;
  }
}

export function ConnectorConfigForm({
  connectorType,
  connectorName,
  connected,
}: ConnectorConfigFormProps) {
  const [config, setConfig] = useState<ConfigState>(INITIAL_STATE[connectorType]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setConfig(INITIAL_STATE[connectorType]);
    setBanner(null);
    setErrors(new Set());
  }, [connectorType]);

  const setField = (key: string, value: ConfigValue) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const invalid = validateConfig(connectorType, config);
    setErrors(invalid);
    if (invalid.size > 0) {
      setBanner({ kind: "error", text: "Please fill in the required fields." });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      await callSave(connectorType, config);
      setBanner({ kind: "success", text: `${connectorName} settings saved.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setBanner({ kind: "error", text: `Save failed: ${msg}` });
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setBanner(null);
    const ok = await callTest(connectorType, config);
    setBanner(
      ok
        ? { kind: "success", text: "Connection successful." }
        : { kind: "error", text: "Connection failed. Check credentials." },
    );
    setTesting(false);
  };

  const fieldError = (key: string) => errors.has(key);

  return (
    <div
      className="h-full overflow-y-auto p-6"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" }}
    >
      <header className="mb-5">
        <h3 className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {connectorName} configuration
        </h3>
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          Status: {connected ? "connected" : "not connected"}
        </p>
      </header>

      {banner && (
        <div
          role="alert"
          className="mb-4 rounded-xl px-3 py-2 text-xs border"
          style={{
            borderRadius: "12px",
            color: banner.kind === "success" ? "var(--color-success)" : "var(--color-error)",
            background: banner.kind === "success" ? "rgba(48,209,88,0.1)" : "rgba(255,69,58,0.1)",
            borderColor: banner.kind === "success" ? "rgba(48,209,88,0.3)" : "rgba(255,69,58,0.3)",
          }}
        >
          {banner.text}
        </div>
      )}

      <div className="space-y-4">
        {renderFields(connectorType, config, setField, fieldError)}
      </div>

      <div className="flex items-center gap-2 mt-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || testing}
          className="px-4 py-1.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--color-primary)", color: "white", borderRadius: "12px" }}
        >
          {saving ? "Saving\u2026" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={saving || testing}
          className="px-4 py-1.5 rounded-xl text-xs font-medium border transition-colors disabled:opacity-50"
          style={{
            color: "var(--color-text-secondary)",
            borderColor: "var(--border-subtle)",
            borderRadius: "12px",
            background: "var(--surface-2)",
          }}
        >
          {testing ? "Testing\u2026" : "Test connection"}
        </button>
      </div>
    </div>
  );
}
