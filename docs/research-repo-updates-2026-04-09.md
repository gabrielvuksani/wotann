# Research Repo Updates -- 2026-04-09

> Synced: 2026-04-09
> Previous sync: 2026-04-01
> Coverage: 2026-03-29 through 2026-04-09 (11 days)

## Summary

| Repo | Priority | New Commits | Status | Key Theme |
|------|----------|-------------|--------|-----------|
| deepagents | HIGH | ~40 | Pulled | REPL middleware, better-harness, skill invocation |
| deer-flow | HIGH | 27 | Pulled | Sandbox audit, PDF uploads, new skills |
| hermes-agent | HIGH | 100 | Re-cloned | Unified execution layer, context compression, new providers |
| oh-my-openagent | MEDIUM | 187 | Pulled | v3.x release, prepublish hardening, tmux isolation |
| agents | MEDIUM | ~20 | Pulled | block-no-verify plugin, documentation-standards plugin, marketplace.json |
| claude-task-master | MEDIUM | 1 | Up to date | Version bump only |
| ruflo | LOW | ~20 | Up to date | DiskANN vector search, LongMemEval benchmark, ESM fixes |
| eigent | LOW | 1 | Up to date | WeChat QR code update only |
| opcode | DORMANT | 0 | Up to date | No activity since Oct 2025 |
| open-swe | MEDIUM | 13 | Pulled | Proxy auth, sandbox security fixes |

---

## deepagents (langchain-ai/deepagents)

**Priority: HIGH | 40+ commits | Tags: deepagents==0.5.0, 0.5.1, cli==0.0.35**

### Major New Features

1. **langchain-repl (new package)** -- Embedded REPL middleware for LangChain. Experimental interpreter (spiritual continuation of kork). Provides foreign function docs and middleware integration. This is a new execution surface for agents.

2. **better-harness (new example)** -- Autonomous harness optimization system inspired by Karpathy's autoresearch. One Deep Agent improves another agent's harness surfaces (prompt, tools, skills, middleware) using train/holdout eval splits. Includes:
   - Proposer workspace pattern (outer agent edits surfaces, inner agent gets tested)
   - Module_attr patching for Python attributes
   - Workspace_file replacement for eval runs
   - TOML-based experiment configuration

3. **Skill invocation in CLI** -- `/skill:name` slash command and `--skill` startup flag. Skills are composable extension points for domain-specific agent behaviors.

4. **CLI performance: sub-250ms first paint** -- Aggressive import deferral (pydantic, adapters, heavy SDK modules), markdown stack prewarming, reduced health-poll intervals.

5. **Notification settings widget** -- New notification configuration UI in the CLI.

6. **Auto-update lifecycle** -- `/update` command, `/auto-update` toggle, refreshed install script UX.

7. **Themes system** -- Color overrides on built-in themes, configurable dark mode default.

### SDK Changes

- `artifacts_root` added to `CompositeBackend` and middleware
- `BASE_AGENT_PROMPT` tweaks
- Multimodal updates
- Token count persistence in graph state across sessions
- Filesystem middleware improvements (summarization, subagents)

### Eval Infrastructure

- LLM-powered failure analysis in eval CI
- Eval failure analysis script (`analyze_eval_failures.py`)
- Radar chart generation improvements
- Pytest reporter for structured eval output
- Partner bounds checking workflow

### WOTANN Relevance

- **better-harness pattern** is directly applicable to WOTANN's eval infrastructure (TerminalBench). The train/holdout split and surface-editing loop is a clean pattern for autonomous agent improvement.
- **Skill invocation via /skill:name** mirrors WOTANN's planned skill dispatch. Their implementation of `skills/invocation.py` is worth studying.
- **Sub-250ms first paint** technique (deferred imports, markdown prewarming) is relevant to WOTANN's TUI performance target.
- **Token count persistence across sessions** is relevant to WOTANN's context management.

### Recent Commits

