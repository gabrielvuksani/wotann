/**
 * Unified provider configuration panel.
 *
 * Single source of truth for provider state lives on the daemon's
 * ProviderService, surfaced via `providers.snapshot` RPC. This panel
 * renders a card per provider with:
 *   - Tier badge (frontier / fast / local / specialised)
 *   - Configured indicator + credential source/method
 *   - Model count + default model
 *   - Inline sign-in or API-key form appropriate to the provider
 *   - Test / Refresh / Remove actions
 *
 * Replaces the 1,174-line detect-and-save-from-env ad-hoc panel with a
 * surface that only talks to the daemon through the RPC bridge.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { commands } from "../../hooks/useTauriCommand";

type AuthMethod = "apiKey" | "oauth" | "subscription" | "cli" | "local";
type Tier = "frontier" | "fast" | "local" | "specialised" | "free";

interface SnapshotModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly costPerMTokInput: number;
  readonly costPerMTokOutput: number;
}

interface SnapshotProvider {
  readonly id: string;
  readonly name: string;
  readonly tier: Tier;
  readonly configured: boolean;
  readonly credentialLabel: string | null;
  readonly credentialMethod: AuthMethod | null;
  readonly credentialSource: string | null;
  readonly models: readonly SnapshotModel[];
  readonly defaultModel: string | null;
  readonly lastRefreshedAt: number;
  readonly lastError: string | null;
  readonly supportedMethods: readonly AuthMethod[];
  readonly envKeys: readonly string[];
  readonly docsUrl: string | null;
}

interface ProvidersSnapshot {
  readonly providers: readonly SnapshotProvider[];
  readonly active: { provider: string; model: string } | null;
  readonly lastRefreshedAt: number;
}

const TIER_LABELS: Record<Tier, string> = {
  frontier: "Frontier",
  fast: "Fast",
  local: "Local",
  specialised: "Specialised",
  free: "Free",
};

const TIER_COLORS: Record<Tier, string> = {
  frontier: "text-[#0A84FF] border-[#0A84FF]/30 bg-[#0A84FF]/10",
  fast: "text-[#30D158] border-[#30D158]/30 bg-[#30D158]/10",
  local: "text-[#EBEBF5]/60 border-white/10 bg-white/5",
  specialised: "text-[#FF9F0A] border-[#FF9F0A]/30 bg-[#FF9F0A]/10",
  free: "text-[#30D158] border-[#30D158]/30 bg-[#30D158]/10",
};

function formatRefreshed(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 30_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / (60 * 60_000))}h ago`;
}

export function ProviderConfig(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProvidersSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async (force = false): Promise<void> => {
    try {
      setLoading(true);
      const data = await commands.sendMessage(
        JSON.stringify({ method: "providers.snapshot", params: { force } }),
      );
      const parsed = JSON.parse(data) as ProvidersSnapshot;
      setSnapshot(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(false), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const showToast = (kind: "success" | "error", text: string): void => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  };

  const rpcSend = useCallback(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const raw = await commands.sendMessage(JSON.stringify({ method, params }));
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }, []);

  const onRefresh = async (): Promise<void> => {
    try {
      await rpcSend("providers.refresh", {});
      await load(true);
      showToast("success", "Providers refreshed");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const onSaveKey = async (providerId: string, key: string): Promise<void> => {
    try {
      setBusyProviderId(providerId);
      await rpcSend("providers.saveCredential", {
        providerId,
        method: "apiKey",
        token: key.trim(),
        label: "API Key",
      });
      await load(true);
      showToast("success", `Saved ${providerId} API key`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProviderId(null);
    }
  };

  const onTest = async (providerId: string): Promise<void> => {
    try {
      setBusyProviderId(providerId);
      const result = (await rpcSend("providers.test", { providerId })) as {
        ok: boolean;
        error?: string;
        modelCount?: number;
      };
      if (result.ok) {
        showToast("success", `${providerId}: ${result.modelCount ?? 0} models reachable`);
      } else {
        showToast("error", `${providerId}: ${result.error ?? "failed"}`);
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProviderId(null);
    }
  };

  const onRemove = async (providerId: string): Promise<void> => {
    try {
      setBusyProviderId(providerId);
      await rpcSend("providers.deleteCredential", { providerId });
      await load(true);
      showToast("success", `Removed ${providerId} credential`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProviderId(null);
    }
  };

  const onLogin = async (providerId: string): Promise<void> => {
    try {
      setBusyProviderId(providerId);
      await rpcSend(
        providerId === "codex" ? "auth.codex-login" : "auth.anthropic-login",
        {},
      );
      await load(true);
      showToast("success", `Signed in to ${providerId}`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProviderId(null);
    }
  };

  const providers = useMemo(() => snapshot?.providers ?? [], [snapshot]);

  return (
    <div className="flex flex-col gap-4">
      <Header
        lastRefreshedAt={snapshot?.lastRefreshedAt ?? 0}
        onRefresh={onRefresh}
        loading={loading}
      />
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#FF453A]/40 bg-[#FF453A]/10 px-4 py-3 text-sm text-[#FF453A]"
        >
          {error}
        </div>
      )}
      {toast && (
        <div
          role="alert"
          className={`rounded-xl px-4 py-3 text-sm ${
            toast.kind === "success"
              ? "border border-[#30D158]/40 bg-[#30D158]/10 text-[#30D158]"
              : "border border-[#FF453A]/40 bg-[#FF453A]/10 text-[#FF453A]"
          }`}
        >
          {toast.text}
        </div>
      )}
      {loading && providers.length === 0 ? (
        <Skeleton />
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              active={snapshot?.active?.provider === p.id ? snapshot.active.model : null}
              busy={busyProviderId === p.id}
              onSaveKey={(key) => onSaveKey(p.id, key)}
              onTest={() => onTest(p.id)}
              onRemove={() => onRemove(p.id)}
              onLogin={() => onLogin(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Header(props: {
  lastRefreshedAt: number;
  onRefresh: () => void | Promise<void>;
  loading: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-[17px] font-semibold text-white">Providers</h2>
        <p className="text-[13px] text-[#EBEBF5]/60">
          {props.lastRefreshedAt > 0
            ? `Last refreshed ${formatRefreshed(props.lastRefreshedAt)}`
            : "Run discovery to populate the list"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void props.onRefresh()}
        disabled={props.loading}
        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        {props.loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

function ProviderCard(props: {
  provider: SnapshotProvider;
  active: string | null;
  busy: boolean;
  onSaveKey: (key: string) => void | Promise<void>;
  onTest: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onLogin: () => void | Promise<void>;
}): JSX.Element {
  const { provider, busy } = props;
  const [apiKey, setApiKey] = useState("");
  const [expanded, setExpanded] = useState(false);
  const supportsOauth =
    provider.supportedMethods.includes("oauth") ||
    provider.supportedMethods.includes("subscription");
  const supportsApiKey = provider.supportedMethods.includes("apiKey");

  return (
    <div className="rounded-2xl border border-white/10 bg-[#1C1C1E] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold text-white">{provider.name}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_COLORS[provider.tier]}`}
            >
              {TIER_LABELS[provider.tier]}
            </span>
            {provider.configured ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#30D158]/30 bg-[#30D158]/10 px-2 py-0.5 text-[11px] font-medium text-[#30D158]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#30D158]" />
                Configured
              </span>
            ) : (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#EBEBF5]/60">
                Not configured
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#EBEBF5]/60">
            {provider.credentialLabel && (
              <span>
                {provider.credentialLabel}
                {provider.credentialSource && provider.credentialSource !== "keychain"
                  ? ` · via ${provider.credentialSource}`
                  : ""}
              </span>
            )}
            <span>{provider.models.length} models</span>
            {provider.defaultModel && <span className="font-mono">{provider.defaultModel}</span>}
            {provider.lastError && (
              <span className="text-[#FF9F0A]" title={provider.lastError}>
                ⚠ error
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {provider.configured && (
            <button
              type="button"
              onClick={() => void props.onTest()}
              disabled={busy}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-white hover:bg-white/10 disabled:opacity-50"
            >
              Test
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-white hover:bg-white/10"
            aria-expanded={expanded}
          >
            {expanded ? "Close" : provider.configured ? "Manage" : "Configure"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
          {supportsOauth && (provider.id === "anthropic" || provider.id === "codex") && (
            <div className="flex items-center justify-between rounded-xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 px-4 py-3">
              <div>
                <p className="text-[14px] font-medium text-white">
                  {provider.id === "anthropic"
                    ? "Sign in with Claude Max"
                    : "Sign in with ChatGPT Plus/Pro"}
                </p>
                <p className="text-[12px] text-[#EBEBF5]/60">
                  One-click — reuses your existing subscription.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void props.onLogin()}
                disabled={busy}
                className="rounded-full bg-[#0A84FF] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#0073E6] disabled:opacity-50"
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </div>
          )}

          {supportsApiKey && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (apiKey.trim().length > 0) {
                  void props.onSaveKey(apiKey);
                  setApiKey("");
                }
              }}
              className="flex flex-col gap-2"
            >
              <label className="text-[12px] font-medium text-[#EBEBF5]/80">
                API key{" "}
                {provider.envKeys[0] && (
                  <span className="font-mono text-[10px] text-[#EBEBF5]/60">
                    ({provider.envKeys[0]})
                  </span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  className="flex-1 rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-[13px] text-white placeholder-[#EBEBF5]/30 focus:border-[#0A84FF] focus:outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  disabled={busy || apiKey.trim().length === 0}
                  className="rounded-lg bg-[#0A84FF] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#0073E6] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
              {provider.docsUrl && (
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-[#0A84FF] hover:underline"
                >
                  Get an API key →
                </a>
              )}
            </form>
          )}

          {provider.models.length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-[#EBEBF5]/80">Available models</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {provider.models.slice(0, 12).map((m) => (
                  <span
                    key={m.id}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${
                      props.active === m.id
                        ? "border-[#0A84FF] bg-[#0A84FF]/20 text-[#0A84FF]"
                        : "border-white/10 bg-white/5 text-[#EBEBF5]/80"
                    }`}
                    title={`${m.contextWindow.toLocaleString()} ctx · $${m.costPerMTokInput}/M in · $${m.costPerMTokOutput}/M out`}
                  >
                    {m.name}
                  </span>
                ))}
                {provider.models.length > 12 && (
                  <span className="text-[11px] text-[#EBEBF5]/50">
                    +{provider.models.length - 12} more
                  </span>
                )}
              </div>
            </div>
          )}

          {provider.configured && (
            <button
              type="button"
              onClick={() => void props.onRemove()}
              disabled={busy}
              className="self-start rounded-full border border-[#FF453A]/40 bg-[#FF453A]/10 px-3 py-1.5 text-[12px] text-[#FF453A] hover:bg-[#FF453A]/20 disabled:opacity-50"
            >
              Remove credential
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Skeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-white/10 bg-[#1C1C1E]/60"
        />
      ))}
    </div>
  );
}
