# WOTANN Sources Coverage Audit

Date: 2026-04-02

This file closes the research gap against `../SOURCES.md`.

Method:
- `direct`: reviewed against a live primary source in this pass or the immediately preceding research pass
- `local`: covered by the local synthesis set (`../COMPETITIVE_ANALYSIS.md`, `../AGENT_FRAMEWORK_ANALYSIS.md`, `../ECOSYSTEM-CATALOG.md`, `../UNIFIED_SYSTEMS_RESEARCH.md`, `../research/COMPUTER_CONTROL_ARCHITECTURE.md`)
- `hybrid`: both direct live review and local synthesis

Important normalization note:
- Several model rows in `SOURCES.md` use catalog names that do not cleanly match current public vendor naming as of 2026-04-02. Those rows are still covered here, but they should be normalized before implementation so provider routing uses real model IDs.

## Competitors

1. Claude Code — `local`. Baseline source for the agent loop, hooks, MCP, and long-context terminal UX; remaining WOTANN delta is full polish parity around resume continuity, richer autonomous loops, and better integrated review surfaces.
2. Codex CLI — `hybrid`. OpenAI’s current Codex and model docs confirm the coding-agent baseline; remaining WOTANN delta is stronger multi-provider routing, skills, memory, and daemon/channel surfaces.
3. OpenClaw — `local`. Confirms daemon, channels, skills, and always-on assistant patterns; remaining WOTANN delta is finishing channel startup/runtime wiring and skill ecosystem parity.
4. Cursor — `hybrid`. Current site/blog research confirms multi-workspace, agent-window, and context discovery patterns; remaining WOTANN delta is full multi-panel TUI, worktree orchestration, and artifact-aware review/resume.
5. NemoClaw — `direct`. NVIDIA docs confirm OpenClaw + OpenShell hardening, architecture docs, network policies, and sandbox lifecycle; remaining WOTANN delta is stronger sandbox posture, intent verification, and security policy surfacing.
6. free-code — `direct`. Direct repo review confirms the “Claude Code shell with more features unlocked” pattern; the live WOTANN delta was disconnected runtime/provider wiring, several parts of which are now fixed, but broader parity and feature-flag/plugin breadth remain.
7. OpenClaude — `local`. Local synthesis still matters for format translation, health scoring, and provider interop; WOTANN had dead-path translator/account rotation gaps, and translator/account-pool wiring has now been partially closed.
8. Jean — `direct`. Site/repo review confirms real git worktrees, multi-agent workspace management, and mobile/remote control; remaining WOTANN delta is real worktree isolation and multi-workspace session management.
9. KiloCode — `hybrid`. Direct review plus local synthesis confirm huge model/provider breadth, loop-breaking, and freeze semantics; remaining WOTANN delta is stronger model selection, marketplace/plugin UX, and file-freeze/ownership rigor.
10. PraisonAI — `direct`. Direct repo review confirms multi-agent handoffs plus Telegram/Discord/WhatsApp delivery; remaining WOTANN delta is complete `wotann channels start`, deeper orchestration, and retrieval/knowledge features.
11. Conductor — `hybrid`. Direct docs and local synthesis confirm parallel workspaces, checkpoints, diff review, and track-based development; remaining WOTANN delta is real worktrees, spotlight-style verification, and richer review panels.
12. Cline — `hybrid`. Direct repo review confirms browser/computer-use, supervised autonomy, and MCP ecosystem; remaining WOTANN delta is marketplace completion, first-class computer use, and richer TUI affordances.
13. Windsurf — `local`. Still relevant for IDE-native agent UX and cascade-style flow; remaining WOTANN delta is cohesive UI polish and environment-aware session handoff.
14. Crush/OpenCode — `hybrid`. Direct OpenCode archive review plus local synthesis confirm session persistence, TUI, LSP, and provider breadth; remaining WOTANN delta is agentskills compatibility, richer TUI review, and broader terminal ergonomics.
15. DeerFlow — `local`. Confirms middleware layering, sandboxed subagents, and virtual path strategies; remaining WOTANN delta is stricter isolated subagent execution and post-agent safety nets.
16. Hive — `local`. Confirms graph-based planning, checkpoint recovery, and cost enforcement; remaining WOTANN delta is stronger long-horizon graph execution and budget-governed multi-agent runs.
17. GSD — `local`. Confirms wave-based parallelism, fresh-context execution, and UAT verification; remaining WOTANN delta is mature team orchestration and deeper verification stages.
18. oh-my-claudecode — `local`. Confirms Ralph-mode persistence and rate-limit auto-resume; remaining WOTANN delta is a production-grade Ralph loop with budgets, doom-loop detection, and recovery.
19. oh-my-pi — `local`. Confirms hash-anchored editing, TTSR, and richer LSP/browser tooling; remaining WOTANN delta is true abort/retry TTSR and broader edit/verification safety.
20. Letta/MemGPT — `local`. Confirms editable memory blocks and conversation-state-as-OS patterns; remaining WOTANN delta is more powerful white-box memory editing and stronger long-session continuity.
21. AutoGPT — `local`. Confirms agent protocol and builder patterns; remaining WOTANN delta is less about parity and more about standards interop plus better operator controls.
22. Hermes Agent — `local`. Confirms shadow-git checkpoints and crash recovery; the shadow-git wiring gap is now partially closed in WOTANN, but higher-level recovery orchestration still remains.
23. VoltAgent — `local`. Confirms marketplace and large external skill inventory; remaining WOTANN delta is search/install UX and external skill import/compatibility.
24. ForgeCode — `local`. Confirms doom-loop detection, compaction, and benchmark engineering; remaining WOTANN delta is stronger Ralph/DoomLoop integration and more empirical context controls.
25. LibreChat — `local`. Confirms resumable streams and multi-tab synchronization; remaining WOTANN delta is resumable stream checkpoints and interrupted-stream recovery.
26. Paperclip — `direct`. Direct repo review confirms heartbeat-based orchestration, org charts, budgets, governance, and audit trails; remaining WOTANN delta is hierarchical orchestration, governance-aware Ralph mode, and stronger persistent cost/budget telemetry.
27. claude-code-router — `local`. Confirms intent-based model routing and cost-aware delegation; remaining WOTANN delta is empirical model-selection feedback loops and broader routing policy controls.
28. Serena — `local`. Confirms symbol-aware/LSP-native editing; remaining WOTANN delta is deeper semantic refactor tooling and confidence in large code transforms.
29. Ruflo — `local`. Confirms tiered routing and fast-path execution; remaining WOTANN delta is better provider/model fast paths and context-aware latency optimization.
30. SuperClaude — `local`. Confirms behavior/mode switching; remaining WOTANN delta is deeper intelligence override triggers and more explicit mode policies.
31. claude-reflect — `local`. Confirms correction capture and learning loops; remaining WOTANN delta is more durable self-improvement memory and post-turn reflection hooks.
32. Superpowers — `local`. Confirms skill-based TDD, planning, review, and parallel work; remaining WOTANN delta is higher-fidelity skill loading and marketplace ergonomics.

