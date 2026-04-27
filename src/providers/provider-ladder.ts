/**
 * Canonical provider priority ladder — V9 Tier 6 T6.4.
 *
 * When a user runs `wotann init` with nothing configured, WOTANN walks
 * this ladder top-down and picks the first available option. The
 * ordering reflects V9's subscription-first strategy:
 *
 *   1. Subscription providers (zero marginal cost to user)
 *   2. Free-tier cloud APIs (no credit card)
 *   3. BYOK cloud APIs (pay-per-token)
 *   4. Local models (fully private)
 *
 * The ladder is a PURE DATA STRUCTURE — no side effects. Callers query
 * it via `selectFirstAvailable(availability)` where the availability map
 * is built by the onboarding wizard's detector passes. The detector
 * decisions live in `hardware-detect.ts` (local feasibility),
 * `claude-cli-backend.ts` (Claude CLI presence), and similar.
 *
 * NOTE (V9 Wave 6.9 / W6.9 AH): the LM Studio rung's `probe` key
 * `lm-studio-local` is a hook for a future detector. The dedicated
 * `lm-studio-adapter.ts` was deleted as a dead orphan — per the user
 * directive captured in `first-run-runner-factory.ts:37`, local rungs
 * go through the generic OpenAI-compat path (Ollama by default). If
 * an LM Studio detector ever lands, point it at the openai-compat
 * adapter with `baseUrl=http://localhost:1234/v1` and a sentinel
 * apiKey — no bespoke adapter required.
 *
 * WOTANN quality bars:
 * - QB #7 per-call state: the ladder is a `readonly` const. The
 *   caller builds a fresh availability snapshot every time.
 * - QB #11 sibling-site scan: consumers will be the Ink wizard
 *   (T6.2) + a CLI flag-less `wotann init` default. Neither wired
 *   yet; this module ships the data first so both consumers can
 *   use it when their scope lands.
 */

import type { ProviderName } from "../core/types.js";

// ── Rung types ────────────────────────────────────────────────────────────

export type ProviderRungCategory =
  | "subscription"
  | "free-tier"
  | "free-aggregator"
  | "byok"
  | "local"
  | "advanced";

/**
 * One rung on the ladder. `id` is WOTANN's canonical provider name
 * (the string used throughout the registry + cost tracker). `probe`
 * is the key a caller looks up in the availability map — kept as
 * string so detectors can report arbitrary capability keys without
 * polluting `ProviderName`.
 */
export interface ProviderRung {
  readonly rank: number;
  readonly id: ProviderName;
  readonly probe: string;
  readonly category: ProviderRungCategory;
  readonly label: string;
  /** Human-readable cost summary for the onboarding UI. */
  readonly costNote: string;
  /**
   * True when this rung can be selected WITHOUT a credit card.
   * Used by the onboarding wizard's "free options only" filter.
   */
  readonly noCreditCard: boolean;
  /**
   * True when this rung runs ENTIRELY on-device — never sends data
   * to a third party. Used by "fully private" filter.
   */
  readonly fullyLocal: boolean;
}

// ── The ladder ────────────────────────────────────────────────────────────

/**
 * Source-verified V9 T6.4 ordering. Each rung's `rank` is the
 * priority order the wizard walks top-down; first rung with
 * `availability[rung.probe] === true` is selected.
 */
