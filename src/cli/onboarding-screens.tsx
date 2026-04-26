/**
 * Onboarding wizard screens — V9 Tier 6 T6.2.
 *
 * The 5-screen Ink TUI that wotann init renders the first time a user
 * runs WOTANN with nothing configured. Built on top of the headless
 * modules shipped in T6.1/T6.3/T6.4/T6.5/T6.6:
 *
 *   T6.1 `hardware-detect.ts`   — tier classification shown on screen 1
 *   T6.3 `lm-studio-adapter.ts` — async probe folded into availability
 *   T6.4 `provider-ladder.ts`   — 12-rung ladder driving screen 3
 *   T6.5 `config-migration.ts`  — legacy-config notice on screen 4
 *   T6.6 `first-run-success.ts` — live streaming on screen 5
 *
 * ── Screen sequence ───────────────────────────────────────────────────────
 *   1. Welcome    — ASCII banner + detected hardware tier
 *   2. Strategy   — 5 strategy options (matches V9 mock-up)
 *   3. Pick       — specific rung within the chosen category
 *   4. Confirm    — review choice + legacy-migration notice
 *   5. FirstRun   — runFirstRunSuccess streams into a live viewport
 *
 * ── How it wires in ───────────────────────────────────────────────────────
 * The CLI entrypoint (wotann init) probes providers async ONCE, then
 * mounts `<OnboardingApp>` with a pre-built `ProviderAvailability`
 * snapshot + hardware profile + a FirstRunQueryRunner the wizard uses
 * when the user reaches screen 5. Every dependency is injected — no
 * module-level state, no `process.*` reads inside components.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────────────
 *  - QB #6 honest failures: FirstRunScreen renders `roundtrip-failed`
 *    as a distinct visual branch with the reason + a retry hint.
 *  - QB #7 per-session state: all state lives in React state; no
 *    module-level caches or stores; wizard is safe to mount twice
 *    in the same process (tests do that).
 *  - QB #13 env guard: `buildAvailabilityFromEnv` accepts an env
 *    snapshot; never reads `process.env` directly inside the wizard.
 *  - QB #11 sibling-site scan: the legacy onboarding.ts is preserved
 *    (chalk-based, procedural). Callers can pick either surface; the
 *    V9 T6.2 wizard is additive, not a replacement.
 */

import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { HardwareProfile, HardwareTier } from "../core/hardware-detect.js";
import type {
  ProviderAvailability,
  ProviderRung,
  ProviderRungCategory,
} from "../providers/provider-ladder.js";
import { PROVIDER_LADDER, selectFirstAvailable } from "../providers/provider-ladder.js";
import type { FirstRunQueryRunner } from "./first-run-success.js";
import type { MigrationPlan } from "../core/config-migration.js";
import { FirstRunScreen } from "./onboarding-screens/first-run-screen.js";
import { DoneScreen } from "./onboarding-screens/done-screen.js";
// SB-07 dual-auth banner — clearly-separated additive surface owned
// by the SB-07 wave. See src/auth/auth-mode.ts for the policy basis.
import { AuthModeBanner } from "./components/AuthModeBanner.js";
import type { AuthMode } from "../auth/auth-mode.js";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * Top-level strategies the welcome screen asks the user to pick
 * between. Each strategy maps to one or more ladder categories — the
 * wizard's screen 3 then shows the top rungs from those categories.
 *
 *   "auto"    — Wave 1-F: walk the canonical provider ladder and pick
 *               the first available rung. If a rung resolves we
 *               short-circuit to confirm; otherwise the wizard falls
 *               through to the manual pick screen (showing the full
 *               ladder so the user can install/select a fallback).
 *   "app"     — subscriptions via detected CLIs (Claude Code / Codex)
 *   "byok"    — paste an API key they already have
 *   "free"    — sign up for a 30-second free tier
 *   "local"   — run on-device (Ollama / LM Studio)
 *   "later"   — skip setup; record the demo-mode flag and exit
 *
 * The mapping lives in `categoriesForStrategy()` so screen 3 can just
 * call `filterLadder({categories})` against the ladder.
 */
export type OnboardingStrategy = "auto" | "app" | "byok" | "free" | "local" | "later";

export interface StrategyChoice {
  readonly key: OnboardingStrategy;
  readonly label: string;
  readonly hint: string;
}

