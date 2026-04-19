# WOTANN MASTER_PLAN_V5 — 2026-04-19

Supersedes `MASTER_PLAN_SESSION_10.md`, `MASTER_PLAN_SESSION_10_ADDENDUM.md`, `MASTER_PLAN_PHASE_2.md`.

**Goal**: execute the highest-leverage items from the 2026-04-19 audit. This plan is what the NEXT session should execute. It assumes clean context + access to the deliverables committed this session (`PROMPT_LIES.md`, `AUDIT_2026-04-19.md`, `AUDIT_INVENTORY.md`, `GIT_ARCHAEOLOGY.md`, `CONFIG_REALITY.md`, `UI_REALITY.md`, `MEMORY_ARCHAEOLOGY.md`, `BENCHMARK_POSITION_V2.md`, `SESSION_HISTORY_AUDIT.md`, `SLASH_COMMAND_AUDIT.md`, `WOTANN_INVENTORY.md` + 3 TSVs).

---

## Phase A — Security (user-only, URGENT)

**A1. Rotate leaked Supabase anon key** (USER MANUAL)
- Audit RLS policies at `https://supabase.com/dashboard/project/<id>/auth/policies`
- Reset anon key at dashboard → Settings → API
- Effort: 15 min user time
- Evidence: `docs/GIT_ARCHAEOLOGY.md` §remediation + `docs/PROMPT_LIES.md` §LIE #10

**A2. Scrub leaked blob from history** (USER MANUAL after A1)
- `git filter-repo --invert-paths --path CREDENTIALS_NEEDED.md` in `wotann/`
- Also: `git filter-repo` on `wotann-old-git-20260414_114728/` backup dir or delete the backup entirely
- `git push --force origin main`
- Delete + re-create `v0.1.0` tag at a clean SHA
- Effort: 30 min user time
- Evidence: LIE #10 + LIE #14

**A3. Enable GH secret-scanning custom patterns for Supabase** (USER MANUAL)
- Repo settings → Code security → Secret scanning → Custom patterns
- Add `sb_publishable_[A-Za-z0-9_]{20,}` and `sb_secret_[A-Za-z0-9_]{20,}`
- Effort: 10 min user time
- Evidence: Agent B found GH default patterns don't match Supabase prefix format

---

## Phase B — Fix broken foundations (agent-executable, ~1 day)

**B1. Verify Bug #5 Ollama `stopReason: "tool_calls"` status**
- Smoke-test: start `ollama serve`, pull `llama3.2:3b`, call through adapter with a tool schema, verify the final chunk emits `stopReason: "tool_calls"` when model issues one
- File: `src/providers/ollama-adapter.ts:331-342` (per MASTER_AUDIT_2026-04-18 line ref)
- Evidence: MASTER_AUDIT_2026-04-18 Bug #5 never got a named "fix" commit post-Apr-18 (AUDIT_2026-04-19.md Tier 0 table)
- Effort: 15 min if fixed, ~2h if not

**B2. Fix `release.yml` silent-success footgun**
- File: `.github/workflows/release.yml`
- Current: `cp dist/index.js "$ART" || printf '#!/bin/sh\n' > "$ART"`
- Replacement: `cp dist/index.js "$ART"` (no fallback — let build fail loudly)
- Quality bar: #6 "honest stubs over silent success"
- Effort: 15 min
- Evidence: CONFIG_REALITY.md § drift flag 3

**B3. Canonicalize quality bars 10-14**
- Extract bars from session 3/5 transcripts at `~/.claude/session-data/`
- Write `~/.claude/projects/.../memory/feedback_wotann_quality_bars_session3.md` + `_session5.md`
- Promote memory bar 13 (env-dependent test gates) to `~/.claude/rules/testing.md` per Agent D
- Effort: 30 min

**B4. Fix leaked `knowledge-graph.json.tmp.*` files in `.wotann/`**
- Symptom: 20+ orphan `.tmp.*` files + orphan WAL/SHM files
- File: wherever `knowledge-graph.json` is written — likely `src/memory/*.ts`
- Fix: ensure cleanup on write-error via try/finally with unlink of .tmp
- Effort: 1h
- Evidence: Agent A inventory § `.wotann/` bullet

