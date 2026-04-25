# V9 Unified Gap Matrix — 2026-04-25

**Source**: Synthesis of 26 deep audits (Wave 1: tier-by-tier × 6, Wave 2: subsystem depth × 11, Wave 3: research/release/memory × 5, Wave 4: T1/T3/T6 deep-trace × 3, Web research × 2).
**HEAD**: `3c370e8` (post v9-deep-closure session).
**Test baseline**: 9396 passing / 7 skipped / 0 failing. tsc rc=0. v9-drift-check 6/6 OK.

## Section 1 — TRUE SHIP-BLOCKERS (must close before any v0.5.0 / v0.6.0 GA)

| # | Item | Files | LOC | Risk if shipped without |
|---|---|---|---|---|
| **SB-01** | **Supabase key + git history rotation (FT.1)** — blob `dbaf1225` reachable via 7 local + 4 remote refs + GitHub Blob API + raw v0.1.0 URL. Audit docs `AUDIT_LANE_4_INFRA_SECURITY.md` + `AUDIT_CURRENT_STATE_VERIFICATION.md` carry literal key — pushing them re-leaks. | git history + 2 audit docs | user-action + 9 git ops + redaction | Public PoC against project's Supabase backend |
| **SB-02** | **release.yml parse-fail** (`secrets.*` in step `if:` lines 148+196) — blocks every push for 5 days, no v0.5.0 ship possible | `.github/workflows/release.yml`, secret rename (`APPLE_*` mismatch) | ~30 LOC | No release pipeline; npm/brew/dmg never publish |
| ~~**SB-03**~~ | ~~magika+@xenova CVEs~~ — **DONE in prior session** (Wave A2 verification 2026-04-25). `npm audit --omit=dev` returns 0 vulnerabilities. magic-bytes.js shipped. Source uses no magika imports — only historical comments documenting the removal (file-type-gate.ts, zip-reader.ts, runtime.ts comments). Audit-doc claim was stale. | — | — | — |
| ~~**SB-04**~~ | ~~SSRF guard merge-forward~~ — **DONE in commit `849c51e`** (Wave A3 verification 2026-04-25). All 9 RFC ranges + AWS IMDSv6 + metadata.goog covered; 46 tests passing. Audit-doc claim that this was open was a stale read — internal-docs mining didn't cross-check git log. | — | — | — |
| **SB-05** | **Linux release SHA-256 mismatch on v0.4.0** + missing raw-binary `.sha256` for Linux + Windows | release pipeline | ~40 LOC | brew install fails on Linux/Intel-mac |
| **SB-06** | **CometJacking + ShadowPrompt defenses** — query-string strip on URL→prompt injection, exact-origin matching (no wildcards), no innerHTML-injection patterns, multi-encoding (base64/hex/punycode) pre-decode | `src/security/url-instruction-guard.ts` (extend), Editor preview pane | ~340 LOC | One-click takeover via crafted URL |
| **SB-07** | **Anthropic OAuth dual-auth** — non-Claude-Code OAuth tokens server-rejected since 2026-01-09. Need API-key path (business) + OAuth-via-CC mode (personal-only) with banner UI distinguishing | `src/auth/`, `src/cli/onboarding-screens.tsx` | ~220 LOC | All product/business users blocked at first call |
| **SB-08** | **Bundled-binaries placeholders** — `ollama-aarch64-apple-darwin` is 89B shell script printing "placeholder", `whisper-aarch64-apple-darwin` is 0B. Tauri externalBin will silently no-op at runtime | `desktop-app/src-tauri/tauri.conf.json` (delete `externalBin`), `binaries/` (delete) | -8 LOC + 2 deletes | Desktop app runtime errors when any code tries spawning them |
| **SB-09** | **npm tarball 597MB unpacked / 283MB packed** — 5x npm soft-warn. Includes `dist/release/wotann.blob` (95MB SEA) + 70+ duplicate `* 2.*` Finder copies | `.npmignore` extend, `dist/release/` exclude | ~30 LOC config | npm publish rejection or warning, slow installs |
| **SB-10** | **Gemma 4 + FT.3.2 + bundled doc claims** — CLAUDE.md says "Gemma 4 bundled" (FALSE). FT.3.2 says "Tauri Mobile Android aab shipped" (FALSE — no `gen/android/`, no CI job). Plus 18 stale audit MDs not yet archived per V9 Hygiene Directive #1 | `CLAUDE.md`, `MASTER_PLAN_V9.md` truth-up edits, archive 18 MDs | doc edits | False-claim shipped to public |