## Agent Frameworks And Architecture

33. Claude Agent SDK — `direct`. Official README confirms programmatic Claude Code capabilities for code understanding, edits, commands, and workflows; remaining WOTANN delta is using those architectural ideas without losing provider-agnosticism.
34. OpenAI Agents SDK — `direct`. Official README confirms agents, handoffs, tools, guardrails, human-in-the-loop, sessions, tracing, and realtime agents; remaining WOTANN delta is fuller guardrail/handoff/tracing parity on the WOTANN runtime spine.
35. LangGraph — `local`. Confirms graph-based orchestration and stateful agent execution; remaining WOTANN delta is richer explicit orchestration graphs where useful, especially for team mode and recovery flows.
36. CrewAI — `direct`. Current README confirms crews, flows, control-plane, observability, and enterprise orchestration; remaining WOTANN delta is better multi-agent planning/control-plane UI and observability.
37. DeepAgents — `local`. Confirms trust boundaries and tool constraint patterns; remaining WOTANN delta is stronger isolated tool policies per subagent.
38. Open-SWE — `local`. Confirms after-agent safety nets and PR automation; remaining WOTANN delta is deterministic post-run verification and publish flows.
39. Opcode — `local`. Confirms branching timeline and desktop-wrapper ideas; remaining WOTANN delta is richer desktop session controls and branch-aware agent history.

## Skill Collections

40. awesome-design-md — `direct`. Direct repo review confirms `DESIGN.md` as a plain-text design contract with reusable profiles, previews, and responsive/guardrail sections; remaining WOTANN delta is importing this pattern into frontend/design skills and optionally attaching design contracts in UI flows.
41. ai-marketing-skills — `direct`. Direct repo review confirms workflow-heavy, script-backed marketing/sales categories rather than shallow prompts; remaining WOTANN delta is merging these packs into WOTANN skill files with installable dependencies and references.
42. agentskills.io — `direct`. Direct docs review confirms a folder-based open standard with `SKILL.md`, scripts, references, and client-implementation guidance; remaining WOTANN delta is loader/converter support for the full directory format.
43. ClawHub — `direct`. Direct site review confirms a searchable AgentSkills registry with versioning, vector search, and install commands; remaining WOTANN delta is a comparable search/install/rollback UX.
44. Superpowers skills — `local`. Confirms modular planning/TDD/review skills; remaining WOTANN delta is better native packaging, discovery, and install UX.
45. fullstack-dev-skills — `local`. Confirms large framework/language skill packs; remaining WOTANN delta is broader ecosystem compatibility and external pack ingestion.
46. marketing-skills — `local`. Confirms workflow-oriented domain packs; remaining WOTANN delta overlaps with row 41: richer marketing skill depth and install flow.

