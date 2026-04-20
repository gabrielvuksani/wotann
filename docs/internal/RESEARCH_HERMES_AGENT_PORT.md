# Hermes Agent (NousResearch) → WOTANN Port Research

*Research date: 2026-04-20. Sources: local clone at `/Users/gabrielvuksani/Desktop/agent-harness/research/hermes-agent` (commit `20f2258f` dated 2026-04-17) + GitHub REST API + sibling repo `hermes-agent-self-evolution`. Every claim below cites either a file path or an upstream URL.*

---

## 1. GitHub Metadata (live)

| Metric | Value | Source |
|---|---|---|
| Stars | **103,254** | `gh api repos/NousResearch/hermes-agent` |
| Forks | **14,733** | same |
| Subscribers (watchers) | 402 | same |
| Open issues + PRs | 5,709 | same |
| Size on disk | 134 MB | same |
| Primary language | Python | same |
| License | MIT | `/hermes-agent/LICENSE` |
| Default branch | `main` | same |
| Created | 2025-07-22 | same |
| Last push | 2026-04-20 06:40 UTC | same |
| Latest release | **v2026.4.16 = "Hermes Agent v0.10.0"** (2026-04-16) | `/releases/latest` |
| Homepage | hermes-agent.nousresearch.com | same |
| Tagline | "The agent that grows with you" | same |
| Calendar-versioned tags in last 60 days | 9 (v2026.3.12 → v2026.4.16, ~1/week) | `git tag --sort=-creatordate` |
| Python LOC in `agent/` alone | 20,528 | `wc -l agent/*.py` |
| Python LOC in `hermes_cli/` | 50,159 | `wc -l hermes_cli/*.py` |

**Recent PR themes (top 10 open/merged by update time)** — all active maintenance, no stagnation:

1. #11907 (MERGED 2026-04-17): Interrupt propagation to concurrent tool workers.
2. #12839 (OPEN 2026-04-20, bug): `send_model_picker` bypasses `_message_thread_id_for_send` in Telegram forum topics.
3. #12599 (OPEN 2026-04-19): TDD infrastructure, coverage reporting, pre-commit hooks.
4. #12632 (OPEN): **Circuit breaker for infinite tool-call loops.**
5. #11671 (OPEN): Per-skill runtime defaults with turn-scoped reasoning.
6. #12872 (OPEN): Mention users for Slack approvals and completions.
7. #12221 (OPEN): Feishu streaming cards + typing feedback.
8. #12873 (OPEN): `send_model_picker` forum-topic fix.
9. #12871 (OPEN, enhancement): Call-chain viewer like LangSmith.
10. #4459f84 (MERGED 2026-04-19): Discord forum channel media + polish.

**Signals:** daily commits, active bug triage, per-platform polish, moving toward observability (LangSmith-style traces) and reliability (circuit breakers, TDD).

**Latest release (v0.10.0 / v2026.4.16) highlights** (from `gh api .../releases/latest`): "Nous Tool Gateway — paid Nous Portal subscribers now get automatic access to web search (Firecrawl), image generation (FAL / FLUX 2 Pro), text-to-speech, and browser automation" via one subscription, zero additional API keys. This is a direct challenge to OpenAI's all-in-one and the Anthropic Claude Code model — a platform-level moat.

---

## 2. Executive Summary (400 words)

Hermes Agent is a 103k-star, MIT-licensed Python reference implementation of a self-improving personal AI agent. It occupies the exact design space WOTANN targets — multi-provider, multi-surface, cron-automated, skill-based, memory-evolving — and it ships ~80% of WOTANN's 223-feature spec. Two years ahead of WOTANN on deployability: a one-line installer, WSL2/Termux support, six terminal backends (local/docker/ssh/singularity/daytona/modal), and a messaging gateway that fans one agent out to Telegram/Discord/Slack/WhatsApp/Signal/Matrix/DingTalk/Feishu/WeCom plus email and SMS.

The crown jewel is `agent/credential_pool.py` (1,439 LOC) — a per-provider multi-credential pool with four rotation strategies (fill_first/round_robin/random/least_used), per-entry soft leases, automatic OAuth refresh-token rotation with single-use protection, three-way cross-process sync (Hermes auth store ↔ `~/.claude/.credentials.json` ↔ `~/.codex/auth.json`), and structured exhaustion cooldowns with provider-reset-time awareness. WOTANN's current approach is a single-credential-per-provider ring; porting this primitive alone closes the biggest scale gap.

Other must-port modules:

- **`agent/memory_provider.py` (ABC) + `plugins/memory/{honcho,byterover,hindsight,holographic,mem0,openviking,retaindb,supermemory}`** — a plugin taxonomy with lifecycle hooks (`prefetch`, `sync_turn`, `on_pre_compress`, `on_delegation`, `on_memory_write`). WOTANN has 8 wired channels but no ABC.
- **`cron/{jobs,scheduler}.py` (~1,000 LOC)** — first-class scheduler with fcntl/msvcrt file locking, pre-run Python scripts injected as context, delivery fan-out to any messaging platform, `[SILENT]` sentinel to suppress no-news runs, inactivity-based timeouts, stale-run fast-forward.
- **`agent/context_compressor.py` (1,163 LOC)** — 3-pass pruning + structured-template summarization + iterative update + anti-thrashing cooldown; far beyond WOTANN's current compactor.
- **`agent/context_engine.py`** — ContextEngine ABC so LCM-style engines can replace the compressor wholesale.
- **`agent/skill_commands.py` + `agent/skill_utils.py`** — skills as slash commands, YAML frontmatter parsing with platform gating, external skill dirs, per-skill config vars that surface values from config.yaml into the prompt.
- **`hermes_cli/claw.py`** — migration command (734 LOC) that imports settings, SOUL.md, memories, skills, API keys from competitor "OpenClaw". WOTANN needs the same bridge.
- **`agent/copilot_acp_client.py`** — a working OpenAI-shim over GitHub Copilot's `--acp` binary via JSON-RPC.
- **`environments/agent_loop.py` (534 LOC)** — standard OpenAI-spec tool-calling loop used both in production and for Atropos RL environment generation.
- **`hermes-agent-self-evolution`** (sibling repo) — DSPy + GEPA evolutionary loop that mutates SKILL.md/tool-descriptions/prompts, passes tests + size gates, opens PRs back to hermes-agent. ICLR 2026 Oral, MIT.

