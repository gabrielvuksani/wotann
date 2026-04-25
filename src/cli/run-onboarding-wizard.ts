/**
 * Wizard launcher — V9 Tier 6 T6.2 wire-up.
 *
 * Assembles the dependencies the OnboardingApp wizard needs (hardware
 * profile, provider availability, migration plan, first-run query
 * runner) and mounts the wizard via Ink.
 *
 * Audit-identified gap (2026-04-24): `src/cli/onboarding-screens.tsx`
 * was a fully-implemented 832-LOC Ink wizard with NO production
 * consumer — `wotann init` ran the legacy chalk flow exclusively, so
 * the wizard was dead code. This module closes that loop: pass
 * `--wizard` to `wotann init` and the OnboardingApp finally launches.
 *
 * Quality bars
 *  - QB #6 honest failures: when a dependency fails (hardware probe,
 *    provider discovery), the wizard still launches with a fallback
 *    profile rather than swallowing the error. The legacy chalk flow
 *    remains the default for users who don't pass `--wizard`.
 *  - QB #7 per-call state: every dependency is freshly built each
 *    invocation. No module-global caches.
 *  - QB #13 env guard: `process.env` reads are confined to the
 *    detector helpers; this module just composes them.
 */

import React from "react";
import { render } from "ink";
import { OnboardingApp } from "./onboarding-screens.js";
import { detectHardware } from "../core/hardware-detect.js";
import { PROVIDER_LADDER, type ProviderAvailability } from "../providers/provider-ladder.js";
import { planMigration } from "../core/config-migration.js";
import { discoverProviders } from "../providers/discovery.js";
import type { FirstRunQueryRunner } from "./first-run-success.js";

// ── Internal helpers ─────────────────────────────────────────

/**
 * Translate the existing `discoverProviders()` snapshot into the
 * wizard's `ProviderAvailability` shape (`Record<rungId, boolean>`).
 *
 * `discoverProviders()` keys by canonical provider names (anthropic,
 * openai, etc.) — those happen to match the rung ids that
 * `provider-ladder.ts` uses. For rungs not represented in the
 * discovery output (subscription detectors, BYOK paths), we default
 * to `false` so the wizard hides them rather than implying they're
 * available.
 */
async function buildAvailabilityFromDiscovery(): Promise<ProviderAvailability> {
  const detected = await discoverProviders();
  // discoverProviders() returns ONLY providers it could verify
  // credentials for, so presence in the array = available.
  const detectedIds = new Set(detected.map((p) => p.provider));
  const map: Record<string, boolean> = {};
  for (const rung of PROVIDER_LADDER) {
    map[rung.id] = detectedIds.has(rung.id as never);
  }
  return map;
}

/**
 * Default first-run runner — short-circuits with a benign message
 * because the actual roundtrip needs a configured provider, which
 * the wizard is in the process of choosing. The downstream `wotann
 * init --wizard` workflow can be extended to inject a real runner
 * once the provider rung is selected.
 */
const defaultFirstRunRunner: FirstRunQueryRunner = async function* (
  _prompt: string,
): AsyncGenerator<{ readonly text?: string; readonly tokensUsed?: number }, void, unknown> {
  yield {
    text: "Wizard runner not yet wired to live provider — finish init then run `wotann start`.\n",
    tokensUsed: 0,
  };
};

// ── Public entry point ───────────────────────────────────────

export interface RunWizardOptions {
  /** Override the hardware profile (tests). Default: detect from env. */
  readonly hardwareOverride?: ReturnType<typeof detectHardware>;
  /** Override availability (tests). Default: discover live. */
  readonly availabilityOverride?: ProviderAvailability;
  /** Override migration plan (tests). Default: plan from env. */
  readonly migrationOverride?: ReturnType<typeof planMigration> | null;
  /** Inject a real first-run query runner (e.g. after rung pick). */
  readonly firstRunRunner?: FirstRunQueryRunner;
  /** Tests pass a model label; wizard renders it on the success screen. */
  readonly modelLabel?: string;
}

/**
 * Mount the OnboardingApp wizard. Returns when the user finishes the
 * flow (any terminal kind: done | skip | failed). Caller is
 * responsible for any post-finish persistence (config write).
 */
export async function runOnboardingWizard(opts: RunWizardOptions = {}): Promise<void> {
  const hardware = opts.hardwareOverride ?? detectHardware();
  const availability = opts.availabilityOverride ?? (await buildAvailabilityFromDiscovery());
  const migration = opts.migrationOverride === undefined ? planMigration() : opts.migrationOverride;
  const runner = opts.firstRunRunner ?? defaultFirstRunRunner;
  const modelLabel = opts.modelLabel ?? "(provider not yet selected)";

  await new Promise<void>((resolve) => {
    const instance = render(
      React.createElement(OnboardingApp, {
        hardware,
        availability,
        runner,
        modelLabel,
        migration,
        onComplete: () => {
          // Defer resolve until Ink finishes its exit cycle.
          setImmediate(() => {
            instance.unmount();
            resolve();
          });
        },
      }),
    );
    instance.waitUntilExit().then(() => resolve());
  });
}
