# Dead Code Repurposing Analysis — WOTANN 2026-04-18

**Verdict: ZERO modules warrant deletion. Every file has salvageable value.**
Combined wiring effort: **~30-45 engineering hours** to recover **~3,600 LOC** of production-quality logic and close major Tier-1 feature gaps.

## Summary Table

| # | Module | LOC | Value | Recommendation | Effort |
|---|--------|-----|-------|----------------|--------|
| 1 | meet/coaching-engine.ts | 119 | HIGH | WIRE-AS-IS (post-meeting layer) | 2-3h |
| 2 | meet/meeting-pipeline.ts | 193 | HIGH | WIRE-AS-IS | bundled w/ #1 |
| 3 | meet/meeting-store.ts | 142 | HIGH | WIRE-AS-IS | 1h |
| 4 | autopilot/completion-oracle.ts | 288 | HIGH | REFACTOR-THEN-WIRE (Tier-1 verifier) | 3-4h |
| 5 | autopilot/pr-artifacts.ts | 276 | HIGH | WIRE-AS-IS (attach to `autofix-pr`) | 1-2h |
| 6 | computer-use/perception-adapter.ts | 316 | HIGH | WIRE-AS-IS (wraps PerceptionEngine for all providers) | 2-3h |
| 7 | skills/self-crystallization.ts | 172 | HIGH | WIRE-AS-IS (Tier-4 self-evolution) | 2h |
| 8 | channels/route-policies.ts | 412 | HIGH | WIRE-AS-IS (essential for 17 channels) | 3-4h |
| 9 | channels/auto-detect.ts | 390 | MEDIUM | REFACTOR-THEN-WIRE | 4-6h |
| 10 | channels/terminal-mention.ts | 116 | MEDIUM | WIRE-AS-IS (@terminal mention for CLI) | 1-2h |
| 11 | testing/visual-diff-theater.ts | 509 | HIGH | WIRE-AS-IS (Editor tab diff review) | 3-5h |
| 12 | agents/required-reading.ts | 152 | HIGH | REFACTOR-THEN-WIRE (extend YAML parser) | 2-3h |
| 13 | training/autoresearch.ts (no-op gen) | 441 | HIGH | REFACTOR-THEN-WIRE (real LLM generator) | 4-6h |
| 14 | kairos-rpc.ts getMeetingStore callback | — | HIGH | Populate from #3 | 30min |

## 1. meet/ Trilogy (coaching-engine + meeting-pipeline + meeting-store)

**Together these form the complete Omi-pattern meeting-assistant layer.**
- coaching-engine: Real-time coach with 6 templates (standup, 1:1, interview, presentation, retro, general), runs every 10s during active meeting
- meeting-pipeline: EventEmitter state machine (idle→listening→transcribing→coaching→ended), rolling 2-min window, `detectPlatform()` via `ps -eo comm`
- meeting-store: SQLite with FTS5 full-text search on transcripts, action_items table, WAL pragma

**Wiring plan**: Create `src/meet/meeting-runtime.ts` (~80 LOC) that composes all three. Instantiate in `KairosDaemon.start()`. Expose `getMeetingStore()`, plumb into `kairos-rpc.ts` `ext()` bridge so handler at line 5047 resolves. iOS Meet RPCs from Session 4 finally work.

## 4. autopilot/completion-oracle.ts (288 LOC)

**Multi-criterion task verification** — weighted scoring across 7 criteria: tests-pass / typecheck-pass / lint-pass / visual-match / browser-test / custom-command / llm-judge. Pass rule: `passedWeight/totalWeight ≥ threshold` AND all `required:true` pass.

**Critical for TerminalBench 83-95% target.** The `llm-judge` callback gives the autonomous loop a second-opinion model — exactly the verifier layer Tier-1 benchmark harness needs.

**Refactor needed**: add `evaluateCompletionFromEvidence(criteria, preCollectedEvidence)` to avoid re-running tests that executor already ran. Wire into `AutonomousExecutor` (line ~613) as optional `oracle: OracleConfig`.

## 5. autopilot/pr-artifacts.ts (276 LOC)

**Auto-generates conventional commit + PR description + labels** from `AutonomousResult`. Already has `wotann autofix-pr` CLI wired (index.ts:444) that only prints a fix-plan — this closes the gap to actually create the PR.

**Wiring**: Add `--create-pr` flag to `autofix-pr`. After autopilot runs, call `PRArtifactGenerator.generatePR()` + `gh pr create --title {title} --body {description}`.

## 6. computer-use/perception-adapter.ts (316 LOC)

**Model-universal perception adapter** — turns Desktop Control into a universal capability. Classifies models as `frontier-vision | small-vision | text-only`. Frontier gets raw screenshots + pixel coords; small-vision gets Set-of-Mark + element indices; text-only gets pure accessibility-tree text.

**HIGHEST-LEVERAGE dead-code file in the list.** Multiplies Desktop Control from ~3 providers (frontier vision only) to ~11 (all providers including bundled Gemma).

**Wiring**: Insert `PerceptionAdapter.adapt()` between `PerceptionEngine` and `ComputerAgent`. Extend `ProviderCapabilities` to emit `{vision, contextWindow}`. `generateSetOfMark` is a stub — add `sharp` for label overlays in follow-up.

## 7. skills/self-crystallization.ts (172 LOC)