**SB total estimate**: ~1,290 LOC + git ops + user action (Supabase rotation). **Without these**: no responsible v0.5.0 launch.

**LESSON learned 2026-04-25**: SB-03 + SB-04 were both reported open by internal-docs mining but had been shipped in prior sessions. Future audit waves MUST run:
1. `git log --oneline --grep="<keyword>" -10` to find the closure commit
2. `npm audit --omit=dev` for CVE claims
3. `grep -rn '<orphan-symbol>' src/` for orphan claims (filter out comment-only matches)
BEFORE treating an audit-doc claim as live work. Stale audit docs are a recurring source of false positives. **Recommend internal-docs/AUDIT_LANE_*.md catalogs themselves be archived after each closure session — keeping them perpetuates stale claims.**

## Section 2 — V9 GA BLOCKERS (close before declaring tier complete)

| # | Item | V9 Tier | LOC | Cascading impact |
|---|---|---|---|---|
| **GA-01** | **T1.1 KEYSTONE — cursor stream emission missing** — V9 spec was wrong about `ComputerUseAgent.dispatch()` (returns prompt, not exec). Real fix: add `cursor.record()` emit after `executeDesktopAction` + add click/scroll/move-mouse to ROUTE_TABLE | T1.1 | ~45 LOC across 2 files (`platform-bindings.ts`, `kairos-rpc.ts:5540`) | Unblocks T5.2 cursor stream, T5.1 computer session, T7.1 Live Activity, T5.12 Fleet, T12.18 Replay buffer becomes meaningful |
| **GA-02** | **T3 bridge `deps:{}` empty** — `runtime.ts:1934` passes empty deps + no `wotannMcpServer`. Subscription Claude users get vanilla CLI with hooks that no-op. All 8 deps already alive on `this`. | T3.1 | ~140 LOC new `src/claude/bridge-deps.ts` + 6 patch sites | Unblocks T3.2 (10 MCP tools functional), T3.3 (hooks fire), T3.4 (custom agents), T3.6 (cost ledger + quota probe). Single biggest strategic unlock. |
| **GA-03** | **T6 wizard requires `--wizard` flag, defaultRunner is stub** — `defaultFirstRunRunner` yields literal "not yet wired" text. T6.6 first-run-success unreachable. **Per user directive: NO LM Studio specific adapter — use LibreChat custom-endpoint YAML pattern instead.** | T6.2/T6.6 | ~330 LOC across 5 files (8 patches, MINUS LM Studio scope) | Unblocks T6 onboarding, time-to-first-token <90s p50, exercises T3 + T11.3 cloud-offload + T7 cost preview on every fresh install |
| **GA-04** | **T2.1 corpus missing on disk** — `.wotann/benchmarks/longmemeval/` doesn't exist. T2.4 nightly workflow silently skips when `LONGMEMEVAL_JUDGE_KEY` secret missing. | T2.1+T2.4 | run script + add fail-closed prereq | T2 SOTA score never published. WOTANN ships with no benchmark proof. |
| **GA-05** | **AuditTrail SQLite never written** — 211-LOC class with `record()`, `query()`, `pruneOlderThan()`. Read paths exist (`cli/audit.ts`, `kairos-rpc.ts:4452`). Zero `record()` callers. Approval decisions live in-memory only. | T14 cross-cutting | ~80 LOC wiring 4 sites | Every approval lost on process exit. Compliance/audit gap. |
| **GA-06** | **OTEL spans never emitted** — `createOpenInferenceTracer` + `createOtelExporter` have ZERO callers. T12.10 false-claim. | T12.10 | ~100 LOC wiring at runtime turn loop next to `costTracker.record` | Observability surface dead. Langfuse/Phoenix/W&B Weave promises unfulfilled. |
| **GA-07** | **Cost threshold warnings missing** — per-turn record fires but no 75/90/95% warning ladder. T11.3 PARTIAL. | T11.3 | ~60 LOC + 3 surface wires | Users hit quota silently. |
| **GA-08** | **USER.md learning broken** — `updateUserProfile`/`proposeIdentityUpdate`/`updateMemoryIndex` have ZERO callers. T14.5 false-claim. | T14.5 | ~30 LOC wire `runDreamConsolidation` to call `selfEvolution.updateUserProfile` | USER.md never grows. Self-evolution dormant. |
| **GA-09** | **T11.1 + T11.2 consumer-orphan pair** — virtual-cursor-pool + consumer + cursor-sprite + session-scoped-perception form a 4-file island with ZERO production importers. Sleep-time-consumer also test-only. T11 capstone is decorative. | T11.1+T11.2 | ~60 LOC wire from coordinator/runtime | T11 capstone non-functional in production. |
| **GA-10** | **T12.18 ReplayRegistry created+disposed but never `append()`ed** — companion-server.ts ws.send sites never tap registry. Reconnecting iOS client loses every frame between disconnect/resubscribe. | T12.18 | ~50 LOC wire at 4 ws.send sites + reconnect path | Mobile users on flaky networks lose all in-flight events. |
| **GA-11** | **5 iOS surfaces dead — no daemon emitter**: stream.text/done/error (ChatViewModel), exploit.status (ExploitView), council.update (CouncilView), autonomous.progress/done (AutopilotView), conversation.updated (CarPlay), node.invoke (NodeCapability). Plus carplay.dispatch + watch.dispatch handlers don't `broadcastUnifiedEvent()`. | T5.10/T5.13 cross-cutting | ~120 LOC across companion-bridge.ts + 4 RPC handlers | Half of iOS feature surfaces compile but receive nothing. |
| **GA-12** | **T13 iOS Editor LSP not wired** — `EditorHoverCard.swift` claims to render LSP hovers; no iOS Service calls daemon `lsp.*` RPC. T13.3 false-claim. | T13.3 | ~80 LOC iOS RPC client integration + 1 daemon handler verification | iOS code editor LSP intelligence non-functional. |
| **GA-13** | **OMEGA `getOmegaLayers()` default-on but ZERO callers** in retrieval pipeline. T2.3 performative. | T2.3 | ~40 LOC wire temprSearch to layer3.list() + auto_capture to layer1.append() | T2.3 marketed but inert. |
| **GA-14** | **iOS @Observable holdouts** — actually 49 not 14 per T7 audit. Migration ~42% complete. | T14.3 | ~14 file refactor (~1 week of work) | Performance + state parity gap with iOS 18 expectations. |
| **GA-15** | **`creations.watch` daemon handler missing** — iOS `CreationsView.swift:280` calls it; no handler. Silent fail (`try?` swallows). Handler exists at "creations.updated" topic only. | T5.4 | ~30 LOC daemon handler + alias | Creations fan-out to iOS partial. |
| **GA-16** | **Magic Commands palette desktop-side missing** — T12.17 CLI verb works (`wotann magic <cmd>`), but no `cmd+shift+M` palette + zero `MagicCommand*` symbols anywhere in desktop-app/src/ | T12.17 desktop | ~300 LOC new `MagicCommandsPalette.tsx` | T12.17 unreachable from desktop UI |

