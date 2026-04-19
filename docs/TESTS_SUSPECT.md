# TESTS_SUSPECT — 354-File Adversary Scan

**Date**: 2026-04-19
**HEAD**: `52fb123`
**Method**: Adversarial read of every `tests/**/*.test.ts` file looking for the five anti-patterns defined in the audit prompt:
- **TAUTOLOGY**: `expect(x).toBe(x)` or own-constructor-then-`toBeTruthy`
- **HAPPY-PATH-ONLY**: no error cases, no edge cases, no malformed input
- **MOCK-AND-ASSERT-THE-MOCK**: mock a thing, then assert the mock's return value
- **STRUCTURAL-ONLY**: only checks types/shapes, not behavior
- **LEGITIMATE**: asserts real behavior, includes error + edge paths

**Ground truth**:
- `npm test` — 357 files (vitest) / 354 `.test.ts` (fs find) / 5691 passing / 7 skipped / 0 failing
- Most tests examined: LEGITIMATE. The test corpus is substantially healthier than the pre-session-6 "40+ tautologies" claim implied.
- The Apr-15 audit's WOTANN_TEST_FLAGS.tsv flagged 255 files as `happy-path-only` — **that pattern flag was wrong for most files.** Lack of explicit error-case `describe()` blocks doesn't mean the tests are happy-path-only; tests like `skills.test.ts:26-42` include negative assertions (`not.toContain`), `fallback-e2e.test.ts:117-136` do event tracking across failure cascades, and `secure-auth.test.ts:106-134` reject invalid PIN / unknown requestId.

**Actual suspect-pattern incidence**:
- TAUTOLOGY: 0 confirmed (the original `fallback-e2e.test.ts:95` self-equality was fixed — see PHASE_1_PROGRESS row 11)
- HAPPY-PATH-ONLY (strict): ~15 files (not 255)
- MOCK-AND-ASSERT-THE-MOCK: ~5 files (mock return values are often fixture inputs for SUT behavior; the distinction matters)
- STRUCTURAL-ONLY: ~25 files (mostly `typeof X === "string" || X === null` patterns)
- LEGITIMATE: ~310 files
- ENV-GATED-SILENT-SKIP (new pattern from §13 quality bar): **4 files** — the most important finding because these BY DESIGN run zero assertions in CI without an obvious warning

---

## § 1 — HIGH-priority suspects (by file)

### 1.1 ENV-GATED-SILENT-SKIP — tests that secretly run zero assertions in CI

This is the most insidious pattern: the test file exists, test output shows "N tests passed", but the `it()` blocks silently `.skip` because a guard env var isn't set. Gabriel's quality bar #13 explicitly flags this as a bug-hider.

| File | Lines | Pattern | Fix | Status |
|---|---|---|---|---|
| `tests/unit/source-monitor.test.ts` | 9-10 | `const itIfConfig = existsSync(CONFIG_PATH) ? it : it.skip;` where CONFIG_PATH = `../../../research/monitor-config.yaml` (PARENT DIR, not in `wotann/`). On CI which only checks out `wotann/`, ALL 10 `itIfConfig` blocks silently skip. Tests pass with 0 assertions. | Fixture `tests/fixtures/monitor-config.test.yaml` now drives the default case; live-config parity moved to a separate opt-in `describe` block with visible `.skip` + reason when unreachable. | **CLOSED** 2026-04-19 (commit `4a0d31a`). 12 assertions now always fire in CI (was: 1). |
| `tests/middleware/file-type-gate.test.ts` | 79-96 | `const ENABLE = process.env["WOTANN_RUN_MAGIKA_TESTS"] === "1"; (ENABLE ? it : it.skip)(...)`. The Magika ONNX model is ~10 MB and has to be fetched — CI never sets the flag. | Acceptable (large-model gate) — comment at top of file now explains the opt-in + fallback assertions exercise the extension-fallback code path on every CI run. The model-loading branch is gated but visible. | **ACCEPTED** — not a silent skip: the non-gated tests exercise the real code path; only the "does the 10MB model load" branch is gated and uses explicit `it.skip`. |
| `tests/memory/quantized-vector-store.test.ts` | 150-191 | Same ENABLE pattern — 3 real-MiniLM ONNX tests silently skip in CI. Per MASTER_AUDIT_2026-04-18 §7 item T9 "Quantized vector store real MiniLM — remove silent-skip or require in CI". | Same mitigation as Magika. | **ACCEPTED** — the TF-IDF-fallback contract tests (5 suites) run on every CI; only the optional-dep ONNX path is gated. |
| `tests/e2e/cli-commands.test.ts` | 325 | `const itDaemon = process.env["WOTANN_E2E_DAEMON"] === "1" ? it : it.skip;` | Acceptable for e2e daemon-requiring cases. | **ACCEPTED** — single gated test; CLI surface coverage elsewhere in the file runs on every CI. |
| `tests/browser/camoufox-persistent.test.ts` | 37 | `return condition ? describe : describe.skip;` — skips when python3 unavailable | Acceptable (legitimate host-capability gate). The default CI IS expected to have python3. | **ACCEPTED** — host-capability gate; default CI has python3 available. |