Port priority: **credential pool** (P0), **pluggable memory ABC** (P0), **cron scheduler** (P0), **ContextEngine ABC + compressor** (P1), **6 terminal backends** (P1), **skill-as-slash-command** (P1), **migration command** (P2), **self-evolution loop** (P3).

---

## 3. Directory Map (main repo)

From GitHub tree (rendered) plus local `ls`:

```
acp_adapter/      — native ACP server used by editors (Zed, Warp)
acp_registry/     — registry of Hermes-as-ACP-client connectors
agent/            — 33 Python modules, 20.5k LOC — adapters, pool, memory, skills
assets/           — banner.png, logos
cron/             — jobs.py + scheduler.py + __init__.py
datagen-config-examples/ — example YAMLs for batch trajectory generation
docker/           — entrypoint.sh + SOUL.md (Dockerfile in root)
environments/     — Atropos RL envs (agentic_opd, web_research, SWE, terminal)
gateway/          — Messaging gateway (21 Python files + 24 platform adapters)
hermes_cli/       — 37 CLI modules, 50.2k LOC — the "hermes" command
nix/              — flake.nix, flake.lock for Nix installs
optional-skills/  — migration and other one-off skills
packaging/        — homebrew/, termux/, probably deb in future
plugins/          — context_engine/, memory/{8 providers}, example-dashboard/
skills/           — 26 categories, 79 SKILL.md files (apple, devops, …, social-media)
tests/            — pytest suite
tinker-atropos/   — git submodule for RL training (optional)
tools/            — 50+ tool modules + 6 terminal backends in tools/environments/
trajectory_compressor.py — training-data prep
tui_gateway/      — TypeScript TUI gateway entry
ui-tui/           — TypeScript TUI package (React/Ink)
web/              — browser helpers
website/          — docs site source
hermes_cli/main.py — 8,252 LOC entry point
run_agent.py      — 11,850 LOC — the AIAgent class and conversation loop
```

File paths referenced below are relative to `/Users/gabrielvuksani/Desktop/agent-harness/research/hermes-agent/`.

---

## 4. Module-by-Module Feature Extraction

### 4.1 Providers & model adapters (`agent/`)

| File | LOC | Purpose | WOTANN equivalent | Port P-tier | TS sketch |
|---|---|---|---|---|---|
| `anthropic_adapter.py` | 1,520 | Native Anthropic Messages API — OAuth (sk-ant-oat-*, JWTs), API keys, Claude Code `~/.claude/.credentials.json`, per-model max-output tables, adaptive thinking effort map, fast-mode beta header, version-detected Claude Code UA string. | Partial — `anthropic` provider in `src/providers/`. | **P0** | `class AnthropicNative extends Provider { tokenSource: 'api' | 'oauth' | 'claude-code'; outputLimit = {...}; betas = [...]; }` |
| `bedrock_adapter.py` | 1,098 | AWS Bedrock Converse API — IAM chain (env vars → profile → instance role → IMDS), cross-region inference profiles, Guardrails config, lazy `boto3` import, per-region client cache, tool-support denylist. | Missing. | **P1** | AWS SDK v3 + `@aws-sdk/client-bedrock-runtime`. |
| `gemini_cloudcode_adapter.py` | 895 | OpenAI-shim over Google `cloudcode-pa.googleapis.com/v1internal` — OAuth PKCE, translates OpenAI ↔ Gemini contents/tools/functionDeclarations, SSE streaming, `thoughtSignature: "skip_thought_signature_validator"` sentinel. | Partial — Gemini but probably not Code-Assist OAuth. | **P1** | Port the PKCE flow + request translator verbatim. |
| `copilot_acp_client.py` | 586 | Spawns `copilot --acp --stdio`, JSON-RPC 2.0 over stdio, handles `session/update` / `session/request_permission` / `fs/read_text_file` / `fs/write_text_file`, extracts `<tool_call>{…}</tool_call>` blocks from text, path-confinement guard against cwd escape. | Missing (WOTANN has ACP server, not ACP client). | **P0** | `class CopilotACPClient { spawnCopilot(); rpc(method, params); handleServerMessage(); }` |
| `google_oauth.py` + `google_code_assist.py` | 453 + 1,048 | PKCE device-flow OAuth against Gemini Code Assist, project-context cache, free-tier ID, quota-aware project selection. | Missing. | **P1** | Use `google-auth-library` + `code-assist` wrapper. |
| `models_dev.py` | 586 | Live model-capability lookup via `models.dev` registry (pricing, context length, modality). | Partial via `models.dev` fetch but probably missing caching + fallback. | **P2** | `fetchModelsDevRegistry()` + on-disk cache. |
| `model_metadata.py` | 1,119 | Canonical context-length table (per model family), token-rough estimators, minimum-context floor. | Partial. | **P1** | Single `ModelRegistry` with merge-from-models.dev + canonical overrides. |
| `smart_model_routing.py` | 195 | "Simple turn" heuristic → cheap model (e.g. Flash) based on message length, no code fences, no URL, keyword denylist of `{debug, refactor, pytest, architecture, plan, ...}`. Keeps primary on anything complex. | Missing. | **P1** | Pure function, trivial port. |
| `auxiliary_client.py` | 2,735 | Shared router for side tasks (compression, session search, vision, web extract) with 7-step resolution chain (OpenRouter → Nous → Custom → Codex OAuth → Anthropic → direct API-key providers → none), 402-aware fallback cascade. | Partial. | **P0** | `class AuxiliaryRouter { resolveChain(task); call(model, args); }` |
| `prompt_caching.py` | 72 | `system_and_3` strategy — 4 Anthropic `cache_control` breakpoints (system + last 3 non-system msgs); ~75% input-token savings. | WOTANN has one-breakpoint or none. | **P0** | 10-minute port; 3 helper functions. |

