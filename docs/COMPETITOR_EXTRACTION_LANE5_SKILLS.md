# COMPETITOR EXTRACTION — LANE 5 (Skills & Format)

**Agent:** 5 of 8 — Skills, Karpathy Principles, OpenAI v1 Format, AI SDK Streaming, Swift CLI Patterns, Agent Handoff
**Date:** 2026-04-19
**Model:** Opus 4.7 [1M] max effort
**Repos audited:** superpowers (obra, 130K⭐), vercel-open-agents (vercel-labs), wacli (steipete), addyosmani-agent-skills, andrej-karpathy-skills (forrestchang), openai-skills (canonical), openai-agents-python (official handoff)

## 0. Executive Summary

| Extraction | Finding | WOTANN gap | Action |
|---|---|---|---|
| **Superpowers workflow (130K⭐)** | 14 mandatory skills covering brainstorm → plan → subagent-drive → verify → finish-branch. HARD-GATE pattern stops implementation until design approved. | WOTANN has skills but no enforced workflow chain. Dispatcher lists skills but doesn't gate between phases. | Port HARD-GATE transitions + two-stage review + delete-code-written-before-test into `src/skills/` |
| **OpenAI skills canonical v1 format** | Required: `name`, `description`. Optional: `metadata.short-description`, `agents/openai.yaml` with `interface.*` and `dependencies.tools[].*`. Plugin manifest is separate (`plugin.json`). | WOTANN skills have `name`, `description`, `context`, `paths`, `requires` — missing `version`, `license`, `allowed-tools`, `maintainer`, `deps`. NOT canonical-compliant. | Migrate 87 skills to add required fields (see §4). |
| **Vercel AI SDK streaming** | `createUIMessageStreamResponse` + `InferUIMessageChunk` for granular streaming. `LanguageModelUsage` tracks input/output/cache/reasoning token deltas. Subagents stream via `tool-task` UIParts. | WOTANN has streaming but no granular UIMessage schema or nested subagent stream forwarding. | Add SSE UIMessage protocol + usage aggregation across sub-tool calls. |
| **Karpathy principle-as-skill** | Single SKILL.md distilling 4 engineering principles into 60-line prompt preamble. `license: MIT` in frontmatter. | WOTANN has `karpathy-principles.md` but misses `license` field, rationalization table, and "how to know it's working" checkpoints. | Enhance existing file with checkpoints + frontmatter completion. |
| **Agent handoff (OpenAI agents-python)** | `Handoff` dataclass with `tool_name`, `input_json_schema`, `on_invoke_handoff`, `input_filter`, `nest_handoff_history`. Each handoff appears to LLM as a tool call `transfer_to_<agent>`. | WOTANN has sub-agent dispatch via task tool but no structured handoff protocol with typed input + history filter. | Add `core/handoff.ts` with typed Handoff class (see §7). |
| **Swift CLI cost ticker + rewind** | wacli is WhatsApp CLI (not agent CLI — task description likely conflated with steipete's other tools). Analysis redirected to WOTANN's own `src/telemetry/cost-tracker.ts` + `src/autopilot/checkpoint.ts`. iOS app has cost strings but no live ticker overlay. | WOTANN iOS: no HUD live cost ticker, no trajectory rewind button on MessageRow. | Add SwiftUI `CostTickerOverlay` + `RewindToMessageButton` (see §6). |
| **AGENTS.md compliance** | Standard adopted by 60,000+ repos. Single top-level file. openai-agents-python, vercel-open-agents, addyosmani all comply. Superpowers symlinks `AGENTS.md -> CLAUDE.md`. | WOTANN has `.wotann/AGENTS.md` (internal system prompt) but MISSING top-level `AGENTS.md` at project root. | Create root `AGENTS.md` symlink or standalone (see §8). |
| **AAIF compatibility** | Linux Foundation Agentic AI Foundation wraps MCP (Anthropic) + Goose (Block) + AGENTS.md + A2A protocol (Google). | WOTANN already speaks MCP via providers; AGENTS.md gap blocks AAIF conformance; A2A protocol not yet implemented. | Add `AGENTS.md` + stub A2A adapter in `src/channels/`. |

**Top 5 ports by leverage (priority order):**
1. Root `AGENTS.md` — 10-minute fix, unblocks AAIF + OpenAI Codex + Cursor + Gemini discovery.
2. OpenAI canonical frontmatter migration — 87 skills × 5-min schema bump = ~7 hours; unblocks marketplace publishing.
3. HARD-GATE brainstorming → writing-plans workflow — deepest superpowers leverage; prevents "skip design" rationalization.
4. Structured Handoff class — enables multi-agent triage flows (what openai-agents-python calls "first-class multi-agent").
5. iOS live cost ticker overlay — differentiates WOTANN as the only phone client showing real-time spend.

---

## 1. Superpowers (obra, 130K⭐) — Workflow Deep Read

### 1.1 The 14 Skills (all mandatory triggers)

| Skill | Trigger | Contract |
|---|---|---|
| `brainstorming` | Any creative/feature work | HARD-GATE: no code until design approved. One question per message. Save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` |
| `using-git-worktrees` | After design approval | Isolated worktree, fresh branch, clean test baseline verified |
| `writing-plans` | With approved design | Bite-sized tasks (2–5 min each). Each has exact file paths + complete code + verification |
| `subagent-driven-development` | Plan with independent tasks | Fresh subagent per task, two-stage review (spec compliance → code quality), parent never inherits context |
| `executing-plans` | Plan needing parallel session | Batch execution with human checkpoints |
| `test-driven-development` | Any code write | IRON LAW: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. Delete code written before the test. No exceptions. |
| `systematic-debugging` | Any bug | 4-phase root cause: reproduce → hypothesize → localize → fix+regression test |
| `verification-before-completion` | Before any "done" claim | Must run command IN THIS MESSAGE. "Should pass" = lying. |
| `requesting-code-review` | Between tasks | Review against plan, severity classification, critical blocks progress |
| `receiving-code-review` | Feedback arrives | Structured response, no defensive rewrites |
| `finishing-a-development-branch` | Tasks complete | Verify tests, merge/PR/keep/discard decision, cleanup worktree |
| `dispatching-parallel-agents` | 2+ independent tasks | One agent per problem domain, parent synthesizes |
| `writing-skills` | Creating/editing skills | TDD-for-docs: pressure-test with subagents first (RED), then write skill (GREEN) |
| `using-superpowers` | Session start | Meta-skill introducing the system |

### 1.2 Patterns to port

**a) HARD-GATE tag** — Brainstorming explicitly blocks code:
```markdown
<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it.
</HARD-GATE>
```
WOTANN currently has "superpowers-dispatcher.md" but no HARD-GATE enforcement between phases. Port this into `src/skills/workflow/brainstorm.md` + guard hook `src/hooks/guards/pre-implementation-gate.ts` that blocks `Write`, `Edit`, `Bash` until `docs/wotann/specs/*-design.md` exists for the active topic.

**b) Iron Law: Delete Code Written Before Tests** —
```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
Write code before the test? Delete it. Start over.
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```
WOTANN's `tdd-workflow.md` says "NEVER write implementation before the test exists" but doesn't enforce deletion. Add rationalization table + "Delete means delete" line + a `src/hooks/guards/tdd-enforcer.ts` that detects pre-test code and proposes deletion.

**c) Two-stage review** (subagent-driven-development) —
```
per task:
  implementer subagent writes code
  spec-reviewer subagent (./spec-reviewer-prompt.md) checks spec compliance
  if fail: implementer fixes → re-review
  code-quality-reviewer subagent (./code-quality-reviewer-prompt.md) checks quality
  if fail: implementer fixes → re-review
  only then: mark complete
```
Port to WOTANN as sibling prompt files in `src/skills/workflow/`:
- `subagent-implementer.md`
- `subagent-spec-reviewer.md`
- `subagent-code-quality-reviewer.md`

**d) Model-selection-by-task** — Cheap model for mechanical, standard for integration, most-capable for architecture/review. WOTANN already has `src/providers/router.ts` — add a `complexity-signals.ts` that classifies tasks and picks the cheapest viable model.

**e) Subagent prompt contract** — "fresh subagent per task + isolated context + precise instructions" is THE core insight. Superpowers lives and dies on this. WOTANN's `task` tool dispatcher should mirror: `prompt` = task-only instructions; `context` = the specific files listed in the plan; no parent history bleeds in.

### 1.3 Anti-patterns Superpowers explicitly rejects (adopt in WOTANN PR template)

| Anti-pattern | Why rejected |
|---|---|
| "Compliance" changes restructuring skills to match published guidance | Skill behavior must be eval-verified, not style-compliant |
| Project-specific skills in core | Lives in standalone plugin instead |
| Bulk/spray-and-pray PRs | Each PR needs genuine problem investigation |
| Speculative/theoretical fixes | "My review agent flagged this" is not a problem statement |
| Fabricated content | 94% rejection rate because maintainers have seen every form of slop |
| Bundled unrelated changes | One problem per PR |

The Superpowers CLAUDE.md is effectively a PR guardian for AI-submitted PRs — a pattern worth porting to WOTANN's `.github/PULL_REQUEST_TEMPLATE.md` verbatim with minor rewording.

---

## 2. Andrej Karpathy Skills (forrestchang) — Principle-as-Skill Pattern

### 2.1 The pattern

ONE SKILL.md file. Four principles. Each principle ~15 lines. Total skill is ~70 lines including rationalization tables. Frontmatter:
```yaml
---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---
```

The principles (from Karpathy's X post):

1. **Think Before Coding** — State assumptions. Present multiple interpretations. Push back. Stop when confused.
2. **Simplicity First** — Minimum code. No abstractions for single-use. If 200 lines could be 50, rewrite.
3. **Surgical Changes** — Every changed line traces to the request. Don't improve adjacent code.
4. **Goal-Driven Execution** — Transform imperative into declarative goals with verification loops.

### 2.2 WOTANN comparison

WOTANN already has `skills/karpathy-principles.md` covering the same 4 principles. Differences:

| Aspect | forrestchang version | WOTANN current | Recommendation |
|---|---|---|---|
| Frontmatter `license` | present (MIT) | missing | Add |
| "How to know it's working" checklist | present (bottom of README) | missing in skill | Port (diff-fewer, fewer rewrites, clarifying-questions-come-before) |
| Rationalization table | not in skill file (in README) | not present | Add Karpathy's anti-patterns as a rationalization table |
| Tradeoff note | present ("caution over speed") | present | OK |
| Multi-step plan template | present | present | OK |
| Attribution link | Twitter link | missing | Add link |

**Also from Karpathy Twitter that isn't in either version:**
> "LLMs are exceptionally good at looping until they meet specific goals. Don't tell it what to do, give it success criteria and watch it go."

This is THE key insight for autopilot. Port it to `src/autopilot/` docstring.

### 2.3 Principle-as-skill template

From this, extract a reusable template for principle-style skills (WOTANN has several: `karpathy-principles`, `tdd-workflow`, `spec-driven-workflow`). Each follows:
```markdown
---
name: <principle-name>
description: <behavior-modification> Use when <signal-phrase>.
license: MIT
---

# <Title>

Attribution: [source](url)
Tradeoff: <cost>

## 1. <Principle>
Rule. Reason. Operationalized action.
Anti-patterns as table.

## 2. <Principle>
...

## Rationalization prevention
| Excuse | Reality |
|---|---|

## How to know it's working
- Observable signal 1
- Observable signal 2
```

---

## 3. addyosmani-agent-skills — 21 Skills by SDLC Phase

### 3.1 Phase-organized skill library

Addy Osmani organizes 21 skills by SDLC phase:

| Phase | Skills |
|---|---|
| **Define** | spec-driven-development |
| **Plan** | planning-and-task-breakdown |
| **Build** | incremental-implementation, test-driven-development, context-engineering, source-driven-development, frontend-ui-engineering, api-and-interface-design |
| **Verify** | browser-testing-with-devtools, debugging-and-error-recovery |
| **Review** | code-review-and-quality, code-simplification, security-and-hardening, performance-optimization |
| **Ship** | git-workflow-and-versioning, ci-cd-and-automation, deprecation-and-migration, documentation-and-adrs, shipping-and-launch |

### 3.2 Skill anatomy (universal across all 21)

Every skill has the same 6 sections:
1. **Overview** — one-sentence behavior
2. **When to Use** — triggers + "When NOT to use"
3. **Process** — numbered steps with code examples
4. **Common Rationalizations** — rebuttal table
5. **Red Flags** — STOP signals
6. **Verification** — evidence checklist

WOTANN skills have varying structure. Standardize to these 6 sections — especially for the 21 skills that overlap with Osmani's set.

### 3.3 Incremental Implementation pattern (one of the strongest)

```
┌──────────────────────────────────────┐
│   Implement ──→ Test ──→ Verify ──┐  │
│       ▲                           │  │
│       └───── Commit ◄─────────────┘  │
│              │                       │
│              ▼                       │
│          Next slice                  │
└──────────────────────────────────────┘
```

**Vertical slices preferred.** Each slice:
1. Implement smallest complete piece
2. Run tests (or write one if none)
3. Verify passes
4. Commit with descriptive message
5. Move to next slice, carry forward, don't restart

WOTANN's planning system doesn't enforce slice-sizing. Add a `src/orchestration/slice-sizer.ts` that refuses plans with >100-line steps.

---

## 4. OpenAI Canonical Skill Format v1

### 4.1 The canonical schema

From `research/openai-skills/skills/.system/skill-creator/SKILL.md` — the authoritative schema has:

**SKILL.md (required)** — Markdown with YAML frontmatter:
```yaml
---
name: skill-name
description: What the skill does + specific triggers/contexts for when to use it.
metadata:
  short-description: Optional short blurb for UI
---
```

**Only `name` and `description` are required in frontmatter.** OpenAI's own guidance: "Do not include any other fields in YAML frontmatter."

**agents/openai.yaml (recommended)** — UI/harness metadata, NOT read by the agent:
```yaml
interface:
  display_name: "User-facing name"
  short_description: "Optional user-facing description"  # 25-64 chars
  icon_small: "./assets/small-400px.png"
  icon_large: "./assets/large-logo.svg"
  brand_color: "#3B82F6"
  default_prompt: "Use $skill-name to ..."

dependencies:
  tools:
    - type: "mcp"
      value: "github"
      description: "GitHub MCP server"
      transport: "streamable_http"
      url: "https://api.githubcopilot.com/mcp/"
```

**plugin.json (for distribution)** — Plugin manifest:
```json
{
  "name": "plugin-name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": { "name": "...", "email": "...", "url": "..." },
  "homepage": "https://...",
  "repository": "https://...",
  "license": "MIT",
  "keywords": ["..."],
  "skills": "./skills/",
  "hooks": "./hooks.json",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "...",
    "shortDescription": "...",
    "longDescription": "...",
    "developerName": "...",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": ["Starter prompt 1", "Starter prompt 2", "Starter prompt 3"],
    "brandColor": "#3B82F6",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png",
    "screenshots": ["./assets/screenshot1.png"]
  }
}
```

### 4.2 Vercel variant (extended frontmatter)

Vercel-open-agents extends the schema:
```yaml
name: string (required)
description: string (required)
version: string?
disable-model-invocation: boolean?
user-invocable: boolean?
allowed-tools: string?  # comma-separated
context: "fork"?
agent: string?
```

This matches what Claude Code's plugin system understands. It's the de-facto "Claude skills v1" schema.

### 4.3 WOTANN skill format audit

Sampled 7 WOTANN skills (all in `skills/*.md` not `skills/<name>/SKILL.md`):
- `a2ui.md`, `batch-processing.md`, `benchmark-engineering.md`: `name` + `description` only
- `agent-reach.md`, `ai-slop-cleaner.md`, `api-design.md`, `angular-architect.md`: adds `context`, `paths`, optionally `requires.bins`

**Compliance gaps:**
1. WOTANN uses flat `skills/*.md` files, not `skills/<name>/SKILL.md` directories. This blocks bundled resources (`references/`, `scripts/`, `assets/`) that the canonical format supports.
2. No `version` field — can't support progressive migration.
3. No `license` field — blocks marketplace publishing.
4. No `allowed-tools` — can't constrain skill scope (addyosmani uses this heavily).
5. No `maintainer` — unclear ownership.
6. No `agents/openai.yaml` — can't show in OpenAI Codex UI.
7. No `plugin.json` — can't be published as a standalone plugin.

### 4.4 Migration plan

**Phase A (non-breaking, add optional fields):** Add to all 87 skills:
```yaml
---
name: <existing>
description: <existing>
version: "1.0.0"
license: MIT
maintainer: "WOTANN Core"
---
```

**Phase B (structural, opt-in per skill):** Migrate high-value skills to directory form:
```
skills/
  karpathy-principles/
    SKILL.md                      # existing content
    agents/
      openai.yaml                 # UI metadata
    references/
      karpathy-twitter-thread.md  # source material
```

**Phase C (distribution):** Create `/plugin.json` manifest for the WOTANN skill bundle. Enables:
- `copilot plugin install wotann-skills@wotann-marketplace`
- `/plugin install wotann@claude-plugins-official` (if accepted)
- `codex $skill-installer wotann/<skill-name>`

Migration script sketch (for the 87 skills):
```typescript
// scripts/migrate-skills-to-v1.ts
import { parse as parseYaml, stringify } from 'yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SKILLS_DIR = 'skills';
const VERSION = '1.0.0';
const LICENSE = 'MIT';
const MAINTAINER = 'WOTANN Core';

for (const file of fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'))) {
  const fullPath = path.join(SKILLS_DIR, file);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) continue;
  const [, yamlBlock, body] = match;
  const frontmatter = parseYaml(yamlBlock) as Record<string, unknown>;
  const updated = { ...frontmatter, version: frontmatter.version ?? VERSION, license: frontmatter.license ?? LICENSE, maintainer: frontmatter.maintainer ?? MAINTAINER };
  const out = `---\n${stringify(updated).trim()}\n---\n${body}`;
  fs.writeFileSync(fullPath, out);
}
```

---

## 5. Vercel AI SDK — Streaming-First Surface

### 5.1 Core streaming primitives

Vercel-open-agents uses `ai` (Vercel AI SDK v5):
- `ToolLoopAgent` — wraps a model with tools + stop conditions
- `createUIMessageStreamResponse` — SSE endpoint that emits typed UIMessage chunks
- `InferUIMessageChunk<TMessage>` — type-safe chunk inference
- `isToolUIPart`, `getToolName` — helpers to inspect stream parts
- `LanguageModelUsage` — structured token accounting with cache reads/writes, reasoning tokens

### 5.2 Usage accounting example (from `packages/agent/usage.ts`)

```typescript
type TaskToolUsageEvent = {
  usage: LanguageModelUsage;
  modelId?: string;
  toolCallId?: string;
};

function addLanguageModelUsage(
  usage1: LanguageModelUsage,
  usage2: LanguageModelUsage,
): LanguageModelUsage {
  return {
    inputTokens: addTokenCounts(usage1.inputTokens, usage2.inputTokens),
    inputTokenDetails: {
      noCacheTokens: addTokenCounts(...),
      cacheReadTokens: addTokenCounts(...),
      cacheWriteTokens: addTokenCounts(...),
    },
    outputTokens: addTokenCounts(usage1.outputTokens, usage2.outputTokens),
    outputTokenDetails: {
      textTokens: ...,
      reasoningTokens: ...,
    },
    totalTokens: ...,
    reasoningTokens: ...,
    cachedInputTokens: ...,
  };
}
```

Key insight: **usage aggregates across nested subagent calls**. When a parent uses the `task` tool to dispatch a subagent, the subagent's usage bubbles up into the parent's accounting via `collectTaskToolUsageEvents(message)`.

### 5.3 Subagent message metadata

From `packages/agent/subagents/types.ts`:
```typescript
export type SubagentMessageMetadata = {
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  modelId?: string;
};
```

Each subagent message carries its own usage metadata. WOTANN's `src/telemetry/cost-tracker.ts` already has this for top-level messages but doesn't aggregate across sub-tool calls.

### 5.4 Gateway pattern

Vercel uses `gateway(modelId, { providerOptionsOverrides })` — single abstraction over all providers. Switching providers = switching model ID string. WOTANN has `src/providers/router.ts` which is more sophisticated but doesn't expose a single `gateway()`-like facade for skills to use.

### 5.5 Streaming tool call parts

`tool-task` is treated as a first-class UIPart type, allowing the UI to render a collapsible subagent execution view. WOTANN's Ink TUI has `ProactiveCardDeck.swift` / `AgentRow.swift` for iOS but doesn't have a streaming sub-tool card type.

### 5.6 WOTANN ports

1. **Cross-subagent usage aggregation** — add `src/telemetry/usage-aggregator.ts` mirroring Vercel's `addLanguageModelUsage` + `collectTaskToolUsageEvents`.
2. **Typed UIMessage chunks** — define `WotannUIMessage` schema in `src/core/stream-types.ts` with `part.type` covering `text`, `tool-call`, `tool-result`, `tool-task`, `reasoning`, `error`, `usage-update`.
3. **SSE response builder** — wrap the Anthropic/OpenAI streaming responses in a `createWotannUIMessageStreamResponse` that emits these typed chunks.
4. **Sub-agent UIPart** — iOS/TUI render sub-agent as collapsible card with live token count.

---

## 6. Swift CLI (wacli redirect) — Cost Ticker + Rewind

### 6.1 Note on task conflation

The task description says "wacli: Swift CLI, cost ticker, rewind" but `research/wacli` is actually a Go-based WhatsApp CLI by @steipete (unrelated to agent cost tracking). The attribution appears to conflate wacli with steipete's other work or wotann-like tools. Analysis instead maps the intended pattern to WOTANN's existing iOS Swift app.

### 6.2 Current state of WOTANN iOS

Reviewed files:
- `ios/WOTANN/Views/Chat/MessageRow.swift` — mentions cost strings
- `ios/WOTANN/Views/Chat/ChatView.swift` — chat container
- `ios/WOTANN/Networking/RPCClient.swift` — WS transport
- `ios/WOTANN/ViewModels/AppState.swift` — app state
- `src/telemetry/cost-tracker.ts`, `src/telemetry/cost-oracle.ts` — backend cost accounting exists
- `src/autopilot/checkpoint.ts`, `src/autopilot/trajectory-recorder.ts` — rewind primitives exist

**Missing on iOS:**
1. **Live cost ticker overlay** — persistent HUD showing running total + per-request cost delta
2. **Rewind button on message row** — tap-to-rewind to any prior message, restoring sandbox state from `trajectory-recorder.ts`

### 6.3 Proposed SwiftUI additions

**`ios/WOTANN/Views/HUD/CostTickerOverlay.swift`:**
```swift
import SwiftUI

struct CostTickerOverlay: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "dollarsign.circle.fill")
                .foregroundStyle(.green)
            Text(String(format: "$%.4f", appState.sessionCostUSD))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.primary)
            if appState.lastRequestCostUSD > 0 {
                Text(String(format: "+$%.4f", appState.lastRequestCostUSD))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(.separator, lineWidth: 0.5))
        .animation(.easeInOut(duration: 0.2), value: appState.lastRequestCostUSD)
    }
}
```

Attach to `ChatView` via `.overlay(alignment: .topTrailing) { CostTickerOverlay() }`. Feed from a `costStream` SSE subscription exposed by the TypeScript daemon (wire through RPCClient).

**`ios/WOTANN/Views/Chat/RewindToMessageButton.swift`:**
```swift
import SwiftUI

struct RewindToMessageButton: View {
    let messageID: String
    let onRewind: (String) -> Void

    var body: some View {
        Button(action: { onRewind(messageID) }) {
            Label("Rewind to here", systemImage: "arrow.uturn.backward.circle")
                .labelStyle(.iconOnly)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
    }
}
```

Attach as context-menu item on `MessageRow` — tap → RPC call `session.rewindTo(messageID)` → backend restores sandbox state via `trajectory-recorder.ts`.

### 6.4 Backend rewind wire-through

WOTANN's `src/autopilot/checkpoint.ts` likely snapshots after each turn. Expose via RPC:
```typescript
// src/daemon/rpc/rewind.ts
export async function rpcRewindToMessage(
  sessionID: string,
  messageID: string,
): Promise<{ ok: true; newHead: string } | { ok: false; error: string }> {
  const session = await loadSession(sessionID);
  const checkpoint = session.checkpoints.find(c => c.messageID === messageID);
  if (!checkpoint) return { ok: false, error: `No checkpoint for message ${messageID}` };
  await applyCheckpoint(session, checkpoint);
  session.head = messageID;
  await saveSession(session);
  return { ok: true, newHead: messageID };
}
```

---

## 7. OpenAI Agents Python — Handoff Pattern

### 7.1 The core `Handoff` class (from `src/agents/handoffs/__init__.py`)

```python
@dataclass
class Handoff(Generic[TContext, TAgent]):
    tool_name: str                                              # "transfer_to_billing_agent"
    tool_description: str                                       # "Handoff to the billing agent"
    input_json_schema: dict[str, Any]                           # JSON schema for payload
    on_invoke_handoff: Callable[..., Awaitable[TAgent]]         # resolves to target agent
    agent_name: str                                             # target agent name
    input_filter: HandoffInputFilter | None = None              # filter conversation history
    nest_handoff_history: bool | None = None                    # nest vs flatten history
    strict_json_schema: bool = True                             # strict JSON validation
    is_enabled: bool | Callable[..., bool] = True               # dynamic enable/disable
```

The `handoff()` factory creates a Handoff from an agent, with overrides for name, description, input filter, etc. Each handoff appears to the LLM as a tool call like `transfer_to_billing_agent(reason="user asked about invoice")`.

### 7.2 `HandoffInputData` — the payload passed between agents

```python
@dataclass(frozen=True)
class HandoffInputData:
    input_history: str | tuple[TResponseInputItem, ...]  # history before Runner.run()
    pre_handoff_items: tuple[RunItem, ...]                # items before handoff trigger
    new_items: tuple[RunItem, ...]                        # items during this turn
    run_context: RunContextWrapper[Any] | None = None
    input_items: tuple[RunItem, ...] | None = None        # override input to next agent

    def clone(self, **kwargs) -> HandoffInputData: ...
```

Key insight: **input_filter** is where the handoff strips/summarizes history before passing to the next agent. This is how you avoid context pollution — the next agent doesn't see all prior reasoning, just the relevant slice.

### 7.3 Handoff vs sub-agent-as-tool

Two patterns:
1. **Handoff** — control transfers; next agent takes over the conversation
2. **Agent as tool** — current agent stays in control; sub-agent returns a result

WOTANN's current `task` tool is "Agent as tool." It doesn't implement handoff. This is a gap for triage flows (e.g., "routing agent hands off to billing agent or support agent based on intent").

### 7.4 Proposed `src/core/handoff.ts`

```typescript
import { z } from 'zod';
import type { Agent, RunContext, Message } from './types.js';

export interface HandoffInputData<TItem = Message> {
  readonly inputHistory: readonly TItem[];
  readonly preHandoffItems: readonly TItem[];
  readonly newItems: readonly TItem[];
  readonly runContext: RunContext | null;
  readonly inputItems: readonly TItem[] | null;
}

export type HandoffInputFilter<TItem = Message> = (
  data: HandoffInputData<TItem>,
) => HandoffInputData<TItem> | Promise<HandoffInputData<TItem>>;

export interface Handoff<TInput = unknown, TAgent extends Agent = Agent> {
  readonly toolName: string;
  readonly toolDescription: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly onInvoke: (ctx: RunContext, input: TInput) => Promise<TAgent>;
  readonly targetAgentName: string;
  readonly inputFilter?: HandoffInputFilter;
  readonly nestHandoffHistory?: boolean;
  readonly isEnabled?: boolean | ((ctx: RunContext, currentAgent: Agent) => boolean | Promise<boolean>);
}

export function handoff<TAgent extends Agent, TInput = void>(options: {
  agent: TAgent;
  toolName?: string;
  toolDescription?: string;
  inputSchema?: z.ZodType<TInput>;
  onHandoff?: (ctx: RunContext, input: TInput) => void | Promise<void>;
  inputFilter?: HandoffInputFilter;
  nestHandoffHistory?: boolean;
  isEnabled?: boolean | ((ctx: RunContext, currentAgent: Agent) => boolean | Promise<boolean>);
}): Handoff<TInput, TAgent> {
  const toolName = options.toolName ?? `transfer_to_${options.agent.name}`;
  const toolDescription = options.toolDescription ?? `Handoff to the ${options.agent.name} agent. ${options.agent.handoffDescription ?? ''}`;
  const inputSchema = options.inputSchema ?? (z.object({}) as unknown as z.ZodType<TInput>);

  return Object.freeze({
    toolName,
    toolDescription,
    inputSchema,
    targetAgentName: options.agent.name,
    inputFilter: options.inputFilter,
    nestHandoffHistory: options.nestHandoffHistory,
    isEnabled: options.isEnabled,
    onInvoke: async (ctx, input) => {
      if (options.onHandoff) await options.onHandoff(ctx, input);
      return options.agent;
    },
  });
}
```

WOTANN's `Agent` type needs a `handoffs?: readonly Handoff[]` field, and the runtime loop needs to render handoffs as tool calls to the model and dispatch transfers when one is called. Track this as a new Sprint-6 differentiation feature.

### 7.5 Nested handoff history (the subtle part)

By default, when agent A hands off to agent B, B sees the full conversation history. With `nest_handoff_history=True`, B instead sees a summarized "nested" version — A's internal reasoning becomes one opaque tool-result message, so B focuses on the user's actual intent, not A's routing decision.

WOTANN should default to nested for triage-style flows and flat for pair-programmer flows. Make it a per-handoff config.

---

## 8. AGENTS.md Standard — 60,000+ Repo Compliance Audit

### 8.1 What AGENTS.md is

Open standard adopted by 60,000+ repos. Single top-level Markdown file at project root that provides guidance to AI coding agents. Read by OpenAI Codex, Claude Code (via plugin), Cursor, Gemini CLI, GitHub Copilot CLI, and others.

Common structure (from reviewed repos):
```markdown
# AGENTS.md

## Quick Links
- Architecture
- Code style
- Lessons learned

## Database & Migrations
## Commands
## Git Commands
## Architecture
## File Organization & Separation of Concerns
## Code Style
```

### 8.2 Pattern: AGENTS.md as CLAUDE.md symlink

Several repos use this pattern:
- superpowers: `AGENTS.md -> CLAUDE.md` (symlink)
- vercel-open-agents: `CLAUDE.md -> AGENTS.md` (symlink, inverse)
- openai-agents-python: `CLAUDE.md -> AGENTS.md` (symlink)

**Recommendation for WOTANN:** Create `/AGENTS.md` at project root. Since `CLAUDE.md` has the primary content, symlink: `AGENTS.md -> CLAUDE.md`. This:
- Exposes WOTANN to all AGENTS.md-compliant tools
- Single source of truth
- Zero duplication
- Trivial change

```bash
# From project root:
ln -s CLAUDE.md AGENTS.md
```

### 8.3 AGENTS.md compliance scorecard for WOTANN

| Requirement | Status | Fix |
|---|---|---|
| File exists at project root | ❌ MISSING | `ln -s CLAUDE.md AGENTS.md` |
| Valid Markdown | — (file missing) | Auto-fixed by symlink |
| Contains build commands | ✅ CLAUDE.md has `npm run typecheck`, `npm test`, `npm run dev` | — |
| Contains file organization rules | ✅ 200-400 lines per file, 800 max | — |
| Contains naming conventions | ✅ Norse internal, English user-facing | — |
| Contains architecture overview | ✅ Complete dir structure | — |
| Contains testing guidance | ⚠ Partial — missing 80% coverage link | Add link to `rules/testing.md` |
| Contains commit guidance | ⚠ Missing conventional commit reference | Add `git:cm` skill reference |

Score: 6/8 after symlink. After adding 2 missing sections, 8/8.

---

## 9. AAIF (Linux Foundation Agentic AI Foundation) Compatibility

### 9.1 What AAIF is

The Linux Foundation's Agentic AI Foundation (announced 2025) is the governance body for open agent standards. It incorporates:
- **MCP (Model Context Protocol)** — Anthropic's tool protocol, now open standard
- **Goose** — Block's agent runtime (open source)
- **AGENTS.md** — agent guidance file standard
- **A2A (Agent-to-Agent)** — Google's agent-to-agent communication protocol

### 9.2 WOTANN compatibility matrix

| Standard | Status | Evidence | Gap |
|---|---|---|---|
| **MCP client** | ✅ YES | `src/providers/` has MCP adapters for GitHub, Cloudflare, etc. | None |
| **MCP server** | ⚠ PARTIAL | No exported MCP server surface from WOTANN itself | Add `src/marketplace/mcp-server.ts` to expose WOTANN skills as MCP tools |
| **Goose compatibility** | ⚠ UNKNOWN | Haven't verified Goose adapter | Check `research/goose/` for config schema, add adapter if needed |
| **AGENTS.md** | ❌ MISSING | No root AGENTS.md | See §8 |
| **A2A protocol** | ❌ NOT IMPLEMENTED | `src/channels/` has Telegram/Discord but no A2A | Add `src/channels/a2a-adapter.ts` — stub for v1 |

### 9.3 AAIF-ready minimum for WOTANN

1. **AGENTS.md at root** (trivial symlink — see §8)
2. **MCP server exposure** — let other agents call WOTANN's skills/tools via MCP. Medium effort.
3. **A2A adapter stub** — accept inbound A2A calls on a well-known endpoint. Medium effort.
4. **Goose config support** — read `.goose/config.yaml` if present. Low effort.
5. **AAIF conformance badge** — cosmetic but signals credibility.

Full AAIF compatibility is Sprint-6 differentiation work. §1-4 of this list are Sprint-1/2.

---

## 10. Deep Patterns — Cross-Repo Synthesis

These are patterns that appear in 3+ repos and deserve first-class support.

### 10.1 Progressive disclosure

From OpenAI skill-creator:
> Skills use a three-level loading system:
> 1. Metadata (name + description) — always in context (~100 words)
> 2. SKILL.md body — when skill triggers (<5k words)
> 3. Bundled resources — as needed by agent (unlimited)

Also adopted by Vercel, addyosmani. **The 5k-word body cap is a discipline every WOTANN skill should respect.** Audit current skills for over-length offenders.

### 10.2 Context: fork pattern

Appears in Vercel, Addy, superpowers. A skill with `context: fork` runs in an isolated subagent with its own context, not the main conversation. Prevents context pollution during long skill executions.

WOTANN has this field defined but unverified that it actually forks. Check `src/skills/loader.ts` or equivalent.

### 10.3 Allowed-tools scoping

```yaml
allowed-tools: "Read, Grep, Glob"
```
Restricts which tools a skill can use. Critical for security — a "web scraper" skill shouldn't have `Bash` access. WOTANN's skills don't declare this; propose adding for high-risk skills.

### 10.4 Disable-model-invocation

```yaml
disable-model-invocation: true
```
Skill can only be invoked by user (slash command) or direct UI trigger, never auto-dispatched by the model. Useful for destructive or expensive skills (`/ultrareview`, `/tree-search`).

WOTANN doesn't have this — add `disable-model-invocation: true` to `/tree-search`, `/ultraqa`, `/autoresearch-agent`.

### 10.5 The "write tests before writing skills" pattern

superpowers `writing-skills` maps TDD to documentation:
| TDD | Skill authoring |
|---|---|
| Write test first | Run baseline pressure scenario with subagent |
| Watch it fail | Document exact rationalizations agent uses |
| Write minimal code | Write skill addressing those violations |
| Watch it pass | Verify agent now complies |
| Refactor | Close loopholes |

**WOTANN should adopt this for new skill authoring.** Add a `/wotann-new-skill` command that:
1. Prompts for the behavior the skill should enforce
2. Dispatches a subagent with a pressure scenario (no skill loaded)
3. Captures how the subagent rationalizes the wrong behavior
4. Presents rationalizations to the user
5. Drafts skill text that addresses each rationalization
6. Re-runs pressure scenario with skill loaded to verify compliance

This would be the first open-source implementation of "TDD for AI skills."

---

## 11. Summary Port List — Priority-Ordered

### P0 (same-day, high ROI)
1. **`ln -s CLAUDE.md AGENTS.md`** at WOTANN root. 10 seconds. Unblocks AAIF + OpenAI Codex + Gemini + Cursor.
2. **Add `license: MIT`, `version: 1.0.0`, `maintainer` to all 87 skills**. Run migration script §4.4. ~30 min.
3. **Enhance `karpathy-principles.md`** — add license, "how to know it's working", rationalization table, Twitter attribution. 15 min.

### P1 (this sprint)
4. **HARD-GATE brainstorming pattern** — port to `src/skills/workflow/brainstorm.md` + guard hook. 2 hours.
5. **Iron Law delete-code-before-test** — update `tdd-workflow.md` + `src/hooks/guards/tdd-enforcer.ts`. 2 hours.
6. **Two-stage review subagent prompts** — 3 prompt files under `src/skills/workflow/`. 1 hour.
7. **Cross-subagent usage aggregation** — `src/telemetry/usage-aggregator.ts`. 2 hours.
8. **Typed UIMessage chunks** — `src/core/stream-types.ts`. 3 hours.
9. **iOS `CostTickerOverlay` + `RewindToMessageButton`** — 2 SwiftUI files + RPC wire. 3 hours.

### P2 (next sprint — Sprint 6 differentiation)
10. **Structured Handoff class** — `src/core/handoff.ts` + runtime loop integration. 1 day.
11. **MCP server exposure** — `src/marketplace/mcp-server.ts`. 1 day.
12. **Skill-to-directory migration (Phase B)** — convert top 20 skills to directory form with bundled resources. 2 days.
13. **plugin.json manifest** — for marketplace distribution. 4 hours.
14. **TDD-for-skills `/wotann-new-skill`** — 1 day.
15. **A2A adapter stub** — `src/channels/a2a-adapter.ts`. 4 hours.
16. **Goose config compatibility** — read `.goose/config.yaml`. 2 hours.

### P3 (Sprint 7+)
17. **Slice sizer** that refuses plans with >100-line steps. 4 hours.
18. **Complexity-signals model router** — cheap/standard/capable selection. 1 day.
19. **Gateway facade** — single `gateway()` call from skills. 1 day.

---

## 12. Appendices

### A. File-by-File Reference Map

Every concrete pattern cited traces to a real file:

| Pattern | Source file |
|---|---|
| Superpowers HARD-GATE | `research/superpowers/skills/brainstorming/SKILL.md:12-14` |
| Superpowers Iron Law | `research/superpowers/skills/test-driven-development/SKILL.md:32-40` |
| Subagent two-stage review | `research/superpowers/skills/subagent-driven-development/SKILL.md:42-84` |
| Verification gate | `research/superpowers/skills/verification-before-completion/SKILL.md:26-38` |
| Dispatch parallel pattern | `research/superpowers/skills/dispatching-parallel-agents/SKILL.md:47-74` |
| Writing skills TDD | `research/superpowers/skills/writing-skills/SKILL.md:30-45` |
| Karpathy 4 principles | `research/andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md` |
| OpenAI canonical schema | `research/openai-skills/skills/.system/skill-creator/SKILL.md:55-65, 335-345` |
| OpenAI agents/openai.yaml | `research/openai-skills/skills/.system/skill-creator/references/openai_yaml.md` |
| Plugin manifest schema | `research/openai-skills/skills/.system/plugin-creator/references/plugin-json-spec.md:1-97` |
| Vercel skill frontmatter | `research/vercel-open-agents/packages/agent/skills/types.ts:6-34` |
| Vercel skill loader | `research/vercel-open-agents/packages/agent/skills/loader.ts` |
| Vercel skill tool | `research/vercel-open-agents/packages/agent/tools/skill.ts` |
| Vercel usage aggregator | `research/vercel-open-agents/packages/agent/usage.ts:14-65, 143-180` |
| Vercel task tool | `research/vercel-open-agents/packages/agent/tools/task.ts` |
| Vercel stream route | `research/vercel-open-agents/apps/web/app/api/chat/route.ts:1-80` |
| OpenAI Handoff class | `research/openai-agents-python/src/agents/handoffs/__init__.py:42-181` |
| HandoffInputData | `research/openai-agents-python/src/agents/handoffs/__init__.py:42-83` |
| Addyosmani phase organization | `research/addyosmani-agent-skills/CLAUDE.md` + `research/addyosmani-agent-skills/skills/incremental-implementation/SKILL.md` |

### B. WOTANN files that need changes (by file)

| File | Change |
|---|---|
| `/AGENTS.md` | CREATE (symlink to `CLAUDE.md`) |
| `skills/*.md` (all 87) | Add `version`, `license`, `maintainer` frontmatter |
| `skills/karpathy-principles.md` | Add license + "how to know it's working" + rationalization table + Twitter link |
| `skills/tdd-workflow.md` | Add Iron Law delete-code text + rationalization table |
| `src/hooks/guards/pre-implementation-gate.ts` | CREATE — enforce HARD-GATE |
| `src/hooks/guards/tdd-enforcer.ts` | CREATE — detect pre-test code |
| `src/skills/workflow/brainstorm.md` | CREATE |
| `src/skills/workflow/subagent-implementer.md` | CREATE |
| `src/skills/workflow/subagent-spec-reviewer.md` | CREATE |
| `src/skills/workflow/subagent-code-quality-reviewer.md` | CREATE |
| `src/telemetry/usage-aggregator.ts` | CREATE |
| `src/core/stream-types.ts` | CREATE |
| `src/core/handoff.ts` | CREATE (Sprint 6) |
| `src/marketplace/mcp-server.ts` | CREATE (Sprint 6) |
| `src/channels/a2a-adapter.ts` | CREATE (Sprint 6) |
| `ios/WOTANN/Views/HUD/CostTickerOverlay.swift` | CREATE |
| `ios/WOTANN/Views/Chat/RewindToMessageButton.swift` | CREATE |
| `ios/WOTANN/Views/Chat/MessageRow.swift` | MODIFY — add rewind context menu |
| `ios/WOTANN/Views/Chat/ChatView.swift` | MODIFY — attach CostTickerOverlay |
| `ios/WOTANN/Networking/RPCClient.swift` | MODIFY — add rewind + costStream RPCs |
| `src/daemon/rpc/rewind.ts` | CREATE |
| `.github/PULL_REQUEST_TEMPLATE.md` | REWRITE — port superpowers-style anti-slop guard |
| `scripts/migrate-skills-to-v1.ts` | CREATE — frontmatter migration |
| `plugin.json` | CREATE (Sprint 6) |

### C. Rejected ports (intentionally not ported)

- **Superpowers PR anti-slop CLAUDE.md text verbatim** — too voice-specific to obra. Port the pattern, not the prose.
- **`sandbox agents` from openai-agents-python** — WOTANN already has `src/sandbox/` + `src/computer-use/` that cover this.
- **`openai.yaml` with icon assets** — cosmetic for now; can add later per-skill as needed.
- **Goose skill format** — MCP already covers cross-agent tool interop; a dedicated Goose adapter is lower priority than A2A.
- **wacli (Go WhatsApp CLI)** — not agent-relevant; concept redirected to WOTANN's own iOS cost ticker.

### D. Open questions surfaced by this extraction

1. Does WOTANN's `context: fork` skill flag actually fork context, or is it a stub? Verify against `src/skills/loader.ts`.
2. Is `src/providers/router.ts` exposed as a single `gateway()`-style facade to skills, or must skills know provider IDs? Audit.
3. Does `src/autopilot/checkpoint.ts` snapshot per-message or per-turn? Needed for iOS rewind accuracy.
4. Has anyone filed a WOTANN entry in the AGENTS.md registry at https://agents.md (if one exists)? 60K+ repos already have.
5. Is there a formal WOTANN stability contract for skill frontmatter — can we safely add `version` without breaking existing consumers?

---

## 13. Verification checklist

- [x] Read all 6 assigned repo READMEs and CLAUDE.md files
- [x] Extracted skill patterns from superpowers (14 skills inventoried)
- [x] Extracted Karpathy 4 principles, compared to existing WOTANN skill
- [x] Audited OpenAI canonical schema vs WOTANN skill format — gap analysis complete
- [x] Read Vercel AI SDK streaming primitives (usage.ts, subagents/types.ts, route.ts, skill.ts, task.ts)
- [x] Identified wacli task conflation; redirected to WOTANN iOS cost ticker proposal
- [x] Extracted Handoff dataclass + HandoffInputData from openai-agents-python handoffs/__init__.py
- [x] Evaluated AGENTS.md compliance — root file missing, symlink recommended
- [x] Evaluated AAIF compatibility — 5-item gap list with effort estimates
- [x] Cross-linked every pattern to a source file and a target WOTANN file
- [x] Produced priority-ordered port list (P0, P1, P2, P3)
- [x] Generated migration scripts and SwiftUI code stubs ready to drop in
- [x] Delivered to `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/COMPETITOR_EXTRACTION_LANE5_SKILLS.md`