/**
 * Env snapshot — explicit instead of `process.env` reads so the
 * wizard's availability computation is a pure function callers can
 * test with a fixture. Values are boolean for presence checks; the
 * actual key strings never leave the CLI process.
 */
export interface OnboardingEnvFlags {
  readonly claudeCliAvailable: boolean;
  readonly codexCliAvailable: boolean;
  readonly hasGhToken: boolean;
  readonly hasAnthropicKey: boolean;
  readonly hasOpenAiKey: boolean;
  readonly hasGroqKey: boolean;
  readonly hasGeminiKey: boolean;
  readonly hasCerebrasKey: boolean;
  readonly hasDeepseekKey: boolean;
  readonly hasOpenRouterKey: boolean;
  readonly ollamaReachable: boolean;
  readonly lmStudioReachable: boolean;
}

// ═══ Pure helpers (testable without mounting Ink) ═════════════════════════

/**
 * Fold the env-flag snapshot + probe results into a ProviderAvailability
 * map the ladder's `selectFirstAvailable` / `filterLadder` can consume.
 * Every ladder probe key maps to one boolean in the snapshot.
 */
export function buildAvailabilityFromEnv(flags: OnboardingEnvFlags): ProviderAvailability {
  return {
    "claude-cli": flags.claudeCliAvailable,
    "codex-cli": flags.codexCliAvailable,
    "gh-token": flags.hasGhToken,
    "groq-free": flags.hasGroqKey,
    "gemini-free": flags.hasGeminiKey,
    "cerebras-free": flags.hasCerebrasKey,
    "deepseek-free": flags.hasDeepseekKey,
    "anthropic-byok": flags.hasAnthropicKey,
    "openai-byok": flags.hasOpenAiKey,
    "ollama-local": flags.ollamaReachable,
    "lm-studio-local": flags.lmStudioReachable,
    "openrouter-free": flags.hasOpenRouterKey,
  };
}

/**
 * Map a strategy to the ladder categories screen 3 should show. Two
 * strategies cross category lines — "app" covers subscriptions only,
 * while "free" spans both free-tier and BYOK-free-tier rungs.
 */
export function categoriesForStrategy(
  strategy: OnboardingStrategy,
): readonly ProviderRungCategory[] {
  switch (strategy) {
    case "auto":
      // Wave 1-F: when auto-resolution fails the wizard drops the user
      // on the pick screen with strategy=auto. Show the full ladder
      // (every non-empty category) so they can hand-pick anything.
      return ["subscription", "free-tier", "free-aggregator", "byok", "local", "advanced"];
    case "app":
      return ["subscription"];
    case "byok":
      return ["byok"];
    case "free":
      return ["free-tier"];
    case "local":
      return ["local"];
    case "later":
      return [];
  }
}

/**
 * Flatten the ladder down to the rungs for the selected strategy,
 * keeping the canonical ladder order (rank ascending).
 */
export function rungsForStrategy(strategy: OnboardingStrategy): readonly ProviderRung[] {
  const cats = categoriesForStrategy(strategy);
  if (cats.length === 0) return [];
  return PROVIDER_LADDER.filter((r) => cats.includes(r.category));
}

/**
 * Short label that describes the user's detected hardware tier in one
 * sentence the welcome screen renders under the ASCII banner. The
 * phrasing mirrors the V9 T6.2 mock-up ("Local-model tier: HIGH...").
 */
export function formatHardwareSummary(profile: HardwareProfile): string {
  const tierBlurb: Record<HardwareTier, string> = {
    "cloud-only": "cloud-only recommended",
    low: "small local models OK (≤3B)",
    medium: "7B-13B at Q4-Q6 feasible",
    high: "13-27B models feasible",
    extreme: "27B+ or 70B at Q4 feasible",
  };
  return `Local-model tier: ${profile.tier.toUpperCase()} (${tierBlurb[profile.tier]})`;
}

/**
 * Strategy list shown on screen 2.
 *
 * Wave 1-F (GA-03 closure): the "auto" choice is now first so the
 * fast-path keyboard muscle-memory is "Enter, Enter" — pick auto,
 * confirm whatever the ladder resolved. The remaining 5 strategies
 * preserve their previous V9 ordering for users who want explicit
 * control.
 */
