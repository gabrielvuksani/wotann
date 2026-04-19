# NEXUS V4 Spec Synthesis — WOTANN Implementation Cross-Reference (2026-04-18)

**Source:** `NEXUS_V4_SPEC.md` (7927 lines, 333KB, 223 claimed features, 26 appendices A-Z)
**Target:** WOTANN v0.1.0 codebase (148,446 LOC TS, 120+ Swift, 97+ desktop TSX)
**Methodology:** Full chunked read of the spec, cross-referenced against `MASTER_AUDIT_2026-04-18.md` (which claims 85% implemented / 12% partial / 3% missing).

---

## 1. Table of Contents (Complete Structure)

### PART I — ARCHITECTURE & FOUNDATIONS
1. Vision & Positioning
2. Unified Feature Matrix (223 features)
3. System Architecture
4. Core Design Principles (15)

### PART II — PROVIDER LAYER
5. Multi-Provider Engine (9 paths)
6. Intelligent Model Router (5-tier)
7. Authentication — Subscription + API

### PART III — AGENT CORE
8. Core Agent Loop
9. Middleware Pipeline (16 layers)
10. Permission & Autonomy System

### PART IV — INTELLIGENCE LAYER
11. Harness Intelligence — 7 Native Overrides
12. Self-Healing Execution
13. Intent Analysis & Behavioral Modes

### PART V — MEMORY & CONTEXT
14. 8-Layer Unified Memory Architecture
15. Context Window Management (5 strategies)
16. autoDream — Memory Consolidation
17. Decision Log — Capturing the WHY

### PART VI — ORCHESTRATION
18. Coordinator Mode — Multi-Agent
19. Wave-Based Parallel Execution
20. Plan-Work-Review Cycle
21. ULTRAPLAN — Cloud Planning
22. Ralph Mode — Persistent Execution

### PART VII — TOOLS & CAPABILITIES
23. Full Computer Control (4-layer hybrid)
24. Skill System (65+ built-in)
25. Hook & Guardrail Engine (19 events)
26. LSP Integration — Symbol-Level Operations

### PART VIII — PLATFORM
27. KAIROS — Always-On Daemon
28. Multi-Channel Messaging (24 channels)
29. Terminal UI, Voice, Desktop

### PART IX — PRODUCTION
30. Implementation Phases (28 weeks)
31. Sandbox & Security
32. Observability & Telemetry
33. Skill Marketplace & Agent Installer
34. Configuration & CLI
35. Directory Structure