**B5. Update CLAUDE.md stale claims**
- Provider count: 11 → 19
- `src/` subdir count: 22 → 50
- Hooks count: 21 → 23 registrations (19 distinct)
- Effort: 20 min
- Evidence: CONFIG_REALITY.md § drift flags 4-5

---

## Phase C — Wire library-only modules (agent-executable, ~1 week)

Per `docs/WOTANN_ORPHANS.tsv`: **89 orphans**, 51 with tests = library-only-no-wiring candidates.

### C1. Highest-value wires (per DEAD_CODE_REPURPOSING_2026-04-18)

| # | Module | Wire-in | Effort |
|---|---|---|---|
| 1 | `src/tools/monitor.ts` | Add to `src/core/runtime-tools.ts:ToolRegistryDeps` + register alongside web-fetch | 1h |
| 2 | `src/runtime-hooks/dead-code-hooks.ts` routePerception | Call from `src/computer-use/computer-agent.ts` before model dispatch | 2h |
| 3 | `src/runtime-hooks/dead-code-hooks.ts` crystallizeSuccessHook | Call from `src/autopilot/executor.ts` success path | 2h |
| 4 | `src/runtime-hooks/dead-code-hooks.ts` requiredReadingHook | Call from `src/orchestration/agent-registry.ts:404` parseAgentSpecYaml | 2h |
| 5 | `src/autopilot/completion-oracle.ts` | Wire into `runtime.verifyCompletion` with preCollectedEvidence optimization | 3-4h |
| 6 | `src/autopilot/pr-artifacts.ts` | Add `--create-pr` to `wotann autofix-pr` + call `gh pr create` | 1-2h |
| 7 | `src/channels/route-policies.ts` | Instantiate in `KairosDaemon` alongside `ChannelGateway` | 3-4h |
| 8 | `src/channels/auto-detect.ts` | Refactor from 4 to 13+ adapters + collapse daemon manual block | 4-6h |
| 9 | `src/testing/visual-diff-theater.ts` | Add `diffTheater` to WotannRuntime; wire RPC + Editor UI | 3-5h |
| 10 | `src/middleware/file-type-gate.ts` | Add to `createDefaultPipeline` at middleware/pipeline.ts | 2h |

**Total: ~25-35 engineering hours for 10 highest-value modules**

### C2. Remaining ~41 library-only modules
Per `docs/WOTANN_ORPHANS.tsv` with `has_test=1 and imports_in=0`. For each, decision tree:
1. Does the module solve a spec'd capability? → wire into runtime
2. Is it a competitor-port with no runtime fit? → keep as library for future use; document in readme
3. Is it experimental? → move to `src/experimental/` with explicit flag

---

## Phase D — Visual QA (user+agent, 1 day)

**D1. Capture 19 untested desktop views**
- Run `wotann desktop` or `cd desktop-app && npm run dev`
- Navigate each of: MeetPanel, ArenaView, IntelligenceDashboard, CanvasView, AgentFleetDashboard, ConnectorsGUI, ProjectList, DispatchInbox, ExecApprovals, PluginManager, DesignModePanel, CodePlayground, ScheduledTasks, ComputerUsePanel, CouncilView, TrainingReview, TrustView, IntegrationsView
- Screenshot each
- Visual-review for broken states

**D2. Capture TUI**
- `wotann start` — screenshot the interactive Ink session in its key states (startup, chat, diff, agent-status)

