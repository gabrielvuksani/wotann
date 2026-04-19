# Competitor Deep-Extraction — Lane 7 (Specialized)

Agent: Lane 7/8, Opus 4.7 max effort.
Date: 2026-04-19.
Scope: 10 specialized repos — file typing, GPU kernels, graph review, hash-based editing, generic-agent, SWE orchestration, WASM kernel, YC stack, desktop Electron+Python, Tauri GUI.

Each repo section: (1) what it is, (2) pattern value assessment, (3) the 1-5 highest-leverage patterns with concrete WOTANN port notes. Many patterns are rejected; rejection is explicit and reasoned.

---

## 1. magika (google/magika — file-type detection)

**What it is:** Google's production ML file-type classifier. Rust CLI + Python/JS/Go bindings + ONNX model. 216 content types, ~99% average accuracy, ~2ms CPU inference, small bundled model.

**WOTANN already ships magika as a dep** (see `src/middleware/file-type-gate.ts`). Already using `MagikaNode` with graceful extension fallback. The port is *done*.

**Upstream model updates worth porting:**

### Pattern 1.1 — Model version bump to `standard_v3_3` (HIGH VALUE, 1-line change)
- `assets/models/CHANGELOG.md`: latest is `standard_v3_3` (2025-04-11), 216 outputs, ~99% accuracy, ~2ms inference.
- Recent wins: TypeScript accuracy improved 85% → 95% (v3_3), CSV regression fixed (v3_2), dataset balance tuned.
- WOTANN port: pin to v3_3 in `file-type-gate.ts` when it ships via the npm `magika` package. Currently WOTANN depends on `^1.0.0` which tracks whatever model is bundled — verify which model is in node_modules and document the pin.
- Cost: trivial. Win: TS detection goes from 85 → 95% accurate, which directly benefits the Editor tab's language routing.

### Pattern 1.2 — Per-content-type threshold system (MEDIUM VALUE, architectural)
Magika doesn't just return a label; it returns a label *and* a generic fallback ("Generic text document", "Unknown binary data") based on per-content-type confidence thresholds. Three prediction modes: `high-confidence`, `medium-confidence`, `best-guess`.
- Location: `assets/models/standard_v3_3/config.min.json`.
- WOTANN port: expose a `mode` option in `file-type-gate.ts` and propagate it to routing decisions. Exploit tab should default to `high-confidence` (refuse ambiguous binaries). Editor tab can default to `best-guess`.
- Currently WOTANN's fallback contract is binary (from-model or extension-only). Adding a confidence-band middle tier gives the Exploit tab a cleaner quarantine story.

**Rejected:** magika's actual ONNX model architecture (not useful to WOTANN — we consume, not train). The Rust CLI crate (WOTANN is TypeScript; the npm binding is better fit). Website/docs (marketing-only).

**Upstream activity is low-priority porting**: the model bumps are valuable but small; the architecture is already integrated. No CRITICAL gaps. Rating: **2 patterns, both incremental.**

---

## 2. deepgemm (deepseek-ai/DeepGEMM — GPU matmul kernels)

**What it is:** CUDA tensor-core kernel library. FP8/FP4/BF16 GEMMs, MoE with overlapped communication, MQA scoring, JIT compilation at runtime. SM90/SM100 only (H100+).

**Assessment: WRONG STACK, NOT PORTABLE.**

WOTANN is a desktop AI agent harness. It does not ship CUDA kernels. Providers (Claude, Gemini, local Gemma 4) run their own kernels. There is no H100 compute path in WOTANN, and none planned per MASTER_PLAN_V5. The closest analog (bundled Gemma 4 via llama.cpp/MLX) uses different, CPU/Metal-oriented kernels.

**One pattern worth noting (not porting):**

### Pattern 2.1 — JIT-at-runtime model for kernel variants (INFO, NOT PORTABLE)
DeepGEMM's design — many kernel variants, compiled on-demand by a lightweight JIT CPP module, no CUDA at install time — is an elegant way to handle hardware-conditional codepaths. WOTANN has no equivalent problem: our platform branches (Metal vs CPU, arm vs x64) are handled by `magika` sidecars and the Tauri `src-tauri/src/native/` layer, and the heavy-lift kernels live in vendor processes (Claude/Gemma).

**Rejected everything else.** This is a wrong-stack repo. Rating: **0 patterns worth the rebuild cost.**

---

## 3. code-review-graph (tirth8205/code-review-graph — graph-based code review)

**What it is:** Tree-sitter AST + SQLite graph DB + MCP server. Stores code as nodes (File/Class/Function/Type/Test) + edges (CALLS/IMPORTS_FROM/INHERITS/TESTED_BY/DEPENDS_ON). Computes minimal read-set for AI code review. Claims 8.2× token reduction.

**Assessment: VERY VALUABLE. Direct fit for WOTANN's Editor + review flows. No current equivalent in WOTANN.**

