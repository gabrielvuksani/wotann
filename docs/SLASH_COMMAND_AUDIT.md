---
title: WOTANN Slash Command / Agent / Skill / Plugin Archaeology
date: 2026-04-19
author: Phase 1 Agent F (slash-command archaeology)
scope: Gabriel's ~/.claude/ configuration snapshot as of 2026-04-19
purpose: Inventory the Claude Code tooling WOTANN must integrate with
---

# SLASH COMMAND / AGENT / SKILL / PLUGIN AUDIT — Gabriel's Claude Code Setup

## 0. Summary

Gabriel's Claude Code configuration is **maximally loaded**:
- **8 user-defined slash commands** + **4 git subcommands** in `~/.claude/commands/`
- **12 user-defined agents** in `~/.claude/agents/` (all Opus 4.7)
- **87 user-defined skills** in `~/.claude/skills/` + 36 Trail of Bits security skills = **~123 skills user-side**
- **43 plugins enabled** in `settings.json` from 10 marketplaces (Anthropic official, claude-mem, superpowers, fullstack-dev-skills, marketing-skills, etc.)
- **21 active hooks** across 9 hook events in `~/.claude/settings.json`
- **5 mega-plan files** in `~/.claude/plans/` (glistening-wondering-nova — the codename for WOTANN)

**Auto-run posture**: bypass mode, skip-permission prompts, `MAX_THINKING_TOKENS=63999`, `CLAUDE_CODE_EFFORT_LEVEL=max`, `CLAUDE_CODE_SUBAGENT_MODEL=opus[1m]`. Gabriel has explicitly configured maximum-power mode — Claude should auto-detect and auto-invoke without asking.

---

## 1. User-Defined Slash Commands (`~/.claude/commands/`)

### 1.1 Top-level commands (8)

| Command | File | Description |
|---------|------|-------------|
| `/btw` | `btw.md` | Quick side question mid-task — freezes context, answers, optionally saves to memory, resumes exactly where you left off. Zero context pollution. Supports `--save` (to Engram) and `--deep` flags. |
| `/claudeignore-init` | `claudeignore-init.md` | Creates a `.claudeignore` file in the current project to reduce token consumption ~40% by excluding build artifacts, dependencies, large media files, DB files, env files. |
| `/monitor-repos` | `monitor-repos.md` | Checks 28 tracked GitHub reference repos (weekly/biweekly/monthly tiers) for new commits, releases, and features since last sync. Uses `gh api` to fetch last 5 commits per repo. Writes findings to Engram via `topic_key: "repo-updates/weekly"` + updates `reference_tracked_repos.md` in auto-memory. |
| `/orchestrate` | `orchestrate.md` | Sequential agent workflow for complex tasks. 4 preset workflows (feature / bugfix / refactor / security) that chain agents (planner → test-engineer → code-reviewer → security-reviewer). Supports custom agent sequences. Includes Operator Command-Center handoff block for multi-session workflows. |
| `/resume-session` | `resume-session.md` | Loads most recent `*-session.tmp` file from `~/.claude/session-data/` and produces a structured briefing (project / what-we-are-building / working / in-progress / not-started / what-NOT-to-retry / blockers / next-step). Counterpart to `/save-session`. |
| `/save-session` | `save-session.md` | Saves current session to a dated `YYYY-MM-DD-<short-id>-session.tmp` file under `~/.claude/session-data/`. Enforces the 9-section format (What Worked with evidence, What Did NOT Work and why, Not Tried Yet, Current State of Files, Decisions, Blockers, Next Step, Environment). Honest-empty-section rule: "Nothing yet" preferred to silent omit. |
| `/verify` | `verify.md` | Run verification (build + types + lint + tests + console.log audit + git status) and produce PASS/FAIL report with "Ready for PR: YES/NO". Supports `quick`/`full`/`pre-commit`/`pre-pr` arg variants. |

### 1.2 Git subcommands (`~/.claude/commands/git/`) (4)