**GA total estimate**: ~1,500 LOC + 1 week iOS refactor.

## Section 3 — REACH GAPS (CLI works, surfaces don't)

| # | Item | LOC |
|---|---|---|
| **R-01** | Desktop Browse/Studio/Fleet/Creations are orphan views — `case` registered in AppShell but no Sidebar/Palette entry | ~80 LOC palette+sidebar entries |
| **R-02** | Desktop Recipe/Build/Deploy/Offload/SOP/Agentless/PR-check zero UI | ~600 LOC across 7 panels |
| **R-03** | iOS MainShell only 4 tabs (Home/Chat/Work/You) — Memory buried 3 taps in Settings; Autopilot in Settings; CarPlay no scene declaration verified | ~150 LOC navigation surface lift |
| **R-04** | iOS pairing wizard has no provider config | ~120 LOC pairing+provider screen |
| **R-05** | PatronSummoning (T14.4) listens `wotann:open-patron` — zero emitters in source | ~10 LOC settings button |
| **R-06** | RavensFlightAnimation + SigilStamp listen events with zero emitters | ~30 LOC daemon→client emit at dispatch + edit boundaries |
| **R-07** | McpAppOverlay listens `wotann:mcp-app-mount` — zero emitters | ~25 LOC tool result → emit |
| **R-08** | iOS approval queue desktop-only (no iOS approval UI) | ~150 LOC iOS approval surface |
| **R-09** | TUI Cmd+P command palette completely missing (biggest TUI gap per L3 audit) | ~250 LOC Ink palette |
| **R-10** | Libraries empty: `.wotann/recipes/`, `.wotann/rules/`, `.wotann/checks/` — runners exist, content doesn't | ~20 starter files |
| **R-11** | Voice CLI thin (`wotann voice status` only) — daemon supports streaming/transcription/TTS | ~60 LOC subverbs |
| **R-12** | Execution mode picker desktop-only (no `wotann mode` CLI verb) | ~40 LOC verb |

