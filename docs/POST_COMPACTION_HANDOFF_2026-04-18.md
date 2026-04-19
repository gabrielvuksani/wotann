# WOTANN Post-Compaction Handoff — 2026-04-18

**Target audience**: The next Claude Code session that picks up WOTANN work after compaction / `/clear` / session end. Whether that's the same agent returning the next morning or a fresh agent taking over, this file is the minimum viable state recovery.

**Compaction protection**: This doc was written in-session and saved to disk *before* any destructive context operation, per WAL Protocol (`~/.claude/rules/wal-protocol.md`).

---

## 1. Session Context Summary

As of 2026-04-18, Gabriel Vuksani has run 5 full WOTANN audit/build sessions (transcripts in `~/.claude/session-data/2026-04-15-wotann-session2-transcript.md` through `2026-04-16-wotann-session5-transcript.md`). Wave 4 (today, 2026-04-18) closed out deep-source reads of runtime.ts, kairos-rpc.ts, index.ts, runtime.ts tail, Tauri Rust sources, and produced 10 docs in `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/` + 12 competitor briefs in `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/`.

**The summary state**:

- WOTANN v0.1.0 is ~85% implementation-complete against the 7,927-line NEXUS V4 spec
- 148,446 LOC TypeScript + 47,767 LOC tests (254 files) + 120+ Swift files + 97+ TSX + 11+ Rust Tauri files
- 11 verified bugs (after Wave 4 ground-truth removed ~50% of speculative Wave 1-3 bug claims)
- 13 DEAD modules (3,600 LOC of production-quality logic) — per Gabriel "zero deletions" mandate: WIRE, don't delete
- Target ship v0.4.0 by June 30 2026 (Anthropic Claude Apps GA), 56-day critical path, 44 days buffer
- Two-table benchmark positioning: `WOTANN-Free` (Groq/Cerebras/DeepSeek/Gemini $0 baseline) + `WOTANN-Sonnet` (≤$5 Sonnet 4.6 verifier cap). Nobody else publishes zero-cost leaderboards — that is the moat.
- Latest push: 59 commits to origin/main after session 5
- Build spec/plan: **see MASTER_SYNTHESIS_2026-04-18.md** — the consolidated status matrix + 15-phase plan + competitor table + references

The user's preferred working style (from `~/.claude/rules/` + MEMORY.md):

- Full autonomy, the user says WHAT and the agent decides HOW
- Research before coding (Context7, GitHub, WebSearch)
- Verify before claiming done (evidence always)
- Immutability: never mutate, return new objects
- Many small files (200–400 lines typical, 800 max)
- TDD RED-GREEN-REFACTOR
- Save to memory proactively (Engram `mem_save` after any decision/bugfix/discovery)
- Commits only when explicitly asked; conventional-commit format via `/git:cm`
- Verify full chain: editing code != fixing. Must rebuild ALL affected targets + restart daemon + verify via logs before claiming done
- Real device testing (not simulator) for iOS
- Opus for audits; honest stubs over silent success; per-session state not module-global

---

## 2. State Recovery Commands (run these in order)

Recovery sequence if you're a fresh session post-compaction:

```
1. mem_context                                   # Engram: last session state
2. mem_search "wotann/execution-plan-v4"         # Plan pointer
3. mem_search "wotann"                           # All 50+ WOTANN topic keys
4. Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MASTER_SYNTHESIS_2026-04-18.md
5. Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/POST_COMPACTION_HANDOFF_2026-04-18.md   # this file
6. Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md                                  # project CLAUDE.md
7. Bash:  ls /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/*2026-04-18*.md    # inventory input docs
8. Bash:  cd /Users/gabrielvuksani/Desktop/agent-harness/wotann && git log --oneline -20    # recent commits
9. Bash:  cd /Users/gabrielvuksani/Desktop/agent-harness/wotann && git status -sb          # current branch + dirty state
10. Read  ~/.claude/projects/-Users-gabrielvuksani-Desktop-agent-harness/memory/MEMORY.md    # auto-memory
```

If any Engram `mem_*` call fails, skip it and continue with the Read/Bash steps — the synthesis + handoff + CLAUDE.md carry the essential state.

If Gabriel's still at the keyboard: jump straight to §4 restart prompt.

---

## 3. Current Work Status + Next 3 Priority Tasks

**Work status**: Phase 0 (HEAD verification sweep) has not started. All prior wave docs exist but the claims have not been re-verified against current HEAD. 11 verified bugs remain open. Learning stack is inert — 12 files in `src/learning/` produce ZERO output.