export const STRATEGY_CHOICES: readonly StrategyChoice[] = [
  {
    key: "auto",
    label: "Auto-pick the best available provider",
    hint: "Walks the canonical ladder (subscription -> free -> BYOK -> local) and picks the first that works",
  },
  {
    key: "app",
    label: "Connect an official AI app I already have",
    hint: "Compliant, free — Claude Code / OpenAI Codex / Copilot",
  },
  {
    key: "byok",
    label: "Paste an API key I already have (BYOK)",
    hint: "Pay-per-token; Anthropic, OpenAI",
  },
  {
    key: "free",
    label: "Sign up for a free tier in 30 seconds",
    hint: "Groq, Gemini, Cerebras, DeepSeek — no credit card",
  },
  {
    key: "local",
    label: "Run a local model (fully private)",
    hint: "Ollama or any OpenAI-compatible local server — on-device, no data leaves machine",
  },
  {
    key: "later",
    label: "I'll configure later (demo mode)",
    hint: "Skip setup; read-only tour of WOTANN until configured",
  },
];

/**
 * The wizard is a small state machine. Each step renders a different
 * screen component; the reducer centralizes transitions so both the
 * Ink components AND tests advance through the flow the same way.
 */
export type WizardStep =
  | { readonly kind: "welcome" }
  | { readonly kind: "strategy" }
  | { readonly kind: "pick"; readonly strategy: OnboardingStrategy }
  | {
      readonly kind: "confirm";
      readonly strategy: OnboardingStrategy;
      readonly rung: ProviderRung | null;
    }
  | {
      readonly kind: "firstRun";
      readonly strategy: OnboardingStrategy;
      readonly rung: ProviderRung;
    }
  | {
      readonly kind: "done";
      readonly strategy: OnboardingStrategy;
      readonly rung: ProviderRung | null;
      readonly reason: "success" | "skip" | "failed";
      readonly failureReason?: string;
    };

export type WizardAction =
  | { readonly type: "next-from-welcome" }
  | {
      readonly type: "pick-strategy";
      readonly strategy: OnboardingStrategy;
      /**
       * Wave 1-F: when strategy === "auto", callers pre-resolve the
       * canonical ladder (via `selectFirstAvailable`) and pass the
       * winning rung here. A non-null rung short-circuits to confirm;
       * `null` means auto failed and the wizard falls through to the
       * manual pick screen so the user can install/configure a
       * provider. Other strategies ignore this field.
       */
      readonly autoResolvedRung?: ProviderRung | null;
    }
  | { readonly type: "pick-rung"; readonly rung: ProviderRung | null }
  | { readonly type: "confirm" }
  | {
      readonly type: "finish";
      readonly reason: "success" | "failed";
      readonly failureReason?: string;
    }
  | { readonly type: "back" };

/**
 * Pure reducer — drives the state machine without touching Ink. Tests
 * mount `reduceWizard` in isolation and verify transitions without
 * spinning up a terminal.
 */
export function reduceWizard(state: WizardStep, action: WizardAction): WizardStep {
  switch (action.type) {
    case "next-from-welcome":
      return { kind: "strategy" };
    case "pick-strategy":
      if (action.strategy === "later") {
        return { kind: "done", strategy: "later", rung: null, reason: "skip" };
      }
      // Wave 1-F: "auto" strategy short-circuits when the caller has
      // already resolved a rung via the canonical ladder. A null
      // resolved rung (no provider available) falls through to the
      // manual pick screen so the user can install something.
      if (action.strategy === "auto" && action.autoResolvedRung !== undefined) {
        if (action.autoResolvedRung !== null) {
          return {
            kind: "confirm",
            strategy: "auto",
            rung: action.autoResolvedRung,
          };
        }
        return { kind: "pick", strategy: "auto" };
      }
      return { kind: "pick", strategy: action.strategy };
    case "pick-rung":
      if (state.kind !== "pick") return state;
      return { kind: "confirm", strategy: state.strategy, rung: action.rung };
    case "confirm":
      if (state.kind !== "confirm") return state;
      if (state.rung === null) {
        return {
          kind: "done",
          strategy: state.strategy,
          rung: null,
          reason: "skip",
        };
      }
      return {
        kind: "firstRun",
        strategy: state.strategy,
        rung: state.rung,
      };
    case "finish":
      if (state.kind !== "firstRun") return state;
      return {
        kind: "done",
        strategy: state.strategy,
        rung: state.rung,
        reason: action.reason,
        failureReason: action.failureReason,
      };
    case "back":
      if (state.kind === "strategy") return { kind: "welcome" };
      if (state.kind === "pick") return { kind: "strategy" };
      if (state.kind === "confirm") {
        return { kind: "pick", strategy: state.strategy };
      }
      return state;
  }
}