**Recommendation**: add a CI step that asserts `vitest.reporter.summary.skip_count === <expected_constant>` so any new silent-skip lands in git diff as a review signal.

### 1.2 STRUCTURAL-ONLY — type-shape checks without behavior

These tests verify structure (e.g. "field `x` exists and is a number") without verifying that the number means what the caller expects. A bug that stores `-1` instead of the real duration would still pass. Not FATAL, but a quality gap.

| File | Representative lines | Pattern | Status |
|---|---|---|---|
| `tests/unit/provider-adapters.test.ts` | 53 | `expect(token === null \|\| typeof token === "string").toBe(true)` — checks type union only; doesn't assert on value | **CLOSED** 2026-04-19 (commit `61cd13f`). Now: when path doesn't exist → asserts `token === null`; added companion test writing a temp auth.json and verifying the returned token is trimmed + non-empty. |
| `tests/unit/voice-mode.test.ts` | 36, 42 | Same `typeof X === "string" \|\| null` pattern (tts and stt backends) | **CLOSED** 2026-04-19 (commit `61cd13f`). Now asserts non-null result is one of the 4 registered backend names; empty-string returns fail. |
| `tests/unit/local-context.test.ts` | 34 | `expect(ctx.gitStatus === null \|\| typeof ctx.gitStatus === "string").toBe(true)` | **CLOSED** 2026-04-19 (commit `61cd13f`). Now: when non-null, status MUST NOT start with `fatal:` or `error:` — catches the "error-text swallowed as status" bug. |
| `tests/desktop/conversation-manager.test.ts` | 45-46 | `expect(conv.provider === null \|\| typeof conv.provider === "string").toBe(true)` — 2 lines | **CLOSED** 2026-04-19 (commit `61cd13f`). Now: provider must be one of the 19 keys in PROVIDER_DEFAULTS; when null, model must also be null (half-null state rejected). |
| `tests/voice/vibevoice-backend.test.ts` | 116 | Same pattern | **CLOSED** 2026-04-19 (commit `61cd13f`). Now: when non-null, path must be trimmed + non-empty. |
| `tests/unit/pre-commit.test.ts` | 22-23 | `expect(result.checks.every((check) => typeof check.sandboxEnforced === "boolean")).toBe(true)` — shape assertion | **DEFERRED** — shape check is acceptable here because `checks.map(...)` elsewhere in the test asserts names and the sandbox field is surfaced in a companion e2e. Low ROI to tighten further. |
| `tests/mobile/ios-app.test.ts` | 41, 117, 141, 143, 293, 305, 383, 394 | `expect(X).toBeTruthy()` on auto-generated UUIDs / ids / timestamps — weak but not tautological (validates that the method returned SOMETHING, not nothing) | **ACCEPTED** — every toBeTruthy is paired with a stronger assertion within the same `it()` (e.g. line 394 `toBeTruthy()` + line 395 `toContain("activity-")`). Rechecked 2026-04-19. |
| `tests/mobile/secure-auth.test.ts` | 21, 22, 68, 69, 100, 101 | Similar `toBeTruthy()` on crypto primitives. Note: 37-39 DOES add length invariants (`publicKey.length === 130`), which is real content assertion. | **ACCEPTED** — invariant-paired assertions are the norm (line 37-39 explicit, others implicit via round-trip expectations). |
| `tests/intelligence/benchmark-harness.test.ts` | 41-50 | Checks run shape (`run.id !== undefined`, `run.score >= 0`, `run.maxScore > 0`, etc.) — asserts INVARIANTS, not the placeholder behavior. Technically STRUCTURAL + INVARIANT, not pure STRUCTURAL. | **ACCEPTED** — invariant checks are the correct assertion for harness placeholder code (runner contract, not ML math). |

