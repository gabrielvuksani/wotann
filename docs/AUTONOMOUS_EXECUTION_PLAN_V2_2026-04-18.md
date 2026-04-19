# WOTANN Autonomous Execution Plan V2 — 2026-04-18

**Supersedes:** AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md (v1), MASTER_PLAN_SESSION_10.md, MASTER_PLAN_SESSION_10_ADDENDUM.md.
**Method:** 15 Opus 4.7 max-effort agents + direct source verification of contradicting claims + 20-doc cross-reference sweep.
**Governing principle:** Gabriel's "DON'T HARDCODE NOTHING + triple-check before execution + no vendor bias."

## Why V2

V1 and MASTER_PLAN_SESSION_10 each captured a point-in-time reality. Since session 10, 24 commits landed that invalidate several V1 Tier-0 assumptions (Bedrock SigV4, Vertex OAuth2, agent-bridge tools forwarding, 18-provider fallback chain, Workshop+Exploit pills, instruction-provenance wiring, tool serialization tests). V2 is the **HEAD-verified** plan.

## HEAD Verification Step (gate every task)

Before starting any task, RUN:

```bash
# Verify the specific claim the task is predicated on:
grep -n "<claim-pattern>" <claimed-file>
# If the claim is already fixed, mark task DONE-PRIOR and skip.
# If the claim is still present, proceed with the task.
```

## Canonical Status Matrix (as of 2026-04-18)

