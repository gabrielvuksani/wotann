# VERIFICATION LAYERS — the 4-Layer Verification Flow

**Status**: ERRATA-style reference doc (narrow P2-polish exception to the
`docs/` deny-list, matching prior ERRATA docs like
`TIER1_P0_6_STALE_CLAIM.md` and `TIER1_COMMIT_RACE_ERRATA.md`).

**Date**: 2026-04-21
**Scope**: Documents the canonical 4-layer verification flow after the
consolidation of five pre-existing verification classes.
**Authoritative source**: this file. Older references to
`forced-verification.ts` / `ForcedVerificationMiddleware` are stale.

---

## 1. Executive Summary

Prior to this consolidation WOTANN carried **five** verification classes with
similar-but-divergent APIs. Audit (`AUDIT_LANE_1_ARCHITECTURE.md` §3.3,
`ORPHAN_WIRING_CATALOG.md`, `AUDIT_EXTERNAL_DOCS_SCAN.md`) identified
`src/middleware/forced-verification.ts` (`ForcedVerificationMiddleware` class,
209 LOC) as having **zero non-self importers** — only its own self-test
referenced it. All production verification flows through four layers living in
different modules.

The dead class has been removed. The remaining four layers compose into a
clear pipeline, documented below.

---

## 2. Before vs. After

### Before: 5 classes, ambiguous

| # | File | Class | Production callers |
|---|---|---|---|
| 1 | `src/middleware/forced-verification.ts` | `ForcedVerificationMiddleware` | **0** (dead) |
| 2 | `src/middleware/pre-completion-checklist.ts` | `PreCompletionChecklistMiddleware` | pipeline + orchestrators |
| 3 | `src/middleware/verification-enforcement.ts` | `VerificationEnforcementMiddleware` | pipeline adapter |
| 4 | `src/intelligence/verification-cascade.ts` | `VerificationCascade` | orchestration / benchmarks |
| 5 | `src/intelligence/auto-verify.ts` | `AutoVerifier` | orchestration retry-loop |

Additional related modules (not in the "5" count):
- `src/intelligence/pre-completion-verifier.ts` — `PreCompletionVerifier` (B4, in-flight)
- `src/intelligence/chain-of-verification.ts` — `chainOfVerification()` (CoVe)
- `src/security/intent-verifier.ts` — `IntentVerifier` (security/DX2, not part of task-completion verification)

### After: 4 layers, one flow

```
code change → Layer 1 (shell) → Layer 2 (LLM) → Layer 3 (cascade) → Layer 4 (CoVe) → done
                    |                 |                  |                  |
        deterministic,       4-persona         structured        reason-about
        sub-second           parallel review   tsc/test/build    reasoning
        session-gate         LLM call          (external procs)  (LLM-driven)
```

Each layer has a distinct responsibility, different cost profile, and
different failure mode. Composing them yields complementary coverage.

---

## 3. The 4 Layers

### Layer 1 — Shell checks (deterministic)

| Property | Value |
|---|---|
| File | `src/middleware/pre-completion-checklist.ts` |
| Class | `PreCompletionChecklistMiddleware` |
| Adapter | `src/middleware/verification-enforcement.ts` (`VerificationEnforcementMiddleware`, pipeline order 21) |
| Also | `src/middleware/layers.ts` — `forcedVerificationMiddleware` (const, pipeline order 15: per-write tsc) |
| Cost | Zero LLM tokens. Sub-second on cached tsc output. |
| Protocol | Tracks `Write`/`Edit` events + Bash command matches (`tsc --noEmit`, `vitest run`, etc.) against a session state. On completion-claim text, runs `runChecklist()`. |
| Checks | tests pass, typecheck passes, no TODO/FIXME/stub markers remain in modified files, git-diff shows expected changes. |
| Failure mode | Blocks the completion response with actionable per-item messages. Can be triggered N times per session; `blockCount` is tracked. |
| Rationale | Deterministic checks are the cheapest + strongest signal. A human reviewer would run these before spending LLM budget on persona review. |

### Layer 2 — LLM pre-completion review (4 parallel personas)

| Property | Value |
|---|---|
| File | `src/intelligence/pre-completion-verifier.ts` |
| Class | `PreCompletionVerifier` |
| Status | **Wire-in in flight (B4)**. Class exists; B4 adds runtime wiring. |
| Cost | 4 parallel LLM calls (implementer / reviewer / tester / user). Temperature=0 by default. Supports `skipPreCompletionVerify` bypass for benchmarks. |
| Protocol | `verify({task, result, context?})` → `{status, perspectives[4], allConcerns, totalDurationMs}`. Status is `pass` only when no perspective fails; `error` only when all four error. |
| Personas | implementer (does code do what user asked?), reviewer (bugs / edge cases / security), tester (missing coverage?), user (UX / outcome match?). |
| Failure mode | Any persona `fail` → overall `fail`. Provider-level errors bubble up as per-perspective `error` status (honest — does not silently pass). |
| Rationale | Catches semantic-correctness issues a shell check cannot see (e.g. `if (x = 0)` typecheck-clean, test-passing, but reviewer flags the `=`). |

### Layer 3 — Task verification cascade (structured stages)