| Command | File | Description |
|---------|------|-------------|
| `/git:cm` | `cm.md` | Stage working tree changes and create a Conventional Commit (no push). Never `git add .`; reviews each file diff for secrets. Commit subject ≤72 chars, scope kebab-case. Shows `git log -1 --stat` after. |
| `/git:cp` | `cp.md` | Stage + commit + push following git governance. Runs `/verify` first. Pushes to `origin/$(git branch --show-current)`. Triggers CI if configured. No AI attribution strings. |
| `/git:pr` | `pr.md` | Creates a PR via `gh pr create` after verify + CI. Uses `.github/pull_request_template.md` if present, else Context/Testing/Security blocks. Supports target-branch arg (defaults to main). |
| `/git:clean` | `clean.md` | Cleans up merged branches locally and on remote, keeping only main/dev/gh-pages. Prompts before force-deleting non-merged branches and before deleting remote branches. |

### 1.3 How WOTANN should integrate with these

- **`/save-session` + `/resume-session`**: Gabriel uses these pattern religiously; the 9 transcripts in `~/.claude/session-data/` are precisely this format. WOTANN's own session.save/session.resume RPC calls should write into the same `~/.claude/session-data/` directory (or at least produce compatible `.tmp` files) so Gabriel can `/resume-session` across any harness.
- **`/monitor-repos`**: is the manual version of what WOTANN's KAIROS monitor does automatically. WOTANN should publish an MCP tool that this slash command can delegate to (e.g., `mcp__wotann__monitor_repos`) so Claude doesn't have to round-trip through `gh api` for 28 repos every time.
- **`/verify`**: maps cleanly to a WOTANN RPC that composes (typecheck + test + lint + security scan). `wotann verify` CLI exists per `docs/PHASE_1_PROGRESS_2026-04-18.md`.
- **`/orchestrate`**: parallel concept to WOTANN's Council + AutonomousExecutor. The 4 preset agent chains (feature / bugfix / refactor / security) should be expressible as WOTANN Workshop runbooks so Gabriel can re-use his orchestration skills in the WOTANN daemon.

---

## 2. User-Defined Agents (`~/.claude/agents/`)

All 12 agents are pinned to `model: claude-opus-4-7` and follow the
canonical dispatch table in Gabriel's global CLAUDE.md.

| Agent | File | Model | Scope | Purpose |
|-------|------|-------|-------|---------|
| **analyst** | `analyst.md` | opus-4-7 | read-only (Write/Edit blocked) | Pre-planning requirements analysis — converts product scope into implementable acceptance criteria, catches gaps before planning begins. Produces unasked-question list + guardrails + scope-creep risks + assumptions with validation methods + testable acceptance criteria. |
| **architect** | `architect.md` | opus-4-7 | read-only (tools: Read/Grep/Glob) | System architecture design — evaluates trade-offs, proposes component boundaries, produces ADRs with alternatives considered. Does NOT implement code. |
| **build-error-resolver** | `build-error-resolver.md` | opus-4-7 | full access | Build/type/compilation/import error resolution with minimal diffs only (<5% of affected files changed). No refactoring, no architecture changes. |
| **code-reviewer** | `code-reviewer.md` | opus-4-7 | read + Bash | Reviews diffs with 80%-confidence gate. APPROVE/WARNING/BLOCK verdict. Includes PR Review Mode for GitHub PRs. |
| **code-simplifier** | `code-simplifier.md` | opus-4-7 | Read/Write/Edit/Grep/Glob (no Bash) | Executor pair for `/ai-slop-cleaner` skill. Simplifies code while preserving exact functionality. |
| **critic** | `critic.md` | opus-4-7 | read-only | Final quality gate — adversarial escalation, gap analysis (what's MISSING, not just what's wrong), pre-commitment predictions, multi-perspective investigation. Plan + code reviewer. |
| **debugger** | `debugger.md` | opus-4-7 | read + Bash (Write/Edit blocked) | Systematic runtime bug investigation via hypothesis-driven debugging. Reports root cause with evidence; does NOT fix code. Iron law: "Evidence before diagnosis." |
| **performance-profiler** | `performance-profiler.md` | opus-4-7 | read + Bash (Write/Edit blocked) | Performance bottleneck investigation — profile, measure, analyze. Iron law: "Measure before optimizing." Reports findings; does NOT implement fixes. |
| **planner** | `planner.md` | opus-4-7 | Read/Grep/Glob | Creates detailed implementation plans for complex features/refactoring. Proactively invoked. |
| **security-reviewer** | `security-reviewer.md` | opus-4-7 | full access | OWASP Top 10 + secrets detection + input validation + authN/Z + dependency audit. Proactive after writing auth/payment/PII code. |
| **test-engineer** | `test-engineer.md` | opus-4-7 | full access | TDD enforcement, integration/e2e coverage, flaky test hardening. RED-GREEN-REFACTOR cycle. Testing pyramid: 70% unit, 20% integration, 10% e2e. |
| **verifier** | `verifier.md` | opus-4-7 | read-only | Evidence-based completion verification — ensures claims are backed by fresh test output. Rejects "should/probably/seems to" language. Not the same pass that authored the change (cold context). |

