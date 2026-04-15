<div align="center">

<h1>WOTANN</h1>

<p><strong>The All-Father of AI agent harnesses.</strong><br/>
One install. Every model. Every channel. Full autonomy.</p>

<p>
  <a href="https://github.com/gabrielvuksani/wotann/actions/workflows/ci.yml"><img src="https://github.com/gabrielvuksani/wotann/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/gabrielvuksani/wotann/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/node-%E2%89%A520-43853d.svg?logo=node.js&logoColor=white" alt="Node 20+"></a>
  <a href="#platforms"><img src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20iOS-supported-555.svg" alt="Platforms"></a>
  <a href="https://wotann.com"><img src="https://img.shields.io/badge/wotann.com-Norse%20themed-0A84FF.svg" alt="wotann.com"></a>
</p>

<p><em>WOTANN treats the LLM as just the inference call. Everything else — memory, tools, sandbox, orchestration, learning — comes from the harness. A local Gemma gets the same intelligence scaffolding as Claude Opus.</em></p>

</div>

---

## What WOTANN Is

A unified AI agent harness that **amplifies every model with the same intelligence layer**: 20+ middleware layers (2 always-on, 16 conditional), 8-layer memory (SQLite + FTS5 + graph-RAG + vector), 10 genuine multi-step orchestration patterns, 19-event hook engine, 4-layer Computer Use, and a Norse-themed identity system. Use it from the terminal, the desktop app, your iPhone (with Watch + CarPlay + Widgets + Siri), or any of 14 real messaging channels — same agent, same memory, same capabilities.

| | Most agents | WOTANN |
|---|---|---|
| **Provider** | Locked to one vendor | 17 providers via openai-compat router; Anthropic + OpenAI subscriptions OR API keys |
| **Capabilities by model** | Tool-calling, vision, thinking gated by what your model supports | Capability augmentation injects all three for any model — even a 3B local Gemma |
| **Free tier** | An afterthought | First-class: Ollama + Groq + Gemini 2.5 Flash free tier give the full experience |
| **Memory** | Short-lived prompt context | 8-layer SQLite + FTS5 + vector + graph-RAG + episodic + temporal, with provenance |
| **Surfaces** | One UI | CLI + TUI + Desktop (Tauri) + iOS + Watch + CarPlay + 15 messaging channels |
| **Autonomy** | Vibes | Proof bundles (tests + typecheck + diff + screenshots) attached to every completion |
| **Lock-in** | Total | Switch from Claude → Gemini → Gemma mid-session without losing context, tools, or capabilities |

## Quick Start

```bash
# One-line install (macOS or Linux)
curl -fsSL https://raw.githubusercontent.com/gabrielvuksani/wotann/main/install.sh | bash

# Or from npm (when published)
npm install -g wotann

# Initialize a workspace
wotann init

# Start the always-on engine
wotann engine

# Launch the TUI
wotann
```

That's the entire setup. By default WOTANN runs entirely locally (Ollama + free tiers). Drop an API key into any provider to upgrade selectively.

```bash
# Use frontier models when you want them
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AIza...

# Or stay free
ollama pull qwen2.5-coder:7b
wotann                              # auto-detects Ollama
```

## Headline Capabilities

### Provider freedom (the moat)

17 providers via one router with automatic fallback chaining: `preferred → other paid → Gemini → Ollama → free`. **The model is never silently degraded** — if your chosen Opus is rate-limited, WOTANN tries Opus via another provider first; only when all paid paths exhaust does it fall back to Gemini/local. Decision recorded in `DECISIONS.md` D25.

```text
Anthropic API · Anthropic Subscription · OpenAI · Codex (ChatGPT OAuth)
GitHub Copilot · Ollama · Gemini · HuggingFace · Azure · Bedrock
Vertex · Mistral · DeepSeek · Perplexity · xAI · Together · Fireworks · SambaNova
```

### The harness amplifies — even on a 3B local model

WOTANN's `capability-augmenter.ts` injects tool-calling, vision (via OCR + a11y tree), and extended thinking ("step by step" prompts) into providers that lack native support. Combined with hash-anchored editing, line-bucketed loop detection, and 21 forced-verification middleware layers, a Qwen2.5-Coder:7B running locally gets the same forced verification, frustration detection, doom-loop guards, and memory system as Claude Opus.

### Multi-surface, one agent