| Property | Value |
|---|---|
| File | `src/intelligence/verification-cascade.ts` |
| Class | `VerificationCascade` |
| Auto-detects | typecheck (`tsc --noEmit` if `tsconfig.json`), lint (npm script / biome / eslint), unit-tests (npm test / vitest / jest), integration-tests (npm script), build (npm script). |
| Cost | External subprocess time. Typecheck ~seconds. Full cascade can take minutes. |
| Protocol | `run()` → `{steps[], allPassed, failedStep, totalDurationMs, stepsRun, stepsSkipped}`. Required steps fail fast; optional steps log warnings but continue. |
| Failure mode | Any required step fails → `allPassed=false`, remaining steps skipped with `skipped:true`. |
| Sibling | `src/intelligence/auto-verify.ts` (`AutoVerifier`) is the **retry-loop wrapper** around the cascade — runs verification, feeds failures back to the agent, up to `maxRetries`. |
| Rationale | Full-cascade is expensive; runs at larger boundaries (orchestrator wave end, Ralph loop stop) rather than after every write. |

### Layer 4 — Chain-of-verification (CoVe)

| Property | Value |
|---|---|
| File | `src/intelligence/chain-of-verification.ts` |
| Export | `chainOfVerification()` (free function; no class). |
| Paper | Dhuliawala et al. 2023 — "Chain-of-Verification Reduces Hallucination in Large Language Models". |
| Cost | 2 + N LLM calls (N = generated verification questions, default ≤ 4). |
| Protocol | 4 steps: (1) draft baseline answer, (2) plan verification questions, (3) answer each question **independently** in fresh context, (4) revise baseline using verification answers. |
| Output | `{baselineAnswer, verificationQuestions, verificationRounds, finalAnswer, revisionNeeded}`. |
| Failure mode | No hard fail — this layer **revises**, it doesn't block. `revisionNeeded` flags whether final differs from baseline. |
| Rationale | Best on long-form factual generation where hallucination is the risk; marginal on code gen. Used for research / explanation-heavy outputs. |

---

## 4. Composition Rules

1. **Order matters**: shell → LLM → cascade → CoVe. Cheaper deterministic checks first; expensive LLM checks only after cheap ones pass.
2. **Short-circuit on hard fail**: Layer 1 failure blocks the completion response — don't bill Layer 2 tokens when tsc is red.
3. **Bypass flags are per-layer**: `skipPreCompletionVerify` on Layer 2 only; cascade has no built-in bypass (caller chooses whether to run).
4. **Composition is the runtime's job, not the layer's**: each class is decoupled; the runtime (orchestrator / pipeline) decides when to invoke each one. See `src/orchestration/` for the composition sites.
5. **Errors are honest**: every layer distinguishes `fail` (real defect) from `error` (provider / environment failure). Never silently promote error to pass.

---

## 5. Why the 5th class (`ForcedVerificationMiddleware`) was removed

The class in `src/middleware/forced-verification.ts` was a self-contained
verifier with its own `VerificationRunner` interface, config, stats tracking,
and result formatter. Audit (`AUDIT_LANE_1_ARCHITECTURE.md` §3.3) found:

1. **Zero non-self importers**: only `tests/unit/forced-verification.test.ts`
   — the class's own test file — referenced it. No orchestrator, no pipeline,
   no runtime wired it in.
2. **Duplicate responsibility**: its stated purpose ("run tsc+test after
   every Write/Edit") was already handled by `layers.ts` at pipeline order
   15 (`forcedVerificationMiddleware`, a Middleware const — same concept, half
   the LOC, actually wired).
3. **Docblock contradictions**: both `pre-completion-checklist.ts:19` and
   `verification-enforcement.ts:16` maintained "DIFFERENCE FROM
   forced-verification.ts" paragraphs to explain why there were three
   overlapping files. Confusion is the signal.

Deletion impact:
- `src/middleware/forced-verification.ts` — 209 LOC removed
- `tests/unit/forced-verification.test.ts` — 118 LOC removed
- **Net: 327 LOC of live code and tests removed; zero production callers affected.**

The const `forcedVerificationMiddleware` in `src/middleware/layers.ts`
remains — it's a different symbol (camelCase const, not PascalCase class) and
is the actual production code path.

---

## 6. Smoke-test regression lock

Each layer has its own full test suite. In addition, the consolidated flow
is smoke-tested in one place:

- `tests/intelligence/verification-layers.test.ts` — instantiates each
  layer with mocked dependencies and asserts output shape. Also covers a
  cross-layer composition test. Runs in < 1s.

If a future refactor breaks the 4-layer contract, this file will be the
first red signal.

---

## 7. Related ERRATA / Audit references

- `AUDIT_LANE_1_ARCHITECTURE.md` §3.3 — original consolidation
  recommendation (item 5 in the fixture table at line 335).
- `ORPHAN_WIRING_CATALOG.md:179` — forced-verification listed as
  "Consolidate or delete" (this doc is the DELETE resolution).
- `AUDIT_EXTERNAL_DOCS_SCAN.md:489` — same finding.
- `docs/MASTER_PLAN_V8.md` §6 P2 polish — the task tracker entry that
  asked for this consolidation.
- `src/intelligence/pre-completion-verifier.ts:26-31` — docblock that
  already positioned Layer 2 relative to Layers 1 and 3.