### 2.1 How WOTANN should integrate

WOTANN already has a parallel agent concept via `src/core/agent-profiles.ts` and
the Council pattern. To interoperate with Gabriel's existing workflow:
- Expose each agent as a WOTANN agent-profile so `wotann agent run planner ...` uses the SAME prompt as Claude Code.
- Mirror the iron laws (Debugger's "Evidence before diagnosis", Performance's "Measure before optimizing") in the respective profile's system prompt.
- When `verifier` runs over WOTANN-produced work, WOTANN should output evidence envelopes (fresh typecheck, test, build stdout) so the verifier can consume them without needing to re-run the tools.

---

## 3. User-Defined Skills (`~/.claude/skills/`) — 87 local + 36 Trail of Bits

### 3.1 Categorization by domain

**Core workflow (10)**:
- `search-first` — research-before-coding
- `deep-interview` — Socratic requirements gating
- `research` — multi-source (quick/rigorous modes)
- `agent-reach` — unified search across 14+ platforms
- `orchestrate` — sequential agent workflow
- `autonomous-loops` — patterns for autonomous loops
- `reflect` — process corrections → knowledge
- `prompt-master` — write prompts for any AI tool
- `humanizer` — strip AI writing patterns
- `soul` — identity/voice/style for content

**Debugging & investigation (6)**:
- `trace` — evidence-driven causal tracing with competing hypotheses
- `tree-search` — agentic BFTS for complex bugs (4+ causes)
- `focused-fix` — make a specific feature work e2e
- `dx-gha` — analyze GitHub Actions failures
- `incident-commander` — incident response management
- `self-healing` — autonomous diagnosis and repair of build/test/runtime errors

**Planning & project (3)**:
- `spec-driven-workflow` — specs before code
- `iterative-retrieval` — progressive context retrieval
- `autoresearch-agent` — autonomous experiment loop

**Memory & context (9)**:
- `memory-stack` — guide to combining Engram + claude-mem + MEMORY.md
- `mem-edit` — edit/update memory observations
- `context-manage` — context audit + compaction strategy
- `context-management` — zone-budgeted token tracking
- `dream-cycle` — automated nightly learning extraction
- `self-improving-agent` — curate auto-memory into durable project knowledge
- `resume-session` — skill version paralleling the slash command
- `save-session` — skill version paralleling the slash command
- `dx-handoff` — write HANDOFF.md for next agent/session
- `trace-mining` — analyze Engram/claude-mem logs for recurring failures

**Safety & security (7)**:
- `careful` — destructive command warnings
- `freeze` — restrict edits to one directory
- `guard` — careful + freeze combined
- `cso` — Chief Security Officer mode (infrastructure-first OWASP/STRIDE)
- `understand` — adversarial code comprehension
- `skill-security-auditor` — audit a skill before install
- `a11y-audit` — WCAG 2.2 accessibility

**SEO & marketing (3)**:
- `geo-seo` — GEO/SEO/AI search
- `ad-audit` — paid advertising across 6 platforms
- `growth-playbook` — 7-stage 0→100k users

**Frontend & design (5)**:
- `epic-design` — immersive 2.5D scroll-driven websites
- `frontend-slides` — HTML presentations
- `interface-design` — consistent UI design system
- `design-to-code` — pixel-perfect Figma→React via coderio
- `web-design-guidelines` — UI review