## Research Papers And Engineering Posts

47. Building Effective AI Coding Agents — `direct`. The paper directly supports scaffolding, harness, context engineering, safety architecture, shadow git, and provider abstraction as core system design, not model-side tricks; remaining WOTANN delta is finishing the unimplemented harness pieces already called out in the spec.
48. LangChain Harness Engineering — `direct`. Direct article review reinforces that harness changes alone can materially lift benchmark outcomes; remaining WOTANN delta is more self-verification, tracing, and harness-first optimization.
49. Harness Engineering Guide — `direct`. Direct article review reinforces environments, constraints, and feedback loops as the reliability layer; remaining WOTANN delta is broader end-to-end verification and operator visibility.
50. Agent Harness Architecture — `direct`. Direct article review reinforces that model choice is downstream of runtime architecture quality; remaining WOTANN delta is continuing to treat provider/model additions as secondary to core harness correctness.
51. Cursor Dynamic Context Discovery — `direct`. Direct blog review confirms selective loading and agent-led context discovery; remaining WOTANN delta is deeper retrieval/routing logic, attachment UX, and context-pressure-aware UI.

## Benchmarks

52. TerminalBench — `direct`. Direct benchmark site review confirms terminal-agent evaluation relevance; remaining WOTANN delta is staying benchmark-driven in harness engineering, not just feature accumulation.
53. SWE-bench — `direct`. Direct benchmark review confirms real GitHub issue resolution as a quality target; remaining WOTANN delta is maintaining regression coverage for real coding tasks.
54. SWE-bench Pro — `direct`. Direct leaderboard/article review confirms long-horizon agent difficulty and contamination concerns; remaining WOTANN delta is improving robustness on longer plan-execute-verify loops.

## AI Models And Providers

55. Claude Opus 4.6 — `direct`. Current public Anthropic model docs do not expose a public `4.6` alias in the reviewed pages, which currently surface Opus 4 / 4.1; WOTANN should normalize this catalog row before hard-coding routing or pricing assumptions.
56. Claude Sonnet 4.6 — `direct`. Current public Anthropic docs surface Sonnet 4 rather than `4.6`; WOTANN should normalize model naming to real vendor IDs before implementation.
57. GPT-5.4 — `direct`. Current OpenAI model docs surface `GPT-5.2`, `GPT-5`, and related Codex variants rather than a public `GPT-5.4` label; WOTANN should normalize model naming and pricing to current OpenAI IDs.
58. GPT-5.3 Codex — `direct`. Current OpenAI docs surface `gpt-5-codex` and `gpt-5.2-codex`, not `GPT-5.3 Codex`; this row should be normalized before provider policy code uses it.
59. Gemini 3.1 Pro — `direct`. Current Google docs expose `Gemini 3 Pro Preview` and `Gemini 2.5 Pro`, not a public `3.1 Pro` label; WOTANN should normalize this row to current Gemini naming.
60. Gemma 4 — `direct`. Google’s official announcement confirms reasoning/agentic focus, structured outputs, tool use, and multimodal family support; remaining WOTANN delta is open-model routing plus Hugging Face/local deployment guidance.
61. Qwen 3.5 — `direct`. Current Qwen/Hugging Face and Ollama surfaces confirm a strong open model family relevant to long-context and local use; remaining WOTANN delta is curated local/provider presets.
62. Qwen3-Coder-Next — `direct`. Current Qwen/Hugging Face and Ollama surfaces confirm a coder-focused open model line; remaining WOTANN delta is a dedicated local coding-route recommendation path.
63. Nemotron Cascade 2 — `direct`. Current NVIDIA/Hugging Face model cards confirm a new reasoning/agentic open model family; remaining WOTANN delta is optional local/cloud fallback support and route recommendations.
64. MiniMax M2.7 — `direct`. Current public model surfaces center on `MiniMax-M2` / `MiniMax-M2.5`, not `M2.7`; WOTANN should normalize the catalog row before implementation, but the broader gap remains an open-model/provider path.

## MCP Servers And Tools