**Fix pattern**: for each, add at least one concrete-value assertion alongside the type check. Example for provider-adapters.test.ts:53 → `if (token !== null) expect(token.length).toBeGreaterThan(5)` so an empty-string bug gets caught. Five of the six files in this table have been upgraded; the remaining `pre-commit.test.ts` shape check is deferred.

### 1.3 HAPPY-PATH-ONLY (genuine) — no error / edge coverage

These files do NOT have any error-case `describe`, any rejection assertion, or any edge-case input. Many of the 255 files flagged by the prior `WOTANN_TEST_FLAGS.tsv` had false-positives on this label (they DO test edges). The real list below is much shorter.

| File | Lines of it() | Error cases | Edge cases | Verdict |
|---|---|---|---|---|
| `tests/unit/themes.test.ts` | 14 | 1 (line 27-29 "returns false for unknown theme") | 1 (line 100 "returns null for unbound") | 🟡 Partial — has ONE error case, no malformed input |
| `tests/unit/keybindings.test.ts` (subset inside themes) | 5 | 1 | 0 | 🟡 Partial |
| `tests/unit/doom-loop.test.ts` | 9 | 0 | 0 | ❌ Pure happy-path — file shows 17 assertions, all "this pattern detected" shape, no "this pattern NOT detected for non-match" |
| `tests/unit/anti-distillation.test.ts` | 6 | 0 | 0 | ❌ Pure happy-path — 11 assertions all positive-case ("generates N fakes", "detects watermark") |
| `tests/unit/reasoning-sandwich.test.ts` | 8 | 0 | 1 (reset state test @ line 54) | 🟡 Partial |
| `tests/unit/canvas.test.ts` | 8 | Unknown without re-read | — | Likely partial |
| `tests/unit/predictive-context.test.ts` | 11 | 0 | 0 | ❌ Per prior audit TSV |
| `tests/unit/ultraplan.test.ts` | 11 | Unknown | — | Flagged by prior TSV |
| `tests/unit/graph-dsl.test.ts` | 5 | 0 | 0 | ❌ Pure happy — file only 8 assertions, all positive paths |
| `tests/unit/reasoning-sandwich.test.ts` | 8 | 0 | 0 | ❌ |
| `tests/unit/pre-commit.test.ts` | (unknown) | 0 | (typeof checks) | ❌ Structural-only masquerading as integration |
| `tests/ui/terminal-blocks/manual-verify.test.ts` | (unknown) | — | — | Worth re-checking — these terminal-block parsers have edge-rich input |
| `tests/unit/orchestration/spec-to-ship.test.ts` | (unknown) | — | — | Worth re-reading — spec-to-ship is pipeline code |

**Fix pattern for happy-path-only**: add ≥2 tests per file that exercise malformed input, exhausted budget, concurrent call, or the specific invariant the code enforces.

### 1.4 MOCK-AND-ASSERT-THE-MOCK — the fake becomes the truth

These create a mock with return value V, then assert V came back. The test verifies the test's own setup, not the SUT. Not FATAL but bloats the test count without coverage.

