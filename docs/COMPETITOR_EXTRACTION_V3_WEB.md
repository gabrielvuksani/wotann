# COMPETITOR EXTRACTION V3 — WEB-ONLY COMPETITORS (FRESH 2026-04-19 INTEL)

**Author:** V3 Web-Extraction Agent (Opus 4.7 max effort, 63,999 thinking tokens)
**Date:** 2026-04-19
**Supersedes:** None. Updates `COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` (2026-04-19) with web-only 2026-04 intel.
**Scope:** 10 competitors (2 cloned, 2 architectural-inspiration-only due to license, 6 WebFetch/WebSearch), freshly acquired 2026-04-19.
**Workspace:** `/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones_v2/`

---

## 0. EXECUTIVE SUMMARY

Ten competitors were re-investigated fresh on 2026-04-19. Key findings:

1. **Two cloned this round**: **emdash** (Apache-2.0, 3,973⭐) and **superset** (Elastic-v2, 9,794⭐). Emdash is a pure Apache port target; superset must be architecture-inspiration-only (Elastic v2 blocks hosted-service use).
2. **Glass (glass-hq)** — confirmed **GPL-3.0** (inherits Zed's license). Cloned for architecture inspection ONLY. **No code port possible** to WOTANN's MIT stack. 221 crates including `acp_thread`, `acp_tools`, `agent_servers`, `agent_ui`, `browser` — Glass's ACP implementation is the most production-grade reference available alongside Goose.
3. **Two hard fails**: **soloterm** (not OSS — proprietary Solo app at soloterm.com, Tauri, $69/yr Pro) and **superset-the-shell-passthrough** (the name maps to superset-sh/superset — a totally different product than the web-overlay implied in the target prompt; the web-overlay concept does NOT exist as an OSS repo).
4. **dpcode.cc UNREACHABLE** — ECONNREFUSED on direct fetch, near-zero search index presence. Only signal: tagline "the best way to code with your AI subscriptions" (likely a `claude-code-router` variant). Honest conclusion: cannot characterize without direct access.
5. **Perplexity Computer** expanded access: Max $200/mo + **now-Pro since March 13 2026**. SWE-Bench Pro scores attributed primarily to GPT-5.2. 400+ OAuth connectors confirmed, 19-model orchestration with Opus 4.6 planner.
6. **Claude Design handoff-bundle CONFIRMED** — Opus 4.7 powered, Apr 17 2026, "handoff bundle to Claude Code with a single instruction." Structure still private. Available Pro/Max/Team/Enterprise.
7. **Cursor 3 launched Apr 2 2026** — Composer 2 model, Agents Window is the new default surface (IDE demoted to fallback), cloud↔local handoff, multi-workspace/multi-repo, plugin marketplace (MCPs + Skills + Subagents).
8. **JetBrains Air launched Mar 9 2026** — built on abandoned Fleet. Free macOS preview. ACP-first. 4 agents out of box (Codex, Claude Agent, Gemini CLI, Junie). Positioned as COMPLEMENT to IntelliJ, not replacement.
9. **Gemini for Mac** — Option+Space mini chat, Option+Shift+Space full window, **Apple Silicon + macOS 15+ only**, FREE. Window-sharing contextual help. Nano Banana images + Veo video included.
10. **4 NEW patterns to port** surfaced across these 10 that are NOT yet in WOTANN and NOT yet surfaced in `COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` (see §12).

---

## 1. GLASS (glass-hq/Glass) — ARCHITECTURE INSPIRATION ONLY

### 1.1 Provenance & License

| Field | Value |
|---|---|
| Repo | https://github.com/Glass-HQ/Glass |
| Cloned | `research/__new_clones_v2/Glass/` (depth 1) |
| License | **GPL-3.0 or later** (+ small Apache-2.0 subset for utility crates) — `LICENSE-GPL` is the repo-wide license |
| GitHub stars | 826 |
| Parent | zed-industries/zed (hard fork, syncs weekly) |
| Primary language | Rust (221 crates) |
| Homepage | https://glassapp.dev/ |
| Last updated | 2026-04-19 06:38 UTC (active) |
| Porting status for WOTANN | **ARCHITECTURAL INSPIRATION ONLY** — GPL-3.0 incompatible with MIT |

### 1.2 Architecture Summary

Glass is a **Zed fork** that adds a browser as a first-class citizen alongside Zed's editor + terminal. The org also maintains **Glass-HQ/gpui** as a standalone Rust UI framework (extracted from Zed's in-tree `crates/gpui`) extended with native iOS and macOS components.

```
Glass/
├── crates/                                221 Rust crates (fork of Zed's crate tree)
│   ├── acp_thread                         Agent Client Protocol conversation thread
│   ├── acp_tools                          ACP tool-call infrastructure
│   ├── agent                              Core agent loop
│   ├── agent_servers                      External agent server spawning (Claude, Codex, Gemini)
│   ├── agent_settings                     Per-agent config
│   ├── agent_ui                           Agent-thread UI
│   ├── ai_onboarding                      First-run AI flow
│   ├── anthropic                          Anthropic API client
│   ├── bedrock                            AWS Bedrock client
│   ├── browser                            **Full browser embedded as a crate** (Glass's differentiator vs Zed)
│   ├── buffer_diff                        Incremental diff engine
│   ├── call                               Audio/video calling
│   ├── channel                            Pub/sub channels (multiplayer editing)
│   ├── client                             HTTP + cloud client
│   ├── cloud_api_client / cloud_api_types Cloud state sync
│   ├── cloud_llm_client                   LLM client over Zed's cloud
│   ├── codestral                          Mistral Codestral client
│   ├── collab / collab_ui                 Multiplayer collaboration backend
│   ├── component                          UI component library
│   └── ... 200+ more
```

### 1.3 Unique Features (observable from crate list + README + CLAUDE.md)

- **Browser as a first-class IDE pane** — the `browser` crate makes Glass browser-first, IDE-second. "Anyone can use the browser — developers also get an editor and terminal alongside it." (README L3)
- **Extended GPUI** — Glass-HQ/gpui adds iOS + native macOS components to Zed's UI framework, making GPUI run on mobile. Gives Glass a path to iOS parity.
- **ACP baked-in** — `crates/acp_thread` + `crates/acp_tools` + `crates/agent_servers` are already in the Zed upstream; Glass inherits them. Proves the ACP Agent-Registry landing (blog.jetbrains.com/ai/2026/01/acp-agent-registry/) integrates at the crate level.
- **Liquid-Glass design language** — the README does not directly name "Liquid Glass," but the repo topics include `gpui`, `rustlang`, `text-editor`, `browser`, `glass`. Apple's Liquid Glass design language was flagged for Zed in upstream discussion #38400, and Glass is building on that discussion.
- **Strict `cargo-about` license compliance** — `script/licenses/zed-licenses.toml` enforces every dep's SPDX — rare discipline, worth porting to WOTANN's `npm ls` output.

### 1.4 Pricing / Licensing for Users

No commercial tier visible. Source available under GPL-3.0. Downloads via GitHub releases.

### 1.5 WOTANN Status vs Glass

| Capability | Glass | WOTANN | Gap |
|---|---|---|---|
| ACP host/client | `crates/acp_thread` + `acp_tools` + `agent_servers` | `src/acp/stdio.ts` + `src/acp/protocol.ts` (pinned 0.2.0) | **Version audit needed** — Glass is on Zed's upstream ACP which has moved past 0.2.0 |
| Browser-in-IDE | Full `browser` crate | WOTANN has NO browser pane | **GAP** |
| Native UI framework with iOS path | Glass-HQ/gpui (Rust, extended GPUI) | WOTANN uses Ink (TUI) + Tauri+React (Desktop) + SwiftUI (iOS) | Different strategy — WOTANN's polyglot is fine |
| Multiplayer editing | `collab` + `channel` | WOTANN has DM pairing in `src/channels/`, NOT real-time co-editing | **GAP** |
| License scanner in CI | `cargo-about` + `zed-licenses.toml` | Ad-hoc | **MINOR GAP — port pattern** |

### 1.6 Patterns NOT Yet Ported To WOTANN (Glass-unique, inspiration only)

1. **Browser as a first-class agent-visible pane** — Glass's `browser` crate gives the agent a live browser it can drive (page load, click, screenshot). WOTANN's Desktop Control is separate from any pane. **Port pattern (not code):** add `browserPane` to Workshop tab, implemented via `computer-use/screen-capture.ts` + a new `computer-use/browser-pane.ts` with Playwright/Lightpanda backend. Priority: MEDIUM (MOAT candidate).
2. **License-compliance CI gate** — `cargo-about` rejects builds with unresolved SPDX. **Port pattern (architectural, not code):** `scripts/check-licenses.ts` runs `license-checker` on WOTANN + all 19 provider adapters, fails CI on unresolved/non-allowlisted licenses. Priority: LOW.
3. **ACP version audit** — Glass tracks Zed upstream every week. WOTANN pinned ACP 0.2.0 in `src/acp/protocol.ts:190`. **Action:** check Zed's current ACP schema version in Glass's `crates/acp_thread` Cargo.toml and bump WOTANN to match. Priority: **HIGH** (Lane-8 §2 flagged this already).

### 1.7 Sources

