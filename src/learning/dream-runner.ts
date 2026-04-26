import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWotannHome } from "../utils/wotann-home.js";
import {
  classifyFeedback,
  loadGotchas,
  persistGotchas,
  phaseAnalyze,
  phaseConsolidate,
  phasePrune,
  phaseRecall,
  shouldDream,
  type DreamTriggerGates,
  type Instinct,
} from "./autodream.js";
import { DreamPipeline, type DreamPipelineResult } from "./dream-pipeline.js";
import { MemoryStore } from "../memory/store.js";
// V9 GA-08 — wire self-evolution to dream cycles. After every workspace
// consolidation pass we hand the recently-collected corrections + the
// session's preference snapshot to `SelfEvolutionEngine.updateUserProfile`
// so USER.md grows from session learning instead of staying empty.
// Audit-traceable: a sibling-site grep for `selfEvolution.updateUserProfile`
// outside `self-evolution.ts` will land here, satisfying QB #14.
import { SelfEvolutionEngine } from "./self-evolution.js";

export interface WorkspaceDreamOptions {
  readonly force?: boolean;
  /** Use 3-phase Light/REM/Deep pipeline (default: true). False = legacy 4-phase. */
  readonly useThreePhase?: boolean;
  /**
   * V9 GA-08 — override the SelfEvolutionEngine used for USER.md updates.
   * Tests inject a stub instance pointed at a temp directory so production
   * `~/.wotann/USER.md` isn't clobbered. Production callers pass undefined
   * and the runner constructs a default engine pointed at homedir + .wotann.
   */
  readonly selfEvolution?: SelfEvolutionEngine;
  /**
   * V9 GA-08 — override the wotann directory the SelfEvolutionEngine
   * writes USER.md into. When provided AND `selfEvolution` is undefined,
   * the runner constructs an engine targeting this directory. When
   * `selfEvolution` is provided, this option is ignored. Tests use this
   * to keep USER.md inside the temp workspace.
   */
  readonly userProfileDir?: string;
}

export interface WorkspaceDreamIfDueOptions extends WorkspaceDreamOptions {
  readonly quiet?: boolean;
}

export interface WorkspaceDreamResult {
  readonly executed: boolean;
  readonly forced: boolean;
  readonly gates: DreamTriggerGates;
  readonly observations: number;
  readonly corrections: number;
  readonly confirmations: number;
  readonly gotchasAdded: number;
  readonly instinctsUpdated: number;
  readonly rulesUpdated: number;
  readonly gotchasPath: string;
  readonly instinctsPath: string;
  readonly lastDreamPath: string;
  readonly reason?: string;
  /** Present when 3-phase pipeline was used */
  readonly pipelineResult?: DreamPipelineResult;
  /**
   * V9 GA-08 — true when the dream cycle wired
   * `SelfEvolutionEngine.updateUserProfile` after consolidation.
   * False on every dry-run / gates-failed / non-executed cycle so
   * callers can confirm USER.md learning actually fired (per QB #14).
   */
  readonly userProfileUpdated?: boolean;
  /** V9 GA-08 — absolute path written by updateUserProfile. */
  readonly userProfilePath?: string;
}

interface StoredDreamMetadata {
  readonly dreamedAt: string;
  readonly gotchasAdded: number;
  readonly instinctsUpdated: number;
  readonly rulesUpdated: number;
}

interface StoredInstinct {
  readonly id: string;
  readonly behavior: string;
  readonly confidence: number;
  readonly source: "correction" | "confirmation" | "pattern";
  readonly createdAt: string;
  readonly lastFired?: string;
  readonly fireCount: number;
  readonly decayRate: number;
}