```
0cc27b1 ci(infra): drop claude-sonnet-4, enable release integration test
0b6eca6 docs(infra): backfill package labels and restructure AGENTS.md
c44eab0 ci(infra): pin all github actions to commit SHAs
3d5d673 fix(sdk): catch PermissionError in FilesystemBackend ripgrep
2253524 feat(examples): Add standalone better-harness example
4999c6b fix(quickjs): prompt improvements
50fb8ae fix(cli): fail fast on missing provider credentials
3dff3ed feat(cli): warn on missing tavily key, add /notifications
668414f feat(evals): add LLM-powered failure analysis to eval CI
```

---

## deer-flow (bytedance/deer-flow)

**Priority: HIGH | 27 commits | 145 files changed, +9267/-1281 lines**

### Major New Features

1. **PDF upload pipeline** -- PyMuPDF4LLM converter with auto-fallback and async offload. Document outline injection into agent context for converted files. Agentic search guidance for uploaded documents.

2. **Sandbox hardening** -- Strengthened bash command auditing with compound command splitting and expanded patterns. Input sanitisation guard on SandboxAuditMiddleware. Truncation of oversized bash and read_file tool outputs.

3. **Per-agent skill filtering** -- `available_skills` parameter on DeerFlowClient allows restricting which skills each agent can use.

4. **New public skills added:**
   - `academic-paper-review`
   - `code-documentation`
   - `newsletter-generation`

5. **WeChat Enterprise (WeCom) channel** -- Full 394-line WeCom integration added to the channel manager.

6. **Read-only local sandbox path mappings** -- Local sandbox now supports read-only mounted paths.

7. **Built-in grep and glob tools** -- Added native grep/glob tools to the sandbox environment.

8. **Optional Langfuse tracing support** -- Alternative to LangSmith for observability.

### Middleware Changes

- ClarificationMiddleware now handles string-serialized options
- Loop detection uses stable hash keys for tool calls
- DanglingToolCallMiddleware enabled for subagents
- Memory middleware improvements (case-insensitive dedup, positive reinforcement detection)
- Uploads middleware expanded for document outlines

### WOTANN Relevance

- **Per-agent skill filtering** aligns with WOTANN's planned skill dispatch per agent tier. The `available_skills` parameter is a clean API to study.
- **Sandbox audit middleware** pattern (compound command splitting, input sanitisation) is relevant to WOTANN's security model.
- **Document outline injection** is a useful pattern for WOTANN's Workshop tab (file context).
- **Loop detection via stable hash keys** solves the same agent-loop problem WOTANN will face.
- **Built-in grep/glob tools** validates WOTANN's plan to provide native file search capabilities.

### Recent Commits

```
ddfc988 feat(uploads): add pymupdf4llm PDF converter with auto-fallback
5ff230e feat(uploads): inject document outline into agent context
1694c61 feat(sandbox): add read-only support for local sandbox path mappings
c6cdf20 feat(sandbox): add built-in grep and glob tools
76fad8b feat(client): add available_skills parameter to DeerFlowClient
f8fb8d6 feat/per agent skill filter
2d1f90d feat(tracing): add optional Langfuse support
df5339b feat(sandbox): truncate oversized bash and read_file tool outputs
3b3e8e1 feat(sandbox): strengthen bash command auditing
```

---

## hermes-agent (NousResearch/hermes-agent)

**Priority: HIGH | 100 commits | Required re-clone (force-pushed history)**

### Major New Features

1. **Unified spawn-per-call execution layer** -- Major refactor replacing previous execution model with a unified spawn-per-call approach. All environments use a consistent execution pattern.

2. **Context compression improvements** -- Named constants, tool tracking during compression, degradation warnings. Tiered context pressure warnings with gateway deduplication.

3. **New providers:**
   - **Voxtral Transcribe STT** (Mistral AI) -- Speech-to-text via mistralai SDK
   - **Qwen OAuth provider** with portal request support

4. **Platform features:**
   - Discord: Forum channel topic inheritance in thread sessions, reply-to mode setting, ignored/no-thread channel config
   - Telegram: Message reactions on processing start/complete, group_topics skill binding for supergroup forum topics, proxy support
   - Feishu: Interactive card approval buttons
   - Slack: Thread engagement (auto-respond in bot-started and mentioned threads), approval buttons