**Auto-create SKILL.md from successful task runs** — Tier-4 self-evolution primitive. Redacts home paths + API keys + base64 + hex, slugifies prompt, writes `~/.wotann/skills/auto/<slug>.md` with `tier: experimental`.

Memory save 5962 confirmed it was implemented Apr 17 — but never wired!

**Wiring**: Hook into `AutonomousExecutor` success path (oracle returns `completed: true`), call `crystallizeSuccess({prompt, toolCalls, diffSummary, title})`. Registry scans `~/.wotann/skills/auto/*.md`. Gate on (a) task >N cycles or (b) diff touched >M files.

## 8. channels/route-policies.ts (412 LOC)

**Gabriel's explicit ask**: per-route policy engine for 17+ channels. Authentication (pairing, trusted-sender list, anonymous), rate limits, model tier preferences, device capabilities, response formatting, escalation rules.

**Wiring**: `KairosDaemon` instantiates `RoutePolicyEngine` alongside `ChannelGateway`. Seed via `createDefaultPolicy(channel)` for each adapter registration. `ChannelGateway.dispatch()` calls `engine.resolvePolicy(channel, senderId)` before executing. Custom policies load from `~/.wotann/channels.json`. Escalation feeds autopilot results into `evaluateEscalation()`.

## 9. channels/auto-detect.ts (390 LOC) — REFACTOR

Single source of truth for "which channels are available". The **daemon bypasses it** — kairos.ts:750-867 has ~150 lines of manual adapter wiring. `auto-detect.ts` only knows 4 of 13 adapters.

**Refactor**: Extend from 4 to 13 adapters. Split to `detectors.ts` (credential resolvers) + `factory.ts` (instantiation). Collapse daemon's manual block to one loop. Feature-flag rollout.

## 11. testing/visual-diff-theater.ts (509 LOC)

**Per-hunk accept/reject for the Editor tab.** Hunks with {id, file, startLine, endLine, oldLines, newLines, status, context}. API: acceptHunk / rejectHunk / acceptAll / rejectAll / applyAccepted / renderDiff. Immutable — produces new hunks on status change.

**Wiring**: Runtime service on `WotannRuntime` (new `diffTheater`). RPC: `diff.createSession`, `diff.acceptHunk`, `diff.applyAccepted`, `diff.render`. Agent write path captures `FileChange[]` → `diffTheater.createSession()` → UI renders per-hunk. Monaco editor in Tauri wires accept/reject buttons. CLI fallback via `wotann diff --session <id>`.

## 12. agents/required-reading.ts:loadRequiredReading (152 LOC)

**Agent-spec YAML support for `required_reading:` blocks** — lets agents declare files that must be loaded into system prompt before acting. Path resolution, per-file + total budget char caps (default 8K/40K), optional vs mandatory, XML-shaped renderer.

**The function is dead because `parseAgentSpecYaml` doesn't read the block.** Extend parser at `orchestration/agent-registry.ts:404` to recognize `required_reading:` list. Add `withRequiredReading(name, items)` to `AgentRegistry`. At dispatch, prepend `renderRequiredReadingBlock()` to system prompt.

## 13. training/autoresearch.ts (441 LOC)

**Karpathy-inspired autonomous code optimization loop.** Engine wired but `ModificationGenerator` is a **no-op** in production call sites. Violates Session 2 quality bar "honest stubs over silent success."

**Fix**: Write `src/training/llm-modification-generator.ts` (~200-300 LOC) with real LLM generator via `runtime.query`. Returns `null` after K rejected proposals (graceful termination). CLI: `wotann autoresearch --target <file> --metric <name> --max-cycles 20 --budget 300s`. Metric catalog: typecheck-passes, lint-count, bundle-size, token-count, benchmark-ms, test-pass-rate.

## 14. kairos-rpc.ts:4796,5047 — getMeetingStore callback

30-minute fix once #3 is wired. Populate the `ext()` adapter's `getMeetingStore: () => daemon.getMeetingStore()`. Remove the `?` from the type after store is guaranteed present. Add shape adapter `getMeeting(id): {transcript: string, segments}` that joins segments.

---

## Cross-Cutting Observations

### No module warrants deletion
Every file has either an immediate call site that was missed, or a clear tier-listed feature that needs it. Session 2 quality bar "honest stubs over silent success" is violated in 3 places (autoresearch no-op, getMeetingStore null callback, PerceptionEngine missing tier adaptation). Wiring fixes all three.

### Aggregate stakes
~3,600 LOC of ready-to-use code. Writing from scratch = 2-4 weeks. Wiring the whole list = 30-45 hours.

### Wiring order (dependency-ordered)
1. #14 + #3 (daemon MeetingStore + callback)
2. #1 + #2 (pipeline + coaching)
3. #4 (oracle) + #5 (pr-artifacts) (independent autopilot wins)
4. #6 (perception adapter) — unlocks all providers
5. #9 (auto-detect refactor) → #8 (route policies)
6. #7 (self-crystallization) — depends on #4
7. #12 (required-reading)
8. #13 (autoresearch generator)
9. #11 (visual diff theater)
10. #10 (terminal-mention) — low priority

### Risks
- Double test-run in #4 → mitigated by evidence-passing overload
- Channel regression in #9 → feature-flag rollout
- Diff fidelity in #11 → acceptable for launch, follow up with Myers' diff via `diff` npm package