65. lightpanda — `direct`. Official site confirms a headless browser built for automation/AI agents with aggressive speed/memory claims; remaining WOTANN delta is adding it as a Tier 1 browser/perception route before heavier browser stacks.
66. playwright — `direct`. Official docs confirm reliable browser automation and an MCP/browser-automation path; remaining WOTANN delta is cleaner browser-tier routing and test/verification integration.
67. context7 — `direct`. Official docs confirm version-specific documentation retrieval over MCP; remaining WOTANN delta is retrieval routing and install/config UX.
68. qmd — `direct`. Direct repo/search review confirms local hybrid retrieval, MCP support, agent-friendly JSON/file outputs, and the token-savings thesis; remaining WOTANN delta is actual retrieval-tier integration rather than keeping it as a research note.
69. composio — `direct`. Official docs confirm large-scale app integrations and MCP/tool surfaces; remaining WOTANN delta is installation/configuration UX and provider/plugin integration.
70. WarpGrep — `direct`. Morph’s current product/benchmark pages confirm agentic code search as a distinct tool that improves coding-agent performance; remaining WOTANN delta is optional integration as an advanced search backend.

## Social Media References

71. @dharmikpawar13 — `direct`. Mirrorable X post was reviewed; it is useful as ecosystem/trend signal for memory, skills, and MCP popularity, but it is not a primary architecture source. WOTANN implication: keep ecosystem compatibility high.
72. @noisyb0y1 — `direct`. Mirrorable X post was reviewed; it reinforces pluginized multi-agent review/planning workflows. WOTANN implication: plugin ecosystem and review/team commands still need to mature.
73. @divyansht91162 — `direct`. Mirrorable X post was reviewed; it functions as community discovery signal for adjacent tools, not architectural ground truth. WOTANN implication: discovery and install UX matter because users compare ecosystems, not just cores.
74. @hasantoxr — `direct`. Mirrorable X post was reviewed; it is another community-discovery reference highlighting Paperclip, OpenClaude, Hermes, and oh-my-claudecode. WOTANN implication: the moat still depends on compound feature integration.

## Voice And STT/TTS

75. OpenAI Whisper — `direct`. Official README confirms general-purpose speech recognition, multilingual transcription, translation, and language identification; remaining WOTANN delta is optional voice pipeline integration, not core harness logic.
76. faster-whisper — `direct`. Direct README review confirms faster CTranslate2 inference and better resource efficiency than baseline Whisper; remaining WOTANN delta is a strong local STT option for future voice mode.
77. WhisperKit — `direct`. Direct README review confirms on-device Apple Silicon transcription with streaming, timestamps, diarization, and local-server options; remaining WOTANN delta is platform-specific voice integration.
78. OpenAI Realtime API — `direct`. Official OpenAI article confirms persistent websocket voice sessions, interruptions, and function calling; remaining WOTANN delta is real-time voice agent support if voice becomes a priority surface.
79. ElevenLabs — `direct`. Official site confirms premium voice/TTS/voice-agent positioning; remaining WOTANN delta is optional premium TTS integration.
80. Piper TTS — `direct`. Direct README/site review confirms fast local neural TTS; remaining WOTANN delta is optional offline voice support.

## Internal WOTANN References

81. WOTANN_V4_SPEC.md — `direct`. Read in the required order; authoritative feature/spec baseline for implementation.
82. BUILD_GUIDE.md — `direct`. Read in the required order; authoritative phase map and architecture guide.
83. COMPETITIVE_ANALYSIS.md — `direct`. Read and used as a local synthesis source for competitor gaps and naming drift.
84. AGENT_FRAMEWORK_ANALYSIS.md — `direct`. Read and used as a local synthesis source for orchestration, sandbox, and recovery patterns.
85. ECOSYSTEM-CATALOG.md — `direct`. Read and used as a local synthesis source for plugin/skill ecosystem patterns.
86. UNIFIED_SYSTEMS_RESEARCH.md — `direct`. Read and used as a local synthesis source for memory, routing, planning, and prompt systems.
87. COMPUTER_CONTROL_ARCHITECTURE.md — `direct`. Read after the user called out the research gap; used to validate computer-use/perception layering and safety tiers.
88. reference/SKILLS_ROSTER.md — `direct`. Read in the required order; authoritative inventory of current skill definitions.
89. reference/AGENTS_ROSTER.md — `direct`. Read in the required order; authoritative inventory of agent roles and behaviors.
90. reference/MEMORY_ARCHITECTURE.md — `direct`. Read in the required order; authoritative memory-layer design reference.
91. reference/HOOKS_REGISTRY.md — `direct`. Read in the required order; authoritative hook/event reference.
92. reference/TOOLS_AND_MCP.md — `direct`. Read in the required order; authoritative tool-tier and MCP registry reference.

## Outcome

Research coverage is now explicit for every row in `SOURCES.md`.

Highest-value implementation implications reaffirmed by this full audit:
- finish interrupted-stream recovery and resumable streams
- complete `wotann channels start` and message round-trip testing
- add agentskills directory-format support
- wire real git worktree isolation into parallel/team execution
- complete multi-panel TUI wiring
- deepen Ralph mode into a governed verify-fix loop
- add qmd/lightpanda/WarpGrep-class optional tool tiers where they materially improve retrieval or browser speed
- normalize provider/model catalog names before adding more routing logic