export function runWorkspaceDream(
  workspaceRoot: string,
  options: WorkspaceDreamOptions = {},
): WorkspaceDreamResult {
  const wotannDir = join(workspaceRoot, ".wotann");
  if (!existsSync(wotannDir)) {
    throw new Error("No .wotann workspace found. Run `wotann init` first.");
  }

  mkdirSync(wotannDir, { recursive: true });
  const dbPath = join(wotannDir, "memory.db");
  const gotchasPath = join(wotannDir, "gotchas.md");
  const instinctsPath = join(wotannDir, "instincts.json");
  const lastDreamPath = join(wotannDir, "last-dream.json");
  const store = new MemoryStore(dbPath);
  const lockId = `dream-${Date.now()}`;

  try {
    const inputs = collectDreamInputs(store);
    const gates = computeDreamGates(store, lastDreamPath, inputs.observations.length);
    if (!options.force && !shouldDream(gates)) {
      return {
        executed: false,
        forced: false,
        gates,
        observations: inputs.observations.length,
        corrections: inputs.corrections.length,
        confirmations: inputs.confirmations.length,
        gotchasAdded: 0,
        instinctsUpdated: loadInstincts(instinctsPath).length,
        rulesUpdated: 0,
        gotchasPath,
        instinctsPath,
        lastDreamPath,
        reason: "Gates not satisfied. Re-run with --force to consolidate anyway.",
        // V9 GA-08 — explicit false on gates-failed cycles so callers
        // can distinguish "dream didn't run" from "dream ran but profile
        // update failed" (per WorkspaceDreamResult JSDoc + QB #14).
        userProfileUpdated: false,
      };
    }

    if (!store.acquireConsolidationLock(lockId)) {
      throw new Error("Another autoDream session is already running.");
    }

    // Run 3-phase Light/REM/Deep pipeline (primary path)
    const useThreePhase = options.useThreePhase !== false;
    let pipelineResult: DreamPipelineResult | undefined;

    if (useThreePhase) {
      const dreamsDir = join(wotannDir, "dreams");
      const pipeline = new DreamPipeline(store, dreamsDir);
      pipelineResult = pipeline.runPipelineSync();
    }

    // Also run 4-phase consolidation for gotchas and instincts
    const recalled = phaseRecall(inputs.observations, inputs.corrections, inputs.confirmations);
    const themes = phaseAnalyze(recalled);
    const consolidated = phaseConsolidate(themes);
    const mergedInstincts = phasePrune([
      ...loadInstincts(instinctsPath),
      ...consolidated.instincts,
    ]);

    const gotchasAdded = appendGotchas(gotchasPath, consolidated.gotchas);

    // Also persist gotchas to LESSONS.md for the bootstrap system (persona.ts loads this)
    const lessonsPath = join(wotannDir, "LESSONS.md");
    const existingLessons = loadGotchas(lessonsPath);
    persistGotchas(lessonsPath, consolidated.gotchas, existingLessons);

    persistInstincts(instinctsPath, mergedInstincts);
    persistDreamMetadata(lastDreamPath, {
      dreamedAt: new Date().toISOString(),
      gotchasAdded,
      instinctsUpdated: mergedInstincts.length,
      rulesUpdated: consolidated.rulesUpdated,
    });

    // V9 GA-08 — wire SelfEvolutionEngine.updateUserProfile so USER.md
    // grows from session learning instead of staying empty (closes META
    // §5.1 "scaffolded-but-not-wired"). Resolution order:
    //   1. options.selfEvolution (test injection)
    //   2. options.userProfileDir (test workspace dir)
    //   3. default engine targeting homedir + .wotann (production)
    // The engine derives USER.md from `wotannDir/USER.md` so we mirror
    // that path here for the result envelope. Any failure is caught and
    // surfaced as userProfileUpdated:false (QB #6 honest fallback) so
    // the dream cycle still returns success — USER.md learning is
    // best-effort, not load-bearing for instincts/gotchas.
    const evolutionEngine =
      options.selfEvolution ??
      new SelfEvolutionEngine({
        wotannDir: options.userProfileDir ?? resolveWotannHome(),
      });
    const profileWotannDir =
      options.userProfileDir ?? (options.selfEvolution ? undefined : resolveWotannHome());
    const profilePathHint = profileWotannDir ? join(profileWotannDir, "USER.md") : undefined;

    let userProfileUpdated = false;
    let userProfilePath: string | undefined;
    try {
      const profileCorrections = inputs.corrections.map((entry) => ({
        before: entry.context,
        after: entry.message,
      }));
      // Preferences snapshot: pulled from the "user" memory block which
      // (per memory taxonomy) holds Gabriel's role, preferences, and
      // knowledge level. Honest-empty fallback when the block is empty —
      // we never fabricate preferences. The runner additionally guards
      // the call so no spurious USER.md is written when both maps are
      // empty.
      const preferences: Record<string, string> = {};
      const preferenceEntries = store.getByBlock("user");
      for (const entry of preferenceEntries) {
        preferences[entry.key] = entry.value;
      }

      if (profileCorrections.length > 0 || Object.keys(preferences).length > 0) {
        evolutionEngine.updateUserProfile(preferences, profileCorrections);
        userProfileUpdated = true;
        userProfilePath = profilePathHint;
      }
    } catch (error) {
      // QB #6 — honest fallback. Log on stderr so operators can trace
      // failures, but do NOT block the dream cycle from returning the
      // (genuine) instinct + gotcha consolidation results.
      // eslint-disable-next-line no-console
      console.error(
        `[dream-runner] SelfEvolutionEngine.updateUserProfile failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      userProfileUpdated = false;
      userProfilePath = undefined;
    }

    return {
      executed: true,
      forced: options.force === true,
      gates,
      observations: inputs.observations.length,
      corrections: inputs.corrections.length,
      confirmations: inputs.confirmations.length,
      gotchasAdded,
      instinctsUpdated: mergedInstincts.length,
      rulesUpdated: consolidated.rulesUpdated,
      gotchasPath,
      instinctsPath,
      lastDreamPath,
      pipelineResult,
      userProfileUpdated,
      userProfilePath,
    };
  } finally {
    store.releaseConsolidationLock();
    store.close();
  }
}

export function runWorkspaceDreamIfDue(
  workspaceRoot: string,
  options: WorkspaceDreamIfDueOptions = {},
): WorkspaceDreamResult | null {
  try {
    const result = runWorkspaceDream(workspaceRoot, options);
    return result.executed ? result : null;
  } catch (error) {
    if (options.quiet) {
      return null;
    }
    throw error;
  }
}

function collectDreamInputs(store: MemoryStore): {
  observations: readonly string[];
  corrections: readonly { message: string; context: string }[];
  confirmations: readonly { message: string; context: string }[];
} {
  const observations = store.getAutoCaptureEntries(200).map((entry) => entry.content);
  const feedbackEntries = store.getByBlock("feedback");
  const corrections: Array<{ message: string; context: string }> = [];
  const confirmations: Array<{ message: string; context: string }> = [];

  for (const entry of feedbackEntries) {
    const classification = classifyFeedback(entry.value);
    if (classification.type === "correction") {
      corrections.push({ message: entry.value, context: entry.key });
    } else if (classification.type === "confirmation") {
      confirmations.push({ message: entry.value, context: entry.key });
    }
  }

  return { observations, corrections, confirmations };
}

function computeDreamGates(
  store: MemoryStore,
  lastDreamPath: string,
  observationCount: number,
): DreamTriggerGates {
  const captures = store.getAutoCaptureEntries(200);
  const feedback = store.getByBlock("feedback");
  const latestEventMs = Math.max(
    ...captures.map((entry) => safeParseDate(entry.createdAt)),
    ...feedback.map((entry) => safeParseDate(entry.updatedAt)),
    0,
  );

  const idleMinutes =
    latestEventMs > 0 ? Math.max(0, Math.round((Date.now() - latestEventMs) / 60_000)) : 10_000;

  const lastDreamHoursAgo = readLastDreamAgeHours(lastDreamPath);
  return {
    idleMinutes,
    newObservations: observationCount,
    lastDreamHoursAgo,
  };
}

function appendGotchas(path: string, gotchas: readonly string[]): number {
  const header = "# WOTANN Gotchas\n\n";
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : header;
  const additions = gotchas.filter((gotcha) => !existing.includes(gotcha.trim()));
  if (additions.length === 0) {
    if (!existsSync(path)) {
      writeFileSync(path, header);
    }
    return 0;
  }

  const normalizedBase = existing.endsWith("\n\n")
    ? existing
    : existing.endsWith("\n")
      ? `${existing}\n`
      : `${existing}\n\n`;

  writeFileSync(path, `${normalizedBase}${additions.join("\n")}`);
  return additions.length;
}

function loadInstincts(path: string): Instinct[] {
  if (!existsSync(path)) return [];

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as StoredInstinct[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => ({
      ...entry,
      createdAt: new Date(entry.createdAt),
      lastFired: entry.lastFired ? new Date(entry.lastFired) : undefined,
    }));
  } catch {
    return [];
  }
}

function persistInstincts(path: string, instincts: readonly Instinct[]): void {
  const payload: StoredInstinct[] = instincts.map((instinct) => ({
    id: instinct.id,
    behavior: instinct.behavior,
    confidence: instinct.confidence,
    source: instinct.source,
    createdAt: instinct.createdAt.toISOString(),
    lastFired: instinct.lastFired?.toISOString(),
    fireCount: instinct.fireCount,
    decayRate: instinct.decayRate,
  }));

  writeFileSync(path, JSON.stringify(payload, null, 2));
}

function persistDreamMetadata(path: string, metadata: StoredDreamMetadata): void {
  writeFileSync(path, JSON.stringify(metadata, null, 2));
}

function readLastDreamAgeHours(path: string): number {
  if (!existsSync(path)) return Number.POSITIVE_INFINITY;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { dreamedAt?: string };
    const dreamedAt = parsed.dreamedAt ? Date.parse(parsed.dreamedAt) : Number.NaN;
    if (Number.isNaN(dreamedAt)) return Number.POSITIVE_INFINITY;
    return Math.max(0, (Date.now() - dreamedAt) / (1000 * 60 * 60));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function safeParseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