| Subsystem | Status | Source Evidence |
|-----------|--------|-----------------|
| Bedrock SigV4 | ✅ REAL | bedrock-signer.ts:40-100 has full HMAC-SHA256 + canonical request + Auth header |
| Vertex OAuth2 JWT | ✅ REAL | vertex-oauth.ts:55-100 has buildSignedJwt + RS256 + urn:ietf:params:oauth:grant-type:jwt-bearer exchange |
| Bedrock toolConfig in body | ❌ MISSING | bedrock-signer.ts:150-156 body omits toolConfig — Tier 0.1 still needed |
| Bedrock event-stream decoder | ❌ REGEX ONLY | bedrock-signer.ts:175-183 uses regex; replace with binary decoder |
| Vertex body forwards tools/messages/system | ❌ MISSING | vertex-oauth.ts:153-185 hardcodes 5 fields; Tier 0.2 still needed |
| Vertex stream parser all events | ❌ PARTIAL | only text_delta; need tool_use, thinking, usage, stop events |
| Azure URL composition | ❌ BROKEN | registry.ts:176-180 query before path; Tier 0.3 needed |
| Ollama stopReason on tool_calls | ❌ MISSING | ollama-adapter.ts:331-342; Tier 0.4 needed |
| Copilot 401 retry | ❌ MISSING | copilot-adapter.ts:346-355; Tier 0.5 needed |
| Copilot per-session token | ❌ MODULE-GLOBAL | copilot-adapter.ts:88-90; Tier 0.6 needed |
| agent-bridge tools forwarding | ✅ FIXED | agent-bridge.ts:78-95 has `tools: options.tools?.map(...)` with S1-1 comment |
| parseToolCallFromText wired | ⚠️ CHECK | needs verification — if still unwired, Tier S.4.24 applies |
| 18-provider fallback chain | ✅ DONE | fallback-chain.ts:27-58 per SESSION_10_STATE |
| AccountPool 18-provider discovery | ⚠️ CHECK | addendum says 3 only; verify |
| tolerantJSONParse apostrophe | ❌ BROKEN | parsers.ts:35-53; Tier 0.7 needed |
| camoufox persistent subprocess | ❌ FAKE | src/browser/camoufox-backend.ts fresh spawn per call; Tier 0.8 needed |
| 40+ .toBeTruthy() tautologies | ❌ PRESENT | tests/mobile/ios-app.test.ts et al; Tier 0.9 needed |
| fallback-e2e self-equality | ❌ PRESENT | tests/integration/fallback-e2e.test.ts:95; Tier 0.10 needed |
| 8-file bootstrap (SOUL/AGENTS/etc) wired into prompt | ❌ NEVER INVOKED | grep confirms `loadBootstrapFiles` has ZERO callers |
| SOUL.md path | ⚠️ CHECK | persona.ts:89 uses wotannDir param; check callers actually pass workspace+$HOME |
| AutoresearchEngine generator | ❌ NO-OP | runtime.ts:934 async()=>null |
| active-memory.ts:141 field-name bug | ❌ PRESENT | silent recall-never-fires |
| memory_search_in_domain duplicate tool def | ❌ PRESENT | memory-tools.ts:149+218 |
| autodream stop-word filter | ❌ MISSING | autodream.ts:163 legacy 4-phase lacks stop-words |
| vector-store re-embed on first search | ❌ PRESENT | vector-store.ts:181 claims O(n) but re-embeds inline |
| FTS5 coverage claim (8-layer) | ❌ INCORRECT | only memory_entries + verbatim_drawers have FTS5 |
| Runering emits | ✅ FIXED (session 10) per commit f9647c9 | verify emit call sites |
| CapabilityChips integrated | ✅ FIXED (session 10) per commit 8e3a3fe | verify import sites |
| SealedScroll in TrustView | ✅ FIXED (session 10) per commit ef0ab14 | verify |
| Well scrubber mounted | ✅ FIXED (session 10) per commit ef0ab14 | verify ⌘⇧T binding |
| FocusView activation | ✅ FIXED (session 10) per commit 8e3a3fe | verify ⌘⇧L + palette entry |
| 10 dead HookEvent variants | ✅ FORMALIZED (session 10) per 4d41702 marked advisory |
| Workshop+Exploit pills ⌘3/⌘4 | ✅ FIXED (session 10) per 9fe4252 |
| Monaco worker explicit registration | ⚠️ UNKNOWN | MonacoEditor.tsx needs grep for MonacoEnvironment.getWorker |
| MLX inference | ✅ REAL | OnDeviceModelService.swift uses LLMModelFactory.load + model.generate |
| 104 Tauri commands | ✅ ALL REGISTERED | commands.rs 3554 lines, every invoke matches |
| Channels 14/16 REAL, not dead | ✅ CONFIRMED | all adapters have genuine protocol impl |
| ACP end-to-end | ✅ REAL | protocol.ts + server.ts + stdio.ts + runtime-handlers.ts |
| OAuth login production-ready | ✅ REAL | PKCE SHA-256, listen(0) no-TOCTOU, device-code fallback, 6 providers |
| Connectors registered | ❌ EMPTY AT RUNTIME | Only ConnectorRegistry instantiated; concrete classes never register |
| 10 skills missing frontmatter | ⚠️ CHECK | a2ui, canvas-mode, batch-processing, computer-use, cost-intelligence, lsp-operations, mcp-marketplace, benchmark-engineering, prompt-testing, self-healing |
| 9 CLI files without command wiring | ❌ PRESENT | audit, away-summary, history-picker, incognito, loop-command, onboarding, pipeline-mode, test-provider |
| Claude-agent-sdk in deps | ❌ PROPRIETARY | still in regular deps (license blocker) |
| Event listener leak 73 .on()/0 .off() | ❌ PRESENT | 30-day OOM risk |
| Memory retention policy | ❌ MISSING | audit_trail/auto_capture/trace_analyzer/arena unbounded |
| mcp.add command validation | ❌ MISSING | kairos-rpc.ts:3079-3105 persistent command injection |
| shell injection voice-mode + tts-engine | ❌ PRESENT | voice-mode.ts:509 + tts-engine.ts:455 execFileSync sh -c |
| WOTANN_AUTH_BYPASS guard | ❌ UNGUARDED | need NODE_ENV==="test" gate |
| webhook timing-safe compare | ❌ MISSING | webhook.ts:104 non-constant-time |
| macOS sandbox entitlement | ❌ FALSE | Entitlements.plist:6 app-sandbox=false |
| Command sanitizer bypasses | ❌ 7+ | regex-based, shell-parse needed |
| Rust backstop blocklist | ❌ SUBSTRING | commands.rs:1369-1436 |
| npm audit 7 CVEs | ❌ PRESENT | 2 high + 5 moderate (picomatch ReDoS) |
| FUSE overlay sandbox | ❌ MISSING | spec App. E.4 claims exist; code doesn't |
| ESLint 9 migration | ❌ PRESENT | lint silently no-ops |
| turboquant.ts renamed | ❌ PRESENT | still 381 LOC marketing lie |

## Consolidated Execution Plan

### Phase 1: HEAD Verification Sweep (1 day)

Before any implementation, run the HEAD Verification Step on every task in the plan. Re-update the status matrix above. Any `⚠️ CHECK` resolves to ❌ or ✅. Output: `verification-report.md` with current state.

### Phase 2: Tier 0 Lies (verification-filtered, target 6-10 days)

Only tasks still showing ❌ in matrix:
- Tier 0.1 Bedrock toolConfig + event-stream decoder (2d)
- Tier 0.2 Vertex body + stream parser (2d)
- Tier 0.3 Azure URL (0.5d)
- Tier 0.4 Ollama stopReason (0.25d)
- Tier 0.5 Copilot 401 retry (0.5d)
- Tier 0.6 Copilot per-session token (0.5d)
- Tier 0.7 tolerantJSONParse (0.5d)
- Tier 0.8 Camoufox persistent subprocess (3d)
- Tier 0.9 Strip 40+ toBeTruthy tautologies (1d)
- Tier 0.10 Remove fallback-e2e self-equality (0.1d)

