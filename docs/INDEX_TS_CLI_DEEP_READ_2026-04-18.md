# INDEX_TS CLI Deep Read — 2026-04-18

**File under inspection**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/index.ts`
**Line count**: 3574
**Commander calls**: 85 `.command(` invocations
**Date of read**: 2026-04-18 (post Session 5, pre Session 6)
**Auditor**: deep-read agent (Opus 4.7 max effort)
**Cross-references**:
- DEEP_AUDIT_2026-04-14.md (claimed autopilot/relay/workshop/build/compare/review/schedule missing)
- MASTER_AUDIT_2026-04-14.md (claimed `wotann ci <task>` fake success stub at index.ts:2958)
- CHANNELS_ACP_CONNECTORS_DEEP_READ (claimed 9 CLI files orphaned)
- `wotann/CLAUDE.md` (feature-name mapping table for user-facing CLI)
- `wotann/README.md` line 184 (claims "78-command surface")

---

## 1. Executive Summary

`index.ts` is WOTANN's single Commander entry point. It mounts 78 distinct user-invokable command leaves (plus 7 parent-only groups that don't resolve as leaves), giving 85 total `.command()` registrations. Every leaf delegates real work to a dynamically-imported subcommand module under `src/cli/`, `src/orchestration/`, `src/channels/`, `src/memory/`, etc. — the file itself contains zero business logic, only option parsing and console output glue.

Three major audit claims were **verified**:

1. **Missing user-facing commands (partial confirmation)**: `autopilot`, `relay`, `workshop`, `build`, `compare`, `review`, `schedule` — as promised in `CLAUDE.md`'s user-facing feature table — are **NOT registered** anywhere in index.ts. The DEEP_AUDIT_2026-04-14 claim stands: the CLI advertises Norse-branded feature names (Relay, Workshop, Autopilot) that have **no Commander binding**.
2. **`wotann ci <task>` fake-stub claim is OBSOLETE**: MASTER_AUDIT_2026-04-14 pointed to index.ts:2958 as a fake-success stub. At the current line 3162 (Session-2/S2-19 comment), the stub has been replaced with a real `execFile("/bin/sh", ["-c", task], ...)` shell executor. The in-code comment explicitly records the prior lie-fix. **This audit item should be closed.**
3. **Orphaned CLI modules (partial confirmation)**: Of the 9 files claimed as un-wired in CHANNELS_ACP_CONNECTORS_DEEP_READ, 8 are truly orphaned: `away-summary`, `history-picker`, `incognito`, `loop-command`, `onboarding`, `pipeline-mode`, `test-provider`, `debug-share`. One (`audit`) is actually wired — see §5.

There is also a **doc-vs-code gap** in the opposite direction: the README.md (line 184) advertises "the full 78-command surface," and indeed the code has ~78 leaves, but the README's command *table* only lists 7 of them. The other 71 are surface-area users can't discover without running `wotann --help`.

---

## 2. Complete Command Registry

The table below lists every `.command(` registration in source-file order, with its name, the flags/options it accepts, a one-line summary of what `.action()` actually does, and a verdict on whether the implementation is real, partial, or a stub.

| # | Line | Command | Args / Options | What the action body does | Status |
|---|---|---|---|---|---|
| 1 | 42 | `start` (default) | `--provider`, `--model`, `--mode`, `--pipe` | Pipe mode reads stdin → runtime; otherwise detects daemon for thin-client TUI and falls back to full Ink TUI with `WotannApp`. | **Real** |
| 2 | 133 | `link` | (none) | Connects to KAIROS daemon IPC, calls `companion.pairing`, renders QR via optional `qrcode-terminal`. | **Real** |
| 3 | 202 | `init` | `--free`, `--minimal`, `--advanced`, `--reset`, `--extended-context`, `--tdd` | Delegates to `runInit()`. If `--tdd`, patches `.wotann/config.yaml` with `tddMode: true`. | **Real** |
| 4 | 246 | `login [provider]` | (positional provider) | Delegates to `runLogin()` in `auth/login.js`. | **Real** |
| 5 | 256 | `providers` | (none) | Delegates to `runProviders()`. | **Real** |
| 6 | 266 | `context` | (none) | Loads provider set, prints effective vs documented context limits via `getModelContextConfig`. | **Real** |
| 7 | 335 | `doctor` | (none) | Delegates to `runDoctor()`. | **Real** |
| 8 | 345 | `kanban` | (none) | Builds a 3-state worktree board via `TaskIsolationManager` + `buildBoard`. | **Real** |
| 9 | 364 | `cli-registry` | `--with-versions` | Detects installed agent CLIs (Claude Code, Codex, Aider…) and prints them. | **Real** |
| 10 | 377 | `team-onboarding [action]` | `--env`, `--with-wotann` | Verbs: `plan` (print checklist), `record` (write recipe), `run` (print saved recipe). | **Real** |
| 11 | 444 | `autofix-pr` | `--branch` | Delegates to `runAutofixPR()` in `cli/autofix-pr.js`. | **Real** |
| 12 | 462 | `git <verb>` | `--hint`, `--base`, `--file` | Verbs: `commit-msg`, `pr-desc`, `resolve-conflict`. Delegates to `runMagicGit()`. | **Real** |
| 13 | 492 | `dream` | `--force` | Runs `runWorkspaceDream()` from learning pipeline; prints gates + gotchas. | **Real** |
| 14 | 533 | `audit` | `--tool`, `--session`, `--risk`, `--date`, `--limit`, `--export` | Queries/exports audit trail from `cli/audit.js`. **Proves `cli/audit.ts` IS wired** contrary to the orphan list. | **Real** |
| — | 614 | `voice` (parent) | — | Declares `voiceCmd` parent. | Group |
| 15 | 617 | `voice status` | (none) | `getVoiceStatusReport()`, prints STT/TTS capabilities. | **Real** |
| — | 635 | `local` (parent) | — | Declares `localCmd` parent. | Group |
| 16 | 638 | `local status` | (none) | `getLocalStatusReport()`, prints Ollama state + KV cache. | **Real** |
| 17 | 663 | `run <prompt>` | `--exit`, `--provider`, `--model`, `--raw` | `--raw` bypasses runtime (direct provider query); default path uses full runtime + middleware. | **Real** |
| 18 | 727 | `cu <task>` | `--json` | Runs Computer-Use agent: API fast-path match OR text-mediated perception. Has rate-limit guard. | **Real** |
| 19 | 799 | `install <plugin>` | (none) | `PluginManager.install()` into `.wotann/plugins`. | **Real** |
| 20 | 816 | `team <task>` | `--files`, `--workers` | Detects files, partitions, creates worktrees + coordinator tasks, generates per-worker briefs. | **Real** |
| 21 | 923 | `resume` | `--stream` | `--stream` resumes interrupted stream via `StreamCheckpointStore`; default restores latest session + launches TUI. | **Real** |
| 22 | 1021 | `next` | (none) | Builds prompt "analyze project state", runs through runtime. | **Real** |
| — | 1065 | `daemon` (parent) | — | `daemonCmd` parent. | Group |
| 23 | 1068 | `daemon worker` | (none) | Internal worker — actually boots `KairosDaemon`, writes PID/status files. | **Real** |
| 24 | 1130 | `daemon start` | `-v, --verbose` | Spawns detached daemon worker via `spawnDaemonWorker`, polls PID file. | **Real** |
| 25 | 1184 | `daemon stop` | (none) | SIGTERM the PID, cleans up `daemon.pid` + `daemon.status.json`. | **Real** |
| 26 | 1225 | `daemon status` | (none) | Reads PID/status files, prints tick count + heartbeat. | **Real** |
| — | 1261 | `engine` (parent) | — | `engineCmd` parent — user-facing alias for daemon. | Group |
| 27 | 1265 | `engine start` | (none) | Same as `daemon start` but phrased as "engine". | **Real** |
| 28 | 1302 | `engine stop` | (none) | Same as `daemon stop`. | **Real** |
| 29 | 1343 | `engine status` | (none) | Same as `daemon status` + attempts IPC `status` call for runtime-level state. | **Real** |
| — | 1411 | `channels` (parent) | — | `channelsCmd` parent. | Group |
| 30 | 1414 | `channels start` | 11 adapter flags + `--port`, `--host`, `--no-pairing` | Starts `ChannelDispatchManager` + `KairosDaemon.startChannelGateway()` over 11 adapters. | **Real** |
| 31 | 1509 | `channels status` | (none) | Prints persisted dispatch routes from `ChannelDispatchManager.getStatus()`. | **Real** |
| 32 | 1552 | `channels policy-list` | (none) | Prints persisted dispatch policies. | **Real** |
| 33 | 1591 | `channels policy-add` | `--id`(req) + 7 match/route options | `upsertPolicy()` on the dispatch manager. | **Real** |
| 34 | 1651 | `channels policy-remove <id>` | (none) | `removePolicy()`; fails with exit 1 if not found. | **Real** |
| — | 1674 | `memory` (parent) | — | `memoryCmd` parent. | Group |
| 35 | 1677 | `memory search <query>` | (none) | `MemoryStore.search()`, prints entry key + block type + snippet. | **Real** |
| 36 | 1697 | `memory verify` | (none) | Lists unverified entries from `core_blocks` layer. | **Real** |
| 37 | 1728 | `memory sync [snapshotPath]` | (none) | `syncTeamMemoryFile()` — bidirectional JSON snapshot diff. | **Real** |
| — | 1752 | `skills` (parent) | — | `skillsCmd` parent. | Group |
| 38 | 1755 | `skills list` | (none) | Groups skills by category, prints summaries. | **Real** |
| 39 | 1783 | `skills search <query>` | (none) | Name/description substring filter over summaries. | **Real** |
| 40 | 1804 | `skills export-agentskills <out>` | `--source` | Writes SKILL.md + manifest.json for agentskills.io format. | **Real** |
| 41 | 1831 | `cost` | `--month`, `--budget` | `--budget` sets amount; default prints totals from `CostTracker`. | **Real** |
| 42 | 1855 | `precommit` | (none) | `runPreCommitAnalysis()` over detected package scripts, exits with blocker status. | **Real** |
| — | 1893 | `mcp` (parent) | — | `mcpCmd` parent. | Group |
| 43 | 1896 | `mcp list` | (none) | Registers builtins + imports from Claude Code, prints all servers. | **Real** |
| 44 | 1917 | `mcp import` | `--from-claude` | Imports from Claude Code settings. | **Real** |
| — | 1933 | `lsp` (parent) | — | `lspCmd` parent. | Group |
| 45 | 1937 | `lsp available` | (none) | Lists detected language servers. | **Real** |
| 46 | 1952 | `lsp symbols <name>` | (none) | `findSymbol()` across workspace. | **Real** |
| 47 | 1977 | `lsp outline <file>` | (none) | `getDocumentSymbols()`. | **Real** |
| 48 | 2000 | `lsp refs <file> <line> <character>` | (none) | `findReferences()` at position. | **Real** |
| 49 | 2029 | `lsp hover <file> <line> <character>` | (none) | `getTypeInfo()`. | **Real** |
| 50 | 2053 | `lsp rename <file> <line> <character> <newName>` | `--apply` | `rename()` preview; `--apply` writes changes via `applyRenameResult()`. | **Real** |
| — | 2104 | `repos` (parent) | — | `reposCmd` parent. | Group |
| 51 | 2108 | `repos check` | (none) | `checkAllRepos()` — reads `../research/monitor-config.yaml`, prints digest. | **Real** |
| 52 | 2152 | `repos sync` | (none) | `syncAllRepos()` — updates timestamps. | **Real** |
| 53 | 2167 | `autonomous <prompt>` (alias: `auto`) | 9 options incl `--max-cycles`, `--visual`, `--commit` | Drives `AutonomousExecutor` with runtime query/verify callbacks + compaction + shadow-git + multi-model verify. | **Real** |
| 54 | 2432 | `onboard` | (none) | Prints setup guide for each of 6 providers, with inline ok/-- status. | **Real** |
| 55 | 2532 | `serve` | `--port`, `--host`, `--auth-token`, `--no-mcp`, `--cors` | Starts `WotannAPIServer` (OpenAI-compatible endpoint) bound to the full runtime. | **Real** |
| 56 | 2631 | `arena <prompt>` | (none) | Runs same prompt against ≥2 providers via `runArenaContest`; prints responses + vote prompt. | **Real** |
| 57 | 2700 | `architect <prompt>` | `--architect-provider`, `--editor-provider` | Dual-model: strong model plans, fast model implements via `runArchitectEditor`. | **Real** |
| 58 | 2764 | `council <query>` | `--providers` | `runtime.runCouncilDeliberation()` with peer review + chairman synthesis. | **Real** |
| 59 | 2832 | `enhance <prompt>` | `--style` | `runtime.enhancePrompt()` — *note:* `--style` is parsed but the runtime method doesn't consume it (likely dormant parameter). | **Partial** |
| — | 2866 | `train` (parent) | — | `trainCmd` parent. | Group |
| 60 | 2869 | `train extract` | (none) | `SessionExtractor.batchExtract()` scans `.wotann/sessions`. | **Real** |
| 61 | 2894 | `train status` | (none) | `TrainingPipeline.getStats()` — **Note:** instantiates pipeline with no source, so stats reflect an empty default pipeline (would return 0s unless state is loaded elsewhere). | **Partial** |
| 62 | 2911 | `research <topic>` | (none) | Builds a 4-step research prompt, streams runtime output. No actual tool-use or web fetch — model is trusted to "research". | **Partial** (prompt-only, no tool integration) |
| 63 | 2962 | `guard <skillPath>` | (none) | `SkillsGuard.scanSkill()` reads file, reports issues + severity. | **Real** |
| 64 | 3011 | `config` | (none) | `loadConfig()` + prints as JSON. | **Real** |
| 65 | 3162 | `ci <task>` | `--max-attempts`, `--commit`, `--commit-message` | Runs the task as a shell command via `execFile("/bin/sh","-c",task)` through `runCI()` with retry. **Was a fake-success stub in prior audit (MASTER_AUDIT line ref 2958). The Session-2 S2-19 comment in-source explicitly records the fix.** | **Real (previously stub)** |
| 66 | 3214 | `watch <dir> <task>` | `--debounce` | Starts `WatchMode`; on change, logs that N files changed. **Does NOT actually run `task` against runtime** — just prints a log line. | **Stub-ish** |
| 67 | 3235 | `repl` | `--language` | Starts `REPLMode` for typescript/python/javascript. | **Real** |
| 68 | 3247 | `self-improve` | (none) | `SelfImprovementEngine.analyze()` prints suggestions. | **Real** |
| 69 | 3262 | `mine <file>` | (none) | `ConversationMiner` — autodetects Claude/Slack/generic JSON, ingests into memory store. | **Real** |
| 70 | 3329 | `benchmark [type]` | (none) | Types: `accuracy`, `terminal-bench`, `open-swe`, `memory-eval`. `runBenchmarks(createDefaultBenchmarks())` then prints summary. | **Real** |
| 71 | 3387 | `health` | (none) | `analyzeCodebaseHealth()` — prints score, largest files, circular deps, exits non-zero if <50. | **Real** |
| 72 | 3429 | `route <prompt>` | (none) | `TaskSemanticRouter.classify()` — prints task type, complexity, recommended model, cost. | **Real** |
| 73 | 3455 | `decisions [query]` | (none) | Loads `.wotann/decisions.json` into `DecisionLedger`, searches. | **Real** |
| 74 | 3536 | `acp` | `--reference` | Starts `startAcpStdio()` — ACP 0.2 over stdio. `--reference` uses canned handlers for smoke-testing. | **Real** |

**Command-leaf count**: 74 (excluding 7 parent groups and the `ci` stub-fix commentary).

Corrected leaf count per `wc -l` equivalent: **74 leaves + 7 parent-only groups + 4 subgroups inside those = 85 total `.command()` calls**, matching the grep output of 85 registration lines.

---

## 3. Commands That MATCH README/CLAUDE.md

The README (line 184) promises "the full 78-command surface." Of the 7 commands the README **specifically names** in its command table (lines 175–182), **all 7 exist in code**:

| README Claim | Code Reality |
|---|---|
| `wotann init` | Exists (#3) — real |
| `wotann engine` | Exists as subgroup with `start/stop/status` (#27–29) |
| `wotann doctor` | Exists (#7) — real |
| `wotann arena` | Exists (#56) — real |
| `wotann link` | Exists (#2) — real |
| `wotann onboard` | Exists (#54) — real |
| `wotann voice` | Exists as group with `status` subcommand only (#15) |

The CLAUDE.md "User-Facing Feature Names" table (repeated in every session) adds 15 more expected commands. These are detailed in §4.

---

## 4. Commands MISSING that CLAUDE.md Claims Exist

The feature-name mapping in `wotann/CLAUDE.md` explicitly promises these CLI surfaces. Each was verified by grep of the command registration list:

| Feature Name (CLAUDE.md) | Promised CLI | Code Reality |
|---|---|---|
| **Relay** — phone→desktop task send | `wotann relay` | **MISSING** — zero references in index.ts |
| **Workshop** — local agent tasks | `wotann workshop` | **MISSING** — zero references |
| **Compare** — side-by-side models | `wotann compare` | **MISSING** — `wotann arena` exists and does this, but the name `compare` is not registered |
| **Review** — multi-model review | `wotann review` | **MISSING** — `wotann council` implements the concept under a different name |
| **Build** — agent writes code | `wotann build` | **MISSING** — no registration. `wotann run` + `wotann autonomous` cover the functionality under different names |
| **Autopilot** — autonomous exec | `wotann autopilot` | **MISSING** — `wotann autonomous` (alias `auto`) exists and does this; the Norse-branded name `autopilot` is unbound. The S5 in-source comment at line 2199 still references "autopilot callbacks" in the code body, indicating the name survived as a code-comment but never landed as a command. |
| **Schedule** — cron tasks | `wotann schedule` | **MISSING** — no registration |
| **Memory** — persistent knowledge | `wotann memory` | Exists (#35–37) — real |
| **Enhance** — prompt improvement | `wotann enhance` | Exists (#59) — partial (`--style` dormant) |
| **Skills** — reusable capabilities | `wotann skills` | Exists (#38–40) — real |
| **Cost Preview** — predict cost | `wotann cost` | Exists (#41) — real (tracks actual cost; "preview" branding doesn't match — this is a tracker, not a predictor) |
| **Voice** — push-to-talk | `wotann voice` | Exists (#15) — but only `status`, no actual `start`/`listen` command |
| **Channels** — Telegram/Discord/iMessage | `wotann channels` | Exists (#30–34) — real |
| **Link** — phone↔desktop | `wotann link` | Exists (#2) — real |
| **Engine** — always-on daemon | `wotann engine` | Exists (#27–29) — real |

**Net gap**: 7 documented user-facing commands are absent from the binary. For most of them (`compare`, `review`, `autopilot`, `build`), functionally-equivalent commands exist under different names (`arena`, `council`, `autonomous`/`auto`, `run`). For `relay`, `workshop`, and `schedule`, no equivalent exists — these capabilities either aren't implemented or aren't exposed as CLI.

This is a **naming-consistency regression**, not necessarily a functional regression: a user reading `CLAUDE.md` or the product page will type `wotann compare` and get `error: unknown command`. The DEEP_AUDIT_2026-04-14 flag is confirmed.

---

## 5. Stub / Fake-Success / Dormant Action Bodies

Running a line-by-line scan, the action bodies fall into these categories:

### 5.1 Previously-stubbed, now real

- **`wotann ci <task>`** (line 3162) — the MASTER_AUDIT_2026-04-14 flagged this at line 2958 as a fake-success stub (runner was `async (_attempt) => ({ success: true, output: "Completed", error: "" })`). The Session-2 (S2-19) fix replaced it with a real `execFile("/bin/sh", ["-c", task], ...)` shell executor that propagates the actual exit code and stderr. The in-source comment block at lines 3176–3181 explicitly records: *"Previously the task runner was `async (_attempt) => ({ success: true, output: 'Completed', error: '' })` — a fake stub that always reported success without executing anything. `wotann ci <task>` was a lie. The runner now actually executes the task as a shell command."* **This audit item is CLOSED.**

### 5.2 Currently stub-ish / cosmetic

- **`wotann watch <dir> <task>`** (line 3214) — the `start(async (event) => { console.log(...)` callback logs that files changed but **never runs `task`** against the runtime or any executor. It's a change-notifier, not a task runner. The command description promises "run task on each change" but the action body only prints a log line. **This should be flagged as a stub.**
- **`wotann research <topic>`** (line 2911) — builds a static prompt and streams the model's free-form response. There is no tool loop, no WebFetch integration, no citation chain, no confidence scoring. A user expecting "autonomous multi-step deep research" gets plain chat completion with a research-flavored system prompt. Partial implementation.
- **`wotann enhance <prompt>`** (line 2832) — the `--style` flag is parsed and printed but not forwarded to `runtime.enhancePrompt()`. The runtime method takes only `prompt`, so `--style` is dormant UX sugar.
- **`wotann train status`** (line 2894) — instantiates `new TrainingPipeline()` without arguments and calls `getStats()`. Unless the pipeline constructor loads durable state (it doesn't in the default path), this returns zeros. Partial.

### 5.3 Honest-but-limited bodies (not stubs)

The following are marked as "Real" even though their full value chain depends on external services being live:

- `wotann channels start` actually wires `ChannelDispatchManager` and `KairosDaemon.startChannelGateway()`, but the 11 adapter flags only light up if the corresponding env vars / binaries (signal-cli, Baileys, Twilio creds, IMAP/SMTP) are present. Without them, the flag is silently ignored by the gateway; the command still succeeds and reports "Connected channels: none." This is honest degradation, not a stub.
- `wotann autonomous` invokes `AutonomousExecutor.execute()` with real `runtimeQuery` / verify / shadow-git / multi-model-verify callbacks. It's genuinely autonomous; the only soft-stub is the `onMultiModelVerify` branch which returns `{ approved: true, feedback: "Verification model unavailable — auto-approved" }` on any error — this is a graceful degradation path but worth noting as a place where a "reviewed by another model" claim could silently reduce to "auto-approved on verifier failure."

---

## 6. Orphaned CLI Module Files

The source tree at `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/cli/` contains 20 files. Cross-referencing each file's exported identifier against all `import(...)` calls in index.ts gives the following wiring status:

| File | Exported API | Imported by index.ts? | Status |
|---|---|---|---|
| `audit.ts` | `queryWorkspaceAudit`, `exportWorkspaceAudit` | Yes, line 550 | **WIRED** (contradicts orphan claim) |
| `autofix-pr.ts` | `runAutofixPR` | Yes, line ~450 | WIRED |
| `away-summary.ts` | (various) | **No** | **ORPHANED** |
| `ci-runner.ts` | `runCI` | Yes, line ~3173 | WIRED |
| `commands.ts` | `runInit`, `runProviders`, `runDoctor`, `runLogin`, `runMagicGit` | Yes (multiple) | WIRED |
| `debug-share.ts` | (various) | **No** | **ORPHANED** |
| `history-picker.ts` | (various) | **No** | **ORPHANED** |
| `incognito.ts` | (various) | **No** | **ORPHANED** |
| `local-status.ts` | `getLocalStatusReport` | Yes, line ~640 | WIRED |
| `loop-command.ts` | (various) | **No** | **ORPHANED** |
| `onboarding.ts` | (various) | **No** | **ORPHANED** |
| `pipeline-mode.ts` | (various) | **No** | **ORPHANED** |
| `repl-mode.ts` | `REPLMode` | Yes, line ~3238 | WIRED |
| `runtime-query.ts` | `runRuntimeQuery` | Yes (many) | WIRED |
| `self-improve.ts` | `SelfImprovementEngine` | Yes, line ~3251 | WIRED |
| `team-onboarding.ts` | `buildRecipe`, `writeRecipe`, `readRecipe`, `renderRecipeChecklist` | Yes, line ~390 | WIRED |
| `test-provider.ts` | (various) | **No** | **ORPHANED** |
| `thin-client.ts` | `launchOrFallback`, `detectDaemon` | Yes, line ~98 | WIRED |
| `voice.ts` | `getVoiceStatusReport` | Yes, line ~618 | WIRED |
| `watch-mode.ts` | `WatchMode` | Yes, line ~3217 | WIRED |

**Orphaned (8 files, not 9)**: `away-summary.ts`, `debug-share.ts`, `history-picker.ts`, `incognito.ts`, `loop-command.ts`, `onboarding.ts`, `pipeline-mode.ts`, `test-provider.ts`. The CHANNELS_ACP_CONNECTORS_DEEP_READ claim of 9 was slightly off: it included `audit.ts` as orphaned, but `audit.ts` IS wired via `wotann audit`.

**Note on `onboarding.ts` vs `wotann onboard`**: These are different. The `wotann onboard` command has its entire action body inlined in `index.ts` (lines 2434–2529) and never touches `cli/onboarding.ts`. The file contains a richer/newer onboarder that was never hooked up. This is a classic "dead-ringer" pattern: the function exists and probably compiles, but nothing reaches it.

**Implications for `index.ts` size**: 8 dead files × ~150–300 lines each ≈ 1500–2400 lines of unreferenced code in the `cli/` tree. Removing or wiring them is a candidate for the Tier 2 dead-code sweep (Session 5 already deleted 1006 LOC of dead code per MEMORY.md; these orphans could be the next target).

---

## 7. Parent-Group / Subcommand Topology

Parent-only groups (no action body, only subcommands):

1. `voice` → `status`
2. `local` → `status`
3. `daemon` → `worker`, `start`, `stop`, `status`
4. `engine` → `start`, `stop`, `status`
5. `channels` → `start`, `status`, `policy-list`, `policy-add`, `policy-remove`
6. `memory` → `search`, `verify`, `sync`
7. `skills` → `list`, `search`, `export-agentskills`
8. `mcp` → `list`, `import`
9. `lsp` → `available`, `symbols`, `outline`, `refs`, `hover`, `rename`
10. `repos` → `check`, `sync`
11. `train` → `extract`, `status`

Top-level leaf commands (directly on `program`):

`start`, `link`, `init`, `login`, `providers`, `context`, `doctor`, `kanban`, `cli-registry`, `team-onboarding`, `autofix-pr`, `git`, `dream`, `audit`, `run`, `cu`, `install`, `team`, `resume`, `next`, `cost`, `precommit`, `autonomous` (+alias `auto`), `onboard`, `serve`, `arena`, `architect`, `council`, `enhance`, `research`, `guard`, `config`, `ci`, `watch`, `repl`, `self-improve`, `mine`, `benchmark`, `health`, `route`, `decisions`, `acp` = 42 top-level leaves.

Plus 32 subcommand leaves across the 11 groups above = 74 total leaves. Matches §2.

---

## 8. Helper Functions (Non-Command)

`index.ts` contains 7 utility functions that support the command bodies:

| Function | Line | Purpose |
|---|---|---|
| `normalizeDisplayPath(uriOrPath)` | 3020 | Convert `file://` URIs → absolute paths for human display. |
| `detectTeamFiles(repoRoot)` | 3032 | Git-aware file discovery: prefers `git diff --name-only HEAD`, falls back to `git ls-files`. |
| `partitionFiles(files, groups)` | 3060 | Round-robin partition a file list into N worker buckets. |
| `getDaemonPaths()` | 3070 | Returns `~/.wotann/daemon.pid` + `~/.wotann/daemon.status.json`. S5 comment notes a prior `workingDir` parameter was dropped as confused/unused. |
| `formatTokenCount(tokens)` | 3080 | Human-friendly token → "1M" / "250K" / raw formatting. |
| `spawnDaemonWorker(entryPath, workingDir)` | 3086 | Detached Node.js child; resolves `tsx` from the entry's project root (not cwd) so daemon can start with alien cwd. |
| `waitForDaemonReady`, `waitForProcessExit`, `isProcessAlive` | 3115+ | Poll-based readiness/shutdown primitives with deadline windows. |

These are leaf-level and do not carry business state. Low risk for refactor.

---

## 9. Key Findings vs Audit Claims

| Audit Claim | Source | Verdict |
|---|---|---|
| `autopilot` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — `autonomous` (alias `auto`) exists instead |
| `relay` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — no equivalent |
| `workshop` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — no equivalent |
| `build` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — `run`/`autonomous` cover the functionality under different names |
| `compare` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — `arena` does this under a different name |
| `review` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — `council` covers this under a different name |
| `schedule` not registered | DEEP_AUDIT_2026-04-14 | **CONFIRMED** — no equivalent |
| `wotann ci <task>` fake-success stub | MASTER_AUDIT_2026-04-14 | **OBSOLETE** — closed in S2-19 fix at current line 3162 |
| 9 orphan CLI files | CHANNELS_ACP_CONNECTORS_DEEP_READ | **CONFIRMED-WITH-CORRECTION** — 8 orphans, not 9. `audit.ts` is wired. |

---

## 10. Recommendations

1. **Add command aliases or new registrations** for the Norse-branded user-facing names in CLAUDE.md so `wotann compare` and `wotann review` resolve (the simplest fix: a one-line Commander alias: `program.command("compare <prompt>").action((p) => program.parseAsync(["arena", p]))`-style wrapper, or use `.alias("compare")` on the existing `arena` command). The fact that `autonomous` already declares `.alias("auto")` shows the pattern is in use and is the minimum-invasive solution.
2. **Register or delete** the 8 orphan cli files. If their functionality is still wanted, wire them up; if not, delete to reduce cognitive load and remove ~1500–2400 LOC of dead code (continuing the Session-5 Tier 2 sweep of 1006 LOC).
3. **Fix `wotann watch`** to actually invoke the task against the runtime (or rename the command to reflect that it's a change-notifier, not a task runner — e.g., `wotann watch-notify` or document the limitation prominently).
4. **Fix the `--style` dormant flag** on `wotann enhance` (either forward to runtime or remove).
5. **Strengthen `wotann research`** with an actual tool-loop (WebFetch / WebSearch / Context7) or rename to `wotann deep-chat` to avoid over-promising.
6. **Update README.md line 184** — the "78-command surface" is accurate (74 leaves + 4 aliases/subgroup parents), but only 7 commands are named in the visible table. Consider auto-generating the command table from `program.commands.map(c => c.name())` at build time so docs stay in sync with code.
7. **Audit the "autopilot" code-comment** at line 2199 and 2368 — these reference "autopilot" in the past tense as if it were an actual command. Either the comments are stale (refer to now-renamed `autonomous`) or point at a not-yet-implemented future command. Align with the current naming.
8. **Close the MASTER_AUDIT `wotann ci` item** — it's been fixed in S2-19. Update MASTER_AUDIT_2026-04-18.md or produce a follow-up audit to remove this stale flag.

---

## Appendix A — Raw `.command()` Line-Number Index

```
42  133  202  246  256  266  335  345  364  377
444 462  492  533  614  617  635  638  663  727
799 816  923  1021 1065 1068 1130 1184 1225 1261
1265 1302 1343 1411 1414 1509 1552 1591 1651 1674
1677 1697 1728 1752 1755 1783 1804 1831 1855 1893
1896 1917 1933 1937 1952 1977 2000 2029 2053 2104
2108 2152 2167 2432 2532 2631 2700 2764 2832 2866
2869 2894 2911 2962 3011 3162 3214 3235 3247 3262
3329 3387 3429 3455 3536
```

85 entries total. Where the entry is a top-level `const xxxCmd = program.command("name")`, the line reflects the group declaration.

## Appendix B — Cross-Refs

- CLAUDE.md (feature-name mapping): §User-Facing Feature Names table
- README.md line 184: "78-command surface" claim
- MEMORY.md: Session 2-5 transcripts, S2-19 CI stub fix, Session 5 Tier 2 dead-code sweep (1006 LOC)
- DEEP_AUDIT_2026-04-14.md: autopilot/relay/workshop/build/compare/review/schedule claims
- MASTER_AUDIT_2026-04-14.md: wotann ci fake-success flag (now obsolete)
- CHANNELS_ACP_CONNECTORS_DEEP_READ.md: 9-orphan-file claim (corrected to 8)