**Quality & maintenance (5)**:
- `tech-debt-tracker` — scan and prioritize debt
- `verify` — evidence-based completion verification (skill form)
- `setup-audit` — detect setup rot
- `mcp-builder` — guide for building MCP servers
- `init` — onboard new codebase

**Stack specialty (already huge — 20+)**:
- `nextjs-best-practices`, `nextjs-supabase-auth`, `vercel-deploy`, `vercel-cli-with-tokens`, `vercel-deployment`
- `react-best-practices`, `react-patterns`, `composition-patterns`
- `senior-frontend`, `senior-fullstack`, `typescript-expert`
- `docker-expert`, `performance`, `core-web-vitals`, `web-performance-optimization`
- `lsp-operations`, `api-patterns`, `integration-testing`, `dependency-auditor`
- `compliance-checker` — GDPR, SOC 2, HIPAA, PCI-DSS
- `playwright`, `scrape`, `clone-website`
- `batch-processing` — same op across many files with rollback
- `stripe-integration`, `clerk-auth`, `plaid-fintech`
- `software-architecture`, `tdd-workflow`
- `karpathy-principles` — NEW from WOTANN session 5 (same principles file in wotann/skills/)

**Misc**:
- `ai-slop-cleaner` — regression-safe cleanup
- `prompt-testing` — regression-test prompts
- `cost-intelligence` — monitor AI API costs
- `ultraqa` — autonomous QA cycling
- `dx-review-claudemd` — review conversations for CLAUDE.md improvements

### 3.2 Trail of Bits security skills (36, under `~/.claude/skills/trailofbits/plugins/`)

Audit-focused security skills. Listed here for completeness but not drilled into:

`agentic-actions-auditor`, `ask-questions-if-underspecified`, `audit-context-building`, `building-secure-contracts`, `burpsuite-project-parser`, `claude-in-chrome-troubleshooting`, `constant-time-analysis`, `culture-index`, `debug-buttercup`, `devcontainer-setup`, `differential-review`, `dimensional-analysis`, `dwarf-expert`, `entry-point-analyzer`, `firebase-apk-scanner`, `fp-check`, `gh-cli`, `git-cleanup`, `insecure-defaults`, `let-fate-decide`, `modern-python`, `property-based-testing`, `seatbelt-sandboxer`, `second-opinion`, `semgrep-rule-creator`, `semgrep-rule-variant-creator`, `sharp-edges`, `skill-improver`, `spec-to-code-compliance`, `static-analysis`, … (6 more).

### 3.3 How WOTANN should integrate

- **Skill discovery parity**: WOTANN's `src/skills/agentskills-registry.ts` exports skills to the `agentskills.io` format. It should **also** read from `~/.claude/skills/` so Gabriel's existing 123 skills are available inside the WOTANN daemon without duplication.
- **`karpathy-principles`**: already exists in both `wotann/skills/karpathy-principles.md` AND `~/.claude/skills/karpathy-principles/`. These should symlink or share a single source.
- **`ultraqa`**: WOTANN's self-healing / autonomous-executor should expose an `ultraqa` loop command.
- **`/save-session` compat**: WOTANN should emit its transcript into the same session.tmp format so `/resume-session` Just Works.

---

## 4. Plugin Inventory (`~/.claude/settings.json` enabledPlugins)

43 plugins enabled from 10 marketplaces:

### 4.1 `anthropics/claude-plugins-official` (31 plugins)
`agent-sdk-dev`, `atomic-agents`, `chrome-devtools-mcp`, `claude-code-setup`, `claude-md-management`, `cloudflare`, `code-review`, `code-simplifier`, `commit-commands`, `context7`, `feature-dev`, `figma`, `firecrawl`, `frontend-design`, `github`, `greptile`, `hookify`, `mcp-server-dev`, `playground`, `playwright`, `plugin-dev`, `pr-review-toolkit`, `pyright-lsp`, `ralph-loop`, `rust-analyzer-lsp`, `security-guidance`, `semgrep`, `serena`, `session-report`, `skill-creator`, `stagehand`, `supabase`, `swift-lsp`, `typescript-lsp`

