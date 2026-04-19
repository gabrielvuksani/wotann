# WOTANN Competitor Deep-Extraction Lane 2

**Agent**: Deep-Extraction Agent 2/8 (Opus 4.7 max effort)
**Date**: 2026-04-19
**Repos analyzed**: 5 (archon, deer-flow, deepagents, claude-task-master, kilocode)
**Patterns extracted**: 52

---

## Executive Summary

Each of the 5 competitors surfaces a distinctive architectural primitive that WOTANN has NOT yet ported. In order of priority:

1. **Archon** — DAG workflow engine with topological layers, 4 trigger rules, and a `when:` expression language (Kahn's algorithm, fail-closed). Also: IsolationResolver's 6-step decision tree that WOTANN's workflow-dag and wave-executor do not implement end-to-end.
2. **Deer-flow** — 18-layer LangGraph middleware stack (WOTANN has 25 but is missing **6 distinct classes** deer-flow has), plus **virtual path abstraction** — a translation layer between agent-facing `/mnt/user-data/*` and physical thread-scoped dirs, with bi-directional path masking on output.
3. **Deepagents** — A **harness profile system** (`_HarnessProfile`) that lets provider-specific middleware, tool description overrides, and excluded tools automatically attach based on resolved model identifier. Plus: per-subagent permission-rule inheritance with parent-override semantics.
4. **Claude-task-master** — A **WorkflowOrchestrator state machine** with explicit phase transitions (PREFLIGHT → BRANCH_SETUP → SUBTASK_LOOP → FINALIZE → COMPLETE) and nested TDD phase transitions (RED → GREEN → COMMIT). Also: **tiered MCP tool loading** (`core` / `standard` / `all`) via an env var.
5. **Kilocode** — **Auto mode** as a surgical permission-rule override (wildcard allow + specific denies, evaluated by `findLast`), **mode-based model variants** (server-driven auto-model routing per agent mode), and an **MCP marketplace** with scoped installs (project vs global).

Total unique, portable patterns identified: 52. Most are low-to-medium effort (under 400 LOC each) and genuinely additive to WOTANN's existing pipeline.

---

## 1. Archon — coleam00/Archon

### Local path
`/Users/gabrielvuksani/Desktop/agent-harness/research/archon`

### Repo profile
- Remote Agentic Coding Platform — control Claude Agent SDK / Codex SDK remotely via Slack/Telegram/GitHub/CLI/Web.
- Bun + TypeScript + SQLite/PostgreSQL monorepo.
- Strict package split: `@archon/paths` → `@archon/git` → `@archon/providers` → `@archon/isolation` → `@archon/workflows` → `@archon/core` → `@archon/adapters` → `@archon/server` → `@archon/web`.
- Stated core claim from docs: *"Archon makes your AI coding assistant predictable. Not by limiting it — by giving it a process to follow."*
- Architecture primitive: **workflow = YAML DAG of commands**, where each node is a `command:` (named markdown prompt file), `prompt:` (inline), `bash:`, `loop:`, `approval:`, or `script:`.

### ⚠ Note on assigned "contextual embeddings" / "code_examples index"
The agent scoped grep found **zero** matches for `contextual_embedding`, `contextual.embedding`, or `code_examples` in the current `coleam00/Archon` clone. The CLAUDE.md at repo root explicitly describes Archon as a **"Remote Agentic Coding Platform"** (not a RAG system). The task assignment brief describing this repo as "contextual embeddings +30-50% recall, code_examples index" appears to match the **earlier** Archon versions (v1/v2, which were RAG-focused MCP server with contextual embeddings via `openai.AsyncOpenAI` + pgvector). The current commit of this clone is the v3+ rewrite: a Slack/Telegram/GitHub adapter harness with a YAML DAG workflow engine. **The valuable patterns from this clone are the workflow engine, the isolation resolver, and the platform adapter trilogy** — which are entirely different and still highly portable. I flag this so the parent audit agent is not confused when re-reading.

### Patterns extracted

#### PATTERN 1 — Topological-layer DAG executor with Kahn's algorithm

**Source**: `packages/workflows/src/dag-executor.ts:405-445` (`buildTopologicalLayers`).

```typescript
// Layer 0: nodes with no dependencies.
// Layer N: nodes whose dependencies are all in layers 0..N-1.
// Cycle detection: if sum of layer sizes < nodes.length, cycle exists.
```

Uses `Map<string, number>` for in-degree counts, rebuilds `ready` list each iteration from `dependents` map. Independent nodes in the same layer run **concurrently via `Promise.allSettled`** (lines 805-1025). Runtime safety check at end catches cycles that escaped load-time validation.

**Diff vs WOTANN**: `src/orchestration/wave-executor.ts` executes tasks in **pre-declared "waves"** (a list-of-lists). The wave itself is handcrafted by the caller, not derived from a dependency graph. WOTANN's `workflow-dag.ts` builds a DAG but does **not** build topological layers with concurrent per-layer execution. Archon's approach is strictly superior when waves have complex internal dependency structures.

**Port**: 170 LOC. Add `buildTopologicalLayers` helper + reuse existing `wave-executor` per-layer engine.

---

#### PATTERN 2 — Four explicit trigger rules with deterministic semantics

**Source**: `packages/workflows/src/dag-executor.ts:363-395` (`checkTriggerRule`).

Four documented rules:
- `all_success` — all deps completed (default, fail-fast)
- `one_success` — any dep completed
- `none_failed_min_one_success` — 0 failed AND ≥1 completed (lets failures degrade gracefully)
- `all_done` — all deps settled (not pending/running) regardless of success

Each is a pure function of upstream `NodeOutput.state` values. `skip` is distinct from `failed` — downstream nodes can gate on both.

**Diff vs WOTANN**: WOTANN's `wave-executor.ts` has only "skip if failed" or "fail if any failed". No configurable join semantics. `graph-dsl.ts` has `if`/`onSuccess`/`onFailure` edges, but those are point-to-point, not aggregate join rules.

**Port**: 45 LOC. Add `TriggerRule` enum + `checkTriggerRule` fn + `trigger_rule:` YAML field.

---

#### PATTERN 3 — `when:` expression evaluator for DAG nodes

**Source**: `packages/workflows/src/condition-evaluator.ts:146-173` (`evaluateCondition`).

Mini-DSL supporting:
- `$nodeId.output == 'X'` / `!=` / `<` / `<=` / `>` / `>=`
- Dot access: `$classify.output.type == 'BUG'` (JSON-parses the output)
- Compound: `&&` / `||` with AND-higher-precedence, no parens
- Fail-closed: parse errors → `false` (skip node)
- Quote-aware split (`splitOutsideQuotes`) so `||` inside `'...'` is not split

Regex-based parser (line 87-88):
```typescript
/^\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?\s*(==|!=|<=|>=|<|>)\s*'([^']*)'$/
```

**Diff vs WOTANN**: `graph-dsl.ts` has condition predicates but they are JavaScript functions, not a declarative YAML-safe DSL. For user-edited YAML workflows, a declarative DSL is mandatory.

**Port**: 170 LOC. Straightforward translation.

---

#### PATTERN 4 — `$node_id.output` and `$node_id.output.field` substitution with bash-safe escaping

**Source**: `packages/workflows/src/dag-executor.ts:198-232` (`substituteNodeOutputRefs`).

Regex: `/\$([a-zA-Z_][a-zA-Z0-9_-]*)\.output(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g`

Two modes:
- AI/command prompts: raw string substitution (no quoting)
- Bash scripts: wraps in `shellQuote(value)` — replaces `'` → `'\''` for safe embedding in `bash -c`

JSON field-access via `JSON.parse(nodeOutput.output)`. Unknown nodes log a warning and return `''` (not `undefined`).

**Diff vs WOTANN**: WOTANN has `workflow-dag.ts` but no cross-node output reference mechanism — data flow is reconstructed from in-memory graphs. Archon's approach enables user-editable YAML DAGs referencing prior nodes with zero code.

**Port**: 75 LOC.

---

#### PATTERN 5 — IsolationResolver's 6-step priority decision tree

**Source**: `packages/isolation/src/resolver.ts:88-191` (`IsolationResolver.resolve`).

Six-step priority:
1. Existing environment ID (from conversation state) — checks `worktreeExists`
2. No codebase → `{ status: 'none', cwd: '/workspace' }`
3. Workflow reuse — same `(codebase, workflowType, workflowId)`
4. Linked issue sharing — cross-conversation reuse via `findActiveByWorkflow(codebaseId, 'issue', issueNum)`
5. PR branch adoption — scan for existing worktree already on the PR branch
6. Create new worktree

Each path verifies **canonical repo ownership** via `verifyWorktreeOwnership` before adopting, preventing cross-clone contamination.

**Diff vs WOTANN**: `worktree-kanban.ts` creates worktrees but has no reuse logic. No path for "user opens a GitHub PR mention → adopt existing worktree on that branch if present".

**Port**: 400 LOC. Depends on WOTANN already having a worktree manager.

---

#### PATTERN 6 — Worktree ownership verification via canonical repo path

**Source**: `packages/isolation/src/resolver.ts:260-275` (`assertWorktreeOwnership`) + `packages/git/src/worktree.ts`.

Before adopting an on-disk worktree, calls `getCanonicalRepoPath(codebase.defaultCwd)` and `verifyWorktreeOwnership(worktreePath, canonicalRepoPath)`. On mismatch, throws — the DB row belongs to a different clone of the same remote, and adopting it would create stale FS state.

**Diff vs WOTANN**: None. WOTANN has no such cross-clone safety net.

**Port**: 60 LOC.

---

#### PATTERN 7 — Capability warning layer for provider-feature fallback

**Source**: `packages/workflows/src/dag-executor.ts:275-318` (`resolveNodeProviderAndModel`).

Table-driven check of `ProviderCapabilities` keys (`toolRestrictions`, `hooks`, `mcp`, `skills`, `effortControl`, `thinkingControl`, `costControl`, `fallbackModel`, `sandbox`, `envInjection`). When a user sets a field (e.g. `sandbox:`) but the resolved provider doesn't support it, a **one-shot warning message** is sent to the platform naming the unsupported features:

```
Warning: Node 'X' uses sandbox, thinking but openai doesn't support them — these will be ignored.
```

**Diff vs WOTANN**: `provider-router.ts` has a router but no per-feature capability warnings. Users silently lose features.

**Port**: 90 LOC. Requires a `ProviderCapabilities` typed object per provider.

---

#### PATTERN 8 — Idle timeout wrapper for streaming node execution

**Source**: `packages/workflows/src/utils/idle-timeout.ts` (`withIdleTimeout`) used at `dag-executor.ts:589-600` and `1579-1586`.

Pattern: wrap an async iterator with a per-message idle timer. If no message arrives within `STEP_IDLE_TIMEOUT_MS`, fire the callback (which aborts the controller). Handles the critical failure mode of a provider silently stalling mid-stream.

```typescript
for await (const msg of withIdleTimeout(
  aiClient.sendQuery(prompt, cwd, resumeId, options),
  effectiveIdleTimeout,
  () => { nodeIdleTimedOut = true; nodeAbortController.abort(); }
)) { ... }
```

**Diff vs WOTANN**: Runtime uses plain `for await (const msg of ...)` with no per-message idle detection. A hung provider hangs the run indefinitely.

**Port**: 50 LOC.

---

#### PATTERN 9 — Classify-and-retry with FATAL-priority pattern matching

**Source**: `packages/workflows/src/executor-shared.ts` (`classifyError`, `detectCreditExhaustion`) referenced at `dag-executor.ts:140-142`.

`classifyError(err)` returns `'TRANSIENT'` | `'FATAL'` | `'UNKNOWN'`. FATAL patterns (auth, permission, credits) take priority over TRANSIENT patterns — so "unauthorized: process exited with code 1" is NOT retried even though "process exited" looks transient.

Retry config per-node: `max_attempts` / `delay_ms` / `on_error: 'transient' | 'all'`.

**Diff vs WOTANN**: No documented error classification with FATAL-priority semantics. `provider-router.ts` has retry but does not distinguish credit exhaustion from network timeout.

**Port**: 80 LOC.

---

#### PATTERN 10 — Loop node with completion-tag-based early stop

**Source**: `packages/workflows/src/dag-executor.ts:1488-1790` (loop iteration), `executor-shared.ts` (`detectCompletionSignal`, `stripCompletionTags`).

Iterative AI prompt runs up to `max_iterations` times. Each iteration's output is scanned for a completion tag (e.g., `<done />`). When found, the loop breaks early. `fresh_context: true` opts out of session resumption (re-starts context each iteration). Cumulative cost/token tracking across iterations.

**Diff vs WOTANN**: `ralph-mode.ts` has loop logic but no completion-tag convention. `autopilot` runs to a token budget, not a semantic stop signal.

**Port**: 200 LOC.

---

#### PATTERN 11 — Fork-session semantics on resume for safe retries

**Source**: `packages/workflows/src/dag-executor.ts:577-583`.

```typescript
const shouldForkSession = resumeSessionId !== undefined;
const nodeOptionsWithAbort = {
  ...nodeOptions,
  abortSignal: nodeAbortController.signal,
  ...(shouldForkSession ? { forkSession: true } : {}),
};
```

When resuming from a prior session, `forkSession: true` tells the provider to create a child session that can be discarded on retry failure — the source session is untouched. This makes the retry path safe even if the child session corrupts its context.

**Diff vs WOTANN**: `self-healing-pipeline.ts` retries but mutates the live session. A corrupted retry pollutes subsequent turns.

**Port**: 30 LOC. Requires provider SDK support (Claude Agent SDK has `forkSession`; Codex may not — capability-gate it).

---

## 2. Deer-Flow — bytedance/deer-flow

### Local path
`/Users/gabrielvuksani/Desktop/agent-harness/research/deer-flow`

### Repo profile
- LangGraph-based AI super agent system. Backend = LangGraph Server (2024) + Gateway API (8001) + Frontend (Next.js, 3000) + Nginx (2026) reverse proxy.
- Dual runtime modes: Standard (LangGraph Server) vs Gateway (embedded `RunManager`).
- Strict **harness/app split** enforced by `tests/test_harness_boundary.py` CI check — `deerflow.*` never imports `app.*`.
- Core primitive: **LangGraph agent + 18-middleware chain + per-thread virtual-path sandbox**.

### Middleware chain — WOTANN comparison

Deer-flow has **18 middlewares** in the lead agent's chain, ordered strictly (from `agents/lead_agent/agent.py` + `tool_error_handling_middleware.py`):

1. ThreadDataMiddleware — creates `backend/.deer-flow/threads/{thread_id}/user-data/{workspace,uploads,outputs}`
2. UploadsMiddleware — tracks newly-uploaded files, injects them into the conversation
3. SandboxMiddleware — acquires sandbox, stores `sandbox_id` in state
4. DanglingToolCallMiddleware — patches AIMessage tool_calls that lack responses (e.g., due to user interrupt)
5. LLMErrorHandlingMiddleware — normalizes provider/model invocation failures into recoverable assistant errors
6. **GuardrailMiddleware** (optional, if configured) — pluggable `GuardrailProvider` protocol, built-in `AllowlistProvider`, OAP policy providers supported
7. **SandboxAuditMiddleware** — audits sandboxed shell/file operations for security logging
8. ToolErrorHandlingMiddleware — converts tool exceptions to error `ToolMessage`s
9. DeerFlowSummarizationMiddleware (optional) — context reduction with `BeforeSummarizationHook` (memory flush hook runs before)
10. TodoMiddleware (optional, plan_mode) — `write_todos` tool for task tracking
11. TokenUsageMiddleware (optional) — records token usage metrics
12. **TitleMiddleware** — auto-generates thread title after first exchange
13. MemoryMiddleware — queues conversation for async memory update (only user + final AI)
14. **ViewImageMiddleware** (conditional on `supports_vision`) — injects base64 image data before LLM
15. **DeferredToolFilterMiddleware** — hides deferred tool schemas from bound model
16. SubagentLimitMiddleware (optional, subagent_enabled) — truncates excess `task` tool calls to `MAX_CONCURRENT_SUBAGENTS`
17. LoopDetectionMiddleware — two-layer hash+frequency detection
18. ClarificationMiddleware — intercepts `ask_clarification` and interrupts via `Command(goto=END)` (always last)

### Diff against WOTANN's 25-layer pipeline

**Classes in deer-flow NOT in WOTANN** (6 distinct):

1. **GuardrailMiddleware with pluggable provider** (see Pattern 12 below) — WOTANN has `guardrail` mentioned in pipeline but it's a built-in check, not pluggable with `GuardrailProvider` protocol.
2. **DanglingToolCallMiddleware** — patches AIMessage whose tool_calls lack ToolMessage responses. WOTANN's `tool-pair-validator.ts` is adjacent but validates pairs at execution, not patches missing responses after interrupt. Different failure mode.
3. **LLMErrorHandlingMiddleware** — distinct from ToolErrorHandling. Catches provider invocation failures (400/500/rate-limit) and converts to `ToolMessage` so the conversation can continue instead of raising. WOTANN has `provider-router` retry, not a ToolMessage-substitute layer.
4. **SandboxAuditMiddleware** — security logging of bash/file operations in the sandbox. WOTANN has no audit-log middleware in the pipeline.
5. **TitleMiddleware** — auto-titles the thread after first exchange, normalizes structured content before prompting the title model. WOTANN has no thread-title auto-generation.
6. **DeferredToolFilterMiddleware** — hides deferred tool schemas until tool search is enabled. WOTANN's tool search flag exists (`intelligence/tool-search.ts`) but no middleware that filters schemas from the bound model based on it.

**Classes in WOTANN NOT in deer-flow** (substantial): tool-pair-validator (different angle than dangling-tool-call), intent-gate, output-truncation, frustration, plan-enforcement, verification-enforcement, auto-install, stale-detection, non-interactive, self-reflection, pre-completion-checklist, system-notifications — 12 layers. WOTANN is more opinionated about agent behavior correctness; deer-flow is more focused on platform integration + infra safety.

### Patterns extracted

#### PATTERN 12 — Pluggable guardrail provider with `fail_closed` and `passport`

**Source**: `packages/harness/deerflow/guardrails/middleware.py` + `config/guardrails_config.py` + `agents/middlewares/tool_error_handling_middleware.py:97-119`.

Guardrails are built into the middleware chain only if `guardrails.enabled` in config. The provider class path is resolved via `reflection.resolve_variable` — so users plug in:
- Built-in `AllowlistProvider` (zero deps)
- OAP (Open Agent Policy) providers like `aport-agent-guardrails`
- Custom `IGuardrailProvider` subclasses

The middleware calls `provider.evaluate(tool_call)` → returns allow/deny/error ToolMessage.

Framework hint injected automatically (via `inspect.signature`) if the provider's `__init__` accepts a `framework` kwarg — lets shared policy libs know they're running in deer-flow.

`fail_closed` flag: on provider crash, default = deny. `passport` config: passes a signed token with every evaluation.

**Diff vs WOTANN**: Guardrails are baked in. No pluggable provider system.

**Port**: 220 LOC (middleware shell + protocol + allowlist reference impl).

---

#### PATTERN 13 — DanglingToolCallMiddleware to patch interrupted tool sequences

**Source**: `packages/harness/deerflow/agents/middlewares/dangling_tool_call_middleware.py`.

Behavior: on each iteration, scan messages for any `AIMessage` whose `tool_calls` field has entries with no matching `ToolMessage`. Inject placeholder `ToolMessage(status="error", content="Tool call was interrupted")` for each dangling call. Preserves raw provider tool-call payloads in `additional_kwargs["tool_calls"]` for debugging.

Critical for recovering from user-requested interrupts mid-tool-execution — without this, the next LLM call crashes on schema validation.

**Diff vs WOTANN**: `tool-pair-validator.test.ts` validates at execution time, but doesn't repair AIMessage histories after an interrupt.

**Port**: 70 LOC.

---

#### PATTERN 14 — LLMErrorHandlingMiddleware to normalize provider errors into ToolMessages

**Source**: `packages/harness/deerflow/agents/middlewares/llm_error_handling_middleware.py`.

When the underlying provider `invoke()` raises (rate limit, invalid model, context overflow), instead of bubbling the exception (which would kill the graph), the middleware catches, converts to a `ToolMessage(status='error', content=...)` attached to any prior AIMessage, and returns a new state that lets the graph step continue. The LLM sees the error in its next turn and can adapt.

**Diff vs WOTANN**: Provider-router retries but does not convert persistent provider errors into LLM-visible errors. This lets the agent self-recover via prompt-level reasoning.

**Port**: 100 LOC.

---

#### PATTERN 15 — Virtual path abstraction (`/mnt/user-data/*`) with bi-directional masking

**Source**: `packages/harness/deerflow/sandbox/tools.py:396-460` (`replace_virtual_path`, `_thread_virtual_to_actual_mappings`, `_thread_actual_to_virtual_mappings`, `mask_local_paths_in_output`).

**Agent-facing**: `/mnt/user-data/workspace`, `/mnt/user-data/uploads`, `/mnt/user-data/outputs`, `/mnt/skills`, `/mnt/acp-workspace`.

**Physical**: `backend/.deer-flow/threads/{thread_id}/user-data/...`, `deer-flow/skills/`, `{base_dir}/threads/{thread_id}/acp-workspace/`.

Bidirectional translation:
- **Input direction** (`replace_virtual_path`): longest-prefix-first substitution, segment-boundary aware (`/mnt/user-data/workspace/a` maps to `{workspace_path}/a` only if match is at a path segment boundary).
- **Input direction for bash** (`replace_virtual_paths_in_command`): scans the command string with `_ABSOLUTE_PATH_PATTERN` regex, substitutes each virtual path with its physical path.
- **Output direction** (`mask_local_paths_in_output`): replaces physical paths with virtual paths in tool output before the agent sees them — prevents path leakage.

```python
# The agent never sees the physical path. bash tool output like
# "/Users/gabriel/.deer-flow/threads/abc-123/user-data/workspace/foo.py"
# is masked back to "/mnt/user-data/workspace/foo.py" before the LLM reads it.
```

Skills path masking treats host path + resolved path as separate variants (`Path(skills_host)` vs `Path(skills_host).resolve()`) so symlinked skill dirs work.

**Diff vs WOTANN**: `sandbox/` has risk classification and permission resolution. `computer-use/` has perception. But no **agent-facing virtual path abstraction** with output masking. A physical path like `/Users/gabriel/.wotann/threads/xyz` leaks into every tool output the LLM sees — hurting context efficiency and leaking host info.

**Port**: 400 LOC. High ROI.

---

#### PATTERN 16 — Per-(sandbox, virtual-path) file-operation lock

**Source**: `packages/harness/deerflow/sandbox/file_operation_lock.py` + used in `tools.py`.

Same-path serialization scoped to `(sandbox.id, path)` — so isolated sandboxes do not contend on identical virtual paths within a single process. Prevents concurrent `str_replace` or `write_file` from losing updates in parallel subagent scenarios.

**Diff vs WOTANN**: No fine-grained per-path lock. Concurrent `Edit` calls from subagents can race.

**Port**: 80 LOC.

---

#### PATTERN 17 — Dual thread pool for subagent scheduling + execution

**Source**: `packages/harness/deerflow/subagents/executor.py:73-80`.

```python
_scheduler_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="subagent-scheduler-")
_execution_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="subagent-exec-")
_isolated_loop_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="subagent-isolated-")
```

Three separate pools:
- **Scheduler pool**: accepts `execute_async` submissions, manages timeouts, handles cleanup.
- **Execution pool**: actually runs the subagent's `asyncio.run(self._aexecute(...))`.
- **Isolated loop pool**: when called from inside a running event loop (parent agent is async), executes in a brand-new event loop in a separate thread to avoid shared-httpx-client conflicts.

This three-pool design prevents the scheduler from blocking when execution is saturated, and handles the nasty sync/async boundary at the parent-subagent interface.

**Diff vs WOTANN**: `orchestration/coordinator.ts` + `wave-executor.ts` use plain `Promise.all` — no thread pool partitioning, no isolated-loop fallback. In practice, TypeScript doesn't have the same event-loop-in-thread pattern, but the **scheduling discipline** — separating "submission/timeout/cleanup" from "actual execution" pools — is portable to async concurrency slots + worker pools.

**Port**: 120 LOC.

---

#### PATTERN 18 — Cooperative cancellation via `cancel_event` threading.Event

**Source**: `packages/harness/deerflow/subagents/executor.py:252-272, 516-520`.

Subagents can't be force-killed (`Future.cancel()` on a thread-pool future doesn't interrupt the executing thread). Pattern:
- Each `SubagentResult` has a `threading.Event` named `cancel_event`.
- The `_aexecute` loop checks `cancel_event.is_set()` between each `agent.astream()` chunk.
- On timeout or explicit cancel, `cancel_event.set()` is called and the Future is marked cancelled.
- Subagent stops at the next chunk boundary (typically within 1-2 seconds).