### Pattern 3.1 — Tree-sitter + SQLite graph as MCP server (HIGH VALUE, port as new MCP)
- Location: `code_review_graph/graph.py` (schema), `code_review_graph/parser.py` (Tree-sitter), `code_review_graph/incremental.py` (git-diff-aware updates).
- Schema is simple: `nodes(kind, name, qualified_name, file_path, line_start/end, language, hash)` + `edges(kind, source_qualified, target_qualified, confidence, confidence_tier)`. Indexes on `source_qualified`, `target_qualified`, `(target, kind)`, `(source, kind)`.
- Query API: "impact radius" / "blast radius" — for a changed symbol, return transitive callers up to depth N, capped at M nodes. Uses `networkx` for BFS with pluggable engine.
- WOTANN port: ship as `src/mcp/code-graph/` — parse with `tree-sitter` npm bindings (WOTANN is TS-first), store in the existing WOTANN local SQLite, expose MCP tools: `build_graph`, `impact_radius(symbol, depth)`, `tests_covering(symbol)`, `subgraph(symbol, depth)`.
- Integration point: WOTANN's `/review` command in the Editor tab should call `impact_radius` before reading files. 8× token reduction on review flows is a real competitive win.
- Incremental updates via git diff — keep the graph fresh without full re-parse. Sub-10s for 500-file repos.

### Pattern 3.2 — Confidence tier on edges (MEDIUM VALUE, design polish)
Every edge carries `confidence REAL DEFAULT 1.0` + `confidence_tier TEXT DEFAULT 'EXTRACTED'`. Differentiates directly-parsed edges (TS types, explicit imports) from inferred edges (dynamic dispatch, duck-typed calls).
- WOTANN port: when we add code-graph, keep this column. Lets us prioritize high-confidence paths in the Editor's navigation, and flag low-confidence inferences for the Workshop tab review.

### Pattern 3.3 — Auto-detect and configure N AI coding tools in one command (MEDIUM VALUE, DX polish)
`code-review-graph install` auto-detects Claude Code, Codex, Cursor, Windsurf, Zed, Continue, OpenCode, Antigravity, Kiro — writes the right MCP config for each. Single command.
- WOTANN port: our `install.sh` could scan for installed AI coding tools and write WOTANN's MCP config to all of them. Lowers the activation-energy barrier for users who already have another agent harness.
- File locations to write per host are well-documented in `code_review_graph/cli.py`.

**Rejected:** the VSCode extension (`code-review-graph-vscode/`) — WOTANN does not currently need a VSCode extension; Editor is built into our Tauri desktop app.

**Rating: 3 patterns, with #3.1 being a CRITICAL port.**

---

## 4. oh-my-openagent (code-yeongyu — category routing, hash editing, intent gate)

**What it is:** Heavy plugin/fork of OpenCode/Anthropic's Claude Code. TypeScript, Bun, OpenCode-based. Dozens of hooks (`src/hooks/`) and middleware-esque features. The three specific asks from the brief:

### Pattern 4.1 — Category + skill reminder hook (HIGH VALUE — port to WOTANN hooks)
- Location: `src/hooks/category-skill-reminder/hook.ts`.
- Mechanism: tracks per-session `{delegationUsed, reminderShown, toolCallCount}`. After 3 tool calls to "delegatable work tools" (`edit`/`write`/`bash`/`read`/`grep`/`glob`) WITHOUT any call to delegation tools (`task`/`call_omo_agent`), it appends a reminder message to the next tool output.
- WOTANN port: our middleware pipeline already has `doom-loop.ts` and `stale-detection.ts`. Add a `delegation-reminder.ts` middleware that fires the same rule: after N direct-work tool calls with 0 delegations, inject `contextPrefix` into the next model turn reminding the agent that parallel subagents exist.
- Why it works: LLMs forget their delegation tools exist mid-task and fall into linear-execution grooves. A structural reminder (not a prompt tweak) corrects this reliably.
- Fits WOTANN's quality-bar rule #5 (HookResult.contextPrefix as injection channel).

### Pattern 4.2 — Keyword-based intent detection with regex + 10+ languages (HIGH VALUE — WOTANN intent-gate already exists)
- Location: `src/hooks/keyword-detector/constants.ts`.
- They detect `ultrawork`, `search`, and `analyze` intents with *multilingual* regex — Korean, Japanese, Chinese, Vietnamese — and inject mode-specific prompts (`[analyze-mode]` etc.) as tool-output suffixes.
- Critically, they strip code blocks *before* matching (`removeCodeBlocks` pre-filter): regex never runs against fenced code. Prevents false-positive triggers from user-pasted code.
- WOTANN port: our `src/middleware/intent-gate.ts` matches only English (`/\b(implement|create|build|...)\b/i`). Port the multilingual regex table (the literal regex sources are open-source) and the `removeCodeBlocks` pre-filter. Both are drop-in.
- The `[analyze-mode]` injected content (context-gathering checklist with Oracle/Artistry specialists + `MANDATORY delegate_task params` reminder) is a great template for WOTANN's mode prompts — demonstrates how to encode process rules inside an auto-injected reminder.