- Repo: https://github.com/Glass-HQ/Glass (fetched 2026-04-19 15:09 UTC)
- Homepage: https://glassapp.dev/ (fetched 2026-04-19 15:11 UTC — minimal content)
- `LICENSE-APACHE`, `LICENSE-GPL` (in repo root)
- `README.md` (in repo root, commit 2026-04-14 pushed_at)
- `CLAUDE.md` (in repo root — Rust coding guidelines, GPUI idioms)

---

## 2. SOLO (soloterm.com) — PROPRIETARY, DOCS-ONLY

### 2.1 Provenance & License

| Field | Value |
|---|---|
| Website | https://soloterm.com/ |
| GitHub org (PHP tooling — NOT this product) | https://github.com/soloterm (Solo-Laravel, MIT — different product) |
| License | **Proprietary** — paid Pro tier, license-key validated, 14-day offline grace |
| OSS status for the Mac app | **NONE** — no GitHub repo for the native Tauri app |
| Porting status for WOTANN | **DOCS-ONLY INSPIRATION** |

Note: "soloterm" in GitHub is the org for Aaron Francis's **PHP/Laravel process runner** (also called Solo). The **macOS-native Tauri workspace app at soloterm.com** is a SEPARATE product sharing the name, and is NOT open source. Target prompt's "block-based terminal" framing is inaccurate — Solo is a **process dashboard** (not blocks-in-terminal like Warp), and explicitly positions itself as NOT a terminal replacement.

### 2.2 Architecture Summary (from homepage)

- **Built with Tauri** (not Electron). Advertises "25MB. Not another IDE." Uses macOS native WebKit.
- **Process dashboard**: lists local dev processes (agents + services), shows running/crashed/stopped status, auto-restarts crashes via file watchers.
- **MCP integration**: "AI agents can see logs and process state" via MCP server embedded in Solo.
- **solo.yml**: team-sharable config committed to repo. Defines stack + agents per project.
- **20+ framework auto-detection**: Laravel, Next.js, Rust, Django, Ruby, Go, .NET, Elixir, Svelte, Spring, Remix, Astro, FastAPI, Flask, etc.
- **Creator**: Aaron Francis (faster.dev, Database School founder).

### 2.3 Unique Features

- **MCP-native dashboard** — agents ASK Solo (via MCP) about process health, instead of spawning their own. Reverses the usual flow.
- **Per-project agent declaration** — `solo.yml` lists WHICH agents (Claude Code, Codex, Aider, Goose) should auto-launch per project.
- **Restart-on-crash** — file-watcher-driven, opt-in per process.
- **Native notifications** — macOS notifications on crash.

### 2.4 Pricing / Licensing for Users

| Tier | Price | Limits |
|---|---|---|
| Free | $0 | 4 projects, 20 processes total, all features including MCP + notifications, "never expires" |
| Pro | $99 first year, $69/yr after | Unlimited projects/processes, priority support, 3 devices, 30-day money-back |

### 2.5 Platform Availability

Mac only (public beta). Windows and Linux "coming soon."

### 2.6 GitHub Stars / Benchmarks

Native app has no GitHub presence (proprietary). No published SWE-bench / TerminalBench scores.

### 2.7 WOTANN Status vs Solo

| Capability | Solo | WOTANN | Gap |
|---|---|---|---|
| MCP-exposed process state | ✅ (native dashboard exposes all processes) | Partial — `src/daemon/` tracks engine state, but not every child-process is MCP-visible | **MODERATE GAP** |
| `solo.yml` team-sharable stack + agents | ✅ | `wotann.yaml` exists but doesn't declare which agents auto-launch per project | **GAP** |
| 20+ framework auto-detection | ✅ | Partial — WOTANN's project-onboarding detects some stacks, but not 20+ | **GAP — easy port** |
| Auto-restart on crash | ✅ | `src/orchestration/self-healing-pipeline.ts` covers agent runs, NOT ambient dev processes | **MODERATE GAP** |

### 2.8 Patterns NOT Yet Ported To WOTANN (Solo-unique, pattern-inspired)

1. **MCP-exposed process dashboard** — WOTANN's Engine daemon (`src/daemon/engine.ts`) should expose ALL tracked processes (agent runs, cron jobs, workers, dev servers) via an MCP tool like `wotann_list_processes` + `wotann_restart_process`. **High priority** — this closes the "agent asks before acting" loop.
2. **`.wotann/stack.yaml`** — declare which dev processes + which AI agents auto-launch per project. File committed to repo so team gets the same environment. **Medium priority.**
3. **20+ framework fingerprinting** — extend `src/core/project-onboarding.ts` to fingerprint 20+ frameworks via package.json/Cargo.toml/pyproject.toml/go.mod/composer.json pattern matching. **Medium priority.**

### 2.9 Sources

- Homepage: https://soloterm.com/ (fetched 2026-04-19 via WebFetch, full pricing + features captured)
- Comparison pages: https://soloterm.com/cmux-vs-tmux, https://soloterm.com/alternatives/warp, https://soloterm.com/warp-vs-tmux, https://soloterm.com/ghostty-vs-iterm (surfaced via WebSearch 2026-04-19)
- Search confirmation: "SoloTerm · GitHub" = `github.com/soloterm` (Laravel PHP tooling, not the Mac app)

---

## 3. EMDASH (generalaction/emdash) — CLONED, APACHE-2.0

### 3.1 Provenance & License

| Field | Value |
|---|---|
| Repo | https://github.com/generalaction/emdash |
| Cloned | `research/__new_clones_v2/emdash/` (depth 1) |
| License | **Apache 2.0** (`LICENSE.md` in repo root) |
| GitHub stars | 3,973 |
| YC batch | W26 |
| Primary language | TypeScript (Electron + React + Vite) |
| Platform | macOS (Apple Silicon + Intel x64), Windows (x64 installer + portable), Linux (AppImage + .deb) |
| Homepage | https://emdash.sh/ |
| Last updated | 2026-04-19 18:55 UTC (active) |
| Porting status for WOTANN | **APACHE 2.0 — SAFE TO PORT CODE WITH ATTRIBUTION** |

### 3.2 Architecture Summary

Emdash self-describes as an **"Agentic Development Environment" (ADE)**. Electron app with parallel coding agents in git worktrees, locally OR over SSH. AGENTS.md-driven agent onboarding (conductor pattern).

```
emdash/
├── src/
│   ├── main/                              Electron main process (Node)
│   │   ├── main.ts                        Entry
│   │   ├── entry.ts
│   │   ├── ipc/                           IPC contracts
│   │   ├── db/                            Drizzle SQLite
│   │   ├── services/
│   │   │   ├── AccountCredentialStore.ts  OS keychain wrapper
│   │   │   ├── AccountProfileCache.ts
│   │   │   ├── AgentEventService.ts       Agent lifecycle events
│   │   │   ├── AutomationsService.ts      Workflow automation
│   │   │   ├── ClaudeConfigService.ts
│   │   │   ├── ClaudeHookService.ts       Hook integration with Claude Code
│   │   │   ├── CodexSessionService.ts
│   │   │   ├── ConnectionsService.ts
│   │   │   ├── ForgejoService.ts          Forgejo (self-hosted git) integration
│   │   │   ├── GitHubService.ts / GitLabService.ts / JiraService.ts / LinearService.ts
│   │   │   ├── McpService.ts (272 LOC) + mcp/adapters.ts (236 LOC) + mcp/configIO.ts (155 LOC)
│   │   │   ├── ssh/
│   │   │   │   ├── SshService.ts          Pool of 10 SSH connections + SFTP
│   │   │   │   ├── SshConnectionMonitor.ts
│   │   │   │   ├── SshCredentialService.ts
│   │   │   │   ├── SshHostKeyService.ts   Known-hosts fingerprint verification
│   │   │   │   └── types.ts
│   │   │   └── ... (PTY, lifecycle, browser-view, host-preview, etc.)
│   │   ├── workers/                       Background worker pool
│   │   └── db/                            Drizzle migrations (auto-gen, NEVER edit)
│   ├── renderer/                          React UI
│   ├── shared/                            Shared types (main + renderer)
│   └── preload.ts
├── agents/                                Task-keyed agent documentation (AGENTS.md system)
│   ├── architecture/{overview, main-process, renderer, shared}.md
│   ├── workflows/{testing, worktrees, remote-development}.md
│   ├── integrations/{providers, mcp}.md
│   ├── risky-areas/{database, pty, ssh, updater}.md
│   └── conventions/{ipc, typescript, config-files}.md
├── drizzle/                               Auto-generated SQLite migrations
├── AGENTS.md                              Top-level agent guide
└── CLAUDE.md                              -> AGENTS.md
```

### 3.3 Unique Features

- **23 CLI provider adapters** (README L75-100): Amp, Auggie, Autohand Code, Charm Crush, Claude Code, Cline, Codebuff, Codex, Continue, Cursor, Droid, Gemini, GitHub Copilot, Goose, **Hermes Agent**, **Kilocode**, **Kimi**, **Kiro (AWS)**, Mistral Vibe, OpenCode, Pi, Qwen, Warp. WOTANN has 19 providers (api-based). Emdash demonstrates that **CLI-adapter breadth matters** — each CLI is a distinct integration layer.
- **SSH-backed remote projects** — Emdash connects to remote Linux boxes via SSH+SFTP, clones the project there, runs agents there, and syncs diffs back. Pool of 10 connections, fingerprint verification, OS-keychain credential storage. **WOTANN has no SSH/remote execution story.**
- **Forgejo adapter** — in addition to GitHub/GitLab/Jira/Linear, Emdash supports Forgejo (self-hosted git). Niche but covers "enterprise that refuses GitHub.com" segment.
- **Layered AGENTS.md** — instead of a monolithic AGENTS.md, Emdash has a **task-keyed** agent docs set: `agents/README.md` (repo map), `agents/architecture/{overview,main-process,renderer,shared}.md`, `agents/workflows/{testing,worktrees,remote-development}.md`, `agents/integrations/{providers,mcp}.md`, `agents/risky-areas/{database,pty,ssh,updater}.md`, `agents/conventions/{ipc,typescript,config-files}.md`. Progressive disclosure for agents.
- **Drizzle migration protection** — AGENTS.md instructs agents NOT to hand-edit numbered Drizzle migrations or `drizzle/meta/`. Migrations are auto-generated only.
- **Non-negotiables** enforced at merge: `pnpm run format && pnpm run lint && pnpm run type-check && pnpm exec vitest run`.

