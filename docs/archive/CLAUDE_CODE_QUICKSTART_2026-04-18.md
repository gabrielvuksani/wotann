# Claude Code Quickstart — Autonomous WOTANN Execution

**Read this FIRST on session start.** Every instruction below is actionable without human input.

## Session Start Protocol

```
1. mem_context  → recover Engram state
2. Read /wotann/docs/AUTONOMOUS_EXECUTION_PLAN_V2_2026-04-18.md (canonical plan)
3. Read this file to bootstrap execution loop
4. Run Phase 1 HEAD Verification Sweep if not done this session
```

## Task Selection Algorithm

For each work cycle:

```python
while tasks_remaining and within_budget:
  task = pick_next_task()  # see priorities below
  status = head_verify(task.predicate)
  if status == "DONE":
    mem_save(topic_key=f"wotann/verified-done/{task.id}")
    continue
  implement(task)
  run(task.verification_command)
  if verification_passed:
    commit(task.commit_message)
    mem_save(topic_key=f"wotann/execution/{task.id}", content=outcome)
    benchmark_smoke_if_touched_hot_path(task)
  else:
    debug(3_attempt_cap)
    if still_failing:
      dispatch("/tree-search")
      stop_and_escalate_to_gabriel()
```

## Task Selection Priority

```
1. Tier 0 (lies) — blocks every benchmark claim
2. S4 security (shell injection, mcp.add, etc) — actively exploitable
3. 7 NEW bugs discovered 2026-04-18:
   a. 8-file bootstrap NEVER INVOKED — 2h fix, MASSIVE UX unlock
   b. active-memory.ts:141 field name — 5-MIN fix, unlocks recall pipeline
   c. memory_search_in_domain duplicate — 2-MIN fix
   d. vector-store first-search re-embed
   e. FTS5 2/8 table coverage
   f. ConnectorRegistry empty at runtime
   g. 9 CLI files unwired
4. Top-40 leaderboard items still open (MASTER_PLAN_SESSION_10 §5)
5. Tier 1 Benchmark Harness (gates Tier 4)
6. Tier 3 Memory upgrades + MemPalace addendum
7. Tier 2 Codex parity P0
8. Tier 4 Self-evolution (after Tier 1)
9. Tier 5 UI/UX + full UI_DESIGN_SPEC signature interactions
10. Tier 6 Skills (parallel)
11. Tier 7 Channels
12. Tier 8 FUSE
13. God-object split (Wave 6)
```

## 10-Minute Quick Wins (do these first)

These are <30min each with massive signal-to-noise:

| Fix | File:Line | Time | Impact |
|-----|-----------|------|--------|
| active-memory.ts:141 field name | src/memory/active-memory.ts:141 | 5 min | Unlocks entire recall pipeline |
| memory_search_in_domain duplicate | src/memory/memory-tools.ts:218 | 2 min | Clean tool registry |
| SOUL.md path (verify HEAD first) | src/identity/persona.ts:89 | 1 min | Norse identity activates |
| Thin-client socket path | src/cli/thin-client.ts:22 | 30 sec | Daemon auto-detection works |
| turboquant.ts rename | src/context/turboquant.ts | 10 min | Kills marketing lie |
| claude-agent-sdk → peerDeps | package.json | 10 min | License blocker removed |
| npm audit fix | package.json | 5 min | 7 CVEs resolved |
| WOTANN_AUTH_BYPASS gate | src/daemon/kairos-ipc.ts:121-139 | 15 min | Close auth bypass |
| webhook timing-safe compare | src/channels/webhook.ts:104 | 15 min | Close timing leak |
| 10 skills frontmatter | skills/{a2ui,canvas-mode,batch-processing,computer-use,cost-intelligence,lsp-operations,mcp-marketplace,benchmark-engineering,prompt-testing,self-healing}.md | 30 min | 76→86 skills load |
| autodream stop-word filter | src/learning/autodream.ts:163 | 15 min | Dream quality |
| fallback-e2e self-equality | tests/integration/fallback-e2e.test.ts:95 | 2 min | Test honesty |

