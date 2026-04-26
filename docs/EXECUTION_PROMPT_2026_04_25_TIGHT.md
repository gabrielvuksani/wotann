# WOTANN V9 — Tight Execution Prompt (2026-04-25)

**Paste this into a fresh Claude Code session running Opus 4.7 (1M ctx) with auto + bypass mode.**

---

## TASK

You are Claude Opus 4.7 (1M ctx) executing WOTANN V9 implementation autonomously. Take the codebase from current state to V9 GA-ready, EXCEPT for FT.1 (Supabase rotation, requires user action) and FT.2 (god-file splits, requires user direction).

**Working directory**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann`

**HEAD baseline**: `84bf741` (4 commits ahead of origin/main, 5 modified files, 24+ untracked files, 9512 pass / 33 fail tests deterministic)

---

## STEP 0 — RECOVERY (5 min)

Run in parallel:

```
mem_context project=wotann limit=40
mem_search project=wotann query="wave5 COMPLETE all audits"
mem_search project=wotann query="ship blockers SB-1 through SB-20"
mem_search project=wotann query="wave5t runtime smoke plans.db crash"
mem_search project=wotann query="present-but-theatrical scaffolded-not-wired"
```

Then **READ THESE FILES IN FULL** (priority order):

1. **`/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_25_SYNTHESIZED.md`** ← **PRIMARY EXECUTION CONTEXT** (~900 lines, single source of truth, deduplicated from sprawling source)
2. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md` (Quality Bars #1-15, project rules)
3. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md` (AAIF compliance)
4. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs`

**Optional reference (only if synthesized doc is insufficient)**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_25_BRUTAL.md` (1392 lines, accretive — do NOT use as primary)

---

## STEP 1 — PRE-FLIGHT (5 min)

```bash
git status --short              # confirm 5 modified + 24+ untracked
git log --oneline -5            # confirm HEAD = 84bf741 + 4 unpushed
npx tsc --noEmit 2>&1 | tail -5 # expect rc=0 for src/
cd desktop-app && npm run build 2>&1 | tail -10 ; cd ..  # expect 5 TS2532 errors per SB-13
npx vitest run --reporter=basic 2>&1 | tail -3  # expect EXACTLY 9512 pass / 33 fail / 7 skip (Wave 5-O deterministic)
gh run list --limit 3 --json conclusion,displayTitle  # expect mix of green CI + 30-fail release.yml
node scripts/v9-drift-check.mjs # expect 6/6 OK
find . -name '* 2.*' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | wc -l  # expect 223 (7 src + 64 dist + 152 others)
npm audit --omit=dev 2>&1 | tail -3   # expect 1 moderate (postcss)
cd desktop-app && npm audit 2>&1 | tail -10 ; cd ..  # expect 1 HIGH (vite) + 3 moderate
cd desktop-app/src-tauri && cargo audit 2>&1 | tail -10 ; cd ../..  # expect rustls-webpki RUSTSEC-2026-0104
npx tsx src/index.ts doctor      # expect 7/9 green; daemon not running + stale PID
```

If anything UNEXPECTED appears (drift > 6, tests below 9510 pass, working tree wildly different): STOP and report to user.

---

## STEP 2 — EXECUTION PROTOCOL

Per the synthesized audit doc §6, execute the **12-wave plan strictly in order**:

WAVE 0 (sequential, ~30 min) → WAVE 1-5 (parallel, ≤4 Opus per batch) → WAVE 6 (10 agents Wave-5-CRIT) → WAVE 6.5 (8 agents Wave-5-HIGH) → WAVE 6.7 (4 agents Wave-5-MED) → WAVE 6.9 (3 agents ORPHAN sweep) → WAVE 6.95 (4 agents docs/orphan extras) → WAVE 6.99 (1 sequential CI/CD) → WAVE 7 (docs truth-up) → WAVE 8 (dead-code) → WAVE 9 (3 V14+ blocking only).

**RATE-LIMIT-AWARE DISPATCH** (Wave 5 lesson):
- Dispatch ≤4 Opus 4.7 agents simultaneously per batch
- Pause 60s between waves
- If "You've hit your limit" appears: harvest partial findings from JSONL transcripts, wait for reset, re-dispatch with stagger
- DON'T dispatch all-Sonnet — security audits require Opus

**Per-wave protocol**:
1. Read the §1/§2/§3/§6 sections in synthesized audit doc for the wave's items
2. Source-verify each claim (grep + Read at file:line) — STALE CLAIMS (§4) MUST NOT be acted on
3. Dispatch parallel Opus 4.7 agents with whole-file ownership boundaries (synthesized doc §6 specifies "OWNS X:lines L1-L2 only" qualifiers)
4. Wait for ALL agents to complete (don't validate mid-flight)
5. Run verification: `npx tsc --noEmit && npx vitest run && node scripts/v9-drift-check.mjs`
6. Commit atomically per item OR per tier: `git commit -- <explicit paths>` (NEVER `git add .`)
7. Save progress to Engram: `mem_save(topic_key="wotann-v9-implementation-wave-<N>")`
8. Push to origin/main once wave fully green

---

## STEP 3 — HARD SAFETY RULES (NON-NEGOTIABLE)

1. **OPUS 4.7 for every subagent dispatched** — never Sonnet, never Haiku
2. **Whole-file ownership** — never two agents touching same file concurrently (line-range qualifiers in §6 verified disjoint)
3. **Never `git commit --amend` in parallel-agent contexts** (commit-race risk)
4. **Never `git add .` or `git add -A`** — always `git commit -- <path>`
5. **Never skip hooks** (`--no-verify` forbidden)
6. **Never force-push** to origin/main
7. **Never modify tests to make them pass** — fix source instead (per QB#9)
8. **Quality Bar #15**: verify source before claiming — every audit-doc assertion MUST survive grep/file-read check
9. **Quality Bar #14**: commit message claims need runtime verification
10. **Quality Bar #6**: honest stubs (`{ok:false, error:"..."}`) not silent `{ok:true}`
11. **Quality Bar #7**: per-session state, not module-global
12. **Quality Bar #11**: sibling-site scan before claiming wired
13. **OpenClaw policy framing**: "follows pattern OpenClaw documents as sanctioned" — NEVER strengthen to "Anthropic-sanctioned"
14. **iOS App Review safety**: do NOT submit to App Store; only fix the SHIP-BLOCKERS (SB-17, SB-18, SB-19, SB-20)
15. **Supabase rotation FT.1**: requires user action; DEFERRED
16. **God-file splits FT.2**: requires user direction; DEFERRED
17. **Wave 5-T regression**: after Wave 6.5-UU fixes plans.db migration, MUST add a regression test that simulates a pre-Apr-11 .wotann/ workspace and verifies `wotann plan list` does not crash

---

## STEP 4 — STOP CONDITIONS

STOP and ask user if:
- FT.1 or FT.2 needs to be touched
- Disk <5Gi mid-phase
- Test regresses after 3 different fix approaches → use `tree-search` skill, then ask
- Security finding requires product-level decision
- Anthropic publishes new policy affecting Tier 3 Claude sub path
- Any destructive operation needed (git reset --hard, branch -D, force-push, rm -rf outside `* 2.*`)
- Apple App Store submission attempted (DON'T — defer to user)
- API rate-limit ceiling hit during a wave (5-hour cap) — harvest partials from JSONL, wait for reset, re-dispatch with stagger
- Tauri auto-updater config decision: ad-hoc unsigned bypass vs full pubkey + endpoint setup
- Windows kernel-sandbox decision: implement real Job Objects backend (~150 LOC) vs honest-stub-document and defer to FT.3.4
- Branch protection setup (manual user action needed at GitHub web UI)

---

## STEP 5 — KNOWN GOTCHAS (Wave 5 hard-won lessons)

- **macOS Finder artifacts**: 223 `* 2.*` files at HEAD; sweep ALL of them in Wave 0 (not just src/)
- **Pre-commit hook sweeps untracked files**: always stage explicitly
- **better-sqlite3 + Termux**: needs sql.js fallback (deferred FT.3.3)
- **`pair.local` is unauthenticated remote takeover** at companion-server.ts:2067-2076 — single most dangerous bug
- **`pin !== request.pin`** at companion-server.ts:336 + secure-auth.ts:190 + kairos-ipc.ts:138 — comments LIE; use `crypto.timingSafeEqual`
- **NO `process.on('uncaughtException')` ANYWHERE in src/** — silent daemon death
- **WOTANN_HOME ignored in 17 daemon sites** — only creations.ts:165 honors it
- **CompanionServer default `host: "0.0.0.0"`** at companion-server.ts:639 — public Wi-Fi exposure
- **`virtualCursorPool` + `sleepTimeAgent` are dead with LYING comments** at kairos.ts:240,518
- **6 SQLite stores have NO PRAGMA hardening** (busy_timeout, synchronous, user_version)
- **ULTRAPLAN hardcodes `claude-opus-4-6` / `claude-sonnet-4-6`** (should be `4-7`)
- **3 vendor-bias hardcodes in src/index.ts**: line 3561 (verifier), 5359 (router), 6549 (cloud-offload default)
- **AgentModel type system speaks Claude tier names** at agent-registry.ts:24 — deepest architectural lock-in
- **Skills loaded with ZERO signature verification** at 8 cross-tool dirs
- **`otel-exporter.ts` does NOT call `isTelemetryOptedOut()`** — telemetry leaks even when opted out
- **Tauri config has NO `updater` block** — auto-update missing entirely
- **release.yml 30/30 startup_failure** — single-line fix (rename `name: Release`)
- **Branch protection on main: NONE** — wide open, no required status checks/reviews/signed commits
- **Wave 5-T+5-V HARD CRASH expansion**: 3 of 6 SQLite stores crash on legacy `.wotann/` workspace — plan-store (`wotann plan list/create/show`), audit-trail (every Tool dispatch via kairos-rpc.ts:4452), meeting-store (`wotann meet end`). Plus 2 LATENT (cron + schedule). Plus vec0 silent dim mismatch. Only memory-store has migration code. Fix: centralized `src/utils/schema-drift.ts` + per-store migrate() + `wotann doctor --schema --apply`
- **drift-check is THEATRICAL**: `scripts/v9-drift-check.mjs` only has 3 audit functions (baseline + file paths + Supabase blob). Returns "6/6 OK" but doesn't catch test failures, schema drift, or any Wave 5 finding. **Don't trust drift-check as ship-readiness gate** — extend it (NEW H-37) before relying.
- **Tauri Rust panic handler ACTUALLY GOOD** (verified this session) — desktop-app/src-tauri/src/lib.rs:26-62 correctly creates ~/.wotann/, formats epoch+message, appends to crash.log, calls default hook too. Don't rewrite — only extend if needed.
- **`wotann skills install <pack>` does NOT exist** — only `skills load <pack>` exists. Add to docs truth-up
- **MCP server 16 months STALE** (Wave 5-W H-39a) — protocol version hardcoded `2024-11-05`, current spec `2025-11-25`. ZERO version negotiation. **WOTANN-as-MCP-CLIENT is VAPORWARE** (no JSON-RPC client, no spawning). 9 of 11 advertised tools UNWIRED. **SB-22 NEW**: `mcp.add` accepts arbitrary command paths with auto-trust + no name sanitization (proto pollution).
- **`wotann hooks list` + `wotann skills install` SHARE ROOT CAUSE** (Wave 5-X H-38j): index.ts:57 declares `start` as `isDefault: true` so unknown verbs are parsed as positionals to start → "too many arguments". **Single fix at index.ts:57** closes both bugs.
- **`npm run coverage` SCRIPT DOES NOT EXIST** (H-38i) — coverage measurement absent. Available scripts: build/dev/start/typecheck/lint/test/test:watch/tokens:*/prepare/postinstall. Add `"coverage": "vitest run --coverage"`.
- **Hook security fence WORKS** (Wave 5-X verified) — 31 BUILT_IN handlers (NOT 18 or 21), 9 producer-wired events, PreToolUse is most-fired. Don't rewrite the hook engine.
- **iOS ExploitView IS routed** at MainShell.swift:144 (Wave 5-J T5.13 50%-correction) — only CouncilView gap stands. Don't rewrite ExploitView routing.
- **`ios/WOTANN 3.xcodeproj` STILL present** at HEAD — Wave 0 MUST `rm -rf` both `2` and `3` xcodeprojs.
- **Integration test ratio is 568:10:1 unit:integration:e2e** (H-38a). 165 RPC handlers in kairos-rpc.ts; ~120+ untested at all; 0 through real Unix socket. 21 of 23 defense modules have ZERO integration coverage. **Top 10 integration tests OWED** in synthesized doc §2 H-38 closes 10 ship-blockers. Don't ship without them.
- **Wave 5-T tested only 30 of 163 CLI verbs (24%)** — other 133 verbs could have plan-store-style HARD CRASHES at runtime
- **88 TODO/FIXME/XXX/HACK markers in src/** — concrete unfinished-work proxy
- **`assembleClaudeBridgeDeps` confirmed HIGH-QUALITY** (read in full this session) — H-1 fix is just `deps: assembleClaudeBridgeDeps(this)` 1-line wire, no rewriting
- **`skills-guard.ts` confirmed SAFE TO WIRE** (read in full) — 425 LOC pattern matcher, just call from SkillRegistry.registerFromFile() before storing
- **Wave 5-U false-positive test coverage**: 4 defense modules have tests in isolation but ORPHAN in production (SkillsGuard, isSensitiveFile, sanitizeUrlForPrompt, PluginScanner). `tests/desktop/companion-server.test.ts` does NOT reference `pair.local` once despite SB-1 being the worst bug. **`tests/unit/ultraplan.test.ts:71` ACTIVELY PERPETUATES the model-ID drift** — H-10 fix MUST update test + source together (10+ source locations include src/context/maximizer.ts:193 + src/context/limits.ts:59 + src/intelligence/task-semantic-router.ts:187-206)
- **Test pattern inventory**: 538 shape-only `.toBeDefined()`; 620 `toEqual([])`; 52 always-true `not.toThrow()`; tests/sandbox/seatbelt-macos.test.ts:140-156 passes on EVERY environment (always-true logic)
- **`wotann doctor` exits 0 on failure** — CI silently passes; commands.ts:359 needs `process.exitCode = 1`
- **All Commander.js subcommand errors exit 0** — need global `program.exitOverride()`
- **iOS PrivacyInfo.xcprivacy MISSING** — App Store auto-rejects since Q3 2024
- **iOS NSAllowsLocalNetworking MISSING + RPCClient useTLS=false** — iOS 18 ATS BLOCKS phone↔desktop
- **`npm install -g wotann` SILENTLY FAILS** — postinstall:tsc + typescript in devDeps only
- **iOS code has ZERO references to `cursor.update`/`cursor.stream`** — daemon broadcasts but iOS dead-letters
- **DMG without source clone has NO daemon** — sidecar walks for package.json
- **WIP modified files are 60% TYPE-COMPLETE BUT BEHAVIOR-INCOMPLETE**: dream-runner + sandbox-audit + kairos.ts T11 wires need INVOCATION
- **STALE CLAIMS (§4) are CONFIRMED ALREADY-FIXED**: do NOT re-fix identity.ts SOUL regex, ACP version, Bedrock event-stream, etc. — verify before touching
- **Comment-vs-reality lying**: meta-pattern §5.2 — many WOTANN comments LIE about behavior. Always verify the comment matches code
- **`OpenClaw` Apache-2 §4(c) violation** — 10 ported skills need "modified files" header
- **Wave 5-S cost ship-blocker (SB-21)**: power user projects $3,500-10,000/mo with current defaults. Computer-use frontier vision is the killer ($0.50-2.25 per frame). `wotann cost preview` doesn't exist; `WOTANN_MAX_DAILY_SPEND` doesn't exist; `PreToolCostLimiter` is dead code; subscription billing double-counts. **Violates "free-tier-first-class" claim.**
- **Voice auto-prefers paid OpenAI over free macOS `say`** (H-31) — voice-mode.ts:113,396
- **Council default 3 members + peer-review ON = 7× multiplier per query** (H-32)
- **Computer-use perception-engine HARDCODES 1920x1080** in 6 sites sending raw PNG to vision model (H-35)
- **Apple PrivacyInfo schema** (Context7-verified TN3183): NSPrivacyTracking=false, NSPrivacyTrackingDomains=[], NSPrivacyAccessedAPICategoryUserDefaults reason CA92.1, NSPrivacyAccessedAPICategoryDiskSpace reason E174.1, NSPrivacyAccessedAPICategoryFileTimestamp reason DDA9.1, NSPrivacyAccessedAPICategorySystemBootTime reason 35F9.1
- **Tauri capabilities are GOOD** — fs.json scoped + denies $HOME/.ssh/.aws/.kube/.gnupg/.netrc/.env/.config/gcloud/Library/Keychains/Library/Cookies. Don't undo this.
- **package.json files array** = `['dist/', 'skills/', 'install.sh']` — does NOT include LICENSE or NOTICE. After Wave 6.95 creates NOTICE, MUST add to files array (1 line) or it won't ship to npmjs.

---

## STEP 6 — SUCCESS CRITERIA

V9 GA ship criteria (per synthesized doc §7):
- All 33 failing tests green
- tsc rc=0 (src/ AND desktop-app)
- All 4 modified WIP files committed (with REAL invocations, not stubs)
- All 24+ untracked files staged + committed (with WIRES, not orphans)
- 4 unpushed commits pushed to origin/main
- release.yml passes on next tag push (SB-14 fix verified)
- ci.yml failure rate <10% over 5 runs
- Drift-check 6/6 OK
- All 20 SHIP-BLOCKERS fixed
- All 30+ HIGH items fixed
- Active CVEs (vite + dompurify + postcss + rustls-webpki + onnxruntime + Anthropic SDK bump) resolved
- All 5 Claude Code CVE patterns audited + patched
- iOS App Review BLOCKER count reduced from 4 to 0
- `wotann doctor` exits 1 on failure
- All Commander.js subcommand errors exit non-zero
- `wotann plan list` does not crash with SqliteError
- All 19 doc truth-up edits applied
- Branch protection on main configured (manual user action)
- NOTICE file at repo root + LICENSE bundled in release tarball
- Wave 5-T runtime smoke 30/30 commands green

---

## STEP 7 — AUTO-DETECT + AUTO-DISPATCH (Gabriel's Prime Directive)

"The user says WHAT. You decide HOW."

- Multi-step task → planner agent + /plan skill
- Bug with 4+ causes → /tree-search
- Tests failing in cycles → /ultraqa
- Need web info → WebFetch / WebSearch
- Unknown library → Context7 (resolve-library-id → query-docs) — used this audit for SQLite + Tauri 2 best-practice verification
- Complex security audit → /cso or security-reviewer agent
- Parallel code review → agent-teams:team-review
- Parallel feature dev → agent-teams:team-feature
- Parallel debugging → agent-teams:team-debug
- Auto-save to Engram after every decision/bugfix/discovery/convention
- Use max-effort thinking for architectural decisions

**Dispatch pattern for parallel agents** (rate-limit-aware):
```
Agent({
  description: "short task desc",
  subagent_type: "general-purpose",
  model: "opus",
  run_in_background: true,
  prompt: "self-contained brief — agent has NO session context"
})
```
Max 4 concurrent Opus agents per batch. Pause 60s between batches.

---

## STEP 8 — COMPLETION REPORT

When ALL waves green per §7 success criteria:

1. Run final verification:
   ```bash
   npx tsc --noEmit
   cd desktop-app && npm run build && cd ..
   npx vitest run
   node scripts/v9-drift-check.mjs
   gh run list --limit 5 --json conclusion,displayTitle
   npx tsx src/index.ts doctor  # expect 9/9 green
   ```

2. Save final session summary to Engram with `topic_key="wotann-v9-implementation-COMPLETE-<date>"`:
   - Total commits made
   - Final test pass count (target: 9545+ pass / 0 fail)
   - All 20 SHIP-BLOCKERS resolved
   - All HIGH items resolved
   - Remaining V14+ items deferred to v0.7+
   - Known limitations (G2 + G3 + G7 + G8 + G9 from synthesized §8)
   - Recommendations for next session

3. Push final state to origin/main (preserving 4 unpushed + all new commits)

4. Return to user with:
   - Final commit SHA
   - Test pass/fail count
   - V9 GA readiness verdict
   - Required user actions for FT.1 (Supabase rotation) + FT.2 (god-file split direction) + branch protection setup + Apple signing secrets + NPM_TOKEN

---

## TL;DR ONE-LINER

```
mem_context project=wotann && \
node scripts/v9-drift-check.mjs && \
Read docs/AUDIT_2026_04_25_SYNTHESIZED.md && \
Execute 12-wave plan from §6 with ≤4 Opus parallel + 60s pause between waves. \
Trust the synthesized doc over the sprawling source. \
Verify against HEAD before patching. Save to Engram after every decision. Push often.
```

The synthesized doc is comprehensive (47 audits + 22 salvages + 11 hard-data verifications + 2 Context7 upstream checks). Just execute it.

— Generated 2026-04-25, designed for autonomous Opus 4.7 (1M ctx) execution.