### Pattern 4.3 — Hashline edit (CRITICAL VALUE, solves a real edit-race bug)
- Location: `src/hooks/hashline-read-enhancer/hook.ts` + `src/hooks/hashline-edit-diff-enhancer/hook.ts` + `src/tools/hashline-edit/`.
- Mechanism: when `read` returns file content, each line is rewritten as `<line_num>#<hash_of_(line_num+content)>|<content>`. Cheap and reversible.
- On `edit`/`write`, before/after diff hook captures original content at `tool.execute.before`, computes real unified diff at `tool.execute.after`, exposes the true diff (with stale-line-guard via hash). If the LLM tries to edit a line it has a *stale* hash for (file changed since its last read), the edit is rejected.
- This is the oh-my-openagent replacement for Anthropic's `Edit` tool's "must read first" rule — but it makes staleness *enforceable* at the harness level instead of trusting the model.
- WOTANN port: add `src/middleware/hashline-read-enhancer.ts` (transforms read output) + `src/middleware/hashline-edit-guard.ts` (validates hashes on edit; rejects stale edits with a clear error message). Also add `src/tools/hashline-edit/hash-computation.ts` exporting `computeLineHash(lineNumber, content): string`.
- Eliminates an entire class of "I edited the wrong version" bugs. Worth shipping standalone.
- Enforcement approach (configurable): `hashline_edit.enabled` in config; ship enabled by default in the Editor tab.

### Pattern 4.4 — Preemptive compaction trigger (MEDIUM VALUE, parallel to WOTANN's existing compaction flow)
- Location: `src/hooks/preemptive-compaction-trigger.ts` (+ `preemptive-compaction-degradation-monitor.ts`).
- Watches model-output quality metrics; when quality degrades (emptying responses, repeating tool calls, hallucinated output) AND we are near the context window, triggers compaction *before* the hard limit hits.
- WOTANN's current path relies on the host's compaction. Preemptive compaction based on degradation (not just token count) is a clear step up — especially for long-running sessions in the Workshop tab.
- Port cost: medium. Needs a per-session quality scoring model. Can be heuristic first (e.g., "last 3 tool calls repeated same tool + same args").

### Pattern 4.5 — Plugin-state + plugin-interface abstraction (INFO ONLY, don't port directly)
- `src/plugin-interface.ts` / `src/plugin-state.ts` / `src/plugin-handlers/`: they wrap OpenCode's plugin API cleanly. Every hook has the shape `tool.execute.before` / `tool.execute.after` / `event` handlers.
- WOTANN's middleware pipeline already has a cleaner abstraction (`src/middleware/pipeline.ts`, `src/middleware/types.ts`). Don't refactor to match — our interface is better.

**Rating: 4 high-value ports (4.1/4.2/4.3/4.4), one rejected (4.5). Hashline edit is the standout.**

---

## 5. generic-agent (lsdefine/GenericAgent — ~3K-line self-evolving agent)

**What it is:** Chinese open-source "minimal" agent framework. ~100-line agent loop, 9 atomic tools, claim: crystallizes every task into a reusable skill. Targets < 30K context window.

**Assessment: INTERESTING DESIGN PHILOSOPHY, BUT NOT A DIRECT PORT. Mostly monolithic Python (50KB `llmcore.py`, 42KB `simphtml.py`, 33KB `ga.py`) — low cohesion.**

### Pattern 5.1 — Skill crystallization loop (HIGH VALUE PHILOSOPHY, partial port)
- Mechanism (per README + `memory/` dir): after solving a new task, the agent extracts the successful execution path into a reusable "skill" stored in a layered memory hierarchy (L0-L4).
- `memory/skill_search/` contains the skill index; `memory/L4_raw_sessions/` stores archived session traces; `memory/autonomous_operation_sop.md` documents the extraction rules.
- WOTANN port: this is philosophically what claude-mem + Engram auto-capture attempt. But it's more: explicitly crystallize and tag *successful paths* as named skills. WOTANN's marketplace (`src/marketplace/`) + skills (mentioned in CLAUDE.md) could become the home for crystallized skills.
- Don't port the code (it's a domain-specific agent loop). Port the workflow: after a successful multi-step task in WOTANN, optionally write a "recipe" to `src/marketplace/skills/` that encodes the tool sequence + intent. Users can accept/reject.

### Pattern 5.2 — Layered memory L0-L4 (MEDIUM VALUE, partial overlap with Engram)
- L0 = working context
- L1 = current task
- L2 = project-level
- L3 = agent-level persistent
- L4 = session archive (raw transcripts on disk)
- WOTANN already has: conversation context (L0-L1), `src/memory/` (L2-L3), session archives (`.claude/session-data/` at workspace level = L4).
- Port gap: explicit *tier promotion* rules — "facts mentioned 3+ times across sessions get promoted L3→L2". The `memory_management_sop.md` in their memory dir documents these rules. Consider porting the SOP text to WOTANN's memory/ as a reference.

### Pattern 5.3 — Agent loop as yield generator (NICE PATTERN, low-priority port)
- `agent_loop.py` uses Python's `yield from` to stream tool outputs and tool-call decisions through a thin `BaseHandler`. ~100 lines total.
- Elegant, but WOTANN already has a mature middleware pipeline. Skip.

**Rejected:** WeChat/Alipay integrations (`memory/skill_search/` specific skills), TMWebDriver (their browser driver — WOTANN uses Tauri webview instead), frontend GUI (custom `hub.pyw` Tkinter app — WOTANN ships Tauri). These are tied to their specific locale/stack.