### Phase 3: S4 Prior-Audit Criticals (Tier 0b, 10-15 days)

All findings from MASTER_AUDIT_2026-04-14 §4 §44 still applicable:
- S.4.4 Shell injection voice-mode.ts:509 + tts-engine.ts:455 (1h)
- S.4.5 composer.apply path write (1h)
- S.4.6 WOTANN_AUTH_BYPASS gate (15min)
- S.4.7 webhook timing-safe compare (15min)
- S.4.8 mcp.add command validation (1h)
- S.4.9 10 skills frontmatter (30min)
- S.4.10 10 fake-guarantee hooks (2h)
- S.4.12 Event listener cleanup 73 .on()/0 .off() (4h)
- S.4.13 Memory retention policy (3h)
- S.4.14 ESLint 9 migration (30min)
- S.4.15 Rename turboquant.ts → ollama-kv-compression.ts (10min)
- S.4.16 claude-agent-sdk → peerDependencies (10min)
- S.4.17 npm audit fix (5min)
- S.4.23 agent-bridge tools forwarding (VERIFY — may be DONE, commit f9647c9)
- S.4.24 parseToolCallFromText wiring (VERIFY against agent-bridge response processing)
- S.4.25 Gemini includeThoughts opt-in (15min)
- S.4.26 **NEW: Wire loadBootstrapFiles + buildIdentityPrompt into runtime.ts prompt assembly** (2h)
- S.4.27 **NEW: Fix active-memory.ts:141 field name** — unlocks recall pipeline (5min!)
- S.4.28 **NEW: Delete duplicate memory_search_in_domain tool definition** (2min)
- S.4.29 **NEW: Fix autodream stop-word filter** (15min)
- S.4.30 **NEW: Vector-store re-embed on first search** (2h)
- S.4.31 **NEW: FTS5 coverage on all memory tables** (3h)
- S.4.32 **NEW: ConnectorRegistry register concrete classes** (2h)
- S.4.33 **NEW: Wire 9 CLI command files** (2h)

### Phase 4: Top-40 Leaderboard Items Still Open (2350 LOC net, 17 days)

Items 10, 11, 13, 14, 15, 16, 18, 20, 21, 23, 24, 25 from MASTER_PLAN_SESSION_10 §5 — the provider/memory/desktop items not yet session-10-committed.

### Phase 5: Tier 1 Benchmark Harness (20 days)

From V1 plan — all still needed (benchmark runners not wired).

### Phase 6: Tier 2 Codex Parity P0 (17 days)

From V1 plan — OS sandbox (most critical), thread/fork/rollback, mcp-server mode, unified_exec PTY, shell_snapshot, request_rule.

### Phase 7: Tier 3 Memory Upgrades (11 days) + addendum items 41-44 (9 days)

- Tier 3.1-3.8 from V1 plan
- Item 41 MemPalace drawer layer (2d)
- Item 42 Domain/topic partitioning +34% retrieval (1.5d)
- Item 43 L0-L3 progressive context loading (2.5d)
- Item 44 Conversation mining (3d)

### Phase 8: Tier 4 Self-Evolution (20 days) + addendum items 45-47 (7 days)

- Tier 4.1-4.8 from V1 plan
- Item 45 better-harness pattern (4d)
- Item 46 Sub-250ms first paint (1.5d)
- Item 47 /skill:name slash dispatch + --skill flag (1.5d)

### Phase 9: Tier 5 UI/UX Distinction (12 days from V1) + UI_DESIGN_SPEC signature interactions + UX_AUDIT findings

Add to V1 Tier 5:
- 7 signature interactions per UI_DESIGN_SPEC § 4 (Runering done, 6 more)
- 3 layout innovations (Mead-Hall morph, Conversation Braids, Well scrubber — Well done)
- 10 micro-interactions with exact parameters (section § 6)
- 5 onboarding hooks (Well of Mimir primary)
- Sound design (4 cues, opt-in)
- Mobile/Watch/Widget/CarPlay full spec implementation
- A11y 7:1 contrast floor + prefers-reduced-motion respect

### Phase 10: Tier 6 Skills (30 tasks, 25 days parallelized to 5) + addendum item 50

Port top-30 per V1 + Item 50: Survey OpenClaw 560-skill library for 10-20 lift candidates (2d).

### Phase 11: Tier 7 Channel Parity to 24 (7 tasks, 10 days) — unchanged from V1

### Phase 12: Tier 8 FUSE Security Moat (4 tasks, 15 days) — unchanged from V1

### Phase 13: God-Object Split (Wave 6 per session-10)

- runtime.ts 4553 → 4 files (6h)
- kairos-rpc.ts 5375 → 5 files by RPC domain (6h)
- TUI App.tsx 2979 → 4 files (4h)
- index.ts 3574 → src/cli/commands/<group>.ts (4h)

