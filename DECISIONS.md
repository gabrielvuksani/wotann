# WOTANN Architecture Decisions

## D1: TypeScript Strict Mode with No `any`
**Decision:** Use `strict: true` in tsconfig with no `any` types.
**Rationale:** Spec mandates this. Catches type errors at compile time.
**Alternatives:** Loose typing (rejected — too many runtime errors).

## D2: SQLite + FTS5 for Memory
**Decision:** Use better-sqlite3 with FTS5 virtual tables for all memory storage.
**Rationale:** Zero config, local-first, sub-ms search, WAL mode for concurrent reads.
**Alternatives:** Postgres (rejected — requires server), MongoDB (rejected — no FTS5 equivalent).

## D3: OpenAI-Compatible Adapter for 6 Providers
**Decision:** Single `createOpenAICompatAdapter` handles OpenAI, Codex, Copilot, Ollama, Free, Azure.
**Rationale:** All use `/v1/chat/completions` endpoint. Only Anthropic needs its own adapter.
**Alternatives:** Individual adapters per provider (rejected — code duplication).

## D4: Immutable State Updates
**Decision:** All state mutations return new objects (sessions, config, coordinator tasks).
**Rationale:** Spec + user preference for immutable patterns. Prevents hidden side effects.

## D5: Simple Glob Matching Over Full Minimatch
**Decision:** Implement simple glob matching (extension + basename) instead of full minimatch.
**Rationale:** Covers 95% of skill detection patterns with no dependencies. Can upgrade later.

## D6: TTSR as Streaming Middleware
**Decision:** TTSR (Time-Traveling Streamed Rules) runs as a separate engine, not a middleware layer.
**Rationale:** TTSR operates on streaming chunks, not request/response. Different interface than middleware.

## D7: Hook Profiles as Inclusion Hierarchy
**Decision:** `minimal ⊂ standard ⊂ strict` — strict includes all hooks.
**Rationale:** Simpler than arbitrary include/exclude. Most users want "more safety" or "less safety."

## D8: Progressive Disclosure via Metadata Registry
**Decision:** Skills register metadata only (~10 tokens) at startup, full content loads on demand.
**Rationale:** 65+ skills × 1000 tokens = 65K wasted tokens. Progressive disclosure = ~650 tokens.

## D9: React 19 with Ink 6.8
**Decision:** Use latest React 19 + Ink 6.8 for the TUI.
**Rationale:** Ink 6.8 supports React 19. Both are latest stable versions.

## D10: Config Merge as Typed Function
**Decision:** Use a typed `mergeConfig` function instead of generic deep merge.
**Rationale:** Generic deepMerge doesn't work well with TypeScript strict mode interfaces.

## D11: Text-Mediated Computer Use for Non-Vision Models
**Decision:** The harness captures the screen, converts to structured text, and ANY text model can control the computer.
**Rationale:** OpenClaw breakthrough. Decouples CU from vision-capable models. Even a 3B local model can control the computer.
**Alternatives:** Vision-only CU (rejected — locks out 7 of 9 providers).

