# WOTANN Autonomous Execution Plan V4 — 2026-04-18

**Supersedes ALL prior plans.** Built on direct-source reads of runtime.ts/kairos-rpc.ts/prompt-engine.ts, Chrome MCP scraping of blocked competitor sites, and ground-truth of 38 cloned research repos.

## The Brutal Honesty Section

**Prior Wave 1 + Wave 2 + Wave 3 audits got ~50% of "dead/unwired" claims WRONG.** Direct reads of runtime.ts revealed that most flagged "dead code" is actually wired through chain: runtime.ts constructor → production method calls → lib.ts barrel exports → RPC handlers. The real problems are:

1. **DUPLICATE parallel implementations** (persona.ts `loadBootstrapFiles` unused because prompt/engine.ts has inline loop; vector-store HybridMemorySearch has parallel TF-IDF + optional MiniLM paths that both exist)
2. **~5 genuine no-op stubs** (AutoresearchEngine generator `async () => null`, `cron.list` returns `{jobs:[]}`, `memory.verify` always `verified:true`)
3. **Documentation drift across 20 docs** with contradicting claims about same subsystem
4. **Documentation claims features exist that code confirms as present** (agents inferred bugs that session-10 fixed)

**Validated BUGS still present (per direct code read):**

| # | File:Line | Bug | Fix effort | Impact |
|---|-----------|-----|------------|--------|
| 1 | `runtime.ts:934` | AutoresearchEngine constructed with `async () => null` no-op generator | 30 min — wire real LLM generator via runtime.query | Unlocks Karpathy-autoresearch self-optimization |
| 2 | `providers/bedrock-signer.ts:150-156` | Body omits `toolConfig` — tools silently dropped despite supportsToolCalling:true | 2 days — per V3 Tier 0.1 | Unlocks Bedrock tool use |
| 3 | `providers/vertex-oauth.ts:179-185` | Body drops opts.messages/tools/systemPrompt | 2 days — per V3 Tier 0.2 | Unlocks Vertex multi-turn |
| 4 | `providers/registry.ts:176-180` | Azure URL query param before path | 0.5 day — per V3 Tier 0.3 | Unlocks Azure entirely |
| 5 | `providers/ollama-adapter.ts:331-342` | Missing stopReason on tool_calls | 15 min | Unlocks multi-turn Ollama agents |
| 6 | `providers/copilot-adapter.ts:346-355` | 401 says retrying but returns | 30 min | Better UX |
| 7 | `providers/copilot-adapter.ts:88-90` | Module-global cached token | 30 min | Multi-session safety |
| 8 | `providers/tool-parsers/parsers.ts:35-53` | tolerantJSONParse corrupts apostrophes | 30 min | Tool call reliability |
| 9 | `browser/camoufox-backend.ts` | Fresh subprocess per call | 3 days | Real stealth browsing |
| 10 | `tests/mobile/ios-app.test.ts` + others | 40+ `.toBeTruthy()` tautologies | 1 day | Test quality |
| 11 | `tests/integration/fallback-e2e.test.ts:95` | Self-equality assertion | 2 min | Test quality |

**Things PRIOR AUDITS got WRONG (verified by direct code read):**