**Rating: 2 partial ports (5.1 skill crystallization, 5.2 memory-tier SOP). Neither urgent.**

---

## 6. open-swe (langchain-ai/open-swe — SWE task execution on LangGraph)

**What it is:** LangChain-first SWE agent. Composes on `deepagents`, uses LangGraph, runs each task in an isolated cloud sandbox (Modal/Daytona/Runloop/LangSmith). Slack/Linear integration. Small curated toolset (7 core + built-ins).

**Assessment: VALUABLE MIDDLEWARE PATTERNS. Directly addresses the `@after_agent` safety-decorator parity question in the brief.**

### Pattern 6.1 — @after_agent safety-decorator: open PR as final guarantee (HIGH VALUE, port the concept)
- Location: `agent/middleware/open_pr.py`.
- Mechanism: `@after_agent async def open_pr_if_needed(state, runtime)` runs *after* the agent finishes. If the LLM already called `commit_and_open_pr`, it's a no-op. Otherwise it commits remaining changes, pushes to a feature branch, and opens a PR automatically.
- This is a *completion guarantee*: the user's "fix this and open a PR" intent is satisfied even if the model forgot the final tool call.
- WOTANN port: add an after-agent hook stage to `src/middleware/pipeline.ts` that runs *after* the model's last response. Convert our existing `src/middleware/pre-completion-checklist.ts` + `verification-enforcement.ts` into explicit `@afterAgent`-style final-step middleware. Our current version runs inline; making it terminal-step makes the contract explicit.
- Quality-bar parity: WOTANN's "Verify Full Chain" rule (editing code ≠ fixing; must rebuild+restart+verify) is exactly the kind of thing `@after_agent` should enforce as a harness-level safety net, not as a prompt directive.

### Pattern 6.2 — @before_model message-queue injection (CRITICAL VALUE, port it)
- Location: `agent/middleware/check_message_queue.py`.
- Mechanism: before every model call, check the LangGraph store for pending human messages (e.g., a follow-up Linear comment that arrived while the agent was busy). If found, inject as new user messages and delete from queue (FIFO; delete-before-return to avoid duplicate processing).
- This is how they handle async interruptions during long-running agent sessions.
- WOTANN port: WOTANN supports channels/ACP/connectors (`src/channels/`). Today if a Slack/Discord/iOS push reply arrives mid-session, it's queued but not injected. Port the `@beforeModel` pattern to WOTANN's middleware (call it `message-queue-drain`): check `src/memory/` pending queue at start of each turn, inject as new user messages, delete-first-to-avoid-dup.
- Pattern: `delete-before-process` vs `process-then-delete`. They chose `delete-first` to guarantee no double-processing even if the turn fails mid-flight. Worth adopting.

### Pattern 6.3 — ToolErrorMiddleware: catch-all normalized error shape (MEDIUM VALUE, partial overlap)
- Location: `agent/middleware/tool_error_handler.py`.
- Mechanism: `AgentMiddleware.wrap_tool_call(request, handler)` wraps every tool call in try/except. Exceptions become `ToolMessage(status="error", content=json.dumps({error, error_type, name, status}))`. Returns structured JSON to the LLM.
- Ensures: unhandled Python exception in a tool does not crash the agent run; the LLM sees a parseable error and can self-correct.
- WOTANN port: WOTANN's `src/middleware/tool-pair-validator.ts` does *some* of this. Extend to wrap all tool calls, not just paired ones, and return a canonical error envelope: `{error, error_type, name, status: "error"}` — parsing-friendly for the model.
- Honest-stubs parity (WOTANN quality bar): this is exactly the "honest stub over silent success" pattern — the LLM sees real failures and can react, instead of silent swallowing.

### Pattern 6.4 — Ensure non-empty model output (MEDIUM VALUE, small diff)
- Location: `agent/middleware/ensure_no_empty_msg.py`.
- If the last model message has neither content nor tool_calls, middleware injects a `ToolMessage(no_op)` sentinel so the run doesn't hang on empty-string.
- WOTANN port: add to `doom-loop.ts` — detect empty model response, inject `<empty-response/>` sentinel, force a retry with an explicit prompt ("You returned an empty response. Please take a concrete next action or use no_op if done.").

### Pattern 6.5 — Tool curation principle: "curated, not accumulated" (PHILOSOPHY, informs WOTANN port list)
- Stripe's insight, per README: 7 core tools + built-ins. Not 50.
- WOTANN currently ships many tools (benchmark-engineering, built-in, rate-limit-resume, etc. in `src/desktop/`). For the user-facing agent tab, compress to a small curated set; keep the rest as admin/workshop-tab tools.
- Not a code port — a roadmap rule.

**Rating: 4 concrete ports (6.1/6.2/6.3/6.4), one principle (6.5). The `@after_agent` + `@before_model` patterns directly answer the brief's parity question.**

---

## 7. ruflo (ruvnet/ruflo — WASM bypass, Raft consensus)

**What it is:** Heavy marketing, 60+ agents, 130+ skills, 27 hooks, claims Raft consensus + WASM kernels + HNSW vector memory. 6000+ commits. Descendant of `claude-flow`.