**R total estimate**: ~1,535 LOC + 20 starter files.

## Section 4 — DEAD CODE (delete or wire decision)

**DELETE-NOW** (~3,500-4,500 LOC removable, no V9 promise, no future intent):

| Item | LOC |
|---|---|
| `src/intelligence/kg-builder.ts` | 1005 |
| `src/orchestration/jean-orchestrator.ts` + `jean-registries/` | ~600 |
| `src/sandbox/kernel-sandbox.ts` + `sandbox-policy.ts` (entire subsystem unreachable; real sandbox is `executor.ts`) | ~600 |
| `src/sandbox/backends/cloud-auth.ts` | ~150 |
| `src/sandbox/modal-backend.ts` (test-only; no production picker) | 131 |
| `src/orchestration/{sleep-time,virtual-cursor}-consumer.ts` (if T11 not wired) — see GA-09 | ~300 |
| `src/orchestration/red-blue-testing.ts` | ~200 |
| `src/training/rl-environment.ts` | ~250 |
| `src/core/agent-profiles.ts` | ~150 |
| `src/channels/webhook-router.ts` | ~180 |
| `src/optimize/textgrad-{optimizer,critic,types}.ts` (T12.9 zero importers) | ~280 |
| `src/marketplace/plugin-loader.ts` (per voice/intel audit, zero callers) | ~150 |

**WIRE-NOW** (orphan but V9 calls for it):

| Item | LOC | Wire site |
|---|---|---|
| `getPerceptionEngine()` zombie-getter | small | `kairos-rpc.ts` `computer.session.observe` handler |
| `getCloudSyncEngine()` zombie-getter | small | `memory.cloud.sync` RPC + `wotann sync` CLI |
| `getReasoningEngine()` zombie-getter | small | middleware pre-completion or autopilot reasoning |
| `wireGateway()` orphan | small | `kairos.ts` startup channel-adapter registration |
| `feedback-collector.ts` constructed-not-called | ~30 | wire to dream-cycle cron |
| `auto-update.ts` orphan + opt-in for phone-home | ~80 | doctor command + opt-in prompt |
| 6 channels (line/viber/wechat/feishu/dingtalk/mastodon) constructable but no `startChannelGateway` arm | ~180 (30 LOC × 6) | `kairos.ts:1320+` |

## Section 5 — PATH/DOC DRIFT (V9 spec ↔ source mismatch)

