# NEXUS Source Extraction Matrix
> Date: April 3, 2026
>
> Method:
> - Internal/spec/reference sources were read locally.
> - External sources were cross-checked from their current public docs, READMEs, or official sites where practical.
> - Status legend: `done`, `partial`, `missing`, `research-only`.

## Executive Conclusions
- The biggest remaining moat opportunity is not “more providers.” It is a stronger provider-agnostic harness layer: dispatch, context virtualization, capability equalization, memory provenance, always-on channels, and proof-oriented verification.
- NEXUS already has broad surface area, but a meaningful fraction of it is still `partial`: implemented enough to demo, not yet deep enough to dominate.
- The single most important architectural theme across the sources is the same: harness quality beats raw model choice once the model is already frontier-capable.

## Competitors
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 1 | Claude Code | hooks, MCP import, resumable sessions, long-context agent loop | partial | Keep matching parity, but route every surface through runtime and maintain stronger provider abstraction |
| 2 | Codex CLI | kernel sandbox, session resume, strong TTY UX | partial | Keep macOS sandbox live, add Linux parity and tighter CLI resumability |
| 3 | OpenClaw | omni-channel inbox, device nodes, dispatch routing, companion model | partial | Promote channels into a first-class Dispatch control plane with per-route runtime isolation and policy |
| 4 | Cursor | dynamic context discovery, polished IDE-grade UX, fast code interaction loops | partial | Keep improving TUI context surfacing, retrieval targeting, and diff/task panels |
| 5 | NemoClaw | privacy router, intent verification, sandbox shell | partial | Add stricter privacy routing and preflight intent/risk classification before high-risk actions |
| 6 | free-code | guardrails-off execution, safety prompt stripping | partial | Keep guardrails-off mode, but make it smarter about provider choice and evidence logging |
| 7 | OpenClaude | provider translation, health scoring, Claude internals | partial | Keep format translation and health scoring in the hot path; expand capability-normalization |
| 8 | Jean | worktrees, multi-workspace execution, remote/phone access | partial | Deepen worktree orchestration and add multi-workspace switching as a first-class runtime concept |
| 9 | KiloCode | file freezing, loop breaker, large model catalog | partial | Add file freezing and stronger loop prevention primitives beyond doom-loop detection |
| 10 | PraisonAI | multi-agent swarms, messaging delivery surfaces | partial | Keep team/orchestration, add better autonomous handoff into channels |
| 11 | Conductor | track-based phased development, contextual project tracks | partial | Convert modes plus planning phases into reusable “tracks” for common workflows |
| 12 | Cline | browser automation, IDE-integrated autonomy, checkpointing | partial | Keep CU/browser capability but route it cleanly into runtime and verification |
| 13 | Windsurf | editor-native flow, cascade-style assistance | research-only | Borrow UX ideas for continuous suggestions and context-aware panel defaults |
| 14 | Crush/OpenCode | agent-skills compatibility, LSP-rich editing, provider breadth | partial | Keep skills and LSP strong; expand symbol-aware mutations and skill portability |
| 15 | DeerFlow | deep middleware, sandboxed subagents, virtual paths | partial | Keep middleware stack, add virtual path and isolated execution ergonomics |
| 16 | Hive | checkpoint recovery, budget enforcement, graph execution | partial | Add harder budget gates, checkpoint restore breadth, and graph-based recovery |
| 17 | GSD | wave execution, fresh context per task, UAT emphasis | partial | Deepen wave execution and task-specific fresh context packaging |
| 18 | oh-my-claudecode | Ralph mode, auto-resume on limits | partial | Keep Ralph richer than retry loops; add clearer escalation and proof reporting |
| 19 | oh-my-pi | hash-anchored editing, TTSR, stronger LSP toolset | partial | Implement hash-anchored editing and extend symbol-level editing reliability |
| 20 | Letta/MemGPT | editable memory blocks, long-lived memory OS | partial | Expand memory provenance, background maintenance, and self-editable user/project blocks |
| 21 | AutoGPT | visual builders, protocol interoperability | missing | Consider protocol/export surface for workflows and graph interchange |
| 22 | Hermes Agent | shadow git, crash recovery | partial | Keep shadow git always available around dangerous operations, not only verification |
| 23 | VoltAgent | marketplace growth loop, community skills | partial | Expand skill marketplace install, eval, publish, and ranking |
| 24 | ForgeCode | doom-loop detector, compaction pipeline, benchmark hooks | partial | Keep compaction live, add more automatic recovery and benchmark guardrails |
| 25 | LibreChat | resumable streams, multi-tab continuity | partial | Keep stream resume and add stronger session sync across surfaces |
| 26 | Paperclip | coding-agent workflow patterns | research-only | Mine implementation patterns for task execution UX and tool loop simplification |
| 27 | claude-code-router | intent-based routing and cost savings | partial | Keep intent-based routing, make it more explicit and measurable |
| 28 | Serena | symbol-level search and edit flow | partial | Extend LSP operations into more rename/replace-by-symbol workflows |
| 29 | Ruflo | WASM tier-0 bypass and routing tiers | partial | Expand deterministic bypass catalog beyond basic shortcut cases |
| 30 | SuperClaude | behavioral mode switching | partial | Merge mode semantics with skills and policy packs more aggressively |
| 31 | claude-reflect | correction capture and auto-learning | partial | Keep learning loop, tie it deeper into hooks and post-run analysis |
| 32 | Superpowers | reusable high-value skills | partial | Continue absorbing patterns into native skills and mode-linked bundles |

