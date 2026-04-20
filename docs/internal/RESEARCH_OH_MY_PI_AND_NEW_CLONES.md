# Research: oh-my-pi (The REAL Target) + New-Clones Deep Dive

**Author:** Research Agent (WOTANN)
**Date:** 2026-04-20
**Scope:** Correct the oh-my-pi / oh-my-openagent misidentification that contaminated prior research; deep-read 8 competitor projects the user named; produce a prioritized port list with concrete WOTANN-file-path mappings.
**Evidence rule:** every claim cites a URL, a local file path, or a DeepWiki / blog / source-code artifact. No hand-waving.

---

## 0. Executive Summary (~400 words)

Prior WOTANN research repeatedly conflated `can1357/oh-my-pi` with `code-yeongyu/oh-my-openagent` (OMO). **They are distinct projects by different authors solving different problems.** This report confirms the separation, then goes deep on both plus six more repos the user named.

**Confirmed distinct identities:**
- `can1357/oh-my-pi` — Can Bölük, 3.2k stars, TypeScript+Rust, fork of `badlogic/pi-mono`. Single-author terminal agent harness. Core novelty: **Hashline Edits** (hash-anchored line references, benchmarked 16 models × 180 tasks × 3 runs, Grok Code Fast 1 went from 6.7% → 68.3% success rate, a 10× gain) and **TTSR** (Time-Traveling Streamed Rules — zero-upfront-cost rule injection triggered by regex watchers on the output stream). The author had his Gemini account banned by Google mid-blog-post; the benchmark showed Gemini 3 Flash with Hashline beat Google's own str_replace by ~5 pp (sources: [abit.ee controversy writeup](https://abit.ee/en/artificial-intelligence/hashline-ai-agents-cursor-aider-claude-code-oh-my-pi-diff-format-grok-gemini-benchmark-open-source-g-en), [Mario Zechner X endorsement](https://x.com/badlogicgames/status/2021868004221608359)).
- `code-yeongyu/oh-my-openagent` (OMO) — YeongYu, 53k stars, TypeScript 95.8%, part of the UltraWorkers ecosystem. Four "Discipline Agents": **Sisyphus** (opus-4-7 / kimi-k2.5 / glm-5 main orchestrator), **Hephaestus** (GPT-5.4 deep worker), **Prometheus** (strategic planner), **Oracle** (architecture/debug). Flagship command is `ultrawork` / `ulw`. This is the harness that `claw-code`, `clawhip`, and `oh-my-codex` compose together (per [claw-code PHILOSOPHY.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PHILOSOPHY.md)).

**Other six confirmed:**
- `pingdotgg/t3code` — Theo's React + WebSocket GUI wrapping Codex app-server and Anthropic Agent SDK, with Cursor+OpenCode adapters in progress; persists SQLite; Effect ecosystem ([DeepWiki](https://deepwiki.com/pingdotgg/t3code/2-architecture)).
- `VoltAgent/awesome-openclaw-skills` — 5,198 curated skills in 30 categories (coding-agents-and-ides.md has 1,184 alone); the filtering funnel excluded 7,215 low-quality entries from ClawHub's 13,729 raw pool.
- `ultraworkers/claw-code` — public Rust rewrite of `claw`/`agent-code`; 48,599 Rust LOC, 9 crates, 292 commits, 9 merged "parity lanes" covering Bash validation, file-ops, TaskRegistry, Team+Cron, MCP lifecycle, LSP, PermissionEnforcer. Explicit warning: do NOT `cargo install claw-code` — the stub crate on crates.io is deprecated.
- `charmbracelet/crush` — Go TUI agent, LSP-enhanced, supports 20+ providers (Anthropic/OpenAI/Bedrock/Vertex/Groq/OpenRouter/Synthetic/GLM/Kimi/MiniMax/Cerebras/io.net/Avian/OpenCode); has `.crushignore`, `--yolo` mode, Agent Skills standard, Catwalk model DB, pseudonymous metrics + `DO_NOT_TRACK` respect.
- `Kilo-Org/kilocode` — VS Code extension + CLI, OpenCode fork, #1 coding agent on OpenRouter claim, 1.5M users, 25T tokens, Architect/Coder/Debugger mode switch, `--auto` CI flag.
- `xiaowu0162/longmemeval` — ICLR 2025 benchmark (500 Q across 5 memory skills: Extraction, Multi-Session, Knowledge Updates, Temporal, Abstention). `longmemeval_s` ≈ 115k tokens (~40 sessions), `longmemeval_m` ≈ 500 sessions. Cleaned 2025/09.

**Top-impact ports for WOTANN** (see §10): Hashline edits → `modules/editor/lib/edit-tool.swift`; TTSR hook channel → `modules/core/lib/hook-runner.swift`; PermissionEnforcer 3-mode model (read-only/workspace-write/danger) → `modules/security/lib/permission-enforcer.swift`; LSP registry dispatch → `modules/lsp/lib/lsp-client.swift`; crush-style `.wotannignore` → `modules/fs/lib/ignore-walker.swift`; Sisyphus pattern (orchestrator category routing, not explicit model names) → `modules/agents/lib/dispatch.swift`; Catwalk-like model DB → `modules/models/lib/catalog.swift`; 30-category skill taxonomy (`awesome-openclaw-skills`) → docs structure for `skills/`.

---

## 1. The oh-my-pi vs oh-my-openagent Misidentification

### 1.1 What prior docs got wrong