Long-running tool calls within a single chunk are NOT interrupted — documented limitation.

**Diff vs WOTANN**: Subagents run under `Promise.all` with no cooperative-cancel protocol. Timeout just aborts the Promise but the underlying subprocess keeps running (leaking resources).

**Port**: 60 LOC + caller refactoring.

---

#### PATTERN 19 — Memory system with fact extraction, whitespace-normalized dedup, atomic I/O

**Source**: `packages/harness/deerflow/agents/memory/updater.py` + `queue.py` + `prompt.py`.

Three-component memory subsystem:
- **Updater**: LLM call extracts `{context, facts}` from a conversation. Each fact has `{id, content, category ∈ {preference, knowledge, context, behavior, goal}, confidence ∈ [0, 1], createdAt, source}`.
- **Queue**: debounced per-thread — if updates come within 30s, only the last one runs. Prevents thrashing.
- **Atomic I/O**: temp file + rename to avoid partial writes corrupting `memory.json`.
- **Dedup**: whitespace-normalized fact-content comparison before append — so "  X is Y  " and "X is Y" collapse.

Data split into **user context** (`workContext`, `personalContext`, `topOfMind`), **history** (`recentMonths`, `earlierContext`, `longTermBackground`), and discrete **facts**.

Next interaction injects **top 15 facts + context** into `<memory>` tags in the system prompt, capped at `max_injection_tokens` (2000).