**Total: ~2 hours for all 12.** Knock these out in the first session.

## HEAD Verification Examples

### Before starting Tier 0.1 (Bedrock toolConfig):
```bash
grep -A3 "const body:" /Users/gabrielvuksani/Desktop/agent-harness/wotann/src/providers/bedrock-signer.ts | head -20
# If you see toolConfig: mark DONE-PRIOR
# If not, proceed with Tier 0.1
```

### Before starting SOUL.md fix:
```bash
grep -n "wotannDir\|workspaceDir\|\.wotann" /Users/gabrielvuksani/Desktop/agent-harness/wotann/src/identity/persona.ts | head -10
grep -rn "loadIdentity\(" /Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ | grep -v test
# Look at whether loadIdentity is called with workspace path or $HOME
```

### Before starting Runering wire-up:
```bash
grep -rn "emitRuneEvent\|wotann:rune-event" /Users/gabrielvuksani/Desktop/agent-harness/wotann/ | head -10
# If call sites exist: session-10 wired it
# If zero call sites: still need to wire to mem_save, memoryStore.insert, ObservationExtractor
```

## Benchmark Smoke Suite (runs after any hot-path change)

```bash
# 30 seconds
npm run typecheck
npm test -- tests/providers/ --reporter=dot
npm test -- tests/memory/ --reporter=dot
npm test -- tests/middleware/ --reporter=dot

# 5 minutes (only when provider adapter touched)
WOTANN_SMOKE_BENCHMARK=1 npm test -- tests/intelligence/benchmarks/
```

## Commit Message Templates

```
# Tier 0 bug fix:
fix({subsystem}): {1-line outcome}

{2-3 sentence explanation of root cause and fix}

closes #t0-{n}

# Dead-code repurposing:
feat({subsystem}): wire {module} into {consumer}

Previously: {module} was exported but unused.
Now: {consumer} calls {module.method} on {trigger}.
Effect: {observable behavior change}.

closes #s1-{n}

# Benchmark runner:
feat(benchmark): add {runner-name} runner with trajectory logging

Supports flags: --limit, --seed, --provider, --model, --ablate, --verifier.
Output: trajectories/{runner}/{runId}/report.json + *.jsonl per task.

closes #t1-{n}
```

## Memory Save Templates

```typescript
// After every task completion:
await mem_save({
  topic_key: `wotann/execution/t{tier}-{id}`,
  title: `Task t{tier}.{id} — {1-line outcome}`,
  type: "decision" | "bugfix" | "pattern" | "discovery",
  content: `
**What**: {what changed, file:line}
**Why**: {root cause / user value}
**Where**: {files modified}
**Learned**: {gotchas discovered, effort vs estimated, things worth remembering}
**Verification**: {actual test output pass/fail counts}
`
});
```

## When to Escalate to Gabriel

STOP and ask Gabriel when:

1. **Three different fix attempts for same test fail** — dispatch `/tree-search` or escalate
2. **External credential needed** (Sentry DSN, Apple Developer ID, Supabase dashboard)
3. **Physical iOS device required** (MLX testing, HealthKit integration, Siri intents)
4. **Destructive operation** (mass delete, force-push, git reset --hard)
5. **Public release checkpoint** (v0.4.0 MVP ship candidate)
6. **Found CONTRADICTION in plan vs HEAD** — record in `execution-plan-drift.md` + flag

## When NOT to Escalate

Just do it:
- Any task in V2 plan with clear verification command
- Any test-first refactor with passing tests
- Any commit message from templates
- Any memory save or dependency install
- Any npm/cargo/tsc/pytest that doesn't touch networks requiring creds
- Dead-code deletion where DEAD_CODE_REPURPOSING analysis says DELETE (there are zero such cases in the analysis)

## Budget Tracking

Maintain `benchmarks/snapshots/{date}-t{tier}.json` with:
- `total_tokens_in/out`, `total_usd`, `wall_clock_minutes`
- Compare to tier-completion estimates
- If budget exceeded: STOP + update plan with actual vs estimated + escalate