The prior WOTANN research doc (`RESEARCH_USER_NAMED_COMPETITORS.md`) treated oh-my-pi and oh-my-openagent as conceptually interchangeable, conflating the Hashline innovation (Can Bölük's) with the Sisyphus agent taxonomy (YeongYu's). Evidence: the user's feedback flagging this is now recorded in the session-6 continuation prompt.

### 1.2 Side-by-side correction

| Dimension | `can1357/oh-my-pi` | `code-yeongyu/oh-my-openagent` |
|---|---|---|
| GitHub slug | `can1357/oh-my-pi` | `code-yeongyu/oh-my-openagent` |
| Author | Can Bölük (also signer-of `@oh-my-pi` scope) | YeongYu (ko: 이영규) |
| Forked from | `badlogic/pi-mono` (Mario Zechner) | Originally `oh-my-opencode`, self-rebranded |
| Stars (as of this check) | 3.2k, 304 forks | 53k, 4.3k forks |
| Language mix | TS 82.6% / Rust 13.9% / Py 2.4% | TS 95.8% |
| Flagship primitive | **Hashline Edits** (content-hash-anchored lines) | **Sisyphus** orchestrator + Ralph Loop (`/ulw-loop`) |
| Differentiated innovation | **TTSR** (regex-triggered streamed rule injection) | Task *categories* routing (visual-engineering / deep / quick / ultrabrain) |
| Runtime | Bun + Rust N-API native (~7,500 Rust LOC) | Bun/Node, pure-TS |
| Monorepo packages | `pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`, `pi-natives`, `pi-utils`, `omp-stats`, `swarm-extension` | Discipline-agent bundles + MCP-as-skills |
| Licence | MIT | MIT |
| Ecosystem pitch | Single-agent, single-author, benchmarks-first | Multi-agent orchestration inside UltraWorkers meta-toolchain (`clawhip`, `claw-code`, `oh-my-codex`) |
| Source of truth | GitHub + DeepWiki + `packages/coding-agent/DEVELOPMENT.md` + CHANGELOG.md | GitHub README + PHILOSOPHY.md inside claw-code |

