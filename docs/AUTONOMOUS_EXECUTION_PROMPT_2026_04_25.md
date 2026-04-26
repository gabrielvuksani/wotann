# WOTANN V9 — Autonomous Execution Prompt for Claude Code (2026-04-25)

**Use this verbatim** to launch a fresh Claude Code session that executes the V9 implementation plan end-to-end without supervision.

---

## INSTRUCTIONS FOR THE LAUNCHING USER

Paste the entire `## TASK` block below into a new Claude Code session running with `Opus 4.7 (1M ctx)` and **maximum effort + auto mode + bypass mode**. Confirm the session has these capabilities before proceeding:
- Engram memory MCP (mcp__engram__*)
- claude-mem search MCP
- Read/Write/Edit/Bash/Agent dispatch tools
- WebSearch + WebFetch + Context7 MCP
- ~100 GB free disk

---

## TASK

You are Claude Opus 4.7 (1M ctx) executing WOTANN V9 implementation autonomously. Your job is to take the codebase from current state to V9 GA-ready, EXCEPT for FT.1 (Supabase rotation, requires user action) and FT.2 (god-file splits, requires user direction).

**Working directory**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann`

**HEAD baseline at audit time**: `84bf741` (4 commits ahead of origin/main, 5 modified files, 24 untracked files, 9512 pass / 33-35 fail tests, tsc rc=0 for src/ but desktop-app `npm run build` FAILS)

---

### STEP 0 — RECOVERY (mandatory, first 5 minutes)

Run these in parallel:

```
mem_context project=wotann limit=40
mem_search project=wotann query="wave4 cross-audit synthesis"
mem_search project=wotann query="tier3 keystone deps assembleClaudeBridgeDeps"
mem_search project=wotann query="ios app review blockers entitlements"
mem_search project=wotann query="33 failing tests root cause"
mem_search project=wotann query="wave5 COMPLETE all 11 audits"
mem_search project=wotann query="pair.local browser RCE chain CSWSH"
mem_search project=wotann query="bridge double orphan ClaudeInvokeOptions"
mem_search project=wotann query="SkillsGuard never called present-but-theatrical"
mem_search project=wotann query="91% non-atomic JSON writes"
```

Then **READ THESE FILES IN FULL** (use Read with offset+limit chunks for the 220KB plan):

1. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_25_BRUTAL.md` ← **PRIMARY EXECUTION CONTEXT**
2. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MASTER_PLAN_V9.md` (4022 lines) ← reference for tier semantics
3. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md` (Quality Bars #1-15, project rules)
4. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md` (AAIF compliance, tooling)
5. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs` (drift detection)

Then query the 28 Engram topic_keys listed in §10 of AUDIT_2026_04_25_BRUTAL.md for full audit details (use mcp__engram__mem_get_observation by ID after mem_search returns IDs).

### STEP 1 — VERIFY CURRENT STATE (pre-flight, 5 min)

```bash
git status --short              # confirm 5 modified + 24+ untracked
git log --oneline -5            # confirm HEAD = 84bf741 + 4 unpushed
npx tsc --noEmit 2>&1 | tail -5 # expect rc=0 for src/
cd desktop-app && npm run build 2>&1 | tail -10 ; cd ..  # expect 5 TS2532 errors per §3.1.6
npx vitest run --reporter=basic 2>&1 | tail -3  # expect EXACTLY 9512 pass / 33 fail / 7 skip (Wave 5-O 3-run reproduction confirmed deterministic — NOT 35)
gh run list --limit 3 --json conclusion,displayTitle  # expect mix of green CI + 30-fail release.yml
node scripts/v9-drift-check.mjs # expect 6/6 OK
df -h /System/Volumes/Data | tail -1  # expect >5Gi free
find . -name '* 2.*' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | wc -l  # expect 223 (7 src + 64 desktop-app/dist + 152 others)
npm audit --omit=dev 2>&1 | tail -3   # expect 0 vulns (postcss FIXED since Wave 4-A)
cd desktop-app/src-tauri && cargo audit 2>&1 | tail -10 ; cd ../..  # expect rustls-webpki RUSTSEC-2026-0104 + atk unmaintained warning
```

If anything UNEXPECTED appears (drift > 6, tests below 9510 pass, working tree wildly different): STOP and report to user before proceeding.

### STEP 2 — EXECUTION PROTOCOL

**Per the audit doc §5**, execute the 12-wave plan strictly in order:

- **WAVE 0**: atomic / sequential / main-thread (release prereqs — push commits, stage WIP, cleanup duplicates)
- **WAVE 1-5**: parallel agents with strict file ownership (8-12 agents each wave). NEVER two agents on same file. Use audit doc §5 file-ownership boundaries verbatim.
- **WAVE 6**: multi-device/UX + Wave 5 CRITICAL fixes (10 agents — pair.local auth + uncaught-exception + WOTANN_HOME helper + host:127.0.0.1 + persistence)
- **WAVE 6.5**: Wave 5 HIGH fixes (8 agents — tick reentrancy + SQLite hardening + ULTRAPLAN model bump + vendor-bias + skill signing + opt-out gate + cross-platform sandbox/python3/audio)
- **WAVE 6.7**: Wave 5 MEDIUM fixes (4 agents — virtualCursor wire + GC sweep + async cleanup + DST UTC + cleanup pass)
- **WAVE 7**: documentation truth-up (1 agent — sync AGENTS.md / README / SECURITY.md / CLAUDE.md / CHANGELOG / ROADMAP)
- **WAVE 8**: dead code cleanup (1 agent — only after all green)
- **WAVE 9**: V14+ new items (defer to v0.7+, but apply 3 BLOCKING items from §3.16 before V9 GA: Opus 4.7 model-router strip + Anthropic SDK 0.2.117 bump + June 15 retirement audit)

**RATE-LIMIT-AWARE DISPATCH PROTOCOL** (Wave 5 lesson):
- Dispatch ≤4 Opus 4.7 agents simultaneously
- Use Sonnet 4.6 for non-adversarial audits (UX, drift, license, docs, consistency)
- Use Opus 4.7 for security/architecture/adversarial only
- Between waves: pause 60s to let token-budget recover
- If "You've hit your limit" appears: harvest partial findings from JSONL transcripts, re-dispatch after reset

**Per-wave protocol**:

1. Read the §3.X subsection in audit doc for the items in this wave
2. Source-verify the claim (grep + Read at file:line) — STALE CLAIMS (§2) MUST NOT be acted on
3. Dispatch parallel Opus 4.7 agents with whole-file ownership boundaries via Agent tool with `subagent_type: "general-purpose"`, `model: "opus"`, `run_in_background: true`
4. Wait for ALL agents to complete (don't validate mid-flight per session #461 lesson)
5. Run verification: `npx tsc --noEmit && npx vitest run && node scripts/v9-drift-check.mjs`
6. Commit atomically per item OR per tier: `git commit -- <explicit paths>` (NEVER `git add .`)
7. Save progress to Engram: `mem_save(topic_key="wotann-v9-implementation-wave-<N>")`
8. Push to origin/main once wave fully green

**Use these skills automatically when triggered**:
- `superpowers:dispatching-parallel-agents` for every wave
- `superpowers:test-driven-development` for failing-test fixes
- `superpowers:systematic-debugging` for any unexpected failure
- `superpowers:verification-before-completion` before claiming any wave done
- `verify` skill for final acceptance against §8 success criteria
- `agent-teams:team-feature` for parallel feature dev with file ownership
- `tree-search` for any 4+-cause bug
- `ultraqa` if tests fail in cycles

### STEP 3 — HARD SAFETY RULES (NON-NEGOTIABLE)

1. **OPUS 4.7 for every subagent dispatched** — never Sonnet, never Haiku
2. **Whole-file ownership** — never two agents touching same file concurrently
3. **Never `git commit --amend` in parallel-agent contexts** (commit-race risk)
4. **Never `git add .` or `git add -A`** — always `git commit -- <path>`
5. **Never skip hooks** — `--no-verify` forbidden
6. **Never force-push** to origin/main — protected branch
7. **Never modify tests to make them pass** — fix source instead
8. **Quality Bar #15**: verify source before claiming — every audit-doc assertion MUST survive grep/file-read check
9. **Quality Bar #14**: commit message claims need runtime verification
10. **Quality Bar #6**: honest stubs (`{ok:false, error:"..."}`) not silent `{ok:true}`
11. **Quality Bar #7**: per-session state, not module-global
12. **Quality Bar #11**: sibling-site scan before claiming wired
13. **OpenClaw policy framing**: reproduce as "follows pattern OpenClaw documents as sanctioned" — NEVER strengthen to "Anthropic-sanctioned"
14. **iOS App Review safety**: do NOT submit to App Store; only fix the 6 BLOCKERS in §3.14 so submission would PASS review when user is ready
15. **Supabase rotation**: requires user action; do NOT attempt autonomously (FT.1 deferred)

### STEP 4 — KNOWN GOTCHAS

- **macOS Finder artifacts**: `* 2.ts` accumulate; sweep at session start
- **Pre-commit hook sweeps untracked files**: always stage explicitly
- **better-sqlite3 + Termux**: Android tier (deferred FT.3.3) needs sql.js fallback
- **OpenClaw `CLAUDE_CLI_CLEAR_ENV` list**: 40 vars in code (NOT 41 as SECURITY.md claims) — fix doc, don't change code count
- **Code App / Monaco on iOS**: do NOT use Monaco for iOS editor — use Runestone
- **`.glassEffect()` is iOS 26, NOT iOS 18**: use `.ultraThinMaterial` on 18 + conditional wrapper
- **`@GenerativeIntent` doesn't exist** — actual API is `@AssistantIntent(schema:)`
- **Tier 3 bridge fix is the SINGLE HIGHEST LEVERAGE**: 5 lines unlock 3211 LOC of dormant code
- **WIP modified files are 60% TYPE-COMPLETE BUT BEHAVIOR-INCOMPLETE**: dream-runner + sandbox-audit + kairos.ts T11 wires need INVOCATION, not just construction
- **STALE CLAIMS (§2) are CONFIRMED ALREADY-FIXED**: do NOT re-fix identity.ts SOUL regex, ACP version, Bedrock event-stream, etc. — verify before touching
- **Wave 5 RATE-LIMIT lesson**: dispatching 12 Opus 4.7 agents simultaneously hit the 5-hour message cap in 5 minutes (round-1). On round-2 (15:45) re-dispatch worked because partial token budget had recovered. **Strategy**: dispatch in batches of 4 max + 60s pause between waves OR space dispatches across the full 5-hour window
- **Comment-vs-reality lying**: meta-pattern §9.2 "present-but-theatrical" — many WOTANN comments LIE about behavior (e.g., `pin !== request.pin` with comment "constant-time", `virtualCursorPool` comments saying tick() advances it when it doesn't, `otel-exporter` comment claiming opt-out gate). When auditing, always verify the comment matches behavior
- **Tauri config has NO `updater` block at all** (desktop-app/src-tauri/tauri.conf.json) — auto-update feature is missing entirely, not "broken"
- **`pair.local` is unauthenticated remote takeover** at companion-server.ts:2067-2076 — accepts any deviceName/deviceId, no PIN, no ECDH. Worse than the PIN brute-force.
- **`pin !== request.pin`** at companion-server.ts:336 + secure-auth.ts:190 — comment LIES claiming "constant-time"; use `crypto.timingSafeEqual` on equal-length buffers
- **NO `process.on('uncaughtException')` ANYWHERE in src/** — single unhandled async rejection silently kills daemon (Node ≥15)
- **WOTANN_HOME env var IGNORED** in 25+ daemon sites — only `src/session/creations.ts:165` honors it. Doctor's memory.db check verifies the WRONG file. Create `src/utils/wotann-home.ts` helper.
- **CompanionServer default `host: "0.0.0.0"`** at companion-server.ts:639 — exposes port 3849 on every network interface including public Wi-Fi
- **`virtualCursorPool` + `sleepTimeAgent` are dead with LYING comments** (kairos.ts:240,518) — declared/assigned but tick() never calls .advance()/.maybeRun()
- **6 SQLite stores have NO PRAGMA hardening** — busy_timeout absent, synchronous=NORMAL/FULL absent, user_version migration absent. WAL alone isn't enough.
- **ULTRAPLAN hardcodes `claude-opus-4-6` / `claude-sonnet-4-6`** at ultraplan.ts:75,79 — should be 4-7 per Gabriel's Prime Directive
- **3 vendor-bias hardcodes in src/index.ts**: line 3561 (verifier), 5359 (router), 6549 (cloud-offload default)
- **Skills loaded with ZERO signature verification** — any process with write access injects prompt-context-elevated instructions
- **`otel-exporter.ts` does NOT call `isTelemetryOptedOut()`** — telemetry can leak even when user opted out

### STEP 5 — STOP CONDITIONS

STOP and ask user if:

- Supabase rotation pending (FT.1 — requires user action)
- God-file split decision needed (FT.2 — requires user direction)
- Disk <5Gi mid-phase
- Test regresses after 3 different fix approaches → use `tree-search` skill, then ask
- Security finding requires product-level decision
- Tier pair atomic-merge risk (e.g., Wave 0 push must be atomic)
- Anthropic publishes new policy affecting Tier 3 Claude sub path
- Any destructive operation needed (git reset --hard, branch -D, force-push, rm -rf outside `* 2.*`)
- Apple App Store submission attempted (DON'T — defer to user)
- Real-device iOS test infrastructure decision (CI runner vs manual)
- API rate-limit ceiling hit during a wave (5-hour cap) — harvest partials from JSONL, wait for reset, re-dispatch with stagger
- Tauri auto-updater config decision: ad-hoc unsigned bypass vs full pubkey + endpoint setup (architectural choice)
- Windows kernel-sandbox decision: implement real Job Objects backend (~150 LOC + Windows test infra) vs honest-stub-document and call it deferred to FT.3.4

### STEP 6 — SUCCESS CRITERIA

V9 GA ship criteria (from audit doc §8):
- All 33 (or 35) failing tests green
- tsc rc=0 (src/ AND desktop-app — currently desktop-app FAILS)
- All 4 modified WIP files committed (with REAL invocations, not stubs)
- All 24 untracked files staged + committed (with WIRES, not orphans)
- 4 unpushed commits pushed to origin/main
- release.yml passes on next tag push
- ci.yml failure rate <10% over 5 runs
- Drift-check 6/6 OK
- All 4 confirmed FAKE handlers fixed
- All 5 partial-FAKE handlers fixed
- All 18 orphan-by-construction wires connected
- All 5 semantically-broken issues fixed
- All 6 missing items present (NOTICE, compare/workshop/relay verbs, iOS entitlements, scaffold-pack materializer)
- All 15 doc truth-up edits applied
- iOS App Review BLOCKER count reduced from 6 to 0
- Active CVEs (postcss + rustls-webpki) resolved
- 5 Claude Code CVE patterns audited + patched
- Anthropic SDK at current version
- sqlite-vec >= 0.1.9 pinned

### STEP 7 — AUTO-DETECT + AUTO-DISPATCH (Gabriel's Prime Directive)

"The user says WHAT. You decide HOW."

- Multi-step task → planner agent + /plan skill
- Bug with 4+ causes → /tree-search
- Tests failing in cycles → /ultraqa
- Need web info → WebFetch / WebSearch
- Unknown library → Context7 (resolve-library-id → query-docs)
- Complex security audit → /cso or security-reviewer agent
- Parallel code review → agent-teams:team-review
- Parallel feature dev → agent-teams:team-feature
- Parallel debugging → agent-teams:team-debug
- Design work → frontend-design plugin or /epic-design
- Memory question → memory-stack skill
- Research question → /research or /agent-reach
- Save session for resume → /save-session → /resume-session
- Auto-save to Engram after every decision/bugfix/discovery/convention
- Use max-effort thinking for architectural decisions

Dispatch pattern for parallel agents:
```
Agent({
  description: "short task desc",
  subagent_type: "general-purpose",
  model: "opus",
  run_in_background: true,
  prompt: "self-contained brief — agent has NO session context"
})
```

Max 8-12 concurrent agents per wave if file scopes strictly disjoint.

### STEP 8 — TUI v2 (Wave 6 NN+OO — Wave 4-J design)

Per audit doc §3.15, the TUI eclipses Claude Code + Claude HUD + Hermes Agent on 24/25 dimensions:
- Norse signature + 15 status indicators (vs HUD's 9)
- 4 motif moments (rune-flash + raven's flight + sigil stamp + cost glint) + 4 sound cues
- Multi-pane Twin-Raven (Cmd+Shift+2) + Conversation Braid (Cmd+Shift+B)
- Replay Scrubber (Cmd+R) + Voice waveform (8-cell ▁-█)
- **Mouse via OSC 1006 (the moat — first AI agent TUI with native click+drag+scroll)**
- Sparkline cost (24-cell ▁-█) + Hook timeline + Provider arbitrage indicator + Dream-cycle countdown
- Color-blind palette + Reduce-motion + Title-bar screen-reader hints
- Total: ~2,910 LOC across 22 files, 22-day implementation
- **Phase 1 priority**: string-width-cache MIGRATION (T12.14 follow-through — currently shipped but never imported)

Full design: Engram `wotann-v9-wave4ij-cost-and-tui-2026-04-25`.

### STEP 9 — COMPLETION REPORT

When ALL waves green per §8 success criteria:

1. Run final verification:
   ```bash
   npx tsc --noEmit
   cd desktop-app && npm run build && cd ..
   npx vitest run
   node scripts/v9-drift-check.mjs
   gh run list --limit 5 --json conclusion,displayTitle
   ```

2. Save final session summary to Engram with `topic_key="wotann-v9-implementation-COMPLETE-<date>"` containing:
   - Total commits made
   - Final test pass count
   - All FAKE/orphan/missing items resolved
   - Remaining work for v0.7+ (V14+ items)
   - Known limitations
   - Recommendations for next session

3. Push final state to origin/main (preserving 4 unpushed + all new commits)

4. Return to user with:
   - Final commit SHA
   - Test pass/fail count
   - V9 GA readiness verdict
   - Required user actions for FT.1 (Supabase rotation) and FT.2 (god-file split direction)
   - Pending V14+ items deferred to v0.7+

---

## TL;DR SINGLE-LINER

```
mem_context project=wotann && \
node /Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs && \
Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_25_BRUTAL.md && \
Start Wave 0 (push 4 commits + stage WIP + cleanup 223 ghost `* 2.*` files + file-ownership pre-flight) → \
Wave 1 (8 P0 agents, ≤4 Opus parallel max — pause 60s between batches) → \
Wave 2 (5 WIP-fix agents) → Wave 3 (8 protocol/security agents) → \
Wave 4 (8 cost/audit/perf agents) → Wave 5 (6 protocol upgrade agents) → \
Wave 6 (10 Wave-5-CRIT agents — pair.local auth + uncaught-exception + WOTANN_HOME + persistence + iOS LiveActivity restore + ATS keys) → \
Wave 6.5 (8 Wave-5-HIGH agents — tick reentrancy + SQLite hardening + ULTRAPLAN model bump + 21+ vendor-bias + skill signing + opt-out gate + cross-platform) → \
Wave 6.7 (4 Wave-5-MED agents — virtualCursor wire + GC sweep + async cleanup + DST UTC) → \
Wave 6.9 (3 ORPHAN sweep agents — templates + Dual AppShortcuts + LM Studio + scaffold-pack + Tauri updater + IPC token) → \
Wave 7 (1 docs agent — 4-place skill count drift + wotann run + wotann engine start + Gemma + SECURITY env count + 6 confirmed lies) → \
Wave 8 (1 dead-code cleanup agent — 1006+ LOC) → \
Wave 9 (3 V14+ blocking items only — Opus 4.7 model-router strip + SDK 0.2.119 bump + retirement audit).
```

**Execute the plan. Opus 4.7 max effort. ≤4 Opus parallel per batch (rate-limit lesson from this audit session). Never ask permission for low-risk work.
Save to Engram after every decision. Push often. Trust the source over commits/memory/docs. Verify against HEAD before patching.**

The plan is complete. The audit doc is comprehensive (1,072+ lines, 43 deep audits across 5 waves + Wave 5-B audit-doc-self-audit + Wave 5-O test-drift resolution). Just execute it.

— Generated 2026-04-25, designed for autonomous Opus 4.7 (1M ctx) execution after 43 deep audits across 5 waves with rate-limit-aware staggered dispatch.