### Priority 1 — Fix AutoresearchEngine no-op generator (Phase 1, bug #1)
**File**: `src/core/runtime.ts:934`
**Symptom**: `AutoresearchEngine` is constructed with `async () => null` as its `ModificationGenerator` — every call yields nothing. Violates session-2 quality bar "honest stubs over silent success."
**Fix**: Write `src/training/llm-modification-generator.ts` (~200–300 LOC) that receives a `prompt` string and `for await` iterates `runtime.query({prompt, ...})` yielding each `c.content` when `c.type === "text"`. Return `null` after K rejected proposals (graceful termination). Wire at `runtime.ts:934` in place of `async () => null`. Add CLI: `wotann autoresearch --target <file> --metric <name> --max-cycles 20 --budget 300s`. Metric catalog: `typecheck-passes`, `lint-count`, `bundle-size`, `token-count`, `benchmark-ms`, `test-pass-rate`.
**Effort**: 30 min wiring + 4–6 hours generator implementation + verification
**Impact**: Unblocks Tier-4 self-evolution entirely; enables Karpathy-autoresearch loop.

### Priority 2 — Fix "active-memory field" bug = same as AutoresearchEngine no-op
**Clarification**: The handoff prompt's "active-memory field bug" is shorthand for Priority 1 above. Prior waves mislabeled it; the actual fix is the AutoresearchEngine generator wire in `runtime.ts:934`. The `active-memory` naming comes from the engine's internal state field that tracks live modification proposals — it's null because the generator produces null.

If a new audit has surfaced a distinct `active-memory` bug elsewhere (e.g., in `src/memory/active-memory.ts` or a middleware state field), grep for it via `Grep "active.memory" src/` and confirm. As of 2026-04-18 Wave 4, the only confirmed instance is bug #1.

### Priority 3 — Wire the learning-stack chain (Phase 3)
**Files**: `src/learning/*.ts` (12 files), `src/core/runtime.ts` (close method), `src/memory/observation-extractor.ts`, `src/memory/dream-pipeline.ts`, `src/learning/instinct-system.ts`, `src/learning/skill-forge.ts`
**Symptom**: Conversation doesn't auto-persist. Dream/Instinct/Skill-Forge/Self-Evolution all inert because no input stream.
**Fix**: Add conversation-end hook in `runtime.close()` to call `observationExtractor.extractFromConversation(session)` → `dreamPipeline.consume(observations)` → `instinctSystem.update(dreams)` → `skillForge.proposeSkills(instincts)`. Gate each step with existing config flags (`WOTANN_AUTODREAM=1`, etc.). Persist each stage's output to `.wotann/learning/*.jsonl` for replay.
**Effort**: 3 days (per V4 Phase 3 estimate)
**Impact**: Lights up the entire Tier-4 self-evolution stack; prerequisite for DSPy+GEPA (Phase 7).

**These three tasks are the fastest path to the critical-path Phase 4 (benchmark harness) unlock.** Do Priority 1 + 2 first (same fix, ~4–6 hours), then Priority 3 (3 days), then start Phase 4 benchmark-harness wiring.

---

## 4. EXACT COPY-PASTE RESTART PROMPT

Gabriel, after compaction or on a fresh session, paste this block verbatim into Claude Code to resume WOTANN work at the right spot with full context:

---