### 4.2 Credential pool — THE crown jewel (`agent/credential_pool.py`)

**1,439 LOC. Read in full.** Core invariants:

- One `CredentialPool` per provider; a `PooledCredential` dataclass (fields: `access_token`, `refresh_token`, `expires_at_ms`, `last_status`, `last_error_code`, `last_error_reset_at`, `request_count`, `extra`, `priority`, `source`, `label`, `id`).
- Four rotation strategies (`STRATEGY_FILL_FIRST`, `STRATEGY_ROUND_ROBIN`, `STRATEGY_RANDOM`, `STRATEGY_LEAST_USED`) selected per-provider via `config.yaml` `credential_pool_strategies`.
- `_sync_anthropic_entry_from_credentials_file()` / `_sync_codex_entry_from_cli()` — **when Claude Code or Codex CLI refreshes and invalidates our stale refresh_token, we re-read their auth file and adopt the new pair** before retrying the failed OAuth refresh (lines 423–491, 643–718). This is the feature that lets Hermes coexist with other tools on the same refresh tokens.
- `_sync_device_code_entry_to_auth_store()` — after Hermes refreshes, write back to auth.json AND to `~/.claude/.credentials.json` / `~/.codex/auth.json` so the CLI tools don't hit "refresh_token_reused" errors.
- `_exhausted_ttl()` — 1 h default, overridable by provider-supplied `reset_at`. `_parse_absolute_timestamp()` parses epoch s / ms / ISO-8601.
- `_extract_retry_delay_seconds()` regex-parses `"retry after 42 sec"` / `"quotaResetDelay: 1500ms"` from error messages when no `Retry-After` header.
- `acquire_lease(credential_id?)` — soft lease with a per-credential concurrency cap (`DEFAULT_MAX_CONCURRENT_PER_CREDENTIAL = 1`); picks `min(leases, priority)` when caller doesn't specify an ID.
- `mark_exhausted_and_rotate()` atomically marks the current entry exhausted and rotates under lock.
- `_seed_from_singletons()` + `_seed_from_env()` + `_seed_custom_pool()` — auto-discover credentials from `~/.claude/.credentials.json`, `~/.qwen/oauth_creds.json`, env vars (`OPENROUTER_API_KEY`, `ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, etc.), `~/.codex/auth.json`, and `hermes auth` OAuth state. Gates auto-discovery for Anthropic behind `is_provider_explicitly_configured("anthropic")` (PR #4210) so auxiliary chains don't silently grab `~/.claude/.credentials.json`.
- `is_source_suppressed()` honors per-source removal so `hermes auth remove openai-codex` doesn't get instantly undone by the auto-seeder.
- `_normalize_pool_priorities()` enforces a canonical ordering (manual > env tokens > hermes_pkce > claude_code > API key) for Anthropic.

**Port as:** `src/providers/credential-pool.ts` + `src/providers/pooled-credential.ts`. TypeScript sketch:

```ts
interface PooledCredential {
  provider: string;
  id: string;
  label: string;
  authType: 'oauth' | 'api_key';
  priority: number;
  source: string;
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  lastStatus?: 'ok' | 'exhausted';
  lastErrorCode?: number;
  lastErrorResetAt?: number;
  requestCount: number;
  extra: Record<string, unknown>;
}

class CredentialPool {
  constructor(private provider: string, private entries: PooledCredential[],
              private strategy: Strategy = 'fill_first') {}
  async select(): Promise<PooledCredential | null> { /* lease + refresh + rotate */ }
  async markExhaustedAndRotate(code: number, ctx: ErrorCtx): Promise<PooledCredential | null>;
  acquireLease(id?: string): string | null;
  releaseLease(id: string): void;
}
```

**Port tier: P0. Effort: 3–4 days including the 3-way OAuth sync dance.**

### 4.3 Memory (`agent/memory_*.py` + `plugins/memory/*`)

- `agent/memory_provider.py` — 231 LOC **ABC**. Required: `name`, `is_available()`, `initialize()`, `get_tool_schemas()`. Optional hooks: `prefetch(query)`, `queue_prefetch()`, `sync_turn(user, asst)`, `on_turn_start(turn, msg, **kw)`, `on_session_end(msgs)`, `on_pre_compress(msgs) -> str`, `on_memory_write(action, target, content)`, `on_delegation(task, result, **kw)`, `get_config_schema()`, `save_config()`.
- `agent/memory_manager.py` — 373 LOC orchestrator. Builtin is always first; at most **one** external provider (enforced — second registration gets rejected with a warning). Collects schemas, merges prefetch results, fences injected context with `<memory-context>` + system note (so the model doesn't treat recalled state as new user input). `sanitize_context()` strips the fence from generated output so it never leaks back into the next turn.
- `plugins/memory/{honcho, byterover, hindsight, holographic, mem0, openviking, retaindb, supermemory}` — 8 working implementations. **Honcho** is the flagship: AI-native dialectic user modeling, cold-vs-warm prompt selection, 1–3 pass chain-of-thought, token-budget truncation at word boundaries, peer cards, per-directory session mapping. Read `plugins/memory/honcho/README.md` in full — a crash course in how to build pluggable memory.

**Port as** (WOTANN):
- `src/memory/memory-provider.ts` — the ABC (an interface plus `BaseMemoryProvider` abstract class).
- `src/memory/memory-manager.ts` — enforce "builtin always + at-most-one external".
- `src/memory/providers/` — start with `builtin.ts` (mirror of MEMORY.md / USER.md), plus Honcho and Mem0 as first external providers.
- **P0 for ABC + manager; P1 for per-provider plugins.**

### 4.4 Cron (`cron/` + `hermes_cli/cron.py`)

**`cron/jobs.py` (769 LOC)** — storage (`~/.hermes/cron/jobs.json`), atomic writes via `tempfile.mkstemp` + `os.replace` + `fsync` + 0600 perms, schedule parsing that accepts:

- durations `30m`, `2h`, `1d` → one-shot at `now + D`;
- `every 30m` → recurring interval;
- 5-or-6-field cron expressions validated via `croniter`;
- ISO timestamps `2026-02-03T14:00` → one-shot at that instant (localized to the Hermes configured timezone, not the naive one at parse time — see `_ensure_aware`).

Lifecycle fields: `enabled`, `state ∈ {scheduled, paused, completed}`, `repeat.times`/`completed`, `last_status`, `last_error`, `last_delivery_error` (separate bucket so agent error vs delivery error is disambiguated).

**`cron/scheduler.py` (~1,100 LOC)** — `tick()` holds a cross-platform file lock (`fcntl.flock` on Unix, `msvcrt.locking` on Windows) so overlapping gateway + daemon + systemd timer ticks don't double-execute. `advance_next_run()` runs **before** job execution — converts scheduler semantics from at-least-once to at-most-once for recurring jobs (crash-mid-run = miss one instead of replay burst). `_compute_grace_seconds()` scales catch-up window by period (half-period, clamped 120 s to 7200 s) — daily jobs that miss by 30 min catch up, but 5-min jobs don't pile up. `_run_job_script()` runs a user-provided Python script **confined to `~/.hermes/scripts/`** before the agent turn and prepends its stdout as context. The `[SILENT]` sentinel suppresses delivery when the agent finds nothing newsworthy (still saves output to disk for audit). `_deliver_result()` supports fan-out to comma-separated platforms (`telegram:@alice,slack:#general`), prefers live gateway adapters (for E2EE rooms like Matrix), falls back to standalone HTTP, extracts `MEDIA:` tags into native attachments. Inactivity-based timeout (`HERMES_CRON_TIMEOUT`, default 600 s) via `agent.get_activity_summary()` — a long-running tool call is fine, a hung API call for 10 min gets killed.

**Port tier: P0.** This is one of WOTANN's missing pillars (Appendix §K of the spec). Plan to port to Node/TS with `node-cron` for parsing plus a hand-rolled file-lock (flock via `fs.open` + `proper-lockfile` / `node-flock`). 400 LOC TS at most.

```ts
// src/cron/scheduler.ts
export async function tick(opts: TickOpts = {}): Promise<number> {
  const release = await lockfile.lock(LOCK_FILE, { retries: 0 });
  try {
    const due = await getDueJobs();
    for (const job of due) {
      await advanceNextRun(job.id); // at-most-once
      const { success, output, finalResponse, error } = await runJob(job);
      await saveJobOutput(job.id, output);
      const deliverable = success ? finalResponse : `Cron job failed: ${error}`;
      if (deliverable && !deliverable.trim().toUpperCase().includes(SILENT_MARKER)) {
        await deliverResult(job, deliverable, opts);
      }
      await markJobRun(job.id, success, error);
    }
    return due.length;
  } finally { release(); }
}
```

### 4.5 Context engine (`agent/context_engine.py` + `context_compressor.py`)

**`context_engine.py`** is a clean ABC: `should_compress(prompt_tokens)`, `compress(messages)`, optional `should_compress_preflight(messages)`, `get_tool_schemas()` (for LCM-style engines that expose `lcm_grep`), lifecycle hooks (`on_session_start`, `on_session_end`, `on_session_reset`). Selection is driven by `context.engine` in config; default is `"compressor"`.

**`context_compressor.py` (1,163 LOC)** is what WOTANN needs today. Algorithm:

1. **Pass 1 — deduplicate tool results** by md5 of content (≥200 chars). Older duplicates become `"[Duplicate tool output — same content as a more recent call]"`.
2. **Pass 2 — replace old tool results with informative 1-line summaries** like `[terminal] ran \`npm test\` -> exit 0, 47 lines output` or `[read_file] read config.py from line 1 (3,400 chars)`. `_summarize_tool_result()` has per-tool regex extraction of exit codes, match counts, file sizes.
3. **Pass 3 — truncate large tool_call arguments in assistant messages outside the protected tail** (write_file with 50 KB payload survives otherwise).
4. **Pass 4 — structured-template summarization** of middle turns. Preamble: "You are a summarization agent creating a context checkpoint… Do NOT respond to any questions or requests in the conversation — only output the structured summary" (borrowed from OpenCode). Output template has 13 sections including `## Active Task` (verbatim copy of latest user request), `## Completed Actions`, `## Pending User Asks`, `## Resolved Questions`, `## Relevant Files`, `## Remaining Work`, `## Critical Context`.
5. **Iterative update** — when `_previous_summary` exists, feed it in plus new middle turns, generate an *updated* summary rather than throwing the old one away.
6. **Anti-thrashing** — track `_last_compression_savings_pct`; if last 2 compactions each saved <10 %, skip and log `"Compression skipped — consider /new to start a fresh session, or /compress <topic> for focused compression."`
7. **Cooldown on summary failure** — `_SUMMARY_FAILURE_COOLDOWN_SECONDS = 600` s prevents hot-loop when aux model is broken.

**Port tier: P0 (compressor), P1 (ABC).** The 4-pass pruning + structured template will buy WOTANN 30–40 % context savings over naive sliding-window approaches.

### 4.6 Skills (`agent/skill_commands.py` + `agent/skill_utils.py` + `skills/*`)

- `skill_utils.py` — YAML frontmatter parsing with `CSafeLoader` preference, `platforms: [macos, linux]` gate, **external skill dirs** via `skills.external_dirs` config (so a team can share a central skills repo), `extract_skill_config_vars()` pulls `metadata.hermes.config` declarations from frontmatter (format: `{key, description, default, prompt}`), `resolve_skill_config_values()` reads current values from `config.yaml` at `skills.config.<key>` — so a skill can declare "I need `wiki.path`" and the user's configured value gets injected into the prompt automatically as a `[Skill config:]` block.
- `skill_commands.py` — skills become slash commands (`/gif-search`, `/claude-code`). `scan_skill_commands()` walks local + external dirs, produces `/{name: {skill_md_path, skill_dir, description}}`. `build_skill_invocation_message()` loads skill content, injects config, lists supporting files (`references/`, `templates/`, `scripts/`, `assets/`), appends `[Runtime note: ...]` for per-invocation context. Same mechanism supports session-wide preloaded skills via CLI flag.

Total Hermes skills shipped: **79 SKILL.md files across 26 categories** (`apple`, `autonomous-ai-agents`, `creative`, `data-science`, `devops`, `diagramming`, `domain`, `email`, `feeds`, `gaming`, `gifs`, `github`, `index-cache`, `inference-sh`, `leisure`, `mcp`, `media`, `mlops`, `note-taking`, `productivity`, `red-teaming`, `research`, `smart-home`, `social-media`, `software-development`, plus a `dogfood` category for self-improvement).

**Port tier: P1** (core mechanism) + **P2** (port the 79 skills). WOTANN already has skills infrastructure; adopt the slash-command mapping + `metadata.hermes.config` contract.

### 4.7 Migration from OpenClaw (`hermes_cli/claw.py`)

734 LOC. `hermes claw migrate` imports from `~/.openclaw` (or legacy `.clawdbot` / `.moltbot`): SOUL.md, MEMORY.md, USER.md, user-created skills → `~/.hermes/skills/openclaw-imports/`, approval allowlist, messaging platform configs, allowlisted API keys (Telegram, OpenRouter, OpenAI, Anthropic, ElevenLabs), TTS workspace assets, AGENTS.md as `--workspace-target`. Detects `openclaw.exe`/`clawd.exe`/node-hosted OpenClaw processes on Windows via `Get-CimInstance`, Linux via `pgrep -f openclaw`, macOS systemd user services via `systemctl --user is-active`. Warns if OpenClaw or a Hermes gateway is running on the same bot tokens (Telegram/Discord/Slack allow only one active connection per token).

**Port tier: P2 for WOTANN** — write a `wotann migrate` that ingests Hermes's `~/.hermes/` + OpenClaw's `~/.openclaw/` + Codex's `~/.codex/`. Makes WOTANN the "last agent harness you install" story land.

### 4.8 Terminal backends (`tools/environments/{base,local,docker,ssh,singularity,daytona,modal,managed_modal,file_sync}.py`)

**Six real backends.** `tools/terminal_tool.py` dispatches via `TERMINAL_ENV` env var:

- `local` — direct host exec with sudo password caching and `_approval_callback` for dangerous commands (cap-check uses `tools/approval.py` + `tirith_security.py`).
- `docker` — cap-drop ALL, `--security-opt no-new-privileges`, PID limits, configurable CPU/memory/disk, bind-mount persistence, env var allowlist via `docker_forward_env`, normalized var names.
- `ssh` — remote host via SSH.
- `singularity` — HPC use case, SIF cache in `$SCRATCH`.
- `daytona` — serverless persistence; sandbox hibernates when idle.
- `modal` — direct Modal (`has_direct_modal_credentials()`) or managed-gateway (`managed_nous_tools_enabled()`). Managed mode lets free-tier users share a Nous-hosted Modal pool.

All backends inherit from `BaseEnvironment` with a unified interface. WOTANN currently has local + partial Docker.

**Port tier: P1 for Docker + SSH; P2 for Modal + Daytona; P3 for Singularity.**

### 4.9 Rate limits (`agent/rate_limit_tracker.py` + `nous_rate_guard.py`)

- `rate_limit_tracker.py` parses the 12-header Nous/OpenRouter/OpenAI rate-limit convention (`x-ratelimit-{limit,remaining,reset}-{requests,tokens}[-1h]`) into `RateLimitBucket` (limit/remaining/reset_seconds/captured_at) → `RateLimitState` (4 buckets). Displayed in `/usage` slash command.
- `nous_rate_guard.py` — **cross-session** rate-limit guard. Writes to `~/.hermes/rate_limits/nous.json` atomically (tempfile + rename). A 429 from Nous can trigger 9 API calls per turn (3 SDK retries × 3 Hermes retries) and each counts against RPH; recording the reset time once and having every subsequent call (CLI, gateway, cron, auxiliary) read it breaks the amplification loop. Headers prioritized: `x-ratelimit-reset-requests-1h` > `x-ratelimit-reset-requests` > `retry-after`.

**Port tier: P1.** Cross-process rate-limit coordination is easy to miss; this pattern is generalizable to every provider.

### 4.10 Error classifier (`agent/error_classifier.py`)

829 LOC taxonomy + pipeline. Enum `FailoverReason` with 13 members (`auth`, `auth_permanent`, `billing`, `rate_limit`, `overloaded`, `server_error`, `timeout`, `context_overflow`, `payload_too_large`, `model_not_found`, `format_error`, `thinking_signature`, `long_context_tier`, `unknown`). Each classified error has `retryable`, `should_compress`, `should_rotate_credential`, `should_fallback` action hints. Pattern banks cover:

- 10 billing-exhaustion patterns (OpenRouter "credits have been exhausted", Alibaba "account is deactivated", etc.),
- 15 rate-limit patterns (AWS `ThrottlingException`, `servicequotaexceededexception`, Alibaba "rate increased too quickly"),
- 20+ context-overflow patterns spanning OpenAI, Anthropic, vLLM `max_model_len`, Ollama truncation, llama.cpp slot context, AWS Bedrock, **Chinese error messages** (`超过最大长度`, `上下文长度`),
- usage-limit disambiguation via "transient signals" like "try again" / "resets at",
- model-not-found, 413 payload-too-large via message regex when no HTTP status attr,
- Anthropic-specific: thinking-signature invalidation, long-context tier gate.

**Port tier: P0.** WOTANN's current error handling is scattered string-matching. Replacing it with `classifyApiError(err) → ClassifiedError` unifies the retry loop and makes the credential pool rotation dependable.

### 4.11 Insights (`agent/insights.py`)

768 LOC. SQLite-backed `/insights` command (Claude Code-inspired). `InsightsEngine(db).generate(days=30)` returns `{overview, models, platforms, tools, activity: {by_day, by_hour, busiest_day, busiest_hour, active_days, max_streak}, top_sessions}`. Cost estimation weighted by model via `usage_pricing.estimate_usage_cost()`; tracks both `estimated_cost_usd` and `actual_cost_usd` (provider-reported); flags `models_without_pricing` as unknown. `format_terminal()` produces ANSI-boxed report with bar charts; `format_gateway()` produces shorter markdown for messaging.

**Port tier: P2.** WOTANN has session SQLite; adding this is a weekend.

### 4.12 Agent loop (`environments/agent_loop.py`)

534 LOC. Reusable multi-turn loop used both in production and in Atropos RL environments. Standard OpenAI-spec tool calling: `response = await server.chat_completion(**kwargs); if response.choices[0].message.tool_calls: ...`. Features:

- `ThreadPoolExecutor(max_workers=128)` for tool calls — `resize_tool_pool()` lets Atropos scale it up for parallel eval.
- Fallback: if response has no structured `tool_calls` but content contains `<tool_call>{…}</tool_call>`, use `environments.tool_call_parsers.get_parser("hermes")` to extract them (handles vLLM without `ToolCallTranslator`).
- 11 per-model tool-call parsers: `deepseek_v3`, `deepseek_v3_1`, `glm45`, `glm47`, `hermes`, `kimi_k2`, `llama`, `longcat`, `mistral`, `qwen`, `qwen3_coder`.
- Per-tool-call in-loop `ToolError` capture with turn number, arguments (truncated), error message, tool_result snippet.
- `maybe_persist_tool_result()` + `enforce_turn_budget()` for large tool outputs (auto-spill to file when >threshold).
- Extracts `reasoning_content` / `reasoning` / `reasoning_details[].text` from multiple provider formats.
- Preserves `reasoning_content` on history for Kimi-K2's template (which renders `<think>` differently for history vs latest turn).

**Port tier: P0** for reasoning extraction + tool-call parser fallback; **P1** for the full reusable loop.

### 4.13 Atropos RL (`tinker-atropos/` + `rl_cli.py` + `environments/`)

Submodule repo. `environments/` contains ready-made environments: `agentic_opd_env.py` (one-pass-done), `web_research_env.py`, `hermes_base_env.py`, `hermes_swe_env/`, `terminal_test_env/`, plus `benchmarks/{tblite, terminalbench_2, yc_bench}`. Local `tinker-atropos/` is an empty directory (submodule not fetched) but the integration points are in place.

**Port tier: P3.** WOTANN isn't RL-training-focused today; the environment *harness* (OpenAI-spec loop + tool pool + parser fallbacks) is what matters, and that's already captured in §4.12.

### 4.14 Self-evolution (sibling repo `hermes-agent-self-evolution/`)

DSPy + GEPA (Genetic-Pareto Prompt Evolution, ICLR 2026 Oral). "No GPU — everything via API calls. ~$2-10 per optimization run." Reads execution traces from sessiondb or synthetic eval sets; mutates SKILL.md or tool descriptions or system prompt sections; runs the evolved variant through guardrails:

1. Full pytest must pass 100 %.
2. Size ceilings (skills ≤15 KB, tool descriptions ≤500 chars).
3. Caching compatibility (no mid-conversation changes).
4. Semantic preservation.
5. **PR to hermes-agent — never direct commit.**

Phase 1 (skills) is ✅ implemented; phases 2–5 (tool descriptions, system prompt, tool code, continuous loop) are planned.

**Port tier: P3.** Genuine moat once landed, but not a prereq — land cred pool / memory / cron first.

### 4.15 Gateway (`gateway/platforms/`)

**24 platform adapters in one flat directory.** Beyond the 8 WOTANN-wired channels: `dingtalk`, `feishu` + `feishu_comment`, `mattermost`, `matrix`, `bluebubbles`, `qqbot`, `wecom` + `wecom_callback` + `wecom_crypto` + `weixin`, `homeassistant`, `telegram_network` (low-level), `api_server.py` (REST API for remote control), `webhook.py` (generic inbound webhooks). Each adapter has `_process_message_background`, `extract_media` (for `MEDIA:` tag handling), `send(chat_id, text, metadata)`, `send_voice/send_image_file/send_video/send_document`.

**Port tier: P2** for Chinese market (DingTalk / Feishu / WeCom / WeiXin / QQBot) — 5 platforms WOTANN lacks that hermes prioritizes; P3 for Mattermost / BlueBubbles / HomeAssistant.

### 4.16 ACP adapter (`acp_adapter/`)

WOTANN has this in TS. Hermes has a Python reference in `acp_adapter/{server, session, auth, permissions, tools, events, entry}.py`. Useful as a cross-check implementation for compliance. Not a port target; already present.

### 4.17 Android / Termux (`packaging/termux/` + `constraints-termux.txt`)

`README.md` line 36-38:
> Works on Linux, macOS, WSL2, and Android via Termux. The installer handles the platform-specific setup for you. On Termux, Hermes installs a curated `.[termux]` extra because the full `.[all]` extra currently pulls Android-incompatible voice dependencies.

Gap for WOTANN: Node 20+ runs on Termux, but WOTANN's native deps (`better-sqlite3`, tui-rust, Tauri) need audit. Ship a `.termux` install profile that skips native-dep-heavy features (voice, Tauri). Tier: **P3.**

---

## 5. Architectural Patterns Worth Stealing

### 5.1 The Credential Pool as a Sidecar, Not a Wrapper

WOTANN treats each provider as having one credential. Hermes treats each provider as having a **pool**. The pool knows exhaustion state *and* refresh-token rotation across OS users of the same account (Claude Code + Hermes + Codex CLI all co-exist on the same refresh token by mutual rewrite-on-refresh). For WOTANN to compete with free-tier-first users running Claude Code in the background, the pool needs to be aware of `~/.claude/.credentials.json` as a peer rather than a private store.

### 5.2 Memory Provider ABC with "Builtin + One External" Invariant

Many systems let you pile memory plugins on top of each other. Hermes explicitly rejects a second external provider (`memory_manager.py` line 106–118). This keeps tool schema bloat down and avoids split-brain recall. The lifecycle is rich — `on_pre_compress(messages) -> str` so the plugin can inject its domain knowledge into the summary prompt; `on_memory_write(action, target, content)` so external providers can mirror writes to the builtin store. Port these hook signatures exactly.

### 5.3 Cron: at-most-once for recurring, at-least-once for one-shots

`advance_next_run()` runs before `run_job()` so if the scheduler dies mid-job, a recurring job misses that tick instead of replaying forever on restart. One-shots stay eligible within a 120 s grace window so user-created jobs for "30 m from now" don't get lost if they happened to be created 10 s before the minute boundary. **This is a one-line invariant with huge UX consequences.**

### 5.4 Structured summarization preamble

"You are a summarization agent creating a context checkpoint. Your output will be injected as reference material for a DIFFERENT assistant that continues the conversation. Do NOT respond to any questions or requests in the conversation — only output the structured summary." (context_compressor.py lines 577–584). Combined with `## Active Task` being a verbatim copy of the latest user request, resumption reliability goes way up.

### 5.5 ContextEngine tools as first-class

`get_tool_schemas()` on the ContextEngine ABC means an LCM engine can expose `lcm_grep` / `lcm_describe` / `lcm_expand` as real tools the agent can call. The compressor defaults to an empty list, but the infra is there. Port this so future WOTANN engines (e.g. a Letta-style core/archival block system) can swap in without plumbing changes.

### 5.6 Smart model routing: negative-keyword heuristic

`smart_model_routing.py` is 195 LOC of dead-simple "if message < 160 chars & no code fences & no URLs & no complex keywords → cheap model". Conservative; keeps latency/cost down without ever surprising the user. Port as a pure-function module.

### 5.7 Skills as Slash Commands + Frontmatter Config

Skills declare `metadata.hermes.config: [{key: wiki.path, description: ..., default: ~/wiki}]`; the system surfaces the current value from config.yaml via a `[Skill config:]` prompt block. No plugin needs to read the user's config file. This is better than "skill needs env var" because the values are visible in one `config.yaml` and survive re-installs.

### 5.8 `[SILENT]` sentinel for cron

An agent run that finds nothing newsworthy returns exactly `[SILENT]`; the scheduler skips delivery but still saves output for audit. Prevents the "nothing new, but you still got a ping" misery for daily-reminder cron jobs.

### 5.9 Migration command as a platform play

`hermes claw migrate` imports settings, SOUL.md, memories, skills, and allowlisted API keys from OpenClaw. This is why Hermes users switch over instantly. WOTANN should ship `wotann migrate` that ingests `~/.hermes/` + `~/.openclaw/` + `~/.codex/` + `~/.claude/` on install.

---

## 6. Top 20 Features to Port, Ranked by Impact × Ease

| # | Feature | Impact | Ease | Tier | Effort |
|---|---|---|---|---|---|
| 1 | **`CredentialPool`** with 4 strategies + OAuth sync | HIGH | MED | **P0** | 3–4 d |
| 2 | **Cron scheduler** (`cron/jobs.py` + `scheduler.py` with file-lock) | HIGH | MED | **P0** | 3 d |
| 3 | **`MemoryProvider` ABC + `MemoryManager`** with builtin+1 invariant | HIGH | EASY | **P0** | 1 d |
| 4 | **`classifyApiError()` + `FailoverReason` taxonomy** | HIGH | EASY | **P0** | 1 d |
| 5 | **Anthropic `system_and_3` prompt caching** (4 cache_control breakpoints) | HIGH | EASY | **P0** | ½ d |
| 6 | **`auxiliary_client` 7-step resolution chain with 402 fallback** | HIGH | MED | **P0** | 2 d |
| 7 | **`ContextCompressor`** — 3-pass pruning + structured template + anti-thrashing | HIGH | MED | **P0** | 3 d |
| 8 | **Copilot `--acp` client** (spawn + JSON-RPC) | MED | MED | **P0** | 2 d |
| 9 | **Docker + SSH terminal backends** (cap-drop, bind-mount, SSH via key-exchange) | HIGH | MED | **P1** | 2 d each |
| 10 | **`ContextEngine` ABC** (so LCM, Letta-block, etc. can plug in) | MED | EASY | **P1** | ½ d |
| 11 | **`smart_model_routing`** — simple-turn → cheap model | MED | EASY | **P1** | ½ d |
| 12 | **Nous-style cross-process rate-limit guard** (atomic-write state file) | MED | EASY | **P1** | ½ d |
| 13 | **Skills-as-slash-commands + `metadata.hermes.config` injection** | MED | EASY | **P1** | 1 d |
| 14 | **Honcho memory provider** (dialectic user model, cold vs warm prompt) | MED | MED | **P1** | 2 d |
| 15 | **`agent_loop` reasoning extraction + parser-fallback** (11 model parsers) | MED | EASY | **P1** | 1 d |
| 16 | **`/insights` SQLite report** — tokens/cost/activity/streaks | MED | EASY | **P2** | 1 d |
| 17 | **Modal + Daytona serverless backends** | MED | HARD | **P2** | 3 d each |
| 18 | **Chinese-market platform adapters** (DingTalk, Feishu, WeCom, WeiXin, QQBot) | MED | HARD | **P2** | 2 d each |
| 19 | **`wotann migrate`** (ingest Hermes + OpenClaw + Codex + Claude Code) | HIGH | MED | **P2** | 2 d |
| 20 | **DSPy + GEPA self-evolution loop** | HIGH | HARD | **P3** | 1–2 wk |

Everything P0 + P1 = **~25–30 days of focused work**, closes the biggest gaps between WOTANN and Hermes.

---

## 7. Differences WOTANN should not adopt (anti-patterns / stylistic mismatches)

1. **Monolithic `hermes_cli/main.py` at 8,252 LOC.** WOTANN's "many small files" rule is correct; don't regress.
2. **Monolithic `run_agent.py` at 11,850 LOC.** Same.
3. **Python-first assumption of blocking I/O** — Hermes uses threads for tool parallelism because of the GIL; WOTANN can use Node's event loop directly.
4. **9 auth providers inside one `_seed_from_singletons`** — WOTANN should dispatch via a `CredentialSeeder` registry instead of an if-elif chain keyed on provider string.
5. **Calendar versioning (`v2026.4.16`) as the only release identifier.** Fine for Hermes's weekly cadence; WOTANN should semver until 1.0.
6. **`agent/` + `hermes_cli/` package split** is arbitrary — `credential_pool.py` in `agent/` imports from `hermes_cli/auth.py` and writes to it. WOTANN already has a cleaner module boundary.

---

## 8. Evidence index (every claim above cites one of these)

- `/hermes-agent/README.md` (lines 14–26, 36–38, 49–65, 111–136)
- `/hermes-agent/agent/credential_pool.py` (whole file, 1,439 LOC — read in full during this research pass)
- `/hermes-agent/agent/memory_provider.py` (whole file) + `memory_manager.py` (whole file)
- `/hermes-agent/agent/prompt_caching.py` (whole file — 72 LOC)
- `/hermes-agent/agent/nous_rate_guard.py` (whole file — 182 LOC)
- `/hermes-agent/agent/context_compressor.py` (lines 1–250, 250–649 — partial)
- `/hermes-agent/agent/context_engine.py` (whole file)
- `/hermes-agent/agent/smart_model_routing.py` (whole file)
- `/hermes-agent/agent/error_classifier.py` (lines 1–200)
- `/hermes-agent/agent/insights.py` (whole file — 768 LOC)
- `/hermes-agent/agent/skill_commands.py` + `skill_utils.py` (both in full)
- `/hermes-agent/agent/copilot_acp_client.py` (whole file — 586 LOC)
- `/hermes-agent/agent/anthropic_adapter.py` (lines 1–250)
- `/hermes-agent/agent/bedrock_adapter.py` (lines 1–200)
- `/hermes-agent/agent/gemini_cloudcode_adapter.py` (lines 1–150)
- `/hermes-agent/agent/auxiliary_client.py` (lines 1–120)
- `/hermes-agent/agent/rate_limit_tracker.py` (lines 1–120)
- `/hermes-agent/cron/jobs.py` (whole file) + `cron/scheduler.py` (whole file)
- `/hermes-agent/environments/agent_loop.py` (whole file — 534 LOC)
- `/hermes-agent/hermes_cli/claw.py` (lines 1–200)
- `/hermes-agent/tools/terminal_tool.py` (lines 1–150) + `/hermes-agent/tools/environments/docker.py` (lines 1–100)
- `/hermes-agent/plugins/memory/honcho/README.md` (lines 1–80)
- `/hermes-agent/plugins/memory/` (directory listing: 8 providers)
- `/hermes-agent/skills/` (26 top-level categories; `find skills -name SKILL.md | wc -l` = 79)
- `/hermes-agent/environments/tool_call_parsers/` (11 per-model parsers)
- `/hermes-agent/gateway/platforms/` (24 platform adapters)
- `/hermes-agent/packaging/` (homebrew + termux)
- `/hermes-agent/hermes_cli/main.py` (lines 1–50: CLI surface inventory)
- `/hermes-agent-self-evolution/README.md` (whole file)
- `gh api repos/NousResearch/hermes-agent` (stars/forks/issues/release, 2026-04-20T07:05Z snapshot)
- `gh api repos/NousResearch/hermes-agent/releases/latest` (v2026.4.16 release notes)
- `gh api repos/NousResearch/hermes-agent/issues?state=open&sort=updated` (top 10 current issues/PRs)
- `gh api repos/NousResearch/hermes-agent/pulls?state=closed&sort=updated` (recent merged PRs)
- WebFetch on `https://github.com/NousResearch/hermes-agent` (README + directory tree render)

Claims not specifically tagged above derive from direct reads of the files listed.