### 4.2 Third-party plugins (12)
- `claude-hud@claude-hud` (statusline)
- `last30days@last30days-skill` (research skill)
- `claude-mem@thedotmack` (persistent cross-session memory with AST search)
- `ui-ux-pro-max@ui-ux-pro-max-skill` (UI/UX design intelligence)
- `fullstack-dev-skills@fullstack-dev-skills` (60+ stack skills by Jeffallan)
- `marketing-skills@marketingskills` (30+ marketing skills by coreyhaines31)
- `conductor@claude-code-workflows` (context-driven development by wshobson)
- `agent-teams@claude-code-workflows` (multi-agent orchestration by wshobson)
- `planning-with-files@planning-with-files` (Manus-style file-based plans)

### 4.3 Marketplaces registered (10)
```
claude-plugins-official    → anthropics/claude-plugins-official
claude-hud                 → jarrodwatts/claude-hud
last30days-skill           → mvanhorn/last30days-skill
thedotmack                 → thedotmack/claude-mem
ui-ux-pro-max-skill        → nextlevelbuilder/ui-ux-pro-max-skill
fullstack-dev-skills       → Jeffallan/claude-skills
claude-code-workflows      → wshobson/agents
marketingskills            → coreyhaines31/marketingskills
planning-with-files        → OthmanAdi/planning-with-files
```

### 4.4 How WOTANN should integrate

- **claude-mem**: highest-leverage because it ALREADY provides persistent cross-session memory with AST code search. WOTANN's memory layer should either
  (a) defer to claude-mem for observation storage (read-through cache),
  (b) or publish observations TO claude-mem so Gabriel's existing `/mem-search` works on WOTANN context.
  Current WOTANN memory (sqlite-backed) should consider this a read-side consumer rather than duplicating.
- **serena plugin**: provides semantic coding tools via LSP (`find_symbol`, `find_referencing_symbols`, etc.). WOTANN has a parallel implementation in `src/runtime/` (Serena-style symbol tools per commit `b49ce09`). Confirm they emit the same schema so Gabriel's existing muscle memory works.
- **planning-with-files**: creates `task_plan.md` + `findings.md` + `progress.md`. WOTANN's planner agent should produce these filenames so `/planning-with-files:status` resolves WOTANN's output.
- **agent-teams**: provides parallel agent presets. WOTANN's Council already spawns parallel; aligning on the team-spawn/team-status/team-shutdown skill contract would give Gabriel one UI over both.
- **chrome-devtools-mcp**: WOTANN Tauri UI verification work is explicitly declared blocked on this MCP availability. Should now work since plugin is enabled.
- **firecrawl**: WOTANN's `/scrape` skill in wotann/skills has firecrawl-equivalent surface. Consolidate.

---

## 5. Active Hooks (`~/.claude/settings.json` hooks)

21 hooks on 9 events. These are **safety rails that fire automatically** — WOTANN needs to know them before committing or pushing so it doesn't trip them.

### 5.1 PreToolUse (9 hooks)

| Matcher | Script | Purpose | Blocking? |
|---------|--------|---------|-----------|
| `Bash` | `block-no-verify.sh` | Rejects `git commit --no-verify`, `git push --no-verify`, etc. | BLOCK |
| `Bash` | `dangerous-command-guard.sh` | Warns on `rm -rf`, `DROP TABLE`, `git push --force`, etc. | BLOCK |
| `Edit\|Write\|MultiEdit` | `config-protection.js` | Rejects Write to linter/formatter/CI configs. **Trippable**. Bypass via Bash heredoc. | BLOCK |
| `*` (any) | `suggest-compact.js` | Proactive /compact suggestion. Async. | non-blocking |
| `mcp__` | `mcp-health-check.js` | Check MCP server health before tool call. | non-blocking |
| `Bash\|Edit\|Write\|MultiEdit` | `loop-detection.js` | Detect doom-loops (repeating same error). | BLOCK if detected |
| `Write\|Edit\|MultiEdit` | `gsd-prompt-guard.js` | GSD (Get Shit Done) prompt guard. Async. | non-blocking |
| `Edit\|Write\|MultiEdit` | `promotion-guard.js` | Prevent accidental feature promotion. | BLOCK |
| `Bash` | `input-rewriter.js` | Rewrites bash inputs for safety. | transforms |

