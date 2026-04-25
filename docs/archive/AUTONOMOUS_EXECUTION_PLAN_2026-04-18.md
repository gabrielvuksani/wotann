# WOTANN Autonomous Execution Plan — 2026-04-18

**Author:** Planning specialist (Opus 4.7 max effort)
**Scope:** Every unfinished item from MASTER_AUDIT_2026-04-18, BENCHMARK_BEAT_STRATEGY_2026-04-18, _DOCS_AUDIT_2026-04-18, GAP_AUDIT_2026-04-15, plus 9 competitor-analysis documents, decomposed into autonomous tasks Claude Code can execute without human intervention.
**Target consumer:** Claude Code (Opus 4.7, auto-mode) — each task is self-contained, verification-gated, and failure-recovery-annotated.
**Timeline:** 135 engineering days serial; ~60 calendar days with 3 parallel workstreams.
**Non-goals:** iOS items blocked by physical-device testing; Tauri UI items blocked by live dev loop; 5 items blocked by external credentials. These are catalogued in the supplementary Blocked section and do not appear in the dependency graph.

## Legend

- **Tier:** 0 (lies) · 1 (benchmarks) · 2 (Codex parity) · 3 (memory) · 4 (self-evolution) · 5 (UI/UX) · 6 (skills) · 7 (channels) · 8 (FUSE) · S (supplementary).
- **Priority:** CRITICAL (blocks benchmark credibility), HIGH (unlocks a moat), MEDIUM (incremental gain), LOW (polish).
- **Dependencies:** task IDs that MUST complete first. Cross-tier dependencies called out explicitly.
- **Effort:** wall-clock engineering hours/days assuming one Claude Code agent at full effort.
- **Verification command:** literal shell command that must exit 0 with the described output.

## Master Dependency Graph

```
Tier 0 (capability lies)  ──┬──> Tier 1 (benchmark harness)  ──┬──> Tier 4 (self-evolution)
                            │                                  │
                            └──> Tier 2 (Codex parity P0)     │
                                                               │
Tier 3 (memory) ────────────────────────────────────────────────┘

Tier 5 (UI/UX)   ── independent
Tier 6 (skills)  ── independent (some items depend on Tier 3.4 typed schemas)
Tier 7 (channels)── independent
Tier 8 (FUSE)    ── gates Tier 2.1 OS-level sandbox eventually

Supplementary S (dead-code, docs, release) ── rolling, no dependencies
```

Cycle check: none. Verified via topological sort of the per-task dependency field below.

---

## Global Conventions

**Every task follows this commit discipline:**
1. Branch from main with name `wotann/t<tier>-<task-id>-<short-slug>`.
2. Implement with red-green-refactor (write failing test first, implement, verify).
3. Run `npm run typecheck` AND `npm test` AND `cd desktop-app && npx tsc --noEmit` AND `cd desktop-app/src-tauri && cargo check` before commit.
4. Commit with conventional-commit template from the task.
5. Push to origin and open PR, or merge if Gabriel has authorized auto-merge for that tier.
6. After merge: run `mem_save` with `topic_key: wotann/execution-<task-id>` recording outcome.

**Every benchmark-adjacent task must ship an ablation toggle:** a `WOTANN_<FEATURE>_OFF=1` env var that disables the behaviour, so we can publish "harness-only delta" numbers on every score.

**Honest-stub policy:** if a task is partially unimplementable (external blocker), ship an error-envelope handler that returns `{ ok: false, error: "<reason>" }` — never a silent success. Covered by quality-bar #2.

**Self-correction guardrails:** (1) if three different fixes to the same test fail, STOP and dispatch `/tree-search`. (2) Never modify tests to make them pass unless the task explicitly says so. (3) If a commit message claims work that did not land, the next session's audit WILL catch it (quality-bar #14); do not bluff.

---

# Tier 0 — Fix Capability Lies (10 tasks, 10 days)

**Strategic framing:** Tier 0 exists because 5 of WOTANN's 19 providers advertise `supportsToolCalling: true` while silently dropping tool calls, and the camoufox browser is a no-op. Running any benchmark before Tier 0 lands means publishing numbers that don't reflect the product. This tier is a prerequisite for EVERY Tier 1 benchmark claim.

## Task 0.1: Fix Bedrock tool-calling end-to-end

- **Tier:** 0 | **Priority:** CRITICAL | **Dependencies:** none | **Effort:** 2 days
- **Verification:** `npm test -- tests/providers/bedrock-tool-calls.test.ts && WOTANN_LIVE_BEDROCK=1 npm test -- tests/providers/bedrock-live.test.ts`

### Files to create/modify
- `src/providers/bedrock-signer.ts` — modify (body builder + stream parser)
- `src/providers/bedrock-eventstream.ts` — create (AWS event-stream binary decoder)
- `tests/providers/bedrock-tool-calls.test.ts` — create
- `tests/providers/bedrock-live.test.ts` — create
- `tests/fixtures/bedrock-eventstream-toolUse.bin` — create

### Exact spec
1. **Build AWS event-stream decoder** in `src/providers/bedrock-eventstream.ts`. Prelude (12-byte total-length + headers-length + CRC32), headers (key-length/key/value-type/value), payload, message CRC32. Reference `aws-sdk-js-v3`.
2. **Fix body at `bedrock-signer.ts:150-156`.** Add `body.toolConfig = { tools: opts.tools.map(...) }` with `toolSpec.inputSchema.json: t.input_schema`.
3. **Replace stream parser at `bedrock-signer.ts:193-207`.** Use decoder, emit `tool_use_start`, `tool_use_delta`, `text`, `done` with `stopReason: "tool_calls"` on tool_use.

### Success criteria
- [ ] 8 fixture-replay assertions pass
- [ ] `grep "toolConfig" src/providers/bedrock-signer.ts` hits
- [ ] Parallel tool-use case covered
- [ ] No regression on existing `tests/providers/bedrock-*.test.ts`

### Failure recovery
Fallback to `@aws-sdk/eventstream-codec` transitive dep; remove after verification.

### Commit message
```
fix(bedrock): implement real tool-calling via event-stream decoder

closes #t0-1
```