// ═══ Screen components ════════════════════════════════════════════════════

interface WelcomeScreenProps {
  readonly hardware: HardwareProfile;
  readonly onNext: () => void;
  readonly onCancel: () => void;
}

function WelcomeScreen({ hardware, onNext, onCancel }: WelcomeScreenProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) onNext();
    else if (key.escape) onCancel();
  });
  // Norse rune flourish — same Ask/Relay/Autopilot mark used by the
  // runtime TUI so the visual language carries between onboarding
  // and the chat surface.
  const RUNES = "ᚠ  ᚱ  ᛉ";
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Text color="cyan" bold>
              {RUNES}
            </Text>
            <Text color="cyan" bold>
              Welcome to WOTANN
            </Text>
          </Box>
          <Text dimColor>setup wizard</Text>
        </Box>
        <Text dimColor>Unified Agent Harness · Ask · Relay · Autopilot</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          Detected: <Text bold>{hardware.accelerator.label}</Text>, {hardware.ramGb} GB RAM
        </Text>
        <Text dimColor>{formatHardwareSummary(hardware)}</Text>
        <Text dimColor>
          Platform: {hardware.platform} · {hardware.cpuCount} cores · {hardware.cpuModel}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>WOTANN will walk you through picking a provider in &lt;90 seconds.</Text>
        <Box gap={1} marginTop={1}>
          <Text color="cyan" bold>
            Enter
          </Text>
          <Text dimColor>continue</Text>
          <Text dimColor>·</Text>
          <Text color="cyan" bold>
            Esc
          </Text>
          <Text dimColor>exit</Text>
        </Box>
      </Box>
    </Box>
  );
}

interface StrategyScreenProps {
  readonly hardware: HardwareProfile;
  readonly availability: ProviderAvailability;
  readonly onPick: (s: OnboardingStrategy) => void;
  readonly onBack: () => void;
}