**Diff vs WOTANN**: `memory/` uses SQLite+FTS5 with generic observations. No typed categories (preference/knowledge/context/behavior/goal), no confidence scoring, no LLM-based fact extraction with dedup. WOTANN's memory is full-text but not structured.

**Port**: 350 LOC — substantial but tractable.

---

#### PATTERN 20 — Plan mode via `config.configurable.is_plan_mode`

**Source**: `packages/harness/deerflow/agents/lead_agent/agent.py:90-202` (`_create_todo_list_middleware`).

Runtime flag in `RunnableConfig.configurable` toggles whether `TodoListMiddleware` is added to the chain. When `is_plan_mode: true`, agent gets `write_todos` tool + embedded instructions about when/when-not-to use it. When `false`, the middleware is omitted — zero token cost.

**Diff vs WOTANN**: `orchestration/plan-store.ts` is always present. Token cost is always paid.

**Port**: 40 LOC. Requires runtime config flag threading.

---

#### PATTERN 21 — LoopDetectionMiddleware with two detection layers (hash-based + frequency-based)

**Source**: `packages/harness/deerflow/agents/middlewares/loop_detection_middleware.py`.

Two layers:
- **Layer 1 (Hash)**: MD5 hash of `(name, salient_args_key)` per tool call, multiset-sorted so call permutations collide. Windowed (size 20). Warn at ≥3 identical hashes in window, hard-stop at ≥5.
- **Layer 2 (Frequency)**: cumulative per-thread per-tool-type count. Warn at 30 calls to same tool, hard-stop at 50. Catches cross-file read loops (30 different `read_file` calls with 30 different paths) that hash-based detection misses.