## Agent Frameworks & Architecture
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 33 | Claude Agent SDK | agentic subprocess loop and tool orchestration | partial | Preserve as one provider path, but keep runtime above it |
| 34 | OpenAI Agents SDK | guardrails, handoffs, structured orchestration | partial | Borrow handoff and guardrail abstractions into orchestration and policy systems |
| 35 | LangGraph | graph execution and explicit control flow | partial | Expose graph orchestration more broadly than the current DSL surface |
| 36 | CrewAI | role-based multi-agent collaboration | partial | Improve role packs, ownership boundaries, and review-worker coordination |
| 37 | DeepAgents | filesystem backend, planning tool, long-task harness | partial | Keep harness-first approach and add stronger CLI/runtime composition |
| 38 | Open-SWE | after-agent safety nets and PR pipelines | partial | Strengthen autonomous finish criteria and publish-ready review flows |
| 39 | Opcode | branching timelines and desktop wrapper | missing | Add better branch/attempt comparison and branch-native UX |

## Skill Collections
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 40 | awesome-design-md | better frontend/system design patterns | partial | Continue merging into native design-system and frontend skills |
| 41 | ai-marketing-skills | growth, SEO, outbound, conversion operations | partial | Continue native marketing skill pack and connect it to channels/automation |
| 42 | agentskills.io | cross-harness skill format | done | Keep compatibility current and support more bundle metadata over time |
| 43 | ClawHub | skill marketplace and discovery | partial | Expand search, install, ratings, verification, and publish flows |
| 44 | Superpowers skills | TDD/debugging/review heuristics | partial | Promote the best patterns into mode-aware native skill bundles |
| 45 | fullstack-dev-skills | broad language/framework skill coverage | partial | Keep growing language-specific skill coverage with progressive disclosure |
| 46 | marketing-skills | marketing automation playbooks | partial | Merge into outbound and campaign automation tied to channels |

## Research Papers & Engineering Posts
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 47 | Building Effective AI Coding Agents | scaffolding and control loops matter more than raw model choice | partial | Keep optimizing harness layers and benchmark them independently of provider |
| 48 | LangChain Harness Engineering | trace-driven improvement loop, measurable harness gains | partial | Use trace analytics plus evals as a continuous improvement loop |
| 49 | Harness Engineering Guide | practical harness patterns across planning, memory, tools | partial | Convert patterns into explicit checklists and policy toggles |
| 50 | Agent Harness Architecture | harness, not model, is the bottleneck | partial | Keep investing in routing, context, memory, and verification over provider count |
| 51 | Cursor Dynamic Context Discovery | retrieve only what matters, not whole trees | partial | Push file targeting, retrieval ranking, and context virtualization much further |

## Benchmarks
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 52 | TerminalBench | terminal-task benchmark target | partial | Keep a benchmark-engineering layer and make benchmark hooks measurable |
| 53 | SWE-bench | issue-resolution quality baseline | research-only | Add repo-level eval recipes for tracked benchmark-style tasks |
| 54 | SWE-bench Pro | long-horizon task evaluation | research-only | Build long-horizon evals for orchestration, not only single queries |

## AI Models & Providers
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 55 | Claude Opus 4.6 | deep reasoning and long-context tier | partial | Keep support, but distinguish documented 1M from active effective context |
| 56 | Claude Sonnet 4.6 | fast frontier coding | partial | Keep as fast frontier default, with truthful context reporting |
| 57 | GPT-5.4 | high-context flagship model | partial | Keep first-class support and context-aware routing/cost policy |
| 58 | GPT-5.3 Codex | subscription route and large context | partial | Keep codex route strong and use it for long-horizon planning/editing |
| 59 | Gemini 3.1 Pro / Gemini family | cheap or free large context | partial | Keep Gemini as a long-context/value tier and improve capability equalization |
| 60 | Gemma 4 | strong open local model | partial | Keep local model support and optimize model-specific skill/prompt presets |
| 61 | Qwen 3.5 | strong local reasoning | partial | Keep as reasoning-default in local mode |
| 62 | Qwen3-Coder-Next | strong local coding | partial | Keep as local coding-default and improve edits anchored to weak-model safety |
| 63 | Nemotron Cascade 2 | efficient local cascade behavior | partial | Use for utility and classification workloads where efficiency matters |
| 64 | MiniMax M2.7 | high skill adherence locally | research-only | Explore as a mode/skill-heavy local backend |