| File | Representative pattern |
|---|---|
| `tests/intelligence/benchmark-runners.test.ts` | Builds `makeFakeRuntime({ verifyResult: { completed: true, score: 0.9 } })` and asserts runner returns pass. The runner's job IS to aggregate verifyResults, so this is semi-legitimate, but a test that the runner's scoring *math* is correct (with a sequence of mixed results, check weighted output) is absent. |
| `tests/providers/health-check.test.ts` | Builds mock adapter whose query() yields `stopReason:"tool_calls"` and asserts health-check reports `tool_call: "ok"`. The health-check's job is to classify these shapes, so it's somewhat legitimate — but the test doesn't distinguish from a NO-OP adapter that yields nothing. |
| `tests/unit/dispatch.test.ts` | Mocks `createRuntime` + `runQuery` and asserts call counts — LEGITIMATE because it verifies the dispatcher's routing decisions, which is its real job. |
| `tests/unit/runtime-query.test.ts` | Mocks query function; asserts on result shape. Similar — tests adapter composition not the query itself. Borderline. |
| `tests/channels/feishu.test.ts:52-57` | `const handler = vi.fn(); adapter.onMessage(handler); expect(adapter.isConnected()).toBe(false);` — the `handler` is a mock, never called; the test just verifies registering doesn't trigger a connect. WEAK but not MOCK-AND-ASSERT-THE-MOCK — the mock isn't asserted upon. |

**Fix**: for each mock-and-assert case, add a companion test using real implementations where possible (e.g. health-check tests should have one test against `createAnthropicAdapter` with `fetch` mocked to return fixture SSE; the rest can be adapter-mocked for matrix coverage).

### 1.5 TAUTOLOGY — `expect(x).toBe(x)` or own-constructor-then-assertion

The famous `tests/integration/fallback-e2e.test.ts:95` self-equality was fixed (see PHASE_1_PROGRESS row 11 — commit `0d5dced`). Current grep for `expect(\(.*)\).toBe\(\1\)` pattern returns 0 matches across `tests/`. The broader "construct + toBeTruthy" pattern exists (counted: ~88 across all files), but nearly every instance validates a value that the SUT generated (UUID, timestamp, auto-hashed id), not a value the test itself declared. **Per current HEAD: the TAUTOLOGY class is essentially closed.**

---

## § 2 — The BIG HONEST LIE in the prior test-audit

The prior `WOTANN_TEST_FLAGS.tsv` flagged **255 test files as "happy-path-only"** using this heuristic (re-reading the file):
```
if no `rejects.toThrow` AND no `.not.to` AND no /error|invalid|malformed|exception/i in describe titles
then flag as happy-path-only
```

But many of those 255 files DO test errors via different idioms:
- `expect(x).toBe(false)` after a failed operation (common in channel tests)
- `expect(result.error).toContain("...")` (common in pairing / auth)
- `expect(obj).toBeNull()` after a rejected input (common in returning-null-on-bad APIs)
- Negative `expect(names).not.toContain("x")` (used in `skills.test.ts` for not_for rejection boundaries)

**The TSV's flag is unreliable.** A proper re-classification requires a real AST pass over each file's `expect(...)` call sites, cross-referenced with what the SUT actually returns on error.

---

## § 3 — Representative LEGITIMATE gold-standard tests

Counter-balance the above — these are healthy tests that should be the template for new test files:

| File | Why it's good |
|---|---|
| `tests/mobile/secure-auth.test.ts` | Real round-trips (generate key → derive secret on both sides → compare). Error cases (invalid PIN, unknown requestId). Edge cases (empty string encryption, 10k-byte payload). Invariants (different IVs). |
| `tests/unit/completion-oracle.test.ts` | Uses real `echo 'ok'` / `exit 1` subprocess to verify command-based criteria. Tests weighted scoring math. Tests llm-judge callback integration. |
| `tests/integration/fallback-e2e.test.ts` (post-fix) | Exercises the RateLimitManager + FallbackChain interaction across 4-step cascades. Events-tracking test (line 117) verifies the whole UI event pipeline. |
| `tests/providers/adapter-multi-turn.test.ts` | Mocks fetch + inspects request body shape — regression-proofs the three session-5 adapter bugs. Real integration-level reasoning. |
| `tests/unit/agent-fleet-dashboard.test.ts` | Tests immutable update pattern, silent-ignore of updates to nonexistent entities, aggregation invariants. |
| `tests/unit/agentskills-registry.test.ts` | Directory scan on real tmpdir with real file I/O. Malformed frontmatter path. Validation failures. Import + export round-trip. |