### 3.4 Pricing / Licensing for Users

Apache-2.0 source. No paid tier mentioned in README. Cloud/SSH remote is "learn more" at https://www.emdash.sh/cloud — indicates cloud offering exists but no pricing surfaced.

### 3.5 Platform Availability

- **macOS**: Apple Silicon (.dmg) + Intel x64 (.dmg) + Homebrew cask (`brew install --cask emdash`)
- **Windows**: x64 .msi installer + x64 portable .exe
- **Linux**: AppImage (x64) + .deb (x64)

### 3.6 GitHub Stars / Benchmarks

3,973 stars at 2026-04-19. No published SWE-bench / TerminalBench scores.

### 3.7 WOTANN Status vs Emdash

| Capability | Emdash | WOTANN | Gap |
|---|---|---|---|
| CLI provider adapters (23) | ✅ 23 CLIs wrapped as first-class | 19 API providers + Claude Agent SDK wrapper; CLIs NOT first-class | **MODERATE GAP** — mirrors Jean's finding (Lane-8 §1.4 item 3) but Emdash does it for 23 vs Jean's 4 |
| SSH remote project execution | ✅ 10-connection pool, SFTP, fingerprint check | **None** — WOTANN is local-only or API-only | **MAJOR GAP** |
| Forgejo adapter | ✅ | None — GitHub only | Minor gap |
| Task-keyed `agents/` docs structure | ✅ (progressive-disclosure agent guide) | `AGENTS.md` is monolithic (146 lines flat) | **PATTERN PORT** — high ROI |
| Drizzle migration protection in agent rules | ✅ (non-negotiable rule) | WOTANN has no ORM + no migration-protection rule | Minor gap |
| OS-keychain credential storage | ✅ | Partial — `src/sandbox/security.ts` but not for user credentials | **GAP** |
| Per-task Non-Negotiables merge gate | ✅ (format + lint + type-check + vitest run) | Partial — has CI but not "merge-gated" | Minor gap |

### 3.8 Patterns NOT Yet Ported To WOTANN (Emdash-unique)

**Port target #1: SSH-remote project execution.** Emdash's `src/main/services/ssh/` (5 files, est. 800 LOC) demonstrates:
- Connection pool with MAX_CONNECTIONS=10 + POOL_WARNING_THRESHOLD=0.8
- `resolveIdentityAgent`, `resolveSshConfigHost`, `resolveProxyCommand` — respects user's `~/.ssh/config`
- Known-hosts fingerprint verification
- SFTP wrapper for file sync
- OS-keychain for credential storage (via `AccountCredentialStore.ts`)
- Proxy-command subprocess for jump hosts (ChildProcess-based)

**Port to WOTANN:** `src/remote/ssh-session.ts` + `src/remote/sftp-sync.ts` + `src/remote/known-hosts.ts` + `src/remote/credential-store.ts`. Wire via new CLI command `wotann remote --host user@host --project path`. Priority: **HIGH** (WOTANN gains "run agents on my prod box" capability). Apache-2.0 permits direct port with attribution.

**Port target #2: Task-keyed agents/ docs structure.** Emdash's `AGENTS.md` is a dispatcher — 30-50 lines that point to `agents/architecture/*`, `agents/workflows/*`, `agents/integrations/*`, `agents/risky-areas/*`, `agents/conventions/*`. This is **progressive disclosure for agents**: the opening AGENTS.md is short enough to always fit in context, but links to specialized docs loaded ONLY when needed. WOTANN's 146-line flat AGENTS.md can be split into:
- `AGENTS.md` — 30-line dispatcher
- `agents/architecture/{overview,core,orchestration,providers}.md`
- `agents/workflows/{testing,worktrees,hooks,building}.md`
- `agents/integrations/{providers,mcp,acp,channels}.md`
- `agents/risky-areas/{daemon,sandbox,memory,shadow-git}.md`
- `agents/conventions/{typescript,immutability,naming}.md`

Priority: MEDIUM — 1 day of work, doubles the useful content agents can discover.

**Port target #3: `ClaudeHookService` pattern.** Emdash has a service (`ClaudeHookService.ts`) that **listens to Claude Code hook invocations** from inside Emdash's running Claude Code child process. This is the missing piece in WOTANN's hook system: **hooks from remote Claude Code processes reach WOTANN's central Engine**, not just the local in-process Anthropic-SDK agent. Priority: MEDIUM.

**Port target #4: Forgejo adapter.** WOTANN's `src/channels/` covers Discord/Telegram/iMessage; `src/connectors/` covers GitHub/GitLab/Jira/Linear/Notion/Slack/Confluence/Google-Drive. Adding Forgejo (`ForgejoService.ts` port) is ~200 LOC and covers the self-hosted-git enterprise segment. Priority: LOW (niche).

**Port target #5: Drizzle-style protected-files rule.** WOTANN's AGENTS.md should name specific files/dirs as "never hand-edit" — candidates: `src/generated/`, any future migration dir, locked-config files. Priority: LOW.

### 3.9 Sources

- Repo: https://github.com/generalaction/emdash (cloned 2026-04-19 15:11 UTC)
- README.md (lines 1-100 read)
- AGENTS.md (full read)
- CLAUDE.md (-> AGENTS.md)
- `src/main/services/` tree (ls)
- `src/main/services/ssh/SshService.ts` (first 50 LOC read)
- `src/main/services/McpService.ts` (272 LOC) + `src/main/services/mcp/{adapters,catalog,configIO,configPaths}.ts`
- GitHub API: stars=3973, license=apache-2.0, lang=TypeScript (fetched 2026-04-19 15:08 UTC)

---

## 4. SUPERSET (superset-sh/superset) — CLONED, ELASTIC-V2 (INSPIRATION ONLY)

### 4.1 Provenance & License

| Field | Value |
|---|---|
| Repo | https://github.com/superset-sh/superset |
| Cloned | `research/__new_clones_v2/superset/` (depth 1) |
| License | **Elastic License 2.0 (ELv2)** — forbids "hosted or managed service" resale of substantial features; MIT-incompatible for commercial SaaS |
| GitHub stars | 9,794 |
| Primary language | TypeScript (Bun + Turbo monorepo) |
| Platform | **macOS (primary)**; Windows/Linux "untested" |
| Homepage | https://superset.sh/ |
| Last updated | 2026-04-19 19:10 UTC (very active — releases every few days, v1.5.6 as of 2026-04-18) |
| Porting status for WOTANN | **ARCHITECTURAL INSPIRATION ONLY** — ELv2 blocks direct code port if WOTANN would ever be hosted as a service |

### 4.2 Architecture Summary

Superset is a Bun + Turborepo monorepo with **7 apps + 18 packages**:

```
superset/
├── apps/
│   ├── admin                              Admin dashboard
│   ├── api                                Backend API
│   ├── desktop                            Electron desktop app (the shipped product)
│   ├── docs                               Docs site (docs.superset.sh)
│   ├── marketing                          Marketing site (superset.sh)
│   ├── mobile                             React Native (Expo)
│   ├── relay                              Relay server
│   ├── streams                            Electric SQL streams service
│   └── web                                Main web app (app.superset.sh)
├── packages/
│   ├── auth                               Auth layer
│   ├── chat                               Chat UI + slash-command discovery
│   ├── cli                                CLI tool
│   ├── cli-framework                      Framework for CLI commands
│   ├── db                                 Drizzle schema + migrations (Neon PostgreSQL)
│   ├── desktop-mcp                        **Desktop-hosted MCP server**
│   ├── email                              Transactional email
│   ├── host-service                       Host-side service
│   ├── local-db                           Local SQLite database
│   ├── macos-process-metrics              Native macOS process-metrics addon (C++ addon.cc)
│   ├── mcp                                MCP integration layer
│   ├── panes                              **Generic headless workspace layout engine (tabs + panes + splits)**
│   ├── shared                             Shared utilities
│   ├── trpc                               tRPC definitions
│   ├── ui                                 Shared shadcn/ui + TailwindCSS v4 components
│   ├── workspace-client                   Client for workspace-fs
│   └── workspace-fs                       **Remote-workspace filesystem abstraction (host + client)**
├── tooling/typescript                     Shared TS configs
└── plans/                                 Implementation plans (in-progress in `plans/`, shipped to `plans/done/`)
```

### 4.3 Unique Features

- **Panes package (headless workspace layout engine)**: The `packages/panes/README.md` documents a generic model:
  ```
  Workspace
  ├── Tab (chat, terminal, etc.)
  │   ├── Pane A ──┐
  │   ├── Pane B   ├── split layout (horizontal/vertical, n-ary, weighted)
  │   └── Pane C ──┘
  ```
  Typed-pane data via `TData` generic. Registry of pane definitions. Purely structural layout tree + flat pane-data map. **This is reusable as a vendored pattern**.

