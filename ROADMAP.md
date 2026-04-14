# WOTANN Competitive Roadmap

## What Makes Users Choose WOTANN Over Alternatives

### 1. True Multi-Provider (No Vendor Lock-in)
**Competitors:** Claude Code (Anthropic only), Codex (OpenAI only), Cursor (closed-source, multi but proprietary), OpenClaw (multi but complex setup).
**WOTANN advantage:** One `wotann init` and every provider works. Subscription auth for Anthropic AND OpenAI (via Codex backend). Automatic fallback chain: paid → paid → free. User never sees a dead end.

### 2. Free-Tier Is First-Class
**Competitors:** ALL competitors require paid subscriptions or API keys for meaningful use.
**WOTANN advantage:** `wotann init --free` gives the FULL experience: Ollama local (free, private, offline) + Groq/Cerebras overflow (free tiers, no credit card). Skill injection makes local models dramatically more capable for specific tasks.

### 3. Unified Intelligence Layer
**OpenClaw's approach:** Provider abstraction with plugin architecture. Each provider is a plugin.
**WOTANN advantage:** Go further — the harness intelligence (middleware, hooks, TTSR, memory, verification) runs identically for EVERY provider. A Qwen3.5 local model gets the same forced verification, frustration detection, and memory system as Claude Opus. The provider is just the LLM call; everything else is ours.

---

## Feature Gaps vs Competitors (Actionable)

### vs OpenClaw
| OpenClaw Has | WOTANN Status | Priority |
|---|---|---|
| WebSocket transport for Codex | SSE only | Medium |
| 24 messaging channels (WhatsApp, Telegram, etc.) | Adapter skeleton only | Low (daemon phase) |
| Canvas/A2UI visual workspace | Not started | Low |
| Device nodes (camera, GPS, screen recording) | Node registry exists | Medium |
| Plugin architecture for providers | Built-in adapters | Keep as-is (simpler) |
| `openclaw onboard` interactive setup | `wotann init` exists but no interactive provider setup | High |

### vs Claude Code
| Claude Code Has | WOTANN Status | Priority |
|---|---|---|
| `claude-agent-sdk` full agentic loop | Installed, bridge created, not primary path yet | HIGH |
| 1M context beta | Not configured | Medium |
| Hooks as JS files in .claude/hooks/ | Hook engine exists with 14 hooks | Done |
| Slash commands (/compact, /clear, /help) | TUI has /exit, /clear, /stats | Medium |
| MCP server ecosystem | Registry exists, import from Claude Code works | Done |
| Git worktree isolation for subagents | Coordinator exists, no actual worktree | Medium |

### vs Cursor
| Cursor Has | WOTANN Status | Priority |
|---|---|---|
| Harness boosts model benchmark scores | 7 intelligence overrides exist | Done |
| Tab completion | Not applicable (CLI, not IDE) | N/A |
| Multi-file context (entire repo) | WASM bypass + progressive disclosure | Done |
| Background indexing | Not implemented | Low |

### vs Codex CLI
| Codex Has | WOTANN Status | Priority |
|---|---|---|
| Kernel-level sandbox (Landlock/Seatbelt) | Risk classification exists, no kernel sandbox | Medium |
| Session resume | Session state exists | Medium |
| Approval flow with exec policy | Permission modes exist (6 modes) | Done |

---

## Strategic Features to Implement

### HIGH PRIORITY — Differentiators

#### 1. Autonomous Mode (`wotann --autonomous`)
Force the model to run until task is fully completed and self-verified.
- No user interaction needed after initial prompt
- Built on Ralph Mode (verify-fix loop) + Self-Healing (retry with provider fallback)
- Auto-runs tests, typecheck, lint after every change
- Commits only when ALL checks pass
- DoomLoop detector prevents infinite loops
- Time/cost budget with hard cutoff

#### 2. Chrome Extension
- Agent controls Chrome tabs via chrome.debugger API
- Reads DOM, fills forms, clicks elements, screenshots
- Computer Use Layer 2 (a11y) becomes Chrome DevTools Protocol
- Integrates with existing MCP chrome tools
- Use case: "fill out this form", "scrape this table", "test this login flow"

#### 3. Visual Test Mode (Screen Verification)
Default: allow model to look at screen for testing that requires visual verification.
- Screenshot + OCR for visual regression testing
- "Does this page look right?" → screenshot → vision model analysis
- Fallback to text-mediated (a11y tree) for non-vision models
- CLI tests stay in CLI; browser tests use Chrome extension; desktop tests use screenshot

#### 4. Source Monitoring System
Keep up with updates to all 82+ source repos.
- `wotann repos check` — check for new commits, releases, features since last sync
- Config: `research/monitor-config.yaml` already has 60+ sources tracked
- Weekly digest of relevant changes to competitor harnesses
- Auto-suggest spec updates when sources add new patterns

### MEDIUM PRIORITY — Depth Improvements

#### 5. Provider-Agnostic Capabilities (OpenClaw Pattern)
Unify model-specific features so they work regardless of provider:
- **Tool calling:** Native if model supports it, prompt-injected if not
- **Vision:** Native for Claude/GPT, OCR+description for text-only models
- **Extended thinking:** Native for Claude/o4, "think step by step" prompt for others
- **Streaming:** SSE for all, WebSocket where supported
- Already partially implemented in Appendix X (Capability Augmentation Model)

#### 6. Skill Injection as Capability Boost
The OpenClaw insight: "A small model given detailed, step-by-step instructions for a specific tool performs significantly better than a small model given a vague prompt."
- When a skill triggers, inject its FULL content into the system prompt
- This is our equalizer for Ollama models — they get expert instructions
- Track which skills boost performance most per model (analytics)