## D12: PWR Bidirectional Mode Transitions via Intent Detection
**Decision:** Phase transitions are intent-driven (keyword → AI classifier fallback), not manual mode switches.
**Rationale:** Users don't think in phases. "Rethink this" during implementation should seamlessly transition back to planning.
**Alternatives:** Manual mode switching (rejected — poor UX), linear-only pipeline (rejected — doesn't match reality).

## D13: Graph DSL for Custom Orchestration Workflows
**Decision:** chain/fanout/merge/on_failure primitives for defining agent workflows as DAGs.
**Rationale:** Enables complex orchestration patterns beyond the built-in coordinator/wave/ralph modes.

## D14: DoomLoop Detection with 2 Patterns
**Decision:** Detect both consecutive identical calls [A,A,A] and repeating sequences [A,B,C,A,B,C].
**Rationale:** ForgeCode's Rust implementation proved these are the two most common loop patterns. Inject reminder but don't force-stop.

## D15: Anti-Distillation via Fake Tools + Zero-Width Watermarks
**Decision:** Inject 3 fake tool definitions into API requests. Watermark responses with invisible Unicode characters.
**Rationale:** Makes training data extraction unreliable. Fake tools poison distillation; watermarks enable detection.

## D16: MCP Registry with Cross-Tool Import
**Decision:** Import MCP servers from Claude Code, Cursor, Windsurf, and Codex configs automatically.
**Rationale:** Users shouldn't reconfigure MCP servers per-tool. Import from existing setups.

## D17: 20+ Themes with Auto-Detect Dark/Light
**Decision:** Ship 20 themes (Catppuccin, Dracula, Nord, Gruvbox, etc.) with COLORFGBG-based auto-detection.
**Rationale:** Developer tools must respect terminal aesthetics. Auto-detection prevents theme mismatches.

## D18: WASM Bypass Handles 18+ Deterministic Operations
**Decision:** JSON formatting, base64, hashing, counting, sorting — all bypass the LLM entirely.
**Rationale:** 352x faster and $0.00 cost. No reason to send "format this JSON" to an LLM.

## D19: Gap Remediation — Middleware Layers Must Have Real Logic
**Decision:** All 16 middleware layers implement real behavior (thread isolation, @file injection, sandbox checks, guardrail detection, summarization estimation, memory extraction hints, ambiguity scoring, cache tracking, risk classification, LSP detection).
**Rationale:** Pass-through stubs violate the spec's "middleware, not monolith" principle. Every layer must add value.

## D20: Self-Healing Execution with Model Degradation
**Decision:** Implement checkpoint → retry → model degradation pattern. On failure: restore shadow git checkpoint, revise task description with error context, degrade model if over 70% token budget (opus → sonnet → haiku).
**Rationale:** Spec §12 requires self-healing. Hive pattern proves checkpoint+retry+degrade is most effective.

## D21: Append-Only Audit Trail with Content Hashing
**Decision:** SQLite table with SHA-256 content hash per entry. No update/delete methods exposed. Query by date/tool/agent/session/risk.
**Rationale:** Spec §32 requires auditability. Append-only with hashing enables tamper detection.

## D22: Hook Engine Warn Semantics — Continue Execution
**Decision:** `warn` action does NOT block execution. The engine logs the warning and continues processing remaining hooks. Only `block` terminates.
**Rationale:** Warnings are advisory (frustration detection, config protection). Blocks are guarantees (secrets, loops). This matches the hook-as-guarantee pattern: warnings inform, blocks enforce.

## D23: Real Cron Matching for KAIROS
**Decision:** Implement 5-field crontab matching (minute/hour/day/month/weekday) with support for wildcards, steps, ranges, and comma lists. Track lastRun to prevent re-execution within the same minute.
**Rationale:** The daemon must actually execute scheduled jobs. A stub `return false` is not a daemon.

## D24: Full CLI Command Surface from §34
**Decision:** Implement all CLI commands: init, providers, doctor, run, daemon (start/stop/status), memory (search/verify), skills (list/search), cost, mcp (list/import), config.
**Rationale:** Spec §34 defines the full command surface. Users need CLI access to every subsystem.

## D25: NEVER Degrade Model — Provider Fallback Chain Instead
**Decision:** When a provider is rate-limited, cascade through ALL authenticated providers in order. Free tier (Ollama + community APIs) is the ultimate final fallback. The model is NEVER downgraded.
**Rationale:** The user chose a model for a reason. Silently degrading from Opus to Haiku fundamentally changes output quality. Instead, try the same model via another provider (e.g., Claude Sonnet via Copilot when Anthropic is rate-limited). When all paid providers are exhausted, free models are still better than silence. This replaces the Hive-pattern model degradation that was in V4 spec §12.
**Alternatives:** Model degradation (opus→sonnet→haiku) — REJECTED. The user's intent is betrayed when the harness silently gives them a weaker model. Provider fallback preserves quality; free-tier fallback preserves availability.
**Implementation:** `src/providers/fallback-chain.ts` builds ordered chains: preferred → other paid → free. `AgentBridge` walks the full chain on rate-limit. `SelfHealingExecutor` no longer touches model selection.

## D26: ClawHub Skill Research — Adopted Patterns
**Decision:** After researching clawhub.com, adopted applicable patterns into WOTANN skill system.
**Rationale:** Community marketplace reveals real-world skill usage patterns that spec-driven design misses.

## D27: Codex Uses ChatGPT Backend, NOT OpenAI Platform API
**Decision:** Codex adapter calls `https://chatgpt.com/backend-api/codex/responses` with the access_token from `~/.codex/auth.json` and `ChatGPT-Account-Id` header.
**Rationale:** The ChatGPT OAuth token lacks `api.responses.write` scope for `api.openai.com`. It ONLY works against the ChatGPT backend. This is the exact bug OpenClaw had (issue #38706). The request format is the Responses API (input array, instructions field), not chat/completions.
**Token refresh:** Uses refresh_token against `https://auth.openai.com/oauth/token` with client_id `app_EMoamEEZ73f0CkXaXp7hrann`. Auto-refreshes when >8 minutes since last refresh. If refresh_token is expired, user must run `npx @openai/codex --full-auto "hello"` to re-authenticate.

## D28: Anthropic Subscription vs API Key — Two Separate Paths
**Decision:** Support BOTH Anthropic auth paths: (1) `ANTHROPIC_API_KEY` for standard pay-per-token API, (2) Claude subscription OAuth via `claude-agent-sdk` for Pro/Max subscribers. These are separate providers in the fallback chain.
**Rationale:** Most users have a Claude subscription (Pro/Max), not a separate API key. The `claude-agent-sdk` query() function handles subscription auth internally — it spawns a Claude Code subprocess that uses the same OAuth the user is already logged in with.

## D29: Google Gemini as a Dedicated 10th Provider
**Decision:** Gemini is a full provider (not just a free endpoint), using Google AI Studio's OpenAI-compatible API at `generativelanguage.googleapis.com/v1beta/openai/`.
**Rationale:** Gemini 2.5 Flash has 1.5M tokens/day free tier — more generous than most paid APIs. It supports tool calling, vision, 1M context, and streaming. Too capable for the generic "free endpoints" bucket.
**Billing:** Categorized as `"free"` since the AI Studio free tier is sufficient for most use cases. Paid Vertex AI access is handled by the separate `vertex` provider.

## D30: Capability Augmentation — Provider-Agnostic Tool/Vision/Thinking
**Decision:** Implemented `capability-augmenter.ts` that makes tool calling, vision, and extended thinking work across ALL providers via transparent prompt injection. Applied automatically in `AgentBridge` before every query.
**Rationale:** The OpenClaw insight: "A small model given detailed, step-by-step instructions for a specific tool performs significantly better." Without augmentation, only Claude and GPT-5 get tools + vision + thinking. With augmentation, even a 3B Ollama model can use tools (via XML parsing) and "think" (via step-by-step prompts). This is WOTANN's equalizer.
**Implementation:** `augmentQuery()` is called in `AgentBridge.query()` before routing to any adapter. It checks the adapter's `capabilities` and only augments what's missing. Full-capability models pass through unchanged.

## D31: Autonomous Mode Wired to CLI
**Decision:** `wotann autonomous <prompt>` (alias: `wotann auto`) runs the AutonomousExecutor with configurable budget (cycles, time, cost). Uses `execFileSync` for verification (typecheck + tests).
**Rationale:** The #1 user request from competitor analysis: "I want it to just finish the job." Combines Ralph Mode (verify-fix loop) + Self-Healing (provider fallback) + DoomLoop detection. Runs until all tests pass or budget exhausted.

## D32: Interactive Provider Onboarding
**Decision:** `wotann onboard` shows all 10 providers with status + setup instructions for unconfigured ones. Each provider has a specific, copy-pasteable setup guide.
**Rationale:** OpenClaw's `openclaw onboard` was the most-requested feature in our competitive analysis. Users shouldn't have to read docs — the CLI tells them exactly what to type for each provider.

---

## Session 7 Decisions (April 2, 2026)

## D33: Context Window Intelligence as Separate Module
**Decision:** Created `src/context/window-intelligence.ts` as standalone rather than extending compaction.ts.
**Rationale:** Compaction handles mechanical reduction. Window Intelligence handles strategic decisions: when to compact, which stage, system reminders, provider-aware budgets. Separation of concerns.

## D34: Benchmark Engineering as Hooks, Not Middleware
**Decision:** TerminalBench-boosting techniques implemented as hooks (benchmark-engineering.ts).
**Rationale:** Hooks are deterministic guarantees. The benchmark techniques (edit tracking, planning enforcement, file-read-before-edit) are behavioral guarantees, not data transformations. Per spec: "hooks are guarantees, not prompts."

## D35: Channel Gateway with DM Pairing Security
**Decision:** Central message router (gateway.ts) modeled after OpenClaw's gateway architecture.
**Rationale:** OpenClaw's 50+ channel support is a competitive advantage. Gateway pattern allows adding channels without modifying the core agent. DM pairing prevents unauthorized access.

## D36: WebChat via HTTP/SSE, Not WebSocket
**Decision:** HTTP POST for messages, Server-Sent Events for streaming responses.
**Rationale:** SSE is simpler, works through CDNs/proxies, degrades gracefully. WebSocket adds complexity for minimal benefit in request/response chat.

## D37: PerFileEditTracker Thresholds (warn=4, block=8)
**Decision:** Per-file edit warning at 4, blocking at 8.
**Rationale:** LangChain research: repeated edits are the strongest signal of a stuck agent. 4 is generous for normal development; 8 is the hard stop forcing strategy escalation.

## D38: 15 Essential Skills Selected by Trigger Frequency
**Decision:** Created 15 SKILL.md files covering the most commonly triggered skills.
**Rationale:** Spec calls for 65+. We prioritized by file extension and import pattern frequency. Remaining 50+ added incrementally. Selected: typescript-pro, react-expert, python-pro, sql-pro, systematic-debugging, tdd-workflow, code-reviewer, conventional-commit, search-first, security-reviewer, docker-expert, api-design, code-simplifier, file-based-planning, web-scraper.

## D39: Session Analytics Wired to Runtime
**Decision:** SessionAnalytics tracks cost/tokens/time per provider and per tool, integrated into WOTANNRuntime.getStatus().
**Rationale:** You can't optimize what you don't measure. Every harness engineering paper emphasizes trace analysis as the feedback loop for improvement.