5. **Gateway improvements:**
   - Staged inactivity warning before timeout escalation
   - Approval buttons for Slack and Telegram with thread context
   - OpenRouter variant tag preservation (:free, :extended, :fast) during model switch
   - Conversation history support in /v1/runs API

6. **Thinking-only prefill continuation** -- Structured reasoning responses with thinking-only prefill.

7. **SuperMemory multi-container support** -- Search mode, identity templates, and env var overrides.

8. **Cron job enhancements** -- Delivery failure tracking, media file delivery as native platform attachments.

### Security Fixes

- Consolidated security hardening: SSRF, timing attacks, tar traversal, credential leakage
- Persistent sandbox environments survive between turns
- Invalid command value guards

### Code Quality

- Massive cleanup: 24 dead functions removed (432 lines), 57 CI test fixes, 40+ documentation discrepancies fixed, codebase-wide lint cleanup.

### WOTANN Relevance

- **Spawn-per-call execution** is a strong pattern for WOTANN's tool execution model -- clean isolation per invocation.
- **Tiered context pressure warnings** with deduplication is directly applicable to WOTANN's context management system.
- **Approval buttons for Slack/Telegram** demonstrates multi-platform human-in-the-loop patterns.
- **Thinking-only prefill continuation** is relevant to WOTANN's structured reasoning features.
- **Cron delivery failure tracking** is relevant to WOTANN's scheduled task execution.

### Recent Commits (selection)

```
e94008c fix(terminal): guard invalid command values
e7d3e9d fix(terminal): persistent sandbox envs survive between turns
54db7cb fix(agent): tiered context pressure warnings + gateway dedup
ffeaf6f feat(discord): inherit forum channel topic in thread sessions
8567031 fix: improve context compression quality
d684d7e feat(environments): unified spawn-per-call execution layer
5f4b93c feat(tools): add Voxtral Transcribe STT provider
3377017 feat(qwen): add Qwen OAuth provider with portal request support
ab0c1e5 fix: pause typing indicator during approval waits
1a2a03c feat(gateway): approval buttons for Slack & Telegram + thread context
ab8f9c0 feat: thinking-only prefill continuation for structured reasoning
```

---

## oh-my-openagent (code-yeongyu/oh-my-openagent)

**Priority: MEDIUM | 187 commits | Tags: v0.1.x through v3.16.0**

### Major Changes

1. **v3.x release train** -- Massive version progression from v0.1.x through v3.16.0 in 11 days. This indicates a major rewrite/maturation of the project.

2. **Prepublish hardening** -- 6 separate fix PRs for prepublish:
   - Legacy config migration (atomic with temp-file + rename)
   - Quality checks
   - tmux regressions
   - Background agent regressions
   - Security hardening (tar hard-link targets, zip entry validation)
   - MCP regressions

3. **tmux isolation improvements** -- Grace periods before resetting isolation, deferred failed container spawns, re-attempt on deferred session retry.

4. **Background agent improvements** -- Bounded session abort waits, timeout handling.

5. **Plugin system consolidation** -- Merged project and user opencode plugin detection, shared legacy migration helpers, removed unused openclaw hook.

6. **MCP fixes** -- Honor disabled server overrides in system name discovery, handle missing Tavily API key gracefully, user config overrides Claude Code .mcp.json with collision warnings.

7. **Security** -- Archive preflight security (tar hard-link validation), tool_use/tool_result pair validator to prevent API errors.

### WOTANN Relevance

- **Atomic config migration** pattern (temp-file + rename) is the right approach for WOTANN's config management.
- **tmux isolation with grace periods** is relevant to WOTANN's terminal session management.
- **tool_use/tool_result pair validator** is a defensive pattern WOTANN should implement to prevent malformed API calls.
- **Archive preflight security** (tar hard-link validation) is relevant to any file-handling features.
- **Background agent abort timeout** pattern is useful for WOTANN's agent lifecycle management.

### Recent Commits (selection)