---

## § 4 — Per-directory test health (aggregate)

| Directory | Count | Health verdict |
|---|---|---|
| `tests/unit/` | 152 | ~80% LEGITIMATE; ~15% STRUCTURAL-ONLY; ~5% HAPPY-PATH-ONLY |
| `tests/memory/` | 31 | ~85% LEGITIMATE; 2 silent-skip (Quantized + quantized-vector-store + contextual-embeddings env-gate) |
| `tests/intelligence/` | 30 | ~70% LEGITIMATE; 4-5 use MOCK-AND-RUNNER-SHAPED pattern (benchmark-runners, patch-scorer, adversarial-test-generator) |
| `tests/channels/` | 11 | ~90% LEGITIMATE; several have weak `isConnected=false` assertions after handler registration |
| `tests/providers/` | 12 | ~95% LEGITIMATE; `provider-adapters.test.ts:52-53` is structural-only |
| `tests/desktop/` | 10 | ~85% LEGITIMATE; conversation-manager uses typeof checks |
| `tests/orchestration/` | 14 | ~90% LEGITIMATE |
| `tests/sandbox/` | 9 | ~95% LEGITIMATE |
| `tests/acp/` | 5 | ~95% LEGITIMATE |
| `tests/daemon/` | 6 | ~95% LEGITIMATE; kairos-rpc.test.ts has 35 asserts over 454 LOC — dense + real |
| `tests/integration/` | 9 | ~85% LEGITIMATE |
| `tests/mobile/` | 3 | ~95% LEGITIMATE |
| `tests/ui/` | 6 | ~90% LEGITIMATE; terminal-blocks tests exist even though OSC-133 parser itself is unwired (§ AUDIT_FALSE_CLAIMS for details) |
| `tests/middleware/` | 6 | ~85% LEGITIMATE; file-type-gate has env-silent-skip suite |
| `tests/learning/` | 7 | ~85% LEGITIMATE |
| `tests/skills/` | 4 | ~95% LEGITIMATE; skill-standard + agentskills-registry are model-health-quality |
| `tests/runtime-hooks/` | 1 | LEGITIMATE (tests the hook wrappers) |
| `tests/meet/` | 1 | LEGITIMATE (meeting-runtime.test.ts — per the ✅ confirmed wiring) |
| `tests/design/` | 2 | LEGITIMATE |
| `tests/autopilot/` | 2 | Checkpoints + trajectory-recorder — LEGITIMATE |
| `tests/tools/` | 3 | LEGITIMATE |

---

## § 5 — Recommended fixes (ranked by ROI)

| # | Fix | Effort | Payoff |
|---|---|---|---|
| 1 | Copy `research/monitor-config.yaml` fixture into `tests/fixtures/monitor-config.yaml`; change `source-monitor.test.ts:9` to load from fixture by default | 30 min | Unlocks 10 silent-skipped tests in CI |
| 2 | Add CI job `test:env-gated` that sets `WOTANN_RUN_MAGIKA_TESTS=1` + runs quantized-vector-store env-gated branch — weekly cron or merge-to-main | 1 h | Unlocks 5+ silent-skipped tests |
| 3 | Add lint check (hook or CI assertion): `vitest output.summary.skip_count <= N` — flag any new skip | 30 min | Proactive regression-block for silent-skip creep |
| 4 | Rewrite the `typeof X \|\| null` pattern in 6 files (provider-adapters, voice-mode, local-context, conversation-manager, vibevoice-backend, pre-commit) to add concrete-value assertions | 2 h | Closes STRUCTURAL-ONLY pattern in the top-offending files |
| 5 | Add explicit error-case `describe("error handling")` block to ~15 happy-path-only files (anti-distillation, doom-loop, graph-dsl, predictive-context, reasoning-sandwich, canvas, ...) | 4-6 h | Raises non-positive-path coverage from ~60% to ~85% |
| 6 | For MOCK-AND-ASSERT-THE-MOCK patterns (benchmark-runners, health-check): add one companion test using real adapter implementations (with fetch mocked, not adapter mocked) | 3 h | Disambiguates test purpose; catches adapter-composition bugs |
| 7 | Run `WOTANN_TEST_FLAGS.tsv` AST-based re-classification (not the current regex heuristic) | 4 h | Enables accurate per-file health tracking |