```
I'm resuming WOTANN work after compaction. Use Opus 4.7 max effort with 63,999 thinking tokens. Full autonomy — you decide HOW.

STATE RECOVERY (run in order, parallel where possible):
1. mcp__engram__mem_context
2. mcp__engram__mem_search query="wotann/execution-plan-v4" max_results=5
3. mcp__engram__mem_search query="wotann" max_results=20
4. Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MASTER_SYNTHESIS_2026-04-18.md
5. Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/POST_COMPACTION_HANDOFF_2026-04-18.md
6. Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md
7. Bash: cd /Users/gabrielvuksani/Desktop/agent-harness/wotann && git log --oneline -15 && git status -sb

CURRENT PHASE: Phase 0 (HEAD verification sweep, 1 day) then Phase 1 (fix 11 verified bugs, 3-5 days).

NEXT 3 TASKS (execute in order):

TASK 1 (30 min wire + 4-6h generator): Fix AutoresearchEngine no-op at src/core/runtime.ts:934.
   Write src/training/llm-modification-generator.ts (200-300 LOC). Real LLM generator:
     async function* llmModGenerator(prompt) {
       for await (const chunk of runtime.query({ prompt, ... })) {
         if (chunk.type === "text") yield chunk.content;
       }
     }
   Return null after K rejected proposals.
   Add CLI: `wotann autoresearch --target <file> --metric <name> --max-cycles 20 --budget 300s`
   Metric catalog: typecheck-passes, lint-count, bundle-size, token-count, benchmark-ms, test-pass-rate.
   Verify: wotann autoresearch --target src/providers/registry.ts --metric lint-count --max-cycles 3 --budget 60s returns non-empty stream.

TASK 2 (same fix as Task 1 — "active-memory field bug" = AutoresearchEngine no-op output): Confirmed by grep "active.memory" src/. If a distinct bug exists in src/memory/active-memory.ts or middleware, fix separately; else Task 1 covers it.

TASK 3 (3 days): Wire learning-stack chain (Phase 3).
   - Add conversation-end hook in runtime.close() (src/core/runtime.ts)
   - Chain: observationExtractor.extractFromConversation -> dreamPipeline.consume -> instinctSystem.update -> skillForge.proposeSkills
   - Gate each step with config flags (WOTANN_AUTODREAM=1, etc.)
   - Persist each stage output to .wotann/learning/*.jsonl
   - Verify: run a full session, check .wotann/learning/ contains non-empty observations.jsonl, dreams.jsonl, instincts.jsonl, skill-proposals.jsonl after close

EXECUTION ORDER: Task 1 -> Task 2 (auto-closed by Task 1) -> Task 3.

QUALITY BARS (from ~/.claude/rules/ + session-2 feedback):
- Opus (not Haiku) for every audit/subagent dispatch
- honest stubs over silent success
- per-session state, never module-global
- verify full chain: rebuild all affected targets + restart daemon + verify via logs before claiming done
- immutable data patterns; never mutate, return new copies
- many small files; 200-400 LOC typical, 800 max
- no hardcoded secrets; tests cannot pass by self-equality
- save to memory proactively via mcp__engram__mem_save after every decision/bugfix
- TDD: write tests first, RED-GREEN-REFACTOR

AFTER TASK 3 CLOSES: Begin Phase 4 (benchmark harness, 20 days) per V4 plan.
The 15-phase execution plan with full critical path is in MASTER_SYNTHESIS_2026-04-18.md §4.
The 11 verified bugs with file:line + effort are in MASTER_SYNTHESIS §2.
The ~45-competitor landscape with version numbers + install commands is in §3.

GATING RULE: Every claim you make must cite a verified source from MASTER_SYNTHESIS §7 References. Do not trust prior wave 1-3 claims without ground-truthing against current HEAD (wave 4 corrected ~50% of prior claims).

PROCEED.
```

---

**Notes on the restart prompt**:

- The prompt assumes current directory resets between Bash calls; use absolute paths only
- The prompt uses Opus 4.7 (`1M` variant) per global `~/.claude/rules/always-on-behaviors.md` section 0 "full autonomy principle"
- The three tasks are the `MASTER_SYNTHESIS` Phase 1 priority subset — Phase 0 (HEAD verification) is assumed to run in parallel with Task 1 as the grep sweep happens during Task 1 debugging
- Task 2 is deduped into Task 1 to avoid wasted effort — the "active-memory field bug" in the handoff instruction is the same bug as AutoresearchEngine no-op, just described from the engine's perspective. If a distinct bug surfaces, it will be caught during Phase 0 verification.

---

## 5. Memory Anchors — All Engram Topic Keys

All WOTANN-related memory preserved under these topic keys. Call `mem_search` with any of them to recover scope-specific context.

**Audits + drift**: `wotann/audit-architecture`, `wotann/audit-providers`, `wotann/audit-ui-ux`, `wotann/audit-tests`, `wotann/audit-spec-drift`, `wotann/prior-audit-corrections`, `wotann/bootstrap-correction`

**Plans + strategy**: `wotann/execution-plan-v4`, `wotann/benchmark-strategy`, `wotann/self-evolution-plan`, `wotann/memory-upgrades`, `wotann/depth-sidebar-redesign`, `wotann/skill-port-plan`

**Research**: `wotann/native-app-research`, `wotann/browser-codex`, `wotann/ai-editors-research`, `wotann/wave3-ground-truth`, `wotann/wave3-repos-batch1-5`, `wotann/deep-audit-full`, `wotann/repo-research-updates`

