/**
 * Capability Chips with Provenance Glyphs.
 *
 * Design spec §4.4 (UI_DESIGN_SPEC_2026-04-16): every assistant message header
 * displays a chip strip showing the exact stack that produced it:
 *   - Provider chip: `[Opus ◈ 1M]` gold stroke for paid, moss for local
 *   - Augmentation chips: `[🜂 vision]`, `[🜃 thinking]`, `[🜄 tools]` using
 *     alchemical sigils to denote capability-augmenter injections
 *   - Cost chip: `$0.08` or `$0 (Ollama)` in hearthgold
 *   - Shadow-git chip: `[⚒ 7a3f2]` truncated SHA with scrubber affordance
 *
 * This replaces the common ChatGPT-style "GPT-4" plain-text header with a
 * dense, informative, visually distinct strip that makes the harness's
 * work legible.
 */

import type { JSX } from "react";
import { color } from "../../design/tokens.generated";

export interface CapabilityChipsProps {
  /** Provider that produced this message. */
  readonly provider: string;
  /** Model id (e.g. "claude-opus-4-7"). */
  readonly model: string;
  /** Whether the provider is a free-tier / local model. Gold for paid, moss for local. */
  readonly localOrFree?: boolean;
  /** Context window size in tokens (e.g. 1_000_000). Formatted as "1M". */
  readonly contextWindow?: number;
  /** Which capabilities were *injected* by the capability-augmenter vs native. */
  readonly augmentations?: {
    readonly vision?: boolean;
    readonly thinking?: boolean;
    readonly tools?: boolean;
  };
  /** Native capabilities this provider+model had without augmentation. */
  readonly native?: {
    readonly vision?: boolean;
    readonly thinking?: boolean;
    readonly tools?: boolean;
  };
  /** USD cost of the turn. Undefined to hide. */
  readonly costUsd?: number;
  /** Short shadow-git commit SHA (first 5 chars). Undefined to hide. */
  readonly shadowGitSha?: string;
  /** Fired when the shadow-git chip is clicked — scrubber affordance. */
  readonly onShadowGitScrub?: () => void;
  /** Optional className for layout hooks. */
  readonly className?: string;
}

/** Alchemical sigils per design spec §4.4. */
const SIGIL_VISION = "🜂";   // alchemical fire — vision
const SIGIL_THINKING = "🜃"; // alchemical earth — thinking
const SIGIL_TOOLS = "🜄";    // alchemical water — tools
const SIGIL_SHADOW_GIT = "⚒"; // hammer and pick — forge / commit

function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${usd.toFixed(2)}`;
}

export function CapabilityChips(props: CapabilityChipsProps): JSX.Element {
  const {
    provider,
    model,
    localOrFree = false,
    contextWindow,
    augmentations,
    native,
    costUsd,
    shadowGitSha,
    onShadowGitScrub,
    className,
  } = props;

  const providerColor = localOrFree ? color("success") : color("warning");
  const providerLabel = `${model}${contextWindow ? ` ◈ ${formatContextWindow(contextWindow)}` : ""}`;

  const chipBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: "var(--radius-xs)",
    lineHeight: "18px",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.01em",
  };

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--wotann-font-sans, 'Inter Variable', system-ui)",
      }}
      role="group"
      aria-label="Response provenance"
    >
      {/* Provider chip */}
      <span
        style={{
          ...chipBase,
          color: providerColor,
          border: `1px solid ${providerColor}`,
          background: localOrFree
            ? "rgba(76, 195, 138, 0.08)"
            : "rgba(255, 168, 67, 0.08)",
        }}
        title={`Provider: ${provider}`}
      >
        <span style={{ opacity: 0.85, textTransform: "lowercase" }}>{provider}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{providerLabel}</span>
      </span>

      {/* Augmentation chips — render ONLY when augmenter injected the capability
          (i.e., augmentations[cap] === true AND native[cap] !== true), so the
          chip carries real information: "this capability was synthesised for
          a provider that didn't have it natively". */}
      {augmentations?.vision && !native?.vision && (
        <AugmentationChip sigil={SIGIL_VISION} label="vision" title="Vision via OCR + a11y tree (capability-augmenter)" />
      )}
      {augmentations?.thinking && !native?.thinking && (
        <AugmentationChip sigil={SIGIL_THINKING} label="thinking" title="Step-by-step thinking prompt (capability-augmenter)" />
      )}
      {augmentations?.tools && !native?.tools && (
        <AugmentationChip sigil={SIGIL_TOOLS} label="tools" title="XML tool-call emulation (capability-augmenter)" />
      )}

      {/* Cost chip */}
      {typeof costUsd === "number" && (
        <span
          style={{
            ...chipBase,
            color: localOrFree
              ? color("success")
              : color("warning"),
            background: localOrFree
              ? "rgba(76, 195, 138, 0.08)"
              : "rgba(255, 168, 67, 0.08)",
            border: "1px solid transparent",
          }}
          title={localOrFree ? "Free / local model" : "Turn cost in USD"}
        >
          {formatCost(costUsd)}
          {localOrFree && costUsd === 0 ? <span style={{ opacity: 0.7, fontSize: 10 }}>&nbsp;(local)</span> : null}
        </span>
      )}

      {/* Shadow-git chip — scrub affordance */}
      {shadowGitSha && (
        <button
          type="button"
          onClick={onShadowGitScrub}
          disabled={!onShadowGitScrub}
          style={{
            ...chipBase,
            color: color("muted"),
            background: "rgba(138, 176, 224, 0.06)",
            border: "1px solid rgba(138, 176, 224, 0.12)",
            cursor: onShadowGitScrub ? "pointer" : "default",
            font: "inherit",
          }}
          title={onShadowGitScrub ? `Scrub shadow-git checkpoint ${shadowGitSha}` : `Shadow-git checkpoint ${shadowGitSha}`}
          aria-label={`Shadow-git checkpoint ${shadowGitSha}${onShadowGitScrub ? ". Click to scrub." : ""}`}
        >
          <span aria-hidden="true" style={{ fontSize: 11 }}>{SIGIL_SHADOW_GIT}</span>
          <span style={{ fontFamily: "var(--wotann-font-mono, 'JetBrains Mono', ui-monospace)" }}>{shadowGitSha}</span>
        </button>
      )}
    </div>
  );
}

function AugmentationChip({
  sigil,
  label,
  title,
}: {
  sigil: string;
  label: string;
  title: string;
}): JSX.Element {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: "var(--radius-xs)",
        lineHeight: "18px",
        whiteSpace: "nowrap",
        color: color("toolMessage"),
        background: "rgba(102, 217, 239, 0.08)",
        border: "1px dashed rgba(102, 217, 239, 0.25)",
      }}
      title={title}
      aria-label={`${label} augmentation (emulated, not native)`}
    >
      <span aria-hidden="true">{sigil}</span>
      <span>{label}</span>
    </span>
  );
}