## MCP Servers & Tools
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 65 | lightpanda | fast browser automation | missing | Add as an optional fast browser MCP/server route |
| 66 | playwright | browser automation | partial | Keep available and expose more browser-first workflows |
| 67 | context7 | documentation retrieval | missing | Add MCP preset/import for library-doc retrieval |
| 68 | qmd | precision retrieval with token savings | partial | Keep QMD integration and deepen it into live prompt assembly and memory recall |
| 69 | composio | app integration surface | missing | Consider as a unified app-action layer for channels and automations |
| 70 | WarpGrep | stronger code search | missing | Evaluate for codebase search quality and symbol-aware ranking |

## Social Media References
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 71 | @dharmikpawar13 | agent harness techniques | research-only | Mine for small tactical improvements, not architecture anchors |
| 72 | @noisyb0y1 | harness patterns | research-only | Use as prompt/UX idea source only after validation |
| 73 | @divyansht91162 | coding-agent comparison | research-only | Cross-check feature claims before acting on them |
| 74 | @hasantoxr | architecture observations | research-only | Treat as supporting signals, not authoritative specs |

## Voice & STT/TTS
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 75 | Whisper | cloud STT | partial | Keep optional cloud STT path |
| 76 | faster-whisper | strong local STT | partial | Prefer as local-first STT backend for real TUI voice mode |
| 77 | WhisperKit | Apple Silicon STT | partial | Prefer on macOS when available for low-latency push-to-talk |
| 78 | OpenAI Realtime API | low-latency multimodal voice loop | partial | Add richer full-duplex voice sessions, not only status/capture surfaces |
| 79 | ElevenLabs | premium TTS quality | partial | Keep as optional premium voice backend |
| 80 | Piper TTS | offline TTS | partial | Prefer as offline default for privacy-first voice mode |

## Internal NEXUS Sources
| # | Source | Extracted Capability | NEXUS Status | Recommended Action |
|---|--------|----------------------|--------------|--------------------|
| 81 | NEXUS_V4_SPEC.md | definitive feature spec | partial | Continue auditing code vs spec claims; do not let docs overstate live behavior |
| 82 | BUILD_GUIDE.md | phase map and architecture guide | done | Keep aligned with implementation reality |
| 83 | COMPETITIVE_ANALYSIS.md | competitor strengths and weaknesses | partial | Refresh with 2026 market changes and newly shipped competitors |
| 84 | AGENT_FRAMEWORK_ANALYSIS.md | framework patterns | partial | Convert more framework patterns into architecture decisions and tests |
| 85 | ECOSYSTEM-CATALOG.md | ecosystem feature catalog | partial | Keep translating catalog items into roadmap entries |
| 86 | UNIFIED_SYSTEMS_RESEARCH.md | cross-cutting system patterns | partial | Use as control document for memory/routing/prompt upgrades |
| 87 | COMPUTER_CONTROL_ARCHITECTURE.md | CU implementation patterns | partial | Keep aligning runtime/computer-use integration to this architecture |
| 88 | reference/SKILLS_ROSTER.md | skill inventory | partial | Keep roster current and verify every rostered skill is real and usable |
| 89 | reference/AGENTS_ROSTER.md | agent role inventory | partial | Tie roster roles more directly into live orchestration surfaces |
| 90 | reference/MEMORY_ARCHITECTURE.md | memory layer definition | partial | Bring implementation depth closer to the architecture claims |
| 91 | reference/HOOKS_REGISTRY.md | hook events and built-ins | partial | Keep registry and runtime hook coverage synchronized |
| 92 | reference/TOOLS_AND_MCP.md | tool tiers and MCP registry | partial | Expand actual MCP registry ergonomics and built-in server presets |

## Highest-Leverage Upgrade Themes
1. Dispatch Everywhere
Transform channels from adapters into a unified dispatch plane with route policies, device nodes, human approval, background delivery, and provider-agnostic sessions.

2. Context Virtualization
Do not chase 1M on every provider. Build a context system that makes 128K feel larger via retrieval, compaction, compression, summaries, file shards, and subtask fresh-context execution.

3. Memory Provenance
Make every retrieved memory carry trust, freshness, source, and verification state. Strong memory beats raw window size.

4. Capability Equalization
Any provider should get the best possible version of tools, vision, thinking, channels, and CU that the harness can realistically emulate.

5. Proof-Oriented Autonomy
Completion should require evidence: tests, traces, screenshots, diffs, logs, and explicit success criteria.