| Surface | What you get |
|---|---|
| **CLI** | 78 commands incl. `init`, `engine`, `autonomous`, `arena`, `link`, `enhance`, `cost` |
| **TUI** | Ink-rendered REPL with the Obsidian Precision theme, voice push-to-talk, slash commands |
| **Desktop** (Tauri 2) | Chat / Editor (Monaco) / Workshop / Exploit / Trust / Integrations tabs, Computer Use panel, command palette ⌘K |
| **iOS** | Phase C chat redesign, Phase D work tab with filter pills, Phase E onboarding wizard |
| **Apple Watch** | Quick actions (run tests, build, lint, approve all, voice input) via WCSession |
| **CarPlay** | List + detail templates for hands-free dispatch |
| **Widgets + Live Activities** | Cost + agent status home screen widgets, Dynamic Island progress |
| **Share Extension** | Send any text/URL into a WOTANN conversation from any iOS app |
| **Siri** | Three intents — AskWOTANN / CheckCost / EnhancePrompt |
| **Channels** | Telegram, Slack, Discord, Signal, WhatsApp, iMessage, Teams, Matrix, email, webchat, webhooks, SMS, GitHub bot, IDE bridge, IRC, Google Chat |

### Autonomous with proof

```bash
wotann autonomous "fix the failing tests in src/memory"
```

Runs Ralph mode (verify-fix loop) + self-healing (provider fallback) + 8-strategy escalation (decompose, research-first, minimal-change, revert-and-retry, fresh-context, different-model, ask-for-help). Doom-loop detector prevents infinite cycles. Every completion ships with a **proof bundle**: tests, typecheck, lint, diff summary, optional screenshots. Trust UI surfaces them.

## Architecture in One Diagram

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Surfaces                                                            │
│  CLI · TUI · Desktop (Tauri) · iOS · Watch · CarPlay · 15 channels  │
└──────────────────┬───────────────────────────┬──────────────────────┘
                   │                           │
                   ▼                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  KAIROS Daemon (always-on, ~/.wotann/kairos.sock)                   │
│  Session-token auth · 15s tick · cron · heartbeat · event triggers  │
└──────────────────┬───────────────────────────┬──────────────────────┘
                   │                           │
                   ▼                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  WotannRuntime (composition root)                                   │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────────┐ │
│  │ 26-layer    │ │ 42 intel    │ │ 29 orch    │ │ 19-event hooks │ │
│  │ middleware  │ │ modules     │ │ patterns   │ │ + DoomLoop     │ │
│  └─────────────┘ └─────────────┘ └────────────┘ └────────────────┘ │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────────┐ │
│  │ 8-layer     │ │ 4-layer     │ │ 17 prov    │ │ Skill registry │ │
│  │ memory      │ │ Computer Use│ │ + fallback │ │ + MCP registry │ │
│  └─────────────┘ └─────────────┘ └────────────┘ └────────────────┘ │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
        Inference call (the only thing the LLM does)
```

## Project Structure

```text
src/
├── core/             Composition root (WotannRuntime), agent bridge, types
├── providers/        17 adapters · router · rate limiter · format translator
├── middleware/       26-layer pipeline + TTSR streaming
├── intelligence/     42 modules (accuracy boost, ambient awareness, codebase health, ...)
├── orchestration/    29 patterns (coordinator, waves, PWR, Ralph, self-healing, council)
├── memory/           SQLite + FTS5 · 8 layers · vector · graph-RAG · episodic
├── context/          5 compaction strategies · Ollama KV cache compression (turboquant-wasm v0.3.0 integration on the v0.3.0 roadmap)
├── prompt/           Engine · 18 prompt modules · instruction provenance (E8)
├── hooks/            19 events · 17+ guards · DoomLoop · benchmark engineering
├── computer-use/     4-layer perception + action stack (text-mediated for any model)
├── channels/         15 adapters + DM pairing + node registry
├── voice/            Push-to-talk · STT/TTS · WhisperKit · Edge TTS · faster-whisper
├── learning/         autoDream · instincts · skill-forge · pattern-crystallizer
├── identity/         Persona system · soul/identity loading · Norse mythology
├── security/         Anti-distillation · PII redaction · sandbox · guardrails
├── telemetry/        Cost tracker · session analytics · audit trail
├── marketplace/      MCP registry · skill marketplace
├── ui/               Ink TUI · 20 themes · voice controller · diff engine
├── desktop/          Tauri config · companion server · app state
├── mobile/           iOS handlers · pairing · haptics · live activities
└── daemon/           KAIROS engine · IPC · RPC · cron · heartbeat