**Salient-args key** (line 65-105):
- `read_file`: bucket by `(path, start_line_bucket, end_line_bucket)` with 200-line buckets so re-reads of adjacent ranges collide.
- `write_file` / `str_replace`: hash full args (content-sensitive, because iterating updates are expected to differ).
- Others: extract `path | url | query | command | pattern | glob | cmd` fields, hash those.

Per-thread LRU eviction when tracking exceeds 100 threads.

Hard-stop behavior: strips `tool_calls` from the last AIMessage, clears `additional_kwargs.tool_calls`, clears `response_metadata.finish_reason = "tool_calls"`, appends text explaining the stop — forces the agent to produce a final text answer.

**Diff vs WOTANN**: `middleware/doom-loop.ts` uses Jaccard trigram similarity (different technique — catches near-identical args). Deer-flow's hash+frequency is **simpler and covers different patterns** (exact repeat, and cross-file loops). These are complementary — combined detection is strictly better than either.

**Port**: 350 LOC. Combine with WOTANN's existing `doom-loop.ts` into a three-layer detector.

---

#### PATTERN 22 — SandboxAuditMiddleware for security logging

**Source**: `packages/harness/deerflow/agents/middlewares/sandbox_audit_middleware.py` + `sandbox/middleware.py`.

Intercepts `bash` / `write_file` / `str_replace` tool calls BEFORE execution. Logs to a dedicated audit log:
- `timestamp, thread_id, sandbox_id, tool_name, command/path, allowed=true|false`

Does NOT block; purely observational. Integrates with `is_host_bash_allowed` security check to escalate host-bash attempts (when agent tries to run `/bin/rm -rf ~/...`).

**Diff vs WOTANN**: `telemetry/audit-trail.ts` exists but is a general event log, not specifically scoped to sandbox operations.

**Port**: 90 LOC. Plug into existing telemetry.

---

#### PATTERN 23 — Thread auto-title generation with normalized structured content

**Source**: `packages/harness/deerflow/agents/middlewares/title_middleware.py`.

After the first complete user-assistant exchange (not streaming chunks), runs a lightweight model call to generate a short thread title. Handles two edge cases:
- **Structured content**: if assistant reply has `content` as a list of content blocks (Anthropic thinking mode), normalizes to plain text before prompting the title model. Otherwise the title call fails.
- **Max words / max chars**: configurable, truncates long titles.

Result stored in `state["title"]` via custom reducer.

**Diff vs WOTANN**: No thread-title generation. User sees "Thread abc-123" in UI.

**Port**: 90 LOC.

---

#### PATTERN 24 — DeferredToolFilterMiddleware hides tool schemas until enabled

**Source**: `packages/harness/deerflow/agents/middlewares/deferred_tool_filter_middleware.py`.

When `tool_search.enabled = true` in config, some tools are marked "deferred" — their schemas are hidden from the model until the agent explicitly opts in (via a meta-tool like `enable_tool_search`). Reduces token consumption on system prompt by deferring hundreds of potential tool schemas.

**Diff vs WOTANN**: `intelligence/tool-search.ts` / `skills/` use progressive disclosure for skills but not for raw tool schemas. WOTANN's 65+ skills inject into the system prompt as metadata; the **schemas** of every bound tool are sent with every API call.

**Port**: 120 LOC. Big token-cost win.

---

#### PATTERN 25 — Harness/app import firewall (enforced by CI test)

**Source**: `backend/tests/test_harness_boundary.py`.

The `packages/harness/deerflow/` directory (the publishable agent framework) must **never** import from `app/` (the unpublished FastAPI + channel code). The test file walks every `.py` under harness, parses imports, and fails CI if any `from app.` or `import app.` appears.

Encoded as:
```python
# Forbidden: from app.gateway.routers.uploads import ...
# Allowed: from deerflow.config import get_app_config
```

**Diff vs WOTANN**: Directory structure suggests this discipline exists (`core/` vs `channels/`, `daemon/` vs `cli/`) but no CI-enforced boundary check. A future refactor could accidentally introduce `core/ -> cli/` coupling.

**Port**: 80 LOC. One lint test script.

---

## 3. Deepagents — langchain-ai/deepagents

### Local path
`/Users/gabrielvuksani/Desktop/agent-harness/research/deepagents`

### Repo profile
- LangChain's reference "Deep Agent" implementation — `create_deep_agent(model, tools, ...)` builds a LangGraph agent with planning, filesystem, subagents, summarization, skills, memory, permissions.
- Default model: `claude-sonnet-4-6` (Anthropic).
- Monorepo: `libs/deepagents` (core), `libs/deepagents-cli`, `libs/deepagents-acp`, `libs/deepagents-repl`, `examples/`.
- Philosophy: "trust-the-model" — minimal agent-side prompting, let the model decide when to use skills, todos, summarization.