**Assessment: LARGELY MARKETING/ASPIRATIONAL. Actual ported-worthy code is narrow.**

- `docs/adr/ADR-002-WASM-CORE-PACKAGE.md` explicitly says **"TypeScript-first approach with optional WASM optimization"** — i.e., WASM is fallback decoration; pure TS implementations do the work.
- No Rust WASM source in the repo (search for `wasm/*.wasm` finds zero kernel binaries in `ruflo/`). `wasm/ruvector-attention.wasm` and `ruvector-rvlite.wasm` are listed in the ADR as hypothetical layout, not shipped binaries.
- "Raft consensus" — zero Raft code in `ruflo/ruflo/src/`. Appears only in marketing copy.
- "Enterprise security / AIDefence / fault-tolerant consensus" — no code.

**What's actually real and worth extracting:**

### Pattern 7.1 — WASM Kernel: private stdio MCP tunnel (NOVEL, HIGH VALUE — answers the brief directly)
- Location: `src/mcp-bridge/mcp-stdio-kernel.js` (≈150 lines, Node).
- Despite the name, this is not a WebAssembly file. It's a node process running INSIDE the chat-ui Docker container that:
  1. Speaks MCP protocol over stdio (trusted; no network exposure required).
  2. Forwards every MCP request over HTTP to the MCP bridge service at `http://mcp-bridge:3001` on the internal Docker network.
  3. Signs requests with HMAC-SHA256 (using `RVF_KERNEL_SECRET`) + timestamp + nonce in headers (`X-RVF-Signature`, `X-RVF-Timestamp`, `X-RVF-Nonce`).
  4. Caches `tools/list` for 60s (META_IDX cache).
- The clever part: an MCP client (like Claude) normally requires HTTPS for remote MCP. This stdio tunnel **bypasses the HTTPS requirement** because stdio is trusted transport — but the tunnel is still *inside a container* forwarding to an *internal Docker network* service. The HTTP hop is trust-compartmented to the container network.
- WOTANN port-worthiness: if WOTANN ever ships a "WOTANN-in-a-box" Docker distribution (for self-hosters), this stdio-tunnel-to-internal-HTTP pattern is the right way to expose MCP without requiring TLS certs on every internal service. File away under `src/mcp/` for when self-hosted distribution lands. HMAC signing for MCP requests is worth borrowing even without Docker — e.g., for WOTANN's Companion Server architecture.

### Pattern 7.2 — RVF manifest format (LOW VALUE, novelty only)
- `rvf.manifest.json`: invented packaging format with "segments" (MANIFEST, PROFILE, WASM, META_IDX, etc.). Deploys to Google Cloud Run or Docker Compose.
- WOTANN port: not needed. We use standard Tauri bundling + the iOS/macOS Xcode project. The RVF format is mostly vendor fiction on top of Docker Compose.

**Rejected (marketing only):** "Q-Learning Router", "EWC++", "Flash Attention 2.49-7.47x", "Hyperbolic Poincaré", "SONA", "9 RL Algos". No actual implementations in `ruflo/ruflo/src/`. WOTANN's competitor-research doc should record this as a vendor-claims-vs-reality gap.

**Rating: 1 real pattern worth extracting (7.1 HMAC-signed stdio tunnel). The rest is marketing.**

---

## 8. gstack (garrytan/gstack — YC stack)

**What it is:** Garry Tan's "virtual engineering team" slash commands. Bun+TypeScript. 23 specialist roles (CEO/Design/Eng/Reviewer/QA/CSO/Release) + 8 power tools. Persistent headless Chromium daemon. MIT-licensed. Very opinionated.

**Assessment: LOTS OF TASTE HERE, several patterns directly applicable to WOTANN's Tauri app + browser flows.**

### Pattern 8.1 — Persistent browser daemon model (HIGH VALUE — complements WOTANN's browser/)
- Location: `ARCHITECTURE.md` + `browse/src/`.
- Mechanism: long-lived headless Chromium daemon. CLI talks via localhost HTTP. Daemon: persistent tabs + cookies + logged-in sessions + 30-min idle timeout. First call ~3s, every call after ~100-200ms.
- State file: `.gstack/browse.json` with `{pid, port, token, startedAt, binaryVersion}`, atomic write (tmp + rename), mode 0o600.
- Port selection: random 10000-60000 with retry; enables N Conductor/worktree workspaces to run independent browsers with zero config.
- Version auto-restart: CLI compares `git rev-parse HEAD` burned into binary vs running daemon's `binaryVersion`; kills stale daemon and respawns. **Eliminates stale-binary bugs entirely.**
- WOTANN port: WOTANN has `src/browser/` (Playwright-based). Adopt the daemon-pid+random-port+token+health-check model. Most valuable: **binary-version check for auto-respawn** — solves the same class of stale-process bug that WOTANN's daemon has.
- Cookie-file decryption via native SQLite (Bun.Database) — WOTANN can do the same via `better-sqlite3` or the existing Tauri Rust backend.