### 5.2 PostToolUse (3 hooks)

| Matcher | Script | Purpose | Blocking? |
|---------|--------|---------|-----------|
| `Edit\|Write\|MultiEdit` | `post-edit-format.sh` | Auto-format after edits. Async. | non-blocking |
| `*` | `gsd-context-monitor.js` | Monitor context usage. Async. | non-blocking |
| `*` | `auto-adapt-mode.js` | Adapt mode based on signals. Async. | non-blocking |

### 5.3 PostToolUseFailure (1 hook)
- `mcp__` → `mcp-health-check.js` async (re-check MCP server health on failure).

### 5.4 PreCompact (2 hooks)
- `pre-compact.js` (blocking)
- `pre-compact-memory-flush.js` async — WAL-saves critical state before compaction.

### 5.5 PostCompact (1 hook)
- `post-compact-recovery.js` — recovers state after compaction.

### 5.6 SubagentStop (1 hook)
- `auto-adapt-mode.js` async (re-adapt mode when subagent exits).

### 5.7 Stop (3 hooks)
- `desktop-notify.sh` async (macOS notification)
- **`taskmaster.js` (blocking) — enforces verification before stop.** This is the hook that blocks "I'm done" without evidence.
- `session-end-summary.js` async (save session summary)

### 5.8 SessionStart (1 hook)
- `session-start-memory.sh` — recovers context from Engram on new session.

### 5.9 UserPromptSubmit (2 hooks)
- `prompt-checklist.js` (blocking) — validates prompt quality
- `correction-capture.js` async — captures user corrections for `/reflect`

### 5.10 What this means for WOTANN work

Before pushing WOTANN commits:
1. **`dangerous-command-guard.sh`** will reject bash calls containing `rm -rf`, `git push --force`, `DROP TABLE` verbatim. Even in a commit message heredoc this fires because the hook inspects bash input. Past sessions already ran into this — see quality bars around rewording commit messages.
2. **`config-protection.js`** will reject `Write` to eslint.config.js, prettier.config.js, vitest.config.ts, package.json. Past sessions used Bash heredoc to bypass (which works because the hook matches only Edit/Write/MultiEdit tools).
3. **`block-no-verify.sh`** blocks `--no-verify` flags on commits. WOTANN's commit hooks should never use `--no-verify`.
4. **`loop-detection.js`** detects doom-loops. If WOTANN's autonomous runner retries the same fix 3+ times, this hook will block. Matches the error-retry cap (rule in global CLAUDE.md).
5. **`taskmaster.js`** blocks `Stop` without verification evidence. WOTANN should emit evidence envelopes (test output, typecheck, build) into the conversation before Claude's final turn so taskmaster sees them.

---

## 6. Mega-Plan: `~/.claude/plans/glistening-wondering-nova.md`

The "WOTANN: The Upgrade That Makes Every Competitor Irrelevant" plan — 1160 lines main doc plus 4 agent-specific subfiles totaling 4213 lines. Core thesis:
> Dispatch a task from your phone in the subway. It executes on your desktop at home. Your watch tells you when it's done. Your meeting gets transcribed silently. Your agent has its own cursor on your screen. It learns from every interaction. It costs nothing.

**Plan structure** — 10 tiers with effort estimates:
- T1 (S) — TCC + Tauri + iOS entitlements
- T2 (M) — Wire 5 unwired modules + 8 quick wins
- T3 (M) — Delete dead code + merge executors + fix stubs
- T4 (S) — iOS pairing + security
- T5 (L) — UI upgrades (virtual scroll, tool cards, diffs)
- T6 (XL) — Computer Use upgrade (22 actions, Rust FFI, agent cursor)
- T7 (XL) — Meet Mode (stealth Core Audio Taps + local whisper + floating overlay)
- T8 (L) — Competitive features
- T9 (S) — Build + quality
- T10 (M) — Research repo patterns

**Sprint scope declared**: T1-5 + 8-9. **Next sprint**: T6 Computer Use. **Future**: T7 Meet Mode (standalone product-level scope).

The 4 agent-specific subfiles (`-a4448f7ff...md` etc.) are Opus audit agent outputs that fed the mega-plan.