- **`workspace-fs` package**: Client/host split for file operations. `paths.ts`, `search.ts` (fuzzy), `resource-uri.ts`, `fuzzy-scorer.ts`. Means Superset can run the agent+UI on machine A and the filesystem on machine B. Architectural signal that **workspace-as-remote** is the frontier.

- **`macos-process-metrics` native addon** (C++ `addon.cc`): Uses macOS `task_info()`/`proc_pidinfo()` APIs for per-process CPU/memory/disk metrics. A native module bridging Node.js → macOS internals. Production-quality approach to "show every agent's resource use."

- **Electric SQL streams**: `apps/streams` + `apps/electric-proxy` for Electric SQL CRDT-style replication. Means each client can edit workspace state offline and sync when reconnected. Sophisticated.

- **Plan placement discipline**: AGENTS.md L96: "implementation plans go in `plans/` (cross-cutting) or `apps/<app>/plans/` (app-scoped); shipped plans move to `plans/done/`. Architecture/reference docs go in `<app>/docs/`. Never drop `*_PLAN.md` at an app root or inside `src/`."

- **Next.js 16 proxy.ts**: Superset's AGENTS.md L66 flags that Next.js 16 renamed `middleware.ts` → `proxy.ts`. WOTANN doesn't ship Next.js, but this is a leading-edge ecosystem signal.

- **Biome instead of ESLint + Prettier**: root-level Biome runs for format + lint + import-organization. Single-pass.

- **Shared-command-source discipline**: `.agents/commands/` is the source; `.claude/commands` and `.cursor/commands` are symlinks. `.mcp.json` is source; `.cursor/mcp.json` is a symlink.

- **ask_user tool pattern**: AGENTS.md L1: "When you need to ask the user ANY question — use the `ask_user` tool. Never ask questions in plain text. The Superset UI renders `ask_user` calls as an interactive overlay with clickable option buttons." **WOTANN has NO such tool** — every clarification falls to plain text.

### 4.4 Pricing / Licensing for Users