```
141881aa fix(tmux): re-attempt isolated container on deferred session retry
f547cd01 refactor(shared): consolidate plugin entry migration and detection
fd252ea8 refactor: remove AI-generated code smells from prepublish changes
02b7a7d3 refactor(hooks): remove unused openclaw hook
146ca34a fix(hooks): use actual context window token counts
ccbd646a fix(shared): validate tar hard-link targets during preflight
67145b53 fix(mcp): honor disabled server overrides in system name discovery
2440ed9a fix(hook): add tool_use/tool_result pair validator
94189271 fix(config): make plugin entry migration atomic with temp-file + rename
624a6bec fix(commands): use dynamic base branch and safe rollback
```

---

## agents (wshobson/agents)

**Priority: MEDIUM | ~20 commits | New plugins added**

### Key Changes

1. **New plugin: block-no-verify** -- Hook that prevents skipping git hooks via `--no-verify`. Includes a full SKILL.md with 193 lines of implementation guidance.

2. **New plugin: documentation-standards** -- HADS (Hardened Automated Documentation Standard) plugin with 189-line SKILL.md.

3. **Marketplace.json** -- New marketplace manifest for plugin discovery.

4. **Agent-teams tool name fixes** -- Proper tool names in agent-teams commands.

5. **Pensyve plugin added** -- Using git-subdir source for subdirectory plugin loading.

### WOTANN Relevance

- **Marketplace.json** is a useful pattern for WOTANN's plugin/skill discovery system.
- **block-no-verify hook implementation** demonstrates the pattern WOTANN already uses but provides a reference implementation.
- **HADS documentation standard** could inform WOTANN's documentation automation.

### Recent Commits

```
03d0b4b docs: refresh counts and add missing sections after recent plugin merges
e98c1ae fix: agent-teams proper tool names
0a9441b feat: add block-no-verify hook
0546fdd feat: add HADS documentation standard
e323a36 chore: add Pensyve plugin, update counts
```

---

## ruflo (ruvnet/ruflo)

**Priority: LOW | ~20 commits | Active development despite low priority**

### Key Changes

1. **DiskANN vector search backend** -- New vector search backend with benchmark (ADR-077). This is a significant addition for memory/retrieval.

2. **LongMemEval benchmark harness** -- ADR-088 adds a benchmark for long-term memory evaluation against AgentDB.

3. **Claude Code to AgentDB bridge** -- Phase 2 MCP tools for bridging Claude Code auto-memory to AgentDB vector search (ADR-076).

4. **Native ruvllm + graph-node intelligence backends** -- ADR-086, ADR-087 add new local inference backends.

5. **ESM migration** -- Eliminating bare require() calls in ESM modules, fixing ESM require crashes.

6. **Critical bug fixes** -- Cleanup data loss, CLI hang, daemon zombies, checkpoint verification.

### WOTANN Relevance

- **DiskANN vector search** is potentially relevant to WOTANN's memory system if local vector search is needed.
- **LongMemEval benchmark** could inform WOTANN's memory evaluation strategy.
- **Claude Code to AgentDB bridge via MCP** is an interesting pattern for WOTANN's memory architecture.

### Recent Commits

```
b395d12 feat: ADR-088 LongMemEval benchmark harness for AgentDB
7eb505d feat: native ruvllm + graph-node intelligence backends
d851822 feat: DiskANN vector search backend with benchmark
6ed14d6 docs: update ADR-076 -- Phase 2 MCP tools, Phase 3 MicroLoRA
a1df9dd feat: bridge Claude Code auto-memory to AgentDB vector search
322b2ae fix: @claude-flow/browser peer dep, dist-tags, bump to alpha.3
bff8a34 fix: 4 critical bugs -- ReasoningBank, SQLite path, namespace, init hooks
5a5bfa6 fix: P0 daemon startup, ESM controller-registry, memory-bridge
```

---

## open-swe (langchain-ai/open-swe)

**Priority: MEDIUM | 13 commits**

### Key Changes

1. **Proxy authentication for git operations** -- Authenticate git operations via sandbox proxy instead of credential files. Then reverted and re-implemented as proxy config restoration.