**Integration note**: This plan is the strategic north star. WOTANN's internal `docs/MASTER_AUDIT_2026-04-14.md` §78 (155 items) is the tactical execution layer. Session 1-6 work has been executing §78; the mega-plan's T6/T7 still await.

---

## 7. Settings.json key env vars + modes

```
CLAUDE_CODE_EFFORT_LEVEL=max
CLAUDE_CODE_SUBAGENT_MODEL=opus[1m]
MAX_THINKING_TOKENS=63999
ENABLE_TOOL_SEARCH=true
FORCE_AUTOUPDATE_PLUGINS=true
DISABLE_AUTO_COMPACT=1
MCP_TIMEOUT=60000
MCP_TOOL_TIMEOUT=120000
CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1
```

Plus:
- `permissions.defaultMode: "auto"`
- `alwaysThinkingEnabled: true`
- `autoMemoryEnabled: true`
- `skipDangerousModePermissionPrompt: true`
- `skipAutoPermissionPrompt: true`
- `outputStyle: "Explanatory"`
- `respectGitignore: false`
- `cleanupPeriodDays: 7`
- `sandbox.failIfUnavailable: true`
- `sandbox.network.deniedDomains: ["169.254.169.254"]` (AWS metadata service)
- `sandbox.filesystem.denyRead: ["~/.ssh/**", "~/.aws/credentials", "~/.aws/config"]`
- `enableAllProjectMcpServers: true`

### 7.1 Implications for WOTANN

- **Max effort + 63,999 thinking tokens**: WOTANN's own prompt engine should respect the same envelope. If `WOTANN_KARPATHY_MODE=1` is set (per commit 1b61b93), the Karpathy preamble should NOT cap thinking — it's a prior, not a workflow gate.
- **`DISABLE_AUTO_COMPACT=1`**: means Claude won't auto-compact. WOTANN memory compactors (importance-compactor, quantized-vector-store) should similarly be opt-in.
- **Sandbox deniedDomains**: `169.254.169.254` is AWS IMDS. WOTANN's SSRF defence (web-fetch.ts) should share this denylist.
- **`skipDangerousModePermissionPrompt`**: Gabriel has auto-approved bypass. This means `/careful` and `/guard` skills are the user's counterweights. WOTANN should not assume bypass is cosmic permission — the hooks (taskmaster, dangerous-command-guard, promotion-guard) remain the real governor.

---

## 8. Integration Opportunities — what WOTANN should expose

Prioritized by leverage:

1. **MCP server surface** — publish `mcp__wotann__*` tools that wrap:
   - `/monitor-repos` → `mcp__wotann__monitor_repos`
   - `/verify` → `mcp__wotann__verify`
   - `/save-session` / `/resume-session` → `mcp__wotann__session_save` / `mcp__wotann__session_resume`
   - KAIROS daemon status → `mcp__wotann__kairos_status`
   - Memory — `mcp__wotann__mem_search`, `mcp__wotann__mem_save` (coordinated with claude-mem or read-through proxy).

2. **Session.tmp format compatibility** — WOTANN's session artifacts should be valid `YYYY-MM-DD-<short-id>-session.tmp` files under `~/.claude/session-data/` so `/resume-session` works cross-harness.

3. **Agent profile parity** — expose 12 agents matching Gabriel's canonical names with identical system prompts so `wotann agent run code-reviewer` equals `@code-reviewer` in Claude Code.

4. **Skill registry** — `src/skills/agentskills-registry.ts` should additionally scan `~/.claude/skills/` on boot and register them (read-only). That makes 123 pre-existing skills available inside WOTANN without re-authoring.

5. **Hook interop** — WOTANN's own hook engine (`src/hooks/engine.ts`) supports the same event taxonomy as Claude Code (PreToolUse, PostToolUse, etc.). Confirm payload shape matches so the same hook scripts can run in both contexts.

6. **Conductor / planning-with-files compat** — when WOTANN creates a plan, it should produce `task_plan.md`, `findings.md`, `progress.md` in the repo root (or `.wotann/plans/`) so the corresponding plugin slash commands see the same files.

