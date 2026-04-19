# CONFIG_REALITY.md — Phase 1 Agent D

**Generated**: 2026-04-19 by Phase 1 Agent D (Opus 4.7 max effort, 63,999 thinking tokens).
**Scope**: Reconstruct the configuration ground-truth for WOTANN — what does the project claim to do via config, what tooling does Gabriel use, what competitors are tracked, what hooks fire, what rules apply, where has drift set in.
**Method**: Read every config file, rule file, hook script, agent definition, and competitor-analysis doc in full. No summaries lifted from training data.

---

## 1. WOTANN Package / Build Configuration

### 1.1 `wotann/package.json` (canonical, read in full)

- **name**: `wotann` — **version**: `0.1.0` — **license**: MIT — **homepage**: `https://wotann.com`
- **type**: `module` (ESM) — **engines.node**: `>=20`
- **main**: `dist/index.js` — **bin.wotann**: `dist/index.js`
- **exports**: `.` → `./dist/index.js` ; `./lib` → `./dist/lib.js`
- **files** (npm tarball allowlist): `dist/`, `skills/`, `install.sh`
- **publishConfig.access**: `public`

**Scripts** (all present):
| Script | Command | Purpose |
|---|---|---|
| `build` | `tsc && chmod +x dist/index.js` | TypeScript compile + make bin executable |
| `dev` | `tsx src/index.ts` | Run directly from source |
| `start` | `node dist/index.js` | Run the compiled bin |
| `typecheck` | `tsc --noEmit` | Type checking only |
| `lint` | `eslint "src/**/*.{ts,tsx,js,jsx}"` | ESLint 9 flat config |
| `lint:fix` | `eslint --fix "src/**/*.{ts,tsx,js,jsx}"` | Auto-fix |
| `format` | `prettier --write "src/**/*.{ts,tsx,js,jsx,json,md}"` | Prettier |
| `format:check` | `prettier --check` | Format verify |
| `test` | `vitest run` | Single-pass test |
| `test:watch` | `vitest` | Watch mode |
| `prepare` | `tsc && chmod +x dist/index.js` | Prep for npm install |
| `postinstall` | `npm run build \|\| echo 'Build failed — run npm run build manually'` | **SOFT FAIL**: build failure is logged, not fatal |
| `wotann` | `tsx src/index.ts` | Run from source (alias) |
| `test-provider` | `tsx src/cli/test-provider.ts` | Provider test harness CLI |

**Dependencies** (runtime, 11):
- `@anthropic-ai/sdk ^0.82.0`
- `better-sqlite3 ^12.8.0` — native module (CI rebuilds it post-install)
- `chalk ^5.6.2`
- `commander ^14.0.3`
- `ink ^6.8.0` — React-in-terminal
- `magika ^1.0.0` — Google file-type detection
- `react ^19.2.4`
- `undici ^8.1.0` — fetch implementation
- `ws ^8.18.0`
- `yaml ^2.8.3`
- `zod ^4.3.6`

**peerDependencies** (optional):
- `@anthropic-ai/claude-agent-sdk ^0.2.90` — **marked optional** via `peerDependenciesMeta`. Also present in `devDependencies` at same version.

**optionalDependencies** (2):
- `@xenova/transformers ^2.17.2` — MiniLM embeddings (session-4 wired, §78 sprint)
- `qrcode-terminal ^0.12.0` — QR pairing

**devDependencies** (12): `@anthropic-ai/claude-agent-sdk`, `@types/*` (node, react, ws, better-sqlite3), `@typescript-eslint/*`, `eslint 9`, `eslint-config-prettier 9`, `ink-testing-library`, `prettier 3`, `tsx 4`, `typescript 6`, `vitest 4`.

**overrides**: `"picomatch": "3.0.2"` — single pin (likely CVE or bug).

### 1.2 `wotann/tsconfig.json`

- **target**: `ES2022` — **module**: `Node16` — **moduleResolution**: `Node16`
- **lib**: `ES2022` (no DOM) — **outDir**: `dist` — **rootDir**: `src`
- **strict**: `true` — **noUncheckedIndexedAccess**: `true` — **exactOptionalPropertyTypes**: `false`
- **esModuleInterop**: `true` — **skipLibCheck**: `true` — **forceConsistentCasingInFileNames**: `true`
- **resolveJsonModule**: `true` — **declaration**: `true` — **declarationMap**: `true` — **sourceMap**: `true`
- **jsx**: `react-jsx` — **jsxImportSource**: `react` — **types**: `["node"]`
- **include**: `["src/**/*"]` — **exclude**: `["node_modules", "dist", "tests"]`

**Reality check**: `tests/` is excluded from tsconfig include, so `tsc --noEmit` does not type-check tests. Tests are type-checked via vitest/tsx at runtime. This is a blind spot if test-only types drift.

### 1.3 `wotann/eslint.config.js`

- **Format**: ESLint 9 flat config (migrated from `.eslintrc.json` in S0-10, carrying over the legacy rules).
- **Ignores**: `dist/`, `node_modules/`, `tests/`, `coverage/`, `desktop-app/`, `ios/`, `.wotann/`, `.nexus-archive/`, `**/*.d.ts`.
- **Extends**: `js.configs.recommended` + `prettierConfig` (stylistic rules turned off where prettier handles them).
- **Parser**: `@typescript-eslint/parser` — **ecmaVersion**: `2022` — **sourceType**: `module`.
- **Globals**: 32 browser/node/react globals declared as `readonly` (process, Buffer, NodeJS, console, URL, TextEncoder, AbortController, fetch, Response, Headers, ReadableStream, WebSocket, React, JSX, …).
- **Rules**:
  - `@typescript-eslint/no-unused-vars`: `warn`, with `_` prefix ignore on both args and vars.
  - `no-unused-vars`: `off` (delegated to TS plugin).
  - `no-console`: `off`.
  - `no-undef`: `off`, `no-redeclare`: `off`, `no-dupe-class-members`: `off`.
  - `no-empty`: `warn` with `allowEmptyCatch: true`.
- **Drift check**: Session-4's "extended-session" cleanup brought lint to **0 errors, 0 warnings**. Not confirmed still true on HEAD (two days elapsed; 59 unpushed commits).

### 1.4 `wotann/sea.config.json` (Node Single-Executable Application)

```json
{
  "main": "dist/index.js",
  "output": "dist/release/wotann.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true,
  "assets": {}
}
```

Used by `scripts/release/build-all.sh` which injects this blob into a copy of the host `node` binary via `npx postject`. Produces a standalone executable per platform (macos-x64, macos-arm64, linux-x64, linux-arm64, windows-x64).

### 1.5 Release / install pipeline

