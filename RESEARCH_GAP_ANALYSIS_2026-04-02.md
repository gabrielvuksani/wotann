# WOTANN Source Gap Analysis

Date: 2026-04-02

This document compiles the implementation deltas identified from `../SOURCES.md`, the local synthesis docs
(`../COMPETITIVE_ANALYSIS.md`, `../AGENT_FRAMEWORK_ANALYSIS.md`, `../ECOSYSTEM-CATALOG.md`,
`../UNIFIED_SYSTEMS_RESEARCH.md`, `../research/COMPUTER_CONTROL_ARCHITECTURE.md`), and direct review of the
newer or externally changing sources called out in the master continuation prompt.

## Scope

The goal here is not to restate the full spec. It is to identify source-backed features that still appear
missing, stubbed, or only partially wired in the current `wotann/` implementation.

## Explicit External Source Findings

### Conductor

Source signals:
- Isolated parallel workspaces for multiple agents
- Automatic checkpoints stored separately from the user branch
- Diff viewer
- Run scripts plus "spotlight testing" that syncs workspace changes back to the repo root
- Shared `conductor.json` scripts
- Multi-repository linking

Current WOTANN gaps:
- Worktree isolation is not creating real git worktrees yet
- TUI diff viewer components exist but are not wired into the main layout
- No repo-root "spotlight"-style testing mode
- Session restore is shallow and does not reopen active working context

### Paperclip

Source signals:
- Persistent heartbeat-driven orchestration
- Org charts, budgets, governance, and goal alignment
- Ticket-based conversations with immutable audit trails
- Multi-agent cost control and persistent sessions across reboots

Current WOTANN gaps:
- Ralph/autonomous execution lacks richer persistent governance and budget telemetry in the loop
- Team orchestration exists conceptually but not as a full hierarchical execution surface
- Cost persistence is not durable across CLI invocations

### Cline

Source signals:
- Agent can read/write files, run commands, use the browser
- Human-supervised autonomy
- Official MCP marketplace ecosystem
- Benchmark data derived from real sessions

Current WOTANN gaps:
- Browser/computer-use path is not exposed as a first-class CLI flow
- Marketplace search/install is stubbed
- TUI still lacks polished file attachment and richer review surfaces

### ai-marketing-skills

Source signals:
- Domain skill packs are workflow bundles, not short prompts
- Categories include growth engine, sales pipeline, content ops, outbound, SEO, finance, revenue intelligence
- Skills package scripts, expert panels, scoring rubrics, references, and automation pipelines

Current WOTANN gaps:
- Existing marketing skills are much lighter than this workflow depth
- No import or merge process for these higher-fidelity domain packs

### awesome-design-md

Source signals:
- `DESIGN.md` is used as a plain-text design system contract for coding agents
- Files include visual theme, palette, typography, components, layout, depth, guardrails, responsive behavior
- Large library of reusable design profiles

Current WOTANN gaps:
- Frontend/design skills have not absorbed this richer design-contract pattern
- TUI does not surface any design artifact loading path analogous to `@file`/skill loading

### Jean

Source signals:
- Real git worktree isolation for parallel sessions
- Context loading from sessions, issues, and pull requests
- Automated worktree lifecycle and merge flows
- Mobile access to active agents

Current WOTANN gaps:
- Coordinator does not create actual git worktrees
- No first-class multi-workspace session surface
- No remote/mobile management surface

### Kilo Code

Source signals:
- 500+ models via many providers
- Parallel agents
- Memory bank
- Debug mode
- MCP marketplace
- Open model and provider flexibility

Current WOTANN gaps:
- Marketplace and plugin installation remain stubs
- Context-aware model selection is still mostly static
- Rich multi-agent UI is not wired

Note:
- The "Smart Loop Breaker" and "File Freeze" ideas are already reflected in the local research inventory and
  should map to stronger edit-loop prevention and file ownership/freeze semantics.

### PraisonAI

Source signals:
- Multi-agent handoffs
- Guardrails
- Memory and session management
- RAG/knowledge indexing
- Telegram, Discord, and WhatsApp delivery
- OpenAI-compatible service surfaces