### Pattern 8.2 — Diff-based test selection for paid evals (HIGH VALUE, maps to `superpowers/conductor` infra)
- Location: `test/helpers/touchfiles.ts`.
- Rule: each test declares its file dependencies. `test:evals` script runs only tests whose touchfiles changed in `git diff` against base branch. Global touchfiles trigger all. `EVALS_ALL=1` forces all.
- Two-tier classification: `gate` (runs in CI, blocks merge) vs `periodic` (weekly cron / manual, for non-deterministic / Opus / external-service tests).
- Cost guarantee: `~$4/run max`. Real numbers.
- WOTANN port: WOTANN's `tests/` currently runs linear. Adopt touchfiles + diff-aware selection for expensive tests (LLM-judge, E2E). Cap cost per CI run. Two-tier (gate/periodic) is a cleaner split than "unit/integration/E2E".
- Direct savings: WOTANN benchmarks (TerminalBench target 83-95%) are expensive. Diff-based selection at PR time + full on main = real $.

### Pattern 8.3 — Skill template generation with per-skill config (MEDIUM VALUE, DX polish)
- `scripts/gen-skill-docs.ts`: reads `SKILL.md.tmpl` per skill and renders `SKILL.md` via a template resolver. Enables keeping skill metadata in typed config, not free-form markdown.
- Catches skill doc drift: `skill-check.ts` is a health dashboard.
- WOTANN port: WOTANN's skill/agent system (per CLAUDE.md, skills live in `~/.claude/skills/`). Template-generating skill docs from a typed config keeps them in sync when we ship new skills.