**`install.sh`** (209 lines, read in full):
- Bash, sets `-euo pipefail`, ASCII banner, cyan/green/yellow coloring.
- Two modes: default npm install, `--local` from working dir.
- **OS detection**: Darwin → macos, Linux → linux; other → exit 1.
- **Path hardening**: macOS prepends `/opt/homebrew/bin`, `/usr/local/bin`, nvm path. Linux sources nvm, adds `$HOME/.local/bin`, `$HOME/.npm-global/bin`.
- **Node version check**: requires ≥20; installs Node 22 via nvm if missing.
- **Idempotent**: detects existing install, reinstalls.
- **Provider auto-detection**: checks `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `~/.codex/auth.json`, `GH_TOKEN`/`GITHUB_TOKEN`, `ollama` binary.
- **Ollama auto-install**: gated behind `WOTANN_INSTALL_OLLAMA=1` env var — explicit opt-in per S4-7.
- **Fallback chain**: npm registry install → local build from CWD if package.json present → error with `--local` hint.

**`Formula/wotann.rb`** (Homebrew):
- Desc: "Unified AI agent harness — multi-provider, portable, benchmark-first"
- Version: `0.4.0` — **DRIFT: package.json says 0.1.0**. Homebrew formula is 4 version-ticks ahead of package.json, suggesting past-session Claude bumped the formula speculatively or pre-package-json. No published Homebrew tap yet.
- URL: `https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-<os-arch>.tar.gz`
- SHA256: `REPLACE_WITH_ACTUAL_SHA_FROM_RELEASE` — placeholder, regenerated by release workflow on tag push (per comment in file).
- Install: `bin.install "wotann"` (single binary).
- Test: `assert_match(/wotann/i, shell_output("#{bin}/wotann --version"))`.

**`.npmignore`** (belt-and-braces over `files` allowlist): strips source maps, `ios/`, `desktop-app/`, `docs/`, all `.md` except README/LICENSE, ESLint/Prettier/Biome/tsconfig/vitest config, `.wotann/`, `.nexus*/`, `.superpowers/`, `.github/`, `.codex-home/`, tests, OS artefacts, `src/`.

**`scripts/release/prepublish-check.mjs`** (Node): runs before `npm publish`. Validates: required package.json fields, `dist/index.js` exists, no secrets in pack (regex: `.env*`, `credentials.json`, `*.pem`, `id_rsa`, `secret`, `private-key`), version not already published on npm, README+LICENSE present. Fails on any error.

**`scripts/release/build-all.sh`**: produces SEA-bundled binaries per platform. Strips macOS code signature, injects blob, re-signs ad-hoc. Notes: "non-host targets require CI runner on that platform".

**`scripts/release/postpublish-verify.mjs`** + **`scripts/release/install.sh`** exist but not read in detail.

### 1.6 CI workflows (`.github/workflows/*.yml`)

**`ci.yml`** (read in full):
- Triggers: `push` to `main`, `pull_request` to any branch. Concurrency group cancels in-progress.
- Permissions: `contents: read` (minimum).
- **Job `typecheck-build`**: matrix `ubuntu-latest × macos-latest`, Node 22, cache npm. Steps: checkout → setup-node → `npm ci --ignore-scripts` → `npm rebuild better-sqlite3` → `npm run typecheck` → `npm run lint` → `npm run build`. Session-10 audit explicitly added lint as gated step (comment in file).
- **Job `test`** (sharded 1/2 and 2/2): **SELF-HOSTED runner** — `runs-on: [self-hosted, linux]`. 10-min timeout. Node 22, cache npm. Runs `npm test -- --shard N/2` with `NODE_OPTIONS=--max-old-space-size=6144`.
  - **Reason for self-hosted** (per `docs/SELF_HOSTED_RUNNER_SETUP.md`): GH-hosted Ubuntu runners were pre-empting shard 1 mid-vitest (`The runner has received a shutdown signal` ~6–16s in, no preceding test failure). `nick-fields/retry` couldn't recover. Self-hosted on Gabriel's laptop eliminates the pre-emption class.
- **Job `desktop-typecheck`**: `ubuntu-latest`, `cache-dependency-path: desktop-app/package-lock.json`, runs `npx tsc --noEmit --project tsconfig.app.json` in `desktop-app/`.

**`release.yml`** (read in full):
- Trigger: push tag `v*`. Permissions: `contents: write` (needs to upload release assets).
- **Job `build`**: matrix `[macos-x64, macos-arm64, linux-x64, linux-arm64, windows-x64]`. Each on its native runner OS. Runs `npm ci --ignore-scripts`, `npm run build`, then shell-scripted inline:
  - Creates `dist/release/wotann-${VERSION}-${TARGET}` from `dist/index.js` (fallback: `#!/bin/sh` sentinel if missing).
  - Tars and uploads via `actions/upload-artifact@v4`.
- **Reality check**: the `cp dist/index.js "$ART" || printf '#!/bin/sh\n' > "$ART"` fallback means a release can ship an empty sh script if the build doesn't produce dist/index.js. That's a silent-success footgun per session-2 rule #2. **FLAG**: the release.yml packaging step does NOT use the SEA bundling in `scripts/release/build-all.sh` — it just copies `dist/index.js`, which requires Node on the user's machine, contradicting Formula/wotann.rb's claim of "WOTANN ships as a single executable". The SEA pipeline is not actually invoked in CI release.
- **Job `publish`**: depends on build, downloads artifacts, uses `softprops/action-gh-release@v2` with `draft: true`, auto-generates release notes.
- **Job `npm-publish`**: runs if tag starts with `v`, needs build. `npm publish --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` — **requires NPM_TOKEN repository secret**.

**Required secrets**:
- `NPM_TOKEN` (for release.yml → npm-publish)
- Self-hosted runner registration (for `test` job).

### 1.7 `wotann/CLAUDE.md` (project-local rules, read in full)

Key points:
- WOTANN = Germanic All-Father (god of wisdom, war, poetry, magic, runes). Mega-plan at `~/.claude/plans/glistening-wondering-nova.md`.
- Three quick commands: `npm run typecheck`, `npm test`, `npm run dev`.
- **Naming convention**: product = WOTANN (wotann.com); CLI = `wotann start|init|build|compare`; config dir = `.wotann/`; URL scheme = `wotann://`.
- **User-facing feature names** (clear English, no jargon): 21-row table mapping user-facing name → CLI command. Examples: Relay (`wotann relay`), Workshop (`wotann workshop`), Compare (`wotann compare`), Link (`wotann link`), Build (`wotann build`), Autopilot, Engine, Bridge, Enhance, Skills, Guards, Memory, Cost Preview, Voice, Schedule, Channels.
- **Internal code names** (Norse-themed): `WotannRuntime`, `WotannEngine`, Mimir (memory), Huginn/Muninn (thought/memory) allowed in code comments.
- **Build order**: 6 sprints, Sprint 0 marked DONE.
- **Architecture rules**:
  - TypeScript strict, no `any`.
  - Provider-agnostic: everything in `src/core/` works with ANY provider.
  - "Maximum Model Power": harness amplifies, NEVER degrades model capability.
  - "Automagical by Default": every feature works without user config.
  - "Universal Capability": every feature works with every provider (native or emulated).
  - Middleware pattern: cross-cutting concerns are composable layers.
  - Progressive disclosure: skills load on demand, zero cost until invoked.
  - Guards are guarantees (hooks, not prompts).
  - Immutable value types; encapsulated mutable services.
  - **200-400 lines per file, 800 max**.
- **Directory structure**: 22 subdirs under `src/` enumerated (core, providers, middleware, intelligence, orchestration, daemon, computer-use, memory, context, prompt, hooks, skills, sandbox, channels, lsp, voice, learning, identity, security, telemetry, marketplace, ui, desktop, mobile, utils).

**Reality check vs. actual src/**: `ls src/` shows 50 subdirs. Extras not in CLAUDE.md: `acp`, `agents`, `api`, `auth`, `autopilot`, `browser`, `cli`, `connectors`, `git`, `lib.ts`, `mcp`, `meet`, `mobile`, `monitoring`, `plugins`, `runtime-hooks`. CLAUDE.md is ~22/50 = 44% coverage. The project has grown beyond its documented architecture.

---

## 2. Global Claude Config Synthesis

### 2.1 `~/.claude/CLAUDE.md` (328 lines, read in full)

**Prime directive**: "Full autonomy. The user says WHAT — you decide HOW." Tagged `PROMOTION_APPROVED`. Never ask "should I use X?" — just use it. Max compute (opus[1m], max effort, 63,999 thinking tokens).

**Identity**: Gabriel Vuksani. Preferences: immutable data, many small files, TDD, research-before-coding.

**Agent dispatch table** (12 agents, all opus): analyst, planner, critic, architect, test-engineer, code-reviewer, security-reviewer, verifier, build-error-resolver, code-simplifier, debugger, performance-profiler. Column "Scope" notes read-only / full access / read+bash / no bash per agent.

**Agent dispatch notes**: Always pass `name` field; use `initialPrompt` to inject memory; **prefer inline self-review over subagent review loops (30s vs 25min, same quality — Superpowers v5.0.6)**.

**Skill dispatch — LOCAL** (`~/.claude/skills/`), organized in 8 buckets:
1. Core Workflow (15 skills): deep-interview, search-first, research, scrape, prompt-master, orchestrate, ai-slop-cleaner, ultraqa, btw, humanizer, autoresearch-agent, clone-website, agent-reach, reflect, mem-edit.
2. Debugging & Investigation (6): trace, superpowers:systematic-debugging, /tree-search, focused-fix, dx-gha, incident-commander.
3. Planning & PM (5): /plan, spec-driven-workflow, deep-interview→spec-driven-workflow, autonomous-loops, iterative-retrieval.
4. Git & Review (5): git:cm, git:cp, git:pr, git:clean, code-reviewer agent.
5. Safety & Security (7): careful, freeze, guard, cso, understand, skill-security-auditor, a11y-audit.
6. SEO & Marketing (3): geo-seo, ad-audit, growth-playbook.
7. Frontend & Design (3): epic-design, frontend-slides, interface-design.
8. Memory & Context (11): memory-stack, si:review/extract, dream-cycle, mem-edit, reflect, context-manage, init, save/resume-session, dx-handoff, monitor-repos, claudeignore-init.
9. Quality & Maintenance (4): tech-debt-tracker, verify, setup-audit, mcp-builder.
10. Trail of Bits security: 50+ skills.

**Skill dispatch — PLUGINS** (by namespace):
- `superpowers:*` — 13 skills (brainstorming, TDD, systematic-debugging, writing/executing-plans, subagent-driven-development, dispatching-parallel-agents, using-git-worktrees, finishing-a-development-branch, verification-before-completion, requesting/receiving-code-review, writing-skills).
- `conductor:*` — 9 skills (setup, new-track, implement, status, manage, revert, context-driven-development, track-management, workflow-patterns).
- `agent-teams:*` — 13 skills.
- `planning-with-files:*` — 2 (plan, status).
- `claude-mem:*` — 5 (do, make-plan, smart-explore, mem-search, timeline-report).
- Frontend/Design plugins (5): frontend-design, playground, ui-ux-pro-max, claude-hud:setup/configure.
- Meta/Tooling plugins (10+): claude-md-management, skill-creator, claude-code-setup, loop, schedule, update-config, keybindings-help, claude-api, simplify.
- `fullstack-dev-skills:*` (60+ stacks).
- `marketing-skills:*` (30+ skills).

**MCP server disambiguation**:
- Chrome (`claude-in-chrome`) = real browser with logged-in sessions. Playwright = headless isolated testing.
- Context7 = pre-implementation docs lookup (resolve-library-id → query-docs).
- Consensus = academic papers, inline citations required.
- Engram = persistent memory (mem_save, mem_search, mem_context, mem_session_summary).
- claude-mem = auto-capture, compression, AST search.

**Overlapping-capability disambiguation** for Planning (5 systems), Debugging (6 systems), Code Review (3 systems), TDD (2 systems).

**New-project checklist**: CLAUDE.md / AGENTS.md / package.json / pyproject.toml check, `/init`, Context7, `git log --oneline -10`, `.github/workflows/`.

**Development pipeline** (7 steps): research → requirements → plan → implement → verify → clean up → commit.

**Memory stack** (free, no API keys): Engram + claude-mem + Auto-memory (MEMORY.md). Plus 6 memory categories: user, feedback, project, reference (auto-memory) + case, pattern (Engram).

**Active Hooks**: "**21 hooks** enforce safety, verification, memory flow, and context hygiene" — but actual count in `~/.claude/hooks/scripts/` is 19 distinct scripts (see §6). CLAUDE.md claim is off by 2.

### 2.2 Rules files (`~/.claude/rules/*.md`)

10 files, 28KB total. Read each in full.

**`coding-style.md`** (67 lines):
- **Immutability** (CRITICAL): always create new objects, never mutate.
- File organization: many small files > few large, 200-400 typical, 800 max.
- Error handling: explicit, user-friendly UI errors, detailed server logs, never swallow silently.
- Input validation: at all system boundaries, schema-based, fail fast.
- Scope discipline: do what's asked; exception is critical security/data-loss bugs discovered during implementation.
- **Reference completeness**: before modifying signatures/types, Grep for ALL callers and update in same change (tagged `PROMOTION_APPROVED`).
- Code quality checklist: readable naming, <50-line functions, <800-line files, no deep nesting (>4), proper error handling, no hardcoded values, no mutation, all refs updated on signature change.

**`testing.md`** (30 lines):
- 80% minimum coverage.
- Three types required: unit, integration, e2e.
- TDD mandatory: RED → GREEN → IMPROVE.
- Troubleshoot: use test-engineer agent, fix implementation not tests unless tests are wrong.

**`security.md`** (30 lines):
- Pre-commit checks: no hardcoded secrets, validate all inputs, SQL param queries, XSS sanitization, CSRF protection, auth verification, rate limiting, no error-message data leakage.
- Secret management: never hardcode, env vars or secret managers, validate at startup, rotate on exposure.
- Security response protocol: STOP, dispatch security-reviewer, fix CRITICAL first, rotate secrets, sweep for similar issues.

**`clarification-first.md`** (28 lines):
- CLARIFY → PLAN → ACT.
- Clarify when: missing info, ambiguous requirements, 2+ viable approaches with meaningful consequence differences, risky/destructive ops, scope creep signals.
- Don't clarify when: simple unambiguous requests, user said "just do it", sufficient context from code/CLAUDE.md/history, easily reversible (e.g., variable naming).
- How: specific questions, options with tradeoffs, 2-3 per round, never ask what's in the code.

**`development-workflow.md`** (40 lines):
- 7-step feature workflow (research → plan → TDD → review → verify → cleanup → commit).
- Context management: run `/compact` at 50% not auto-compact threshold; `mem_context` after compaction; `planning-with-files` for long tasks.
- Skill authoring tips: `context: fork` frontmatter, embedded shell via backticks, `<important if="...">` tags in CLAUDE.md, "pushy" descriptions to combat undertriggering.

**`always-on-behaviors.md`** (286 lines — the largest rule file):
- **15 sections**, each a mandatory always-on pattern.
- §0 Full Autonomy Principle (verbatim in CLAUDE.md too).
- §1 Memory Orchestration: session-start `mem_context` + claude-mem + MEMORY.md; during work auto-save after every significant action; WAL before destructive ops; after compaction recover state; session end `mem_session_summary`.
- §2 Auto-Research: before ANY new code, Context7 → gh search → web search → registries. Skip only for <5-line edits or explicit "skip research".
- §3 Auto-Verification: before "done/fixed/complete" run tests+build+lint+type-check; show actual output; for critical work dispatch fresh-context verifier agent.
- §4 Auto-Planning: 3+ step tasks get plans. For non-trivial work generate 2-3 alternatives, pick scales-best + clean-code-friendly. Planning stickiness rule.
- §5 Auto-Quality: self-review, code-reviewer for >50 lines or architectural, security-reviewer for security-sensitive.
- §6 Pre-Task Context Verification: check incomplete context, contradictions, user intent, blast radius.
- §7 Complexity Decomposition: >200 lines, 5+ files, 3+ unknowns → break to <100-line subtasks.
- §8 Post-Task Knowledge Compounding + Entropy Cleanup.
- §9 Auto-Skill Detection (comprehensive tables: Agents, Core Workflow, Debugging, Cloud Workflows, Security, Frontend, SEO/Marketing, Memory/Context, Quality, Stack-Specific, Tools).
- §10 Auto-Parallel: 2+ independent tasks → launch parallel via Agent tool + run_in_background.
- §11 Reflection Checkpoints: before editing, git ops, claiming done, modifying signatures/types, on unexpected difficulty, after long sessions.
- §12 Error Retry Cap: 3 failed approaches → escalate to `/tree-search` or stop. Never modify tests to make them pass unless tests are explicitly wrong. Self-correct on rule-violation.
- §13 Multi-Query Search: different wordings, keep until confident, library docs > snippets.
- §14 Session Contract: what asked / what planned / what delivered / what verified. Before session end verify 3 matches 1, 4 proves it. **Taskmaster hook enforces mechanically**.
- §15 Override Rules: explicit user "just do X" or "skip Y" overrides; project CLAUDE.md overrides global on conflict.

**`memory-taxonomy.md`** (48 lines):
- Letta-inspired 8-block taxonomy.
- Auto-memory blocks (hard-limited): user (10), feedback (15), project (10), reference (10) — max 45 total in MEMORY.md capped at 200 lines.
- Engram blocks (unlimited, topic_key-grouped): cases, patterns, decisions, issues.
- When-to-save-where table (7 events).
- Monthly maintenance checklist.

**`wal-protocol.md`** (35 lines):
- Write-Ahead Logging: before any destructive ops (compaction, /clear, session end), save to Engram FIRST.
- 5 triggers tabulated.
- Recovery order: `mem_context` → planning files on disk → learnings-queue.json → MEMORY.md.
- Working buffer between flushes is vulnerable; proactive > reactive.

**`patterns.md`** (34 lines):
- Skeleton Projects: search battle-tested, parallel-evaluate (security/extensibility/relevance/implementation), clone best, iterate.
- Repository Pattern: define abstract interface (findAll/findById/create/update/delete), concrete implementations handle storage, tests use mocks.
- API Response Format: envelope with success/data/error/meta fields.

**`error-lifecycle.md`** (48 lines):
- States: OPEN → SNOOZED → RESOLVED (reopen on recurrence).
- Tracked via Engram `topic_key: "known-issues/{domain}"`.
- Auto-resolution: 3 clean sessions + verified fix.

### 2.3 Global settings (`~/.claude/settings.json`)

Read in full. Key env vars:
- `CLAUDE_CODE_EFFORT_LEVEL=max`
- `CLAUDE_CODE_SUBAGENT_MODEL=opus[1m]` (subagents get 1M-context opus)
- `ENABLE_TOOL_SEARCH=true`
- `FORCE_AUTOUPDATE_PLUGINS=true`
- `DISABLE_AUTO_COMPACT=1` (manual-only compaction)
- `MAX_THINKING_TOKENS=63999`
- `MCP_TIMEOUT=60000`, `MCP_TOOL_TIMEOUT=120000`
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` (strip env vars from subprocess children)

Permissions: allow `.venv/bin/pip install:*`, `npx next:*`. `defaultMode: auto`.
Other: `enableAllProjectMcpServers: true`, `respectGitignore: false`, `cleanupPeriodDays: 7`.
Sandbox: `failIfUnavailable: true`, network `deniedDomains: [169.254.169.254]` (AWS metadata), filesystem denyRead: `~/.ssh/**`, `~/.aws/credentials`, `~/.aws/config`.
Top-level: `alwaysThinkingEnabled: true`, `autoUpdatesChannel: latest`, `autoMemoryEnabled: true`, `skipDangerousModePermissionPrompt: true`, `skipAutoPermissionPrompt: true`, `outputStyle: Explanatory`.

**Enabled plugins** (44 total, marketplace-grouped):
- `@claude-plugins-official` (24): swift-lsp, atomic-agents, github, frontend-design, superpowers, playwright, code-review, feature-dev, ralph-loop, claude-md-management, typescript-lsp, security-guidance, skill-creator, commit-commands, figma, claude-code-setup, pyright-lsp, supabase, greptile, playground, context7, rust-analyzer-lsp, code-simplifier, hookify, pr-review-toolkit, session-report, agent-sdk-dev, mcp-server-dev, plugin-dev, semgrep, stagehand, cloudflare, serena, chrome-devtools-mcp, firecrawl.
- `@claude-hud` (1): claude-hud (statusline).
- `@last30days-skill` (1).
- `@thedotmack` (1): claude-mem.
- `@ui-ux-pro-max-skill` (1).
- `@fullstack-dev-skills` (1): fullstack-dev-skills (~60 sub-skills).
- `@claude-code-workflows` (2): conductor, agent-teams.
- `@marketingskills` (1): marketing-skills (~30 sub-skills).
- `@planning-with-files` (1).

Status line: shell script pointing to `plugins/cache/claude-hud/<version>/dist/index.js`.

---

## 3. Slash-Command Inventory (what WOTANN should integrate with)

### 3.1 Local `~/.claude/commands/` (7 commands + 4 git subcommands)

| Command | Source | Purpose |
|---|---|---|
| `/btw` | `btw.md` | Quick side question mid-task; --save flag to persist to Engram, --deep flag for full explanation. Freezes context, answers, resumes. |
| `/claudeignore-init` | `claudeignore-init.md` | Create `.claudeignore` with curated exclusions (dependencies, build output, locks, caches, IDE, tests, media, DBs, env). |
| `/monitor-repos` | `monitor-repos.md` | Check 28 tracked repos for updates (see §5). |
| `/orchestrate` | `orchestrate.md` | Sequential multi-agent workflow. Workflow types: feature (planner→test-engineer→code-reviewer→security-reviewer), bugfix, refactor, security. Handoff document format provided. Control-plane block for multi-session workflows. |
| `/save-session` | `save-session.md` | Write dated session file to `~/.claude/session-data/YYYY-MM-DD-<short-id>-session.tmp`. Format: What We Are Building, What WORKED (with evidence), What Did NOT Work (and why), What Has NOT Been Tried Yet, Current State of Files, Decisions Made, Blockers, Exact Next Step, Environment Notes. |
| `/resume-session` | `resume-session.md` | Load most recent session file, show structured briefing. Handles legacy filename format. |
| `/verify` | `verify.md` | Build / Type / Lint / Test / Console.log audit / Git status. Args: quick, full, pre-commit, pre-pr. |
| `/git:cm` | `git/cm.md` | Stage + Conventional Commit, no push. |
| `/git:cp` | `git/cp.md` | Stage + commit + push (runs /verify first). |
| `/git:pr` | `git/pr.md` | `gh pr create` with PR template. |
| `/git:clean` | `git/clean.md` | Clean merged branches (keep main/dev/gh-pages). |

### 3.2 Plugin-provided commands (subset)

From enabled plugins: `/last30days`, `/session-report`, `/code-review`, `/feature-dev`, `/init`, `/review`, `/security-review`, `/ralph-loop:*`, `/commit-commands:commit`, `/commit-commands:commit-push-pr`, `/commit-commands:clean_gone`, `/claude-hud:setup`, `/claude-hud:configure`, `/test-release`, `/release`, many others.

### 3.3 Skills exposed as slash-commands

From `~/.claude/skills/` (89 dirs): each with SKILL.md — selected ones listed in §2.1. Notable for WOTANN integration: `/trace`, `/tree-search`, `/research`, `/scrape`, `/verify`, `/memory-stack`, `/mem-edit`, `/reflect`, `/save-session`, `/resume-session`, `/dream-cycle`, `/setup-audit`, `/cso`, `/understand`, `/freeze`, `/guard`, `/careful`.

---

## 4. Agent / Skill Inventory (patterns WOTANN should mirror)

### 4.1 Custom agents (`~/.claude/agents/`)

12 agents, all `model: claude-opus-4-7`. Per-agent synopsis (read in full):

| Agent | Model | Tools | Scope | Core Discipline |
|---|---|---|---|---|
| **analyst** | opus | Read-only (Write/Edit blocked) | Pre-planning gap analysis | Converts scope → testable acceptance criteria; flags missing questions, undefined guardrails, scope risks, unvalidated assumptions, edge cases. Output format with 6 sections + prioritized recommendations. |
| **planner** | opus | Read/Grep/Glob | Plan authoring | Requirements → architecture review → step breakdown with file paths + dependencies + complexity + risks → implementation order. Full plan template with phases, testing strategy, risks/mitigations, success criteria. Worked example: Stripe subs. |
| **critic** | opus | Read-only | Final quality gate | Phase 1 pre-commitment predictions → Phase 2 verification (code-specific + plan-specific) → Phase 3 multi-perspective (security/new-hire/ops for code; executor/stakeholder/skeptic for plans) → Phase 4 gap analysis → Phase 4.5 self-audit → Phase 4.75 realist check → adaptive THOROUGH→ADVERSARIAL escalation. Verdicts: REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT. |
| **architect** | opus | Read/Grep/Glob | System design | Current state → requirements mapping → design proposal → trade-off analysis (ADRs) → risk assessment. Stack-agnostic; right-size the design; no astronaut architecture. |
| **test-engineer** | opus | Read/Write/Edit/Bash/Grep/Glob | TDD execution | **Iron law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.** RED-GREEN-REFACTOR enforcement table. 70/20/10 pyramid. One behavior per test. Always show fresh output. |
| **code-reviewer** | opus | Read/Grep/Glob/Bash | Code review | Confidence rubric HIGH/MEDIUM/LOW with >80% gate. OWASP section, framework-specific patterns, backend patterns, perf, best practices. Verdicts: APPROVE / WARNING / BLOCK. PR Review Mode with blast radius analysis + test coverage delta. AI-generated code addendum. |
| **security-reviewer** | opus | Read/Write/Edit/Bash/Grep/Glob | Security audit | OWASP Top 10 checklist, pattern severity table (HARDCODED_SECRETS/INJECTION/XSS/etc.), dependency scanning via `npm audit`, defense-in-depth principles, emergency response protocol. |
| **verifier** | opus | Read-only | Evidence-based completion check | Rejects "should/probably/seems to". Runs verification commands itself. PASS/FAIL/INCOMPLETE verdict with evidence table. |
| **build-error-resolver** | opus | Read/Write/Edit/Bash/Grep/Glob | Compile/type errors | Detects stack from markers, collects all errors, applies minimal fixes (<5% changed lines). Quick Recovery table per stack. No refactoring. |
| **debugger** | opus | Read/Grep/Glob/Bash (no Write/Edit) | Runtime bugs | **Iron Law: Evidence before diagnosis.** REPRODUCE → HYPOTHESIZE (≥2) → TRACE → ISOLATE → DIAGNOSE (no fix; caller fixes). |
| **performance-profiler** | opus | Read/Grep/Glob/Bash (no Write/Edit) | Perf bottlenecks | **Iron Law: Measure before optimizing.** Baseline → profile → identify top 3 → root-cause → prioritized fix recommendations with effort+risk. |
| **code-simplifier** | opus | Read/Write/Edit/Grep/Glob | AI slop cleanup | Pairs with `ai-slop-cleaner` skill (orchestrator). Preserves functionality, enhances clarity. Avoids nested ternaries, over-abstraction, mutation introduction. |

**Patterns WOTANN should mirror for its internal agents** (already flagged in §78 sprint): Iron Laws, multi-phase protocols, explicit Output_Format XML tags, Failure_Modes_To_Avoid sections, Final_Checklist gates, and explicit disallowedTools for read-only agents.

### 4.2 Skills (`~/.claude/skills/`, 89 dirs) — top-level grouping

Visible in `ls`: a11y-audit, ad-audit, agent-reach, ai-slop-cleaner, api-patterns, autonomous-loops, autoresearch-agent, batch-processing, btw, careful, claudeignore-init, clerk-auth, clone-website, compliance-checker, composition-patterns, context-manage, context-management, core-web-vitals, cost-intelligence, cso, deep-interview, dependency-auditor, deploy-to-vercel, design-to-code, docker-expert, dream-cycle, dx-gha, dx-handoff, dx-review-claudemd, epic-design, focused-fix, freeze, frontend-slides, geo-seo, growth-playbook, guard, humanizer, incident-commander, init, integration-testing, interface-design, iterative-retrieval, karpathy-principles, lsp-operations, mcp-builder, mem-edit, memory-stack, monitor-repos, nextjs-best-practices, nextjs-supabase-auth, orchestrate, performance, plaid-fintech, playwright, prompt-master, prompt-testing, react-best-practices, react-patterns, reflect, research, resume-session, save-session, scrape, search-first, self-healing, self-improving-agent, senior-frontend, senior-fullstack, setup-audit, skill-security-auditor, software-architecture, soul, spec-driven-workflow, stripe-integration, tdd-workflow, tech-debt-tracker, trace, trace-mining, **trailofbits/** (50+ security sub-skills), tree-search, typescript-expert, ultraqa, understand, vercel-cli-with-tokens, vercel-deploy, vercel-deployment, verify, web-design-guidelines, web-performance-optimization.

---

## 5. Consolidated Competitor Tracking List

Union of 4 sources: `research/monitor-config.yaml` (66 entries: 10 cloned + 46 github + 10 web), `research/REPOS.md` (10 cloned + 8 GitHub-only), `research/README.md` (10 pre-audit + 28 audit additions + 10 web-only), `~/.claude/commands/monitor-repos.md` (28 repos in 5 tiers). **Total unique = 66 repos + 10 web sources = 76 tracked.**

### 5.1 Cloned repos (local `--depth=1`, 37 directories)

From `ls /research/`: agents, addyosmani-agent-skills, andrej-karpathy-skills, archon, autonovel, awesome-design-systems, camoufox, claude-context, claude-task-master, clicky, code-review-graph, codex, cognee, context-mode, deepagents, deepgemm, deeptutor, deer-flow, eigent, evolver, generic-agent, goose, gstack, hermes-agent, hermes-agent-self-evolution, magika, multica, oh-my-openagent, omi, opcode, open-swe, openai-agents-python, openai-skills, ruflo, superpowers, vercel-open-agents.

### 5.2 Master consolidated list (unique repos across all 4 sources)

**CRITICAL priority** (daily check, from monitor-config.yaml):
- `anthropics/claude-code` — "Our foundation"
- `anthropics/claude-plugins-official` — Anthropic's official plugin standard
- `openai/codex` — Apache-2.0, reference OpenAI agent CLI **(listed twice in monitor-config.yaml — deduplicate)**
- `openai/skills` — Skills v1 canonical format

**HIGH priority** (daily/weekly):
- `charmbracelet/crush`, `paoloanzn/free-code`, `can1357/oh-my-pi`, `oraios/serena`, `tobi/qmd` (QMD memory component), `getcursor/cursor`, `warpdotdev/Warp`, `daijro/camoufox`, `openai/openai-agents-python`, `topoteretes/cognee`, `zilliztech/claude-context`, `coleam00/Archon`, `NousResearch/hermes-agent`, `NousResearch/hermes-agent-self-evolution`, `langchain-ai/deepagents`, `bytedance/deer-flow`.

**MEDIUM priority** (weekly):
- `Significant-Gravitas/AutoGPT`, `lobehub/lobe-chat`, `letta-ai/letta`, `obra/superpowers`, `gsd-build/get-shit-done`, `affaan-m/everything-claude-code`, `Kilo-Org/kilocode`, `shouc/agentflow`, `codeany-ai/open-agent-sdk-typescript`, `Dimillian/Skills`, `codeium-ai/windsurf`, `zed-industries/zed`, `paul-gauthier/aider`, `continuedev/continue`, `sourcegraph/amp`, `block/goose`, `farzaa/clicky`, `forrestchang/andrej-karpathy-skills`, `addyosmani/agent-skills`, `NousResearch/autonovel`, `steipete/wacli`, `BasedHardware/omi`, `tirth8205/code-review-graph`, `mksglu/context-mode`, `eyaltoledano/claude-task-master`, `wshobson/agents`, `code-yeongyu/oh-my-openagent`, `langchain-ai/open-swe`.

**LOW / DORMANT** (monthly):
- `danny-avila/LibreChat`, `msitarzewski/agency-agents`, `HKUDS/OpenHarness`, `HKUDS/DeepTutor`, `alexpate/awesome-design-systems`, `EvoMap/evolver`, `lsdefine/GenericAgent`, `vercel-labs/open-agents`, `google/magika`, `multica-ai/multica`, `deepseek-ai/DeepGEMM`, `garrytan/gstack`, `thunderbird/thunderbolt`, `winfunc/opcode`, `eigent-ai/eigent`, `ruvnet/ruflo`.

**Monitor-repos.md adds 8 distinct repos** not in monitor-config.yaml: `shanraisshan/claude-code-best-practice`, `Piebald-AI/claude-code-system-prompts`, `EveryInc/compound-engineering-plugin`, `github/spec-kit`, `D4Vinci/Scrapling`, `letta-ai/claude-subconscious`, `BayramAnnakov/claude-reflect`, `LeoYeAI/openclaw-master-skills`, `bmad-code-org/BMAD-METHOD`.

**Monitor-repos.md also tracks Situation Room deps** (not in monitor-config.yaml): `tauri-apps/tauri`, `vasturiano/react-globe.gl`, `visgl/deck.gl`, `maplibre/maplibre-gl-js`, `colinhacks/zod`, `TanStack/query`, `pmndrs/zustand`, `recharts/recharts`, `QwenLM/Qwen3.5`, `mlc-ai/web-llm`, `openai/gpt-oss`, `huggingface/transformers.js`, `calesthio/Crucix`, `OpenCTI-Platform/opencti`, `intelowlproject/IntelOwl`, `fastfire/deepdarkCTI`.

### 5.3 Web-only competitors (no clone)

From `research/competitor-analysis/` and README.md (10 sites):
- **dpcode.co** — UNREACHABLE / NOT LAUNCHED (zero IA snapshots, no search results).
- **glassapp.dev** (Glass) — GPL v3, Zed fork + browser + terminal in one native macOS window, 823 stars, weekly upstream sync.
- **conductor.build** — macOS git-worktree-per-agent, per-session budget caps, `gh pr create` with transcript. **Reference architecture for multi-agent.**
- **zed.dev** — ACP+MCP+Zeta2, $0/$10/Enterprise, 11 BYOK providers.
- **jean.build** — Apache 2.0, worktree isolation, magic git commands, GitHub+Linear integration, Cloudflare Tunnel/Tailscale mobile access.
- **air.dev** (JetBrains Air) — multi-agent parallel (Codex, Claude Agent, Gemini, Junie), Docker or worktree isolation, code-aware task definition, task dashboard.
- **soloterm.com** — block-based terminal, Cmd-K palette, ghost completion, fix-last-error, runbook primitive, local-first SQLite history.
- **emdash.sh** — role-typed panes (shell/agent/logs/diff/tests), cross-pane messaging, worktree-per-agent, diff-review pane, session snapshot/resume. Rust+Ratatui.
- **superset.sh** — shell-passthrough overlay (zsh/bash/fish intact), NL→command hotkey, E2EE cross-machine history sync.
- **gemini.google/mac** — Liquid Glass HUD, blob-as-status, Cmd-Shift-Space global hotkey, push-to-talk STT, "Ask about this window" via ScreenCaptureKit.

### 5.4 Web sources (RSS / search feeds, from monitor-config.yaml)

- `https://docs.openclaw.ai/changelog` — OpenClaw changelog (HIGH; but per missed-competitors-2026-04-18.md: URL returns 404, actual changelog is in the skills repo).
- `https://ollama.com/blog` — new Ollama models and features.
- Search: `"AI agent harness CLI 2026"`, `"Claude Code update features"` (daily), `"TurboQuant llama.cpp merge"`, `"agentskills.io specification"`.

### 5.5 Tracking drift / gaps found

- **monitor-config.yaml has `openai/codex` listed twice** (line 100 under Core Competitors, line 331 under OpenAI & Reference Agents). Dedup needed.
- **REPOS.md is stale** — last synced 2026-04-13 with only 10 cloned repos. The 2026-04-18 audit added 27 more (per README.md), updating README but not REPOS.md. REPOS.md is out of date by ~50 entries.
- **monitor-repos.md tracks 28 repos in 5 tiers**; monitor-config.yaml tracks 46 github repos. Of those 46, **only ~8 overlap with monitor-repos.md's 28**. They are separate tracking regimes:
  - monitor-config.yaml = WOTANN competitor tracking (feature-parity focus).
  - monitor-repos.md = Situation Room / CTI / mixed tracking (broader scope).
  - These two lists are not unified. Moving them to one canonical list would deduplicate work.
- **7 verified-competitor-analysis files** (scope spec) actually exist in `research/competitor-analysis/`, but 5 others also exist (total 12 files): `ai-coding-editors`, `browser-codex-tutoring`, `gemini-macos-tools`, `memory-context-rag`, `missed-competitors`, `openai-agents-infra`, `perf-design-analysis`, `repo-code-extraction`, `self-evolving-agents`, `skill-libraries`, `terminals-conductor`, `uncovered-repos`. The "_DOCS_AUDIT_2026-04-18.md" audits these.
- **`research/competitor-analysis/missed-competitors-2026-04-18.md` flags** that many Perplexity URLs (perplexity.ai/computer, /hub/blog/introducing-perplexity-computer) return **403 Forbidden** to WebFetch — scraping via Chrome MCP with authenticated session is needed. This blocks first-party product pitch capture.

### 5.6 Each competitor-analysis file — ~200-word synopsis

**ai-coding-editors-2026-04-18.md** (34KB, 5 competitors): dpcode.co (unreachable; non-signal for the quarter); glassapp.dev/Glass (GPL v3 Zed fork + native browser + terminal in one window, 823 stars, weekly Zed sync, GPUI framework extracted standalone, Glass Bot Excel add-in, no proprietary AI); zed.dev (Rust+GPUI+Metal, Agentic Editing, Edit Prediction via Zeta2 — Zed's own open-weight model, ACP open protocol, real-time agent following via multiplayer infra, multibuffer editing, Debug Adapter Protocol, remote dev, Vim/Helix modes, Jupyter REPL, 120 FPS, **public Agent Metrics dashboard**, 11 BYOK providers, $0/$10/Enterprise pricing with $5 tokens included on Pro); jean.build (Apache 2.0, git-worktree-per-session is the **killer idea**, magic git commands for commit/PR/release notes/conflict resolution, GitHub+Linear context loading, headless mode, Cloudflare Tunnel/Tailscale mobile, Canvas+Chat+Terminal+Palette four surfaces, explicit "no endless configuration" manifesto); air.dev (JetBrains Air — Codex/Claude Agent/Gemini/Junie in parallel with Docker or worktree isolation, code-aware task definition using JetBrains LSP, task dashboard, workspace scoping, JetBrains AI Pro/Ultimate or BYOK dual-mode).

Cross-cutting: worktree isolation is universal; $10/mo is the price ceiling; free-first wins; BYOK+hosted-credits is canonical; native GPU rendering is trust signal; **Liquid Glass is NOT the dominant aesthetic** (Zed/Glass/Jean/Air all use minimal-dark); agent-following visualization is differentiated. Top-20 ranked steal list with effort estimates.

**terminals-conductor-2026-04-18.md** (6KB, 5 competitors): soloterm (block UI + Cmd-K + ghost completion + fix-last-error + runbooks + SQLite FTS5); emdash (role-typed panes + cross-pane messaging + worktree-per-agent + diff-review + session freeze-thaw, Rust+Ratatui); superset (shell passthrough + overlay UI + NL→command + E2EE history sync); conductor.build (**THE REFERENCE ARCHITECTURE** for WOTANN multi-agent: macOS + many parallel Claude Code sessions + one git worktree per agent in `.conductor/<task-id>/` + isolated `.claude/` per session + diff-vs-base review + per-session token/USD + budget caps + single-click `gh pr create` with transcript); Warp (Rust+Metal, Block UI via **OSC 133 prompt-boundary escapes** — key primitive WOTANN should ship shell init snippets emitting, Agent Mode with approval policies always-ask/read-only/trusted-tools/autopilot, Warp Drive workflows, MCP client baked in, background task tray). Top-25 steal list ranked impact × feasibility, Phase-0/1/2 subset plan. Conscious non-goals: don't rewrite TUI in Rust yet, don't build cloud Drive (plain `.wotann/` files win), don't ship autopilot on by default, don't hide costs.

**gemini-macos-tools-2026-04-18.md** (7.5KB, 4 tools): Gemini for Mac (native SwiftUI+AppKit, ~80MB, Liquid Glass + CAMetalLayer blob-as-status, Cmd-Shift-Space HUD, push-to-talk STT ~300ms, ScreenCaptureKit+OCR "Ask about this window", EventKit/Gmail extension, macOS Shortcuts action, menu-bar mini-chat); Clicky (farzaa, MIT — **`[POINT:x,y]` LLM grammar** + bezier cursor overlay ~250 LOC, NSPanel transparent borderless, 3-sec start-to-finish); Goose (block/goose, MIT — Rust core, Electron+React desktop, SwiftUI native port exists, multi-provider, **LSP tool surface exposed to agent** (lsp_references/definition/hover/symbols/rename), extension manifest TOML with stdio/sse/builtin transport, `.goosehints` = CLAUDE.md equivalent, recipe YAML, full MCP 2024-11-05 client+server, `computercontroller` built-in extension); WACLI (steipete — Swift+argument-parser, Homebrew tap, raw ANSI no curses, interactive palette on bare invocation, live cost ticker, shell-fallback Y/n gate, rewind per-turn). Top-10 ranked ports, **S-tier = ACP TS port (lets WOTANN be hosted by Zed/Air/Cursor)**.

**skill-libraries-2026-04-18.md** (11KB, 4 libraries): forrestchang/andrej-karpathy-skills (Karpathy principles as progressive-disclosure skills: think-before-coding, simplicity-first, surgical-changes, goal-driven-execution, llm-os-lens, software-3-0, nanogpt-style); obra/superpowers v5.0.7 (ground-truth 14 skills locally verified); addyosmani/agent-skills (Chrome-team web-perf: core-web-vitals, lcp/inp/cls optimizers, bundle-analyzer, lighthouse-ci, react-performance, image/font optimization, accessibility-scanner); openai/skills (Skills v1 canonical format with `version/allowed_tools/disallowed_tools/deps.mcp/deps.env/license/maintainer/homepage`). **Gap analysis** across Planning, Debugging, UX/Frontend, Security, Research, Review, Learning, Meta. Top-30 skills to port. Schema convergence plan: Level 1 (Karpathy) + Level 2 (WOTANN current) + Level 3 (OpenAI/Osmani/agentskills.io) — adopt Level 3 for export.

**self-evolving-agents-2026-04-18.md** (8KB, 7 targets + literature): explicit integrity note that 4 of 7 Gabriel targets unverifiable (NousResearch/hermes-agent-self-evolution, NousResearch/autonovel, EvoMap/evolver, vercel-labs/open-agents). Base literature citable: 6 Self-Evolution Mechanism Families — (A) Reflexion verbal reinforcement (Shinn 2023, HumanEval 80→91%), (B) Voyager executable skill libraries (Wang 2023), (C) Darwin-Gödel Machine code-level self-editing (Sakana+UBC arXiv 2505.22954, **archive-not-population**), (D) STaR bootstrapped rationales (Zelikman 2022), (E) Self-Rewarding Meta (Yuan 2024), (F) PromptBreeder+DSPy prompt-space evolution, (G) MemGPT three-layer memory (Packer 2023 — Letta). Top-10 upgrades sequenced by week: benchmark harness first (NON-NEGOTIABLE), lesson capture, rationalization, three-layer memory, embedding skill retrieval, archive-not-population, CodeAct (+20% GAIA), self-rewarding tournament, prompt mutation, evolution orchestrator daemon. **Cost: zero paid-API, one local model (BGE-small ~80MB CPU).** Anti-recommendations: don't fine-tune, don't add reward model, don't open agent-source self-editing before benchmark harness, don't adopt RLAIF/DPO, don't let Karpathy preamble drift untested.

**browser-codex-tutoring-2026-04-18.md** (9KB, 3 targets): camoufox (MPL-2.0 — **CRITICAL FINDING: `wotann/src/browser/camoufox-backend.ts` is completely fake** — shell-out-and-throw-away harness, every method spawns fresh Python subprocess, no persistent session. 10-step port plan: persistent Python subprocess via JSON-RPC stdin, BrowserForge profile injection, addons=, per-session proxy, geoip coherence, font rotation, stealth validators, humanize subcomponents, CDP-equivalent DOM tools, headless/headed toggle. Keep `chrome-bridge.ts` — different purpose (user's own browser vs. stealth scraping)); HKUDS/DeepTutor (Socratic loop, explanation-depth ladder, concept dependency graph, spaced repetition, worked-example-then-variation, wait-time enforcement — adopt as `wotann explain` mode); openai/codex (Apache-2.0, 177-line Node.js wrapper around pre-compiled Rust, 6 platforms, ~450MB package, TUI/exec/mcp-server modes, **subsystem-by-subsystem vs WOTANN comparison table** showing Codex wins on sandbox/profiles/ghost-snapshots/shell-snapshot and WOTANN wins on providers/memory/cost/voice/channels/sub-agents. Top-20 ports ranked P0/P1/P2). License aggregate compat table.

**memory-context-rag-2026-04-18.md** (11KB, 4 systems + WOTANN inventory): explicit statement **WOTANN already beats 3 of 4 on breadth**. Moats to preserve: TemporalMemory, EpisodicMemory, ObservationExtractor. Cognee (typed entity extraction via LLM structured output, Pipeline-as-DAG, EntityType subclassing); Claude-Context (tree-sitter AST chunking for 20+ languages, incremental SHA256 hash reindex, Milvus hybrid BM25+vector RRF); Context-Mode (mode-as-state-machine, mode = YAML/Markdown swapping active context, ephemeral context diffs, team-sharable modes); Archon (Supabase+pgvector, **contextual embeddings as default = +30-50% recall for one LLM call per chunk**, separate code_examples table, Agentic RAG with multi-query rerank, Pydantic AI typed outputs). **Top-15 upgrades ranked** (~11 dev-days for top-10). SQLite translations provided with `sqlite-vec` (not deprecated `sqlite-vss`). Two highest-signal imports: Cognee's EntityType + Anthropic contextual embeddings.

Synthesis across the 7 files: **WOTANN moat imports = ~120 small ports totaling ~12,000-20,000 LOC.** All MIT/Apache/MPL-compatible.

---

## 6. Active Hooks Inventory

From `~/.claude/settings.json` (verbatim) and `~/.claude/hooks/scripts/*` (read each):

### 6.1 Hook scripts present (19 distinct, CLAUDE.md claim of "21" is off by 2)

| Script | Type | Trigger | Purpose | Block / Advisory |
|---|---|---|---|---|
| `block-no-verify.sh` | PreToolUse(Bash) | Every Bash | Blocks `--no-verify` flag | **BLOCK** (exit 2) |
| `dangerous-command-guard.sh` | PreToolUse(Bash) | Every Bash | Blocks `rm -rf` (except safe dirs), `git reset --hard`, `git push --force`, `git checkout .`, `git restore .`, `DROP TABLE/DATABASE`, `kubectl delete`, `docker system prune`, `git branch -D`, `git clean -f` | **BLOCK** (exit 2) |
| `config-protection.js` | PreToolUse(Edit/Write/MultiEdit) | File edits | Blocks edits to 27 named configs: ESLint, Prettier, Biome, TypeScript, Ruff, pyproject.toml, shellcheckrc, stylelintrc, markdownlint | **BLOCK** (exit 2) |
| `suggest-compact.js` | PreToolUse (any, async) | Tool counter | Suggests `/compact` at 200 calls, then every 100 thereafter, per-session counter | Advisory stderr |
| `mcp-health-check.js` | PreToolUse(mcp__) + PostToolUseFailure(mcp__) | MCP calls | Tracks health per MCP server, exponential backoff on 401/403/429/503/transport errors, blocks calls during backoff window | **BLOCK on backoff**, advisory otherwise |
| `loop-detection.js` | PreToolUse(Bash/Edit/Write/MultiEdit) | Tool hashes | Sliding window of 20 recent tool hashes per session. **WARN at 8 consecutive identical**, **BLOCK at 15**. Skips Read/Glob/Grep/ToolSearch/Agent/Skill (variable by design). | **BLOCK at 15** |
| `gsd-prompt-guard.js` | PreToolUse(Write/Edit, async) | Files in `.planning/`, `.claude/` | Scans content for 12 injection patterns + invisible Unicode. Advisory only — no block. | Advisory (additionalContext) |
| `promotion-guard.js` | PreToolUse(Edit/Write/MultiEdit) | Protected paths | Blocks edits to `~/.claude/CLAUDE.md`, `~/Projects/CLAUDE.md`, any `AGENTS.md` unless content contains `PROMOTION_APPROVED`. ~/.claude/rules/ explicitly removed from hard protection. | **BLOCK** unless approved |
| `input-rewriter.js` | PreToolUse(Bash) | Commit messages, path expansions | Warns on non-conventional commit messages, auto-expands `~/` for cat/less/more/head/tail | Advisory + rewrite |
| `post-edit-format.sh` | PostToolUse(Edit/Write/MultiEdit, async) | Edit completions | Auto-runs Biome or Prettier on JS/TS files based on project config | Non-blocking |
| `gsd-context-monitor.js` | PostToolUse (any, async) | Always | Reads `/tmp/claude-ctx-{sessionId}.json`, injects **WARNING at 15% remaining**, **CRITICAL at 8% remaining** (upgraded for 1M context = 150K/80K tokens), 5-call debounce, severity escalation bypasses debounce | Advisory (additionalContext injection) |
| `auto-adapt-mode.js` | PostToolUse + SubagentStop (async) | Every tool | Tracks tool approval counts in `~/.claude/adaptations.json`. Never remembers 13 dangerous patterns (rm-rf, force-push, DROP, sudo, chmod 777, fork-bomb, mkfs, dd, /dev/sd, --no-verify, --force-with-lease, truncate, DELETE FROM). | Non-blocking tracking |
| `pre-compact.js` | PreCompact | On compaction | Logs event to `~/.claude/session-data/compaction-log.txt`, appends marker to latest session file | Non-blocking |
| `pre-compact-memory-flush.js` | PreCompact (async) | On compaction | Writes `/tmp/claude-precompact-flush-{user}.json` marker | Advisory only |
| `post-compact-recovery.js` | PostCompact | Post-compaction | Outputs reminder: "call mem_context, check planning files, review MEMORY.md" | Advisory (decision: allow + reason) |
| `desktop-notify.sh` | Stop (async) | Agent natural stop | macOS osascript notification with first-line summary | Non-blocking |
| `taskmaster.js` | Stop | Agent natural stop | Scans stop_reason/transcript for completion signals ("tests pass", "verified", "build success", "committed", "pushed", "created pr", …) and user-stop signals. Emits stderr nudge if no evidence — **does NOT block** (previously claimed "blocks" but implementation is now soft-nudge). | Advisory stderr (soft nudge) |
| `session-end-summary.js` | Stop (async) | end_turn only | Writes `~/.claude/session-data/auto-summaries/YYYY-MM-DD_HH-MM-SS.json` with timestamp + cwd + note | Non-blocking |
| `session-start-memory.sh` | SessionStart | Session boot | Drains stdin, prints "Session Auto-Init" instructions: call mem_context, check claude-mem, review MEMORY.md, all always-on enforced | Inject (cat <<'INIT') |
| `prompt-checklist.js` | UserPromptSubmit | Each prompt | Emits "Auto-powers: memory-search → skill-check → research-first → verify-before-done" nudge, throttled to 10/hour, skips short/conversational messages | Advisory stdout |
| `correction-capture.js` | UserPromptSubmit (async) | Each prompt | Scans 14 correction patterns ("no, use", "don't use", "stop doing", "actually,", "instead,", "remember:", "always:", "never:", "I said", "I asked for", …). FIFO-capped 50 entries in `~/.claude/learnings-queue.json`. | Non-blocking capture |

### 6.2 Hooks registered in settings.json

Counting entries: **PreToolUse=9, PostToolUse=3, PostToolUseFailure=1, PreCompact=2, PostCompact=1, SubagentStop=1, Stop=3, SessionStart=1, UserPromptSubmit=2** = **23 registrations**. Several scripts fire on multiple events (`auto-adapt-mode.js` on both PostToolUse and SubagentStop; `mcp-health-check.js` on both PreToolUse and PostToolUseFailure). That's **19 distinct scripts** firing across **23 hook registrations**.

### 6.3 Drift: CLAUDE.md claims "21 hooks"

Undercounts the actual 23 registrations and overcounts distinct scripts (19). Probably stale after session-4's cleanup removed some. Either way, the advertised number is wrong. **FLAG**: update CLAUDE.md to say "23 hook registrations (19 distinct scripts)".

### 6.4 State files these hooks produce/consume

- `~/.claude/hooks/scripts/.loop-state-{sessionId}.json` — loop-detection sliding windows (20+ files currently present).
- `~/.claude/hooks/scripts/.tool-count-{sessionId}` — suggest-compact counter (20+ present).
- `/tmp/claude-ctx-{sessionId}.json` — statusline → gsd-context-monitor bridge (written by claude-hud statusline).
- `/tmp/claude-ctx-{sessionId}-warned.json` — gsd-context-monitor debounce.
- `/tmp/claude-prompt-checklist.json` — prompt-checklist throttle.
- `/tmp/claude-precompact-flush-{user}.json` — pre-compact-memory-flush marker.
- `~/.claude/mcp-health-cache.json` — mcp-health-check state.
- `~/.claude/adaptations.json` — auto-adapt-mode tool approval counts.
- `~/.claude/learnings-queue.json` — correction-capture FIFO (927KB currently; contains user corrections for future `/reflect` / `/dream-cycle`).
- `~/.claude/session-data/compaction-log.txt` — pre-compact event log.
- `~/.claude/session-data/auto-summaries/*.json` — per-session end_turn summaries.

---

## 7. Quality Bars from Rules (cross-check vs. memory archaeology)

### 7.1 Rules-derived bars (from `~/.claude/rules/*.md` — stable, file-based)

1. **Immutability**: always return new objects (coding-style.md).
2. **Many small files**: 200-400 typical, 800 max (coding-style.md).
3. **Reference completeness**: Grep all callers before modifying signatures (coding-style.md, tagged PROMOTION_APPROVED).
4. **No deep nesting**: >4 levels forbidden (coding-style.md).
5. **Explicit error handling**: never silently swallow (coding-style.md).
6. **Fail-fast input validation at system boundaries** (coding-style.md).
7. **Scope discipline**: output scope only; research/planning/testing are process scope (coding-style.md).
8. **80% test coverage minimum**: unit + integration + e2e required (testing.md).
9. **RED-GREEN-IMPROVE TDD**: non-negotiable (testing.md + test-engineer agent).
10. **No hardcoded secrets**: env vars or secret manager only (security.md).
11. **OWASP Top 10 gate** before any commit (security.md).
12. **CLARIFY → PLAN → ACT**: never start implementation with ambiguity (clarification-first.md).
13. **2-3 clarification questions max per round** (clarification-first.md).
14. **Planner → test-engineer → code-reviewer → commit** pipeline (development-workflow.md).
15. **`/compact` at 50% proactive**, not at auto-threshold (development-workflow.md).
16. **`mem_context` after compaction** mandatory (development-workflow.md + wal-protocol.md).
17. **Memory taxonomy hard limits**: MEMORY.md ≤200 lines, ≤45 entries across user/feedback/project/reference (memory-taxonomy.md).
18. **WAL-before-destruction**: save to Engram before compaction/clear/session end (wal-protocol.md).
19. **Error-lifecycle OPEN/SNOOZED/RESOLVED** tracking (error-lifecycle.md).
20. **Iron Laws** per agent: evidence-before-diagnosis (debugger), measure-before-optimize (performance-profiler), no-code-without-failing-test (test-engineer), no-approval-without-evidence (verifier).
21. **3 retry cap**: after 3 failed approaches, escalate to `/tree-search` or ask user (always-on-behaviors §12).
22. **Never modify tests to make them pass** unless tests are wrong (always-on-behaviors §12).
23. **Multi-query search**: different wordings, library docs > snippets (always-on-behaviors §13).
24. **Session contract**: asked / planned / delivered / verified — verify 3 matches 1 and 4 proves it (always-on-behaviors §14).
25. **Subagent always-pass `name` field** + prefer inline self-review over subagent loops (CLAUDE.md).

### 7.2 Memory-derived bars (from `feedback_wotann_quality_bars*.md` — Gabriel's explicit rejections)

**Session 1 (4 bars)**:
1. No vendor-biased `??` fallback tails (use `null` or local default "ollama"; single source of truth: `src/providers/model-defaults.ts:PROVIDER_DEFAULTS`).
2. In-memory buffer caps default UNBOUNDED (opt-in via env var `WOTANN_*_MAX` or constructor option; explicit `null` = unbounded; SQLite retention is opt-in maintenance).
3. Sonnet not Haiku for Anthropic worker tier (`claude-sonnet-4-6 → claude-opus-4-6`).
4. Don't skip ANY tasks regardless of effort — document deferred items with concrete reasons.

**Session 2 (5 bars)**:
5. Opus for every audit (explicit `model: "opus"` in Agent dispatches — default Explore misses things).
6. Honest stubs over silent success (`{ok: false, error: "not yet wired — see GAP_AUDIT_...md"}` not fake success).
7. Per-session state, not module-global (`Map<sessionId, Set>` with FIFO + `clearReadTrackingForSession`).
8. HookResult.contextPrefix as the context-injection channel (no side effects, no custom callbacks).
9. Test files can codify bugs — update alongside the production fix.

**Session 3 (3 bars — per session 5 progress note)**:
10. Sibling-site scan (when fixing a pattern in one file, Grep for the same pattern elsewhere).
11. Singleton threading, not parallel construction (shadow-git, other singletons).
12. Environment-dependent test assertions break on clean CI.

**Session 4 (1 bar)**:
13. **Environment-dependent TEST-GATE logic breaks coverage of production code paths.** `(WOTANN_TEST_MODE || VITEST) && (NODE_ENV === "test" || VITEST)` hid a runtime-broken fetch dispatcher behind 43/43 passing tests. Fix: explicit string equality (`=== "1"` / `=== "true"`), mandatory NODE_ENV guard not OR'd with test signal. Applies to any env-guard that gates a DEFENCE.

**Session 5 bar (per MEMORY.md row 16):** "commit-message-is-claim verification" — but the session-5 feedback file `feedback_wotann_quality_bars_session5.md` **does not exist on disk** (only sessions 1/2/4 files present). This is a drift: MEMORY.md claims the rule exists, but the underlying file isn't there.

### 7.3 Cross-cut drift check

- **Rules vs. memory**: No direct contradictions. Rules are general; memory bars are WOTANN-specific. The memory bars are proximate operational rules that build on the general principles.
- **Rule 22** ("never modify tests to make them pass") and **memory bar 9** ("test files can codify bugs — update alongside production fix") **appear contradictory** but are actually complementary: test change is only permitted if the test was asserting a bug (codifying wrong behavior). This nuance is not captured in rules/testing.md.
- **Rule 10** (no hardcoded secrets) + **memory bar 1** (no vendor-biased fallbacks) cover overlapping but distinct anti-patterns. Could be consolidated as "no hidden vendor defaults" in a future rules pass.
- **Rule 17** (MEMORY.md ≤200 lines) — **current MEMORY.md is 17 lines**. No drift. But session transcripts linked from MEMORY.md live at legacy path `~/.claude/session-data/` — fine.
- **Memory bar 13** (env-dependent test gates) should be **promoted to rules/testing.md** since it's a universal anti-pattern. Currently lives only in auto-memory feedback.

---

## 8. CI Workflow State

### 8.1 Active workflows

- **`ci.yml`**: typecheck-build (GH-hosted ubuntu+macos), test (self-hosted linux/shard 1+2), desktop-typecheck (GH-hosted ubuntu). **All three active per the commit history** (latest commit 2026-04-19 08:21 ET per file mtime).
- **`release.yml`**: triggered on `v*` tags. Builds 5-target matrix, uploads artifacts, drafts GitHub Release, publishes to npm (if NPM_TOKEN set).

### 8.2 What is active vs. broken

- **typecheck-build**: presumed active and green (no evidence of breakage in rules/memory).
- **test (self-hosted)**: **requires self-hosted runner on Gabriel's laptop**. Per `docs/SELF_HOSTED_RUNNER_SETUP.md`, if the laptop is offline or asleep, `test` jobs queue indefinitely with "Waiting for a runner to pick up this job…" message. The fallback label ensures jobs queue rather than fail, but they don't progress either.
- **desktop-typecheck**: assumes `desktop-app/package-lock.json` exists.
- **release.yml**: **has a silent-success footgun** at the package step: `cp dist/index.js "$ART" || printf '#!/bin/sh\n' > "$ART"` — a failed build will ship an empty sh script named `wotann-{version}-{target}`. Violates session-2 honest-stubs rule.
- **release.yml npm-publish**: requires `NPM_TOKEN` secret. If absent, publish fails but build succeeds.

### 8.3 Drift vs. past-session claims

- Session-6 handoff notes "59 commits pushed to origin after session 5" — on HEAD there are commits from Apr 19 (today) that post-date that; 5 recent feature commits visible (tool-pattern-detector, reflection-buffer, chain-of-verification, semantic-cache, template-compiler). These are **not yet committed to the current working tree** per `git status --short` (shows only untracked txt files + Package.resolved + __pycache__). So HEAD is ahead of session-6 state and locally clean.
- `Formula/wotann.rb` version (0.4.0) vs. `package.json` version (0.1.0) — **4-version drift**.
- CLAUDE.md claim of "21 hooks" vs. actual 23 registrations / 19 scripts — **drift**.
- CLAUDE.md `src/` directory list (22 subdirs) vs. actual (50 subdirs) — **56% of src/ undocumented in CLAUDE.md**.

### 8.4 Required manual actions from memory archaeology

- Session-4 progress note says: "**Rotate exposed Supabase anon key at supabase.com dashboard** — key `sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT` still works in production until rotated." This is **4 sessions unchanged** (session 3-6). Active security issue. **FLAG.**

---

## 9. Drift / Gaps Found (ruthless honesty)

### 9.1 Config-says-X-but-code-says-Y drift

1. **Formula/wotann.rb version 0.4.0 vs. package.json 0.1.0** — 4-version gap. Either package.json is stale (never bumped) or formula was bumped speculatively. Given comments in the formula say SHA placeholders are "regenerated by release workflow on tag push", but the release.yml doesn't actually update the formula, the formula is a **disconnected artifact**. No automated path to reconcile.
2. **release.yml packages `dist/index.js` as the artifact**, not a SEA-bundled node binary. But Formula/wotann.rb's comment says "WOTANN ships as a single executable — no extra deps required at runtime (Node is statically bundled via node --experimental-sea)". The claim contradicts the shipped artifact. **Users installing the released tarball get a bare `.js` file that needs Node.** The SEA pipeline in `scripts/release/build-all.sh` is never invoked by CI.
3. **CLAUDE.md claims 21 hooks; actual is 23 registrations / 19 distinct scripts.** Stale count.
4. **CLAUDE.md directory structure lists 22 src/ subdirs; actual is 50.** 28 undocumented: `acp, agents, api, auth, autopilot, browser, cli, connectors, git, lib.ts, mcp, meet, mobile, monitoring, plugins, runtime-hooks` (and the docs list several that exist — computer-use, desktop, etc. — but misses many).
5. **REPOS.md lists 10 tracked repos; monitor-config.yaml tracks 46 github + 10 cloned = 56.** REPOS.md is stale from 2026-04-13.
6. **`openai/codex` listed twice in monitor-config.yaml** (line 100 + line 331) — needs dedup.
7. **`monitor-repos.md` tracks 28 repos; `monitor-config.yaml` tracks 56 github+cloned; only ~8 overlap.** Two separate tracking regimes with different scopes; no unification.
8. **MEMORY.md row 16 references "Session 3 Quality Bars"** pointing to `feedback_wotann_quality_bars_session2.md` (typo? should be _session3.md?) — but **session-3 quality-bars file doesn't exist**. Bars 10-12 are described only in the project_wotann_sprint78_progress.md narrative, not crystallized in a feedback file. **Drift**: the rules system promises crystallization after session 3 but only sessions 1/2/4 made it.
9. **`research/competitor-analysis/_DOCS_AUDIT_2026-04-18.md`** exists — audits the 12 competitor-analysis files. Spec for this task lists 7 files; 12 exist. Past-session Claude generated more than the spec asked.
10. **`.eslintrc.json` removed** (only `eslint.config.js` exists); `config-protection.js` still lists the old `.eslintrc.*` patterns for protection — harmless but vestigial.
11. **CI `ci.yml`** uses `runs-on: [self-hosted, linux]` but `SELF_HOSTED_RUNNER_SETUP.md` admits "a macOS runner with the `linux` label in its registration set will still pick up these jobs". The label is semantically a lie — Gabriel's laptop is macOS labeled as linux. Self-documenting but misleading.
12. **`postinstall` script in package.json is soft-fail** (`|| echo 'Build failed…'`). A user running `npm install wotann` with a broken native-module toolchain gets a "bin not found" error on run, not on install. Violates session-2 honest-stubs rule.
13. **Deps vs. imports**: all 13 declared deps (including optional and peer) are imported in src/. No dead deps found. No undeclared imports found. `picomatch` override has no visible consumer in src/ (likely transitive).
14. **Gabriel's exposed Supabase anon key** — still not rotated 4 sessions later per session-4 progress note. **Security drift.**

### 9.2 Claim-vs-reality contradictions in competitor-analysis docs

- **browser-codex-tutoring doc flags** `src/browser/camoufox-backend.ts` as "completely fake" (spawns fresh Python subprocess per call, no persistent session). If past-session Claude claimed "browser automation works" in any commit message, the claim was false. **Commit-message-is-claim verification** is specifically named as session 5 quality bar — this is the pattern it was created to catch.

### 9.3 Past-session Claude false claims to verify against current code

This agent's scope is config archaeology, not code audit. But as pattern-flags:
- Session-5 progress note says "2 false-claim CRITs" were closed — examples of past-session Claude overclaiming. Pattern likely persists.
- Session-4 progress note says 83→0 lint warnings cleanup surfaced "~15 real dead-code / silent-drift bugs" that were individually fixed, not suppressed. This is the **fix-not-hide** pattern at the rules level. Still a live concern.
- Homebrew formula 0.4.0 is the most explicit example: **no release has been made, no tap exists, no SHA is real**. But the formula claims version 0.4.0. This is past-session speculative aspiration hardcoded as config.

---

## 10. Summary for the audit coordinator

The WOTANN project is a well-instrumented TypeScript-first multi-provider agent harness with a sophisticated but sometimes self-contradictory configuration surface. The most important authoritative sources are:

1. **`package.json`** — 11 runtime deps + 2 optional + 1 peer. All used. Version 0.1.0.
2. **`tsconfig.json`** — strict mode, Node16 ESM, no DOM. Tests excluded from typecheck.
3. **`eslint.config.js`** — ESLint 9 flat, TS-aware, prettier-compatible. 0 warnings per session-4.
4. **`.github/workflows/ci.yml`** — 3 jobs. Test is self-hosted on Gabriel's macOS laptop labeled as Linux.
5. **`.github/workflows/release.yml`** — tag-triggered, 5-platform matrix, silent-success footgun on missing dist/index.js. SEA pipeline not wired.
6. **`Formula/wotann.rb`** — 4 versions ahead of package.json, SHA placeholders, no tap exists.
7. **`~/.claude/settings.json`** — 44 enabled plugins, 23 hook registrations, max compute (opus[1m], max effort, 63,999 thinking tokens), auto-compact disabled.
8. **19 hook scripts** enforce everything from `--no-verify` blocking to MCP health backoff to post-compact memory recovery. Taskmaster is now a soft nudge, not a block.
9. **10 rules files** define 25 durable quality bars. **3 WOTANN-specific memory feedback files** add 13 more bars (sessions 1, 2, 4).
10. **12 custom opus agents** with explicit iron-laws and phase protocols. Worth mirroring in WOTANN's own agent system.
11. **76 competitor tracking targets** across 4 overlapping source files. Needs unification.
12. **12 competitor-analysis docs** (7 per the task spec + 5 extras) — all read and synthesized.

**Most important drifts to address before continuing work:**
- Formula/wotann.rb version 0.4.0 is aspirational; real version is 0.1.0. Either bump package.json or reset formula to 0.1.0 with clear "pre-release" markers.
- release.yml packages `dist/index.js` directly; Formula claims SEA single-executable. Reconcile (invoke `scripts/release/build-all.sh` from CI or retract the Formula claim).
- MEMORY.md claims session-3 quality-bars file exists; it doesn't. Crystallize bars 10-12 into `feedback_wotann_quality_bars_session3.md`.
- monitor-config.yaml has a duplicate openai/codex entry.
- Supabase anon key `sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT` — **4 sessions unrotated**. Gabriel's manual action required.
- CLAUDE.md count of "21 hooks" is stale.
- CLAUDE.md src/ directory list covers 22/50 subdirs (44% coverage). Either prune src/ (align to docs) or expand docs (align to src/).
- The three competitor-tracking files (monitor-config.yaml, monitor-repos.md, REPOS.md) maintain separate lists with minimal overlap. Unify.

**Configuration philosophy is healthy**: strong isolation via hooks (config-protection, promotion-guard, dangerous-command-guard), explicit Iron Laws in agents, strict TypeScript, memory-taxonomy limits, WAL protocol, error-lifecycle tracking, comprehensive CI gating lint+typecheck+build+test. The agent harness culture at the meta-layer is internally consistent and mature. **The drift is in synchronization** — configs ahead of code or behind code, docs out of sync with reality, multiple overlapping lists — not in fundamental design.

---

*End of CONFIG_REALITY.md. All sources read in full per directive. No gold-plating.*