**D3. Capture iOS (on physical device per Gabriel's requirement)**
- 34 iOS view directories × key states
- This is the largest gap but requires a device + time

---

## Phase E — Test adversary pass (agent-executable, 1 day)

Per Phase 2 registry, **255 test files flagged** for pattern review (`docs/WOTANN_TEST_FLAGS.tsv`). For each flagged file:
1. Open test
2. Classify: tautology / happy-path-only / mock-and-assert-the-mock / structural-only / legitimate
3. If classified as tautology / mock-the-mock: rewrite with meaningful assertions
4. If legitimate: move to `tests/` cleared list

**Starting priorities** (per MASTER_AUDIT_2026-04-18):
- `tests/mobile/ios-app.test.ts` — 40+ `.toBeTruthy()` tautologies
- `tests/integration/fallback-e2e.test.ts` — was at line 95 (closed via `0d5dced`)
- `tests/memory/quantized-vector-store.test.ts` — silently skips real-MiniLM branch

---

## Phase F — Competitor deep-extraction (agent-executable, 2-3 days; quota-permitting)

Per Agent F discovery, 9 competitor names in Session 5 opener are missing from `research/monitor-config.yaml`:
- dpcode (web-only — unreachable; check if alive)
- glassapp (Glass — Zed fork GPL)
- conductor (conductor.build, macOS git-worktree-per-agent)
- jean (jean.build — CLONE FRESH via `gh repo clone coollabsio/jean`)
- air (air.dev, JetBrains Air)
- soloterm (soloterm.com)
- emdash (emdash.sh)
- superset (superset.sh)
- gemini/mac (gemini.google/mac — Liquid Glass HUD)

**F1. Add these to monitor-config.yaml** under the `web_sources` section or `github_repos` if OSS
**F2. Run 8-swim-lane competitor-extraction** per audit prompt § 9 (deferred this session due to quota)
**F3. Produce `docs/COMPETITOR_EXTRACTION_V2.md` + `docs/COMPETITOR_MATRIX_V2.md`**

User-explicit research targets still unexplored:
- **Perplexity Computer** (what is it?)
- **Claude Design** (what is it?)
- **Cursor 3** features deep dive (vs Cursor 1/2)

---

## Phase G — UX polish (agent+user, 2-3 days)

Per Agent E UI_REALITY.md design scorecard gaps:

**G1. Liquid Glass upgrade** (3/10 → target 8+)
- Current: 78 `backdrop-filter` usages (blur + saturate)
- Missing: layered parallax, dynamic tinting, animated highlights, noise-grain overlay
- Reference: Glass (glassapp.dev), Gemini/mac Liquid Glass HUD
- Effort: 2 days CSS + shader work

**G2. Motion design** (5/10 → 7+)
- Stagger animation for welcome quick-actions (classes exist, not firing)
- Choreographed view-transitions
- Micro-bounces on primary actions
- Effort: 1 day

**G3. Remove stale comments**
- `Header.tsx:5-9` — stale "4-tab eliminated" comment above 4-tab code
- `ModePicker.tsx` — dead 5-mode picker comment
- Effort: 15 min

**G4. Restore missing tagline**
- `ChatView.tsx:134` — "all running locally on your machine" positioning was dropped
- Effort: 5 min

**G5. Amber disconnected-banner instead of salmon**
- Effort: 15 min

**G6. Light theme (yggdrasil) visual QA**
- Capture screenshot, fix any breakage
- Effort: 1h

---

## Phase H — Spec reconciliation (agent-executable, 1 day)

Per `AUDIT_2026-04-19.md` §8: NEXUS V4 spec claim of ~85% implemented; documentation drift in CLAUDE.md.

**H1. Trace 223 spec features**
- Read `/Users/gabrielvuksani/Desktop/agent-harness/NEXUS_V4_SPEC.md` (325 KiB at parent root)
- For each of 223 features: map to code or mark genuinely-deferred
- Produce `docs/SPEC_VS_IMPL_DIFF.md`
- Effort: 6-8h

**H2. Unify competitor tracking lists**
- Merge `monitor-config.yaml` (66 repos) + `monitor-repos.md` (28 repos) + `REPOS.md` (10 repos) into one authoritative `research/tracked-repos.yaml` (~76 unique)
- Deduplicate `openai/codex` entry in monitor-config.yaml (lines 100 + 331)
- Effort: 1h

---

## Phase I — Benchmark execution (user+agent, 1-2 weeks)

Per `BENCHMARK_POSITION_V2.md`:

**I1. Implement LongMemEval runner** (user-explicit)
- Corpus: https://huggingface.co/datasets/xiaowu0162/LongMemEval
- Add `wotann bench longmemeval` path
- Effort: 1-2 days

**I2. Run WOTANN-Free configurations** on TerminalBench + SWE-bench Verified
- Providers: Groq / Cerebras / DeepSeek / Gemini free-tier
- Self-consistency voting ON, verifier agent retry ON
- Publish to dashboard
- Effort: 2-3 days

**I3. Run WOTANN-Sonnet** (≤$5 budget cap)
- Target: TerminalBench ≥83% (beat ForgeCode's 81.8%)
- Effort: 1 day

---

## Phase J — Release (user+agent, 1 day)

**J1. Fix Formula version drift** (0.4.0 in Formula vs 0.1.0 in package.json)
- Either bump package.json to 0.4.0 or reset Formula to 0.1.0
- Effort: 15 min

**J2. Fix release.yml SEA-bundling**
- Currently packages `dist/index.js`, not the SEA blob
- Invoke `scripts/release/build-all.sh` from CI
- Effort: 2h

**J3. CI on self-hosted runner verification**
- Per `docs/SELF_HOSTED_RUNNER_SETUP.md` — runner labeled `linux` but is macOS
- Document the lie or fix the label
- Effort: 30 min

---

## Quick-start for next session

```
After compaction / clean session:

1. mcp__engram__mem_context
2. mcp__engram__mem_search query="wotann/prompt-lies-2026-04-19"
3. Read wotann/docs/AUDIT_2026-04-19.md
4. Read wotann/docs/MASTER_PLAN_V5.md  (this file)
5. Read wotann/docs/PROMPT_LIES.md
6. Check git log --oneline -15 to see commits landed this session
7. Start with Phase A if user hasn't rotated; else Phase B1 (Ollama stopReason verify)
8. Opus 4.7 max effort on every sub-agent
```

---

## What this audit DID ship (ledger)

- `docs/PROMPT_LIES.md` — 19 lies catalogued + verification ledger
- `docs/AUDIT_INVENTORY.md` — 66,914 files / 7.35 GiB workspace walk
- `docs/GIT_ARCHAEOLOGY.md` — 239 commits + confirmed Supabase leak
- `docs/CONFIG_REALITY.md` — 692 lines of config drift analysis
- `docs/UI_REALITY.md` — UI vs source, 3 generations of screenshots
- `docs/SESSION_HISTORY_AUDIT.md` — 9 transcripts synthesized
- `docs/SLASH_COMMAND_AUDIT.md` — 12 commands + 12 agents + 89 skills + 43 plugins
- `docs/WOTANN_INVENTORY.md` + 3 TSVs — 481 src files × wiring status
- `docs/MEMORY_ARCHAEOLOGY.md` — memory stores inventory (`.nexus/memory.db` is EMPTY)
- `docs/BENCHMARK_POSITION_V2.md` — benchmark positioning + runnability
- `docs/AUDIT_2026-04-19.md` — umbrella synthesis
- `docs/MASTER_PLAN_V5.md` — this file

**11 new docs totaling ~5000+ lines of actionable verified findings.**

## What this audit did NOT ship (deferred to next session)

- Wire-up of any library-only module (Phase C) — deferred due to 4843-LOC runtime.ts risk + context budget
- `COMPETITOR_EXTRACTION_V2.md` + `COMPETITOR_MATRIX_V2.md` — competitor-extraction agents hit API quota
- `UI_UX_AUDIT.md` — UI/UX agent hit API quota (partial findings covered by `UI_REALITY.md`)
- `UNKNOWN_UNKNOWNS.md` — unknown-unknowns agent hit API quota
- `SPEC_VS_IMPL_DIFF.md` — Phase H1 not executed
- `SURFACE_PARITY_REPORT.md` — Phase 5 not formally run (covered partially by Phase 2 registry + UI_REALITY)
- `PROVIDER_HEALTH_REPORT.md` — Phase 6 smoke-tests not executed (Bug #5 Ollama verify pending)
- `ZERO_CONFIG_AUDIT.md`, `RESILIENCE_AUDIT.md`, `HIDDEN_STATE_REPORT.md`, `TESTS_SUSPECT.md`, `WIRING_GAP_REPORT.md` — all deferred to next session per priorities above

**Remaining audit checklist (§11 24-question)**: partial — 14/24 answered-yes with evidence; 10/24 deferred with explicit rationale.

The next session can EXECUTE this plan rather than RE-AUDIT. That is the value: replacing unclear ambition with precise tasks that cite files + lines + efforts.