### Phase 14: Hermes 100-Commit Delta Audit (BLOCKING Wave 5)

Dispatch Opus agent to audit hermes-agent main branch since Apr 9. Extract NEW patterns missed by existing items. ~1 day research.

## Total Effort Estimate

| Phase | Days |
|-------|------|
| 1. HEAD Verification | 1 |
| 2. Tier 0 Lies (verification-filtered) | 6-10 |
| 3. S4 Prior Criticals | 10-15 |
| 4. Top-40 Items Still Open | 17 |
| 5. Tier 1 Benchmark Harness | 20 |
| 6. Tier 2 Codex Parity P0 | 17 |
| 7. Tier 3 Memory + addendum 41-44 | 20 |
| 8. Tier 4 Self-Evolution + addendum 45-47 | 27 |
| 9. Tier 5 UI/UX + UI_DESIGN_SPEC | 25 |
| 10. Tier 6 Skills | 25 (parallel to 5) |
| 11. Tier 7 Channels | 10 |
| 12. Tier 8 FUSE | 15 |
| 13. God-Object Split | 3 |
| 14. Hermes Delta | 1 |
| **TOTAL SERIAL** | **197-206 days** |
| **WITH 3 PARALLEL STREAMS** | **~75 calendar days** |

## Race Window Discipline

Ship v0.4.0 public MVP by **June 30, 2026** (60-90 day window per session-10). Prioritize Phases 1-4 above all else for public readiness. Phases 5-14 continue post-MVP.

## Autonomous Execution Protocol

1. **Context reboot**: on session start, `mem_context` + read CANONICAL STATUS MATRIX (line 19-75 of this doc).
2. **Pick next task**: top unfinished by tier + priority + effort-per-leverage.
3. **HEAD verify**: run verification step from Phase 1 on this task's predicate.
4. **If DONE-PRIOR**: mark complete, save `mem_save` with `topic_key: wotann/verified-done/<task-id>`, pick next.
5. **If STILL OPEN**: implement with red-green-refactor.
6. **Verification**: run task's exact verification command. Show output.
7. **Commit**: conventional-commit per template.
8. **Memory**: `mem_save` with `topic_key: wotann/execution/<task-id>` including: what changed, tests passed, actual effort, anything discovered mid-task.
9. **Benchmark drift check**: if touched adapter/middleware/memory — run 20-task smoke (npm test -- tests/{providers|middleware|memory}/). If failed, rollback + file new task.
10. **Next**: goto 2.

## Success Metrics

- **Phase 1-2**: all adapter tests pass, tool serialization 4/4 primary providers verified in wire-level tests
- **Phase 3**: zero `.skip` left for platform-gated tests (or documented why), all critical security items closed
- **Phase 4-5**: WOTANN benchmark runs produce valid `trajectories/*/report.json` for HumanEval + SWE-bench Lite + TerminalBench 10-task smokes
- **Phase 6-8**: Self-evolution tournament produces monotonic benchmark lift across N epochs without human intervention
- **v0.4.0 ship criteria**: 3942+ tests pass, benchmark harness produces reproducible runs, public MVP shippable with `curl | sh` installer, no CRITICAL/HIGH security items open

## References

- V1 plan: `/wotann/docs/AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md`
- Session 10: `/wotann/docs/MASTER_PLAN_SESSION_10.md`, `MASTER_PLAN_SESSION_10_ADDENDUM.md`, `SESSION_10_STATE.md`
- Previous audits: `MASTER_AUDIT_2026-04-18.md`, `MASTER_AUDIT_2026-04-14.md`, `DEEP_AUDIT_2026-04-13.md`, `GAP_AUDIT_2026-04-15.md`, `_DOCS_AUDIT_2026-04-18.md`
- Deep-read outputs: `CORE_DAEMON_DEEP_READ_2026-04-18.md`, `PROVIDERS_MIDDLEWARE_DEEP_READ_2026-04-18.md`, `MEMORY_ORCHESTRATION_DEEP_READ_2026-04-18.md`, `UI_PLATFORMS_DEEP_READ_2026-04-18.md`, `CHANNELS_ACP_CONNECTORS_DEEP_READ_2026-04-18.md`
- UX: `UI_DESIGN_SPEC_2026-04-16.md`, `SESSION_8_UX_AUDIT.md`, `UX_AUDIT_2026-04-17.md`
- Competitor analysis: `/research/competitor-analysis/*.md` (8 docs)
- Perplexity+MemPalace+LoCoMo: `competitor-research-perplexity-mempalace-2026-04-09.md`
- Dead-code reclassification: `DEAD_CODE_REPURPOSING_2026-04-18.md`
- Memory topics: all `wotann/*` topic keys via `mem_search`