| Item | Action |
|---|---|
| T12.7 stages/ vs spec roles/, T12.10 observability/ vs telemetry/, T12.11 backend file rename, T12.15 evals/ vs testing/, T12.20 build/deploy-targets/ vs adapters/, T12.21 opencode-sst-adapter.ts | Update V9 spec text to match shipped paths (per QB#15: source wins) |
| T13.1 5 Editor file renames (RunestoneRepresentable→RunestoneEditorView, EditorLanguageMap→EditorLanguages, EditorTheme→EditorThemes, EditorKeyboardBar→EditorToolbar, plus Composer at /Chat not /Input) | Update V9 spec |
| HOW-block signature drift on 7 Tier 1 items (T1.1/3/4/5/6/7/8 deviated, V9 plan text never updated) | Update V9 to reflect actual function signatures |
| CLAUDE.md "16-layer pipeline" → actual 33 layers; "23 hooks" → actual 27; "65+ skills" → actual 101; "11 providers" → actual 19/20; "22 subdirs" → actual 65; "85% implemented" → actual 23/50/26 split | Truth-up CLAUDE.md |
| README.md 5860 tests → 9396; provider count loose framing; Project Structure missing 30+ subdirs; AAIF badge present ✓ | README.md update |
| LICENSE = MIT but T12.13 ports Apache-2 OpenClaw → NOTICE file MISSING | Add NOTICE listing OpenClaw + 13+ acknowledged projects |
| site/index.html stuck on "v0.4.0 released" + 5860 tests | Bump |
| CHANGELOG missing v0.6.0 + missing v0.5.0 compare links | Backfill |
| docs/RECIPES.md, docs/PR_CHECKS.md MISSING (V9 promise) | Write |
| docs/BENCHMARKS.md placeholder | Populate after GA-04 |

## Section 6 — V9 ADDITIONS (research-derived, not currently in plan)

**HIGH IMPACT** (12):

| New Item | Source | LOC |
|---|---|---|
| Hash-anchored edits (silent-corruption defense) | competitor mining | ~600 |
| Serena symbol-level primitives via SolidLSP (8 atomic tools) | competitor mining | ~1500 |
| Camoufox persistent browser bridge fix (T10 builds on FAKE stub) | competitor mining | 600-2900 (2-3d minimum) |
| OpenAI Agents Handoff + Tripwire guardrails primitives | competitor mining | ~900 |
| AgentShield runtime sanitizer (cross-cutting, beyond browser-only T10.P0) | competitor mining | ~700 |
| Letta typed memory blocks (V9 T14.2 missing the typed-block primitive) | competitor mining | ~600 |
| Conversation branching/forking semantics (T14.4 visual-only, no fork/rollback) | competitor mining | ~800 |
| Cloudflare Project Think — Sandboxed Dynamic Workers + Durable Object Facets | web research | ~640 |
| Best-of-N (Cursor 3.0 parity) for Workshop tab | web research | ~720 |
| MCP `mcp_tool` hook type (CC v2.1.118) | web research | ~140 |
| Hermes CredentialPool + Cron file-lock + ContextCompressor 3-pass + classifyApiError | Hermes research | ~1500 |
| Workflow runner orphan wire (Conductor JSON workflows for Exploit tab) | orphan + research | ~50 wire |

**MEDIUM** (15+):

| New Item | Source | LOC |
|---|---|---|
| `wotann migrate` (ingest configs from 8 AI tools) | competitor mining | ~500 |
| OSC 133 block model for terminal | competitor mining | ~700 |
| Stream-JSON output mode standard | competitor mining | ~200 |
| Custom endpoints via user YAML (LibreChat — supersedes per-provider adapters; per user directive THIS replaces special-casing local providers like LM Studio) | competitor mining + user directive | ~500 |
| Aider CTAGS whole-repo map upgrade | competitor mining | ~600 |
| Conductor worktree-per-agent + hash-allocated ports | competitor mining | ~500 |
| Model Council primitive (per-task routing) | competitor mining | ~700 |
| MinerU multimodal ingestion (PDF/Office/image deep-parse) | Engram | ~400 |
| Continuous-learning STaR + DGM archive (beyond autoDream) | competitor mining | ~1400 |
| Speculative decoding for diff edits (Cursor-class latency) | competitor mining | ~500 |
| LSP registry (lsp-tools.ts 333 LOC + agent-tools) wire | orphan | small wire |
| Mastra ProviderHistoryCompat error-processor rule architecture | repo monitor | ~300 |
| MCP tool interceptors via `extensions_config.json` (deer-flow) | repo monitor | ~250 |
| Mem0 v3 API parity + eval framework | repo monitor | ~600 |
| `excludeDynamicSections` cache pattern (SDK-TS v0.2.119) | web research | ~80 |

**LOW** (15+ items): note-taking toolkit (CAMEL/SETA), reliability metrics, Karpathy 4-principles audit, system 1/2 split, recall-router (Cognee), DMR benchmark runner, Bugbot learned rules from PR feedback, generator-evaluator loop, sequential_thinking on test fail, OpAgent 4-module pattern, Goose-compat mode test verification, etc.

## Section 7 — UNAUDITED (still need probing)

1. Tool catalog cardinality — am I shipping 50+ tools per call vs ≤13 target?
2. `wotann ask "hi"` end-to-end happy path verification
3. Skill conflict resolution (101 file-skills + 20 .wotann + 18 BUILT_IN)
4. `assembleWotannSystemPrompt()` — V9 references; doesn't exist; T3 deep-dive recommends reuse `assembleSystemPromptParts`
5. Cost rates table currency (Anthropic dropped TTL 1hr→5min Mar 6 — existing rates may be 2x wrong)
6. `wotann.yaml` config schema — never read
7. `wotann worktree` end-to-end
8. 23 missing RPC methods (G1-G23 from internal docs)
9. 14 missing iOS views (M1-M14 from internal docs)
10. Settings panel completeness per surface
11. `wotann uninstall` cleanup + Keychain removal
12. Concurrent safety / lock files
13. 200+ Finder duplicates global inventory
14. Test meaningfulness (88 toBeTruthy + 15 happy-path-only + 5 mock-asserts-mock per TESTS_SUSPECT)
15. Live Codex/Claude CLI subscription detection on this machine
16. `wotann --version` actual output
17. wotann.com promise→ship-state line-by-line comparison
18. `research/__new_clones_v3/` newest competitors deep-read
19. `python-scripts/` directory contents
20. v9-drift-check coverage of plan body's hundreds of file:line citations (only 6 baselines verified)

## Section 8 — Closure Wave Plan

**WAVE A — SHIP BLOCKERS (SB-01 → SB-10, ~1,290 LOC)**
6 parallel agents, whole-file ownership:
- Agent A1: SB-02 release.yml fix + SB-05 SHA-256 + SB-09 npm tarball cleanup (`.github/workflows/release.yml`, `.npmignore`, `Formula/wotann.rb`, `dist/release/`)
- Agent A2: SB-03 magika+@xenova drop, replace with magic-bytes.js (`package.json`, ~5 source files using magika imports)
- Agent A3: SB-04 SSRF guard merge-forward (`src/security/ssrf-guard.ts`, tests)
- Agent A4: SB-06 CometJacking/ShadowPrompt defenses (`src/security/url-instruction-guard.ts` extend, Editor preview pane)
- Agent A5: SB-07 dual-auth banner + mode (`src/auth/`, `src/cli/onboarding-screens.tsx`)
- Agent A6: SB-08 binaries removal + SB-10 doc truth-up (`desktop-app/src-tauri/tauri.conf.json`, delete binaries/, `CLAUDE.md`, `MASTER_PLAN_V9.md` truth-up, archive 18 stale MDs)
- USER (NOT AGENT): SB-01 Supabase rotation (requires Gabriel's dashboard action)

**WAVE B — V9 GA UNBLOCKERS (GA-01 → GA-16, ~1,500 LOC + iOS refactor)**
8 parallel agents:
- Agent B1: GA-01 cursor stream emit + ROUTE_TABLE entries (`platform-bindings.ts`, `kairos-rpc.ts:5540`)
- Agent B2: GA-02 Claude bridge deps (NEW `src/claude/bridge-deps.ts` + `runtime.ts:1934-1942` + `claude-cli-backend.ts` flag passthrough + `bridge.ts` quota probe)
- Agent B3: GA-03 onboarding wizard default + real runner + provider ladder activation (8 patches across 4 files per T6 deep plan, MINUS LM Studio-specific items)
- Agent B4: GA-04 corpus download script run + GA-13 OMEGA wire + GA-08 USER.md learning wire
- Agent B5: GA-05 AuditTrail.record() wire to 4 sites + GA-06 OTEL spans wire to runtime turn loop
- Agent B6: GA-07 cost threshold warnings ladder + GA-15 creations.watch handler + GA-12 iOS Editor LSP RPC integration
- Agent B7: GA-09 T11 capstone wires + GA-10 ReplayRegistry append/since wire
- Agent B8: GA-11 5 iOS-dead-pipe daemon emitters + carplay.dispatch + watch.dispatch broadcasts

**WAVE C — REACH GAPS (R-01 → R-12, ~1,535 LOC + 20 starter files)**
6 parallel agents (same time as Wave B since file scopes disjoint):
- Agent C1: R-01 + R-02 desktop palette/sidebar entries + 7 missing desktop UI panels (one per V9 CLI verb)
- Agent C2: R-03 iOS navigation lift + R-04 iOS pairing+provider config screen
- Agent C3: R-05+R-06+R-07 emitter wiring (Settings button → patron, daemon → ravens-flight/sigil-stamp/mcp-app-mount events)
- Agent C4: R-08 iOS approval queue surface
- Agent C5: R-09 TUI Cmd+P palette
- Agent C6: R-10 starter packs (recipes/rules/checks) + R-11 voice CLI subverbs + R-12 mode CLI verb + GA-16 MagicCommandsPalette desktop

**WAVE D — DEAD CODE CLEANUP**
Single agent, after Wave A-C green:
- Delete the 12 confirmed-dead modules (~3,500-4,500 LOC)
- Wire the WIRE-NOW orphans
- Channel auto-detect: either wire 6 channels or remove from auto-detect imports

**WAVE E — DOC DRIFT CLEANUP**
Single agent:
- Update V9 spec text to match shipped paths (Section 5)
- Truth-up CLAUDE.md, README.md, site/index.html
- Add NOTICE file
- Backfill CHANGELOG v0.6.0
- Write docs/RECIPES.md, docs/PR_CHECKS.md
- Archive 18 stale MDs

**WAVE F — V9 ADDITIONS (post-GA, deferred to v0.7+)**
Section 6 items prioritized by impact. Hash-anchored edits + Serena symbol primitives + Letta typed blocks first.

**Coordination**: All agents commit individually with `git commit -- <explicit-paths>`, never `git add .`. Whole-file ownership prevents merge conflicts. Re-run `npx tsc --noEmit && npx vitest run && node scripts/v9-drift-check.mjs` after each Wave. Use Engram `topic_key: wotann-v9-closure-2026-04-25` to track progress.

**FINAL TIER (deferred per user)**: FT.1 Supabase rotation (user action), FT.2 god-file splits (runtime.ts/kairos-rpc.ts/index.ts/App.tsx), FT.3 Android native — only after all above waves green.

---

**Net wave estimates**:
- Wave A: ~1,290 LOC + git ops + user action
- Wave B: ~1,500 LOC + 1 week iOS refactor
- Wave C: ~1,535 LOC + 20 starter files
- Wave D: -3,500 to -4,500 LOC (net deletion)
- Wave E: doc edits only
- **Total NEW LOC**: ~4,300; **NET LOC after Wave D deletions**: -200 LOC (codebase shrinks)
- **Wall-clock with parallel agents**: ~8-12 hours for Waves A+B+C, ~2 hours Wave D+E
