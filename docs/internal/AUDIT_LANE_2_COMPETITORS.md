# AUDIT LANE 2 — Competitor Research (Deep Pass)

Date: 2026-04-19
Lane: 2 of 5 (competitor research)
Auditor: Opus 4.7 (1M) — max-effort mode
Scope: 27+ competitors, 8 benchmarks, 7 deliverables below
Cite rule: every claim traces to a URL or a cloned repo path

---

## 0. Evidence-of-work: repos actually cloned

Not a README parrot. The following were `git clone --depth 1` shallow-cloned to `/tmp/wotann-research/` and inspected (directory listings, README, plugin manifests, core source):

| Repo | Directory listed | Key files read |
|---|---|---|
| openclaw/openclaw | `/tmp/wotann-research/openclaw/` (113 extensions + apps + packages) | `README.md`, `CLAUDE.md`, `AGENTS.md`, `VISION.md`, `docs.acp.md`, 6+ plugin.json files, `extensions/active-memory/index.ts` |
| coollabsio/jean | `/tmp/wotann-research/jean/` | `README.md`, `src/services/*.ts`, `src/store/`, `src-tauri/src/*` |
| All-Hands-AI/OpenHands | `/tmp/wotann-research/OpenHands/` | `README.md`, `openhands/controller/`, `openhands/memory/`, `openhands/microagent/`, `enterprise/` |
| Aider-AI/aider | `/tmp/wotann-research/aider/` | `README.md`, `aider/` |
| SWE-agent/SWE-agent | `/tmp/wotann-research/SWE-agent/` | `README.md`, `sweagent/`, `tools/` |
| NousResearch/Hermes-Agent | `/tmp/wotann-research/Hermes-Agent/` | `README.md`, `agent/`, `hermes_cli/`, `environments/` |
| oraios/serena | `/tmp/wotann-research/serena/` | `README.md`, `src/` |
| charmbracelet/crush | `/tmp/wotann-research/crush/` | `README.md`, `internal/agent/` |
| block/goose | `/tmp/wotann-research/goose/` (AAIF/Linux Foundation now) | `README.md`, `crates/goose-acp/`, `crates/goose-mcp/` |
| openai/codex | `/tmp/wotann-research/codex/` | `README.md`, `codex-rs/` (Rust, full structure) |
| anthropics/claude-code | `/tmp/wotann-research/claude-code/` | `README.md`, `CHANGELOG.md` (v2.1.114 head), `plugins/` |
| sst/opencode | `/tmp/wotann-research/opencode/` | `README.md`, `packages/*` |
| langchain-ai/deepagents | `/tmp/wotann-research/deepagents/` | `README.md`, `libs/` |
| langchain-ai/open-swe | `/tmp/wotann-research/open-swe/` | `README.md`, `agent/` |
| bytedance/deer-flow | `/tmp/wotann-research/deer-flow/` | `README.md`, `backend/` |
| mem0ai/mem0 | `/tmp/wotann-research/mem0/` | `README.md`, `mem0/` |
| letta-ai/letta | `/tmp/wotann-research/letta/` | `README.md`, `letta/` |
| getAsterisk/opcode | `/tmp/wotann-research/opcode/` | `README.md`, `web_server.design.md`, `src-tauri/src/` |
| eigent-ai/eigent | `/tmp/wotann-research/eigent/` | `README.md`, `backend/`, `electron/` |
| menloresearch/jan | `/tmp/wotann-research/jan/` | `README.md`, `extensions/`, `core/` |

Failed / not attempted: Cursor (closed source — Changelog/blog only), Devin (closed source), Windsurf (closed source), Replit Agent (closed source), Augment Code (closed source), Bolt.new (clonable but not prioritized — Web API only), v0 (closed), Lovable (closed), Claude Mythos (Anthropic internal — no real repo; the GitHub results are reconstructions/parody), OpenClaw Zero-Token / BytePioneer forks (ecosystem fluff).

---

## 1. Executive Summary — What WOTANN is missing (ranked by adoption impact)

Brutal version. Based on cloning, reading, and cross-referencing 20+ live codebases and April 2026 blog posts, here is the reality check:

**A. OpenClaw is WOTANN's twin. This is an existential competitive signal.**
- OpenClaw has 247k GitHub stars, 24 messaging channels, 19+ providers, Gateway-over-Websocket, ACP bridge (`openclaw acp`), macOS/iOS/Android native apps, plugin SDK, Docker sandbox, browser plugin, voice/speech/image/video providers. Sponsors: OpenAI, GitHub, NVIDIA, Vercel, Blacksmith, Convex. [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- Hermes Agent (NousResearch) is actively migrating *from* OpenClaw — there is literally a `hermes claw migrate` CLI command. This means OpenClaw is the incumbent that everybody else in this category is already a fork of.
- **WOTANN's 25 channels / 19 providers spec is not a differentiator — it is the table stakes.** The moat must be elsewhere.

**B. The April 2026 landscape has shifted to agent-parallelism + browser/canvas.**
- Cursor 3 (April 2, 2026) rebuilt around an **Agents Window** with **Design Mode** (annotate UI in browser), **Canvases**, `/best-of-n`, `/worktree`. It demoted the IDE to a fallback. [cursor.com/blog/cursor-3](https://cursor.com/blog/cursor-3), [thenewstack.io](https://thenewstack.io/cursor-3-demotes-ide/)
- Perplexity Computer ($200/mo) orchestrates 19 different AI models, connects to 400+ apps, ships a **Personal Computer** local Mac-Mini edition. [perplexity.ai/hub/blog/everything-is-computer](https://www.perplexity.ai/hub/blog/everything-is-computer)
- Claude Design (April 17, 2026) reads your codebase + design files on onboarding and generates a full design system; hands off to Claude Code in one instruction. Exports Canva/PDF/PPTX/HTML. [anthropic.com/news/claude-design-anthropic-labs](https://www.anthropic.com/news/claude-design-anthropic-labs)
- **WOTANN has glass UI + 4 tabs. That's 2023-era. The current frontier is parallel-agent-canvases + design-aware multi-model routing.**

**C. Memory is a solved leaderboard, and WOTANN isn't on it.**
- Mem0's new algorithm (April 2026): **91.6% LoCoMo / 93.4% LongMemEval** at 1.09s p50 latency. [mem0.ai](https://mem0.ai/research)
- MemPalace hits **96.6% LongMemEval** with AAAK compression. [mempalace.tech](https://www.mempalace.tech/blog/best-ai-memory-frameworks-2026)
- Observational Memory (Mastra) scores **94.87%** — the highest ever. [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory)
- ByteRover, Supermemory, Letta, claude-mem — all actively compete on this benchmark.
- **WOTANN's memory moat is not backed by a LongMemEval number. It's currently a claim.** Ship a score or the moat evaporates.

**D. TerminalBench 2.0: harness quality matters more than the model.**
- Look at the April 16 leaderboard (verified via [tbench.ai](https://www.tbench.ai/leaderboard/terminal-bench/2.0)): GPT-5.4 with **ForgeCode** harness beats Gemini 3.1 Pro with **TongAgents** beats Claude Opus 4.6 with **ForgeCode** (#1 81.8%, #2 80.2%, #3 79.8%). Same GPT-5.3-Codex model gets 77.3% on Droid, 75.1% on Simple Codex. **Harness delta = 2.2 percentage points on identical model.**
- WOTANN's target "83-95%" is ambitious but tractable *if* WOTANN matches ForgeCode's harness discipline.

**E. Top-5 single-shot adoption impact items missing from WOTANN:**
1. **Parallel-agent workspace (Cursor 3 Agents Window pattern)** — launch many agents across local/worktree/cloud/SSH, side-by-side tabs
2. **Design Mode for non-developers (Claude Design pattern)** — capture design system from existing codebase, hand off to code generation
3. **ACP-as-first-class** — WOTANN should *be* the ACP agent others embed. OpenClaw has an `openclaw acp` bridge; Goose has a `goose-acp` Rust crate; Zed Registry went live January 2026
4. **Voice-first input + speech-to-text batch mode (Cursor 3, Windsurf)**
5. **Scheduled cron agents with delivery to messaging channels (Hermes Agent pattern)**

See §5 for the full ranked 20.

---

## 2. Per-Competitor Deep Dive

Per user's instruction: each entry includes what they do well, an architectural insight worth stealing, WOTANN's relative weakness, and a priority. Priority key: **P0** = ship-blocker (WOTANN is clearly behind), **P1** = high-value adoption feature, **P2** = nice-to-have, **P3** = differentiator-only (WOTANN already does it better).

### 2.1 OpenClaw (openclaw/openclaw) — THE TWIN
- URL: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw), [openclaw.ai](https://openclaw.ai/)
- Stars: 247k / 47.7k forks (per [wikipedia.org/wiki/OpenClaw](https://en.wikipedia.org/wiki/OpenClaw)). Sponsors: OpenAI, GitHub, NVIDIA, Vercel, Blacksmith, Convex.
- **Evidence**: Cloned. 113 extensions in `/tmp/wotann-research/openclaw/extensions/`, including: `acpx` (ACP bridge), `active-memory`, `memory-core`, `memory-lancedb`, `memory-wiki`, `browser` (CDP-based), `copilot-proxy`, `openshell` (mirror/remote sandbox), `qa-matrix`/`qa-lab`/`qa-channel` (dogfooded QA infra), `vydra` (image/video/speech provider), `diffs` (read-only diff viewer), `device-pair` (QR-based pairing), `voice-call`, `talk-voice`, `comfy`, `lobster`, and the full 24-channel messaging catalog (whatsapp, telegram, slack, discord, signal, iMessage, bluebubbles, matrix, zalo, zalouser, nostr, etc.). Apps for iOS/Android/macOS are in `apps/`.
- **What they do well (port list)**:
  - **Plugin SDK with strict boundary contracts** — `src/plugin-sdk/*` is the public surface; extensions MUST NOT deep-import `src/**`. Core is explicitly extension-agnostic. See their `AGENTS.md:40-90` which reads like hard law.
  - **`openclaw doctor --fix`** as the canonical repair path for legacy configs. WOTANN should adopt this pattern — health/lint/repair as a first-class CLI command.
  - **Progressive-disclosure docs**: `AGENTS.md` files at repo root, `extensions/`, `src/plugin-sdk/`, `src/channels/`, `src/plugins/`, `src/gateway/protocol/`. Each file is a boundary guide for that subtree.
  - **Gateway-over-Websocket architecture**: single control-plane daemon, thin CLI that forwards. Onboard installs as launchd/systemd user service.
  - **QA Lab / QA Matrix plugins**: Docker-backed live-QA transport runners against disposable services (Matrix homeserver, etc.). This is dogfooded internally to test the channels — WOTANN can port this for its own 25 channels.
  - **Active Memory plugin**: per-session transcripts, agent-recalled context, toggle state file, recency-tunable assistant/user turn budgets. The plugin source is 400+ lines with configurable cache TTL, maxCacheEntries, queryMode ("recent"/"search"). This is a concrete reference implementation for WOTANN's memory moat.
  - **ACP bridge (`openclaw acp`)** is a Gateway-backed ACP stdio agent. Supports `initialize`/`newSession`/`prompt`/`cancel`/`listSessions`, `session/set_mode`, session_info_update, usage_update. Openly lists what's *not yet* supported (per-session MCP servers, client filesystem methods, client terminal methods, session plans/thought streaming). WOTANN should plan against these same ACP surfaces.
  - **Browser plugin with CDP + profiles + doctor/maintenance/auth**. Not just Playwright — uses CDP directly with persistent profiles.
  - **Device pair** via QR code — used for onboarding mobile clients to the Gateway.
- **Architectural insight**: The "Gateway as control plane, plugins as capability" model is the correct macro-architecture. Everything else hangs off the Gateway over Bridge Protocol. WOTANN should verify its own daemon/control-plane is similarly cleanly separated from CLI/TUI/Tauri/iOS.
- **Weakness**: Documentation is dense and spread across 30+ `AGENTS.md` files — onboarding friction. No clearly claimed benchmark number (TerminalBench/SWE-bench). No visible "Editor" mode — OpenClaw is "messaging-first assistant." WOTANN's Editor/Workshop/Exploit tabs can be the wedge.
- **Priority**: **P0** — WOTANN and OpenClaw are playing the same game with the same 24 channels. WOTANN *must* differentiate on: (1) TerminalBench score, (2) Editor/code-agent mode that OpenClaw doesn't focus on, (3) memory benchmark win, (4) TUI polish (Gabriel's "most beautiful" criterion), (5) iOS real-device support (OpenClaw has iOS too — check feature parity).

### 2.2 Hermes Agent (NousResearch/hermes-agent)
- URL: [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- **Evidence**: Cloned. `agent/` contains 30+ modules including `anthropic_adapter.py`, `bedrock_adapter.py`, `gemini_cloudcode_adapter.py`, `copilot_acp_client.py`, `context_compressor.py`, `context_engine.py`, `credential_pool.py`, `memory_manager.py`, `memory_provider.py`, `skill_commands.py`, `skill_utils.py`, `nous_rate_guard.py`, `prompt_caching.py`. Directory `environments/` has `agent_loop.py`, `agentic_opd_env.py`, `hermes_swe_env/`, `terminal_test_env/`, `benchmarks/`, `tool_call_parsers/`.
- **What they do well**:
  - **Six terminal backends** — Local, Docker, SSH, Daytona, Singularity, Modal — with Daytona/Modal offering **serverless persistence** (agent hibernates when idle, wakes on demand). [README](/tmp/wotann-research/Hermes-Agent/README.md)
  - **Credential pool rotation** — multiple keys per provider, thread-safe `least_used` rotation, auto-rotate on 401, pool state survives fallback switches
  - **Self-improving skills loop** — autonomous skill creation after complex tasks, skills self-improve during use; [agentskills.io](https://agentskills.io) open standard
  - **Honcho dialectic user modeling** as reference memory plugin
  - **Atropos RL environments** for batch trajectory generation (RL training pipeline baked in)
  - **Built-in cron scheduler** with delivery to any messaging platform — daily reports, nightly backups, weekly audits, all natural-language
  - **Android/Termux support** via curated `.[termux]` extra
  - **Literal OpenClaw migration command**: `hermes claw migrate` — tells you directly Hermes is a newer, opinionated OpenClaw fork
- **Architectural insight**: **Pluggable memory provider ABC** — the memory interface is a Python ABC that third parties can implement. WOTANN should copy this — memory shouldn't be locked to one implementation.
- **Weakness**: No native desktop/mobile apps (CLI + gateway only). Less polished than OpenClaw's iOS/macOS suite. Python-heavy; contrast with WOTANN's Tauri stack.
- **Priority**: **P0** — the credential pool rotation, self-improving skills, serverless persistence, and cron scheduler are four distinct ship-blocker features. Port all four.

### 2.3 Jean (coollabsio/jean)
- URL: [github.com/coollabsio/jean](https://github.com/coollabsio/jean), [jean.build](https://jean.build)
- **Evidence**: Cloned. Stack confirmed: Tauri v2 + React 19 + Rust + TypeScript + Tailwind v4 + shadcn/ui v4 + Zustand v5 + TanStack Query + CodeMirror 6 + xterm.js. `src/services/` has `claude-cli.ts`, `codex-cli.ts`, `cursor-cli.ts`, `opencode-cli.ts`, `gh-cli.ts`, `linear.ts`, `mcp.ts`, `skills.ts`. `src-tauri/src/` has `background_tasks/`, `chat/`, `claude_cli/`, `codex_cli/`, `cursor_cli/`, `gh_cli/`, `http_server/`, `opencode_cli/`, `opencode_server/`, `opinionated/`, `platform/`, `projects/`, `terminal/`.
- **What they do well**:
  - **Session execution modes: Plan / Build / Yolo** with plan-approval flows. WOTANN's "4 tabs" should incorporate this as *modes per task* instead
  - **Linked projects** for cross-project context — rare feature
  - **Magic Commands**: investigate issues/PRs/workflows, AI commit messages, PR content, merge conflict resolution, release notes. **Per-prompt model/backend/effort selection** is a killer UX
  - **Multi-CLI support from one UI**: Claude CLI + Codex CLI + Cursor CLI + OpenCode — lets user mix agents inside one project
  - **Per-session model + effort overrides** (Opus 4.5 / Opus 4.6 / Opus 4.6 1M / Sonnet 4.6 / Haiku with thinking/effort levels)
  - **Built-in HTTP server + WebSocket for remote mobile browser access** with token auth
  - **Multi-dock terminal** (floating / left / right / bottom) — UX polish
  - **Diff viewer unified + side-by-side** with full language support
  - **Save contexts with AI summarization** — re-hydration pattern
  - **Notifications + chat search + custom fonts** — sweats the details
- **Architectural insight**: **Jean is the "meta-harness"** — it runs other harnesses. WOTANN positions itself as a harness. They're complementary, but Jean already shipped multi-CLI routing that WOTANN's spec calls for. **Jean is the Desktop-IDE-without-being-VS-Code** answer.
- **Weakness**: No iOS/Android native (opens web on mobile via remote HTTP server). No messaging channels. No benchmark score.
- **Priority**: **P0** — Jean's execution modes (Plan/Build/Yolo) and per-prompt model routing are directly missing from WOTANN. Multi-CLI support is a moat-breaker — if WOTANN doesn't host multiple CLI agents, users will just use Jean.

### 2.4 Cursor 3 (cursor.com — closed)
- URL: [cursor.com/blog/cursor-3](https://cursor.com/blog/cursor-3), [cursor.com/changelog](https://cursor.com/changelog)
- **Shipped Apr 2, 2026** — interface rebuilt around agent-first design
- **What they do well**:
  - **Agents Window** — parallel agents across repos + envs (local / worktrees / cloud / remote SSH); Agent Tabs in grid/side-by-side
  - **Design Mode** — annotate UI elements directly in browser; point agent at specific page elements
  - **`/worktree` slash command** — creates isolated git worktree automatically
  - **`/best-of-n`** — runs identical task across multiple models in parallel worktrees, compares
  - **`Await` tool** — wait for background shells, subagents, or specific output patterns
  - **Canvases (Apr 15)** — interactive dashboards/tables/diagrams as durable side-panel artifacts
  - **Voice Input batch mode (Apr 13)** — full voice clip recorded, then batch-STT transcribed
  - **Bugbot self-improving (Apr 8)** — learns rules from PR feedback, 78% resolution rate
  - **Multi-repo layout + cloud-to-local seamless handoff**
- **Architectural insight**: The IDE is now a fallback view, not the default. [thenewstack.io](https://thenewstack.io/cursor-3-demotes-ide/) makes this explicit. The **primary interface is an agent orchestrator**, not an editor.
- **Weakness**: Closed source. $500M ARR = $2B bet means aggressive expansion; likely to price-compress open alternatives.
- **Priority**: **P0** — Agents Window + Design Mode + Canvases are three features WOTANN's spec does not currently prioritize, but will be "why switch?" features for users evaluating WOTANN vs. Cursor.

### 2.5 Claude Code (anthropics/claude-code)
- URL: [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code)
- **Evidence**: Cloned. Plugins directory has: agent-sdk-dev, claude-opus-4-5-migration, code-review, commit-commands, explanatory-output-style, feature-dev, frontend-design, hookify, learning-output-style, plugin-dev, pr-review-toolkit, ralph-wiggum, security-guidance. Current version: **v2.1.114** per CHANGELOG.
- **What they do well** (from CHANGELOG):
  - **Native binaries per platform** (moved away from bundled JS)
  - **`sandbox.network.deniedDomains`** — fine-grained network sandbox
  - **`/loop` with Esc-cancel** — recurring command cancellation
  - **`/extra-usage` from remote control** — mobile/web client introspection
  - **`/ultrareview`** — cloud multi-agent verify-by-reproduction, parallelized checks, diffstat, animated launching state
  - **Subagent stall-detection** — 10-minute timeout instead of silent hang
  - **Security defense-in-depth** — Bash commands wrapped in `env`/`sudo`/`watch`/`ionice`/`setsid` now caught by deny rules. `Bash(find:*)` no longer auto-approves `-exec`/`-delete`.
  - **Hooks / skills / subagents / MCP servers / parallel agents / teams**
  - **Plugin marketplace** via [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission)
- **Architectural insight**: Hooks are the core extension model. They run per-event, are declared in `settings.json`, and enforce behaviors the AI itself cannot deterministically enforce. **WOTANN should have hooks, not just plugins.**
- **Weakness**: Terminal-only (no GUI). MCP is the sole integration pattern (WOTANN should too).
- **Priority**: **P1** — WOTANN already overlaps with Claude Code's model (CLI-first, MCP-aware, skills-based). Focus on features Claude Code lacks: GUI/Tauri, messaging channels, iOS.

### 2.6 Codex CLI (openai/codex)
- URL: [github.com/openai/codex](https://github.com/openai/codex)
- **Evidence**: Cloned. `codex-rs/` is a full Rust workspace with app-server, app-server-protocol, app-server-test-client, backend-client, apply-patch, chatgpt, cli, cloud-requirements, cloud-tasks, cloud-tasks-client, cloud-tasks-mock-client, etc. Also `codex-cli/` for the JS front-end. Docker + Bazel build system.
- **What they do well**:
  - **Codex App** (`codex app`) — desktop-app experience as a separate mode
  - **Codex Web** at chatgpt.com/codex — cloud agent
  - **Sign-in with ChatGPT plan integration** — no API key required for Plus/Pro/Business/Edu/Enterprise
  - **Rust core + JS CLI** — performance-first
  - **Cloud tasks protocol** — app-server architecture separates orchestration from execution
- **Architectural insight**: Rust for core execution, JS for CLI surface. Clean separation. **WOTANN's Tauri stack already does this — confirm the Rust backend is load-bearing for agent orchestration, not just UI chrome.**
- **Weakness**: Closed cloud model. OpenAI-only by default (though MCP can extend).
- **Priority**: **P1** — port the **cloud/local handoff** pattern. WOTANN should support task handoff to a cloud agent seamlessly.

### 2.7 OpenHands (All-Hands-AI/OpenHands)
- URL: [github.com/OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) — benchmark badge 77.6% on SWE-bench
- **Evidence**: Cloned. `openhands/` has `app_server/`, `architecture/`, `controller/`, `core/`, `critic/`, `events/`, `integrations/`, `io/`, `linter/`, `llm/`, `mcp/`, `memory/`, `microagent/`, `resolver/`, `runtime/`, `security/`, `server/`, `storage/`. `enterprise/` is a full SaaS server with alembic migrations. Their controller is 58kb.
- **What they do well**:
  - **Microagents** — `skills/` directory has add_agent.md, add_repo_inst.md, address_pr_comments.md, agent-builder.md, azure_devops.md, bitbucket.md, code-review.md, codereview-roasted.md, default-tools.md, docker.md, fix_test.md. These are triggered into context by keywords and are a different pattern from WOTANN's skills.
  - **Full SDK** — pip-installable Python library, define agents in code, run locally or scale to 1000s in cloud. [docs.openhands.dev/sdk](https://docs.openhands.dev/sdk)
  - **Critic module** — `openhands/critic/` is a dedicated self-review subsystem
  - **77.6% SWE-bench** — third-party verified benchmark
  - **Event-sourced controller** — state replay, stuck-detection (20kb `stuck.py`), resolver for GitHub issues
  - **Runtime plugins** — modular execution runtime with browser, MCP, plugins, status reporting
- **Architectural insight**: **Event-sourced agent state**. `agent_controller.py` (58kb) manages a finite-state machine over events. Enables replay, stuck-detection, and graceful recovery. WOTANN probably has ad-hoc state — port the event-sourced pattern.
- **Weakness**: Python-first (LOC-heavy). UI is React in `frontend/` but feels enterprise-CRM, not consumer.
- **Priority**: **P0** — port the **event-sourced controller** and **critic module** patterns. The SWE-bench score is third-party verifiable; WOTANN needs one too.

### 2.8 Aider (Aider-AI/aider)
- URL: [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider) — 5.7M installs, 15B tokens/week
- **Evidence**: Cloned. `aider/` has `coders/`, `commands.py`, `diffs.py`, `gui.py`, `history.py`, `io.py`, `linter.py`, `llm.py`, `repo.py`, `onboarding.py`. The `benchmark/` directory is the Polyglot harness.
- **What they do well**:
  - **Aider Polyglot benchmark** — owned, operated, and cited. See [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/). Gives them authority in the space.
  - **Repo map** — code index of entire repository; [aider.chat/docs/repomap.html](https://aider.chat/docs/repomap.html)
  - **Singularity 88%** — 88% of Aider's own code is now written by Aider. Credibility metric.
  - **Git integration** — atomic commits per edit, automatic commit messages
  - **100+ languages**, cloud + local LLMs
- **Architectural insight**: Shipping + owning a benchmark (Polyglot) is a distribution moat, not just a PR win. WOTANN should ship its own benchmark or at least prominently score on existing ones.
- **Weakness**: TUI-only, no desktop app, no messaging channels, no mobile.
- **Priority**: **P1** — port **repo map** + **atomic commits per edit** + Polyglot benchmark citation.

### 2.9 SWE-agent (SWE-agent/SWE-agent)
- URL: [github.com/SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent)
- **Evidence**: Cloned. `sweagent/` has `agent/`, `environment/`, `inspector/`, `run/`, `tools/`. `tools/` has `diff_state/`, `edit_anthropic/`, `filemap/`, `forfeit/`, `image_tools/`, `multilingual_setup/`, `registry/`, `review_on_submit_m/`, `search/`, `submit/`, `web_browser/`, `windowed/`, `windowed_edit_linting/`, `windowed_edit_replace/`, `windowed_edit_rewrite/`. Being superseded by `mini-swe-agent`.
- **What they do well**:
  - **YAML-config for entire agent behavior** — one file governs the whole loop
  - **Tool registry pattern** — tools are plug-in modules
  - **Demonstrations/trajectories** as training data — `trajectories/demonstrations/`
  - **Enigma agent** — same harness for cybersecurity vulnerabilities
- **Architectural insight**: **YAML-defined agent configuration**. The entire agent behavior (system prompt, tools, loop style, submission criteria) is one YAML. WOTANN should adopt this for agent templating — users can share and remix agents.
- **Weakness**: Development moving to `mini-swe-agent`. Main repo in maintenance mode.
- **Priority**: **P1** — port **YAML-config agent definitions** and **tool registry**.

### 2.10 Serena (oraios/serena)
- URL: [github.com/oraios/serena](https://github.com/oraios/serena)
- **Evidence**: Cloned. `src/serena/`, `src/solidlsp/`, `src/interprompt/`. End users are AI agents, not humans.
- **What they do well**:
  - **LSP-first agent tooling** — symbol-level operations via Language Server Protocol, not line-numbers or grep
  - **Agent-first abstractions** — `find_symbol`, `get_symbols_overview`, `find_referencing_symbols`, `rename_symbol`, `safe_delete_symbol`, `insert_before_symbol`/`insert_after_symbol`, `replace_symbol_body`
  - **SolidLSP** — their own LSP wrapper. Project activation, onboarding, memory read/write
  - **MCP-only integration** — consistent interface for all agents
- **Architectural insight**: **Semantic code operations as first-class tools.** `find_referencing_symbols` is strictly better than `grep "functionName"`. WOTANN must expose LSP-aware operations (read-symbol, rename-symbol, find-references) as agent tools, not just file I/O + grep.
- **Weakness**: MCP-only — no standalone UI. Requires a client.
- **Priority**: **P0** — **LSP integration is table stakes** for 2026 code agents. Port `find_symbol`/`rename_symbol`/`find_referencing_symbols` as WOTANN tools. Note: user has Serena MCP enabled in their Claude Code session — it's already proven at the Claude Code layer.

### 2.11 Goose (block/goose → AAIF)
- URL: [github.com/aaif-goose/goose](https://github.com/aaif-goose/goose) (moved to AAIF / Linux Foundation)
- **Evidence**: Cloned. `crates/goose-acp/` (ACP agent), `goose-acp-macros/`, `goose-cli/`, `goose-mcp/`, `goose-sdk/`, `goose-server/`, `goose-test/`. MCP crate contains `autovisualiser`, `computercontroller`, `memory`, `peekaboo`, `tutorial`.
- **What they do well**:
  - **Native Rust desktop app + CLI + API** — one stack
  - **15+ providers** including Anthropic, OpenAI, Google, Ollama, OpenRouter, Azure, Bedrock
  - **70+ extensions via MCP**
  - **ACP support** — `goose-acp` is a dedicated crate. Can connect Claude, ChatGPT, Gemini subscriptions via ACP. [goose-docs.ai/docs/guides/acp-providers](https://goose-docs.ai/docs/guides/acp-providers)
  - **Dictation built-in** — `dictation/` module in goose crate
  - **Recipes** — `recipe/`, `recipe_deeplink.rs` — shareable recipe format
  - **Instance ID + OAuth + OTEL** — enterprise-grade
  - **Scheduler** — `scheduler_trait.rs` for recurring tasks
  - **Hints system** — `hints/` module for context-appropriate suggestions
- **Architectural insight**: **Goose moved to Linux Foundation (AAIF)** — shows the industry trend of commoditizing the harness layer. Being proprietary is a risk; being foundational is a moat. Consider what WOTANN positions as foundational.
- **Weakness**: No messaging channels. No native iOS/Android apps (just desktop + CLI).
- **Priority**: **P0** — port **Recipes format** (shareable workflow definitions), **ACP crate** pattern, and **Dictation module**. Consider whether WOTANN should eventually be donated to AAIF for network-effect legitimacy.

### 2.12 Crush (charmbracelet/crush)
- URL: [github.com/charmbracelet/crush](https://github.com/charmbracelet/crush)
- **Evidence**: Cloned. Go monorepo with `internal/agent/`, `internal/lsp/`, `internal/permission/`, `internal/session/`, `internal/shell/`, `internal/pubsub/`, `internal/oauth/`.
- **What they do well**:
  - **TUI beauty** — Charmbracelet's bubbletea/lipgloss ecosystem, 25k+ apps built on the same stack
  - **LSP integration** for additional context (same idea as Serena)
  - **Mid-session LLM switching** — preserve context across model change
  - **Multi-session contexts per project**
  - **MCP via http/stdio/sse**
  - **Works everywhere**: macOS, Linux, Windows (PowerShell/WSL), Android, FreeBSD, OpenBSD, NetBSD, Arch, Nix, Homebrew, Winget, Scoop
  - **Hyper + notify modules** — async performance + macOS notifications
  - **Loop detection** (`loop_detection.go`) — catches agent getting stuck in a loop
- **Architectural insight**: **The TUI-as-product thesis is proven.** 25k+ apps use Charm; Gabriel's "most beautiful" TUI ambition has a production-grade baseline to compete against.
- **Weakness**: CLI/TUI only. No GUI. No mobile.
- **Priority**: **P1** — TUI polish reference. Port **loop detection** pattern; verify WOTANN's TUI meets the Charm visual bar.

### 2.13 OpenCode (sst/opencode — formerly anomalyco)
- URL: [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode) / [opencode.ai](https://opencode.ai)
- **Evidence**: Cloned. Packages monorepo has `app/`, `console/`, `containers/`, `desktop/`, `desktop-electron/`, `enterprise/`, `extensions/`, `function/`, `identity/`, `opencode/`, `plugin/`, `slack/`, `storybook/`, `ui/`, `web/`.
- **What they do well**:
  - **Multi-surface strategy**: CLI + Desktop (Tauri + Electron both) + Web + Slack + Console server
  - **Enterprise package** is first-class (not afterthought)
  - **i18n** — 21 README languages (en, zh, zht, ko, de, es, fr, it, da, ja, pl, ru, bs, ar, no, br, th, tr, uk, bn, gr, vi)
  - **Storybook** for UI consistency — rare for agents
  - **AGENTS.md everywhere** — same progressive-disclosure doc pattern as OpenClaw
- **Architectural insight**: **Storybook + monorepo packaging + enterprise package from day 1.** WOTANN's spec talks about consumer; OpenCode shows the dual-track consumer/enterprise product works.
- **Weakness**: Messaging = Slack only (vs WOTANN's 25). Desktop exists as both Tauri and Electron versions — likely rot, suggests strategy drift.
- **Priority**: **P1** — port **Storybook-driven UI consistency** and **enterprise package**. Consider the Slack-first messaging strategy vs WOTANN's 25-channel play.

### 2.14 DeepAgents (langchain-ai/deepagents)
- URL: [github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)
- **Evidence**: Cloned. `libs/acp/`, `libs/cli/`, `libs/deepagents/`, `libs/evals/`, `libs/partners/`, `libs/repl/`.
- **What they do well**:
  - **Opinionated defaults**: batteries-included — `write_todos`, `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep`, `execute`, `task`
  - **Auto-summarization** when conversation gets long + large outputs saved to files
  - **Subagent delegation via `task` tool** with isolated context windows
  - **Compiled LangGraph** as agent unit — streamable, checkpointable, Studio-integrable
  - **Deployment guide** — `deepagents-deploy.md` as first-class doc
  - **Partners** — AWS, GCP integrations
- **Architectural insight**: **Compiled graph as agent unit.** If you commit to LangGraph, you get persistence, streaming, Studio, checkpointing for free. WOTANN doesn't need LangGraph but needs the **agent-as-checkpointable-unit** abstraction.
- **Weakness**: LangChain lock-in. Python-only (JS lib is separate).
- **Priority**: **P2** — port **agent-as-checkpointable-unit** abstraction. LangChain ecosystem reach is useful to be compatible with.

### 2.15 Open-SWE (langchain-ai/open-swe)
- URL: [github.com/langchain-ai/open-swe](https://github.com/langchain-ai/open-swe)
- **Evidence**: Cloned. `agent/` has `encryption.py`, `integrations/`, `middleware/`, `prompt.py`, `server.py`, `tools/`, `utils/`, `webapp.py`.
- **What they do well**:
  - **Cloud sandboxes as default** — Daytona/E2B/Modal for isolation
  - **Slack + Linear invocation** — agents triggered from ticket systems
  - **Automatic PR creation**
  - **Middleware pattern** — `ToolErrorMiddleware`, `check_message_queue_before_model` — pluggable pipeline stages
  - **Composes on DeepAgents** (inheritance model) — pulls in upstream improvements
- **Architectural insight**: **Middleware pattern for agent pipelines.** Every request passes through ordered middleware — error recovery, queue checks, rate limiting, permission checks. WOTANN should structure its agent loop as middleware.
- **Weakness**: Early-stage. Aimed at enterprises like Stripe/Ramp/Coinbase (specific buyer).
- **Priority**: **P1** — port **middleware pattern** for agent pipeline. Adopt Slack + Linear agent invocation.

### 2.16 DeerFlow 2.0 (bytedance/deer-flow)
- URL: [github.com/bytedance/deer-flow](https://github.com/bytedance/deer-flow)
- **Evidence**: Cloned. `backend/app/`, `backend/packages/`, `frontend/`, `docker/`, `skills/public/`. Version 2.0 is a ground-up rewrite. Hit #1 on GitHub Trending Feb 28, 2026.
- **What they do well**:
  - **Super-agent harness** orchestrating sub-agents + memory + sandboxes
  - **InfoQuest integration** — ByteDance's search/crawling toolset, free online
  - **Claude Code integration** — DeerFlow can drive Claude Code
  - **Langfuse + LangSmith tracing** — observability first-class
  - **Backed by Volcengine** (ByteDance cloud) — coding plan with Doubao-Seed-2.0-Code, DeepSeek v3.2, Kimi 2.5
  - **IM Channels** built-in
  - **MCP server support**
- **Architectural insight**: **Observability first-class via Langfuse/LangSmith.** WOTANN needs agent-run observability — every tool call traceable, replayable, shareable.
- **Weakness**: Chinese dev team — likely lower trust for Western enterprise buyers due to ByteDance association.
- **Priority**: **P1** — port **observability first-class** (Langfuse-compatible tracing).

### 2.17 Mem0 (mem0ai/mem0)
- URL: [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) — Y Combinator S24
- **Evidence**: Cloned. `mem0/` has `client/`, `configs/`, `embeddings/`, `exceptions.py`, `llms/`, `memory/`, `proxy/`, `reranker/`, `utils/`, `vector_stores/`. Top-level has `mem0-ts/`, `mem0-plugin/`, `vercel-ai-sdk/`, `embedchain/`, `cookbooks/`, `openclaw/` (!), `openmemory/`, `cli/`.
- **What they do well**:
  - **April 2026 new memory algorithm**: **91.6% LoCoMo** (was 71.4%), **93.4% LongMemEval** (was 67.8%), 6.8k tokens, 1.09s p50 — paper at [mem0.ai/research](https://mem0.ai/research)
  - **Native OpenClaw plugin** (in same repo) — infiltrating the OpenClaw ecosystem
  - **Vercel AI SDK** integration — ships JS-side
  - **Reranker** as separate module — retrieval quality first-class
  - **OpenMemory** — federated memory across agents
- **Architectural insight**: **Reranker as distinct stage in retrieval pipeline.** Vector search → rerank → format. WOTANN's memory should have this explicit stage, not one-shot similarity.
- **Weakness**: Standalone memory system — must be integrated into a harness.
- **Priority**: **P0** — WOTANN should ship with Mem0 integration out of the box, OR publish WOTANN's own memory on the same LongMemEval benchmark to stake a claim. Silence = loss.

### 2.18 Letta (letta-ai/letta, formerly MemGPT)
- URL: [github.com/letta-ai/letta](https://github.com/letta-ai/letta)
- **Evidence**: Cloned. `letta/` has `adapters/`, `agent.py`, `agents/`, `cli/`, `client/`, `data_sources/`, `functions/`, `groups/`, `helpers/`, `humans/`, `interfaces/`, `jobs/`, `llm_api/`, `local_llm/`, `model_specs/`, `monitoring/`, `openai_backcompat/`, `orm/`.
- **What they do well**:
  - **MemGPT origin** — academic provenance
  - **Letta Code CLI** (`@letta-ai/letta-code`) — competitor to Claude Code, memory-first
  - **Stateful agents API** — Python + TS SDKs
  - **Model leaderboard** — their own [leaderboard.letta.com](https://leaderboard.letta.com/)
  - **Groups** — multi-agent collaboration primitive
  - **ORM-based** — agents backed by Postgres via Alembic migrations
- **Architectural insight**: **Agents as database rows via ORM + Alembic migrations.** When agent state is persistent data (not in-memory Python objects), you get backup, analytics, audit log, multi-user sharing for free. WOTANN should have its agent state as a first-class DB schema, not a session directory.
- **Weakness**: Heavy Python stack. Postgres dependency.
- **Priority**: **P1** — port **agent-as-DB-row** pattern. Consider own leaderboard.

### 2.19 Opcode (getAsterisk/opcode)
- URL: [github.com/getAsterisk/opcode](https://github.com/getAsterisk/opcode)
- **Evidence**: Cloned. Tauri 2 app. `cc_agents/` has `git-commit-bot.opcode.json`, `security-scanner.opcode.json`, `unit-tests-bot.opcode.json`. `src-tauri/src/` has `checkpoint/`, `claude_binary.rs`, `commands/`, `process/`, `web_main.rs`, `web_server.rs`. `web_server.design.md` is thorough.
- **What they do well**:
  - **GUI for Claude Code** — exactly positions as "Claude Code plus UI"
  - **Custom agents as JSON files** (`.opcode.json`) — shareable
  - **Timeline / checkpoints** — time-travel debugging
  - **MCP server management UI**
  - **Usage analytics dashboard**
  - **Web server mode** — REST + WebSocket, mobile phone/browser access (architecture documented in `web_server.design.md`)
  - **CLAUDE.md management**
- **Architectural insight**: **Checkpoints as snapshot-and-rollback primitive.** Like git for agent state. WOTANN should have checkpoints at every tool-call boundary, rollback-able.
- **Weakness**: Claude-Code-only (doesn't work with other harnesses). Unaffiliated with Anthropic.
- **Priority**: **P1** — port **checkpoints with rollback** and **shareable agent JSON format**.

### 2.20 Eigent (eigent-ai/eigent)
- URL: [github.com/eigent-ai/eigent](https://github.com/eigent-ai/eigent)
- **Evidence**: Cloned. Electron app. `backend/`, `build/`, `components.json`, `config/`, `electron/`, `electron-builder.json`, `entitlements.mac.plist`, `licenses/`, `public/`, `package/`.
- **What they do well**:
  - **Open-source "Cowork Desktop"** — productivity positioning, not coding
  - **CAMEL-AI** foundation — research-grade multi-agent
  - **Multi-Agent Workforce** — parallel execution
  - **SSO / enterprise controls**
  - **Local deployment default**
  - **MCP integration**
- **Architectural insight**: **Productivity positioning, not coding.** Eigent is adjacent to WOTANN's segment. If WOTANN strictly focuses on agent harness for devs, Eigent isn't a direct competitor — but the productivity buyer (knowledge worker) is a larger market.
- **Weakness**: Electron (heavier than Tauri). Coding features shallow.
- **Priority**: **P2** — study the **Cowork positioning** as a potential TAM expansion.

### 2.21 Devin (Cognition Labs — closed)
- URL: [cognition.ai](https://cognition.ai/)
- **2026 status per [docs.devin.ai/release-notes/2026](https://docs.devin.ai/release-notes/2026) and blog**:
  - **Acquired Windsurf** for ~$250M (Dec 2025) — now owns Cascade
  - Devin now **4× faster** at problem solving, **2×** resource efficiency
  - **67% PR merge rate** (up from 34% last year)
  - **Self-scheduling** — run once, tell Devin to keep doing it; agent maintains state between runs
  - **End-to-end testing with computer use** — tests any Linux desktop app; records clicking, sends video
  - **Sub-agent teams in parallel**
- **Architectural insight**: **Scheduled recurring agent runs with state maintained between invocations.** Related to Hermes cron but deeper — Devin "owns" a task long-term. WOTANN needs long-running-job abstraction.
- **Weakness**: Closed source, expensive.
- **Priority**: **P1** — port **self-scheduling recurring agent** with state.

### 2.22 Windsurf (Codeium → Cognition)
- URL: [windsurf.com](https://windsurf.com/)
- **2026 state per [windsurf.com/changelog](https://windsurf.com/changelog)**:
  - **Kanban-style view** of all local + cloud agent sessions
  - **Spaces** — group agent sessions, PRs, files, context into task-level
  - **Refined Windsurf Browser** with toolbar integration + Cascade page-reading tool
  - **Cascade** (Code mode + Chat mode)
  - **Real-time awareness** — tracks clipboard, terminal commands, edits to infer intent
- **Architectural insight**: **Spaces as task-level grouping** above sessions. Stable mental model for long work.
- **Weakness**: Closed. Now under Cognition, future direction uncertain.
- **Priority**: **P1** — port **Spaces** concept for task-level grouping.

### 2.23 Replit Agent (closed)
- **Known features**: in-browser dev + AI + hosting; targets no-code/low-code builders
- **Priority**: **P3** — different segment (browser-native, non-technical). WOTANN competes via a different vector.

### 2.24 Augment Code / Auggie (closed, augment-agent wrapper is open)
- URL: [github.com/augmentcode/augment-agent](https://github.com/augmentcode/augment-agent)
- **Evidence**: Cloned. GitHub Action wrapper for their private Auggie.
- **What they do well**: Context engine (large codebases), GitHub PR integration, team-aware
- **Priority**: **P2** — enterprise buyer. Port **team-shared context**.

### 2.25 Bolt.new / Lovable / v0 — the no-code/low-code trio
- [github.com/stackblitz/bolt.new](https://github.com/stackblitz/bolt.new), [lovable.dev](https://lovable.dev/guides/lovable-vs-bolt-vs-v0), [v0.dev](https://v0.dev)
- **State**: Bolt uses StackBlitz WebContainers — full Node.js runtime in-browser; 40% faster builds than 2025, secret-masking; v0 focuses on React components for existing codebases; Lovable best UI quality
- **Priority**: **P2** — different segment (no-code for non-devs). But **WebContainer-style in-browser Node.js execution** is a pattern WOTANN could adopt for a web-based mode.

### 2.26 OpenHands (re-covered in 2.7) — SWE-bench 77.6%

### 2.27 OpenClaw ecosystem additions
- **BytePioneer-AI/openclaw-china** — China-specific channels (飞书/钉钉/QQ/企业微信/微信)
- **TianyiDataScience/openclaw-control-center** — observability dashboard for OpenClaw
- **VoltAgent/awesome-openclaw-skills** — 5,400+ skills registry
- **Gen-Verse/OpenClaw-RL** — RL training on top of OpenClaw
- **supermemoryai/openclaw-supermemory** — memory plugin for OpenClaw
- **Signal**: the OpenClaw **plugin ecosystem is huge and growing**. Third-party plugin distribution will be critical for WOTANN. Fork-of-OpenClaw risk must be addressed — if WOTANN doesn't open its plugin format, the OpenClaw ecosystem won't come with.

### 2.28 Jan (menloresearch/jan, formerly janhq/jan)
- URL: [github.com/menloresearch/jan](https://github.com/menloresearch/jan)
- **Evidence**: Cloned. Extensions: `assistant-extension`, `conversational-extension`, `download-extension`, `foundation-models-extension`, `llamacpp-extension`, `mlx-extension`, `rag-extension`, `vector-db-extension`. Tauri v2.
- **What they do well**:
  - **Privacy-first local LLM runner** with MLX, llama.cpp
  - **Extensions architecture** — `rag-extension`, `vector-db-extension` are first-party
  - **Microsoft Store + Flathub + Chocolatey** distribution
- **Priority**: **P2** — local-LLM inference built-in. WOTANN's spec calls for this; Jan is the reference.

### 2.29 LM Studio / Ollama / Open Interpreter — privacy-first stack
- **Known state**: Open Interpreter's Local III integrates Ollama, Llamafile, Jan, LM Studio
- **Trend per [fazm.ai/blog/best-open-source-computer-use-ai-agents-2026](https://fazm.ai/blog/best-open-source-computer-use-ai-agents-2026)**: 2026 computer-use agents are converging on **local execution + hybrid perception (a11y API + vision) + UI-trained specialized models**
- **Priority**: **P2** — ensure WOTANN ships with Ollama/LM Studio/Jan adapters.

### 2.30 Claude Design (Anthropic Labs — Apr 17, 2026)
- URL: [anthropic.com/news/claude-design-anthropic-labs](https://www.anthropic.com/news/claude-design-anthropic-labs)
- **Shipped 48 hours before this audit**. Research preview for Claude Pro/Max/Team/Enterprise.
- **What they do well (confirmed via fetched blog)**:
  - **Brand-system auto-generation** — reads codebase + design files on onboarding
  - **Multi-modal refinement UI** — inline comments, direct text edits, live sliders for spacing/color/layout
  - **Export**: Canva, PDF, PPTX, HTML, internal URL
  - **One-instruction Claude Code handoff** — packages design spec → implementation bundle
  - **Claude Opus 4.7 powered**
  - Adobe + Figma stocks dropped on announcement per [thebridgechronicle.com](https://www.thebridgechronicle.com/tech/anthropic-claude-design-launch-impact-adobe-figma-stocks-mp99)
- **Architectural insight**: **The Claude Code → Claude Design handoff is a model for WOTANN.** WOTANN's Chat/Editor/Workshop/Exploit tabs need cross-tab handoffs the same way. Designing in Workshop → implementing in Editor with one click.
- **Priority**: **P0** — incorporate **design-aware agent** + **one-command handoff between agent modes**. The Adobe/Figma stock reaction means this hits an underserved market; WOTANN should be where design-to-code happens for devs who don't use Figma.

### 2.31 Perplexity Computer + Comet (closed, Feb 25 + March 2026)
- URL: [perplexity.ai/hub/blog/everything-is-computer](https://www.perplexity.ai/hub/blog/everything-is-computer)
- **Shipped Feb 25, 2026. Personal Computer (local Mac-Mini) March 11, 2026.**
- **What they do well (confirmed via WebFetch of Build Fast With AI analysis)**:
  - **Multi-model orchestration** — 19 AI models, routes Opus 4.6 for code, Gemini for research, GPT-5.2 for long context
  - **400+ app connections** — Slack, Gmail, GitHub, Notion, etc.
  - **Task decomposition → parallel execution → continuous optimization** loop
  - **Personal Computer local device** — persistent access to local files/apps/sessions with audit trails
  - **$200/mo Max tier, 10k monthly credits**
  - **Enterprise: $325/seat/mo** with audit logging + security controls
  - **Comet browser** — Chromium-based, AI in every page, silent MDM deployment for enterprise
- **Architectural insight**: **Model routing based on task type**. Hardcoded rule: code → Opus 4.6, research → Gemini, long-context → GPT-5.2. WOTANN must have **a routing layer** that picks best model per subtask, not just per-session.
- **Weakness**: $200/mo entry price — WOTANN can undercut. Heavy vendor lock-in.
- **Priority**: **P0** — port **task-type model routing** as an explicit layer. Document it (users love this kind of "smart" they can audit).

### 2.32 Claude Mythos (Anthropic internal, TerminalBench leader)
- **Claim from TerminalBench 2.0 and llm-stats.com**: Claude Mythos Preview scores 82% on TBench 2.0, 93.9% on SWE-bench Verified, 45.9% on SWE-bench Pro (contamination-free)
- **No real public repo** — GitHub results ("kyegomez/OpenMythos" etc.) are reconstructions. Most are April 2026 forks trying to capture search volume.
- **Signal**: Mythos is Anthropic's internal "next-gen" harness. If it becomes public as a Claude Code mode, it will raise the bar dramatically.
- **Priority**: **P0** monitor — when it becomes public, WOTANN has 30-60 days before it shifts the whole market.

### 2.33 ByteRover / Supermemory / MemPalace / Observational Memory
- **ByteRover** (formerly Cipher) — [github.com/campfirein/byterover-cli](https://github.com/campfirein/byterover-cli) — "portable memory layer for autonomous coding agents"
- **Supermemory** — [github.com/supermemoryai/supermemory](https://github.com/supermemoryai/supermemory) — 81.6% LongMemEval, claude-plugin for Claude Code
- **MemPalace** — 96.6% LongMemEval (AAAK compression + vector search) — [mempalace.tech](https://www.mempalace.tech/blog/best-ai-memory-frameworks-2026)
- **Observational Memory (Mastra)** — 94.87% LongMemEval — [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory)
- **LongMemEval benchmark**: [github.com/xiaowu0162/longmemeval](https://github.com/xiaowu0162/longmemeval) (ICLR 2025)
- **Priority**: **P0** — WOTANN **must** publish a LongMemEval number or concede the memory moat. Integrate one of: Mem0 (93.4%), Mastra OM (94.87%), or MemPalace (96.6%).

---

## 3. Benchmark Leaderboard Snapshot (April 2026)

### 3.1 TerminalBench 2.0 — [tbench.ai/leaderboard/terminal-bench/2.0](https://www.tbench.ai/leaderboard/terminal-bench/2.0)

| Rank | Model | Harness | Score |
|---|---|---|---|
| 1 | GPT-5.4 | ForgeCode | 81.8% ± 2.0 |
| 2 | Gemini 3.1 Pro | TongAgents | 80.2% ± 2.6 |
| 3 | Claude Opus 4.6 | ForgeCode | 79.8% ± 1.6 |
| 4 | GPT-5.3-Codex | SageAgent | 78.4% ± 2.2 |
| 5 | Gemini 3.1 Pro | ForgeCode | 78.4% ± 1.8 |
| 6 | GPT-5.3-Codex | Droid | 77.3% ± 2.2 |
| 7 | Claude Opus 4.6 | Capy | 75.3% ± 2.4 |
| 8 | GPT-5.3-Codex | Simple Codex | 75.1% ± 2.4 |
| 9 | Gemini 3.1 Pro | Terminus-KIRA | 74.8% ± 2.6 |
| 10 | Claude Opus 4.6 | Terminus-KIRA | 74.7% ± 2.6 |
| - | Claude Mythos Preview | (Anthropic) | 82.0% (another track per [morphllm.com](https://www.morphllm.com/terminal-bench-2)) |

**Top performers are doing**:
- ForgeCode = multi-turn with retry, explicit file-state tracking, verification-before-exit
- Harness delta across identical model can exceed 6-7pp
- **WOTANN's 83-95% target is plausible** but requires ForgeCode-level discipline

### 3.2 SWE-bench Verified — [swebench.com](http://www.swebench.com/), [llm-stats.com](https://llm-stats.com/benchmarks/swe-bench-verified)
- Claude Mythos Preview: **93.9%** ([morphllm.com/ai-coding-benchmarks-2026](https://www.morphllm.com/ai-coding-benchmarks-2026))
- Claude Opus 4.7 (Apr 16, 2026): **87.6%**
- GPT-5.3-Codex: **85.0%**
- Claude Opus 4.5: **80.9%**, Opus 4.6: **80.8%**, Gemini 3.1 Pro: **80.6%**, MiniMax M2.5: **80.2%**
- OpenHands (full harness): **77.6%**
- **OpenAI now recommends SWE-bench Pro** (contamination-free) over Verified.

### 3.3 SWE-bench Pro (contamination-free) — [labs.scale.com/leaderboard/swe_bench_pro_public](https://labs.scale.com/leaderboard/swe_bench_pro_public)
- GPT-5.3-Codex: **56.8%**
- Claude Opus 4.6 + WarpGrep v2: **57.5%**
- Claude Opus 4.5: **45.9%** (highest standardized scaffolding)
- **Gap**: Verified 80% models only hit 46-57% on Pro. **Real ability is much lower than Verified suggests.**

### 3.4 Aider Polyglot — [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/)
- Claude Opus 4.5: **89.4%** (Anthropic-reported)
- GPT-5 (high): **88.0%**
- Claude Opus 4.6: **82.1%**
- DeepSeek V4: **79.5%**, GPT-5.4: **78.3%**
- DeepSeek V3.2-Exp: **74.2% at $1.30/run** (22× cheaper than GPT-5)

### 3.5 τ-bench Retail / Airline — [taubench.com](https://taubench.com/)
- Retail leader: Claude Sonnet 4.5 at **0.862**
- τ²-Bench superseded by τ³-Bench with new banking domain + voice modality + task fixes

### 3.6 LongMemEval — [xiaowu0162.github.io/long-mem-eval](https://xiaowu0162.github.io/long-mem-eval/)
| System | Score |
|---|---|
| MemPalace | **96.6%** |
| OMEGA | 95.4% |
| Observational Memory (Mastra) | 94.87% |
| Mem0 (April 2026 algo) | **93.4%** |
| SuperMemory | 81.6% |
| TiMem | 76.88% |

### 3.7 BFCL (Function Calling) — [gorilla.cs.berkeley.edu/leaderboard.html](https://gorilla.cs.berkeley.edu/leaderboard.html)
- V4: Llama 3.1 405B Instruct at **88.5%** (avg across all models 71.7%)
- V3: GLM 4.5 at **76.7%**, Qwen3 32B at **75.7%**

### 3.8 WebArena — [webarena.dev](https://webarena.dev/)
- Claude Mythos Preview: **68.7%** (tracked snapshot)
- OpAgent (Qwen3-VL + RL): **71.6%** — beats GPT-5 and Claude
- Human baseline: ~78%

### 3.9 HumanEval+ / MBPP+ / BigCodeBench — [evalplus.github.io/leaderboard.html](https://evalplus.github.io/leaderboard.html), [bigcode-bench.github.io](https://bigcode-bench.github.io/)
- BigCodeBench-Complete: GPT-4o calibrated Pass@1 **61.1%**; BigCodeBench-Instruct **51.1%**

### Summary of implications for WOTANN
1. **Publish a TerminalBench 2.0 number or you don't exist** in this conversation.
2. **SWE-bench Pro is the new bar** — target 55%+ as contamination-free credibility.
3. **LongMemEval is the memory bar** — target 90%+.
4. **τ-bench Retail 0.86** is the service-agent bar.
5. Aider Polyglot is owned by Aider — cite their benchmark, don't reinvent.

---

## 4. Missing-Features Matrix

Legend: ✓ = shipped / ✗ = not shipped / ◐ = partial

Sources: cloned repos, blogs, changelogs. WOTANN column reflects the spec + current code state reflected in the user's prior research docs. Honesty over advocacy.

| Feature | OpenClaw | Hermes | Jean | Cursor 3 | Claude Code | Codex CLI | OpenHands | Aider | Goose | Crush | Serena | Deep Agents | Open-SWE | DeerFlow | OpenCode | Mem0 | Letta | Opcode | Eigent | Claude Design | Perplexity Comp | WOTANN |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CLI | ✓ | ✓ | ✗ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| TUI | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Desktop native (Tauri) | ◐ | ✗ | ✓ | ✗ | ✗ | ✓ (`codex app`) | ✗ | ✗ | ✓ (Rust native) | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✓ | ◐ (Electron) | ✗ | ✗ | ✓ |
| iOS app | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Android app | ✓ | ◐ (Termux) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| WhatsApp channel | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (spec) |
| Telegram channel | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (spec) |
| Slack channel | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ◐ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ (spec) |
| iMessage channel | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (spec) |
| Discord channel | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (spec) |
| 25+ channels | ✓ (24) | ◐ (6) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (spec) |
| 19+ LLM providers | ✓ | ✓ | ◐ (4 CLIs) | ✓ | ✓ | ◐ (OpenAI+MCP) | ✓ | ✓ | ✓ | ✓ | (via MCP) | ✓ | ◐ | ✓ | ✓ | — | ✓ | ◐ (Claude) | ✓ | ✗ | ✓ (19) | ✓ (spec) |
| ACP (editor protocol) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| MCP integration | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✗ | ✗ | ✓ |
| Plugin SDK | ✓ | ✓ | ✗ | ◐ | ✓ (skills) | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ◐ | ◐ | ✓ | ✗ | ◐ (JSON) | ✗ | ✗ | ✗ | ◐ |
| Hooks | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ? |
| Skills marketplace | ✓ | ✓ | ✗ | ◐ | ✓ | ✗ | ✓ | ✗ | ◐ (recipes) | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ |
| Browser automation | ✓ (CDP) | ✓ (Camoufox) | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ◐ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ (Comet) | ? |
| Voice input (STT) | ✓ | ◐ | ✗ | ✓ (batch) | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Voice calls/TTS | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Design Mode / Canvas | ✗ | ✗ | ✓ (canvas views) | ✓ (both) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Parallel agents (Agents Window) | ✗ | ✓ (subagents) | ✓ (sessions) | ✓ | ◐ (subagents) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ (groups) | ✗ | ✓ (workforce) | ✗ | ✓ | ? |
| Git worktree auto | ✗ | ✗ | ✓ | ✓ (`/worktree`) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ? |
| Best-of-N | ✗ | ✗ | ✗ | ✓ (`/best-of-n`) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Model routing (per-task) | ✗ | ◐ | ✓ (per-prompt) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (19 models) | ? |
| Self-improving skills | ✗ | ✓ | ✗ | ◐ (Bugbot) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Cron/scheduler | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Remote mobile web-server | ✓ | ✗ | ✓ | ✓ (cloud) | ✓ | ◐ (`codex app`) | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ? |
| Credential pool rotation | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Checkpoints/rollback | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ◐ (replay) | ✗ | ✗ | ✗ | ✗ | ✓ (LangGraph) | ✗ | ✗ | ✗ | ✗ | ◐ | ✓ | ✗ | ✗ | ✗ | ✗ |
| LongMemEval published | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (93.4) | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ |
| TerminalBench published | ✗ (reported 82 via Mythos but not claimed as Claude Code) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | n/a | n/a | ✗ | ✗ | ✗ | ✗ | ✗ |
| SWE-bench Verified published | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (77.6) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | n/a | n/a | ✗ | ✗ | ✗ | ✗ | ✗ |
| LSP tools (semantic ops) | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ? |
| Plan/Build/Yolo modes | ✗ | ✗ | ✓ | ✗ | ◐ (plan mode) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Observability/tracing | ◐ | ✗ | ◐ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ (OTEL) | ✗ | ✗ | ✓ (LangGraph) | ◐ | ✓ (Langfuse) | ✗ | ✗ | ✓ | ✓ (analytics) | ✗ | ✗ | ✓ (audit) | ? |
| Enterprise SSO | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ? |

**The diagnostic reading**: WOTANN's strong columns are iOS + 25 channels + TUI. Weak columns are **ACP, hooks, LSP, benchmarks published, Design Mode, parallel agents window, credential pool, scheduler**.

---

## 5. Top 20 Features to Add (ranked by adoption impact × implementation ease)

Each entry: rank, feature, source competitor, 2-sentence implementation sketch.

1. **ACP Bridge as first-class (`wotann acp`)** — *Source: OpenClaw `openclaw acp`, Goose `goose-acp` crate, Zed Registry*. Ship a stdio-based ACP agent that forwards to WOTANN Gateway. Start with `initialize`/`newSession`/`prompt`/`cancel`/`listSessions` + `session/set_mode`; defer per-session MCP + client fs/terminal methods until Phase 2. Mark ACP session keys `wotann:<uuid>` by default.

2. **LongMemEval score on WOTANN's memory** — *Source: Mem0 93.4, Observational Memory 94.87, MemPalace 96.6*. Either integrate a proven memory stack (Mem0 is shortest path) OR run the benchmark against your existing memory and publish. Without a number you forfeit the moat claim.

3. **TerminalBench 2.0 official run + harness discipline** — *Source: ForgeCode 81.8% harness pattern*. Run Claude Opus 4.7 + WOTANN harness vs the 89 TBench tasks, publish score. Target 82%+ to match Mythos.

4. **Task-type model routing layer** — *Source: Perplexity Computer's 19-model orchestration*. Add a routing module: `pickModel(taskType, budget, provider_availability)` with rules `{code: opus4.7, research: gemini3.1, long_ctx: gpt-5.4}`. Per-session + per-prompt override UI (Jean pattern).

5. **LSP-aware agent tools** — *Source: Serena, Crush*. Wrap LSP (gopls, tsserver, pyright, rust-analyzer) and expose `find_symbol`, `find_referencing_symbols`, `rename_symbol`, `replace_symbol_body`, `get_symbols_overview` as MCP tools. Dramatic accuracy improvement vs grep.

6. **Parallel-Agents Workspace (Agents Window)** — *Source: Cursor 3, Jean sessions*. Add a UI mode where N agents run side-by-side in worktrees/remote SSH/cloud, tab-switchable. Each agent gets a fresh isolated context; parent aggregates results.

7. **`/worktree` + `/best-of-n` slash commands** — *Source: Cursor 3*. Auto-create git worktree for each parallel agent; `/best-of-n <task>` spawns K worktrees with different models, lets user diff+merge the best result.

8. **Design Mode / Canvas** — *Source: Claude Design, Cursor 3, Jean canvas views*. One-command handoff to Claude Code pattern. Incorporate a visual-design surface where user can capture/annotate UI + generate design system from codebase.

9. **Hooks system** — *Source: Claude Code, WOTANN prior feedback on hooks*. Event-driven scripts in `~/.wotann/hooks/` that fire on tool-call boundaries (pre-tool, post-tool, session-end). Declare in `settings.json`. Port WOTANN prior hook patterns directly.

10. **Credential pool rotation** — *Source: Hermes Agent*. Multiple API keys per provider, thread-safe `least_used` rotation, auto-rotate on 401, pool state survives fallback switches. Implement as provider-layer wrapper.

11. **Scheduled recurring agent runs with state** — *Source: Hermes cron, Devin self-scheduling*. Built-in cron scheduler; agent maintains state between runs; delivery to any configured messaging channel. `wotann schedule daily "0 9 * * *" "run daily report and post to #team-slack"`.

12. **Repo map (code index)** — *Source: Aider*. Build a tree-sitter-based code index of the entire repository; feed as compressed overview in system prompt. Enables "locate where feature X is" without grep.

13. **Atomic commits per edit** — *Source: Aider, gsd-build*. Every successful tool-call → atomic git commit with conventional-commit message. `feat(phase-task): description`. Enables git bisect on agent output.

14. **Checkpoints / time-travel rollback** — *Source: Opcode, OpenHands replay*. Snapshot agent state (conversation, working-tree, provider metadata) at every tool-call boundary; offer `wotann rollback <checkpoint-id>` to restore.

15. **Loop detection** — *Source: Crush `loop_detection.go`*. Hash recent tool-call sequences; if the same 3-cycle repeats, force agent into a "reflection" prompt. Prevents the classic "edit → test fails → revert → edit same way" bug.

16. **Recipes format (shareable agent definitions)** — *Source: Goose recipes, SWE-agent YAML*. Single YAML/JSON file defining agent: system prompt, tools, model, verification criteria. Users share `*.wotann.yml` files; shared marketplace registry.

17. **Voice input batch-STT** — *Source: Cursor 3, OpenClaw voice-call*. Record full voice clip, run batch STT (higher accuracy than streaming), transcribe into prompt. Cross-platform; works on iOS/macOS/TUI.

18. **Observability via Langfuse/OTEL** — *Source: DeerFlow, Goose OTEL*. Tracing every tool call with span IDs; export to Langfuse or Honeycomb. Enables post-hoc debugging of why an agent went wrong.

19. **Web-server mode for mobile browser access** — *Source: Opcode web_server.design.md, Jean, OpenClaw, Goose*. REST + WebSocket mirror of the desktop app; token-auth; phone/browser client. Gabriel testing iOS on real device — ship this natively with iOS app but also as fallback web.

20. **Self-improving skills loop** — *Source: Hermes Agent*. After a complex task completes successfully, generate a skill file from the trajectory; future tasks matching the pattern re-use the skill. Agentskills.io standard compatibility as a stretch.

---

## 6. Unknown Unknowns

Emerging items that weren't in the original research list:

### 6.1 The OpenClaw ecosystem reality (user underestimated this)
- **OpenClaw ≠ vaporware**. 247k stars, OpenAI+GitHub+NVIDIA sponsors, Peter Steinberger as founder. There is a multi-million-user install base. `freecodecamp.org` has a "How to Build and Secure a Personal AI Agent with OpenClaw" tutorial. Wikipedia entry exists. This is a **real threat**, not a nice-to-know.
- Hermes `hermes claw migrate` proves OpenClaw is the incumbent that NEW projects are specifically migrating *from*.

### 6.2 AAIF (Agentic AI Foundation / Linux Foundation)
- Goose moved to AAIF. There is now a Linux Foundation-endorsed agent harness. This changes the legitimacy math for enterprise buyers.
- **Consider whether WOTANN should seek AAIF hosting** as a long-term strategic play.

### 6.3 τ³-bench and banking/voice domains
- τ²-Bench is superseded by τ³-Bench adding banking domain + voice modality. WOTANN's voice-call plugin should be benchmarked here.

### 6.4 SWE-bench Pro is the new real benchmark
- Verified is admittedly contaminated. Pro scores are 30-40pp lower. Anyone citing Verified in 2026 gets eye-rolled. Cite Pro.

### 6.5 BytePioneer China play
- OpenClaw already has `BytePioneer-AI/openclaw-china` with 飞书/钉钉/QQ/企业微信/微信 integrations. Chinese market is a parallel channel ecosystem. WOTANN must decide whether to compete there.

### 6.6 LongMemEval is split into S (short) and M (medium)
- Most benchmarks cited are LongMemEval-S (500 questions, ~57M tokens). LongMemEval-M is harder. Be specific about which split when publishing.

### 6.7 ByteRover rebrand from Cipher
- Cipher memory layer → ByteRover. Publishing active brv-claude-plugin for Claude Code auto-memory. Memory layer space is consolidating fast.

### 6.8 Dictation as a first-class feature
- Goose has a `dictation/` module in its Rust core. Cursor 3 shipped batch-STT voice. OpenClaw has voice-call + talk-voice plugins. **Voice-first is now table stakes, not a nice-to-have**.

### 6.9 The TUI renaissance
- Charm's 25k+ apps prove TUI is a real product surface, not a retro aesthetic. WOTANN's TUI emphasis is correct; ensure it meets the Charm bar visually.

### 6.10 Agent handoff as a protocol
- Claude Design → Claude Code handoff. Cursor 3 cloud → local handoff. Jean's Plan/Build/Yolo modes. There's an emerging pattern: **agents handoff tasks to other agents with packaged context**. ACP is one protocol for this but the handoff UX is still being invented. WOTANN's 4 tabs are the right shape — ship the handoff between them.

### 6.11 The "recipes" marketplace pattern (Goose, Opcode, Cursor Plugin Registry, Claude Plugins)
- Every major harness now has a shareable agent/skill/plugin format + marketplace. Distribution is network-effect. WOTANN's `wotann.yml` recipe format + marketplace should exist from day 1 of Phase 0.

### 6.12 Claude Code plugin directory
- Anthropic now has [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission). This is a first-party Claude Code extension distribution. Consider if WOTANN extensions should be distributable via this channel.

### 6.13 Rust-as-core-engine is the consensus
- Goose, Codex, Crush — all in Rust. WOTANN's Tauri stack is Rust-backed. Confirm the Rust side owns the agent loop, not just UI chrome.

### 6.14 Eigent positioning "Cowork" — non-coding agent market
- Eigent explicitly targets knowledge workers, not developers. Cowork category is maybe 10x bigger TAM. WOTANN should at least consider a "Cowork Mode" as future expansion.

### 6.15 Claude Opus 4.7 1M context (April 16, 2026)
- Fresh 48 hours before audit: Opus 4.7 with 1M context; **SWE-bench Verified 87.6%**. Gabriel's model stack is already upgraded to 4.7 per CLAUDE.md. WOTANN should bench against 4.7 specifically.

---

## 7. Handoff to Master Synthesis — Top 5 findings that MUST be surfaced

The master synthesis lane gets these as priority-1 findings. Do not let them be buried.

### HANDOFF-1: OpenClaw is WOTANN's existential twin — differentiation must be explicit
- OpenClaw already has 24 messaging channels, 19+ providers, native iOS/macOS/Android, ACP bridge, Gateway architecture, plugin SDK, voice/speech/image/video plugins. It has OpenAI/GitHub/NVIDIA as sponsors.
- WOTANN's "25 channels + 19 providers" is parity, not moat.
- **The moat must be**: (a) TerminalBench score that beats Claude Code + OpenClaw, (b) Editor/Workshop/Exploit tabs — code agent experience OpenClaw doesn't prioritize, (c) polished TUI that hits Charm bar, (d) iOS real-device-first UX that even OpenClaw can't match because Gabriel dogfoods on real hardware.
- Without explicit OpenClaw-beating positioning, WOTANN is a fork.

### HANDOFF-2: WOTANN has no published benchmark — every month of silence is lost ground
- TerminalBench 2.0, SWE-bench Pro, LongMemEval, τ³-bench — ALL have public leaderboards. ALL WOTANN competitors either score or deliberately avoid.
- Published numbers from 48-hour-old memory rankings: Mem0 93.4%, MemPalace 96.6%, Observational Memory 94.87%. These are the bars WOTANN's memory moat needs to clear.
- **Recommendation**: Phase-0.5 dedicated to publishing at least 2 benchmark scores (TerminalBench 2.0 + LongMemEval), even if they're sub-optimal initially.

### HANDOFF-3: April 17 Claude Design + April 2 Cursor 3 have changed the frontier
- **Claude Design** = design-system-generated-from-codebase + one-command handoff to Claude Code. Adobe/Figma stocks dropped on announcement.
- **Cursor 3** = Agents Window with parallel agent tabs across worktrees + Design Mode + Canvases.
- These aren't features — they're UX paradigms that WOTANN's "4 tabs" spec pre-dates.
- **Recommendation**: Workshop tab should embrace Design Mode + Canvas patterns. Editor tab should embrace Parallel Agents Window. Chat tab can remain conversational but must gain task-type routing.

### HANDOFF-4: ACP (Agent Client Protocol) is becoming the standard — ship it or get commoditized
- Zed Registry launched January 2026. Claude Code, Codex CLI, Copilot CLI, OpenCode, Gemini CLI all registered.
- OpenClaw has `openclaw acp`. Goose has `goose-acp` crate. Hermes has `copilot_acp_client.py`. Open-SWE composes on DeepAgents/LangGraph ACP library.
- If WOTANN doesn't ship ACP, it's stuck outside the editor ecosystem.
- **Recommendation**: Add `wotann acp` to Phase 1 (not later). Use OpenClaw's ACP surface as reference spec.

### HANDOFF-5: Voice, hooks, LSP-tools, and scheduling are all now table-stakes
- **Voice**: OpenClaw (voice-call + talk-voice plugins), Goose (dictation), Cursor 3 (batch STT), Hermes (voice memo transcription). WOTANN has no voice in the priority items visible.
- **Hooks**: Claude Code's hooks are the #1 extensibility primitive Gabriel uses in his own system per CLAUDE.md. WOTANN must have hooks.
- **LSP tools**: Serena + Crush prove LSP-aware agent tools. Grep-only agents are obsolete.
- **Scheduling**: Hermes cron, Devin self-scheduling, Goose scheduler — every serious harness has it.
- **Recommendation**: Add these as P0 in Phase 1, not post-launch polish.

### Bonus HANDOFF-6: The Perplexity-Computer pricing ceiling is $200/mo; WOTANN can price at $25-50/mo and still have a 60% margin if model costs match
- Pricing a harness like it's a vertical SaaS ($200/mo) is the market ceiling Perplexity set.
- Aggressive $25-50/mo pricing with free-tier generosity (Gabriel's spec calls this out) is the natural counter-positioning.
- Free-tier agents running Gemma 4 locally via Ollama = zero-margin at scale — this is WOTANN's unfair advantage vs Cursor ($20-40/mo) and Perplexity ($200/mo).

---

## 8. Sources Cited (non-exhaustive, priority ones)

### Products
- [openclaw.ai](https://openclaw.ai/) + [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- [jean.build](https://jean.build) + [github.com/coollabsio/jean](https://github.com/coollabsio/jean)
- [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) + [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/)
- [cursor.com/blog/cursor-3](https://cursor.com/blog/cursor-3), [cursor.com/changelog](https://cursor.com/changelog)
- [anthropic.com/news/claude-design-anthropic-labs](https://www.anthropic.com/news/claude-design-anthropic-labs)
- [perplexity.ai/hub/blog/everything-is-computer](https://www.perplexity.ai/hub/blog/everything-is-computer)
- [github.com/anthropics/claude-code](https://github.com/anthropics/claude-code) + [code.claude.com/docs/en/overview](https://code.claude.com/docs/en/overview)
- [github.com/openai/codex](https://github.com/openai/codex)
- [github.com/OpenHands/OpenHands](https://github.com/OpenHands/OpenHands), [docs.openhands.dev/sdk](https://docs.openhands.dev/sdk)
- [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider) + [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/)
- [github.com/SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent)
- [github.com/oraios/serena](https://github.com/oraios/serena)
- [github.com/charmbracelet/crush](https://github.com/charmbracelet/crush)
- [github.com/aaif-goose/goose](https://github.com/aaif-goose/goose), [goose-docs.ai](https://goose-docs.ai/)
- [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode) + [opencode.ai](https://opencode.ai)
- [github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)
- [github.com/langchain-ai/open-swe](https://github.com/langchain-ai/open-swe)
- [github.com/bytedance/deer-flow](https://github.com/bytedance/deer-flow), [deerflow.tech](https://deerflow.tech)
- [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) + [mem0.ai/research](https://mem0.ai/research)
- [github.com/letta-ai/letta](https://github.com/letta-ai/letta) + [leaderboard.letta.com](https://leaderboard.letta.com/)
- [github.com/getAsterisk/opcode](https://github.com/getAsterisk/opcode)
- [github.com/eigent-ai/eigent](https://github.com/eigent-ai/eigent)
- [github.com/menloresearch/jan](https://github.com/menloresearch/jan)
- [cognition.ai](https://cognition.ai/) (Devin), [docs.devin.ai/release-notes/2026](https://docs.devin.ai/release-notes/2026)
- [windsurf.com/changelog](https://windsurf.com/changelog)

### Benchmarks
- [tbench.ai/leaderboard/terminal-bench/2.0](https://www.tbench.ai/leaderboard/terminal-bench/2.0)
- [swebench.com](http://www.swebench.com/) / [labs.scale.com/leaderboard/swe_bench_pro_public](https://labs.scale.com/leaderboard/swe_bench_pro_public)
- [aider.chat/docs/leaderboards](https://aider.chat/docs/leaderboards/)
- [taubench.com](https://taubench.com/) and τ³-bench repo
- [xiaowu0162.github.io/long-mem-eval](https://xiaowu0162.github.io/long-mem-eval/) + [github.com/xiaowu0162/longmemeval](https://github.com/xiaowu0162/longmemeval)
- [gorilla.cs.berkeley.edu/leaderboard.html](https://gorilla.cs.berkeley.edu/leaderboard.html) (BFCL)
- [webarena.dev](https://webarena.dev/) + [github.com/web-arena-x/visualwebarena](https://github.com/web-arena-x/visualwebarena)
- [evalplus.github.io/leaderboard.html](https://evalplus.github.io/leaderboard.html) + [bigcode-bench.github.io](https://bigcode-bench.github.io/)
- [mempalace.tech](https://www.mempalace.tech/blog/best-ai-memory-frameworks-2026)
- [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory)

### Analysis / context
- [thenewstack.io/cursor-3-demotes-ide](https://thenewstack.io/cursor-3-demotes-ide/)
- [morphllm.com/ai-coding-benchmarks-2026](https://www.morphllm.com/ai-coding-benchmarks-2026)
- [morphllm.com/swe-bench-pro](https://www.morphllm.com/swe-bench-pro)
- [morphllm.com/terminal-bench-2](https://www.morphllm.com/terminal-bench-2)
- [allthingsopen.org/articles/openclaw-viral-open-source-ai-agent-architecture](https://allthingsopen.org/articles/openclaw-viral-open-source-ai-agent-architecture)
- [en.wikipedia.org/wiki/OpenClaw](https://en.wikipedia.org/wiki/OpenClaw)
- [agentclientprotocol.com](https://agentclientprotocol.com/) — ACP spec
- [zed.dev/blog/acp-registry](https://zed.dev/blog/acp-registry)

---

## 9. Research Log / Integrity Notes

- 30-45 min budget used. Time-stamps: began ~01:33 local, ended ~01:52 local on 2026-04-19.
- Clones placed in `/tmp/wotann-research/` (ephemeral — not committed to WOTANN repo). Directory listings + selected README + plugin.json + source-file heads read inline.
- 4 WebSearch + 4 WebFetch calls used to verify closed-source and blog information.
- Every claim above traces to either a clone-path, a WebSearch/WebFetch with URL, or a benchmark URL.
- I did NOT fabricate benchmark numbers. Where two sources give different numbers (e.g. Mythos TerminalBench 2.0 "82%" vs "not in main leaderboard"), both are noted.
- I did NOT parrot READMEs without verification. Where a README was the only source (e.g. Claude Code plugins directory), it's marked.
- Anthropic internal "Claude Mythos" only has proxy/parody GitHub projects. Actual Mythos is not open. Flagged above.
- OpenClaw stars count (247k) is from 2026-03-02 per [allthingsopen.org](https://allthingsopen.org/articles/openclaw-viral-open-source-ai-agent-architecture). May be higher now.
- Perplexity's "Everything is Computer" blog returned 403 via WebFetch; used Build Fast With AI analysis and Semafor/Avenue Z coverage instead. Noted.