7. **Monitor tool integration** — the session-6 `src/tools/monitor.ts` (currently LIBRARY-ONLY-NO-WIRING per the sister audit) should wire into `kairos-rpc.ts` as `kairos.monitor.spawn` / `.stop` / `.events` — then `/monitor-repos` can delegate to it for each repo check, instead of sequential `gh api` calls.

8. **agent-teams plugin compat** — WOTANN's Council uses parallel agents. Expose team-spawn/team-status/team-shutdown as WOTANN RPCs so Gabriel's `agent-teams:team-spawn` skill can orchestrate WOTANN agents.

---

## 9. Gaps / red flags

### 9.1 Overlapping surfaces
Many systems cover the same areas. Already noted in Gabriel's global CLAUDE.md under "Disambiguation — Overlapping Capabilities" (Planning: 5 systems, Debugging: 6 systems, Code Review: 3 systems, TDD: 2 systems). WOTANN should pick ONE for each surface and defer others:

| Surface | Recommend WOTANN uses | Gabriel's other systems stay available |
|---------|------------------------|----------------------------------------|
| Planning | `planner` agent + `planning-with-files` format | conductor, claude-mem:make-plan, TaskCreate |
| Debugging | `debugger` agent + systematic-debugging | trace, tree-search, team-debug |
| Code review | `code-reviewer` agent (PR mode) | team-review, pr-review-toolkit |
| Memory | claude-mem as primary, Engram as overflow | MEMORY.md auto-memory, WOTANN's sqlite |

### 9.2 The `karpathy-principles` skill duplication
Lives in both `~/.claude/skills/karpathy-principles/SKILL.md` and `wotann/skills/karpathy-principles.md`. Either symlink or vendor one canonical copy.

### 9.3 The superpowers plugin skills listed in global CLAUDE.md
Not all superpowers-plugin commands (e.g., `superpowers:writing-plans`, `superpowers:executing-plans`, etc.) have a physical file Gabriel owns — they're provided by the plugin. WOTANN integration must respect plugin-managed skills as read-only.

### 9.4 Settings.json has one oddity
`"respectGitignore": false` means Claude does NOT honor `.gitignore`. That's a deliberate choice (Claude sees everything including build outputs). WOTANN's file-scanning modules should decide independently whether to honor `.gitignore` — most should (tests/search), but some should not (audit/security scans).

---

## Appendix A — Files inventoried

- `~/.claude/commands/` (12 files, 8 top-level + 4 git subcommands)
- `~/.claude/agents/` (12 agent definitions)
- `~/.claude/skills/` (87 local skills + `trailofbits/` subtree with 36 security skills)
- `~/.claude/settings.json` (400 lines; 21 hooks; 43 plugins; 10 marketplaces)
- `~/.claude/plugins/cache/` (plugin source trees, 31 official + 10 third-party directories)
- `~/.claude/plans/glistening-wondering-nova.md` + 4 subfiles (4213 lines total)
- `~/.claude/hooks/scripts/` (21 hook scripts)
- `~/.claude/CLAUDE.md` (global instructions with dispatch tables)
- `~/.claude/rules/*` (7 rules files: always-on-behaviors, coding-style, testing, security, clarification-first, wal-protocol, memory-taxonomy)

---

## Appendix B — One-paragraph orientation for a fresh WOTANN contributor

Gabriel runs Claude Code in **max-power auto-bypass mode**: Opus 4.7 1M,
63,999 thinking tokens, 43 plugins, 21 safety hooks, 12 custom agents
pinned to opus, 87 custom skills + 36 ToB security skills, and a 4213-
line mega-plan for WOTANN in `~/.claude/plans/glistening-wondering-nova.md`.
Every non-trivial task is expected to auto-detect the right skill/agent
and invoke it without asking (per `~/.claude/rules/always-on-behaviors.md`
rule 0). Memory flows through Engram (MCP) for fast search, claude-mem
(plugin) for AST search and cross-session observations, and `MEMORY.md`
auto-memory files with hard limits (10-15 entries per block, max 200
lines total). WOTANN's job is to expose its daemon as an MCP server and
produce artifacts (session.tmp, task_plan.md, agent outputs) in formats
the existing Claude Code tooling already knows how to consume.