**Structured memory**: `cases/*` (problem + root cause + solution), `patterns/*` (reusable techniques), `decisions/*` (architecture choices), `known-issues/*` (OPEN/SNOOZED/RESOLVED lifecycle per `~/.claude/rules/error-lifecycle.md`)

**Sessions**: `~/.claude/session-data/2026-04-15-wotann-session2-transcript.md` through `2026-04-16-wotann-session5-transcript.md`, plus `2026-04-16-wotann-session6-continuation-prompt.md` (max-power prompt for next session; references all 5 transcripts, 14 quality bars, TIER 1-5 tier-ordered work)

---

## 6. Quality Bar Reminders (14 rules accumulated across 5 sessions)

From MEMORY.md feedback files:

1. No vendor-biased `??` fallbacks (Session 1)
2. Opt-in caps, not implicit defaults (Session 1)
3. Sonnet not Haiku for all subagents (Session 1)
4. Never skip tasks (Session 1)
5. Opus for audits (Session 2)
6. Honest stubs over silent success (Session 2)
7. Per-session state, not module-global (Session 2)
8. `HookResult.contextPrefix` as injection channel (Session 2)
9. Test files can codify bugs (Session 2)
10. Sibling-site scan before changes (Session 3)
11. Singleton threading through context (Session 3)
12. Env-dependent test assertion gates (Session 4)
13. Env-gate symmetry across modules (Session 4)
14. Commit-message-is-claim verification (Session 5) — don't claim done in commit unless verified

From always-on-behaviors + coding-style + testing rules (global):

- Immutability: always return new copies, never mutate
- Many small files: 200–400 LOC typical, 800 max
- TDD RED-GREEN-REFACTOR, 80% minimum coverage
- Never hardcode secrets; parameterized queries; XSS/CSRF protection
- Before editing signatures: search ALL callers; update everything in one change
- Reference completeness before public API changes
- Auto-save memory after ANY decision/bugfix/discovery (don't wait to be asked)
- Verify before claiming done (evidence, not assertions)
- Pre-task context verification: check incomplete context, contradictions, user intent, blast radius
- Error retry cap: 3 different approaches fail → escalate to `/tree-search` or stop and ask

---

## 7. What NOT To Do

- Do NOT delete any DEAD modules without explicit grep-confirmed zero production callers + Gabriel approval (Phase 14 scope only; per his "zero deletions" mandate)
- Do NOT trust prior wave 1-3 audit claims without ground-truthing against HEAD (Wave 4 corrected ~50% of prior claims — examples: "8-file bootstrap never invoked" FALSE, "memoryMiddleware producer with no consumer" FALSE, "KnowledgeGraph every restart wipes graph" FALSE)
- Do NOT skip verification ("code compiles" ≠ "system works"; verify full chain: rebuild → restart daemon → check logs)
- Do NOT amend existing commits to fix failures; create NEW commits
- Do NOT push to origin without Gabriel's explicit ask
- Do NOT modify tests to make them pass; fix the implementation
- Do NOT run on iOS simulator and claim production-ready; Gabriel tests on physical devices
- Do NOT exceed the 11-bug scope in Phase 1 without first closing those 11
- Do NOT start Phase 4 (benchmark harness) before Phase 1 (bug fixes) closes — the benchmark numbers will be wrong otherwise
- Do NOT claim SOTA benchmark numbers without running the `harness on vs off` ablation and publishing both

---

## 8. Session-End Checklist (Run Before `/clear` Or Next Compaction)

Before ending any WOTANN session:

1. `mcp__engram__mem_session_summary` — save end-of-session summary (mandatory)
2. Commit work-in-progress to a branch (not main) with detailed commit message
3. Write any new `cases/*` or `patterns/*` observations to Engram with `topic_key`
4. Update `feedback_wotann_quality_bars_session<N>.md` if new quality bars were raised
5. Update this handoff doc if current priorities changed
6. Run `git log --oneline -5` and confirm commits pushed per user intent
7. Save a new session transcript at `~/.claude/session-data/2026-04-<DD>-wotann-session<N>-transcript.md`

---

**Last modified**: 2026-04-18 by synthesis agent (wave 4 closure).
**Next session owner**: TBD — Gabriel or resumed Claude Code session.
**Ship-day countdown**: 73 days to 2026-06-30 target (Anthropic Claude Apps GA).