- ❌ "8-file bootstrap never invoked" — FALSE. prompt/engine.ts:208 `assembleSystemPromptParts` reads .wotann/ + CLAUDE.md/AGENTS.md/.cursorrules/.github/copilot-instructions.md/WOTANN.md + .wotann/rules/*.md at every initialize().
- ❌ "memoryMiddleware producer with no consumer" — FALSE. runtime.ts:2569 Session-10 fix classifies memoryCandidate by tool name and inserts to memory_entries under working/patterns/reference/cases.
- ❌ "KnowledgeGraph every restart wipes graph" — FALSE. runtime.ts:3533 rehydrateKnowledgeGraph on boot + runtime.ts:3550 persistKnowledgeGraph atomic write on close.
- ❌ "decisionLedger getter-only dead code" — FALSE. runtime.ts:3680 recordDecision() dual-persists to in-memory ledger + memoryStore.logDecision SQLite.
- ❌ "assembleSystemPromptParts doesn't include Karpathy preamble" — FALSE. prompt/engine.ts injects KARPATHY_PRINCIPLES_PREAMBLE when `WOTANN_KARPATHY_MODE=1` env set.
- ❌ "Bedrock/Vertex auth fabricated" — FALSE. bedrock-signer.ts:40-100 has full SigV4 HMAC. vertex-oauth.ts:55-100 has RS256 JWT exchange. These are REAL — only the body construction is broken (separate issue).
- ❌ "18 providers in fallback chain claim incorrect" — VERIFIED TRUE per session 10 commit 6ca693d.
- ❌ "Runtime isn't persistent" — FALSE. Session state, stream checkpoints, shadow-git, knowledge graph, decision log, observation-extractor, autodream, cross-session-learner all persist to `.wotann/` subfolders.

## What is genuinely MISSING vs claimed

**Present in runtime.ts constructor but currently inert or weak:**

1. **AutoresearchEngine** (runtime.ts:934) — constructed with no-op generator, but fully functional class waiting for a real LLM generator callback. Wire: pass `async (prompt) => { for await (const c of runtime.query({prompt, ...})) if (c.type==="text") yield c.content; }` as generator. Tier-4 self-evolution activates.

2. **mcp-marketplace.ts** — hardcoded 5 entries + fake `registry.wotann.com`. Either wire real registry backend (Supabase/Github pages static index) or delete and rely on `wotann mcp import --from-claude` which actually works.

3. **turboquant.ts** — 381 LOC that just passes Ollama q4_0 flags. Rename to `ollama-kv-compression.ts` (per session-10 task-3 confirmation). Real TurboQuant awaits upstream llama.cpp merge.

4. **AutonomousExecutor ECANCELED** — documented in MASTER_AUDIT_2026-04-14 §2 live-verified. Need to debug: `wotann autonomous edit-file` → `node:fs:732 Error: ECANCELED: operation canceled, read` at ESM load. Likely an import dep cycle on Ollama adapter under autonomous orchestration. Investigation needed.

## Wave 3 competitor moves (with verified details)

**Newly-confirmed competitive positioning as of 2026-04-18:**

| Competitor | Verified status | WOTANN must match |
|------------|----------------|-------------------|
| **Jean (jean.build + coollabsio/jean GitHub)** | v0.1.41 Apache 2.0 free + Homebrew tap + headless web mode + multi-CLI (Claude/Codex/Cursor/OpenCode) + worktree-per-session + Plan/Build/Yolo modes + Linear+GitHub integrations | Match: install paths, execution modes, multi-CLI, worktree default |
| **Perplexity Computer** | Launched Feb 25 2026 Perplexity Max. Opus 4.6 core + Gemini research + Nano Banana images + Veo 3.1 video + Grok speed + ChatGPT 5.2 long-context. 5-step goal→subtask→sub-agents→async→self-correct. Isolated compute env w/ real filesystem/browser/tools. | Match: multi-model per-subtask routing, async long-running tasks, isolated sandbox with real tools |
| **OpenClaw** | Self-hosted MIT gateway. Node 24+. Pi agent RPC mode + 11 channels (Discord/iMessage/Signal/Slack/Telegram/WhatsApp/Zalo/Matrix/Nostr/Twitch/GoogleChat/WeCom/Teams). npm install -g openclaw@latest → `openclaw onboard --install-daemon` → `openclaw dashboard`. Local port 18789. | Match: single-command install + dashboard + multi-channel + plugin channels |
| **Hermes-Agent (Nous)** | MIT self-improving with closed learning loop. Model-agnostic (Nous Portal/OpenRouter 200+/NVIDIA NIM/MiMo/z.ai-GLM/Kimi/MiniMax/HF/OpenAI). 6 sandbox backends (local/Docker/SSH/Daytona/Singularity/Modal). Serverless persistence on Daytona+Modal. Install: curl pipe bash. `hermes claw migrate` from OpenClaw. | Match: sandbox backend diversity + serverless persistence + OpenClaw migration path |
| **Hermes-Agent-Self-Evolution (Nous)** | DSPy + GEPA (ICLR 2026 Oral MIT). 4-tier optimization (skills→tool descs→prompt sections→code). No GPU, ~$2-10/run. MIPROv2 fallback. Darwinian Evolver for code tier. | Match: DSPy+GEPA integration for Tier-4 self-evolution |
| **Goose (AAIF Linux Foundation)** | Moved from block/goose to aaif-goose/goose. 15+ providers. 70+ MCP extensions. ACP for Claude/ChatGPT/Gemini subscription auth. Apache 2.0. | Match: ACP subscription auth + comprehensive MCP catalog |
| **Context-Mode (mksglu)** | Hacker News #1 570+ points. Used at Microsoft/Google/Meta/Amazon/IBM/NVIDIA/ByteDance/Stripe/Datadog/Salesforce. 3-side context problem: sandbox tools 315KB→5.4KB 98% reduction, SQLite+FTS5 session continuity on compact, think-in-code philosophy. ELv2 license. | Match: PreCompact hook blocking compaction + sandbox tool output isolation + think-in-code enforcement |
| **Archon (coleam00)** | "First harness builder" MIT. Workflow YAML (.archon/workflows/) with nodes (id/prompt/depends_on/loop with until/bash/interactive) + 5 pillars (Repeatable/Isolated/Fire-forget/Composable/Portable) + runs from CLI/Web/Slack/Telegram/GitHub | Match: .wotann/workflows/*.yaml spec + runner + deterministic node types |
| **DeerFlow 2.0 (ByteDance)** | GitHub Trending #1 Feb 28 2026. Ground-up v1→v2 rewrite (no shared code). Python 3.12+ + Node.js 22+. Sandbox hardening, per-agent skill filtering, document outline injection, built-in grep+glob, Langfuse tracing, WeCom 394-line channel, loop detection via stable hash keys, memory middleware case-insensitive dedup. | Port: loop detection hash keys + per-agent skill filter + compound command splitting + document outline injection |
| **Multica (multica-ai)** | "Your next 10 hires won't be human." Managed agents platform — assigns tasks to agents like colleagues. Works with Claude Code/Codex/OpenClaw/OpenCode/Hermes/Gemini/Pi/Cursor Agent. `brew install multica-ai/tap/multica`. | WOTANN register as supported runtime type |
| **Evolver (EvoMap)** | GPL-3.0→source-available (after Hermes lifted similar design w/o attribution). GEP-powered self-evolution. Node 18+. Audit trail + genes + capsules + prompt governance. `node index.js`. | Study GEP vs GEPA tradeoffs |
| **Warp (warpdotdev)** | Closed-source client. Oz = NEW "orchestration platform for cloud agents — unlimited parallel coding agents programmable auditable steerable." Hosts Claude Code/Codex/Gemini CLI inside Warp. Open-sourcing plans: Rust UI framework first, then client parts. Themes+Workflows+Keysets already open. Weekly releases. | Match: terminal-native + host-foreign-CLIs pattern |
| **Camoufox (daijro → CloverLabsAI)** | Active development MOVED to github.com/CloverLabsAI/camoufox. Alpha releases via `cloverlabs-camoufox` pip. C++-level stealth, BrowserForge profiles, MPL-2.0 inherited from Firefox. Toronto-based Clover Labs sponsors. | Track both repos. Subprocess boundary keeps licensing clean. |
| **WACLI (steipete)** | Go CLI (NOT Swift as prior inference) on whatsmeow. SQLite FTS5 same as WOTANN. `brew install steipete/tap/wacli`. Commands: auth/sync/doctor/messages search/history backfill/media download/send text/send file/groups. | Port FTS5 search patterns for WhatsApp channel |
| **Omi (BasedHardware)** | 300K+ users MIT. Multi-platform captures screen+conversations transcribes+summarizes+action-items. `git clone && cd omi/desktop && ./run.sh --yolo` 1-line install. Rust backend + Flutter app + omiGlass wearable. | Match: single-command "no env no credentials no backend" dev experience |
| **Clicky (farzaa)** | Viral tweet AI teacher buddy. macOS 14.2+ ScreenCaptureKit. **Cloudflare Worker proxy holds API keys** — app never ships keys. Anthropic + AssemblyAI STT + ElevenLabs TTS. | Port: Cloudflare Worker proxy pattern for free-tier distribution |
| **DeepTutor (HKUDS)** | v1.1.2 shipped TODAY. 10K stars in 39 days. Agent-native architecture rewrite (~200k lines). Python 3.11+ + Next.js 16 + React 19. TutorBot, Co-Writer, Guided Learning. Native OpenAI/Anthropic SDK (dropped litellm). Glass theme + Snow theme. Multi-LLM (Qwen/vLLM/LM Studio/llama.cpp/o4-mini). | Watch for v1.2 features; learn from their architecture pivot |
| **Oh-My-OpenCode (code-yeongyu)** | SUL-1.0 license. Multi-model philosophy: "Claude/Kimi/GLM orchestration, GPT reasoning, Minimax speed, Gemini creativity". "Anthropic BLOCKED OpenCode because of us." Jobdori AI assistant built on OpenClaw fork. | Adopt multi-model orchestration philosophy explicitly |
| **Open-SWE (langchain-ai)** | MIT built on LangGraph + Deep Agents. Stripe/Ramp/Coinbase pattern. `create_deep_agent(model, system_prompt, tools=[http_request,...], backend=sandbox_backend, middleware=[ToolErrorMiddleware, check_message_queue_before_model])`. Cloud sandboxes + Slack/Linear invocation + automatic PR. | Port: deep agent composition pattern + Slack/Linear invocation |
| **wshobson/agents** | Opus 4.7+Sonnet 4.6+Haiku 4.5 three-tier. 184 agents + 16 workflow orchestrators + 150 skills + 98 commands + 78 plugins. Average 3.6 components/plugin. `/plugin marketplace add wshobson/agents`. | Huge skill library to mine |
| **GenericAgent (lsdefine)** | 3K LOC total. 9 atomic tools + ~100-line Agent Loop. Self-bootstrap proof ("author never opened a terminal"). <30K context philosophy. Layered memory. Claude/Gemini/Kimi/MiniMax support. | Pressure-test WOTANN's runtime.ts bloat vs GenericAgent's minimalism philosophy |
| **Code-Review-Graph (tirth8205)** | 8.2x avg token reduction across 6 real repos. Tree-sitter + incremental diff + MCP delivery. Auto-detects 9 platforms (Codex/CC/Cursor/Windsurf/Zed/Continue/OpenCode/Antigravity/Kiro). Python 3.10+. | Port tree-sitter code review graph pattern |

## Final Master Plan (V4)

**Phase 0 (1 day)**: **HEAD verification sweep**. grep each claim in this doc against current HEAD. Produce verification-report-v4.md.

**Phase 1 (3-5 days)**: **Fix 11 verified bugs** from the table above. Smallest high-impact fixes first.

**Phase 2 (2 days)**: **Consolidate parallel implementations**. Delete orphan persona.ts loadBootstrapFiles/buildIdentityPrompt. Delete duplicate memory_search_in_domain. Rename turboquant.ts. Merge duplicate channels/adapter.ts + channels/supabase-relay.ts + channels/knowledge-connectors.ts into live paths.

**Phase 3 (3 days)**: **Wire AutoresearchEngine generator** + activate conversation auto-persist → observation-extractor → dream pipeline → instinct system → skill-forge → self-evolution chain. Current state: 12 files in src/learning/ produce ZERO output. Wire conversation end hook in runtime.close() to persist.

**Phase 4 (20 days)**: **Benchmark harness** (per V3 Tier 1). Add better-harness pattern (deepagents 0.5). Self-authored WOTANNBench leaderboard category.

**Phase 5 (15 days)**: **Codex/Goose parity** — ACP host compliance (~600 TS LOC per session-10 Wave-5 estimate), thread/fork, thread/rollback, wotann mcp-server mode, unified_exec PTY, shell_snapshot, request_rule smart approvals, 6 sandbox backends (add Daytona + Modal + Singularity beyond current Docker).

**Phase 6 (15 days)**: **Memory 98.6% Supermemory parity** — Supermemory dual-layer timestamps + 3 rel types + MemPalace wing/room/hall hierarchy + Cognee 14 search types + tree-sitter AST chunking + sqlite-vec virtual tables + contextual embeddings (+30-50% recall per Anthropic).

**Phase 7 (20 days)**: **DSPy+GEPA self-evolution** (ICLR 2026 Oral, MIT, no GPU, ~$2-10/run). 4-tier optimization: skills → tool descs → prompt sections → code. Wire to existing skill-forge + observation-extractor + benchmark harness.

**Phase 8 (15 days)**: **Context-Mode PreCompact hook + sandbox tool isolation + think-in-code** (the HN #1 approach — 98% context reduction). Enforce "LLM writes code that produces result, not LLM processes data".

**Phase 9 (3 days)**: **Archon workflow YAML runner** (.wotann/workflows/*.yaml). Seed: build-feature.yaml, fix-bug.yaml, review-pr.yaml.

**Phase 10 (30 days)**: **UI/UX per UI_DESIGN_SPEC_2026-04-16** (5 themes + 7 signature interactions + 3 layouts + 10 micro-interactions + 5 onboarding + sound + mobile) + sidebar redesign structural decisions. Visual refinement pass per Gabriel's "premium macOS-native app, not mockup copy" direction.

**Phase 11 (25 days parallel)**: **Skills library to ~130** — port top-30 from Superpowers + OpenAI Skills + Karpathy 4 principles + Osmani 7 commands + OpenClaw 560+ catalog scan (pick 20) + wshobson 184-agent scan.

**Phase 12 (10 days)**: **Channel parity 17→24 + Feishu interactive cards + Slack thread auto-respond + Telegram message reactions + OpenRouter variant tag preservation** (Hermes patterns).

**Phase 13 (15 days)**: **FUSE security moat** — Linux FUSE + macOS APFS snapshots + Windows ProjFS + seccomp BPF filter.

**Phase 14 (1 day)**: **Remove dead code — AFTER EXHAUSTIVE verification**. Not a single module deleted without direct grep confirming zero production callers (not just lib.ts re-export). Per Gabriel: "before you plan to delete anything, ensure that it wouldn't help in any way before removing it." Modules to consider: completion-oracle, pr-artifacts, perception-adapter, self-crystallization, route-policies, auto-detect, terminal-mention, visual-diff-theater, required-reading, autoresearch (wire don't delete), getMeetingStore callback (wire), meet trilogy (wire as post-meeting layer). REFERENCE: DEAD_CODE_REPURPOSING_2026-04-18.md — Zero modules warrant deletion. ALL WIRE.

**Phase 15 (5 days)**: **Ship v0.4.0 MVP** — Download page matching jean.build. Homebrew tap + NPM global + curl|sh installer + macOS DMG + Windows EXE/MSI + Linux AppImage/DEB/RPM x64+ARM. wotann.com marketing page.

## Total V4 Effort

- Serial: **178-195 days**
- 3 parallel streams: **~65-75 calendar days**
- Critical path (Phase 0→1→4→7): **1+5+20+20 = 46 days — FITS race window with 44 days buffer before June 30 2026 Anthropic Claude Apps GA**

## What Makes This Plan Different From V3

1. **Ground-truth verified** — direct runtime.ts read corrects 5 major false findings
2. **Realistic bug list** — 11 confirmed bugs not 137 speculative
3. **Phase 3 added** (learning stack resurrection) — needed because conversations don't auto-persist, making Dream/Instinct/Skill-Forge/Self-Evolution all inert
4. **"Zero deletions" mandate** from Gabriel enshrined in Phase 14
5. **Competitive positioning table** with exact version numbers + install commands for every major competitor as of 2026-04-18
6. **Learning from my mistakes** — I over-relied on agents who stalled/hit sandbox denials/inferred from training. V4 is what direct source reads reveal.

## Memory Anchors (44 Engram topic keys)

All prior waves' topic keys + added in Wave 3: `wotann/wave3-ground-truth`, `wotann/wave3-repos-batch1-5`, `wotann/deep-audit-full`, `wotann/repo-research-updates`, `wotann/depth-sidebar-redesign`, `wotann/bootstrap-correction`, `wotann/prior-audit-corrections`, `wotann/execution-plan-v4`.
