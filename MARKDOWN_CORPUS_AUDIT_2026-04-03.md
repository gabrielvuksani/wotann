# Markdown Corpus Audit
> Date: April 3, 2026

## Scope
The `agent-harness` tree contains a very large markdown corpus spanning the root spec, the WOTANN implementation workspace, references, and research clones.

## Inventory Snapshot
- Total markdown files under `/Users/gabrielvuksani/Desktop/agent-harness`: `4376`
- Largest directory by count: `research/`
- WOTANN implementation markdowns: `wotann/`
- Core reference markdowns: `reference/`

## Priority Files Read For This Audit
### Root
- `AGENTS.md`
- `BUILD_GUIDE.md`
- `SOURCES.md`
- `WOTANN_V4_SPEC.md`

### WOTANN workspace
- `wotann/CLAUDE.md`
- `wotann/DECISIONS.md`
- `wotann/ROADMAP.md`
- `wotann/TERMINALBENCH_STRATEGY.md`

### Reference
- `reference/SKILLS_ROSTER.md`
- `reference/AGENTS_ROSTER.md`
- `reference/MEMORY_ARCHITECTURE.md`
- `reference/HOOKS_REGISTRY.md`
- `reference/TOOLS_AND_MCP.md`

### Local workspace bootstrap
- `wotann/.wotann/SOUL.md`
- `wotann/.wotann/IDENTITY.md`
- `wotann/.wotann/USER.md`
- `wotann/.wotann/AGENTS.md`
- `wotann/.wotann/TOOLS.md`
- `wotann/.wotann/HEARTBEAT.md`
- `wotann/.wotann/BOOTSTRAP.md`
- `wotann/.wotann/MEMORY.md`

## Main Findings
- The documentation corpus is ahead of the implementation in several areas.
- Context, memory, and orchestration claims were the main areas where docs overreached code.
- The markdown bootstrap files were stronger than the original workspace templates, so `wotann init` was updated to generate richer defaults.
- The spec and research corpus strongly support investing in dispatch, context virtualization, memory provenance, and provider-agnostic capability equalization over simple provider expansion.