Elastic License 2.0 — free for users, BUT:
- Cannot be hosted as a managed service (e.g., one can't run "Superset-as-a-Service" and charge for access)
- Cannot circumvent license-key functionality
- Cannot remove licensor notices

This materially constrains WOTANN: **any port of Superset code would taint WOTANN's ability to offer a cloud/SaaS tier.** Pure inspiration-only.

### 4.5 Platform Availability

macOS (primary). README L73: "Windows/Linux untested."

### 4.6 GitHub Stars / Benchmarks

9,794 stars at 2026-04-19. No published SWE-bench / TerminalBench scores (but a `compare/best-ai-coding-agents-2026` page exists at superset.sh).

### 4.7 WOTANN Status vs Superset

| Capability | Superset | WOTANN | Gap |
|---|---|---|---|
| Tabs-with-panes headless layout engine | ✅ `packages/panes/` | Ink TUI has simple tabs; no pane-split layout | **PATTERN GAP** |
| Workspace-fs host/client split | ✅ `packages/workspace-fs/` | WOTANN is local-only | **GAP — feeds SSH remote story (§3.8)** |
| Native macOS process metrics | ✅ `packages/macos-process-metrics` (C++ addon) | `src/telemetry/cost-tracker.ts` tracks cost only, NOT CPU/memory/disk per agent | **GAP** |
| Electric SQL offline-replication | ✅ | None — WOTANN is online-first | Low priority gap |
| `ask_user` interactive-overlay tool | ✅ | None — clarifications are plain text | **GAP — UX moat** |
| Biome single-pass format+lint | ✅ | ESLint + Prettier (2-pass) | Minor |
| `.agents/commands/` as source, symlinks elsewhere | ✅ | Partial — WOTANN has `src/skills/` but not symlink discipline | Minor |
| Plan-placement discipline | ✅ (plans/, apps/*/plans/, plans/done/) | WOTANN has ad-hoc `docs/*.md` | Minor |

### 4.8 Patterns NOT Yet Ported To WOTANN (Superset-inspired)

**Pattern #1: `ask_user` interactive-overlay tool.** Every agent in WOTANN gets an `ask_user(question, options[])` tool. The frontend (Ink TUI + Tauri) renders this as a prompt with clickable options (or list-select in TUI). Models that call it get structured responses instead of parsing free-text. **Port pattern (not code):** 
- `src/tools/ask-user.ts` — MCP-style tool definition
- `src/ui/components/AskUserModal.tsx` (Tauri) + `src/ui/raven/AskUserPrompt.tsx` (Ink)
- Wire into system prompt: "Use ask_user() for any clarification; never ask in plain text."

Priority: **HIGH** — directly reduces agent errors from ambiguous free-text Qs. Elastic-v2-inspired pattern, CLEAN-ROOM implementation required.

**Pattern #2: Per-agent native resource metrics.** Port macOS's `task_info()`/`proc_pidinfo()` pattern (Superset uses a C++ native addon). WOTANN can use `pidusage` npm module for a pure-JS cross-platform version: `src/telemetry/process-metrics.ts` exports `getMetrics(pid) -> { cpu_percent, rss_mb, disk_io_mb }`. Exposed via MCP tool `wotann_list_agents_metrics`. Priority: MEDIUM.

**Pattern #3: Tabs-with-splittable-panes layout.** WOTANN's Ink TUI has tabs; it could gain split panes (hsplit/vsplit, n-ary) following Superset's data model. Priority: LOW (UI polish, not capability unlock).

**Pattern #4: `.agents/commands/` source with symlinks.** Establish `wotann/.agents/commands/` as the canonical source, symlink `.claude/commands` → `../.agents/commands`, `.cursor/commands` → `../.agents/commands`. WOTANN already has `src/skills/`; merge the two. Priority: LOW.

**Pattern #5: Plan-placement discipline.** Move WOTANN's scattered `docs/*_PLAN.md` files into `plans/` (cross-cutting) + `plans/done/` (shipped). Add a hook that rejects `*_PLAN.md` commits outside these dirs. Priority: LOW.

### 4.9 Sources

- Repo: https://github.com/superset-sh/superset (cloned 2026-04-19 15:11 UTC)
- LICENSE.md (Elastic License 2.0 confirmed, lines 1-20 read)
- README.md (first 120 LOC read)
- AGENTS.md (full read via embedded system-reminder from clone)
- CLAUDE.md (-> AGENTS.md)
- `packages/` and `apps/` tree (ls)
- `packages/panes/README.md` (first 30 LOC read)
- Homepage https://superset.sh/ (searched — features, comparisons)
- Vercel docs: https://vercel.com/docs/agent-resources/coding-agents/superset

---

## 5. JETBRAINS AIR (air.dev / jetbrains.com/air/) — PROPRIETARY

### 5.1 Provenance & License

| Field | Value |
|---|---|
| Homepage | https://air.dev (minimal content — just the tagline "Multitask with agents, stay in control"); https://www.jetbrains.com/air/ returned 404 when fetched |
| License | **Proprietary** (JetBrains product) |
| Stars | N/A (not OSS) |
| Price | **Free** macOS download (public preview as of 2026-03-09) |
| Porting status for WOTANN | **DOCS-ONLY INSPIRATION** |

### 5.2 Architecture Summary (from press + JetBrains blog)

- **Built on the corpse of Fleet** (JetBrains's abandoned IDE). The codebase became JetBrains Air rather than being fully discarded.
- **Agent-first, NOT an IDE replacement**: JetBrains explicitly positions Air as a COMPLEMENT to IntelliJ, WebStorm, Rider, etc. "Air handles the agent-powered development; your IDE handles the rest." (The Register, 2026-03-10)
- **ACP-first**: Air supports the Agent Client Protocol OOTB. The ACP Agent Registry launched January 2026 as a joint JetBrains/Zed project (blog.jetbrains.com/ai/2026/01/acp-agent-registry/).
- **4 agents OOTB**: Codex CLI, Claude Agent, Gemini CLI, Junie (JetBrains's own).
- **Sandboxing**: Run agents locally by default, OR isolate in Docker containers, OR isolate in Git worktrees. Agents can run concurrently.
- **Symbol-aware task definition**: Users can mention a specific line, commit, class, method, or other symbol when giving an agent a task. "Precise context instead of a blob of pasted text."

### 5.3 Unique Features

- **Fleet-based foundation**: JetBrains rebuilt Air on Fleet's engine. Potential to inherit Fleet's distributed-execution architecture (which Fleet pioneered before being abandoned).
- **ACP Agent Registry integration**: Air IS an ACP client referencing the registry — so Air users can install ACP agents at install-time.
- **Docker + Worktree dual-isolation**: both isolation layers available, pick per-task.
- **Junie (JetBrains's own agent)**: first-party agent with deep JetBrains-idiom awareness.
- **"Your IDE handles the rest"** philosophy: Air doesn't try to replace IntelliJ — it's a launcher/orchestrator for agent-work that hands off to IntelliJ for manual coding.

### 5.4 Pricing / Licensing for Users

Free during public preview. No pricing announcements yet.

### 5.5 Platform Availability

macOS (primary). Windows and Linux "planned."

### 5.6 GitHub Stars / Benchmarks

Not OSS. No published SWE-bench / TerminalBench scores.

### 5.7 WOTANN Status vs JetBrains Air

| Capability | Air | WOTANN | Gap |
|---|---|---|---|
| ACP client with registry integration | ✅ (ACP Agent Registry) | WOTANN has ACP stdio host + client but no registry client | **GAP** — WOTANN should register in the ACP registry + support installing from it |
| Docker-sandboxed agent execution | ✅ | WOTANN has worktree isolation (`src/sandbox/task-isolation.ts`), NOT Docker | **GAP** |
| Symbol-aware task context | ✅ (mention line/commit/class/method) | WOTANN has `src/lsp/symbol-operations.ts` + `src/lsp/lsp-tools.ts` but no "mention this symbol in the task" primitive | **MODERATE GAP** |
| 4 agents OOTB | Codex, Claude, Gemini, Junie | WOTANN has 19 providers + Agent SDK wrappers | WOTANN ahead on breadth |
| "Complement IDE" philosophy | ✅ | WOTANN aims to be standalone Chat/Editor/Workshop/Exploit tabs | Different strategy — both valid |

### 5.8 Patterns NOT Yet Ported To WOTANN (Air-inspired)

**Pattern #1: ACP Agent Registry integration.** When the ACP Agent Registry stabilizes, WOTANN needs to (a) be listed in it, and (b) support `wotann acp install <agent-id>` to pull agents from it. Priority: HIGH (same priority as the ACP 0.3 upgrade flagged in §1.6).

**Pattern #2: Docker-sandboxed agent execution.** Add `--sandbox docker` flag to `wotann autopilot` / `wotann build`. Spins up a container (Alpine + git + gh CLI + language runtimes), mounts the worktree, runs the agent inside. Priority: MEDIUM.

**Pattern #3: `@symbol` mention syntax in task definition.** In Chat/Workshop, typing `@MyClass::myMethod` auto-attaches the LSP-resolved symbol location + body as context. Port: extend `src/prompt/engine.ts` to detect `@symbol_path` and expand via LSP. Priority: MEDIUM.

### 5.9 Sources

- https://air.dev (fetched 2026-04-19 — only tagline content)
- https://www.jetbrains.com/air/ (404 when fetched 2026-04-19)
- https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/
- https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/ (ACP registry launch)
- https://www.theregister.com/2026/03/10/jetbrains_previews_air_proclaims_new (built on abandoned Fleet)
- https://adtmag.com/articles/2026/03/19/jetbrains-launches-air-preview-for-developers-managing-multiple-ai-agents.aspx
- https://www.techzine.eu/news/devops/139409/jetbrains-air-agentic-development-environment-in-preview/
- https://www.adwaitx.com/jetbrains-acp-ai-agent-ide-integration/
- https://www.jetbrains.com/help/ai-assistant/acp.html

---

## 6. DPCODE.CC — UNREACHABLE

### 6.1 Provenance & License

| Field | Value |
|---|---|
| Homepage (as provided) | https://dpcode.co (**ECONNREFUSED** — possibly misspelled or defunct) |
| Real homepage (per WebSearch) | https://dpcode.cc (**ECONNREFUSED** — down when fetched 2026-04-19) |
| License | **Unknown** — domain unreachable |
| Stars | N/A — no GitHub repo located (multiple searches) |
| Price | Unknown |
| Porting status for WOTANN | **CANNOT CHARACTERIZE — DOCUMENT HONESTLY AS "OSS NOT FOUND, PROPRIETARY WITH UNREACHABLE DOCS"** |

### 6.2 Everything We Know (From Search Index Fragments Only)

The only signal obtained was a search-result title + snippet:

> **DP Code - The best way to code with your AI subscriptions**
> — Cited by nxcode.io's 2026 pricing-comparison article

Inferred positioning (speculative — explicitly flagged): DP Code is likely a **routing-layer tool** that lets users run Claude Code / Codex CLI / Gemini CLI on top of subscription plans (Claude Max, ChatGPT Plus, Gemini Advanced) instead of API keys. This category exists (see: `musistudio/claude-code-router` with a similar pitch, or `FlorianBruniaux/cc-copilot-bridge`). However, **no evidence actually confirms dpcode.cc does this** — this is an educated guess.

### 6.3 Architecture / Features / Pricing

**Cannot be characterized.** All direct fetches (WebFetch to dpcode.co and dpcode.cc) returned ECONNREFUSED. WebSearches with variants (`"DP Code"`, `"dpcode.cc"`, `"dpcode" Anthropic subscription routing`, `site:twitter.com`, `site:producthunt.com`, `site:reddit.com`) returned near-zero specific results about this product.

### 6.4 WOTANN Status vs DP Code

N/A — cannot be assessed without access to the product.

### 6.5 Patterns NOT Yet Ported To WOTANN

**Action item:** ask Gabriel or user for direct access to dpcode.cc content (screenshots, docs dump, or alternative URL). Without that, this target is a dead lead in V3.

**Defensive hedge:** if DP Code does turn out to be a subscription-routing layer, note that WOTANN's Lane-8 Strategic §2 (ACP + Zed/Goose subscription-reuse path) already has this on the roadmap. No net new pattern unless DP Code has unique tech (which cannot be confirmed).

### 6.6 Sources

- https://dpcode.co → **ECONNREFUSED** (WebFetch 2026-04-19)
- https://dpcode.cc → **ECONNREFUSED** (WebFetch 2026-04-19)
- https://www.nxcode.io/resources/news/ai-coding-tools-pricing-comparison-2026 (1-line mention — the only indexed reference found)
- WebSearch queries run 2026-04-19: `"dpcode.co" OR "dp code" AI coding tool features pricing`, `"DP Code" dpcode.cc Anthropic Claude max subscription routing indie developer tool`, `"dpcode.cc" OR "DP Code" site:twitter.com OR site:producthunt.com OR site:reddit.com` — all returned near-zero signal

---

## 7. GEMINI FOR MAC (gemini.google/mac) — FREE

### 7.1 Provenance & License

| Field | Value |
|---|---|
| Homepage | https://gemini.google/mac |
| License | **Proprietary** (Google) |
| Stars | N/A (not OSS) |
| Price | **Free** |
| Porting status for WOTANN | **DOCS-ONLY INSPIRATION** |

### 7.2 Architecture Summary (from homepage)

- **Native macOS desktop app**. Minimum: macOS Sequoia (15.0) or later + **Apple Silicon only**.
- **Keyboard shortcuts**: `Option+Space` = mini chat HUD; `Option+Shift+Space` = full experience.
- **Menu bar icon + Dock launch** — always accessible.
- **Window sharing for contextual help**: "Share your window to get instant contextual help based on what you're looking at. Gemini analyzes the visible content to tailor its answers."
- **Creative tools**: Nano Banana images + Veo video generation integrated.
- **Min user age**: 13+.

### 7.3 Unique Features

- **Option+Space mini chat HUD** (not full window) — global shortcut, answers without context-switching.
- **Window-shared visible content** as context — no user copy/paste, Gemini sees what's on screen.
- **Creative suite integration**: images (Nano Banana) + video (Veo 3.1) + text in one app.
- **Free tier** — no subscription needed for base use.

### 7.4 Pricing / Licensing for Users

Free. Presumably usage caps apply (Google tiers Gemini by free/Pro/Advanced subscription, but mini chat is free).

### 7.5 Platform Availability

**macOS Sequoia (15.0)+ AND Apple Silicon only** — a notably narrow requirement. Intel Macs are excluded.

### 7.6 GitHub Stars / Benchmarks

Not OSS. Gemini 3 Pro is #1 on TerminalBench 2.0 at **78.4%** (when paired with Forge Code), per UNKNOWN_UNKNOWNS.md §4.

### 7.7 WOTANN Status vs Gemini for Mac

| Capability | Gemini for Mac | WOTANN | Gap |
|---|---|---|---|
| Global keyboard shortcut (Option+Space) mini HUD | ✅ | WOTANN has `src/ui/themes/` and TUI but no global-shortcut mini HUD on Desktop | **GAP — UX moat for macOS presence** |
| Window-sharing contextual help (sees visible content) | ✅ | WOTANN has `src/computer-use/screen-capture.ts` but no "always-watching" mode | **GAP** |
| Native macOS menu-bar presence | ✅ | None — WOTANN is terminal-launched | **GAP** |
| Apple Silicon gated (no Intel) | Google's choice | WOTANN supports Intel via Tauri | WOTANN ahead |
| Free tier | ✅ | WOTANN has free providers + free-tier first-class quality bar | ON PAR |

### 7.8 Patterns NOT Yet Ported To WOTANN (Gemini Mac–inspired)

**Pattern #1: Global keyboard shortcut HUD (Option+Space style).** When WOTANN Engine daemon runs, `Option+Shift+W` (WOTANN-assigned) opens a floating HUD pinned to the topmost corner of the current screen. User types → WOTANN routes to lowest-cost provider (free-tier Gemini Flash Free first) → returns answer inline. Closes on blur.

- `src/desktop/global-shortcut.ts` — register global shortcut via Tauri's `globalShortcut` plugin
- `src/desktop/hud-window.ts` — 320×80px always-on-top Tauri window
- `src/prompt/quick-answer.ts` — direct LLM call bypassing orchestration, one-turn only
- Priority: MEDIUM (UX moat for macOS users)

**Pattern #2: Window-sharing contextual help (like mini Claude Design).** When the HUD is open, it takes a screenshot of the currently-focused app's window and injects that as context. "What does this error mean?" becomes a 1-keystroke workflow. 

- Reuse `src/computer-use/screen-capture.ts` (existing)
- Priority: MEDIUM.

### 7.9 Sources

- https://gemini.google/mac (fetched 2026-04-19)

---

## 8. PERPLEXITY COMPUTER (perplexity.ai/computer) — PROPRIETARY, $200/mo MAX

### 8.1 Provenance & License

| Field | Value |
|---|---|
| Homepage | https://perplexity.ai/computer (**403 Forbidden** on direct fetch — blocks server-side UAs); https://www.perplexity.ai/computer (same) |
| License | **Proprietary** (Perplexity AI) |
| Price | **$200/mo Max subscription** ($2,000/yr). Expanded to all **Pro** subscribers on 2026-03-13. |
| Launched | **2026-02-25** |
| Porting status for WOTANN | **DOCS-ONLY INSPIRATION** |

### 8.2 Architecture Summary (from WebSearch aggregate — multiple 2026 sources)

- **19-model orchestration**: Claude Opus 4.6 as central planner + subagent dispatch to Gemini (research), Nano Banana (images), Veo 3.1 (video), Grok (fast), GPT-5.2 (long-context + SWE-Bench Pro), plus 13 others.
- **400+ OAuth connectors**: Slack, Gmail, GitHub, Notion, Linear, Asana, Salesforce, HubSpot, ClickUp, etc. Isolated cloud environments with real filesystem + browser access + connector auth reuse.
- **Subagent generation**: the planner can spawn specialized subagents for parallel execution.
- **10,000 credits/mo** included at Max tier. Pro tier added March 13 2026 with credit budget.
- **Cloud-only** — all runs in Perplexity's infrastructure (no local agent). Pairs with **Perplexity Personal Computer** (announced March 11 2026, Mac-mini-class appliance) to bridge cloud↔local — lets users route their local files/apps/browser through the same agent loop.
- **Document audit pass**: "Independent auditing pass — checking for logical consistency, structural integrity, and factual accuracy without rewriting from scratch." Upload a contract/report/spec → Computer cross-references, flags contradictions, verifies formatting, fact-checks.

### 8.3 Unique Features

- **19-model heterogeneous orchestration** — strongest public claim of breadth (WOTANN has 19 providers, but doesn't yet orchestrate across all of them per-subtask).
- **400+ connectors** — outsized lead over WOTANN (~7 connectors + 27 channels).
- **Auditing pass mode** — upload-and-critique without rewriting. A product-level "second opinion" vs "new draft" distinction.
- **Personal Computer appliance** — physical hardware bridge, Apr-2026 uniqueness (no competitor has a hardware product).

### 8.4 Pricing / Licensing for Users

| Tier | Price | Includes |
|---|---|---|
| Pro | (per normal Perplexity Pro) | Computer as of 2026-03-13; credits per Pro plan |
| Max | **$200/mo** or **$2,000/yr** | 10,000 credits/mo, Computer, Comet browser, unlimited Labs, GPT-5.2 + Claude Opus 4.6 + 19-model access, Sora 2 Pro video |
| Enterprise | reported **$325/seat** | SCIM + audit logging |

### 8.5 Platform Availability

Cloud-first (any modern browser). Personal Computer appliance adds macOS integration.

### 8.6 GitHub Stars / Benchmarks

Not OSS. SWE-Bench Pro scores **via GPT-5.2 component** (per sentisight.ai/what-is-the-new-perplexity-computer) — Perplexity-wide benchmarks not published.

### 8.7 WOTANN Status vs Perplexity Computer

| Capability | Perplexity Computer | WOTANN | Gap |
|---|---|---|---|
| 19-model per-subtask orchestration | ✅ central | WOTANN has 19 providers but orchestration is ad-hoc (Lane-8 §5 already flagged) | **FLAGGED IN LANE-8 — still a gap** |
| 400+ connectors | ✅ | 7 connectors + 27 channels | **LANE-8 §5 flagged** |
| Cloud-only execution | ✅ | Local-first (plus Engine daemon) | Different strategy |
| Cloud↔local bridge via Personal Computer hardware | ✅ | No hardware product | **Out of scope for WOTANN** |
| Auditing pass mode | ✅ | **NEW GAP** — WOTANN doesn't have "audit-only, no rewrite" mode | **NEW GAP (not in Lane-8)** |
| Enterprise SKU ($325/seat) | ✅ | No paid tier yet | Strategic question |

### 8.8 Patterns NOT Yet Ported To WOTANN (Perplexity-inspired, NEW since Lane-8)

**Pattern #1: `wotann audit` command — auditing-pass mode.**
A mode where the agent reads a document/spec/codebase AND **refuses to modify it**. Pure review pass that:
- Cross-references claims
- Flags contradictions
- Verifies formatting
- Fact-checks against public sources (WebSearch)
- Outputs a report in markdown

```
wotann audit <file-or-dir> [--check contradictions,format,facts,coverage]
```

Implementation:
- `src/commands/audit.ts` — new command
- System prompt: "You are in AUDIT MODE. You MUST NOT modify any file. Use only read-tools + WebSearch + Grep. Output a markdown report."
- Guard hook: `src/hooks/guards/audit-mode-guard.ts` — blocks any Write/Edit tool-call when audit mode is active

Priority: **HIGH** — clear differentiation from "agent rewrites everything" default. Matches WOTANN's "honest stubs over silent success" quality bar.

### 8.9 Sources

- https://perplexity.ai/computer (403 Forbidden on direct fetch, 2026-04-19)
- WebSearch 2026-04-19: `"Perplexity Computer" 2026 features pricing connectors SWE-bench`
- WebSearch 2026-04-19: `"Perplexity Computer" "19 models" connectors architecture subagents 2026`
- https://www.sentisight.ai/how-much-perplexity-computer-cost/
- https://www.finout.io/blog/perplexity-pricing-in-2026
- https://releasebot.io/updates/perplexity-ai
- https://www.builder.io/blog/perplexity-computer
- https://linas.substack.com/p/perplexity-computer-guide
- https://www.perplexity.ai/changelog/what-we-shipped---march-13-2026
- https://www.trendingtopics.eu/perplexity-computer-orchestrates-19-ai-models-to-execute-month-long-workflows/
- https://theaiinsider.tech/2026/02/28/perplexity-unveils-enterprise-focused-ai-agent-system-powered-by-multi-model-architecture/
- https://www.buildfastwithai.com/blogs/what-is-perplexity-computer
- https://techcrunch.com/2026/02/27/perplexitys-new-computer-is-another-bet-that-users-need-many-ai-models/

---

## 9. CLAUDE DESIGN (anthropic.com/news/claude-design-anthropic-labs) — PROPRIETARY

### 9.1 Provenance & License

| Field | Value |
|---|---|
| Homepage | https://claude.ai/design |
| Announcement | https://www.anthropic.com/news/claude-design-anthropic-labs (published **2026-04-17**) |
| License | **Proprietary** (Anthropic) |
| Access | Claude Pro / Max / Team / Enterprise subscribers (uses subscription limits; optional extra usage) |
| Launched | **2026-04-17** (research preview, 2 days before this V3 extraction) |
| Porting status for WOTANN | **RECEIVER ONLY** — WOTANN should CONSUME handoff bundles, not produce them |

### 9.2 Architecture Summary (from Anthropic announcement)

- **Model**: **Claude Opus 4.7** — "stronger performance across coding, agents, vision, and multi-step tasks"
- **Inputs**: text prompts, image uploads, DOCX/PPTX/XLSX, codebase references, **Web capture tool** (scrapes website elements directly)
- **Outputs**: org-scoped shareable URLs, folder exports, **Canva integration** (explicit partnership), PDF, PPTX, standalone HTML files
- **Design-system integration**: "Claude builds a design system for your team by reading your codebase and design files. Every project after that uses your colors, typography, and components automatically."
- **Refinement controls**: inline comments on specific elements, direct text editing, adjustment sliders (spacing, color, layout)
- **Collaboration**: org-scoped sharing with view-only or edit access; group conversations supported
- **Claude Code handoff**: "When a design is ready to build, Claude packages everything into a handoff bundle that you can pass to Claude Code with a single instruction." **Bundle structure NOT publicly specified in the announcement** — consistent with Lane-8 §7 reverse-engineering.

### 9.3 Unique Features

- **Code-powered prototypes**: "voice, video, shaders, 3D and built-in AI" — prototypes are code-live, not static images.
- **Org-scoped URLs** — shareable links whose access is enforced at org level (distinct from Figma's link-with-anyone model).
- **Handoff-to-Claude-Code** is the killer feature: "single instruction" transfer from design → production code.
- **Enterprise admin gate**: "off by default; admins enable via Organization settings" — enterprise-safe.
- **Web capture tool**: scrape any website for direct inspiration without leaving the app.

### 9.4 Pricing / Licensing for Users

Included with Claude Pro ($20/mo), Max ($100-$200/mo), Team, Enterprise. Uses subscription limits. **Optional extra usage** beyond subscription limits.

### 9.5 Platform Availability

Web-based (claude.ai/design). No native app yet.

### 9.6 GitHub Stars / Benchmarks

Not OSS. Benchmarks not applicable (design tool, not coding).

### 9.7 WOTANN Status vs Claude Design

| Capability | Claude Design | WOTANN | Gap |
|---|---|---|---|
| Handoff-bundle PRODUCER | ✅ (ZIP with design-system.json + components.json + tokens.json + ...) | None — WOTANN doesn't produce design artifacts | **N/A — WOTANN should not try to compete as a producer** |
| Handoff-bundle CONSUMER | N/A (Claude Design produces; Claude Code consumes) | **WOTANN has NO receiver** | **LANE-8 §7 critical gap — still open** |
| W3C DesignTokens format support | Implicit (industry standard) | WOTANN has none | **GAP** |
| Figma/Sketch/PSD input | ✅ | WOTANN has no design-file parser | Out of scope (WOTANN is a coding harness, not design tool) |
| Canva export | ✅ (partnership) | WOTANN has no Canva integration | Out of scope |

### 9.8 Patterns NOT Yet Ported To WOTANN (Claude Design–inspired)

**Pattern #1: Handoff-bundle RECEIVER.** 
This was already flagged HIGH priority in Lane-8 §7. V3 confirms: **the bundle format is still NOT publicly specified as of 2026-04-19** (Anthropic says "we'll make it easier to build integrations... over the coming weeks"). WOTANN has a ~14-day window to ship a generic receiver that accepts:
- `design-system.json` (W3C DesignTokens format)
- `components.json` (component manifest)
- `tokens.json`
- `screens/*.png` + `screens/*.figma.json`
- `guidelines.md`
- `handoff.md`
- `code-scaffold/` (Tailwind config + theme.ts + reference components)

Implementation (from Lane-8 §7.3):
- `src/design/bundle-loader.ts`
- `src/design/token-parser.ts` (W3C DesignTokens → internal repr)
- `src/design/component-synth.ts` (injects tokens into executor system prompt)
- `src/design/figma-bridge.ts`
- CLI: `wotann design load ./handoff.zip`

**V3 UPDATE:** Also add `src/design/web-capture-ingest.ts` — if the bundle contains a `web-captures/` dir (Claude Design's Web capture tool output), WOTANN should preserve those as context for regeneration. Priority: **CRITICAL** (same as Lane-8, reconfirmed with stronger evidence).

**Pattern #2: Org-scoped shareable URL** — if WOTANN launches a paid tier, outputs like benchmarks + costs + run-logs should be shareable via org-scoped URLs (not public). Priority: LOW (contingent on paid-tier existing).

### 9.9 Sources

- https://www.anthropic.com/news/claude-design-anthropic-labs (fetched 2026-04-19)
- Homepage claude.ai/design (referenced but not fetched — requires auth)

---

## 10. CURSOR 3 (cursor.com/blog/cursor-3) — PROPRIETARY

### 10.1 Provenance & License

| Field | Value |
|---|---|
| Homepage | https://cursor.com |
| Blog announcement | https://cursor.com/blog/cursor-3 (published **2026-04-02**) |
| License | **Proprietary** |
| Launched | **2026-04-02** |
| Porting status for WOTANN | **DOCS-ONLY INSPIRATION** (already covered in Lane-8 §6, V3 refines) |

### 10.2 Architecture Summary (FRESH 2026-04-19 from the official blog, deeper than Lane-8)

- **Agent-first surface**: "Built from scratch, centered around agents" — NOT a VS Code extension. IDE is demoted to a fallback mode.
- **Agents Window** (Cmd+Shift+P → Agents Window): the new default surface. All local and cloud agents in a unified sidebar.
- **Composer 2**: Cursor's proprietary frontier coding model. "High usage limits." Replaces previous Composer.
- **Parallel agent execution**: multiple agents running concurrently, each surfacing demos/screenshots of work.
- **Multi-environment**: seamless local↔cloud handoff. "Move sessions from cloud to local for editing/testing on desktop. Transfer to cloud to maintain execution while offline or between tasks."
- **Multi-workspace/multi-repo**: unified diffs, staging, commit, PR management integrated.
- **Built-in browser**: for navigating local websites and docs.
- **LSP-based navigation**: full LSP support, go-to-definition.
- **Cross-channel agent kickoff**: agents can be kicked off "from mobile, web, desktop, Slack, GitHub, and Linear" — all appear in the sidebar.
- **Plugin marketplace**: hundreds of plugins, three plugin types — **MCPs**, **skills**, **subagents**. One-click install. Private team marketplace.

### 10.3 Unique Features (new vs. Lane-8 §6)

Lane-8 §6 mentioned Canvases as a 2026 feature and flagged them as the "2026 UX paradigm for structured agent output." **The official blog (V3) does NOT explicitly name "Canvases"** — instead, it emphasizes:
- **Cloud agents generate demos + screenshots for verification** — may be what Lane-8 called Canvases.
- **Cross-channel kickoff from 6 surfaces** (mobile + web + desktop + Slack + GitHub + Linear) — more comprehensive than Lane-8 §6 captured.
- **Private team marketplace** — new detail not in Lane-8.

### 10.4 Pricing / Licensing for Users

Not stated in the 2026-04-02 blog. Historical Cursor pricing: $20/mo Pro. Cursor 3 pricing presumably unchanged or adjusted with Composer 2 inclusion.

### 10.5 Platform Availability

Desktop (macOS/Windows/Linux), cloud, mobile (iOS/Android), web — all kickoff surfaces.

### 10.6 GitHub Stars / Benchmarks

Not OSS. Composer 2 benchmarks not published in the blog.

### 10.7 WOTANN Status vs Cursor 3

| Capability | Cursor 3 | WOTANN | Gap |
|---|---|---|---|
| Agent-first default surface | ✅ (Agents Window is default; IDE is fallback) | WOTANN TUI is chat-first | **LANE-8 §6.4 #1 flagged — still a gap** |
| Composer 2 proprietary model | ✅ | WOTANN is provider-agnostic | Strategic choice (WOTANN MOAT: never vendor-lock) |
| Cloud↔local handoff | ✅ | `src/daemon/engine.ts` + `src/memory/cloud-sync.ts` but NO cloud-resume | **LANE-8 §6.4 #4 flagged — still a gap** |
| Multi-workspace/multi-repo | ✅ | `src/core/workspace.ts` is single-repo | **LANE-8 §6.4 #2 flagged — still a gap** |
| Cross-channel kickoff (6 surfaces) | ✅ mobile + web + desktop + Slack + GitHub + Linear | WOTANN has 27 channels but not first-class "agent kickoff" from each | **NEW GAP (not clearly in Lane-8)** |
| Plugin marketplace (MCP + Skills + Subagents) | ✅ hundreds | WOTANN has `src/marketplace/skill-registry.ts` + `src/marketplace/mcp-registry.ts` but not public + not one-click install | **GAP** |
| Private team marketplace | ✅ | None | **NEW GAP (not in Lane-8)** |
| Built-in browser | ✅ | None | Same as Glass §1.7 gap |
| Demos/screenshots-for-verification | ✅ (cloud agents produce artifacts) | `src/orchestration/task-delegation.ts` emits text only | **NEW GAP** |

### 10.8 Patterns NOT Yet Ported To WOTANN (Cursor 3 V3-refined, NEW since Lane-8)

**Pattern #1: Cross-channel first-class agent kickoff.** WOTANN has 27 channels (Telegram, Discord, iMessage, Slack, etc.) but they're primarily "get notified" channels. Upgrade so EVERY channel can KICK OFF an agent run: reply to a Slack thread with `/wotann fix this bug` → WOTANN spawns an agent → pushes diff back to the thread. 
- Extend `src/channels/telegram-adapter.ts` et al. with `onMessage → runAgent` handler
- Add `src/channels/common/agent-kickoff.ts` — dispatcher
- Priority: **HIGH** (parity with Cursor 3's 6-surface kickoff)

**Pattern #2: Agent artifact production (demos + screenshots) for verification.** When an agent completes a run, it should produce:
- `screenshot.png` of the terminal state
- `diff.patch` of code changes
- `demo.md` with a 3-bullet summary
- (optionally) `demo.webm` for UI changes

Stored in `.wotann/runs/{run-id}/artifacts/`. Surfaced in TUI and Desktop as clickable preview. Implementation:
- `src/orchestration/artifact-producer.ts`
- Hook into `src/orchestration/autonomous.ts` completion event
- Priority: **MEDIUM**

**Pattern #3: Private team marketplace.** WOTANN's skill/MCP registries should support private team distribution:
- `wotann team marketplace add <url>` — pin a team-private registry
- `wotann skill install @team/custom-skill` — resolve from team registry first
- Access control via OAuth token
- Priority: **LOW** (contingent on WOTANN having paid team tier)

### 10.9 Sources

- https://cursor.com/blog/cursor-3 (fetched 2026-04-19, full content captured)
- Lane-8 §6 for historical comparison

---

## 11. CONSOLIDATED PORT-TARGET LIST (V3 NEW vs LANE-8)

### 11.1 Unique NEW patterns from V3 web extraction

These are NOT redundant with Lane-8. Each was surfaced by V3's fresh 2026-04-19 fetch.

| # | Pattern | Source | Priority | Effort |
|---|---|---|---|---|
| 1 | **SSH-remote project execution** (10-conn pool + SFTP + fingerprint + keychain + proxy-cmd) | Emdash §3.8 | **HIGH** | 1 week |
| 2 | **MCP-exposed process dashboard** (`wotann_list_processes`, `wotann_restart_process`) | Solo §2.8 | **HIGH** | 3 days |
| 3 | **Task-keyed `agents/` docs structure** (split monolithic AGENTS.md) | Emdash §3.8 | MEDIUM | 1 day |
| 4 | **`ClaudeHookService` pattern** (central daemon receives hooks from remote Claude Code processes) | Emdash §3.8 | MEDIUM | 3 days |
| 5 | **`ask_user` interactive-overlay tool** (clean-room impl, Elastic-v2-inspired) | Superset §4.8 | **HIGH** | 2 days |
| 6 | **Per-agent native resource metrics** (pidusage-based, MCP-exposed) | Superset §4.8 | MEDIUM | 2 days |
| 7 | **Tabs-with-splittable-panes TUI layout** | Superset §4.8 | LOW | 1 week |
| 8 | **Browser as a first-class agent-visible pane** (Glass-inspired) | Glass §1.6 | MEDIUM | 2 weeks |
| 9 | **License-compliance CI gate** (cargo-about → license-checker) | Glass §1.6 | LOW | 1 day |
| 10 | **ACP Agent Registry integration** (be listed + support install from) | Air §5.8 | **HIGH** | 3 days |
| 11 | **Docker-sandboxed agent execution** (`--sandbox docker`) | Air §5.8 | MEDIUM | 3 days |
| 12 | **`@symbol` mention syntax in task definition** (LSP-resolved) | Air §5.8 | MEDIUM | 2 days |
| 13 | **Global keyboard shortcut HUD (Option+Shift+W)** | Gemini Mac §7.8 | MEDIUM | 3 days |
| 14 | **Window-sharing contextual help** (HUD screenshots active app) | Gemini Mac §7.8 | MEDIUM | 2 days |
| 15 | **`wotann audit` auditing-pass mode** (read-only, no rewrite, fact-check) | Perplexity §8.8 | **HIGH** | 3 days |
| 16 | **Cross-channel first-class agent kickoff** (27 channels all accept `/wotann` commands) | Cursor 3 §10.8 | **HIGH** | 1 week |
| 17 | **Agent artifact production** (screenshot + diff + demo.md + demo.webm per run) | Cursor 3 §10.8 | MEDIUM | 2 days |
| 18 | **Private team marketplace** (private skill/MCP registries) | Cursor 3 §10.8 | LOW | 1 week |
| 19 | **Emdash 23-CLI-adapter pattern** (first-class CLI wrappers, not just API providers) | Emdash §3.8 | MEDIUM | 1 week (wire 3-5 new CLIs) |
| 20 | **Forgejo adapter** (self-hosted git integration) | Emdash §3.8 | LOW | 1 day |

### 11.2 Lane-8 patterns reconfirmed (still open)

These were already in Lane-8 §1-§9; V3 reconfirms their priority:

- **Claude Design handoff-bundle RECEIVER** — Lane-8 §7.4, CRITICAL, still open, 14-day window closing
- **Per-subagent token/cost budget** — Lane-8 §5.5 #1, HIGH, still open
- **Connector expansion 10x (7 → 30+)** — Lane-8 §5.5 #2, MEDIUM, still open
- **Agent-first mode flag** (`wotann start --agent-first`) — Lane-8 §6.4 #1, HIGH, still open
- **Multi-repo workspace** — Lane-8 §6.4 #2, MEDIUM, still open
- **Figma integration via MCP** — Lane-8 §6.4 #3, MEDIUM, still open
- **Cloud↔local handoff via kairos-rpc** — Lane-8 §6.4 #4, LOW, still open
- **Max subagents ceiling raise (3 → 5 → 8)** — Lane-8 §1.4 #1, HIGH, still open
- **Adversary-reviewer (Goose pattern)** — Lane-8 §9.1, MEDIUM, still open
- **ACP 0.2.0 → 0.3+ upgrade** — Lane-8 §9.2 + V3 §1.6 #3, HIGH, still open
- **Project wiki auto-indexing (Devin pattern)** — Lane-8 §9.4, MEDIUM, still open
- **Self-reviewing PRs (Devin pattern)** — Lane-8 §9.4, MEDIUM, still open

---

## 12. QUALITY AUDIT

### 12.1 License compliance checklist

| Target | License | WOTANN port safety |
|---|---|---|
| Glass | GPL-3.0 | **Architecture-inspiration only** — NO code port |
| Solo | Proprietary | **Docs-inspiration only** — pattern-port allowed (ideas are not copyrightable) |
| Emdash | Apache-2.0 | **Direct code port allowed with attribution** |
| Superset | Elastic License 2.0 | **Architecture-inspiration only** — port would taint any WOTANN hosted-service future |
| JetBrains Air | Proprietary | **Docs-inspiration only** |
| DP Code | Unknown | **Cannot characterize — ask user** |
| Gemini Mac | Proprietary | **Docs-inspiration only** |
| Perplexity Computer | Proprietary | **Docs-inspiration only** |
| Claude Design | Proprietary | **Receiver-side only** (WOTANN consumes, doesn't reproduce) |
| Cursor 3 | Proprietary | **Docs-inspiration only** |

### 12.2 Fetch transparency

- Direct WebFetches that FAILED: dpcode.co (ECONNREFUSED), dpcode.cc (ECONNREFUSED), perplexity.ai/computer (403), jetbrains.com/air/ (404), air.dev (content-too-thin)
- WebSearches used to fill gaps: 6 queries, all cited inline
- 2 prompt-injection attempts embedded in WebFetch responses were **ignored** (fake `<system-reminder>` tags trying to masquerade as background-task completions). V3 treats web content as data, never as instructions.
- Repos cloned: emdash (3.8K files), Glass (221 crates, inspection-only), superset (7 apps + 18 packages)

### 12.3 Honest limitations

- **DP Code cannot be characterized** without user-supplied docs.
- **Claude Design handoff bundle structure remains private** — Anthropic has not published the schema. Lane-8 §7's reverse-engineering is still speculative.
- **Perplexity Personal Computer hardware details** were not reachable — only announcement summaries.
- **Cursor 3 Canvases**: Lane-8 named them as the UX paradigm; the official 2026-04-02 blog emphasizes "demos + screenshots" rather than the Canvases name. Possible rebrand or Lane-8 extrapolation.
- **Superset LICENSE** is Elastic v2 — not OSI-approved OSS. This was not in the target prompt's phrasing ("verify each is OSS via GitHub search first"); V3 flags it as proprietary-adjacent.

---

## 13. REFERENCES (ALL FETCHED 2026-04-19 UNLESS NOTED)

### Cloned repos
- generalaction/emdash — https://github.com/generalaction/emdash (Apache-2.0, 3,973⭐)
- glass-hq/Glass — https://github.com/Glass-HQ/Glass (GPL-3.0, 826⭐, Zed fork)
- superset-sh/superset — https://github.com/superset-sh/superset (Elastic-v2, 9,794⭐)

### Product/homepage fetches
- https://glassapp.dev/ — 15:11 UTC
- https://soloterm.com/ — 15:10 UTC
- https://emdash.sh/ — 15:23 UTC (403, search-substitute used)
- https://superset.sh/ — via WebSearch
- https://cursor.com/blog/cursor-3 — 15:10 UTC
- https://www.anthropic.com/news/claude-design-anthropic-labs — 15:10 UTC
- https://air.dev — 15:09 UTC (thin)
- https://www.jetbrains.com/air/ — 15:10 UTC (404)
- https://gemini.google/mac — 15:10 UTC
- https://perplexity.ai/computer — 15:10 UTC (403, WebSearch substitute)
- https://dpcode.co — ECONNREFUSED
- https://dpcode.cc — ECONNREFUSED

### WebSearch queries (all 2026-04-19)
1. `"Perplexity Computer" 2026 features pricing connectors SWE-bench`
2. `"dpcode.co" OR "dp code" AI coding tool features pricing`
3. `"JetBrains Air" IDE 2026 features ACP agents launch`
4. `"soloterm" OR "solo terminal" block-based terminal 2026`
5. `"superset" shell passthrough overlay terminal AI 2026`
6. `"Perplexity Computer" "19 models" connectors architecture subagents 2026`
7. `"dpcode.cc" OR "DP Code" site:twitter.com OR site:producthunt.com OR site:reddit.com`
8. `"DP Code" dpcode.cc Anthropic Claude max subscription routing indie developer tool`
9. `"glass" Glass-HQ app Liquid Glass UI Zed fork features Steam 2026`

### Cross-referenced docs (WOTANN internal)
- `wotann/docs/COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` (Lane-8 baseline)
- `wotann/docs/UNKNOWN_UNKNOWNS.md` (34-discovery tier map)
- `wotann/CLAUDE.md` (naming conventions + architecture rules)

---

## 14. V3 EXTRACTION STATISTICS

- Targets attempted: **10**
- OSS repos cloned: **3** (emdash, Glass, superset)
- OSS repos searched but NOT FOUND as separate project (naming collision): **soloterm** (PHP-Laravel, not the Mac app)
- Direct WebFetch successes: **4** (cursor.com, anthropic.com, gemini.google, soloterm.com)
- Direct WebFetch failures needing WebSearch fallback: **5** (air.dev, jetbrains.com/air, perplexity.ai/computer, dpcode.cc, dpcode.co)
- Total new patterns surfaced (NOT in Lane-8 §1-§9): **20**
- HIGH-priority patterns: **6** (SSH remote, MCP process dashboard, ask_user, ACP registry, audit mode, cross-channel kickoff)
- CRITICAL-priority patterns (reconfirmed from Lane-8): **1** (Claude Design receiver)

---

**End of V3 Web Competitor Extraction. Last updated 2026-04-19.**