### Pattern 8.4 — `careful`/`freeze`/`guard` composable safety modes (HIGH VALUE — port the concept)
- `careful/SKILL.md`: PreToolUse hook on Bash checks for `rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, `kubectl delete`, `docker rm -f`, etc. Warns with override.
- `freeze/SKILL.md`: restricts edits to one directory.
- `guard` = careful + freeze combined.
- The pattern is **composable safety primitives**, each with a narrow matcher hook + clear override UX.
- WOTANN port: our middleware has `stale-detection.ts` and `tool-pair-validator.ts`, but no "destructive-command protection" primitive. Add `src/middleware/destructive-guard.ts` with a pattern library (literally port gstack's regex set). Pair with `src/middleware/directory-freeze.ts` (restrict writes to an allowed path prefix).
- These should be *opt-in middleware layers*, not always-on — preserves the agent's default autonomy while giving paranoid users a safety belt. Fits WOTANN's "opt-in caps" quality bar.

### Pattern 8.5 — `autoplan` decision-principles auto-pipeline (NICE, PARTIAL FIT)
- `autoplan/SKILL.md`: runs CEO/design/eng/DX reviews sequentially, auto-decides using "6 decision principles", surfaces only taste decisions to the user at a final approval gate.
- Instead of 15-30 intermediate questions, one final gate.
- WOTANN port: WOTANN's `src/autopilot/` has similar ambitions. Worth reading `autoplan/` in full and seeing if the 6 decision principles are explicit enough to adopt.

**Rejected:** the 23 specialist roles (CEO/Design/Eng/etc.) — these are role-prompts that belong in WOTANN's marketplace/ not the core. Users can import them.

**Rating: 5 strong patterns. #8.1 (daemon lifecycle) and #8.4 (composable safety modes) are the highest-leverage.**

---

## 9. eigent (eigent-ai/eigent — desktop AI UX, Electron+Python)

**What it is:** Electron desktop app + Python backend (FastAPI+Celery+Alembic+Redis). "Cowork" multi-agent workforce, CAMEL-AI-based. MCP integration. Local deployment.

**Assessment: VALUABLE COMPARISON POINT vs. WOTANN's Tauri+TS architecture. Most patterns are UX, not code.**

### Pattern 9.1 — Electron main-process handles Python backend lifecycle (ARCHITECTURAL COMPARISON — WOTANN Tauri parity already good)
- `electron/main/index.ts` + `electron/main/init.ts`: main process handles `spawn()` of Python backend (`startBackend`), port selection (`findAvailablePort`), health checking, on-update re-install (`checkAndInstallDepsOnUpdate`).
- Uses `tree-kill` for subprocess cleanup, `unzipper` for packaged Python env extraction.
- Electron IPC exposes backend comms via `ipcMain.handle(...)`.
- WOTANN equivalent (Tauri): we use `src-tauri/src/process/` + `src-tauri/src/commands/` — much lighter. Tauri's security model (capability-gated IPC) is better than Electron's default (renderer has most Node APIs unless `nodeIntegration: false`).
- Eigent pattern to avoid: Electron with loose capabilities + arbitrary npm deps in main process — auto-update attack surface is much larger than Tauri.
- **Comparison note (not a port):** our Tauri stack is structurally safer. Good for marketing; no change needed.

### Pattern 9.2 — Python backend structure (BACKEND ARCHITECTURE, low fit)
- `server/app/{api,core,domains,model,shared}/` — clean FastAPI domain split.
- WOTANN is TS-first, no Python backend. Not portable.

### Pattern 9.3 — Dual-copy WebView + native macOS rounded corners (SMALL UX POLISH)
- `electron/main/webview.ts` + `electron/main/native/macos-window.ts` (`setRoundedCorners`).
- WOTANN port: if we want the "glass UI" per Phase 3 plan to include rounded corners native to macOS Sonoma+, the Tauri equivalent is via `window.setEffect()` and CSS `border-radius` on a transparent titlebar. Already solved in WOTANN's Tauri config, verify.

### Pattern 9.4 — Package self-extracting Python + zipped env via `unzipper` (INSTALLER PATTERN, FYI)
- Eigent ships a prebuilt Python environment (zipped) and extracts on first run. Avoids user-system Python version issues.
- Relevant because WOTANN bundles Gemma 4 models — same shape of problem (large binary asset, ship-and-extract). Tauri's `resource` mechanism handles this; we already do it.

**Rejected:** CAMEL-AI dependency (not portable; license + framework lock-in). Multi-agent Workforce coordination (marketing mostly; no code differentiator vs. what WOTANN already has via `src/orchestration/`). Enterprise SSO (domain-specific to their go-to-market).

**Rating: 0 direct ports. Eigent's main value is as a *benchmark for what NOT to do* — Electron + Python backend is more maintenance than WOTANN's Tauri + TS single-process model. Document this in the competitor-analysis as "architectural moat proof".**

---

## 10. opcode (winfunc/opcode — Rust/Tauri patterns)

**What it is:** Tauri 2 + React GUI for Claude Code. Custom CC Agents, interactive sessions, secure background agents, MCP management, timeline/checkpoints, CLAUDE.md management. Rust/Tauri patterns are the direct parallel to WOTANN.

**Assessment: THE BEST ARCHITECTURAL REFERENCE IN LANE 7. Directly applicable Tauri patterns.**

### Pattern 10.1 — Checkpoint / Timeline persistence for CC sessions (HIGH VALUE, novel)
- Location: `src-tauri/src/checkpoint/` — `manager.rs` + `state.rs` + `storage.rs` + `mod.rs`.
- `CheckpointManager` tracks per-session `{project_id, session_id, project_path, file_tracker, storage, timeline, current_messages (JSONL)}`.
- Persists: per-file FileSnapshot + FileState + SessionTimeline. Loads existing timeline if present, else creates new.
- Checkpoint strategies (kinds of snapshot triggers) are represented as `CheckpointStrategy` enum.
- WOTANN port: our `src/core/` + `src/orchestration/` could adopt checkpoint+timeline as a first-class concept. Currently sessions are ephemeral unless archived. Named checkpoints at user-initiated moments ("before risky refactor") + auto-checkpoints (on error, on tool-error, before `@after_agent` PR-open) would enable "undo" at the session level.
- Directly maps to WOTANN MASTER_PLAN_V5 Phase-6-ish work on session resumability.

### Pattern 10.2 — Custom slash commands with YAML frontmatter + `$ARGUMENTS` placeholder (MEDIUM VALUE)
- Location: `src-tauri/src/commands/slash_commands.rs`.
- Parses `.md` files from project `.claude/commands/` and user `~/.claude/commands/` directories.
- Each command exposes: `{name, full_command, scope, namespace, file_path, content, description, allowed_tools, has_bash_commands, has_file_references, accepts_arguments}`.
- Two scopes: `"project"` (repo-local) + `"user"` (global).
- Namespace via directory (`frontend/component.md` → `/project:frontend:component`).
- WOTANN port: WOTANN's slash command system (per docs) — adopt the same YAML+markdown+scoped+namespaced structure. Makes WOTANN slash commands interop-compatible with Claude Code's ecosystem. Huge compat win.

### Pattern 10.3 — Rust-side Claude binary discovery (SMALL BUT CRITICAL)
- Location: `src-tauri/src/claude_binary.rs`.
- macOS Tauri apps have a limited PATH. `find_claude_binary(app_handle)` walks `~/.nvm/`, `/opt/homebrew/bin`, `/usr/local/bin`, etc., to find the `claude` binary. Called from every command that spawns it.
- WOTANN port: WOTANN spawns provider binaries (claude, codex, etc.) from Tauri. If we don't already have a walker, adopt this. Prevents the "works in terminal, fails in app" bug class.

### Pattern 10.4 — MCP Server management UI model (NICE UX, informs WOTANN's design)
- `src-tauri/src/commands/mcp.rs` — `MCPServer {name, transport (stdio|sse), command, args, env, url, scope (local|project|user), is_active, status: {running, error, last_checked}}`.
- UI lets user add/remove/inspect MCP servers from the GUI. No manual `.mcp.json` editing.
- WOTANN port: WOTANN should expose MCP management in the Workshop tab settings pane with the same data model.

### Pattern 10.5 — Agents stored in SQLite with hooks as JSON (DATA MODEL)
- `src-tauri/src/commands/agents.rs`: `Agent {id, name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks (JSON), created_at, updated_at}` + `AgentRun {id, agent_id, task, model, project_path, session_id (UUID), status, pid, process_started_at, created_at, completed_at}`.
- SQLite schema is clean and maps directly to WOTANN's needs for the Chat/Workshop agent library.
- WOTANN port: if WOTANN's Workshop tab stores user-defined agents, mirror this schema. Store hooks-as-JSON (not as separate rows) to keep per-agent hook customization simple.

**Rejected:** analytics consent screens (UI-specific), NFO credits, custom titlebar details — UI polish not architecture.

**Rating: 5 strong architectural ports. Opcode is the closest analog to WOTANN in this lane and should be referenced any time we add a Tauri-side feature.**

---

## Cross-Repo Summary (Top-10 Port Priority for Session 7)

Priority 1 = ship this session; Priority 3 = backlog.

| Pri | Pattern | Source | WOTANN target location | Effort |
|-----|---------|--------|-----------------------|--------|
| 1 | Hashline edit guard (stale-line protection) | oh-my-openagent 4.3 | `src/middleware/hashline-*.ts` + `src/tools/hashline-edit/` | 1-2 days |
| 1 | `@after_agent` safety-net stage | open-swe 6.1 | `src/middleware/pipeline.ts` (terminal stage) | 0.5 day |
| 1 | `@before_model` message-queue drain | open-swe 6.2 | `src/middleware/message-queue-drain.ts` | 0.5 day |
| 1 | Tree-sitter graph MCP (impact radius) | code-review-graph 3.1 | `src/mcp/code-graph/` | 3-5 days |
| 1 | Delegation-reminder hook | oh-my-openagent 4.1 | `src/middleware/delegation-reminder.ts` | 0.5 day |
| 2 | Multilingual intent-gate regex | oh-my-openagent 4.2 | extend `src/middleware/intent-gate.ts` | 0.5 day |
| 2 | Composable destructive-guard + freeze | gstack 8.4 | `src/middleware/destructive-guard.ts` + `directory-freeze.ts` | 1 day |
| 2 | Daemon binary-version auto-respawn | gstack 8.1 | `src/browser/` + companion-server lifecycle | 1 day |
| 2 | Custom slash commands (YAML+scope+namespace) | opcode 10.2 | `src/commands/` loader parity | 1 day |
| 2 | Diff-based test selection | gstack 8.2 | `tests/` helpers + CI | 1 day |
| 3 | Checkpoint/timeline persistence | opcode 10.1 | Tauri-side `src-tauri/src/checkpoint/` | 3 days |
| 3 | ToolErrorMiddleware canonical error shape | open-swe 6.3 | extend `src/middleware/tool-pair-validator.ts` | 0.5 day |
| 3 | Magika v3_3 pin + threshold mode | magika 1.1+1.2 | `src/middleware/file-type-gate.ts` | 0.25 day |
| 3 | Preemptive compaction on degradation | oh-my-openagent 4.4 | extend `src/middleware/doom-loop.ts` | 2 days |
| 3 | HMAC-signed MCP stdio tunnel | ruflo 7.1 | `src/mcp/` — only if self-hosted distro lands | 2 days (conditional) |

## Specific Brief Answers

- **Magika upstream new types?** Yes — model bumped to `standard_v3_3` (2025-04-11). TS accuracy 85% → 95%, CSV regression fixed. Low-cost 1-line version pin. Also port per-content-type threshold modes (`high-confidence`/`medium-confidence`/`best-guess`) for the Exploit tab.
- **Oh-my-openagent category routing + hash editing + intent gate port-worthy?** Yes, all three. Hashline edit (4.3) is the CRITICAL port — solves real stale-edit bugs at the harness level. Delegation reminder hook (4.1) and multilingual intent gate (4.2) are also high-value.
- **Open-swe `@after_agent` parity?** WOTANN's `src/middleware/pre-completion-checklist.ts` + `verification-enforcement.ts` are *close* but run inline, not at a terminal stage. Convert to explicit `@afterAgent`-style stage. Additionally port `@before_model` message-queue drain (6.2) — WOTANN has channels/connectors but no mid-session message injection.
- **Ruflo WASM bypass = WOTANN wasm-backed tools?** WOTANN does not currently have wasm-backed tools. Ruflo's actual "WASM kernel" is misnamed — it's a Node stdio-to-HTTP tunnel inside Docker with HMAC signing (7.1). Interesting for future self-hosted WOTANN distribution, not an urgent port. The rest of ruflo's WASM/Raft/RL claims are marketing; no shipped code.
- **Eigent Electron+Python UX vs WOTANN Tauri?** WOTANN's Tauri+TS single-process model is structurally simpler and more secure than Eigent's Electron+FastAPI+Celery+Alembic+Redis. No direct ports. Use as marketing proof of WOTANN's architectural moat (0 patterns extracted from eigent).

## Competitor Moat Notes (Updated)

Document in WOTANN's competitor-analysis next session:

- **Ruflo vendor-claims-vs-reality:** no Raft, no trained Q-Learning, no shipped WASM kernels, no Flash Attention. Marketing fiction. WOTANN's honest-stubs quality bar is a structural differentiator.
- **Eigent architectural cost:** Electron + Python + FastAPI + Celery + Redis + Alembic = 5 runtime deps. WOTANN Tauri + TS = 1. Maintenance / security / install-time cost differential is a defensible moat.
- **Gstack daemon lifecycle discipline:** binary-version auto-respawn eliminates stale-process bugs. WOTANN's daemon should adopt this before Phase-8 ship.

---

End of Lane 7.