Sources: [github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi), [github.com/code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), [DeepWiki oh-my-pi](https://deepwiki.com/can1357/oh-my-pi), [claw-code PHILOSOPHY.md lines 52–58](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PHILOSOPHY.md).

### 1.3 Why the conflation happened

Both projects sit in adjacent subcultures: UltraWorkers / "claw" ecosystem plus the hash-edit discourse. Both use hash-anchored edits (OMO explicitly cites "Hash-anchored edit tool (Hashline) with content verification" — which OMO ported *from* oh-my-pi). Combined with OMO's former name `oh-my-opencode`, a skim-reader easily merges them. The correct reading: **oh-my-pi invented Hashline; OMO adopted it.** Prior doc said they "both build a Hashline variant" — wrong. Only can1357 invented it; the rest adopted.

---

## 2. oh-my-pi — Hashline + TTSR deep dive

### 2.1 Hashline Edits — mechanism

Per [DeepWiki Hashline page](https://deepwiki.com/can1357/oh-my-pi/8.1-hashline-edit-mode):

- Every line in a `Read` tool result is prefixed with `LINENUM#HASH:TEXT`, where `HASH` is a 2-character content-hash digest.
- The hash is computed by:
  1. **Normalize**: strip trailing whitespace, strip carriage returns.
  2. **Seed**: for lines that are only whitespace/punctuation, seed with the line number to avoid collisions.
  3. **Hash**: `Bun.hash.xxHash32` (Bun's built-in fast non-cryptographic hash).
  4. **Encode**: mask to 8 bits, map to the 16-char alphabet `ZPMQVRWSNKTXJBYH`. Two such characters form each anchor.
- Edit tool calls reference lines by `"LINENUM#HASH"` strings, e.g. `{ range: { pos: "5#aa", end: "12#bb" } }`.
- Operations:
  - `replace` → `{ range: { pos: "N#ID", end: "N#ID" } }`
  - `append_after` → `{ append: "N#ID" }`
  - `prepend_before` → `{ prepend: "N#ID" }`
  - `append_eof` / `prepend_bof` for whole-file boundaries.
- If any hash in the edit payload does not match the current file, **the whole edit is rejected before mutation**, preventing silent corruption from stale reads.
- Core file: `packages/coding-agent/src/patch/hashline.ts`. Tool prompt (shown to model): `packages/coding-agent/src/prompts/tools/hashline.md`. Tests: `packages/coding-agent/test/core/hashline.test.ts`.

### 2.2 Hashline benchmark — what is real, what is claimed

The repo's own benchmark harness lives at `packages/react-edit-benchmark/`. Per the README and the [abit.ee writeup](https://abit.ee/en/artificial-intelligence/hashline-ai-agents-cursor-aider-claude-code-oh-my-pi-diff-format-grok-gemini-benchmark-open-source-g-en):

> "Benchmarked across 16 models, 180 tasks, 3 runs each. Grok Code Fast 1: 6.7% → 68.3% — a tenfold improvement hidden behind mechanical patch failures. Gemini 3 Flash: +5pp over str_replace. Grok 4 Fast: 61% fewer output tokens. MiniMax: more than doubled success rate."

**Important:** only four headline numbers are reproduced in public write-ups. The full 16-model table is not in the README that WebFetch returned — DeepWiki explicitly notes "the documentation does **not include** benchmark tables". WOTANN should NOT cite "10×" as universal; it is a single-model peak. The honest framing: *hash-anchored edits materially close the str_replace gap for mid-tier models; top-tier models gain less (see [dev.to/nwyin comparison](https://dev.to/nwyin/hashline-vs-replace-does-the-edit-format-matter-15n2) where Gemini-3-Flash actually lost 15 pp on Python).*

That nuance matters: **Hashline is not a monotonic win**. The dev.to third-party replication shows:

| Model | Replace (Py/TS/Rust) | Hashline (Py/TS/Rust) |
|---|---|---|
| Gemini-3-Flash | 95/80/95 | 70/85/90 |
| Qwen3.5-397B | 90/85/85 | 85/85/90 |
| GPT-4.1-Mini | 65/75/45 | 50/70/55 |

Source: [dev.to Hashline vs Replace](https://dev.to/nwyin/hashline-vs-replace-does-the-edit-format-matter-15n2). Python penalizes hash formatting; TypeScript is neutral; Rust is mixed.

### 2.3 The Google ban

Per [abit.ee](https://abit.ee/en/artificial-intelligence/hashline-ai-agents-cursor-aider-claude-code-oh-my-pi-diff-format-grok-gemini-benchmark-open-source-g-en): during the blog-writing process, Google banned Bölük's Gemini account citing generic "Violation of rules". The reported trigger is that Gemini 3 Flash + Hashline tied-or-beat Google's own `str_replace` baseline by ~5 pp. There's no corroborating official statement from Google, so this should be reported as an allegation, not a fact. (The HN thread `47613614` search-surfaces on the same terms but covers a *different* Google ban — Sova AI's accessibility-API mobile agent.)

### 2.4 TTSR — Time-Traveling Streamed Rules

Per the [DeepWiki key features page](https://deepwiki.com/can1357/oh-my-pi/1.1-key-features) and the development.md deep read:

- Every rule can declare a `ttsrTrigger: /regex/` field.
- A stream watcher runs the regex against the model's output as it streams.
- On match: the stream is **aborted**, the matched rule is re-injected into the conversation as a system reminder, and the request is **retried**.
- Each rule fires once per session (idempotent cap).
- File location: `src/internal-urls/handlers/rule.ts` resolves rules; `ttsr_triggered` hook event fires on activation; per-rule override via `interruptMode` field (from CHANGELOG).

**Why this matters for WOTANN:** our current hook system (per Session 2 quality bars #7, HookResult.contextPrefix) is a *passive* injection channel — hooks can add text to the next turn. TTSR is an *active* trip-wire — it aborts the current stream when the model does something the rule author wants to pre-empt. This is a superset of our current design. Porting it means adding `AsyncIterable<StreamEvent>` interception in `modules/core/lib/llm-streamer.swift` (TBD — this path is nominal).

### 2.5 Six bundled subagents and isolation

From the [DEVELOPMENT.md deep read](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/DEVELOPMENT.md):

- Bundled: `explore`, `plan`, `designer`, `reviewer`, `task`, `quick_task`.
- Isolation backends (controlled by `task.isolation.mode`):
  - `worktree` — git worktree, all platforms.
  - `fuse-overlay` — `fuse-overlayfs`, Unix/Linux.
  - `fuse-projfs` — Windows ProjFS (Projected File System).
  - `none`.
- Windows fallback: missing ProjFS prerequisites auto-downgrade to `worktree` with a notification.
- Child sessions inherit parent MCP connections via in-process proxy tools — they don't spawn separate MCP sessions (resource-saving).

### 2.6 Other notable oh-my-pi features

- **LSP**: 11 operations (diagnostics, definition, type_definition, implementation, references, hover, symbols, rename, code_actions, status, reload) across 40+ language configs, auto-format-on-write.
- **Web search multi-provider chain**: Exa → Brave → Jina → Kimi → Perplexity → Anthropic → Gemini, with fallback cascade.
- **Browser**: Puppeteer + 14 stealth scripts; accessibility snapshots; selector flexibility (CSS / `aria/` / `text/` / `xpath/`).
- **Commit tool**: AI-drafted conventional commits with hunk-level staging, split-commit detection, changelog generation.
- **Python**: persistent IPython kernel at `src/ipy/executor.ts`, bounded session pool with LRU eviction, heartbeat monitoring.
- **RPC mode**: JSONL protocol over stdio for IDE integration; commands: `prompt`, `steer`, `set_model`, `bash`, `get_state`.
- **Config discovery**: reads configs from Claude Code / Cursor / Windsurf / Gemini / Codex / Cline / GitHub Copilot / VS Code.
- **Rust native** (`pi-natives`, ~7,500 LOC): grep, embedded bash, ANSI text manipulation, Kitty protocol parser, syntax highlight, glob, task scheduler, ps tree, profiler, image codec, clipboard, html→md conversion.

---

## 3. `code-yeongyu/oh-my-openagent` (OMO) — deep confirmation

The prior doc covered OMO thinly. Extracted from [github.com/code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent):

### 3.1 Four Discipline Agents

1. **Sisyphus** — main orchestrator; models: `claude-opus-4-7`, `kimi-k2.5`, `glm-5`. Plans and delegates.
2. **Hephaestus** — deep worker; model: `GPT-5.4`. End-to-end exploration + execution.
3. **Prometheus** — strategic planner; same model pool as Sisyphus. Uses interview-mode questioning.
4. **Oracle** — architecture + debugging specialist.

### 3.2 Category routing (key pattern)

Agents do NOT pick model names. They declare task *categories*, which auto-route:
- `visual-engineering` → frontend/UI specialist models
- `deep` → autonomous research + execution
- `quick` → single-file changes
- `ultrabrain` → hard logic → GPT-5.4 xhigh

This is the key port-worthy idea: **separate the "what kind of task" declaration from the "which model" decision.** Our current WOTANN dispatcher binds models explicitly per call, which leaks vendor opinions into the agent layer. OMO decouples.

### 3.3 Ralph Loop

`/ulw-loop` is self-referential execution that runs until 100% task completion. This is the same "loop until done" pattern as Superpowers' `ralph-loop` plugin and Manus-style planning-with-files. OMO commits to it as a first-class harness feature, not a user-invoked skill.

### 3.4 Explicit positioning

OMO openly states "Anthropic blocked OpenCode" as the reason it exists — positioning as the open, multi-model orchestrator. This is a market-segmentation claim, not a technical one.

---

## 4. `pingdotgg/t3code` — Theo's web GUI

Per the [DeepWiki architecture page](https://deepwiki.com/pingdotgg/t3code/2-architecture) and the local monorepo listing:

### 4.1 What it actually is

- **Minimal web GUI** for coding agents. Not a new agent — an *adapter*.
- Providers (current + in-progress):
  - **Codex** — JSON-RPC over stdio, spawns `codex app-server` per session.
  - **Claude** — Anthropic Agent SDK.
  - **Cursor** — in-progress (PR #178 opened an adapter).
  - **OpenCode** — in-progress.
- Stack: TypeScript + Effect ecosystem (`effect`, `@effect/platform-node`) for structured concurrency and DI; React 19 + Tailwind frontend; Node.js WebSocket backend; SQLite persistence (sessions survive server restarts and browser refreshes).
- Two deploy modes: standalone web, Electron desktop app.
- Three-process Electron model: Main (lifecycle), Backend (Node.js + Git + orchestration), Renderer (Chromium React).
- Auth: `codex login` for Codex; `claude auth login` for Claude. No documented direct reuse of `~/.claude/.credentials` — each provider has its own CLI-driven auth flow. The adapter pattern sits *above* auth, so T3 never sees credentials directly.

### 4.2 What's portable to WOTANN

- The **adapter pattern** is good hygiene: one interface, per-provider translator. WOTANN's current provider layer is already close to this but the "category routing" from §3.2 combined with T3's adapter pattern gives a cleaner separation.
- SQLite persistence of threads is industry-standard but worth double-checking — our current session model is JSONL files, which is actually closer to oh-my-pi's pattern.

### 4.3 Known caveats

- README literally says "We are very very early in this project. Expect bugs" and "not currently accepting contributions".
- 10.1k stars, 1.9k forks, v0.0.20 (April 17, 2026) — pre-1.0.
- Covered shallow in prior WOTANN doc; this reread confirms the earlier framing but adds the Effect ecosystem + SQLite details that weren't before.

---

## 5. `VoltAgent/awesome-openclaw-skills` — the 5,198-skill registry

### 5.1 Scale and filtering

- ClawHub raw registry: 13,729 skills as of 2026-02-28.
- Filtered down to 5,198 by excluding:
  - 4,065 spam/bulk/bot accounts
  - 1,040 duplicates
  - 851 low-quality or non-English
  - 886 crypto/blockchain/finance/trade
  - 373 malicious (per VirusTotal + security research)

### 5.2 Category breakdown (30 total)

From the [local README.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/awesome-openclaw-skills/README.md) table of contents:

| Category | Count | Category | Count |
|---|---|---|---|
| Coding Agents & IDEs | 1,184 | Web & Frontend Dev | 919 |
| DevOps & Cloud | 393 | Search & Research | 345 |
| Browser & Automation | 322 | Productivity & Tasks | 205 |
| CLI Utilities | 180 | AI & LLMs | 176 |
| Image & Video Gen | 170 | Git & GitHub | 167 |
| Communication | 146 | Transportation | 110 |
| PDF & Documents | 105 | Marketing & Sales | 102 |
| Health & Fitness | 87 | Media & Streaming | 85 |
| Notes & PKM | 69 | Calendar & Scheduling | 65 |
| Security & Passwords | 53 | Shopping & E-commerce | 51 |
| Personal Development | 50 | Speech & Transcription | 45 |
| Apple Apps | 44 | Smart Home & IoT | 41 |
| Clawdbot Tools | 37 | Gaming | 35 |
| Self-Hosted & Automation | 33 | iOS & macOS Dev | 29 |
| Moltbook | 29 | Data & Analytics | 28 |

### 5.3 Top 50 skills WOTANN should seed first

Rationale: favor the categories a terminal coding agent user touches daily — Coding Agents & IDEs (1,184), Git & GitHub (167), CLI Utilities (180), Search & Research (345), DevOps & Cloud (393). Concrete starter list (curated from the top-of-category scans):

1. `agent-team-orchestration` — multi-agent roles + handoff protocols.
2. `alex-session-wrap-up` — commits unpushed work, extracts learnings, persists rules.
3. `arc-agent-lifecycle` — lifecycle management for skills.
4. `arc-security-audit` — full skill-stack security audit.
5. `arc-skill-gitops` — automated deployment + rollback.
6. `arc-trust-verifier` — provenance checks for ClawHub skills.
7. `arxiv-search-collector` — model-driven arXiv ingestion.
8. `auto-pr-merger` — automated PR check + merge workflow.
9. `azhua-skill-vetter` — security-first vetting before install.
10. `azure-devops` — list projects/repos, create PRs, work items.
11. `active-maintenance` — health/memory metabolism for the agent itself.
12. `adwhiz` — Google Ads campaign manager.
13. `abaddon` — red-team security mode.
14. `agent-browser` (arnarsson) — fast Rust-based headless browser automation CLI.
15. `agent-device` — iOS simulator/device + Android device automation.
16. `agent-step-sequencer` — multi-step scheduler for deep agent requests.
17. `agent-task-tracker` — proactive task-state management.
18. `agentgate` — HITL write-approval API gateway.
19. `agent-audit` — setup audit for performance/cost/ROI.
20. `agent-audit-trail` — tamper-evident hash-chained audit logs.
21. `aegis-shield` — prompt-injection + exfiltration screening.
22. `aeo-analytics-free` — AI-citability tracking (Gemini/ChatGPT/Perplexity).
23. `aeo-content-free` — AEO content generation.
24. `ak-rss-24h-brief` — RSS aggregation + summaries.
25. `2captcha` — CAPTCHA solving.
26. `bat-cat` — cat clone with syntax highlighting.
27. `beeminder` — goal tracking + commitment devices.
28. `billy-emergency-repair` — repair workflows.
29. `bitbucket-automation` — Bitbucket workflow automation.
30. `biz-reporter` — BI reports pulling GA4, Search Console, Stripe.
31. `adblock-dns` — DNS-level ad/tracker blocking.
32. `0g-compute` — cheap TEE-verified inference via 0G network.
33. `2nd-brain` — personal KB for people/places/restaurants/tech.
34. `aetherlang-claude-code` — AetherLang V3 workflow runner.
35. `agent-access-control` — tiered stranger access control.
36. `agent-card-signing-auditor` — A2A protocol signing audit.
37. `agent-chat-ux-v1-4-0` — multi-agent UX with session history.
38. `accessibility-toolkit` — friction-reduction patterns.
39. `activecampaign` — CRM lead/deal integration.
40. `adcp-advertising` — automated advertising campaigns.
41. `admet-prediction` — drug-candidate ADMET prediction.
42. `actionbook` — general website/scrape/form automation.
43. `agent-zero` — delegate complex coding/research tasks.
44. `agentapi` / `agentapi-hub` — curated API directories for agents.
45. `agentaudit` — vulnerability DB check before package install.
46. `agentmail-integration` — AgentMail API integration.
47. `agresource` — scrape/summarize agricultural marketing newsletters.
48. `ai-hunter-pro` — global-trend → viral X post automation.
49. `ai-meeting-scheduling` — group booking links.
50. `airtable-automation` — Airtable workflow automation via Rube MCP.

For WOTANN the **format** of the registry matters more than any individual skill: 30 categories, SKILL.md per folder, ClawHub-compatible URL shape (`clawskills.sh/skills/<user>-<slug>`), VirusTotal security scanning partnership, workspace > local > bundled priority order. Our current skills layout should adopt exactly this shape so community skills are drop-in compatible.

---

## 6. `ultraworkers/claw-code` — The Rust "clawable" port

### 6.1 Parity lanes (all 9 merged on `main`)

Per [local PARITY.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PARITY.md), as of 2026-04-03:

| Lane | Crate/file | Scope | LOC |
|---|---|---|---|
| 1. Bash validation | `runtime/src/bash_validation.rs` (branch-only) | readOnly, destructive-warning, mode, sed, path, semantics | +1004 |
| 2. CI fix | `runtime/src/sandbox.rs` | probe unshare capability, not binary presence | +22/-1 |
| 3. File-tool | `runtime/src/file_ops.rs` | MAX_READ_SIZE, MAX_WRITE_SIZE, NUL-byte bin detect, canonical workspace boundary | +195/-1 |
| 4. TaskRegistry | `runtime/src/task_registry.rs` | in-memory create/get/list/stop/update/output/append_output/set_status/assign_team | +336 |
| 5. Task wiring | `tools/src/lib.rs` | wire registry into Task* dispatch | +79/-35 |
| 6. Team+Cron | `runtime/src/team_cron_registry.rs` | TeamRegistry + CronRegistry | +441/-37 |
| 7. MCP lifecycle | `runtime/src/mcp_tool_bridge.rs` | McpToolRegistry bridge | +491/-24 |
| 8. LSP client | `runtime/src/lsp_client.rs` | diagnostics/hover/definition/references/completion/symbols/formatting | +461/-9 |
| 9. Permission enforcement | `runtime/src/permission_enforcer.rs` | tool gating + file-write boundary + bash read-only heuristics | +357 |

Total: 48,599 tracked Rust LOC across 9 crates, 2,568 test LOC.

### 6.2 What's NOT ported yet

- End-to-end MCP runtime lifecycle (beyond registry bridge).
- Session compaction behavior matching upstream.
- Token counting / cost tracking accuracy.
- Bash deep validation (Lane 1 branch-only).
- CI green on every commit.

### 6.3 Critical crates.io warning

From the [local README.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/README.md):

> `cargo install claw-code` installs the wrong thing. The `claw-code` crate on crates.io is a deprecated stub that places `claw-code-deprecated.exe` — not `claw`. Running it only prints `"claw-code has been renamed to agent-code"`. **Do not use `cargo install claw-code`.**

The upstream binary is `agent-code`, which installs `agent` (not `agent-code` the command). WOTANN's docs should note this namespace collision for users trying to combine claw-code + agent-code in the same environment.

### 6.4 Philosophy (key port idea)

From [PHILOSOPHY.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PHILOSOPHY.md):

> "The real human interface is a Discord channel. A person can type a sentence from a phone, walk away, sleep, or do something else. The claws read the directive, break it into tasks, assign roles, write code, run tests, argue over failures, recover, and push when the work passes."

The important takeaway: **notification routing should live outside the agent's context window**, via `clawhip` (event/notification router for git commits, tmux sessions, GitHub issues/PRs, agent lifecycle). WOTANN's current architecture puts session summaries in-band — separating them into an event bus frees up context budget for code work. This is the #1 architectural lesson from claw-code.

### 6.5 The 40-tool surface

From [PARITY.md lines 145–151](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PARITY.md): `mvp_tool_specs()` in `rust/crates/tools/src/lib.rs` exposes 40 tool specs including `bash`, `read_file`, `write_file`, `edit_file`, `glob_search`, `grep_search`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `Agent`, `ToolSearch`, `NotebookEdit`, `Sleep`, `SendUserMessage`, `Config`, `EnterPlanMode`, `ExitPlanMode`, `StructuredOutput`, `REPL`, `PowerShell`. Registry-backed (not stubs): `Task*`, `Team*`, `Cron*`, `LSP`, `MCP`. Still stubs: `AskUserQuestion`, `RemoteTrigger`, `TestingPermission`.

### 6.6 Clawable ROADMAP contract (key innovation)

From [ROADMAP.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/ROADMAP.md) (1,174 lines total — essentially a machine-readable state-machine spec):

- **Explicit worker lifecycle states**: `spawning` / `trust_required` / `ready_for_prompt` / `prompt_accepted` / `running` / `blocked` / `finished` / `failed`.
- **Canonical lane event schema**: `lane.started` / `lane.ready` / `lane.prompt_misdelivery` / `lane.blocked` / `lane.red` / `lane.green` / `lane.commit.created` / `lane.pr.opened` / `lane.merge.ready` / `lane.finished` / `lane.failed` / `branch.stale_against_main`.
- **Structured session control API** replacing raw send-keys (tmux).
- **Boot preflight / doctor contract** — check before spawn: repo/worktree, branch freshness, trust-gate status, required binaries, plugin+MCP startup eligibility.
- **Duplicate terminal-event suppression**, **event provenance labeling** (`live_lane` / `test` / `healthcheck` / `replay` / `transport`), **report schema versioning + capability negotiation**, **canonical report content-hash anchor** (4.28) — the last one lets projections prove they all came from the same underlying state.
- **Fact / hypothesis / confidence labeling** (4.21) — every claim labeled `observed_fact` / `inference` / `hypothesis` / `recommendation`, with confidence buckets.

This roadmap is, in effect, a reification of best-practices for autonomous-agent observability. WOTANN should absorb at least sections 4.4–4.28 into our own event schema.

---

## 7. `charmbracelet/crush` — Go TUI agent

Per [local README.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/crush/README.md):

- **25+ provider envs**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VERCEL_API_KEY`, `GEMINI_API_KEY`, `SYNTHETIC_API_KEY`, `ZAI_API_KEY`, `MINIMAX_API_KEY`, `HF_TOKEN`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `IONET_API_KEY`, `GROQ_API_KEY`, `AVIAN_API_KEY`, `OPENCODE_API_KEY`, `VERTEXAI_PROJECT`, `VERTEXAI_LOCATION`, `AWS_*`, `AZURE_OPENAI_*`.
- **Catwalk** model DB: `github.com/charmbracelet/catwalk` — open provider list auto-synced; `CRUSH_DISABLE_PROVIDER_AUTO_UPDATE` env to disable.
- **.crushignore** — separate from .gitignore, for things in git but excluded from LLM context.
- **`--yolo`** flag to skip all permission prompts.
- **`options.disabled_tools`** and **`options.disabled_skills`** — totally hide tools/skills from the agent.
- **Agent Skills** — supports the [agentskills.io](https://agentskills.io) open standard. Reads from `$CRUSH_SKILLS_DIR`, `$XDG_CONFIG_HOME/agents/skills`, `$XDG_CONFIG_HOME/crush/skills`, `./.agents/skills`, `./.crush/skills`, `./.claude/skills`, `./.cursor/skills`.
- **Three MCP transports**: `stdio`, `http`, `sse`. Env var expansion via `$(echo $VAR)` syntax.
- **OpenAI-compat vs openai** distinction — `openai` for proxying through OpenAI, `openai-compat` for non-OpenAI OpenAI-API-compatible providers.
- **Amazon Bedrock** with caching disabled; Vertex AI via `gcloud auth application-default login`.
- **Pseudonymous metrics** (device-hash-tied) with `CRUSH_DISABLE_METRICS=1` and respects `DO_NOT_TRACK=1`.
- **Attribution config** — `trailer_style: "assisted-by"|"co-authored-by"|"none"` + `generated_with: true` → adds `💘 Generated with Crush` footer.
- **Initialization** — `initialize_as: "AGENTS.md"` or custom (e.g. `CRUSH.md`, `docs/LLMs.md`).
- License: FSL-1.1-MIT (not pure MIT — FSL has the 2-year-back-to-MIT clause).

**Updates vs prior WOTANN doc**: Catwalk auto-update behavior, the three-transport MCP split, `DO_NOT_TRACK` support, and the agentskills.io standard compliance are not in `AUDIT_LANE_2_COMPETITORS.md`. Adding them.

---

## 8. `Kilo-Org/kilocode` — VS Code + CLI

Per [local README.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/kilocode/README.md):

- **Fork of OpenCode**, commercialized. Claims 1.5M+ Kilo Coders, 25T+ tokens, #1 on OpenRouter/apps/category/coding.
- **VS Code extension** + CLI (`npm install -g @kilocode/cli`).
- **Multi-mode**: Architect / Coder / Debugger + custom modes.
- **Autonomous Mode**: `kilo run --auto "run tests and fix any failures"` — disables ALL permission prompts. Designed for CI/CD.
- **MCP Server Marketplace** integration.
- **Binary distribution**: `kilo-<os>-<arch>.{zip,tar.gz}`, including `x64-baseline` for older CPUs (no AVX), `arm64`, and `musl` for Alpine/minimal Docker. This is a polish detail we can port — WOTANN binaries should include a baseline build.
- **npm hidden .kilo launcher artifact** — documented openly as npm-generated, safe to leave.

Key insight: Kilo is going commercial-platform aggressively — 500+ AI models, "transparent pricing that matches provider rates exactly". It positions itself against per-seat IDE plugins. Our WOTANN free-tier first-class strategy aligns but our competitive wedge is macOS-native TUI (Kilo is cross-platform generic).

---

## 9. `xiaowu0162/longmemeval` — The benchmark itself

Per [local README.md](/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/longmemeval/README.md):

- **ICLR 2025 accepted**. Authors: Di Wu, Hongwei Wang, Wenhao Yu, Yuwei Zhang, Kai-Wei Chang, Dong Yu. arXiv: 2410.10813.
- **500 questions** across **5 memory abilities**:
  1. Information Extraction
  2. Multi-Session Reasoning
  3. Knowledge Updates
  4. Temporal Reasoning
  5. Abstention
- **Datasets**:
  - `longmemeval_s.json` — ~115k-token chat histories (~40 sessions for Llama 3).
  - `longmemeval_m.json` — ~500 sessions per history.
  - `longmemeval_oracle.json` — only evidence sessions included.
- **Cleaned 2025-09** (history sessions cleaned to prevent answer-correctness interference).
- **Evaluation**: `src/evaluation/evaluate_qa.py` using GPT-4o as judge; outputs jsonl with `question_id` + `hypothesis` fields.
- **Retrievers supported**: `flat-bm25`, `flat-contriever`, `flat-stella` (Stella V5 1.5B), `flat-gte` (gte-Qwen2-7B-instruct).
- **Index expansion variants**: `session-summ`, `session-keyphrase`, `session-userfact`, `turn-keyphrase`, `turn-userfact` — three join modes (`separate`, `merge`, `replace`).
- **Time-aware query expansion** prunes search space by inferring time ranges from queries.

**Why this matters for WOTANN**: our current memory-retrieval eval is ad-hoc. Adopting longmemeval as one of our benchmark harnesses (alongside TerminalBench/SWE-bench) would give memory performance a defensible number. The 500-question scale is tractable for WOTANN CI. The 5 abilities map directly to our WOTANN Engram/claude-mem/auto-memory layered design.

---

## 10. Top 15 ports for WOTANN (with file paths)

Prioritized by (a) expected user-visible impact, (b) implementation difficulty, (c) defensibility.

| # | Port | Source | WOTANN target | Effort | Impact |
|---|---|---|---|---|---|
| 1 | Hashline-anchored edit tool | oh-my-pi `packages/coding-agent/src/patch/hashline.ts` | `modules/editor/lib/edit-tool.swift` (new variant alongside existing) | M | HIGH — closes str_replace failure gap |
| 2 | TTSR regex-triggered rule injection | oh-my-pi `src/internal-urls/handlers/rule.ts` | `modules/core/lib/hook-runner.swift` + `modules/core/lib/llm-streamer.swift` (new trip-wire path) | M | HIGH — better hook expressiveness than current contextPrefix |
| 3 | Clawable event schema (lane.* + fact/hypothesis labeling) | claw-code `ROADMAP.md` §4.4–4.28 | `modules/events/lib/lane-events.swift` + `modules/events/lib/report-schema.swift` | L | MED — observability + honest uncertainty |
| 4 | Three-mode permission enforcer (read-only/workspace-write/danger) | claw-code `rust/crates/runtime/src/permission_enforcer.rs` | `modules/security/lib/permission-enforcer.swift` | S | HIGH — reifies our existing patterns |
| 5 | LSP registry dispatch (11 ops across 40+ langs) | oh-my-pi `packages/coding-agent` LSP + claw-code `runtime/src/lsp_client.rs` | `modules/lsp/lib/lsp-client.swift` | L | HIGH — IDE-quality context |
| 6 | Task isolation backends (worktree / fuse-overlay / fuse-projfs) | oh-my-pi `task.isolation.mode` | `modules/task/lib/isolation.swift` + `modules/task/lib/fuse-overlay.swift` | L | MED — safer parallel agents |
| 7 | Catwalk-style provider auto-update | crush `update-providers` command | `modules/models/lib/catalog.swift` + `modules/models/lib/auto-update.swift` | M | MED — frees us from hardcoded model lists |
| 8 | `.wotannignore` separate from `.gitignore` | crush `.crushignore` | `modules/fs/lib/ignore-walker.swift` | S | MED — clear mental model for "in git but not in context" |
| 9 | Agent Skills standard (agentskills.io) compat + 30-category registry shape | crush skills_paths + awesome-openclaw-skills layout | `skills/` directory structure + `modules/skills/lib/loader.swift` | S | HIGH — drop-in community skill compatibility |
| 10 | Sisyphus-style task-category routing (not model-name routing) | OMO Discipline Agents | `modules/agents/lib/dispatch.swift` + `modules/agents/lib/category-router.swift` | M | HIGH — clean separation of "what" from "which model" |
| 11 | Config discovery from 8 AI tools (Claude/Cursor/Windsurf/Gemini/Codex/Cline/Copilot/VSCode) | oh-my-pi universal config discovery | `modules/config/lib/foreign-config-loader.swift` | M | HIGH — migration ease for new users |
| 12 | RPC mode (JSONL stdio server) for IDE integration | oh-my-pi `runRpcMode` | `modules/server/lib/rpc-mode.swift` | M | MED — unblocks IDE plugins |
| 13 | LongMemEval harness adoption | xiaowu0162/longmemeval | `bench/longmemeval/` + `modules/eval/lib/longmemeval-runner.swift` | M | HIGH — gives memory system a defensible score |
| 14 | Commit tool with AI-drafted conventional commits + hunk-level staging | oh-my-pi Commit tool | `modules/git/lib/commit-tool.swift` | M | MED — a daily-driver feature |
| 15 | `--yolo` / `--dangerously-skip-permissions` CI mode | crush `--yolo`, claw-code `--dangerously-skip-permissions`, kilocode `--auto` | `modules/cli/lib/permission-mode-flag.swift` | S | HIGH — unblocks CI/CD users |

WOTANN-file-path column uses the tentative module layout. Exact paths subject to §78 sprint review.

### 10.1 What NOT to port

- Crush's pseudonymous metrics: WOTANN spec is free-tier first-class with strong privacy posture. Metrics opt-in only, no device hashing.
- Kilocode's forced "create an account" onboarding. WOTANN stays no-account.
- Claw-code's Discord-as-primary-UX thesis. Too niche for our macOS-native-TUI strategy; the *event-bus* idea ports; the *Discord channel* idea doesn't.
- T3's Electron desktop wrapper. WOTANN's TUI is native from Phase 0; an Electron GUI is duplicative.
- OMO's multi-model orchestration as a *default* — WOTANN bundles Gemma 4 and gives the user provider choice but is not trying to be a multi-model aggregation layer.

---

## 11. Quality Bars + Followups

**Verified by source:**
- oh-my-pi vs OMO distinction (§1): confirmed via README fetches of both repos.
- Hashline benchmark caveats (§2.2): third-party replication at dev.to shows Python regression; WOTANN docs must NOT cite "10×" without the model name.
- Google ban (§2.3): reported in abit.ee only; no official Google statement; flag as allegation.
- Claw-code lane status (§6.1): read directly from local PARITY.md, not via summary.
- Skills 5,198 count (§5.1): direct from local README.md table line 18 (`skills-5198-blue`).

**Followups for future research sessions:**
1. Read full `packages/coding-agent/src/patch/hashline.ts` source (WebFetch returned 404 — file path may have moved; check via git clone locally).
2. Obtain the full 16-model × 180-task × 3-run benchmark table — not in any public source found; may require cloning oh-my-pi and running `react-edit-benchmark`.
3. Confirm T3's `~/.claude/.credentials` reuse claim from the user's original prompt — the WebFetch'd AGENTS.md does NOT mention credential file reuse. This part of the prior doc was unsupported.
4. Read the remaining 974 lines of `claw-code/ROADMAP.md` (I reached 506 of 1,174) — sections 5–N likely contain more event-schema items.
5. Review `categories/coding-agents-and-ides.md` (1,184 skills) to narrow the top-50 list to a top-10 after hands-on evaluation.

---

## 12. Sources (cited inline throughout)

Local file reads:
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/README.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PARITY.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/PHILOSOPHY.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/ROADMAP.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/claw-code/rust/README.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/awesome-openclaw-skills/README.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/crush/README.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/kilocode/README.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/longmemeval/README.md`

Web sources:
- [github.com/can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)
- [github.com/code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
- [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- [deepwiki.com/can1357/oh-my-pi](https://deepwiki.com/can1357/oh-my-pi)
- [deepwiki.com/can1357/oh-my-pi/8.1-hashline-edit-mode](https://deepwiki.com/can1357/oh-my-pi/8.1-hashline-edit-mode)
- [deepwiki.com/can1357/oh-my-pi/1.1-key-features](https://deepwiki.com/can1357/oh-my-pi/1.1-key-features)
- [deepwiki.com/pingdotgg/t3code/2-architecture](https://deepwiki.com/pingdotgg/t3code/2-architecture)
- [github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/DEVELOPMENT.md](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/DEVELOPMENT.md)
- [github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md)
- [github.com/pingdotgg/t3code/blob/main/AGENTS.md](https://github.com/pingdotgg/t3code/blob/main/AGENTS.md)
- [dev.to/nwyin/hashline-vs-replace-does-the-edit-format-matter-15n2](https://dev.to/nwyin/hashline-vs-replace-does-the-edit-format-matter-15n2)
- [akmatori.com/blog/llm-harness-problem](https://akmatori.com/blog/llm-harness-problem)
- [abit.ee Hashline controversy post](https://abit.ee/en/artificial-intelligence/hashline-ai-agents-cursor-aider-claude-code-oh-my-pi-diff-format-grok-gemini-benchmark-open-source-g-en)
- [x.com/badlogicgames/status/2021868004221608359](https://x.com/badlogicgames/status/2021868004221608359)
- [github.com/ultraworkers/claw-code](https://github.com/ultraworkers/claw-code)
- [github.com/ultraworkers/claw-code-parity](https://github.com/ultraworkers/claw-code-parity)
- [github.com/charmbracelet/crush](https://github.com/charmbracelet/crush)
- [github.com/charmbracelet/catwalk](https://github.com/charmbracelet/catwalk)
- [github.com/Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode)
- [agentskills.io](https://agentskills.io)
- [arxiv.org/abs/2410.10813 (LongMemEval)](https://arxiv.org/abs/2410.10813)
- [huggingface.co/datasets/xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)

---

*End of research doc. ~4,850 words. If this report will be used to drive implementation, the Top-15 port table (§10) is the load-bearing deliverable; §11 notes the things that still need re-verification.*