function StrategyScreen({ availability, onPick, onBack }: StrategyScreenProps): React.ReactElement {
  const [selected, setSelected] = React.useState(0);

  const strategyHasAny = React.useMemo(() => {
    const map: Record<OnboardingStrategy, boolean> = {
      auto: false,
      app: false,
      byok: false,
      free: false,
      local: false,
      later: true,
    };
    for (const rung of PROVIDER_LADDER) {
      if (availability[rung.probe]) {
        // Wave 1-F: any available rung makes "auto" eligible.
        map.auto = true;
        if (rung.category === "subscription") map.app = true;
        else if (rung.category === "byok") map.byok = true;
        else if (rung.category === "free-tier") map.free = true;
        else if (rung.category === "local") map.local = true;
      }
    }
    return map;
  }, [availability]);

  useInput((input, key) => {
    if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelected((p) => Math.min(STRATEGY_CHOICES.length - 1, p + 1));
    else if (key.return) {
      const choice = STRATEGY_CHOICES[selected];
      if (choice) onPick(choice.key);
    } else if (key.escape) onBack();
    else {
      const n = Number(input);
      if (Number.isFinite(n) && n >= 1 && n <= STRATEGY_CHOICES.length) {
        const choice = STRATEGY_CHOICES[n - 1];
        if (choice) onPick(choice.key);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>How do you want WOTANN to talk to a model?</Text>
      <Box flexDirection="column" marginTop={1}>
        {STRATEGY_CHOICES.map((choice, i) => {
          const active = i === selected;
          const available = strategyHasAny[choice.key];
          const marker = available ? "●" : "○";
          const markerColor = available ? "green" : "yellow";
          return (
            <Box
              key={choice.key}
              flexDirection="column"
              marginBottom={i < STRATEGY_CHOICES.length - 1 ? 1 : 0}
            >
              <Box gap={1}>
                <Text color={active ? "cyan" : "gray"}>{active ? ">" : " "}</Text>
                <Text color={markerColor}>{marker}</Text>
                <Text bold={active}>
                  [{i + 1}] {choice.label}
                </Text>
              </Box>
              <Box paddingLeft={4}>
                <Text dimColor>
                  {choice.hint}
                  {!available && choice.key !== "later" ? " — none detected" : ""}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ to move · Enter to select · 1-6 to jump · Esc to go back</Text>
      </Box>
    </Box>
  );
}

interface ProviderPickScreenProps {
  readonly strategy: OnboardingStrategy;
  readonly availability: ProviderAvailability;
  readonly onPick: (rung: ProviderRung | null) => void;
  readonly onBack: () => void;
}

function ProviderPickScreen({
  strategy,
  availability,
  onPick,
  onBack,
}: ProviderPickScreenProps): React.ReactElement {
  const rungs = React.useMemo(() => rungsForStrategy(strategy), [strategy]);
  const [selected, setSelected] = React.useState(0);

  useInput((input, key) => {
    if (key.upArrow) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelected((p) => Math.min(rungs.length - 1, p + 1));
    else if (key.return) {
      const rung = rungs[selected];
      if (rung) onPick(rung);
    } else if (key.escape) onBack();
    else if (input === "s" || input === "S") {
      onPick(null);
    }
  });

  const strategyTitles: Record<OnboardingStrategy, string> = {
    auto: "Auto-pick — manual fallback",
    app: "Subscriptions",
    byok: "Bring your own API key",
    free: "Free-tier cloud APIs",
    local: "Local-only providers",
    later: "(skipped)",
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>{strategyTitles[strategy]}</Text>
      {rungs.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">No options in this category.</Text>
          <Text dimColor>Press Esc to pick a different strategy.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {rungs.map((rung, i) => {
            const active = i === selected;
            const available = availability[rung.probe] === true;
            const marker = available ? "●" : "○";
            const markerColor = available ? "green" : "yellow";
            return (
              <Box key={`${rung.id}-${rung.probe}`} flexDirection="column" marginBottom={1}>
                <Box gap={1}>
                  <Text color={active ? "cyan" : "gray"}>{active ? ">" : " "}</Text>
                  <Text color={markerColor}>{marker}</Text>
                  <Text bold={active}>{rung.label}</Text>
                </Box>
                <Box paddingLeft={4}>
                  <Text dimColor>
                    {rung.costNote}
                    {!available ? " · not yet configured" : ""}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ to move · Enter to select · S to skip this strategy · Esc to go back
        </Text>
      </Box>
    </Box>
  );
}

interface ConfirmScreenProps {
  readonly strategy: OnboardingStrategy;
  readonly rung: ProviderRung | null;
  readonly migration: MigrationPlan | null;
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}

/**
 * Infer the Anthropic auth mode for the confirm-screen banner from
 * the wizard's selected rung. SB-07 only governs Anthropic — for
 * non-Anthropic rungs we return null and the banner is skipped.
 *
 * Pure helper, exported so tests can lock the mapping down without
 * mounting the wizard.
 */
export function inferAuthModeForRung(rung: ProviderRung | null): AuthMode | null {
  if (rung === null) return null;
  // claude-cli subscription delegation = OAuth-via-Claude-Code path.
  if (rung.probe === "claude-cli") return "personal-oauth";
  // anthropic-byok = explicit ANTHROPIC_API_KEY = business-api-key.
  if (rung.probe === "anthropic-byok") return "business-api-key";
  // Other providers don't sit under SB-07's policy.
  return null;
}

function ConfirmScreen({
  strategy,
  rung,
  migration,
  onConfirm,
  onBack,
}: ConfirmScreenProps): React.ReactElement {
  const inferredAuthMode = inferAuthModeForRung(rung);
  useInput((_input, key) => {
    if (key.return) onConfirm();
    else if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Confirm choice</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          Strategy:{" "}
          <Text bold color="cyan">
            {strategy}
          </Text>
        </Text>
        {rung ? (
          <>
            <Text>
              Provider: <Text bold>{rung.label}</Text>
            </Text>
            <Text dimColor>Cost: {rung.costNote}</Text>
            <Text dimColor>Category: {rung.category}</Text>
          </>
        ) : (
          <Text dimColor>No provider selected — WOTANN will launch in demo mode.</Text>
        )}
      </Box>
      {migration && migration.needed && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
        >
          <Text color="yellow" bold>
            Legacy config detected
          </Text>
          {migration.notes.map((note, i) => (
            <Text key={`mig-${i}`} dimColor>
              • {note}
            </Text>
          ))}
          <Text dimColor>
            Your old config will be backed up to {migration.backupPath ?? "~/.wotann/.legacy/"}.
          </Text>
        </Box>
      )}
      {/* SB-07 dual-auth banner — additive, owned by SB-07 wave. */}
      {inferredAuthMode !== null && (
        <Box marginTop={1}>
          <AuthModeBanner mode={inferredAuthMode} />
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Enter to continue · Esc to go back</Text>
      </Box>
    </Box>
  );
}

// FirstRunScreen and DoneScreen are extracted to ./onboarding-screens/
// per CLAUDE.md's 800 LOC max-per-file ceiling.

// ═══ Top-level wizard app ═════════════════════════════════════════════════

export interface OnboardingAppProps {
  readonly hardware: HardwareProfile;
  readonly availability: ProviderAvailability;
  readonly runner: FirstRunQueryRunner;
  readonly modelLabel: string;
  readonly migration: MigrationPlan | null;
  readonly onComplete?: (finalStep: WizardStep & { readonly kind: "done" }) => void;
}

/**
 * Root component the CLI mounts via Ink's `render()`. Holds the
 * wizard's `WizardStep` state and threads the reducer through every
 * screen so back-navigation and tests see the same transition logic.
 */
export function OnboardingApp(props: OnboardingAppProps): React.ReactElement {
  const [step, setStep] = React.useState<WizardStep>({ kind: "welcome" });
  const app = useApp();

  const dispatch = React.useCallback(
    (action: WizardAction) => {
      setStep((prev) => {
        const next = reduceWizard(prev, action);
        if (next.kind === "done") {
          props.onComplete?.(next);
          // Give the done screen a tick to render before exiting.
          setImmediate(() => app.exit());
        }
        return next;
      });
    },
    [app, props],
  );

  const handleFinish = React.useCallback(
    (outcome: { ok: boolean; reason?: string }) => {
      dispatch({
        type: "finish",
        reason: outcome.ok ? "success" : "failed",
        failureReason: outcome.reason,
      });
    },
    [dispatch],
  );

  switch (step.kind) {
    case "welcome":
      return (
        <WelcomeScreen
          hardware={props.hardware}
          onNext={() => dispatch({ type: "next-from-welcome" })}
          onCancel={() => {
            props.onComplete?.({
              kind: "done",
              strategy: "later",
              rung: null,
              reason: "skip",
            });
            app.exit();
          }}
        />
      );
    case "strategy":
      return (
        <StrategyScreen
          hardware={props.hardware}
          availability={props.availability}
          onPick={(strategy) => {
            // Wave 1-F: when the user picks "auto", resolve the
            // canonical ladder up-front and pass the winner (or null)
            // to the reducer so it can short-circuit to confirm.
            if (strategy === "auto") {
              const autoResolvedRung = selectFirstAvailable(props.availability);
              dispatch({ type: "pick-strategy", strategy, autoResolvedRung });
            } else {
              dispatch({ type: "pick-strategy", strategy });
            }
          }}
          onBack={() => dispatch({ type: "back" })}
        />
      );
    case "pick":
      return (
        <ProviderPickScreen
          strategy={step.strategy}
          availability={props.availability}
          onPick={(rung) => dispatch({ type: "pick-rung", rung })}
          onBack={() => dispatch({ type: "back" })}
        />
      );
    case "confirm":
      return (
        <ConfirmScreen
          strategy={step.strategy}
          rung={step.rung}
          migration={props.migration}
          onConfirm={() => dispatch({ type: "confirm" })}
          onBack={() => dispatch({ type: "back" })}
        />
      );
    case "firstRun":
      return (
        <FirstRunScreen
          rung={step.rung}
          modelLabel={props.modelLabel}
          runner={props.runner}
          onFinish={handleFinish}
        />
      );
    case "done":
      return (
        <DoneScreen
          step={step}
          onExit={() => {
            props.onComplete?.(step);
            app.exit();
          }}
        />
      );
  }
}