export const PROVIDER_LADDER: readonly ProviderRung[] = [
  {
    rank: 1,
    id: "anthropic",
    probe: "claude-cli",
    category: "subscription",
    label: "Claude Max/Pro (via Claude Code CLI)",
    costNote: "subscription ($20-200/mo), no per-query cost",
    noCreditCard: false,
    fullyLocal: false,
  },
  {
    rank: 2,
    id: "codex",
    probe: "codex-cli",
    category: "subscription",
    label: "ChatGPT Plus/Pro (via Codex CLI session)",
    costNote: "subscription ($20-60/mo), uses existing login",
    noCreditCard: false,
    fullyLocal: false,
  },
  {
    rank: 3,
    id: "copilot",
    probe: "gh-token",
    category: "subscription",
    label: "GitHub Copilot",
    costNote: "Free tier (2K completions/mo) or $10-39/mo paid",
    noCreditCard: true, // free tier
    fullyLocal: false,
  },
  {
    rank: 4,
    id: "openrouter",
    probe: "groq-free",
    category: "free-tier",
    label: "Groq free tier (Llama 3.3 70B @ 315 tok/s)",
    costNote: "1000 req/day free, no CC",
    noCreditCard: true,
    fullyLocal: false,
  },
  {
    rank: 5,
    id: "gemini",
    probe: "gemini-free",
    category: "free-tier",
    label: "Gemini free tier (1.5M token context)",
    costNote: "1500 req/day free, no CC",
    noCreditCard: true,
    fullyLocal: false,
  },
  {
    rank: 6,
    id: "openrouter",
    probe: "cerebras-free",
    category: "free-tier",
    label: "Cerebras free tier (fast inference)",
    costNote: "60K tokens/min free, no CC",
    noCreditCard: true,
    fullyLocal: false,
  },
  {
    rank: 7,
    id: "openrouter",
    probe: "deepseek-free",
    category: "free-tier",
    label: "DeepSeek (500K free/day + paid)",
    costNote: "500K tokens/day free, then $0.14/M cached",
    noCreditCard: true,
    fullyLocal: false,
  },
  {
    rank: 8,
    id: "anthropic",
    probe: "anthropic-byok",
    category: "byok",
    label: "Anthropic API (BYOK)",
    costNote: "pay-per-token, $3-15 per million",
    noCreditCard: false,
    fullyLocal: false,
  },
  {
    rank: 9,
    id: "openai",
    probe: "openai-byok",
    category: "byok",
    label: "OpenAI API (BYOK)",
    costNote: "pay-per-token, $2.50-$60 per million depending on model",
    noCreditCard: false,
    fullyLocal: false,
  },
  {
    rank: 10,
    id: "ollama",
    probe: "ollama-local",
    category: "local",
    label: "Ollama (local, private)",
    costNote: "free, runs on your machine",
    noCreditCard: true,
    fullyLocal: true,
  },
  // V9 §T6.4 — OpenRouter is a BYOK aggregator that rotates a small
  // free-tier across third-party hosts (Mistral 7B Instruct,
  // Llama 3.1 8B, Gemma 2 9B, etc.). Spec line 1037 listed it at
  // rank 11 — we keep it at #11 here so the wizard prefers a
  // free-aggregator rung BEFORE LM-Studio's local model (which
  // requires a 4-8 GB local model already downloaded). The rung is
  // tagged with the bespoke `free-aggregator` category so the
  // grouping UI keeps it distinct from single-provider free tiers.
  {
    rank: 11,
    id: "openrouter" as ProviderName,
    probe: "openrouter-free",
    category: "free-aggregator",
    label: "OpenRouter (free aggregator — Mistral 7B, Llama 3.1 8B, Gemma 2 9B)",
    costNote: "rotating free tier, no CC; paid models behind the same key",
    noCreditCard: true,
    fullyLocal: false,
  },
  {
    rank: 12,
    id: "lm-studio" as ProviderName,
    probe: "lm-studio-local",
    category: "local",
    label: "LM Studio (local, private)",
    costNote: "free, runs on your machine",
    noCreditCard: true,
    fullyLocal: true,
  },
] as const;

// ── Selection ─────────────────────────────────────────────────────────────

/**
 * Availability snapshot built by the onboarding wizard. Map from a
 * rung's `probe` string to boolean — `true` means the rung's
 * prerequisites are satisfied (binary present / API key set /
 * server responding on expected port).
 */
export type ProviderAvailability = Readonly<Record<string, boolean>>;

/**
 * Walk the ladder top-down and return the first rung whose `probe`
 * key is `true` in the availability map. Returns `null` when nothing
 * on the ladder is available (caller shows "no providers available —
 * here are install links").
 */
export function selectFirstAvailable(availability: ProviderAvailability): ProviderRung | null {
  for (const rung of PROVIDER_LADDER) {
    if (availability[rung.probe] === true) return rung;
  }
  return null;
}

/**
 * Filter the ladder down to rungs that satisfy the user's declared
 * constraints. Used by the wizard's "show me only free options" /
 * "show me only local options" toggles.
 */
export function filterLadder(
  filters: {
    readonly noCreditCardOnly?: boolean;
    readonly fullyLocalOnly?: boolean;
    readonly categories?: readonly ProviderRungCategory[];
  } = {},
): readonly ProviderRung[] {
  return PROVIDER_LADDER.filter((r) => {
    if (filters.noCreditCardOnly && !r.noCreditCard) return false;
    if (filters.fullyLocalOnly && !r.fullyLocal) return false;
    if (filters.categories && !filters.categories.includes(r.category)) return false;
    return true;
  });
}

/**
 * Group the ladder by category — the wizard displays rungs under
 * headings ("Subscriptions", "Free cloud", "BYOK", "Local",
 * "Advanced"). Preserves rank order within each category.
 */
export function groupByCategory(): Readonly<Record<ProviderRungCategory, readonly ProviderRung[]>> {
  const groups: Record<ProviderRungCategory, ProviderRung[]> = {
    subscription: [],
    "free-tier": [],
    "free-aggregator": [],
    byok: [],
    local: [],
    advanced: [],
  };
  for (const r of PROVIDER_LADDER) {
    groups[r.category].push(r);
  }
  return groups;
}