### Patterns extracted

#### PATTERN 26 — `_HarnessProfile` system for model-specific middleware attachment

**Source**: `libs/deepagents/deepagents/profiles.py` + `graph.py:133-160` (`_harness_profile_for_model`).

Each provider/model string (e.g., `"openai:gpt-5"`, `"anthropic:claude-opus-4.7"`, `"openrouter:deepseek"`) resolves to a `_HarnessProfile` dataclass that carries:
- `base_system_prompt` (overrides the default BASE_AGENT_PROMPT)
- `system_prompt_suffix` (appended after the base)
- `extra_middleware` — list of middleware (or a `Callable` factory) that attaches ONLY for this model family
- `tool_description_overrides: dict[str, str]` — rewrites descriptions of specific tools (e.g., OpenAI's `task` needs a different description than Anthropic's)
- `excluded_tools` — names of tools stripped before the model sees them

Lookup chain: (1) full identifier `"openai:gpt-5"`, (2) provider-only `"openai"`, (3) default empty profile.

Profile applied identically to main agent AND subagents (each subagent resolves its own profile if it has a different model).

**Diff vs WOTANN**: `providers/` has per-provider adapters but no **profile** concept attaching different middleware/tool-descriptions/excluded-tools per model identifier. All 11 providers get the same middleware pipeline regardless of family.

**Port**: 200 LOC. Very high leverage — each provider maintainer can now customize per-model behavior in one place.

---

#### PATTERN 27 — Tiered middleware assembly with strict documented ordering

**Source**: `libs/deepagents/deepagents/graph.py:281-305` (docstring) + `551-598` (implementation).

Three tiers:
- **Base stack**: `TodoListMiddleware`, `SkillsMiddleware` (if sources), `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, `PatchToolCallsMiddleware`, `AsyncSubAgentMiddleware` (if async subagents).
- **User middleware**: inserted between base and tail.
- **Tail stack**: `extra_middleware` (profile-specific), `_ToolExclusionMiddleware` (if profile excludes tools), `AnthropicPromptCachingMiddleware` (unconditional, no-ops for non-Anthropic), `MemoryMiddleware` (if memory sources), `HumanInTheLoopMiddleware` (if interrupt_on), `_PermissionMiddleware` (if permissions, **always last**).

Rationale for ordering:
- Permissions last so they see all tools from prior middleware.
- Prompt caching after user middleware but before memory (memory updates invalidate cache prefix).
- Tool exclusion after all tool-injecting middleware.

**Diff vs WOTANN**: 25-layer pipeline is flat — no tier concept. New middleware insertion requires knowing the full context.

**Port**: 150 LOC. Reorganize the pipeline definition into tiers.

---

#### PATTERN 28 — Per-subagent permission inheritance with override semantics

**Source**: `libs/deepagents/deepagents/graph.py:497` + `middleware/permissions.py`.

Subagents inherit the parent's `permissions: list[FilesystemPermission]` by default. If a subagent spec includes its own `permissions`, those **replace** the parent's rules entirely (not merge). Rationale: merging permission rules is subtle and error-prone; an explicit full replace is clearer.

The permission middleware is added last in each subagent's chain so it sees every tool — including tools injected by `FilesystemMiddleware` and `SubAgentMiddleware`.

**Diff vs WOTANN**: `sandbox/risk-classification.ts` has rules but no subagent inheritance pattern. No `permissions` parameter on `SubAgent` spec.

**Port**: 100 LOC.

---

#### PATTERN 29 — `AnthropicPromptCachingMiddleware` applied unconditionally with silent no-op for other providers

**Source**: `graph.py:462, 520, 591` + `langchain_anthropic.middleware.AnthropicPromptCachingMiddleware`.

Pattern: `AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")` is added to **every** agent's middleware chain regardless of which model is resolved. For non-Anthropic models it no-ops silently (no config mutation, no warnings, no error). For Anthropic models it activates prompt caching.

This keeps the chain construction code uniform — no `if model_provider == 'anthropic'` branches.

**Diff vs WOTANN**: Providers may have provider-specific middleware conditionally applied via branches. The "universal middleware with silent no-op" pattern is cleaner.

**Port**: trivial. 20 LOC — document the pattern + apply to provider-specific middleware.

---

#### PATTERN 30 — CompiledSubAgent vs SubAgent vs AsyncSubAgent three-form spec

**Source**: `libs/deepagents/deepagents/middleware/subagents.py` + `async_subagents.py`.

Subagent registration accepts three polymorphic forms:
- **`SubAgent`** (declarative): `{name, description, system_prompt, tools?, model?, middleware?, skills?, permissions?, interrupt_on?}` — compiled at agent build time.
- **`CompiledSubAgent`** (opaque): `{name, description, runnable}` — user provides a pre-compiled `Runnable`, useful for reusing existing LangGraph graphs.
- **`AsyncSubAgent`** (remote/background): `{name, description, graph_id, url?, headers?}` — routed via `AsyncSubAgentMiddleware` instead of `SubAgentMiddleware`. Runs as a background task exposing async subagent tools (launch/check/update/cancel/list).

Routing disambiguation (line 481-487): the discriminator keys are `"graph_id"` (async) vs `"runnable"` (compiled) vs neither (declarative). Clean pattern matching.

**Diff vs WOTANN**: `orchestration/agent-registry.ts` has agent specs but doesn't split synchronous-declarative vs opaque-compiled vs remote-async. Third form (remote) isn't represented — WOTANN can't register a LangSmith-deployed agent as a subagent.

**Port**: 200 LOC.

---

#### PATTERN 31 — `_ToolExclusionMiddleware` for post-injection tool stripping

**Source**: `libs/deepagents/deepagents/middleware/_tool_exclusion.py`.

Profile-aware tool exclusion: some models (e.g., GPT-4o with certain configs) don't support specific tools well. Instead of coding conditional tool lists everywhere, the profile declares `excluded_tools: list[str]`, and `_ToolExclusionMiddleware` is added to the chain. It filters the tool list in `before_model` — stripping tools that were injected by earlier middleware (like `SubAgentMiddleware` adding `task`).

**Diff vs WOTANN**: Tool registration is static; no per-model stripping.

**Port**: 70 LOC.

---

#### PATTERN 32 — Progressive disclosure skills with metadata-only system prompt

**Source**: `libs/deepagents/deepagents/middleware/skills.py:560-600`.

Skills system prompt template:
```
## Skills System
{skills_locations}
**Available Skills:**
{skills_list}   ← metadata only (name + description + license/compat)
**How to Use Skills (Progressive Disclosure):**
1. Recognize when a skill applies
2. Read the skill's full instructions: read_file(path, limit=1000)
3. Follow the skill's instructions
4. Access supporting files with absolute paths
```

The system prompt lists the skill **names and descriptions** but NOT their full SKILL.md content. The agent uses `read_file` to fetch the full content on demand. Critical for scaling to 65+ skills without exploding system prompt.

Source loading order matters: `["/skills/base/", "/skills/user/", "/skills/project/"]` — last one wins when names collide.

**Diff vs WOTANN**: `skills/` already does progressive disclosure, but not via a first-class middleware with layered sources. Review reveals WOTANN injects all 65+ skill metadata; similar pattern, but harness does not expose configurable "sources" with priority ordering.

**Port**: 150 LOC (mostly already in WOTANN — port the **layered sources** concept specifically).

---

#### PATTERN 33 — Backend abstraction: State / Filesystem / Sandbox / Store / Composite / LangSmith

**Source**: `libs/deepagents/deepagents/backends/` (8 files).

The agent's file operations are mediated by a `BackendProtocol` with implementations:
- `StateBackend` — in-memory LangGraph state (ephemeral, fast).
- `FilesystemBackend` — real disk under a `root_dir` (persistent).
- `SandboxBackend` — shell execution + filesystem (implements `SandboxBackendProtocol`).
- `StoreBackend` — LangGraph's `BaseStore` (persistent across sessions).
- `CompositeBackend` — chains multiple backends with routing rules.
- `LangsmithSandbox` — LangSmith-hosted sandbox.

Tools like `read_file` / `write_file` / `edit_file` / `glob` / `grep` / `execute` are implemented once and delegated to the backend. Switching storage = swap the backend.