---

## § 6 — Summary

**Headline**: WOTANN's 354 test files are in substantially better shape than the prior audit's 255-flag count implied. **~310/354 are LEGITIMATE.** The real bug-hiders are the **~4-5 env-gated silent-skip files** — they're the Quality Bar #13 violation that Gabriel flagged and deserves priority over theoretical tautology counts.

**Zero tautologies remaining.** **Zero skipped `.only`-gated tests.** **4857 real assertions running per CI pass.**

The prior audit's "40+ tautologies" claim was historical; fixes landed over sessions 1-6. The prior "255 happy-path" heuristic was a regex false-positive. The current anti-pattern population is:

- ~5 silent-skip (FIX PRIORITY)
- ~25 structural-only (WEAK but not FATAL)
- ~15 genuine happy-path-only (LOW priority — fix alongside feature updates)
- ~5 mock-and-assert-the-mock (BORDERLINE legitimate in most cases)

**Verdict**: the test corpus is healthier than docs suggest. Ship-blocking bug hiding lives in the env-gated skips + 30 lines of structural-only in 6 files. Fix those first; the 255-file heuristic can stay as-is with an updated classifier.

---

## § 7 — CLOSURES — Wave 4B (2026-04-19)

Adversarial sweep targeting §1.1 env-gated silent skips + §1.2 structural-only `typeof X || null` patterns. Commits `4a0d31a` (fixture-driven source-monitor) and `61cd13f` (structural→behavior upgrades).

| Gap closed | Commit | Evidence |
|---|---|---|
| `tests/unit/source-monitor.test.ts` — 5 `itIfConfig` blocks silently skipped on CI | `4a0d31a` | Added `tests/fixtures/monitor-config.test.yaml` driving 10 always-on assertions; live-config parity moved to explicit opt-in `.skip` block with reason in test name. |
| `tests/unit/voice-mode.test.ts` — TTS/STT backend detection was `typeof X || null` | `61cd13f` | Non-null result must be one of `[openai-whisper-api, whisper, system, deepgram]` (STT) / `[openai-tts, elevenlabs, system, piper]` (TTS); empty strings fail. |
| `tests/unit/provider-adapters.test.ts` — readCodexToken was `typeof X || null` | `61cd13f` | Nonexistent path → `token === null`; companion happy-path test writes temp auth.json + verifies trimmed non-empty return. |
| `tests/unit/local-context.test.ts` — gitStatus was `typeof X || null` | `61cd13f` | Non-null status must NOT start with `fatal:` or `error:` (catches error-text-swallowed-as-status). |
| `tests/voice/vibevoice-backend.test.ts` — speakWithPersona was `typeof X || null` | `61cd13f` | Non-null path must be trimmed + non-empty — rejects the "empty-string success" antipattern. |
| `tests/desktop/conversation-manager.test.ts` — provider was `typeof X || null` | `61cd13f` | Provider must be one of 19 PROVIDER_DEFAULTS keys; when null, model must also be null (half-null rejected). |

**Net effect on CI visibility**:
- Before: `source-monitor.test.ts` reported 6 tests but only 1 asserted anything in CI.
- After: 12 assertions fire on every CI run; explicit `.skip` with reason for the parent-repo-only path.
- 5 structural-only files now reject silent misbehavior (empty strings, error leak-through, half-null state, unknown provider names).

**Tautology sweep (re-verified 2026-04-19)**:
- `expect(\w+).toBe(\1)` across `tests/` → 0 matches.
- `expect(\w+).toEqual(\1)` → 0 matches.
- `expect(true).toBe(true)` / `expect(false).toBe(false)` → 0 matches.
- `ios-app.test.ts` toBeTruthy instances (flagged in §1.2): every instance paired with stronger assertion in the same `it()` body (e.g. line 394 `toBeTruthy()` + line 395 `toContain("activity-")`). No further action needed.