#### 7. Expand CLI Surface
Missing commands from spec §34:
- `wotann next` — auto-detect and run next logical step
- `wotann --pwr "task"` — full Plan-Work-Review cycle
- `wotann --ralph "task"` — persistent execution until done
- `wotann cu "task"` — computer use mode
- `wotann dream --force` — trigger autoDream consolidation
- `wotann audit` — security audit
- `wotann local status` — Ollama model status, VRAM usage

### LOW PRIORITY — Future Phases

#### 8. Desktop App (Tauri v2)
- Reuses all CLI modules
- Tray icon, global hotkeys, auto-start
- Visual memory browser, agent status tree
- Computer use viewer with live screenshots

#### 9. Phone Companion (Dispatch)
- QR code pairing phone → desktop
- Send tasks from phone, get progress via WebSocket
- Push notifications for completed tasks

#### 10. Skill Marketplace
- Browse, install, evaluate community skills
- Publish own skills with quality scoring
- SkillCompass-style evaluation (6 dimensions, 100-point scale)

---

## Keeping Up With Sources

The spec's Appendix T defines an autonomous monitoring system for 60+ repos. Implementation:
1. `research/monitor-config.yaml` lists all tracked repos with last-sync dates
2. `wotann repos check` runs `git log --since=<last_sync>` on each
3. Weekly summary of: new releases, new features, breaking changes
4. Flagged items auto-create issues against WOTANN spec for review
5. `wotann repos sync` updates local clones

---

## What Would Make a User Switch to WOTANN

After analyzing 80+ competitors, the real answer is: **no one tool does everything well**. Users switch for whichever gap hurts them most:

1. **"I'm tired of vendor lock-in"** → WOTANN multi-provider with fallback chain
2. **"I can't afford cloud API costs"** → WOTANN free-tier with Ollama + skill injection
3. **"The agent keeps making mistakes"** → WOTANN forced verification + quality overrides
4. **"I want it to just finish the job"** → WOTANN autonomous mode (Ralph + self-healing)
5. **"I need to control my computer"** → WOTANN 4-layer CU with text-mediated for any model
6. **"I want to remember things across sessions"** → WOTANN 8-layer memory with FTS5
7. **"I want to customize the agent's behavior"** → WOTANN 65+ skills + hooks as guarantees

The compound effect is the moat: any one feature exists in some competitor. All of them in one tool, working together, with free-tier first-class — that's WOTANN.

---

## Implementation Status (Updated)

### Completed in Current Session
- [x] **10 provider adapters**: Anthropic (API + subscription), OpenAI, Codex (ChatGPT OAuth), Copilot (PAT→token exchange), Ollama (native /api/chat), **Gemini** (new), Free endpoints, Azure, Bedrock, Vertex
- [x] **Provider fallback chain**: preferred → other paid → gemini/ollama/free → never a dead end
- [x] **Capability augmentation**: Tool calling, vision, and thinking work across ALL providers via prompt injection for models that lack native support
- [x] **Autonomous mode**: `wotann autonomous <prompt>` — runs until tests pass or budget exhausted
- [x] **Interactive onboarding**: `wotann onboard` — guided setup for all 10 providers
- [x] **393 tests passing**, TypeScript strict, zero `any`

### New Differentiating Features (Brainstormed)

#### A. Session Continuity (no competitor does this well)
- `wotann resume` — pick up exactly where you left off, even after machine restart
- Automatic session serialization with provider state, conversation history, and tool results
- Cross-machine sync via git (`.wotann/sessions/` is gitignored by default but user can enable)

#### B. Intelligent Cost Optimization
- Real-time cost dashboard showing spend per provider, per task, per model
- Automatic downrouting of utility tasks (JSON formatting, counting) to free models
- "Budget mode" — user sets daily/weekly cap, WOTANN auto-adjusts model selection
- Cost comparison: "this task would cost $X on Claude Opus vs $0.00 on Gemini Flash"

#### C. Multi-Agent Orchestration (beyond single-agent)
- `wotann team <task>` — spawns parallel agents with file ownership boundaries
- Agent communication via structured messages (not stdout)
- Dependency graph: agent B waits for agent A's output before starting
- Merge conflict resolution when multiple agents edit the same file

#### D. Plugin Ecosystem (not just skills)
- `wotann install <plugin>` — npm-based plugin system for custom providers, tools, hooks
- Plugins can add new CLI commands, middleware layers, or TUI panels
- Plugin marketplace with quality scoring and version compatibility

#### E. Context-Aware Model Selection
- Analyze the task before choosing the model: code → fast frontier, planning → deep frontier
- Track which models perform best for specific code patterns in this repo
- "This file was last edited by Sonnet with 95% test pass rate — using Sonnet again"

#### F. Proactive Error Prevention
- Pre-commit analysis: "this change will break test X because of dependency Y"
- Type narrowing suggestions: "this `any` at line 42 should be `UserProfile`"
- Security scanning: "this endpoint accepts unvalidated user input at line 18"

#### G. Visual Test Verification (planned, not yet implemented)
- Screenshot comparison for UI tests
- OCR for text-based visual verification
- Accessibility tree diffing for structural changes
- Fallback to text-mediated for non-vision models

#### H. Chrome Extension (planned, not yet implemented)
- Agent controls Chrome tabs via chrome.debugger API
- DOM reading, form filling, element clicking, screenshots
- Integrates with existing MCP chrome tools
- Use case: "fill out this form", "scrape this table", "test this login flow"

#### I. Source Monitoring System (planned, partially implemented)
- `wotann repos check` — check 60+ tracked repos for new commits/releases
- Auto-suggest spec updates when sources add new patterns
- Weekly digest of relevant changes to competitor harnesses