Current WOTANN gaps:
- Channel adapters exist but there is no complete `wotann channels start` operational path
- Multi-agent handoff/orchestration depth is still thin
- Knowledge/RAG-style retrieval is weaker than the source capability set

### Cursor 3

Source signals:
- April 2, 2026 release discussion describes a multi-workspace "Agents Window"
- Local, cloud, worktree, remote SSH, mobile, Slack, GitHub, and Linear agents in one control surface
- Environment handoff between local and cloud
- Diff review and artifact-based validation
- Plugin marketplace and cloud-agent plugin use

Current WOTANN gaps:
- TUI lacks the same integrated agent tree, diff review, and environment-aware session surfaces
- Plugin ecosystem is not implemented
- No artifact-aware resume/review flow for interrupted runs

### free-code

Source signals:
- Multiple provider backends behind a Claude-Code-like shell
- Feature-flag unlock model
- Telemetry stripping and local-first execution

Current WOTANN gaps:
- Provider breadth is good, but some live routing pieces are still disconnected:
  account rotation, format translation, fallback health details, durable cost state

### Hugging Face Inference API

Source signals:
- OpenAI-compatible chat completion endpoint at `https://router.huggingface.co/v1`
- `HF_TOKEN` authentication
- Streaming, tools, constraints, and broad task coverage
- Serverless `hf-inference` plus provider-routing options

Current WOTANN gaps:
- No Hugging Face provider adapter yet

### Gemma 4

Source signals:
- Announced April 2, 2026
- Purpose-built for reasoning and agentic workflows
- Function calling, structured JSON output, system instructions
- Vision support across the family, audio on edge models
- 128K to 256K context
- Day-one availability across Hugging Face and Ollama

Current WOTANN gaps:
- No Gemma-specific local recommendations or capability-aware routing path
- No Hugging Face path for open-model cloud fallback

### Agent Skills Standard

Source signals:
- Skill is a directory, not just a flat markdown file
- Standard structure: `SKILL.md`, optional `scripts/`, `references/`, `assets/`
- Open standard used across multiple agent products

Current WOTANN gaps:
- Loader currently assumes flat markdown files and loses the directory-based standard
- No install/convert workflow for external skill packs

## Cross-Source Findings From the Local Research Set

### Competitive Analysis

High-value gaps still relevant:
- Resumable streams
- White-box editable memory and stronger session continuity
- More robust checkpoint-based crash recovery
- Agent-to-agent session tools
- MCP marketplace UX

### Framework Analysis

High-value gaps still relevant:
- Deterministic after-agent safety nets
- Real isolated subagent execution with strict tool boundaries
- Shadow checkpoint integration on dangerous operations
- Multi-surface invocation using a single core agent runtime

### Ecosystem Catalog

High-value gaps still relevant:
- Context health HUD as a first-class always-visible surface
- File-based planning with session recovery
- Usage/rate-limit display with auto-resume
- Skill security auditing before installation
- Discussion/assumptions phase before execution

### Unified Systems Research

High-value gaps still relevant:
- More complete memory capture and topic-key upserts
- Routing feedback loops based on empirical performance
- Semantic caching and retrieval-guided routing
- Prompt and planning persistence that survives compaction and restarts

### Computer Control Research

High-value gaps still relevant:
- Accessibility-first perception before screenshot fallback
- Browser-router layering: connector -> Lightpanda -> Playwright snapshot -> Playwright vision -> full computer use
- Screenshot/action artifact capture for verification
- Better safety tiers for computer use actions

## Implementation Priority Derived From Research

1. Runtime/provider spine:
   - account rotation
   - format translation
   - durable resume
   - durable cost tracking
2. Recovery and continuity:
   - shadow-git checkpoints
   - resumable streams
   - richer self-healing and Ralph loops
3. Interaction surfaces:
   - `wotann cu`
   - `wotann channels start`
   - multi-panel TUI wiring
4. Ecosystem compatibility:
   - Agent Skills directory-format support
   - marketplace search/install
   - plugin install surface
5. Parallel execution:
   - git worktrees
   - team orchestration
   - stronger agent ownership boundaries