**Diff vs WOTANN**: `sandbox/` has risk classification + executors, but file tools talk to specific implementations (fs vs sandbox) through an ad-hoc split. No `BackendProtocol` abstraction with a clean composition pattern.

**Port**: 500 LOC. High cost but enables remote-sandbox support (e.g., E2B, Daytona) and trivially swappable state for testing.

---

#### PATTERN 34 — PatchToolCallsMiddleware for cross-provider tool-call normalization

**Source**: `libs/deepagents/deepagents/middleware/patch_tool_calls.py`.

Different providers serialize tool calls differently (Anthropic `tool_use` blocks, OpenAI `function_call`, etc.). This middleware normalizes all tool-call shapes into a canonical form before downstream middleware sees them, and denormalizes back on the way out. Downstream middleware (including user-written ones) deals with exactly one shape.

**Diff vs WOTANN**: `providers/format-translator.ts` exists but operates at the API boundary — not as a middleware layer that every subsequent middleware can rely on for normalized access.

**Port**: 120 LOC.

---

## 4. Claude-Task-Master — eyaltoledano/claude-task-master

### Local path
`/Users/gabrielvuksani/Desktop/agent-harness/research/claude-task-master`

### Repo profile
- Task-decomposition CLI + MCP server for breaking PRDs into task lists.
- Monorepo: `packages/tm-core` (business logic), `apps/cli`, `apps/mcp`, `apps/extension` (future VS Code).
- Strict separation rule: "ALL business logic must live in `@tm/core`, NOT in presentation layers."
- Workflow is **not an agent harness** (doesn't run agents directly); it's an orchestrator for Claude Code sessions that generates/tracks tasks.

### Patterns extracted

#### PATTERN 35 — Explicit phase state machine with defined transitions

**Source**: `packages/tm-core/src/modules/workflow/orchestrators/workflow-orchestrator.ts:49-71` + `types.ts`.

Finite state machine with declarative transitions:
```typescript
[
  { from: 'PREFLIGHT',    to: 'BRANCH_SETUP',   event: 'PREFLIGHT_COMPLETE' },
  { from: 'BRANCH_SETUP', to: 'SUBTASK_LOOP',   event: 'BRANCH_CREATED' },
  { from: 'SUBTASK_LOOP', to: 'FINALIZE',       event: 'ALL_SUBTASKS_COMPLETE' },
  { from: 'FINALIZE',     to: 'COMPLETE',       event: 'FINALIZE_COMPLETE' },
]
```

Plus cross-phase events: `ERROR`, `ABORT`, `RETRY`. Each transition has optional `phaseGuards` (context-validation functions).

**Auto-persist callback**: after every valid transition, an optional `persistCallback(state)` fires — enables crash recovery via serialized workflow state.

**Event emitter**: strongly typed events like `tdd:red:completed`, `subtask:completed`, `progress:updated` — user subscribes via `on(eventType, listener)`.

**Diff vs WOTANN**: `orchestration/workflow-dag.ts` is graph-based, not state-machine-based. No explicit phase guards, no typed transition table, no persist callback.

**Port**: 250 LOC.

---

#### PATTERN 36 — Nested TDD phase within SUBTASK_LOOP (RED → GREEN → COMMIT)

**Source**: `workflow-orchestrator.ts:152-220` (`handleTDDPhaseTransition`).

Inside `SUBTASK_LOOP` phase, a sub-state-machine runs per subtask:
- `RED` (write failing test) → `GREEN` (make it pass) → `COMMIT` → next subtask (back to `RED`) OR `ALL_SUBTASKS_COMPLETE`.
- Special path: if test results show 0 failures in RED phase → emit `tdd:feature-already-implemented`, skip GREEN, move to next subtask.
- Test results carried in transition payload: `event.testResults: {passed, failed, ...}` required for `RED_PHASE_COMPLETE`.

**Diff vs WOTANN**: `testing/` has test utilities but no enforced TDD state machine tied to orchestration. `orchestration/spec-to-ship.ts` is closer but doesn't express the RED/GREEN/COMMIT triple as distinct states.

**Port**: 200 LOC. Compose with existing spec-to-ship.

---

#### PATTERN 37 — Tiered MCP tool loading via env var

**Source**: `apps/mcp/.mcp.json` + CLAUDE.md docs.

MCP server accepts `TASK_MASTER_TOOLS` env var:
- `core` (7 tools): `get_tasks, next_task, get_task, set_task_status, update_subtask, parse_prd, expand_task`
- `standard` (14 tools): core + `initialize_project, analyze_project_complexity, expand_all, add_subtask, remove_task, add_task, complexity_report`
- `all` (42+ tools): standard + dependencies, tag management, research, autopilot, scope up/down, models, rules

Users pay context-window cost only for the tier they need. Default = `core`.

**Diff vs WOTANN**: WOTANN ships all MCP tools by default. Provider registry doesn't expose a tiered loading mechanism.

**Port**: 50 LOC. Add `WOTANN_TOOLS` env var + tier-to-tool mapping.

---

#### PATTERN 38 — Testing rule: "unit tests mock only external I/O, integration tests mock only external boundaries"

**Source**: `CLAUDE.md` (test guidelines section).

Explicit policy:
- `@tm/core` **unit tests** (`*.spec.ts`): mock only Supabase, APIs, filesystem. Use real internal services.
- `@tm/core` **integration tests** (`tests/integration/`): use real tm-core, mock only external boundaries.
- **Red flag**: mocking 3+ dependencies in a unit test = code is doing too much (wrong layer).
- **Anti-pattern**: heavily mocked tests verify mock wiring, not real behavior.

**Diff vs WOTANN**: No documented rule. Risk of mock-heavy brittle tests.

**Port**: documentation-only. Adopt the rule in WOTANN's CLAUDE.md and audit existing tests.

---

#### PATTERN 39 — LoopDomain as a preset registry (not a raw loop abstraction)

**Source**: `packages/tm-core/src/modules/loop/` + `loop-domain.ts` + `presets/`.

Loops are not raw `while`/`for` primitives. They are named presets in a registry — each preset is a declarative config (iteration count, stop conditions, side effects) that the loop service instantiates on demand. Separates "what kinds of loops this system supports" from "how to execute them".

**Diff vs WOTANN**: `orchestration/ralph-mode.ts` and `autopilot/` each implement their own loop semantics with hardcoded configs. No preset registry.

**Port**: 120 LOC.

---

## 5. Kilocode — Kilo-Org/kilocode (17.5K⭐)

### Local path
`/Users/gabrielvuksani/Desktop/agent-harness/research/__new_clones/kilocode`

### Repo profile
- Open-source AI coding agent (forked from OpenCode) + VS Code extension + JetBrains plugin + CLI.
- Monorepo: `packages/opencode` (core CLI + runtime), `packages/kilo-vscode`, `packages/kilo-gateway` (AI proxy), `packages/kilo-jetbrains`, `packages/sdk`, `packages/server`.
- Effect-TS based runtime (`Effect`, `Layer`, `Context`).
- Key differentiator: **auto-model** (server-driven mode-based model routing) + **MCP marketplace**.

### Patterns extracted

#### PATTERN 40 — Auto mode as a permission-rule override (wildcard allow + specific denies)

**Source**: `packages/opencode/src/cli/cmd/run.ts:381-397` + `test/cli/auto-mode.test.ts`.

`--auto` flag creates a session with permission ruleset:
```typescript
[
  { permission: "*",        action: "allow", pattern: "*" },   // wildcard allow
  { permission: "question", action: "deny",  pattern: "*" },   // specific deny
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit",  action: "deny", pattern: "*" },
]
```

Evaluation uses `findLast` (line 592 in `evaluate.ts`):
```typescript
const match = rules.findLast(
  (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
);
return match ?? { action: "ask", permission, pattern: "*" };
```

`findLast` semantics: later rules override earlier rules. Adding `{deny, question}` AFTER `{allow, *}` means questions are denied while everything else stays allowed. Order matters and is explicit.

**Auto-approval loop** (line 583-612): when a permission request fires mid-session, if `args.auto`, auto-reply `"once"`; otherwise auto-reply `"reject"` (headless mode cannot prompt user).

**Safety rails**:
- `question` denied → agent can't ask interactive questions (which would block forever).
- `plan_enter` / `plan_exit` denied → agent can't enter plan mode (which requires user decision).
- Retries for network errors (`session.network.asked`): exponential backoff `min(5000 * 2^(retries-1), 60000)` up to `MAX_RETRIES`.

**Diff vs WOTANN**: `autonomy` middleware has risk classification but no **"grant all perms except these specific denies"** one-liner. `autopilot` is more granular.

**Port**: 80 LOC. Add `--auto` CLI flag + preset permission-ruleset.

---

#### PATTERN 41 — Mode-based model variants with server-driven routing

**Source**: `packages/opencode/src/provider/transform.ts` + `provider.ts` + `session/prompt.ts` + `session/llm.ts` + docs at `packages/kilo-docs/pages/contributing/architecture/auto-model-tiers.md`.

Split client-server architecture:
- **Server** (Kilo API at `api.kilo.ai`) defines which underlying models each `kilo-auto/*` tier routes to per mode:
```json
{
  "opencode": {
    "variants": {
      "architect": { "model": "anthropic/claude-opus-4.7", ... },
      "code":      { "model": "anthropic/claude-sonnet-4.6", ... }
    }
  }
}
```
- **Client** caches models with 5-min TTL (`model-cache.ts`), preserves server-defined variants for `kilo` provider, resolves the variant from agent config at prompt time, merges variant options into LLM call.

Four tiers:
- `kilo-auto/frontier` — best paid (mode-varying)
- `kilo-auto/balanced` — GPT 5.3 Codex (same model, all modes)
- `kilo-auto/free` — per-session hash-weighted split across best free models (absorbs free-model churn)
- `kilo-auto/small` — internal, background tasks (titles, summaries), uses paid small or free small based on balance

**Unauthenticated users default to `kilo-auto/free`** — "working experience immediately, no model selection required."

**Diff vs WOTANN**: `providers/` has 11 adapters + router but no **mode-to-model-per-tier** abstraction. WOTANN's tabs (Chat/Editor/Workshop/Exploit) could each map to different optimal models automatically.

**Port**: 300 LOC (client side) + optional server component. The **"default to free for unauthed"** UX pattern is immediate-win.

---

#### PATTERN 42 — MCP marketplace with scoped installs (project vs global)

**Source**: `packages/kilo-vscode/src/services/marketplace/installer.ts` + `api.ts` + `detection.ts` + `types.ts`.

`MarketplaceService` with four sub-services:
- **API client**: fetches marketplace items from Kilo API
- **Paths**: resolves global (`~/.kilocode/`) vs project (`.kilocode/` in workspace)
- **Detection**: scans installed skills/MCPs/modes, reports metadata
- **Installer**: performs install/remove operations

Three item types: `skill`, `mcp`, `mode`. Each installed to either `project` (workspace-local) or `global` (user-level). Conflict detection: refuse to install if already present (must remove first).

MCP installer (`installMcp`):
- Reads config YAML for target scope
- Verifies `config.mcp[item.id]` is not already set
- Parameter substitution: `substituteParams(content, filtered_params)` fills `${API_KEY}` placeholders in the MCP config template
- JSON-parses the result + normalizes via `normalizeMcpEntry`
- Writes back to config

**Diff vs WOTANN**: `marketplace/` + `mcp/` exist but the **scoped install** concept (project vs global) and **parameterized template substitution** are not fully present.

**Port**: 250 LOC.

---

#### PATTERN 43 — Session compaction with prune-protected tool types

**Source**: `packages/opencode/src/session/compaction.ts:33-35, 91-100`.

```typescript
const PRUNE_MINIMUM = 20_000;  // don't prune until this many tokens
const PRUNE_PROTECT = 40_000;  // recent 40k tokens of tool calls stay intact
const PRUNE_PROTECTED_TOOLS = ["skill"];  // never prune these
```

Prune algorithm:
- Walk messages backwards until 40k tokens of tool calls accumulate.
- Older tool call outputs are erased (tool call itself remains, output replaced with summary).
- Certain tool types (`"skill"`) are never pruned (skill metadata injected into prompts is critical context).

Distinct from summarization — this is **lossy output truncation** targeting bulky tool outputs specifically.

**Diff vs WOTANN**: `context/` has 5 compaction strategies but no tool-output-specific pruning with `PRUNE_PROTECTED_TOOLS`.

**Port**: 180 LOC.

---

#### PATTERN 44 — BusEvent pub/sub with typed Zod schemas

**Source**: `packages/opencode/src/bus/bus-event.ts` + usage at `session/compaction.ts:24-31`.

```typescript
BusEvent.define("session.compacted", z.object({ sessionID: SessionID.zod }))
```

Each event:
- String key (`"session.compacted"`)
- Zod schema for payload shape
- Compile-time and runtime validation (emit/subscribe both type-check)

Event names follow `{domain}.{action_past_tense}` convention (`session.compacted`, `permission.asked`, `session.network.asked`).

**Diff vs WOTANN**: `telemetry/` emits events but event shapes aren't Zod-validated at both emit and subscribe sides. Drift is possible.

**Port**: 80 LOC + audit existing event emissions.

---

#### PATTERN 45 — Network retry with exponential backoff per-session

**Source**: `packages/opencode/src/cli/cmd/run.ts:613-631`.

```typescript
if (event.type === "session.network.asked") {
  retries++;
  if (retries > MAX_RETRIES) {
    await sdk.network.reject({ requestID: request.id });
    continue;
  }
  const delay = Math.min(5000 * Math.pow(2, retries - 1), 60000);
  await new Promise((r) => setTimeout(r, delay));
  await sdk.network.reply({ requestID: request.id });
}
```

Session-scoped retry counter. Per-session `MAX_RETRIES` (typically 5). Delay = 5s, 10s, 20s, 40s, 60s (capped).

**Diff vs WOTANN**: `provider-router.ts` retries individual requests but lacks session-scoped retry tracking that spans multiple provider calls in one conversation turn.

**Port**: 50 LOC.

---

#### PATTERN 46 — Provider variant passthrough for non-kilo providers

**Source**: `packages/opencode/src/provider/transform.ts` (variants function).

For the `kilo` provider, variants come from the server response and pass through unchanged to the LLM call. For other providers, variants are computed client-side from local config. The transform layer handles both uniformly so downstream code doesn't branch on provider type.

**Diff vs WOTANN**: Provider-specific handling is scattered. A single transform layer would centralize.

**Port**: 60 LOC.

---

#### PATTERN 47 — Session fork via SDK call (preserve parent, create child)

**Source**: `packages/opencode/src/cli/cmd/run.ts:419-422`.

```typescript
if (baseID && args.fork) {
  const forked = await sdk.session.fork({ sessionID: baseID });
  return forked.data?.id;
}
```

Fork is first-class: parent session untouched, forked child gets its own ID and starts with parent's message history as context. Combines with `--continue` for "continue existing session" or `--session <id>` for "attach to specific session".

**Diff vs WOTANN**: `session` is a runtime concept but no explicit fork API. WOTANN's `forkSession` is a provider-option per-call (see Pattern 11); this is a session-level fork that persists.

**Port**: 120 LOC.

---

#### PATTERN 48 — Cloud session import with error-path fallback

**Source**: `packages/opencode/src/cli/cmd/run.ts:408-417` (`importCloudSession`, `validateCloudFork`).

User can pass `--cloudFork` flag to import a session from the cloud-hosted version of the same app. Cloud import has its own validation path (`validateCloudFork`) that pre-checks before attempting. On import failure, exits with a specific error message. Cross-device session continuity.

**Diff vs WOTANN**: `desktop/bridge-server.ts` has phone↔desktop bridge, but no **cloud session import** for cross-device continuity where neither device holds the session locally.

**Port**: 200 LOC (requires cloud storage infrastructure).

---

#### PATTERN 49 — SKILL.md with agent-skills-spec constraints + backward-compat warning

**Source**: `libs/deepagents/deepagents/middleware/skills.py:209-247` (`_validate_skill_name`) + `260-352` (`_parse_skill_metadata`).

Strict validation per [agentskills.io/specification](https://agentskills.io/specification):
- 1-64 chars
- Unicode lowercase alphanumeric + hyphens
- Must not start/end with `-`, no `--`
- Name must match parent directory
- 10MB max file size (DoS prevention)

**Backward compat**: name validation **warns but continues loading** if invalid (rather than rejecting). Encourages migration to spec-compliant names without breaking existing skills.

`allowed-tools` field: string-only, split on whitespace (with comma-strip for Claude Code compatibility). Non-string values logged and ignored.

**Diff vs WOTANN**: `skills/` loader has its own validation but not explicitly aligned to the agentskills.io spec.

**Port**: 80 LOC. Align WOTANN's skill validator to spec.

---

#### PATTERN 50 — Recursion limit 9999 + metadata tagging on every compiled agent

**Source**: `libs/deepagents/deepagents/graph.py:626-634`.

```typescript
return create_agent(...).with_config({
  "recursion_limit": 9_999,
  "metadata": {
    "ls_integration": "deepagents",
    "versions": { "deepagents": __version__ },
    "lc_agent_name": name,
  },
});
```

Every compiled agent gets:
- **Recursion limit 9999** — effectively unbounded within LangGraph's safety rails.
- **LangSmith integration metadata** — `ls_integration` key lets LangSmith UI group traces by framework. `versions` enables cross-version debugging.

**Diff vs WOTANN**: Recursion limits are per-caller, not always set. No uniform metadata tagging on agent construction. Traces without metadata can't be filtered.

**Port**: 30 LOC. Uniformly apply to all WOTANN agent constructions.

---

## 6. Global Observations — Cross-Repo Patterns

### PATTERN 51 — Three repos converge on "optional middleware driven by config flag"

Archon (capability warnings via `getProviderCapabilities`), deer-flow (plan_mode/subagent_enabled/token_usage config toggles), deepagents (memory/skills/permissions conditional on construction args).

All three share the same technique: **optional middleware added ONLY IF its governing config is present/truthy**. Reduces token cost and per-turn compute when features are off.

**WOTANN state**: pipeline is fixed 25 layers. Partial conditional loading happens (some middleware is on/off via env) but not systematically. Cross-repo consensus argues for a full audit of which WOTANN middleware could be conditionally loaded.

**Port**: 0 LOC of infrastructure; 300 LOC of audit + refactor marking each middleware with `enabledWhen: config => boolean`.

---

### PATTERN 52 — Four repos use explicit per-session/per-thread scoped state maps

Deer-flow (`LoopDetectionMiddleware._history: OrderedDict[thread_id -> list]` + LRU eviction at 100), kilocode (per-session retry counters), deepagents (per-conversation skill load state), archon (per-workflow-run `nodeOutputs: Map<nodeId, NodeOutput>`).

Common practice: **per-thread state is an `OrderedDict` / `Map` keyed by a thread/session ID, with LRU eviction past a memory cap**. The eviction cap prevents the server from growing unbounded as many short-lived threads accumulate.

**WOTANN state**: many places track per-session state via Zustand or module-level Maps, but the LRU-with-cap pattern is inconsistently applied. A shared utility would formalize.

**Port**: 100 LOC shared utility (`ThreadScopedLRU`).

---

## Summary Table — Ported Patterns by Cost

| # | Pattern | Source | Est. LOC | Priority |
|---|---------|--------|----------|----------|
| 1 | Topological-layer DAG w/ Kahn's | archon | 170 | P0 |
| 2 | Four trigger rules | archon | 45 | P1 |
| 3 | `when:` expression DSL | archon | 170 | P1 |
| 4 | `$node.output` substitution | archon | 75 | P1 |
| 5 | IsolationResolver 6-step tree | archon | 400 | P0 |
| 6 | Worktree ownership verification | archon | 60 | P0 |
| 7 | Capability warnings per provider | archon | 90 | P1 |
| 8 | Idle-timeout stream wrapper | archon | 50 | P0 |
| 9 | FATAL-priority error classification | archon | 80 | P1 |
| 10 | Loop node with completion tags | archon | 200 | P2 |
| 11 | Fork-session on resume | archon | 30 | P2 |
| 12 | Pluggable guardrail provider | deer-flow | 220 | P1 |
| 13 | DanglingToolCallMiddleware | deer-flow | 70 | P0 |
| 14 | LLMErrorHandlingMiddleware | deer-flow | 100 | P0 |
| 15 | Virtual path abstraction | deer-flow | 400 | P0 |
| 16 | Per-path file-operation lock | deer-flow | 80 | P1 |
| 17 | Dual thread-pool subagent exec | deer-flow | 120 | P2 |
| 18 | Cooperative cancel via event | deer-flow | 60 | P1 |
| 19 | Memory fact extraction system | deer-flow | 350 | P1 |
| 20 | Plan-mode via runtime config | deer-flow | 40 | P2 |
| 21 | Two-layer loop detection | deer-flow | 350 | P0 |
| 22 | SandboxAuditMiddleware | deer-flow | 90 | P1 |
| 23 | Thread auto-title generation | deer-flow | 90 | P2 |
| 24 | DeferredToolFilter | deer-flow | 120 | P1 |
| 25 | Harness/app import firewall | deer-flow | 80 | P1 |
| 26 | `_HarnessProfile` per-model | deepagents | 200 | P0 |
| 27 | Tiered middleware assembly | deepagents | 150 | P0 |
| 28 | Per-subagent permission inheritance | deepagents | 100 | P1 |
| 29 | Universal middleware w/ silent no-op | deepagents | 20 | P2 |
| 30 | CompiledSubAgent/SubAgent/AsyncSubAgent | deepagents | 200 | P1 |
| 31 | `_ToolExclusionMiddleware` | deepagents | 70 | P1 |
| 32 | Layered skill sources | deepagents | 150 | P2 |
| 33 | Backend protocol (State/FS/Sandbox) | deepagents | 500 | P1 |
| 34 | PatchToolCallsMiddleware | deepagents | 120 | P1 |
| 35 | Explicit phase FSM | task-master | 250 | P1 |
| 36 | Nested TDD (RED/GREEN/COMMIT) | task-master | 200 | P2 |
| 37 | Tiered MCP tool loading | task-master | 50 | P0 |
| 38 | Test-mocking policy (docs) | task-master | 0 | P2 |
| 39 | LoopDomain preset registry | task-master | 120 | P2 |
| 40 | Auto mode permission ruleset | kilocode | 80 | P0 |
| 41 | Mode-based model variants | kilocode | 300 | P0 |
| 42 | MCP marketplace scoped install | kilocode | 250 | P1 |
| 43 | Session compaction w/ protected tools | kilocode | 180 | P1 |
| 44 | BusEvent typed Zod pub/sub | kilocode | 80 | P1 |
| 45 | Network retry exponential backoff | kilocode | 50 | P0 |
| 46 | Provider variant passthrough | kilocode | 60 | P2 |
| 47 | Session fork via SDK call | kilocode | 120 | P1 |
| 48 | Cloud session import | kilocode | 200 | P2 |
| 49 | SKILL.md spec validation | deepagents | 80 | P2 |
| 50 | Recursion-limit 9999 + metadata | deepagents | 30 | P2 |
| 51 | Conditional middleware by config | cross | 300 | P1 |
| 52 | ThreadScopedLRU shared utility | cross | 100 | P1 |

**Totals**: P0 = 13 patterns (~2,860 LOC), P1 = 24 patterns (~3,140 LOC), P2 = 15 patterns (~1,900 LOC).

**Top 10 "do it this week" picks (highest value/LOC ratio)**:
1. #13 — DanglingToolCallMiddleware (70 LOC, fixes interrupt-recovery bug class)
2. #14 — LLMErrorHandlingMiddleware (100 LOC, enables agent self-recovery from provider errors)
3. #40 — Auto mode permission ruleset (80 LOC, immediate autopilot UX win)
4. #37 — Tiered MCP tool loading (50 LOC, direct token-cost win)
5. #45 — Network retry exponential backoff (50 LOC, reliability)
6. #8  — Idle-timeout stream wrapper (50 LOC, fixes hung-provider class)
7. #26 — `_HarnessProfile` per-model (200 LOC, major leverage point)
8. #6  — Worktree ownership verification (60 LOC, cross-clone safety)
9. #27 — Tiered middleware assembly (150 LOC, reduces pipeline coupling)
10. #24 — DeferredToolFilter (120 LOC, direct token-cost win)

Top 10 estimated aggregate: ~1,030 LOC. Realistic sprint.