## Known Blockers (don't waste cycles)

| Item | Blocker | Workaround |
|------|---------|------------|
| Supabase key rotation | Gabriel's dashboard | Continue; honest stub until rotated |
| iOS physical device testing | Hardware | Defer; run simulator tests |
| Tauri dev loop verification | Chrome DevTools MCP access | Defer; source-read verify |
| Apple Developer ID | Gabriel | Ad-hoc signing acceptable for local |
| Sentry DSN | Gabriel signup | Structured-logs fallback |

## Parallel Execution Opportunities

These can run in parallel (file-ownership boundaries):

| Stream A (provider) | Stream B (memory) | Stream C (UI) |
|---------------------|-------------------|----------------|
| Tier 0.1 Bedrock | Tier 3.1 Tree-sitter | Tier 5.1 Liquid Glass |
| Tier 0.2 Vertex | Tier 3.2 sqlite-vec | Tier 5.3 Block terminal |
| Tier 0.3 Azure | Tier 3.3 Dual retrieval | Tier 5.5 Bezier cursor |
| Tier 0.4 Ollama | Tier 3.4 Typed EntityType | Tier 5.6 Ask about window |
| Tier 0.5+0.6 Copilot | Tier 3.5 Hash index | UI_DESIGN_SPEC micro-interactions |

Parallelism requires 3 separate git branches with clean merges.

## Success Ladder

**Session 1 (this session)**: V2 plan exists, Engram seeded with 26 topic keys ✅
**Session 2**: Phase 1 + 2 complete (Tier 0 lies fixed); 10-minute quick wins done; benchmark smoke 20+20+20 passes
**Session 3**: Phase 3 S4 criticals closed; 8-file bootstrap wired; recall pipeline unlocked
**Session 4-5**: Phase 4-6 Top-40 items + Tier 1 Benchmark harness; first reproducible HumanEval + SWE-bench Lite + TerminalBench 10-task smoke results
**Session 6-10**: Tiers 2-4 — Codex parity, Memory upgrades, Self-evolution
**Session 11-15**: Tier 5 UI/UX polish with signature interactions, Tier 6 Skills, Tier 7 Channels
**Session 16+**: Tier 8 FUSE, God-object split, Hermes delta, v0.4.0 MVP ship by June 30, 2026

## End-of-Session Protocol

Before ending any session:

```
1. npm run typecheck (all green)
2. npm test --reporter=dot (pass rate never regresses)
3. Commit all work (atomic per task)
4. mem_session_summary (Engram auto-captures + saves to Engram)
5. Update /wotann/docs/execution-progress.md with: completed tasks, blockers, next-session priority
6. Save one last topic_key: `wotann/session-{N}-handoff` with the critical state
```

## Anti-Patterns to Avoid

**NEVER**:
- Fix a test by weakening the assertion (quality bar #14)
- Skip verification output in commit message
- Mark a task DONE without running its verification command
- Reuse a module-global cache across sessions
- Claim a fix landed before the code actually merged
- Silent-fallback on missing optional deps (must emit warning + honest stub)
- Mutate immutable types to satisfy TypeScript
- Delete tests instead of fixing them
- Hardcode vendor names in fallback logic
- Ship provider `supportsX: true` capability when the adapter strips X silently

## ONE-PAGER Priority Ranking

**DO THIS NEXT after session start:**

```
1. mem_context + read V2 plan
2. 10-minute quick wins (12 items, ~2h total)
3. Phase 1 HEAD Verification Sweep for Tier 0 + S4 items
4. Tier 0.1 (Bedrock), Tier 0.2 (Vertex), Tier 0.3 (Azure) — in parallel if possible
5. NEW 8-file bootstrap wire-up (S.4.26) — critical for personality system
6. NEW active-memory.ts:141 (S.4.27) — unlocks recall
7. Tier 0.4-0.10 remaining lies
8. Benchmark harness (Tier 1.1) — gates self-evolution
```

After first 3-5 sessions, you'll be ready for serious benchmark runs and public MVP preparation.