## Task 0.2: Fix Vertex adapter — forward tools/messages/system, parse all event types

- **Tier:** 0 | **Priority:** CRITICAL | **Dependencies:** none | **Effort:** 2 days
- **Verification:** `npm test -- tests/providers/vertex-adapter.test.ts && WOTANN_LIVE_VERTEX=1 npm test -- tests/providers/vertex-live.test.ts`

### Files
- `src/providers/vertex-oauth.ts` — modify body (lines 179-185) + stream parser (lines 238-245)
- `src/providers/vertex-body-builders.ts` — create (`buildAnthropicBody`, `buildGeminiBody`, `buildMistralBody`)
- `tests/providers/vertex-adapter.test.ts` — create/extend
- `tests/providers/vertex-live.test.ts` — create

### Exact spec
1. Publisher-branch body builder (anthropic / google / mistralai schemas).
2. Stream parser handles: `message_start`, `content_block_start` (with tool_use), `content_block_delta` (input_json_delta / thinking_delta / text_delta), `message_delta` (usage), `message_stop` (stop_reason).
3. For Gemini: map `candidates[0].content.parts[].{text,functionCall}`.

### Success criteria
- [ ] 12+ fixture tests pass across event types
- [ ] `grep -c "opts\.tools" src/providers/vertex-oauth.ts` ≥ 2
- [ ] Multi-turn integration: first tool_calls stop, agent responds, second text, no desync

### Commit message
```
fix(vertex): forward tools/messages/system and parse all event types

closes #t0-2
```

## Task 0.3: Fix Azure URL composition

- **Tier:** 0 | **Priority:** CRITICAL | **Dependencies:** none | **Effort:** 0.5 day
- **Verification:** `npm test -- tests/providers/azure-url.test.ts`

### Files
- `src/providers/registry.ts` — modify lines 176-180
- `tests/providers/azure-url.test.ts` — create