### APPENDICES (A–Z)
- **A** — Claude Code Leaked Feature Flags (44 → 88 after Appendix Q)
- **B** — Gap Analysis: What V3 Was Missing (26 gaps)
- **C** — Open Source References (82+ projects)
- **D** — Production-Validated Patterns — Made Native
- **E** — Deep Research Agent Findings (13 features: TTSR, symbol tools, OpenAI shim, FUSE-overlay, AST-aware, model roles, 54 CC flags, smart commit, free endpoints, plugin format, cache split, @file)
- **F** — Multi-Account Provider System
- **G** — Ollama as Full-Capability Tier (Qwen3-Coder-Next, MiniMax M2.7, Nemotron Cascade 2, Qwen 3.5 vision)
- **H** — Comprehensive Per-Repo Feature Adoption (11 forks)
- **I** — Memory Architecture — Maximum Upgrade (Proactive, TEENM, Tengu Scratchpad, Versioning, Fisher-Rao, Bi-Temporal → 8-layer)
- **J** — Additional Features From Research (oh-my-pi remaining, Claw-Code SSE, Repo Monitor)
- **K** — QMD — Precision Context Retrieval Engine (Tobi Lutke)
- **L** — TurboQuant — KV Cache Compression (PolarQuant + QJL)
- **M** — Provider-Agnostic Capability Layer
- **N** — Complete Source Audit — Every Repo Accounted For
- **O** — Missing Features — Integrated (16 gap fills including prompts.chat MCP, last30days, claude-hud, LobeHub)
- **P** — LobeHub Integration (Supervisor-Executor, Conversation Tree, Gatekeeper Memory, Lazy Tools, Device Gateway, HITL Forms, Context Flattening)
- **Q** — Final Research Round — 10 New Sources (Graph DSL, 88 CC flags complete, 4-agent swarm, workflow architect, quality gates, skill audit, Bedrock/Vertex/Foundry providers, diminishing returns, open-agent-sdk patterns)
- **R** — Audit Remediation — 37 Features Upgraded to Implementation Code
- **S** — Competitive Intelligence — 36 Competitors Analyzed
- **T** — Autonomous Monitoring System (3-tier: local git / GitHub API / KAIROS native)
- **U** — Final Gap Fixes — Verification Agent Findings (MCP Server Registry, PM/SaaS integrations, Skill Import, Desktop Task API Routes)
- **V** — Benchmark Engineering — How To Be #1 on TerminalBench (ForgeCode 7 techniques)
- **W** — Onboarding Flow (`nexus init` wizard)
- **X** — Capability Augmentation Model (8-file bootstrap, imageModel delegation)
- **Y** — ForgeCode Benchmark Engineering — Implementation-Level Detail (DoomLoopDetector, retry annotation, pre-completion checklist, marker polling, compaction pipeline)
- **Z** — OpenClaude Deep-Dive Integration (Source #82: Codex provider, health scoring, goal profiles, runtime hardening, consolidation lock, security anti-patterns, format translation)

Plus **FINAL PARITY ADDITIONS** (mid-session model switching, cross-session agent tools, intent-driven mode detection) and an **AUTHORITATIVE FEATURE COUNT** that tallies all 223 features.

---

## 2. The 223 Features — Grouped Inventory With Behavior

### §2 Core Feature Matrix (1–74)

| # | Feature | Behavior |
|---|---------|----------|
| 1 | 1M context window | Via Anthropic API / Claude Agent SDK |
| 2 | Multi-provider (Claude+GPT+Copilot+Ollama+free) | Unified query across 9 providers |
| 3 | Always-on daemon | KAIROS background process with heartbeat |
| 4 | Heartbeat + cron scheduling | Time-based proactive triggers |
| 5 | Full computer control (3→4-layer hybrid) | API/CLI → A11y tree → Vision-native → Text-mediated |
| 6 | 24-channel messaging | Telegram/Slack/Discord/WhatsApp/iMessage/etc. |
| 7 | Kernel-level sandbox | Landlock (Linux) / Seatbelt (macOS) |
| 8 | Coordinator Mode (multi-agent) | 4-phase: research→spec→implement→verify |
| 9 | autoDream memory consolidation | Three-gate (24h + 5 sessions + no lock) trigger |
| 10 | ULTRAPLAN cloud planning | 30-min Opus budget for complex planning |
| 11 | Self-editing memory (Letta blocks) | memory_replace / memory_insert / memory_rethink |
| 12 | Modular system prompt engine | Fragment assembly per session |
| 13 | Progressive skill loading (65+) | ~10 tokens metadata, ~500-2K on demand |
| 14 | LSP symbol-level operations | Rename, find references, hover |
| 15 | Git worktree isolation | Per-subagent branch |
| 16 | Token cost tracking + budgets | Per-request/session/day |
| 17 | Session resume + persistence | Restore prior state |
| 18 | Plan-Work-Review cycle | 6-phase PWR workflow |
| 19 | Learning & instinct layer | Confidence-weighted habits |
| 20 | Soul/identity personality system | SOUL.md + IDENTITY.md |
| 21 | Voice input/output | Whisper/Deepgram STT + ElevenLabs/Piper TTS |
| 22 | Phone companion (Dispatch) | QR-code pairing + WebSocket relay |
| 23 | Prompt evaluation/testing | promptfoo-style eval |
| 24 | Agent Protocol standard | AutoGPT API spec |
| 25 | Anti-distillation defenses | Fake tool injection + Unicode watermark |
| 26 | Frustration detection (21 patterns) | UserPromptSubmit regex scan, 5ms |
| 27 | 16-layer middleware pipeline | Ordered composable layers |
| 28 | Non-interactive mode | `nexus run --exit` for CI/batch |
| 29 | File-tracking service | Record touched files per session |
| 30 | Team Memory Sync | Shared memory files, last-write-wins |
| 31 | 3-tier autonomy (LOW/MED/HIGH) | Risk classification |
| 32 | Prompt cache optimization | 14 cache-break vectors tracked |
| 33 | Forced verification loop | Auto type-check + lint + tests after writes |
| 34 | Dead code cleanup (Step 0) | Pre-refactor elimination on files >300 LOC |
| 35 | Mandatory sub-agent swarming | Decompose >5 files into 5-8/agent |
| 36 | File read chunking | Auto-split at 500 lines |
| 37 | Truncation detection | Re-run on suspiciously small results |
| 38 | AST-level search for renames | 6 parallel grep + LSP |
| 39 | Hash-anchored editing | xxhash32 line identifiers |
| 40 | Self-healing agent loops | Checkpoint + retry + model degradation |
| 41 | Shadow git checkpoints | Separate git repo for snapshots |
| 42 | WASM bypass (Tier 0) | JSON/CSV/base64/hash — never hits LLM |
| 43 | Wave-based parallel execution | Dependency-grouped waves |
| 44 | Ralph Mode (persistent execution) | Loops until done, MAX_CYCLES=10 |
| 45 | Intent analysis gate | Route by intent, not prompt text |
| 46 | Category-based model routing | Agents ask for category, not model |
| 47 | Correction capture + auto-learning | Detect "no, not that" patterns |
| 48 | Pre-compaction WAL flush | Save state before compaction |
| 49 | Conditional rule loading | Rules scoped by file glob patterns |
| 50 | Decision log (captures WHY) | Rationale + alternatives + constraints |
| 51 | Auditability trail | Queryable append-only log |
| 52 | Gotchas.md self-learning | Mistakes recorded as learnable rules |
| 53 | Plugin/Skill eval framework | Static + LLM judge + Monte Carlo |
| 54 | Autoresearch optimization loop | Metric-driven iteration |
| 55 | Inline self-review (30s) | Default checklist, subagent only if complex |
| 56 | /common-ground assumption surfacing | List assumptions before acting |
| 57 | Hook-as-guarantee pattern | Deterministic vs suggested |
| 58 | Phased web scraping | 6-phase pipeline |
| 59 | Behavioral mode switching | careful / rapid / research / creative / debug / review |
| 60 | Persona system | Pre-configured agent identities via YAML |
| 61 | Discussion phase (pre-planning) | Capture preferences before plan |
| 62 | UAT verification flow | Automated user acceptance + debug spawn |
| 63 | Assumptions mode | Surface beliefs, not questions |
| 64 | Auto-detect next step | `nexus next` infers phase |
| 65 | Virtual path sandbox | `/mnt/user-data/...` abstraction |
| 66 | Node architecture | Device capabilities via `node.invoke` |
| 67 | Live Canvas (A2UI) | Visual workspace pushed to clients |
| 68 | App connectivity (500+) | Composio integrations |
| 69 | Agent marketplace + self-install | Browse/install via VoltAgent |
| 70 | Rate limit auto-resume | Fallback or countdown |
| 71 | Hook runtime profiles | minimal / standard / strict |
| 72 | 5-layer loop prevention | Warn at 3, block at 5 identical calls |
| 73 | Observability (OpenTelemetry) | Traces, logs, metrics |
| 74 | Selective install architecture | `--minimal` / `--standard` / `--full` / `--features` |

### Appendix E — Deep Research Agent Findings (75–87)

75. **TTSR — Time-Traveling Streamed Rules** — Regex-triggered injections into model output streams (one-shot per session)
76. **Symbol-Level Code Manipulation** (Serena) — `find_symbol`, `find_referencing_symbols`, `replace_body` by name path
77. **OpenAI-Compatible API Shim** — 724-line adapter unlocks OpenRouter/Together/Fireworks/Groq
78. **FUSE-Overlay Filesystem Isolation** — Copy-on-write per-agent views (faster than git worktrees)
79. **AST-Aware Search and Edit** — Syntax patterns, not text patterns
80. **Model Roles for Routing** — default/smol/slow/vision/plan/commit/terminal
81. **54+ Claude Code feature flags** (AWAY_SUMMARY, HISTORY_PICKER, AGENT_TRIGGERS, BASH_CLASSIFIER, LODESTONE, MESSAGE_ACTIONS, SHOT_STATS, ULTRATHINK, TEENM, BRIDGE_MODE)
82. **AI-Powered Commit Splitting** — Classify hunks and commit atomically
83. **Free Endpoint Routing Chain** — Ollama → Cerebras → Groq → Google AI Studio → OpenRouter → Cloudflare → Ollama
84. **Anthropic Plugin Format Compatibility** — `.claude-plugin/plugin.json`, SHA-pinned deps
85. **Cached/Uncached Prompt Section Split** — `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
86. **@file inline injection** — Auto-inject file contents by typing `@path`
87. **Vision-native vs text-mediated CU** — Any text model can control the computer

### Appendix F — Multi-Account Provider System (88)

88. **N accounts per provider** — Priority-based pool with rate-limit rotation, unified quota tracking

### Appendix G — Ollama Full-Capability Tier (89–91)

89. **Qwen3-Coder-Next as default** — 80B MoE (3B active), 256K context, trained on 800K agent tasks
90. **MiniMax M2.7** — 97% skill adherence across 40+ skills (best open-source tool calling)
91. **Local vision via Qwen 3.5** — Screenshot analysis without API calls

### Appendix H — Per-Repo Feature Adoption (92–113)

Adopted from:
- **claw-code**: SSE server, port manifest
- **claude-code-rev**: native image processor
- **claude-code-haha**: `ANTHROPIC_BASE_URL`, TUI readline fallback, pipe input
- **free-code**: 15 feature flags (HOOK_PROMPTS, KAIROS_CHANNELS, QUICK_SEARCH, AGENT_MEMORY_SNAPSHOT, etc.)
- **claude-code-best**: Azure Foundry, micro-compact tier, color-diff-napi, computer-use-swift, RemoteTrigger, Monitor, Sleep, workflow scripts
- **oh-my-codex**: `$keyword` role triggers, `$ralph`, `.omx/` state, sparkshell, tmux backend
- **claurst**: `DANGEROUS_uncachedSystemPromptSection`, AsyncLocalStorage swarm, Tengu scratchpad, Buddy tamagotchi (optional)

### Appendix I — Memory Architecture Upgrade (114–118)

114. **Proactive Context Anticipation** (memU) — predict next-needed context
115. **TEENM watched team memory** — filesystem pub/sub for agent coordination
116. **Tengu scratchpad** — ephemeral inter-agent coordination
117. **Memory versioning + snapshots** — rollback, export/import
118. **Fisher-Rao distance + bi-temporal facts** — 4-channel RRF search, valid_from/valid_until/recorded_at

### Appendix J — Additional Features (119–128)

119–128: SSE server, IPython REPL, multi-provider web search (Exa/Brave/Jina/Kimi/Perplexity), Puppeteer stealth, SSH tool, universal config discovery, sampling controls, SQLite prompt history, background mode, 65+ themes, hot-loadable plugins, reference repo monitor (native).

### Appendix K — QMD (129)

129. **QMD precision retrieval** — 3-stage BM25 + vector + LLM rerank, ~90% fewer input tokens.

### Appendix L — TurboQuant (130)

130. **TurboQuant KV cache compression** — 3-bit cache via PolarQuant + QJL, 5x context extension.

### Appendix M — Provider-Agnostic Capability Layer (131–133)

131. **CapabilityLayer** — QMD, TTSR, WASM, middleware, skills, hooks, verifier, memory, audit ALL run regardless of provider
132. **Auto-adaptation** — tool format, vision fallback, system prompt prepend, context truncation
133. **Provider capability detection** — each provider declares streaming/tools/vision/thinking/CU/caching/KV compression/batching

### Appendix O — Final Audit Gap Fills (134–149)

134. Prompt library as MCP service (prompts.chat, 143K stars)
135. Multi-platform research engine (reddit/HN/X/YouTube/TikTok/Instagram/Bluesky/Polymarket/Truth Social + convergence detection)
136. Context health HUD (claude-hud) with configurable presets (full/essential/minimal)
137. Foundation context pattern — base skill all domain skills consult
138. Harness paradigm T+K+O+A+P (Tools + Knowledge + Observation + Action + Permissions)
139. Session recovery after /clear — detect plan files older than session
140. Privacy `<private>` tags — redacted before memory store
141. Session analytics + mobile monitor via Cloudflare Tunnel
142. Strict TDD — DELETE pre-test implementation code (hook-enforced)
143. Cisco AI Defense skill security scanner
144. 4 orchestration patterns (solo-sprint, pipeline, consensus, debate)
145. CI/CD prompt regression testing
146. Memory web viewer + Endless Mode
147. Provider presets + hot-switching (50+ presets, Ctrl+M)
148. Repomix — full repository packing (different from QMD retrieval)
149. Configurable thinking depth (minimal/standard/deep/ultrathink)

### Appendix P — LobeHub (150–156)

150. Supervisor-Executor group orchestration (LLM-driven state machine)
151. Conversation tree with branching (branch/compare/compress/council)
152. Layered memory extraction with gatekeeper (5-layer: identity/preference/experience/context/activity)
153. Lazy tool activation (names-only in prompt, schema on activation)
154. Device gateway (cloud↔local WebSocket bridge)
155. Human-in-the-loop forms (structured select/text/confirm widgets)
156. Multi-agent context flattening (coherent history for next LLM call)

### Appendix Q — Final Research Round (157–168)

157. **Graph DSL for pipelines** (AgentFlow) — `A >> B`, `fanout(N)`, `merge`, `onFailure` back-edges, declarative success criteria
158. Complete 88-flag feature taxonomy (40 NEW flags: EXTRACT_MEMORIES, CACHED_MICROCOMPACT, PROMPT_CACHE_BREAK_DETECTION, BASH_CLASSIFIER+TREE_SITTER_BASH, VERIFICATION_AGENT, TEAMMEM, CONNECTOR_TEXT, CHICAGO_MCP, BG_SESSIONS, FORK_SUBAGENT, HISTORY_SNIP, REACTIVE_COMPACT, etc.)
159. 4-agent bug-hunt swarm (reproduction/code-path/regression/environment)
160. 4-agent review swarm (intent/security/performance/contract)
161. Workflow architect agent (exhaustive path mapping before code)
162. Quality gate pipeline (Discover→Strategize→Scaffold→Build→Harden→Launch→Operate with evidence)
163. Project skill audit — recommend skills by analyzing past sessions
164. Bedrock provider (USE_BEDROCK=1 + AWS)
165. Vertex provider (USE_VERTEX=1 + gcloud ADC)
166. Diminishing returns threshold — stop when <500 tokens for 3 turns
167. Zod tool definitions + USD spending cap + graduated effort levels + canUseTool callback
168. 8 total provider paths (Anthropic/OpenAI/Copilot/Ollama/Free/Azure/Bedrock/Vertex)

### Appendix R — Audit Remediation (169–187)

169. File-based planning (3-file pattern: task_plan.md + findings.md + progress.md)
170. Session recovery after /clear (auto-catchup on session start)
171. RED-GREEN-REFACTOR enforcement (hook-level, mapToTestFile)
172. Specialized agent roster (14 agents: planner/architect/critic/reviewer/executor/test-engineer/debugger/security-reviewer/analyst/simplifier/verifier/build-resolver/computer-use/workflow-architect)
173. Context health HUD (full implementation)
174. Two-stage review (spec compliance + quality)
175. Research-before-coding gate (Context7 + GitHub search)
176. UAT verification flow (generate acceptance tests, run, spawn debug)
177. Tool permission scoping per agent
178. PRD-to-task-tree decomposition
179. AgentShield security scanning (102 rules)
180. Message queue injection (mid-run communication)
181. Resumable streams (auto-resume on disconnect)
182. Universal config discovery (Claude/Cursor/Windsurf/Codex/Aider/Cline/Copilot/Gemini)
183. Screenshot diff optimization
184. Foundation context injection (base skill for all domains)
185. Tiered tool loading (core 7 / standard 15 / all dynamic)
186. Privacy sanitization for memory
187. Multi-source research engine

### Appendix S — Competitive Intelligence (188–189)

188. Mid-session model switching (Crush parity)
189. Cross-session agent tools (sessions_list/history/send/spawn)

### Appendix T — Autonomous Monitoring (190)

190. 3-tier monitoring (local git repos, GitHub API, KAIROS-native) across 60+ sources

### Appendix U — Final Gap Fixes (191–194)

191. **MCP Server Registry** — config-driven, hot-add, import from Claude Code/Cursor
192. PM/SaaS integrations via Composio MCP (Linear/Jira/GitHub/Notion/Stripe/Supabase/Calendar)
193. Skill import & migration (Claude-Code/Cursor/Windsurf/Codex/agents/Crush + frontmatter translation)
194. Desktop task API route table (50+ routes: calendar/email/files/browser/music/messages/system/apps/PM/database/design)

### Appendix V — Benchmark Engineering (195–201)

195. Non-interactive mode (prohibit conversational branching)
196. Tool-call correction layer (validate args, suggest better tool)
197. Semantic entry-point discovery (key terms → files before exploration)
198. Mandatory planning enforcement (force todo_write when multi-step)
199. Progressive reasoning budget (xhigh→low→xhigh "reasoning sandwich")
200. Environment bootstrap (parallel directory tree + package.json + git status + languages + tools + env vars on startup)
201. Automated trace analysis (failure clustering → harness improvements)

### Appendix W — Onboarding (202)

202. First-run wizard with auto-detect providers, workspace template generation, BOOTSTRAP.md one-time instructions, universal config import, `--free` / `--advanced` / `--minimal` / `--reset` flags

### Appendix X — Capability Augmentation (203–205)

203. Capability augmenter — harness provides equivalent when provider lacks native
204. 8-file bootstrap (AGENTS.md / TOOLS.md / SOUL.md / IDENTITY.md / USER.md / HEARTBEAT.md / BOOTSTRAP.md / MEMORY.md) with 20K char per-file cap
205. imageModel delegation — text-only primary routes images through vision sidecar

### Appendix Y — ForgeCode Implementation Detail (206–211)

206. DoomLoopDetector (consecutive + repeating-sequence, N=3 threshold, inject reminder not force-stop)
207. Tool error retry annotation (`<retry remaining="N">`, max 3)
208. Pre-completion checklist (first task_complete call rejected with checklist)
209. Marker-based command polling (echo unique marker, poll every 100ms)
210. Forge compaction pipeline (drop system + dedupe + last-per-file + strip cwd prefix)
211. Optimal AGENTS.md structure (tooling only, <60 lines, no architecture overview)

### Appendix Z — OpenClaude Deep-Dive (212–219)

212. Codex backend (`/responses` endpoint, `codexplan`/`codexspark` aliases, auth from `~/.codex/auth.json`)
213. Real-time provider health scoring (EMA alpha=0.3, error rate threshold 70%, 60s recheck)
214. Goal-based model recommendation (latency/cost/balanced/coding scoring)
215. Runtime hardening 5-level (smoke/doctor/strict/json/report)
216. Provider launch profiles (`.nexus-profile.json` with goal presets)
217. Consolidation lock for autoDream (`.nexus/consolidation.lock`, 30-min stale detection)
218. Security anti-patterns (sanitize env for subagents, memoryScan limits, no env-gate permissions)
219. Detailed format translation patterns (system prompt, tool_use↔tool_calls, tool_result↔tool, thinking wrap, vision b64↔data URI)

### Final Parity Additions (220–223)

220. Mid-session model switching (Ctrl+M, preserve + translate context)
221. Cross-session agent tools (sessions_list/history/send/spawn)
222. Intent-driven mode detection (always active, no flag needed)
223. PWR bidirectional mode transitions (intent-keyword routing: plan/implement/review/ship/discuss keywords → phase)

---

## 3. MUST / SHALL Requirements Extracted

The spec uses "MUST" and "SHALL" to mark non-negotiable behavior. Notable occurrences:

- **§22 Ralph Mode**: Loops verify-fix cycles until done or MAX_CYCLES=10.
- **§11 Override 1 Forced Verification**: After ANY file write, auto-run type-check + lint + relevant tests.
- **§11 Override 4 Sub-Agent Swarming**: When >5 independent files touched, FORCE decomposition into 5–8 files per sub-agent.
- **§11 Override 5 File Read Chunking**: Large files auto-chunked into 500-line segments.
- **§14 Skeptical Memory**: Stored observations are hints; ALWAYS verify against actual state.
- **§20 PWR Permission Levels**: Back-transitions always create a shadow git checkpoint first.
- **§20 Planning Stickiness**: Verify implementation matches plan at every checkpoint.
- **§23 Safety**: Block financial sites, keychain access, system settings; always require explicit permission for credentials/purchases/messages.
- **§28 DM Pairing Security**: Unknown senders MUST receive a pairing code before processing.
- **§31 Default Sandbox**: reads everywhere, writes in project dir only; Bash limited to allow list; network outbound HTTPS only.
- **§31 Anti-Distillation**: Fake tool injection in API requests + response watermarking with Unicode zero-width characters.
- **§Q.3 4-Agent Swarm Rules**: Agents MUST NOT edit any files (read-only investigation).
- **§O.9 Strict TDD**: If implementation is written BEFORE tests → harness DELETES it.
- **§Appendix D Hook-as-Guarantee**: "Always run tests" is a PostToolUse hook, not a prompt; "Verify before done" is a Stop hook that BLOCKS without evidence.
- **§Appendix Y Pre-Completion Checklist**: First `task_complete` call is REJECTED; must be called twice.
- **§14 Memory Taxonomy**: MEMORY.md ≤200 lines; 45 total entries across user/feedback/project/reference.
- **§WAL Protocol**: Before any destructive context operation (compaction, /clear, session end), write critical state to durable storage FIRST.
- **§Y Optimal AGENTS.md**: Keep to tooling requirements ONLY; do NOT include architecture overviews or navigation guidance; <60 lines.
- **§23 CU Rate Limit**: Max 60 actions/minute; redact password fields and financial data from screenshots.
- **§20 Plan→Execute**: In `default` permission mode, MUST prompt the user with plan summary before executing.
- **§31 23 Bash Security Checks**: 18 blocked Zsh builtins, zero-width space injection detection, IFS null-byte prevention.

---

## 4. Appendix Summaries (1-Sentence Each)

- **A** — 44 Claude Code feature flags mapped to NEXUS sections (KAIROS, ULTRAPLAN, COORDINATOR_MODE, DREAM_MODE, ANTI_DISTILLATION_CC, etc.).
- **B** — 26 identified V3→V4 gaps including node architecture, Live Canvas, behavioral modes, GSD UAT flow, virtual paths, Composio connectivity, agent marketplace.
- **C** — 82+ open-source references including 10 core harnesses, 15+ Claude Code ecosystem tools, 10 agent frameworks, 4 browser/CU tools, 10+ analysis sources, forks analyzed.
- **D** — Production patterns from user's Claude Code setup (21 hooks, 10 rules, 12 agents) made native.
- **E** — 13 deep research agent findings dominated by TTSR (novel streaming-rule interception) and symbol-level code manipulation.
- **F** — N accounts per provider with priority-based pool, load balancing, rate-limit-aware rotation, unified quota tracking.
- **G** — Ollama promoted from Tier 0-1 to full coding partner via Qwen3-Coder-Next, MiniMax M2.7, Qwen 3.5 vision, Nemotron Cascade 2.
- **H** — 22 per-repo features adopted including free-code's 15 unlocked feature flags and claw-code's SSE server.
- **I** — Memory architecture upgraded from 6 to 8 layers adding Team Memory (TEENM) and Proactive Context Anticipation.
- **J** — Remaining oh-my-pi features, claw-code SSE server mode, native reference repo intelligence.
- **K** — QMD 3-stage precision retrieval (BM25 + embedding + Qwen3-Reranker) cutting prompt tokens by ~90%.
- **L** — TurboQuant KV cache compression (PolarQuant + QJL) extending context 5x on same hardware.
- **M** — Provider-agnostic capability layer so QMD/TTSR/skills/memory/hooks/WASM work identically for every provider.
- **N** — Full source audit of every URL with what was extracted and what was missing (12 sources had gaps filled).
- **O** — 16 features integrated from prompts.chat, last30days, LobeHub, agency-agents, learn-claude-code, claude-hud, marketingskills, claude-code-templates, K-Dense-AI, Superpowers, promptfoo, cc-switch, claude-mem, repomix, Thinking-Claude.
- **P** — 7 LobeHub patterns (Supervisor-Executor, conversation tree, gatekeeper memory, lazy tools, device gateway, HITL forms, context flattening).
- **Q** — 12 features from final 10 sources including Graph DSL (AgentFlow), complete 88-flag taxonomy, 4-agent swarm, workflow architect, quality gates.
- **R** — 37 features upgraded from mention-only to implementation code (file-based planning, session recovery, TDD enforcement, agent roster, HUD, two-stage review, research gate, UAT, PRD decomposer, etc.).
- **S** — 36 competitors analyzed with NEXUS's unique combination (multi-provider + daemon + CU + learning + orchestration + sandbox + QMD + 8-layer memory + modular prompts + self-building).
- **T** — Autonomous monitoring architecture across 3 tiers (local git, GitHub API, KAIROS-native) tracking 60+ sources.
- **U** — 4 final gap fixes: MCP Server Registry, PM/SaaS integrations, skill import, desktop task API route table.
- **V** — ForgeCode's 7 benchmark-winning techniques (non-interactive, tool correction, entry points, mandatory planning, reasoning sandwich, env bootstrap, trace analysis).
- **W** — `nexus init` onboarding wizard with auto-detect providers, workspace templates, BOOTSTRAP.md, universal import.
- **X** — Capability augmentation model (every model gets full harness) + 8-file bootstrap + imageModel delegation.
- **Y** — ForgeCode implementation-level detail (DoomLoopDetector, retry annotation, pre-completion checklist, marker polling, compaction pipeline, optimal AGENTS.md).
- **Z** — OpenClaude deep-dive with 8 new features: Codex provider (9th path), real-time health scoring, goal-based recommendation, runtime hardening, launch profiles, consolidation lock, security anti-patterns, format translation.

---

## 5. Architectural Diagrams Referenced

The spec includes several ASCII diagrams:

1. **§3 System Architecture** (lines 229–294) — Top-to-bottom stack from KAIROS Gateway through Channels/CU/Interfaces → Middleware Pipeline (16 layers) → Orchestration Layer → Multi-Provider Engine → Guardrail/Sandbox Engine → Foundation Layer.
2. **§6 5-Tier Routing Hierarchy** (lines 469–476) — Tier 0 WASM / Tier 1 Local / Tier 2 Fast / Tier 3 Deep / Tier 4 ULTRA with latency and cost.
3. **§14 Memory Architecture** (lines 1061–1091) — 6-layer stack from Auto-Capture through Recall (later upgraded to 8-layer in Appendix I.7).
4. **§20 PWR Cycle** (lines 1266–1274) — 6-phase Discuss→Plan→Implement→Review→UAT→Ship.
5. **§23 4-Layer Computer Use** (lines 1558–1564) — API/CLI → A11y → Vision → Text-mediated.
6. **§28 24 Channels** (§28) — Full platform list.
7. **§35 Directory Structure** (lines 2379–2430) — Complete src/ tree and .nexus/ project config.
8. **§30 Self-Building Bootstrap** (lines 2110–2179) — 3-stage Claude-builds-Nexus → co-develop → Nexus-self-improves.
9. **Appendix E.9 Free Endpoint Routing Chain** (lines 2853–2875) — Circular fallback through Ollama → Cerebras → Groq → Google AI Studio → OpenRouter → Cloudflare → Ollama.
10. **Appendix G.4 Ollama Tier Config** and **Appendix L.6 Complete Local Stack** — QMD → Ollama/vLLM → Model Role Routing.
11. **Appendix I.7 8-Layer Memory** — Auto-Capture / Core Blocks / Working / KG / Archival / Recall / Team Memory / Proactive Context.
12. **Appendix M Provider-Agnostic Capability Layer** — User prompt → QMD → Provider-agnostic enrichment → Router → Providers → TTSR → Forced verify → Memory save.
13. **Appendix P.1 Supervisor-Executor Loop** (lines 4925–4965) — LLM-driven state machine with call_agent / parallel_call_agents / delegate / exec_async_task / batch_exec_async_tasks / finish.
14. **Appendix S.3 Competitive Positioning** — Table of 13 threat competitors with what-NEXUS-does-better column.
15. **Appendix W.4 Onboarding Flow** — 7-step wizard with interactive provider choice.
16. **Appendix X.2 Capability Augmenter** (lines 7031–7092) — Native-if-supported / harness-otherwise table.

---

## 6. Cross-Reference: Features NOT Implemented in Current WOTANN

Source of truth: `wotann/docs/MASTER_AUDIT_2026-04-18.md` states 85%/12%/3% split. Below is my cross-read highlighting the spec features that are either **absent, stubbed, partial, or outright broken** in current code.

### Top 20 Unimplemented (Prioritized)

| Rank | Spec § | Feature | Status in WOTANN | Evidence |
|------|--------|---------|------------------|----------|
| 1 | §31 / App. E.4 | **FUSE-Overlay filesystem isolation** | Missing | Audit §8 "FUSE-overlay sandbox missing — zero code references; only process-level docker-backend. Security moat unshipped." |
| 2 | §23 Full CU | **Persistent browser session** (camoufox) | Fake | Audit row 10: "Browser is FAKE — fresh subprocess per call, no persistence" |
| 3 | App. Z.1 / §5 | **Bedrock tool-calling** | Broken | Audit CRIT #1: "Tool calls silently dropped — body omits toolConfig; regex parser ignores toolUse events" |
| 4 | §5 multi-provider | **Vertex messages/tools forwarding** | Broken | Audit CRIT #2-3: "Hardcoded 5-field body drops opts.messages/tools/systemPrompt; stream parser only emits text_delta" |
| 5 | §5 multi-provider | **Azure URL composition** | Broken | Audit CRIT #4: "Query param before path segment — every Azure call 404s" |
| 6 | §5 Ollama full tier | **Ollama tool_calls stopReason** | Broken | Audit HIGH #5: "Missing stopReason: 'tool_calls' — multi-turn agent loops die after 1 call" |
| 7 | §5 Copilot | **Copilot 401 retry + per-session token** | Broken | Audit HIGH #6-7: "No retry on 401; module-global cached token leaks across users" |
| 8 | §26 / Serena | **LSP symbol operations as agent tools** | Partial | Audit Competitive: "Goose exposes `lsp_references/definition/hover/symbols/rename`; WOTANN has LSP module but not wired as agent tools" |
| 9 | §28 | **24-channel messaging (full coverage)** | Partial | Audit: 17 adapters, missing Mastodon, Twitter/X DM, LinkedIn, Instagram, WeChat, Line, Viber |
| 10 | App. K | **QMD precision retrieval** | Unknown/Missing | Not mentioned in MASTER_AUDIT; spec claims 90% token savings — verify integration |
| 11 | App. L | **TurboQuant KV compression (turbo3)** | Blocked upstream | Spec itself notes "pending llama.cpp merge" — `q8_0` is available today but turbo3 is not |
| 12 | §21 | **ULTRAPLAN cloud planning** | Unknown | Not surfaced in audit; spec prescribes Anthropic CCR or Docker fallback |
| 13 | §22 | **Autoresearch optimization loop** (Karpathy) | Unknown | Not surfaced; `benchmark-harness.ts` exists as placeholder per audit Tier 1 |
| 14 | §13 / App. E.1 | **TTSR — Time-Traveling Streamed Rules** | Unknown | Not surfaced in audit; core spec claim is streaming-layer middleware |
| 15 | §31 | **Kernel-level sandbox (Landlock/Seatbelt)** | Missing | Audit Competitive: "OS-level sandbox enforcement — Codex has bwrap/seatbelt/win-sandbox; WOTANN has policy-only" |
| 16 | §29 Tauri | **Liquid Glass / translucency** | Missing | Audit Competitive: "Gemini Mac has it; zero `backdrop-filter` usage in WOTANN CSS" |
| 17 | §29 Block Terminal | **Block-based terminal** | Missing | Audit Competitive: "Warp/soloterm have it; WOTANN ships linear log" |
| 18 | App. Q.2 | **Agent Client Protocol (ACP) host** | Spec-only | Audit Competitive: "Zed/Goose have ACP; WOTANN has the spec but no port" |
| 19 | §29 UI tokens | **Unified design tokens** | Partial | Audit Competitive: "3 separate schemes (CSS/Swift/Ink), no single source" |
| 20 | App. V.6 | **Environment bootstrap** (parallel startup snapshot) | Unknown | Not surfaced; ForgeCode technique critical for TerminalBench |

### Additional gaps to close (Rank 21–50)

- App. R.11d **Universal config discovery** across 8 tools — partial at best
- App. R.11g **Tiered tool loading** (core 7 / standard 15 / all dynamic) — verify binding
- App. Z.3 **Runtime hardening 5-level** (`nexus doctor`/`--strict`/`--json`/`--report`) — unknown
- App. Z.5 **Consolidation lock for autoDream** — unknown
- App. Z.4 **Provider launch profiles** `.nexus-profile.json` — unknown
- App. Y **DoomLoopDetector** sequence-length=2..5 — WOTANN has loop detection but check sequence depth
- App. Y **Pre-Completion Checklist** two-call `task_complete` pattern — unknown
- App. Y **Marker-based command polling** — unknown
- App. P.1 **Supervisor-Executor orchestration** — not listed among orchestration/ files (coordinator/waves/PWR/Ralph/council/arena only)
- App. P.2 **Conversation tree branching** (branch/compare/compress/council) — unknown
- App. P.3 **Gatekeeper memory extraction** — 27 memory files don't surface this pattern
- App. P.4 **Lazy tool activation** — skills progressive disclosure present, but tool schemas may still be upfront
- App. P.5 **Device gateway** cloud↔local WebSocket bridge — `src/desktop/companion-server.ts` is boundary-violating per audit
- App. P.6 **Human-in-the-loop forms** (structured select/text/confirm) — unknown
- App. P.7 **Multi-agent context flattening** — unknown
- App. O.9 **Strict TDD pre-test code deletion** — unknown
- App. O.3 **HUD preset configuration** (full/essential/minimal) — `ContextHealthHUD` present; presets unverified
- App. O.1 **prompts.chat MCP** — unknown if registered
- App. O.7 **Privacy `<private>` tag sanitizer** — unknown
- App. U.3 **Skill import/migration** from Cursor/Windsurf/Codex/Aider/Cline/Copilot/Gemini — unknown
- App. U.4 **Desktop task API route table** (50+ routes) — unknown
- §33 **App connectivity** (Composio 500+ integrations) — unknown
- §33 **Agent marketplace self-install** — unknown
- §20 **Back-transition shadow git checkpoints** — `ShadowGit` exists; verify PWR integration
- §15 **Pre-compaction WAL flush** — `pre-compact-memory-flush` present in reference Claude Code config; verify in WOTANN
- §14 **Skeptical memory verification** — before acting on memory, verify file/function exists
- App. F **N-account priority pool + rotation** — partially present (Appendix notes narrative was sufficient)
- App. R.10 **PRD-to-task-tree decomposition** — unknown
- App. R.9 **Tool permission scoping per agent** — agent roster exists (14 agents per audit); verify allowedTools enforcement
- App. R.7 **Research-before-coding gate** middleware — unknown
- App. R.8 **UAT verification + debug spawn** — unknown
- App. R.3 **RED-GREEN-REFACTOR enforcement** at hook level — unknown
- §23 **Mobile (ADB/xcrun) computer use** — WOTANN has iOS native but mobile CU via ADB unknown
- App. H.3 **ANTHROPIC_BASE_URL gateway override** + TUI readline fallback — unknown
- App. H.6 **$keyword inline role triggers** (`$architect`, `$executor` in prompts) — unknown
- App. H.7 **Flint swarm via AsyncLocalStorage + Tengu scratchpad** — unknown
- App. E.12 **@file inline injection** — unknown
- App. E.11 **Cached/uncached prompt section split** — unknown
- App. I.1 **Proactive Context Anticipation** — memory upgrade per Appendix I missing
- App. I.5 **Fisher-Rao geometric distance** — 4-channel RRF unknown
- App. I.6 **Bi-temporal fact modeling** (validFrom/validUntil/recordedAt) — WOTANN has TemporalMemory; verify schema matches spec

---

## 7. Spec Sections Obsolete / Contradicted by Current Code

- **"11 providers"** (CLAUDE.md, §5) vs actual **19** (ProviderName union includes Anthropic/Anthropic-subscription/OpenAI/Codex/Copilot/Ollama/Gemini/HuggingFace/Free/Azure/Bedrock/Vertex/Mistral/Deepseek/Perplexity/xAI/Together/Fireworks/SambaNova). Audit recommends reconciling doc to reality (but noting the lies about capability: Bedrock/Vertex/Azure claim supportsToolCalling=true while dropping calls).
- **"6-layer memory"** (§14) then **"8-layer"** (App. I.7) — actual code has 27 memory modules with no strict numerical layering. Reorganize the doc, not the code.
- **"65+ skills"** (§24, CLAUDE.md) vs actual **86 markdown skills** — over-delivered.
- **"24 channels"** (§28) vs actual **17 adapters** — under-delivered; need to either build 7 more or cut spec.
- **"Desktop and iOS apps are TypeScript specifications, not compiled native apps"** (Apr-4 memory observation) — STALE. Reality has 120+ Swift files + SwiftUI + Xcode project + Tauri v2 Rust+React+Monaco. Apr-4 observation marked for archive.
- **`WotannEngine`** (CLAUDE.md Directory Structure) does NOT exist as a class. Composition root is `WotannRuntime`. CLAUDE.md lists it wrongly.
- **`src/cli/commands.ts` dispatch** — audit grep returned 0 matches for user-facing verbs. Verbs are defined inline in `src/index.ts` (85 `.command()` registrations). Risk: users may hit "command not found."
- **v0.1.0 vs 0.3.0** — `package.json` says 0.1.0, some docs claim 0.3.0. CHANGELOG says "[0.1.0] 17-provider adapter system" but spec audit finds 19.
- **Monolithic files**: `src/core/runtime.ts` = 4,400 lines / 171 fields; `src/index.ts` = 85 commands inline; `src/middleware/layers.ts` = 14 middlewares crammed. Spec §35 prescribes 200–400 lines per file, 800 max. Deliberately deferred per user directive.
- **Boundary violations**: `src/ui/App.tsx:31` imports `../channels/unified-dispatch.js` (TUI shouldn't know transports); `src/desktop/companion-server.ts:49-67` crosses computer-use + mobile + sandbox; `src/hooks/built-in.ts:10` imports middleware `detectFrustration` (hooks should be leaves); `src/middleware/layers.ts:11` imports `../sandbox/executor.js` (middleware should emit events, not call sandbox).
- **Capability-lying providers**: Bedrock/Vertex/Azure claim `supportsToolCalling: true` while silently dropping tool calls. Spec §5 interface explicitly requires accurate capability detection. **Contradicted by current code.**

---

## 8. Where WOTANN Leads The Spec

- **Semantic memory** — WOTANN has `TemporalMemory`, `EpisodicMemory`, `ObservationExtractor` (27 memory modules). Spec prescribes 6/8 layers; WOTANN's stack is broader.
- **Voice** — WOTANN ships edge-TTS + VibeVoice + faster-whisper. Spec §29 merely names "Whisper/Deepgram + ElevenLabs/Piper."
- **iOS Native** — 120+ Swift files + CarPlay + Watch + Widgets + LiveActivity + AppIntents + Share Extension + 5 pairing transports. Spec does not require any of this.
- **86 skills** exceeds the spec's 65+.
- **Exploit mode / Security Research panel** — unique to WOTANN, not in spec.
- **Council + Arena** (multi-model deliberation) — WOTANN has both; spec describes Council but not Arena as distinct.
- **17 channels** — less than spec's 24 but more than Codex (zero).

---

## 9. Summary

The NEXUS V4 spec is a 7927-line synthesis of 82+ open-source projects, the Claude Code leak (88 flags), 37 competitors, and 11 deep research agents. It enumerates 223 unique features, 9 provider paths, 8 memory layers, 16-layer middleware + TTSR streaming, 24 channels, 65+ skills, 19 hook events, 6 orchestration patterns, and 3-stage self-building bootstrap. The 26 appendices (A-Z) document feature flags, gap analyses, open-source references, production-validated patterns, research findings, multi-account providers, Ollama full tier, per-repo adoptions, memory upgrades, QMD retrieval, TurboQuant compression, provider-agnostic layer, source audit, gap fills, LobeHub patterns, final research, audit remediation, competitive intelligence, autonomous monitoring, MCP registry + PM integrations, benchmark engineering, onboarding, capability augmentation, ForgeCode detail, and OpenClaude integration.

WOTANN is a strong implementation at ~85% coverage, with 148,446 LOC TS + 254 test files + 120+ Swift files + 97+ desktop TSX + 11+ Rust Tauri files. 86 skills exceed the spec. Memory has 27 modules (deeper than any competitor). iOS native surface unmatched. Voice shipping three backends. 17 channels in place.

But five categories of gaps block benchmark-winning reliability: (1) 4 CRITICAL provider bugs silently drop tool calls or 404 every call; (2) browser subsystem is fake (fresh subprocess per call); (3) FUSE-overlay sandbox and kernel-level sandbox enforcement are both missing; (4) UI polish trails competitors (no Liquid Glass, no block terminal, no unified design tokens); (5) LSP-as-agent-tools, ACP host mode, ULTRAPLAN, TTSR, environment bootstrap, supervisor-executor orchestration, and many appendix features are absent or unverified. Documentation lies about provider count (11 claimed vs 19 actual), and three providers (Bedrock/Vertex/Azure) lie about their own capabilities.

The path forward: Tier-0 bugfixes (10 days), Tier-1 benchmark harness (2 weeks) to drive fitness-based self-evolution, Tier-2 Codex sandbox parity, and then the appendix sweep to close TTSR/QMD/supervisor-executor/device gateway/lazy tool activation gaps.

---

## 10. Top 20 Unimplemented Features (For Immediate Action)

1. **FUSE-Overlay filesystem isolation** (§31 / App. E.4) — security moat unshipped
2. **Persistent browser session** (§23) — camoufox backend is fake
3. **Bedrock tool-calling** (App. Z.1) — silently drops every tool call
4. **Vertex messages/tools forwarding** (§5) — body omits messages/tools/systemPrompt
5. **Azure URL composition** (§5) — every call 404s
6. **Ollama `stopReason: "tool_calls"`** (§5) — multi-turn loops die after 1 call
7. **Copilot 401 retry + per-session token** (§5) — no retry, module-global cache leaks
8. **LSP symbol operations as agent tools** (§26) — module exists, not wired
9. **24-channel messaging** (§28) — only 17; need +7 (Mastodon, Twitter/X, LinkedIn, Instagram, WeChat, Line, Viber)
10. **QMD precision retrieval** (App. K) — not verified in WOTANN
11. **Kernel-level sandbox** (§31) — Landlock/Seatbelt/win-sandbox missing
12. **ULTRAPLAN cloud planning** (§21) — not surfaced in audit
13. **TTSR — Time-Traveling Streamed Rules** (App. E.1) — novel streaming middleware, not verified
14. **Liquid Glass UI** (§29) — zero `backdrop-filter` in CSS
15. **Block-based terminal** (§29) — linear log only
16. **Agent Client Protocol (ACP) host** (App. Q) — spec-only, no port
17. **Environment bootstrap** (App. V.6) — parallel startup snapshot for benchmark wins
18. **Supervisor-Executor orchestration** (App. P.1) — more flexible than Coordinator
19. **Unified design tokens** (§29) — 3 separate schemes (CSS/Swift/Ink)
20. **Strict TDD pre-test code deletion** (App. O.9) — hook-enforced TDD unverified

This synthesis was generated 2026-04-18 by full chunked read of NEXUS_V4_SPEC.md cross-referenced against MASTER_AUDIT_2026-04-18.md.