2. **Minimal diff rules and scope planning** -- Added to agent prompt, then reverted. Indicates experimentation with constraining agent output scope.

3. **Security fixes** -- Shell injection and SSRF issues fixed, Pygments ReDoS and PyJWT critical header vulns patched.

4. **Proxy auth tests** -- New test suite for proxy authentication (172 lines).

### WOTANN Relevance

- **Proxy-based git auth** (instead of credential files) is a cleaner pattern for sandboxed environments.
- **Diff rules/scope planning** experiment suggests constraining agent diffs improves quality -- relevant to WOTANN's code generation.
- **Security hardening** (shell injection, SSRF) is standard but confirms these are real attack surfaces.

### Recent Commits

```
4d4f5fb fix: proxy config restored
9e5088b Revert "feat: add minimal diff rules and scope planning to agent prompt"
71b5736 feat: add minimal diff rules and scope planning to agent prompt
6305e13 feat: authenticate git operations via sandbox proxy
d350659 fix: upgrade deps to patch Pygments ReDoS and PyJWT crit header vulns
fd8e6d9 fix: Shell injection and ssrf issues
```

---

## claude-task-master (eyaltoledano/claude-task-master)

**Priority: MEDIUM | 1 commit | Effectively dormant this period**

### Key Changes

- Single version bump commit (`Version Packages #1677`). No feature or architecture changes.

---

## eigent (eigent-ai/eigent)

**Priority: LOW | 1 commit | Dormant**

- Single commit: `Update WeChat QR code via QR Code Updater`. No code changes.

---

## opcode (winfunc/opcode)

**Priority: DORMANT | 0 commits**

- No activity since October 2025. Confirmed dormant.

---

## Cross-Cutting Patterns for WOTANN

### Patterns appearing across multiple repos

1. **Skill/plugin invocation via slash commands** -- deepagents (`/skill:name`), deer-flow (per-agent filtering), agents (marketplace.json). WOTANN's skill dispatch is aligned with industry direction.

2. **Sandbox hardening is universal** -- deer-flow (compound command splitting), hermes-agent (spawn-per-call), open-swe (proxy auth, shell injection fixes), oh-my-openagent (tar preflight). Every active repo is investing in sandbox security.

3. **Context management** -- deepagents (token count persistence), hermes-agent (tiered context pressure warnings), oh-my-openagent (actual context window token counts in hooks). Context-awareness is being built into every layer.

4. **Autonomous improvement loops** -- deepagents (better-harness), ruflo (LongMemEval benchmark). Self-improving agent patterns are maturing.

5. **MCP as the integration protocol** -- ruflo (AgentDB bridge), oh-my-openagent (disabled server overrides, collision warnings), deer-flow (ACP/MCP payload fixes). MCP is becoming the standard integration surface.

6. **Performance optimization** -- deepagents (sub-250ms first paint via deferred imports). This technique applies directly to WOTANN's TUI.

### Priority recommendations for WOTANN

1. **Study deepagents better-harness** -- The train/holdout eval surface-editing loop is the most actionable new pattern. Located at `research/deepagents/examples/better-harness/`.

2. **Study hermes-agent spawn-per-call execution** -- Clean isolation model at `research/hermes-agent/` (look for `environments/` directory).

3. **Adopt tiered context pressure warnings** from hermes-agent -- Simple, high-value feature.

4. **Study deer-flow per-agent skill filtering** -- The `available_skills` parameter is a minimal API for WOTANN's skill dispatch per agent tier.

5. **Import deferral for TUI performance** -- deepagents achieved sub-250ms first paint. Study their deferred import pattern.

---

## Sync Notes

- **hermes-agent required re-clone** -- The upstream force-pushed history, corrupting the local shallow clone. The old copy was moved to `/tmp/hermes-agent-old-trash`. The fresh clone uses `--depth=100`.
- **oh-my-openagent** jumped from pre-v1 to v3.16.0 in this period, indicating a major version bump on the dev branch.
- **REPOS.md last synced date** should be updated to 2026-04-09.