### Spec
```typescript
const url = `${baseUrl.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
```

### Success criteria
- [ ] URL matches regex `^https:\/\/[^/]+\.openai\.azure\.com\/openai\/deployments\/[^/]+\/chat\/completions\?api-version=\d{4}-\d{2}-\d{2}$`
- [ ] Special-char deployments encoded
- [ ] Trailing slash on baseUrl idempotently stripped

### Commit message
```
fix(azure): correct URL — path segment before query param

closes #t0-3
```

## Task 0.4: Fix Ollama stopReason for tool_calls

- **Tier:** 0 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 0.25 day
- **Verification:** `npm test -- tests/providers/ollama-adapter.test.ts -t "stopReason"`

### Files
- `src/providers/ollama-adapter.ts` lines 331-342
- `tests/providers/ollama-adapter.test.ts`

### Spec
Track `sawToolCall` flag in stream loop; emit `stopReason: sawToolCall ? "tool_calls" : "stop"` at done.

### Success criteria
- [ ] Multi-turn test: first response tool_calls, second normal text, no desync
- [ ] Single-text test: stopReason="stop" (no regression)

### Commit message
```
fix(ollama): emit stopReason "tool_calls" when tool call detected

closes #t0-4
```

## Task 0.5: Copilot 401 auto-retry

- **Tier:** 0 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 0.5 day
- **Verification:** `npm test -- tests/providers/copilot-adapter.test.ts -t "401"`

### Files
- `src/providers/copilot-adapter.ts` lines 346-355
- `tests/providers/copilot-adapter.test.ts`

### Spec
`requestWithRetry(url, init, retries=1)` re-exchanges GitHub OAuth on 401 and retries exactly once.

### Success criteria
- [ ] Mocked 401 triggers one re-exchange + retry
- [ ] 401-then-401 surfaces error (no infinite loop)

### Commit message
```
fix(copilot): auto-retry once on 401 with refreshed session token

closes #t0-5
```

## Task 0.6: Per-session Copilot token

- **Tier:** 0 | **Priority:** HIGH | **Dependencies:** 0.5 | **Effort:** 0.5 day
- **Verification:** `npm test -- tests/providers/copilot-concurrent-sessions.test.ts`

### Files
- `src/providers/copilot-adapter.ts` lines 88-90 (remove module globals)
- `tests/providers/copilot-concurrent-sessions.test.ts` — create

### Spec
Remove `let cachedToken` module global. Thread `CopilotSessionState` through `ProviderAuth` closure.

### Success criteria
- [ ] Two concurrent sessions with different GH creds don't share token
- [ ] `grep "^let cachedToken" src/providers/copilot-adapter.ts` empty

### Commit message
```
fix(copilot): per-session token state, remove module-global cache

closes #t0-6
```

## Task 0.7: Fix tolerantJSONParse apostrophe corruption

- **Tier:** 0 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 0.5 day
- **Verification:** `npm test -- tests/providers/tool-parsers-apostrophe.test.ts`

### Files
- `src/providers/tool-parsers/parsers.ts` lines 35-53
- `tests/providers/tool-parsers-apostrophe.test.ts`

### Spec
Replace global `replace(/'/g, '"')` with a string-delimiter-aware state machine (only converts ' at delimiter positions, not inside double-quoted strings). Fallback: `json5` package.

### Success criteria
- [ ] `{"text": "it's broken"}` parses unchanged
- [ ] `{'text': 'it\\'s working'}` parses to `{ text: "it's working" }`
- [ ] 20+ corpus cases round-trip

### Commit message
```
fix(tool-parsers): tolerant JSON no longer corrupts legit apostrophes

closes #t0-7
```

## Task 0.8: Persistent Camoufox subprocess bridge

- **Tier:** 0 | **Priority:** CRITICAL | **Dependencies:** none | **Effort:** 3 days
- **Verification:** `npm test -- tests/browser/camoufox-session.test.ts && WOTANN_LIVE_CAMOUFOX=1 npm test -- tests/browser/camoufox-live.test.ts`

### Files
- `src/browser/camoufox-backend.ts` — rewrite (persistent session)
- `src/browser/camoufox-rpc.py` — create (long-running Python JSON-RPC server)
- `src/browser/camoufox-protocol.ts` — create
- `tests/browser/camoufox-session.test.ts`, `tests/browser/camoufox-live.test.ts`

### Spec
1. Python process spawned ONCE, handles JSON-RPC on stdin/stdout. Methods: launch, newPage, goto, getContent, screenshot, click, fill, evaluate, close.
2. TS backend maintains `Map<number, {resolve,reject}>` pending. Line-buffer stdout.
3. Auto-restart on subprocess crash; bounded queue for backpressure.
4. Session isolation: each `launch()` → handle, multiple per subprocess.

### Success criteria
- [ ] Session creates, navigates 3 pages, cookies persist, close terminates session but keeps subprocess
- [ ] Live test navigates example.com and extracts text
- [ ] `grep -c "spawn" src/browser/camoufox-backend.ts` === 1
- [ ] Kill -9 → auto-restart within 2s

### Commit message
```
feat(browser): persistent camoufox subprocess with JSON-RPC bridge

closes #t0-8
```

## Task 0.9: Strip 40+ tautological .toBeTruthy() assertions

- **Tier:** 0 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 1 day
- **Verification:** `grep -rn "toBeTruthy()" tests/ | wc -l` ≤ 5

### Files
- `tests/mobile/ios-app.test.ts` + ~10 other files
- `tests/_stripped_tautologies.md` — create log

### Spec
Replace each `.toBeTruthy()` with real invariant (e.g., `.toMatch(/^ses_[a-z0-9]{16}$/)`) or delete.

### Commit message
```
test: strip 40+ tautological toBeTruthy() assertions

closes #t0-9
```

## Task 0.10: Remove tautological self-equality at fallback-e2e.test.ts:95

- **Tier:** 0 | **Priority:** LOW | **Dependencies:** none | **Effort:** 0.1 day
- **Verification:** `grep -n "toBe.*fallback.*fallback" tests/integration/fallback-e2e.test.ts` empty

### Spec
Replace self-equality with `expect(chainOutcome.provider).not.toBe(primaryProvider)`.

### Commit message
```
test(fallback-e2e): replace tautology with real fallback invariant

closes #t0-10
```

**Tier 0 Total: 10 tasks, 10 days.**

---

# Tier 1 — Benchmark-Winning Harness (10 tasks, 20 days)

## Task 1.1: Wire benchmark-harness.ts to real runners

- **Tier:** 1 | **Priority:** CRITICAL | **Dependencies:** Tier 0 complete | **Effort:** 5 days
- **Verification:** `wotann benchmark run humaneval --limit 10 --provider groq-llama3.3-70b` produces `trajectories/humaneval/<runId>/report.json`

### Files
- `src/intelligence/benchmark-harness.ts` — rewrite placeholders
- `src/intelligence/benchmarks/{terminalbench,swebench,lcb,aider-polyglot,humaneval}-runner.ts` — create
- `src/intelligence/benchmarks/trajectory-logger.ts` — create
- `src/intelligence/benchmarks/fitness-function.ts` — create
- `src/cli/benchmark.ts` — create

### Spec
Unified `BenchmarkRunner<Task, Result>` interface. TerminalBench via `tb run-agent`. SWE-bench via Docker worktree + hidden-test filter. LCB JSON dump. Aider iterates 225 Exercism exercises. Trajectory logger writes JSONL. CLI `wotann benchmark {run,list,refresh}`.

### Success criteria
- [ ] HumanEval smoke passes end-to-end
- [ ] `report.json` has valid FitnessScore shape
- [ ] Each runner has a 3-task smoke test
- [ ] `--ablate self-consistency` flag works

### Commit message
```
feat(benchmark): wire benchmark-harness to real runners

closes #t1-1
```

## Task 1.2: Self-consistency voting (k samples + majority vote)

- **Tier:** 1 | **Priority:** HIGH | **Dependencies:** 1.1 | **Effort:** 2 days
- **Verification:** `npm test -- tests/intelligence/self-consistency.test.ts`

### Files
- `src/intelligence/self-consistency.ts`, `tests/intelligence/self-consistency.test.ts`
- `src/orchestration/council.ts` — wire

### Spec
`runKSamples(agent, task, k=5, temperature=0.7)` parallel. `voteOnResults` strategies: exact-match, test-pass-count, final-state-hash. Tie-break by wall-clock.

### Success criteria
- [ ] Test [A,A,B] → A
- [ ] Wall-clock tie-break works
- [ ] HumanEval `--self-consistency 5`: +2-5% lift in offline replay

### Commit message
```
feat(benchmark): self-consistency voting with k samples

closes #t1-2
```

## Task 1.3: Verifier agent with retry budget

- **Tier:** 1 | **Priority:** HIGH | **Dependencies:** 1.1 | **Effort:** 2 days
- **Verification:** `npm test -- tests/intelligence/verifier.test.ts`

### Files
- `src/intelligence/verifier-agent.ts` — create
- `src/orchestration/verification-cascade.ts` — wire
- `tests/intelligence/verifier.test.ts`

### Spec
Fresh-context verifier (different provider, Sonnet 4.6 when budget). Retry budget=2. Abstain if confidence <60%. Cost cap $0.02/task configurable.

### Success criteria
- [ ] Flags trivially-wrong patch, triggers retry
- [ ] Retry budget=0 means no retry
- [ ] Cost cap enforced
- [ ] SWE-bench Lite 10-task: +1-3%

### Commit message
```
feat(benchmark): verifier agent with retry budget and cost cap

closes #t1-3
```

## Task 1.4: Test-time search / tree-of-thought over plans

- **Tier:** 1 | **Priority:** MEDIUM | **Dependencies:** 1.1 | **Effort:** 3 days
- **Verification:** `npm test -- tests/orchestration/tree-search.test.ts`

### Files
- `src/orchestration/tree-search.ts`, `src/orchestration/plan-scorer.ts`

### Spec
N candidate plans at root → score via heuristics (plan length, tool-use count, prior-success-rate for similar) → expand top-K one ply → prune by budget → terminal state.

### Success criteria
- [ ] Mocked scorer produces expected search order
- [ ] Budget enforcement works
- [ ] TB 5-task integration: +2-4% over single-plan

### Commit message
```
feat(orchestration): BFTS over plan hypotheses with score pruning

closes #t1-4
```

## Task 1.5: Property-based fuzz of all tool-call parsers

- **Tier:** 1 | **Priority:** MEDIUM | **Dependencies:** 0.7 | **Effort:** 2 days
- **Verification:** `npm test -- tests/providers/tool-parsers-fuzz.test.ts`

### Files
- `tests/providers/tool-parsers-fuzz.test.ts`, `package.json` (fast-check)

### Spec
1000 runs per parser (Hermes, Mistral, Llama, Qwen, DeepSeek, Functionary, Jamba, Command-R, ToolBench, Glaive, ReAct, XML). No parser throws. Round-trip sanity.

### Commit message
```
test(tool-parsers): property-based fuzz across 11 parsers

closes #t1-5
```

## Task 1.6: Per-language compile/type-check tools

- **Tier:** 1 | **Priority:** HIGH | **Dependencies:** 1.1 | **Effort:** 2 days
- **Verification:** `npm test -- tests/tools/language-check.test.ts`

### Files
- `src/tools/language-check.ts`
- `src/tools/language-runners/{tsc,pyright,gopls,rustc,cargo,javac,gcc}-check.ts`

### Spec
Detect language → run checker → parse errors to structured `{file,line,col,code,message}`. `--fail-on-error` mode. Agent auto-invokes before completion on Aider/SWE/BigCode.

### Commit message
```
feat(tools): language_check tool — per-language compile/type-check

closes #t1-6
```

## Task 1.7: Sticky planning scratchpad

- **Tier:** 1 | **Priority:** MEDIUM | **Dependencies:** 1.1 | **Effort:** 1 day

### Files
- `src/orchestration/plan-store.ts` — modify
- `src/intelligence/benchmarks/terminalbench-runner.ts` — wire

### Spec
`plan.md` persists to `trajectories/{benchmark}/{runId}/plan-{taskId}.md` across turns. Re-injected at every turn. Agent edits as plan evolves.

### Commit message
```
feat(orchestration): sticky planning scratchpad across turns

closes #t1-7
```

## Task 1.8: BGE reranker (ONNX, local)

- **Tier:** 1 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 2 days
- **Verification:** `npm test -- tests/memory/bge-reranker.test.ts`

### Files
- `src/memory/bge-reranker.ts`, `src/memory/rerank-cache.ts`

### Spec
Lazy-download `BAAI/bge-reranker-v2-m3` (~600MB) to `~/.wotann/models/`. `onnxruntime-node` cross-encoder. `rerank(query, candidates, topK=10)`. SHA-cached 30d. Graceful fallback if missing.

### Success criteria
- [ ] Reorders by score correctly (mocked)
- [ ] Recall@5 memory-benchmark: +15%
- [ ] No-ONNX fallback: RRF-only path

### Commit message
```
feat(memory): BGE-reranker v2 m3 cross-encoder for hybrid search

closes #t1-8
```

## Task 1.9: Contextual embeddings (+30-50% recall)

- **Tier:** 1 | **Priority:** MEDIUM | **Dependencies:** 1.8 | **Effort:** 1 day

### Files
- `src/memory/contextual-embeddings.ts`, `src/memory/store.ts` modify

### Spec
Per Anthropic: prepend 1-2 sentences of LLM-generated context before embedding each chunk. Use Groq Llama3.3 free tier. Cache by SHA(chunk+surrounding).

### Commit message
```
feat(memory): contextual embeddings for +30-50% recall

closes #t1-9
```

## Task 1.10: Trajectory-scored retries

- **Tier:** 1 | **Priority:** MEDIUM | **Dependencies:** 1.1 | **Effort:** 1 day

### Files
- `src/intelligence/trajectory-scorer.ts`, wire into runners

### Spec
Score `{success, efficiency, error_count, loop_count}` post-task. Low-score + retries>0 → restart with different provider, increased reasoning, fresh context.

### Commit message
```
feat(benchmark): trajectory-scored retries with escalation

closes #t1-10
```

**Tier 1 Total: 10 tasks, 20 days.**

---

# Tier 2 — Codex Parity P0 (7 tasks, 17 days)

## Task 2.1: OS-level sandbox wrappers

- **Tier:** 2 | **Priority:** CRITICAL | **Dependencies:** none | **Effort:** 7 days
- **Verification:** `npm test -- tests/sandbox/os-sandbox.test.ts && WOTANN_SANDBOX_LIVE=1 npm test -- tests/sandbox/os-sandbox-live.test.ts`

### Files
- `src/sandbox/os/{linux-bwrap,macos-seatbelt,windows-sandbox,platform-dispatcher}.ts`
- `src/sandbox/executor.ts` — route through dispatcher

### Spec
Linux: `bwrap --ro-bind / / --bind workspace --unshare-all --share-net --die-with-parent`. macOS: generate `.sb` profile → `sandbox-exec`. Windows: `.wsb` config + `WindowsSandbox.exe`. Policy levels: read-only / workspace-write / danger-full-access (matches Codex).

### Success criteria
- [ ] `wotann exec "rm /etc/passwd"` denied in workspace-write mode
- [ ] Network-block mode works
- [ ] Fallback to policy-only when OS tool missing with explicit warning

### Commit message
```
feat(sandbox): OS-level sandbox wrappers bwrap/seatbelt/win-sandbox

closes #t2-1
```

## Task 2.2: thread/fork — branch session at turn N

- **Tier:** 2 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 2 days

### Files
- `src/session/thread-fork.ts`, `src/daemon/kairos-rpc.ts` (add `thread.fork`)

### Spec
Copy: conversation history + plan.md + memory snapshot + cost-tracker. Don't copy: running tools, websockets.

### Commit message
```
feat(session): thread/fork — branch session at turn N for A/B exploration

closes #t2-2
```

## Task 2.3: thread/rollback(numTurns)

- **Tier:** 2 | **Priority:** HIGH | **Dependencies:** 2.2 | **Effort:** 1 day

### Files
- `src/session/thread-rollback.ts`, kairos-rpc.ts handler

### Spec
Replay state minus last N turns. Reuses shadow-git ring buffer for filesystem undo.

### Commit message
```
feat(session): thread/rollback precise N-turn undo

closes #t2-3
```

## Task 2.4: wotann mcp-server mode

- **Tier:** 2 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 3 days

### Files
- `src/mcp/server.ts`, `src/cli/commands/mcp-server.ts`

### Spec
MCP JSON-RPC over stdio or HTTP. Expose WOTANN's tools as MCP tools. Sessions as resources. CLI `wotann mcp-server [--stdio | --http --port N]`. Hostable by Claude Code / Cursor / Zed.

### Commit message
```
feat(mcp): wotann mcp-server mode — hostable by any MCP client

closes #t2-4
```

## Task 2.5: unified_exec PTY tool

- **Tier:** 2 | **Priority:** HIGH | **Dependencies:** 2.1 | **Effort:** 2 days

### Files
- `src/tools/unified-exec.ts`, `src/tools/pty-manager.ts` (node-pty)

### Spec
Spawn under PTY, interactive stdin. Supports vim/python REPL/less/sudo. `Map<sessionId, PtyHandle>` for cross-turn re-attach. Runs inside OS sandbox.

### Commit message
```
feat(tools): unified_exec PTY-backed interactive tool

closes #t2-5
```

## Task 2.6: shell_snapshot — cache env

- **Tier:** 2 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 1 day

### Files
- `src/tools/shell-snapshot.ts`

### Spec
First shell invocation captures env/pwd/aliases/PATH. TTL 10min. Subsequent calls reuse. Manual invalidate.

### Commit message
```
feat(tools): shell_snapshot — cache shell env for speed

closes #t2-6
```

## Task 2.7: request_rule smart approvals

- **Tier:** 2 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 1 day

### Files
- `src/hooks/request-rule.ts`, `src/sandbox/permission-resolver.ts` modify

### Spec
Rules: `{pattern:"Bash(npm *)", decision:"allow"|"deny", expires}`. Prompt options: Allow once / Allow for session / Deny / Deny forever. `~/.wotann/rules.json`.

### Commit message
```
feat(hooks): request_rule smart approvals with pattern matching

closes #t2-7
```

**Tier 2 Total: 7 tasks, 17 days.**

---

# Tier 3 — Memory Upgrades (8 tasks, 11 days)

## Task 3.1: Tree-sitter AST chunking

- **Tier:** 3 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 2 days

### Files
- `src/memory/tree-sitter-chunker.ts`, `src/memory/repo-map.ts` replace regex symbol extraction

### Spec
`web-tree-sitter` WASM, 20 language grammars lazy-loaded. Function/class boundaries. Sliding-window fallback for unknown.

### Commit message
```
feat(memory): tree-sitter AST chunking via web-tree-sitter WASM

closes #t3-1
```

## Task 3.2: sqlite-vec virtual tables

- **Tier:** 3 | **Priority:** HIGH | **Dependencies:** none | **Effort:** 1 day

### Files
- `src/memory/sqlite-vec-adapter.ts`, `src/memory/vector-store.ts` modify

### Spec
`CREATE VIRTUAL TABLE vec_memory USING vec0(embedding float[384])`. KNN via `MATCH`. Fallback to in-memory cosine.

### Commit message
```
feat(memory): sqlite-vec virtual tables for 10-100x faster KNN

closes #t3-2
```

## Task 3.3: Unified graph+vector dual retrieval

- **Tier:** 3 | **Priority:** HIGH | **Dependencies:** 3.2 | **Effort:** 2 days

### Files
- `src/memory/dual-retrieval.ts`

### Spec
`DualRetrieval.search(query)` = vector seed → 2-hop CTE expansion → merge by id → RRF rerank. Wraps HybridMemorySearch + KnowledgeGraph.

### Commit message
```
feat(memory): unified graph+vector dual retrieval

closes #t3-3
```

## Task 3.4: Typed EntityType schemas via Zod

- **Tier:** 3 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 2 days

### Files
- `src/memory/entity-schemas.ts`, `src/memory/graph-rag.ts` modify

### Spec
EntityType enum: Bug, Feature, Decision, Person, File, Concept. Zod schemas. LLM structured-output extraction gated on Zod validation.

### Commit message
```
feat(memory): typed EntityType schemas with Zod + structured output

closes #t3-4
```

## Task 3.5: Incremental index by file-SHA hash

- **Tier:** 3 | **Priority:** HIGH | **Dependencies:** 3.1 | **Effort:** 0.5 day

### Files
- `src/memory/incremental-indexer.ts`, `.wotann/index-hash.json`

### Spec
SHA256 per file. Compare to stored. Only re-embed changed. Purge deleted.

### Commit message
```
feat(memory): incremental index by file-SHA hash — minutes to seconds

closes #t3-5
```

## Task 3.6: Mode registry + mode-scoped memory

- **Tier:** 3 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 1.5 days

### Files
- `src/memory/mode-registry.ts`, `src/memory/store.ts` mode column

### Spec
Modes: code, chat, research, exploit, write. Retrieval filters by active mode by default.

### Commit message
```
feat(memory): mode registry + mode-scoped retrieval

closes #t3-6
```

## Task 3.7: Project/task scope columns

- **Tier:** 3 | **Priority:** MEDIUM | **Dependencies:** none | **Effort:** 0.5 day

### Files
- `src/memory/store.ts` — migration for project_id + task_id columns

### Commit message
```
feat(memory): project/task scope columns for retrieval filtering

closes #t3-7
```

## Task 3.8: Query reformulation + multi-query + HyDE

- **Tier:** 3 | **Priority:** MEDIUM | **Dependencies:** 3.3 | **Effort:** 1 day

### Files
- `src/memory/query-reformulation.ts`

### Spec
3 reformulations via cheap LLM + 1 HyDE (hypothetical answer, embed, search). Union + dedupe + rerank.

### Commit message
```
feat(memory): query reformulation + multi-query + HyDE

closes #t3-8
```

**Tier 3 Total: 8 tasks, 11 days.**

---

# Tier 4 — Self-Evolution (8 tasks, 20 days)

## Task 4.1: Failure-lesson capture — lessons.jsonl (Reflexion)
- **Dependencies:** 1.1 | **Effort:** 1 day
- `src/learning/lessons-store.ts`, `src/learning/lesson-retrieval.ts`
- Capture `{timestamp, domain, symptom, root_cause?, attempted_fixes, succeeded_fix?}` to `~/.wotann/lessons.jsonl`. Retrieve top-N by domain+embedding similarity on task start.

## Task 4.2: Rationalization step (STaR)
- **Dependencies:** 4.1 | **Effort:** 1.5 days
- `src/learning/rationalization.ts`
- On correction: prompt for post-hoc rationale. Keep if verifier confidence ≥0.7.

## Task 4.3: 3-layer memory split (working/episodic/semantic) — MemGPT/Letta pattern
- **Dependencies:** none | **Effort:** 1.5 days
- `src/memory/{working,episodic,semantic}-memory.ts`
- Separate compaction policies. `memory.promote(from,to,entryId)` API.

## Task 4.4: Embedding-indexed skill retrieval (Voyager)
- **Dependencies:** 1.8 | **Effort:** 2 days
- `src/skills/embedding-index.ts`
- BGE-small index on (name+description+triggers). Cache by file SHA. Top-K retrieval.

## Task 4.5: Archive-not-population (DGM)
- **Dependencies:** 1.1, 4.1 | **Effort:** 1 day
- `src/learning/archive.ts`, modify `self-crystallization.ts`
- Tag replaced skills `status:archived`, keep parent chain. Sample for crossover weighted by perf×novelty.

## Task 4.6: CodeAct upgrade (sandbox code execution)
- **Dependencies:** 2.1, 2.5 | **Effort:** 6 days
- `src/orchestration/codeact.ts`, `src/sandbox/{python,deno}-executor.ts`
- Replace JSON tool-calls with `<code>...</code>` blocks in sandbox. RestrictedPython or subprocess+bwrap. Toggle `WOTANN_CODEACT=1`.
- Target: GAIA 10-task +15-20%.

## Task 4.7: Self-rewarding tournament
- **Dependencies:** 1.1, 1.3 | **Effort:** 1 day
- `src/learning/self-rewarding.ts`
- Sonnet-as-judge ranks A/B trajectories by correctness/efficiency/style. Winner promotes.

## Task 4.8: Prompt mutation + tournament (PromptBreeder)
- **Dependencies:** 4.7 | **Effort:** 3 days
- `src/learning/prompt-breeder.ts`
- 5 preamble variants mutated weekly via 6 strategies. Tournament on benchmark subset.

**Tier 4 Total: 8 tasks, 20 days.**

---

# Tier 5 — UI/UX Distinction (7 tasks, 12 days)

## Task 5.1: Liquid Glass HUD — 2 days
- `desktop-app/src/components/{QuickActionsOverlay,palette/CommandPalette,Sidebar}.tsx`, `liquid-glass.css`
- `backdrop-filter: blur(20px) saturate(180%)` + translucent bg. Reduced-motion respected. Firefox fallback.

## Task 5.2: Unified design tokens build script — 1 day
- `scripts/build-design-tokens.ts`, `design-tokens.json`
- Single JSON → CSS + Swift + Ink outputs. Pre-commit regeneration.

## Task 5.3: Block-based terminal with OSC 133 — 5 days
- `desktop-app/src/components/terminal/{TerminalPanel,CommandBlock,osc133-parser}.ts(x)`
- OSC 133 parser (prompt/cmd/output/exit). Fold, rerun, share, AI-ize per block. Virtual scrolling.

## Task 5.4: Cmd+/ shortcut cheatsheet overlay — 0.5 day

## Task 5.5: Bezier cursor overlay + [POINT:x,y] grammar — 2 days
- SVG overlay, 600ms bezier animation, ease-in-out.

## Task 5.6: "Ask about this window" via ScreenCaptureKit + OCR — 3 days (macOS)
- `desktop-app/src-tauri/src/screencapture.rs`
- ScreenCaptureKit FFI + Vision OCR. Permission prompt first use. Honest stub on Win/Linux.

## Task 5.7: Global hotkey palette — 1 day
- `desktop-app/src-tauri/src/global_shortcut.rs` modify
- `Cmd+Space+W` default, user-configurable.

**Tier 5 Total: 7 tasks, 12 days.**

---

# Tier 6 — Skill Library Convergence (30 tasks, ~25 days)

Each skill: template 0.5-1 day, parallelizable, no cross-dependencies (except 3.4 Zod for skills emitting entities).

**Files per skill:** `skills/{name}.md` + `tests/skills/{name}.test.ts`.
**Verification:** `npm test -- tests/skills/{name}.test.ts && wotann skill invoke {name} <test-input>`
**Template:** agentskills.io v1 schema (name, description, version, allowed_tools, disallowed_tools, deps, license, maintainer).

### Ranked skill list

| # | Skill | Source |
|---|---|---|
| 6.1 | skill-test-harness | Superpowers |
| 6.2 | brainstorming | Superpowers |
| 6.3 | writing-plans | Superpowers |
| 6.4 | executing-plans | Superpowers |
| 6.5 | verification-before-completion | Superpowers |
| 6.6 | requesting-code-review | Superpowers |
| 6.7 | receiving-code-review | Superpowers |
| 6.8 | systematic-debugging | Superpowers |
| 6.9 | dispatching-parallel-agents | Superpowers |
| 6.10 | using-git-worktrees | Superpowers |
| 6.11 | finishing-a-development-branch | Superpowers |
| 6.12 | writing-skills | Superpowers |
| 6.13 | test-driven-development | Superpowers |
| 6.14 | agentskills-author | OpenAI Skills v1 |
| 6.15 | iterative-retrieval | OpenAI Skills v1 |
| 6.16 | autonomous-loops | OpenAI Skills v1 |
| 6.17 | explain-concept | DeepTutor |
| 6.18 | explain-code | DeepTutor |
| 6.19 | explain-error | DeepTutor |
| 6.20 | think-before-coding | Karpathy |
| 6.21 | simplicity-first | Karpathy |
| 6.22 | surgical-changes | Karpathy |
| 6.23 | goal-driven-execution | Karpathy |
| 6.24 | design-systems-audit | Osmani |
| 6.25 | frontend-perf-audit | Osmani |
| 6.26 | cognitive-load-theory | DeepTutor |
| 6.27 | socratic-code-review | DeepTutor |
| 6.28 | adversarial-self-critique | Voyager |
| 6.29 | hypothesis-tree-search | AI Scientist |
| 6.30 | skill-crystallization-harness | GenericAgent |

**Tier 6 Total: 30 tasks, 25 days (parallelizable to ~5 days with 5 streams).**

---

# Tier 7 — Channel Parity to 24 (7 tasks, 10 days)

| # | Channel | Effort | Notes |
|---|---|---|---|
| 7.1 | Mastodon | 1.5d | OAuth via /api/v1/apps, DM via /api/v1/statuses visibility:direct |
| 7.2 | Twitter/X DM | 2d | API v2 /2/dm_conversations, OAuth 2.0 PKCE, honest-stub if access denied |
| 7.3 | LinkedIn | 1.5d | Messaging API (partner-only), honest-stub fallback |
| 7.4 | Instagram | 1.5d | Meta Graph /PAGE_ID/messages, IG Business required |
| 7.5 | WeChat | 1.5d | Official Account Platform, mainland registration, honest-stub default |
| 7.6 | Line | 1d | Messaging API + channel access token |
| 7.7 | Viber | 1d | Viber Bot API |

**Tier 7 Total: 7 tasks, 10 days.**

---

# Tier 8 — FUSE Security Moat (4 tasks, 15 days)

## Task 8.1: FUSE overlay filesystem (Linux) — 6 days
- `src/sandbox/fuse/linux-fuse.ts`, wraps `fuse3` N-API or spawns `fuse-overlayfs`
- Lower (RO workspace) + upper (agent writes) + merged. On task completion: diff upper, apply or discard.

## Task 8.2: macFUSE / APFS snapshot overlay (macOS) — 4 days
- `src/sandbox/fuse/macos-macfuse.ts`
- APFS snapshots + clone files for write-redirect (performance better than macFUSE overlay on Apple Silicon).

## Task 8.3: Windows ProjFS — 3 days
- `src/sandbox/fuse/windows-projfs.ts`
- Copy-on-write via projected filesystem.

## Task 8.4: Seccomp/BPF syscall filter (Linux) — 2 days
- `src/sandbox/seccomp-policy.ts`
- Drop: mount, unmount, ptrace, reboot, module-loading. BPF via libseccomp or Rust FFI.

**Tier 8 Total: 4 tasks, 15 days.**

---

# Supplementary S

## S.1 Dead-code reclassification (7 tasks, 1h-2h each)
Per DEAD_CODE_REPURPOSING_2026-04-18.md — wire into runtime vs delete decisions. Reference that doc for details.

- S.1.a Wire StaleReadTracker into ReadBeforeEdit hook
- S.1.b Wire getTimeoutForCommand into bash/execute
- S.1.c auto-install-missing-dep: wire into npm/pip errors or delete
- S.1.d runPreCompletionChecklist: wire into verifier or delete
- S.1.e discoverEntryPoints: wire into planner or delete
- S.1.f allocateReasoningBudget: wire into router or delete
- S.1.g getModelProfile: wire into router or delete

## S.2 Docs reconciliation (9 tasks, 10-30min each)
- S.2.1 CLAUDE.md provider count 11 → 19
- S.2.2 README.md provider count 17 → 19
- S.2.3 README.md channel count → 24 (post-Tier 7) or truthful current
- S.2.4 README.md command count 78 → 85
- S.2.5 README.md middleware 20+ → 25
- S.2.6 README.md hook events: 9 fire / 19 typed
- S.2.7 Fix broken `research/REPOS.md` link
- S.2.8 Search-replace NEXUS → WOTANN in all 2026-04-* docs
- S.2.9 SUPERSEDED banner on DEEP_AUDIT_2026-04-13, MASTER_AUDIT_2026-04-14

## S.3 Release engineering (manual / blocked)
- S.3.1 Rotate Supabase anon key (Gabriel confirmed removed from GitHub — still rotate in dashboard)
- S.3.2 Sentry signup + DSN + crash reporting wire
- S.3.3 Apple Developer ID for notarization
- S.3.4 Fresh `npm test` → update CHANGELOG with actual count

## S.4 Prior-audit CRITICAL items (from MASTER_AUDIT_2026-04-14 §4 and §44)
These are DISTINCT from Tier 0 and MUST land separately:
- S.4.1 Fix `send_message` Tauri command — commands.rs:342 (unlocks @refs, ghost-text, workflows) — 2h
- S.4.2 Wire `autonomous.run` to executor.execute() — kairos-rpc.ts:2708-2732 (unlocks 2K LOC) — 1h
- S.4.3 Standardize 3 ECDH implementations on P-256 + raw 64B + HKDF-SHA256 — 3h
- S.4.4 Fix shell injection `voice-mode.ts:509` + `tts-engine.ts:455` — argv-only piper + stdin pipe — 1h
- S.4.5 Fix `composer.apply` unrestricted path write — workspace prefix — 1h
- S.4.6 Gate `WOTANN_AUTH_BYPASS=1` behind `NODE_ENV==="test"` — 15min
- S.4.7 Fix `webhook.ts:104` non-constant-time compare — `timingSafeEqual` — 15min
- S.4.8 Fix `mcp.add` RPC: sanitize + user confirm for non-npm — 1h
- S.4.9 Fix 10 skills missing YAML frontmatter (a2ui, canvas-mode, batch-processing, computer-use, cost-intelligence, lsp-operations, mcp-marketplace, benchmark-engineering, prompt-testing, self-healing) — 30min
- S.4.10 Fix 10 fake-guarantee hooks (destructiveGuard, completionVerifier, tddEnforcement, preCompactFlush, sessionSummary, memoryRecovery, autoLint, simpleCorrectionCapture, correctionCapture, focusModeToggle) — implement or demote — 2h
- S.4.11 Fix Copilot 401 retry (alt to 0.5) + other 9 CRITICAL ship blockers from §44
- S.4.12 Add event listener cleanup (73 .on()/0 .off() across 23 files) in close()/destroy() methods — 4h
- S.4.13 Add memory retention policy (30-day rolling for audit_trail, auto_capture; FIFO caps for TraceAnalyzer 10K, ArenaLeaderboard 500) — 3h
- S.4.14 Migrate ESLint 9 — `.eslintrc.json` → `eslint.config.js` — 30min
- S.4.15 Rename `turboquant.ts` → `ollama-kv-compression.ts` — 10min
- S.4.16 Move `@anthropic-ai/claude-agent-sdk` to peerDependencies (proprietary blocker) — 10min
- S.4.17 `npm audit fix` — 5min
- S.4.18 Fix `.wotann/.wotann/` nested directory bug — 30min
- S.4.19 Fix `wotann companion start` Commander.js schema — 15min
- S.4.20 Thin-client socket path: `daemon.sock` → `kairos.sock` in `thin-client.ts:22` — 30sec
- S.4.21 Fix SOUL.md regex in `identity.ts:37` (activates 52 lines of Norse identity!) — 30sec
- S.4.22 Delete 3 dead iOS views (MainTabView, DashboardView, AgentListView, ~1000 LOC) — 30min
- S.4.23 Fix agent-bridge.ts:78-86 — forward `tools: options.tools` to UnifiedQueryOptions — 1h (THIS IS THE ROOT CAUSE OF TOOL SERIALIZATION DEAD IN 4/5 ADAPTERS)
- S.4.24 Wire `parseToolCallFromText()` into agent-bridge.ts response processing — 1h (sibling of S.4.23)
- S.4.25 Fix `gemini-native-adapter.ts:252` — make `includeThoughts` opt-in (saves 10-30% tokens) — 15min

**S Total: ~52 tasks, ~25 days.**

---

# Global Verification Matrix

```bash
npm run typecheck
cd desktop-app && npx tsc --noEmit
cd desktop-app/src-tauri && cargo check
npm test -- --reporter=verbose
npm test -- tests/providers/          # Tier 0 gate
npm test -- tests/intelligence/benchmarks/  # Tier 1 gate
npm test -- tests/sandbox/            # Tier 2 + 8 gate
npm test -- tests/memory/             # Tier 3 gate
npm test -- tests/learning/           # Tier 4 gate
npm test -- tests/skills/             # Tier 6 gate
npm test -- tests/channels/           # Tier 7 gate
wotann benchmark run humaneval --limit 20 --provider groq-llama3.3-70b
wotann benchmark run swe-bench-lite --limit 20 --provider deepseek-v3
wotann benchmark run terminalbench --limit 20 --provider cerebras-qwen3-coder
```

If any fail, STOP and escalate per self-correction guardrails.

---

# Dependency DAG (full)

```
Tier 0.1–0.10       (parallel within, all block Tier 1)
    └── Tier 1.1    (blocks 1.2–1.10 and Tier 4)
         ├── Tier 1.2 (independent)
         ├── Tier 1.3 (blocks 4.7)
         ├── Tier 1.4 (independent)
         ├── Tier 1.5 (depends on 0.7)
         ├── Tier 1.6 (independent)
         ├── Tier 1.7 (independent)
         ├── Tier 1.8 (blocks 4.4)
         ├── Tier 1.9 (depends on 1.8)
         └── Tier 1.10 (independent)

Tier 2.1            (blocks 2.5, 8.4)
Tier 2.2            (blocks 2.3)
Tier 2.3, 2.4, 2.6, 2.7 (independent)
Tier 2.5            (depends on 2.1)

Tier 3.1            (blocks 3.5)
Tier 3.2            (blocks 3.3)
Tier 3.3            (depends on 3.2, blocks 3.8)
Tier 3.4            (blocks Tier 6 items emitting entities)
Tier 3.5            (depends on 3.1)
Tier 3.6, 3.7       (independent)
Tier 3.8            (depends on 3.3)

Tier 4.1            (depends on 1.1)
Tier 4.2            (depends on 4.1)
Tier 4.3            (independent)
Tier 4.4            (depends on 1.8)
Tier 4.5            (depends on 1.1, 4.1)
Tier 4.6            (depends on 2.1, 2.5)
Tier 4.7            (depends on 1.1, 1.3)
Tier 4.8            (depends on 4.7)

Tier 5.1–5.7        (all independent)
Tier 6.1–6.30       (parallel; some depend on 3.4)
Tier 7.1–7.7        (parallel)
Tier 8.1            (depends on 2.1, blocks 8.2, 8.3)
Tier 8.2, 8.3       (depend on 8.1)
Tier 8.4            (depends on 2.1, 8.1)
```

No cycles. Max critical-path length: Tier 0.1 → Tier 1.1 → Tier 4.6 = 2 + 5 + 6 = 13 days.

---

# Execution Principles

1. **Plan stickiness.** Implement AS SPECIFIED. Simpler way? STOP, update plan, resume.
2. **Test-first.** Red before green, always.
3. **Evidence before assertions.** Run verification, show output.
4. **Honest stubs over silent success.** `{ ok: false, error }` if blocked.
5. **Per-session state.** Module-global mutable state is a bug.
6. **Commit-is-claim.** Match code landed, or next audit catches you.
7. **Cross-tier awareness.** Tier 0 green before Tier 1. Tier 1 green before Tier 4.
8. **Parallel when possible.** `run_in_background: true` + file-ownership boundaries.
9. **Monitor for benchmark drift.** Adapter change → rerun 20+20+20 smoke.
10. **No scope creep.** Adjacent bug → file new task.

---

# Final Notes

- **Opus 4.7 max effort** for all agent dispatches from this plan.
- **Verification-first every task**: no verification output = not complete.
- **Memory integration**: after every task, `mem_save` with `topic_key: wotann/execution-t{N}-{M}`.
- **Benchmark snapshots**: at each tier completion, record `benchmarks/snapshots/{date}-t{tier}.json`.

This plan is designed for Claude Code auto-mode. Every task is actionable without human intervention. Every task is verification-gated. Every dependency is explicit. Every tier delivers value independently. Total effort ~135 engineering days; parallelization to 3 streams → ~60 calendar days. After full completion, WOTANN is positioned for top-3 on TerminalBench, SWE-bench Verified/Live, Aider Polyglot, τ-bench at zero-cost baseline, with SOTA-tier scores under $5 Sonnet verifier spend.