desktop-app/          Tauri 2 desktop (React + Rust), ⌘K command palette
ios/                  SwiftUI app (5 targets — main / Intents / Widgets / Watch / Share)
docs/                 Master plans, architecture audits, design system
skills/               86 markdown skills (progressive disclosure)
research/             10 cloned competitor harnesses + 30+ tracked GitHub repos
```

## Commands

| Command | Purpose |
|---------|---------|
| `wotann init` | Initialize workspace |
| `wotann engine` | Start the KAIROS daemon |
| `wotann doctor` | Health diagnostics |
| `wotann arena` | Compare models blind side-by-side |
| `wotann autonomous <task>` | Autonomous execution with proof bundle |
| `wotann link` | Pair an iPhone via PIN or Bonjour |
| `wotann onboard` | Interactive provider setup |
| `wotann voice` | Push-to-talk voice mode |

Run `wotann --help` for the full 78-command surface.

## Platforms

- **macOS 13+** — full support including desktop DMG (ad-hoc signed)
- **Linux** — CLI + daemon (TUI optional)
- **Windows 11** — CLI + daemon (Tauri build supported, untested)
- **iOS 18+** — companion app (TestFlight not yet available — clone + build)
- **watchOS 11+** — Watch companion (paired via iPhone)

## Privacy

Runs entirely locally by default. Telemetry is opt-out (industry-standard `DO_NOT_TRACK=1` honored, plus WOTANN-specific `WOTANN_NO_TELEMETRY=1`, plus a sentinel file at `~/.wotann/no-telemetry`).

```bash
export WOTANN_NO_TELEMETRY=1
```

## Configuration

Per-user config lives in `~/.wotann/`:

```text
~/.wotann/
├── wotann.yaml              # User config (providers, channels, MCP servers)
├── session-token.json       # 256-bit daemon RPC auth token (chmod 0600)
├── memory.db                # SQLite + FTS5 — gitignored
├── sessions/                # Per-session JSON snapshots
├── dreams/                  # Dream-pipeline outputs
├── episodes/                # Episodic memory
├── logs/                    # Daily JSONL daemon logs
└── identity/                # SOUL.md, IDENTITY.md, AGENTS.md, etc.
```

## Authentication

The daemon enforces session-token auth on every RPC call. Local clients (CLI, desktop, iOS) read `~/.wotann/session-token.json` automatically. For development, set `WOTANN_AUTH_BYPASS=1` — see [`docs/AUTH.md`](docs/AUTH.md).

## Contributing

Pull requests welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, coding conventions (TypeScript strict, no `any`, immutable data, 200-400 LOC files), and how the `planner → test-engineer → code-reviewer → verifier` agent dispatch works.

## Security

Found a vulnerability? See [`SECURITY.md`](SECURITY.md) for responsible disclosure. The daemon's RPC surface, sandbox, and Tauri configuration are the primary review targets.

## Documentation

| Doc | What's inside |
|---|---|
| [`docs/DEEP_AUDIT_2026-04-13.md`](docs/DEEP_AUDIT_2026-04-13.md) | Full architecture audit — 235K LOC across 4 platforms, 76-item roadmap |
| [`docs/AUTH.md`](docs/AUTH.md) | Daemon RPC authentication convention |
| [`docs/MASTER_PLAN_PHASE_2.md`](docs/MASTER_PLAN_PHASE_2.md) | Premium feature roadmap (6 tiers) |
| [`DECISIONS.md`](DECISIONS.md) | 39 architectural decisions with rationale |
| [`ROADMAP.md`](ROADMAP.md) | Competitive roadmap + brainstormed features |
| [`TERMINALBENCH_STRATEGY.md`](TERMINALBENCH_STRATEGY.md) | How the harness adds +15-25% to model benchmarks |
| [`HANDOFF.md`](HANDOFF.md) | Operational handoff (architecture diagrams, gotchas) |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |

## Acknowledgements

WOTANN's harness ideas borrow generously from the open-source agent ecosystem. See [`research/REPOS.md`](research/REPOS.md) for the 10 competitor harnesses tracked locally and the 30+ monitored via GitHub.

Notable inspirations: Hermes Agent (NousResearch), DeepAgents (LangChain), Open-SWE (LangChain), DeerFlow (ByteDance), oh-my-openagent, opcode, eigent, Aider, Cursor, Claude Code, Codex CLI, charmbracelet/crush, oraios/serena, can1357/oh-my-pi.

## License

[MIT](LICENSE) © 2026 Gabriel Vuksani

> *"Think like Odin: see the whole board, pay the price for true knowledge, speak directly, build what will last, and let Huginn and Muninn carry the memory forward."* — `.wotann/SOUL.md`
