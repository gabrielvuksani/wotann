<div align="center">

# WOTANN

**The All-Father of AI agent harnesses.**

One install. Every model. Every channel. Full autonomy.

<p>
  <a href="https://github.com/gabrielvuksani/wotann/actions/workflows/ci.yml"><img src="https://github.com/gabrielvuksani/wotann/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/gabrielvuksani/wotann/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/node-%E2%89%A520-43853d.svg?logo=node.js&logoColor=white" alt="Node 20+"></a>
  <a href="#platforms"><img src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20iOS-supported-555.svg" alt="Platforms"></a>
  <a href="#headline-capabilities"><img src="https://img.shields.io/badge/providers-19-0A84FF.svg" alt="19 providers"></a>
  <a href="#headline-capabilities"><img src="https://img.shields.io/badge/channels-25%2B-0A84FF.svg" alt="25+ channels"></a>
  <a href="#tests"><img src="https://img.shields.io/badge/tests-5860%20passing-green.svg" alt="5860 passing tests"></a>
  <a href="https://wotann.com"><img src="https://img.shields.io/badge/wotann.com-Norse%20themed-8B5CF6.svg" alt="wotann.com"></a>
  <a href="https://www.linuxfoundation.org/press/linux-foundation-announces-formation-of-agentic-ai-foundation"><img src="https://img.shields.io/badge/AAIF-Agentic%20AI%20Foundation-0094FF.svg" alt="AAIF aligned"></a>
</p>

<br/>

<table>
<tr>
<td align="center">
<strong>WOTANN treats the LLM as just the inference call.</strong><br/>
Memory, tools, sandbox, orchestration, learning — all come from the harness.<br/>
A local Gemma gets the same intelligence scaffolding as Claude Opus.
</td>
</tr>
</table>

<br/>

</div>

---

## Why WOTANN

Most agent frameworks lock you to a vendor, degrade quietly when a model can't tool-call, and hand you a single UI. WOTANN inverts that. It lives at the layer above inference so your choice of model is always a drop-in. Switch from Claude → Gemini → Gemma mid-session and you keep the same memory, the same tools, the same capabilities.

|   | Most agents | **WOTANN** |
|---|---|---|
| **Provider** | Locked to one vendor | **19 providers** via openai-compat router; Anthropic + OpenAI subscriptions OR API keys |
| **Capabilities** | Tool-calling, vision, thinking gated by model support | **Capability augmentation injects all three** for any model — even a 3B local Gemma |
| **Free tier** | An afterthought | **First-class**: Ollama + Groq + Gemini 2.5 Flash free tier give the full experience |
| **Memory** | Short-lived prompt context | **8-layer persistent**: SQLite + FTS5 + vector + graph-RAG + episodic + temporal + provenance |
| **Surfaces** | One UI | **CLI + TUI + Desktop + iOS + Watch + CarPlay + 25 messaging channels** |
| **Autonomy** | Vibes | **Proof bundles** (tests + typecheck + diff + screenshots) on every completion |
| **Lock-in** | Total | Zero — swap models mid-session, export all state |

---

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

That's the whole setup. WOTANN runs **entirely locally by default** (Ollama + free tiers). Drop an API key to upgrade selectively — no lock-in, no telemetry unless you opt in.

```bash
# Use frontier models when you want them
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AIza...

# Or stay free
ollama pull qwen2.5-coder:7b
wotann                              # auto-detects Ollama
```

---

## A Minute of WOTANN

```bash
# Fix failing tests autonomously — with a proof bundle
$ wotann autonomous "fix the failing tests in src/memory"
  [1/8] verification: 3 failing tests detected
  [2/8] strategy: minimal-change (preferred — tests are green-adjacent)
  [3/8] patch: memory/store.ts:441 null-check added, memory/hybrid.ts:88 guard
  [4/8] verification: 367/367 files · 5860/5860 tests · 0 failed · 46.01s
  [5/8] proof bundle: artifacts/proof-2026-04-20-133801.tar.gz
  [6/8] crystallize: skill saved as skills/fix-null-check-memory-store.md
  SUCCESS in 3 cycles · $0.42 · 47,000 tokens

# Compare three models blind, side-by-side
$ wotann arena "refactor this function for readability"
  ─── A ──────────  ─── B ──────────  ─── C ──────────
  [Opus output]     [GPT-5.4 output]  [Gemini 3 Pro output]
  Blind choice: B (revealed: GPT-5.4)

# Same conversation, phone tap
$ wotann link
  Scan QR on iPhone. Token transferred via ECDH. Session mirrored.
```

---

## Headline Capabilities

### Provider freedom (the moat)

19 providers via one router with automatic fallback chaining: `preferred → other paid → Gemini → Ollama → free`. **The model is never silently degraded** — if your chosen Opus is rate-limited, WOTANN tries Opus via another provider first; only when all paid paths exhaust does it fall back to Gemini/local.

```
Anthropic API    Anthropic Subscription   OpenAI    Codex (ChatGPT OAuth)
GitHub Copilot   Ollama                   Gemini    HuggingFace
Azure            Bedrock                  Vertex    Mistral
DeepSeek         Perplexity               xAI       Together
Fireworks        SambaNova                Groq      Cerebras
```

### The harness amplifies — even on a 3B local model

`capability-augmenter` injects tool-calling, vision (via OCR + a11y tree), and extended thinking ("step by step" prompts) into providers that lack native support. Combined with hash-anchored editing, line-bucketed loop detection, and 20+ forced-verification middleware layers, a **Qwen2.5-Coder:7B running locally gets the same forced verification, frustration detection, doom-loop guards, and memory system as Claude Opus**.

### Multi-surface, one agent, one memory

| Surface | What you get |
|---|---|
| **CLI** | 78+ commands incl. `init`, `engine`, `autonomous`, `arena`, `link`, `enhance`, `cost` |
| **TUI** | Ink-rendered REPL · Obsidian Precision theme · voice push-to-talk · slash commands · OSC 133 blocks |
| **Desktop** (Tauri 2) | Chat / Editor (Monaco) / Workshop / Exploit / Trust / Integrations · Command palette ⌘K · Computer Use panel |
| **iOS** (SwiftUI) | Phase C chat · Phase D work tab with filter pills · Phase E onboarding wizard |
| **Apple Watch** | Quick actions (run tests, build, lint, approve, voice) via WCSession |
| **CarPlay** | Hands-free dispatch with list + detail templates |
| **Widgets + Live Activities** | Cost + agent status widgets · Dynamic Island progress |
| **Share Extension** | Send any text/URL into a WOTANN conversation from any iOS app |
| **Siri Intents** | AskWOTANN · CheckCost · EnhancePrompt |
| **Channels (25+)** | Telegram · Slack · Discord · Signal · WhatsApp · iMessage · Teams · Matrix · Mastodon · WeChat · LINE · Viber · DingTalk · Feishu · Email · SMS · Webhooks · GitHub bot · IDE bridge · IRC · Google Chat · webchat · + more |

### Autonomous with proof, not vibes

```bash
wotann autonomous "fix the failing tests in src/memory"
```

Runs **Ralph mode** (verify-fix loop) + **self-healing** (provider fallback) + **8-strategy escalation** (decompose, research-first, minimal-change, revert-and-retry, fresh-context, different-model, ask-for-help). Doom-loop detector prevents infinite cycles. Every completion ships a **proof bundle**: tests, typecheck, lint, diff summary, optional screenshots. Trust UI surfaces them to you.

### Intelligence you can inspect

- **Guardian** post-response LLM-as-judge review (`WOTANN_GUARDIAN=1`)
- **Self-consistency voting** — N parallel samples with confidence score
- **Council deliberation** — 3-stage multi-provider peer review + chairman synthesis
- **Unified knowledge fabric** — single search API across memory / context-tree / graph-RAG / vector / FTS5
- **Context replay** — priority-weighted reassembly under an explicit token budget
- **Dream pipeline** — nightly consolidation 02:00-04:00, extracts skills from successful runs

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Surfaces                                                           │
│  CLI · TUI · Desktop (Tauri) · iOS · Watch · CarPlay · 25 channels  │
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
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │ 20+ layer   │ │ 21 intel    │ │ 10 orch    │ │ 19-event hooks │  │
│  │ middleware  │ │ modules     │ │ patterns   │ │ + DoomLoop     │  │
│  └─────────────┘ └─────────────┘ └────────────┘ └────────────────┘  │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │ 8-layer     │ │ 4-layer     │ │ 19 prov    │ │ Skill registry │  │
│  │ memory      │ │ Computer Use│ │ + fallback │ │ + MCP registry │  │
│  └─────────────┘ └─────────────┘ └────────────┘ └────────────────┘  │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
         Inference call (the only thing the LLM does)
```

See [`docs/SURFACE_PARITY_REPORT.md`](docs/SURFACE_PARITY_REPORT.md) for the full surface-by-surface capability matrix and [`docs/CAPABILITY_ADAPTATION_MATRIX.md`](docs/CAPABILITY_ADAPTATION_MATRIX.md) for how the harness equalizes capabilities across model tiers.

---

## By the Numbers

|   |   |
|---|---|
| **Source** | 481 TypeScript files · ~175 000 LOC |
| **Tests** | 367 test files · **5 860 passing** · 7 skipped · 0 failing · 46 s |
| **Middleware** | 20+ layers (2 always-on, 16 conditional) |
| **Providers** | 19 (with capability augmentation) |
| **Channels** | 25+ messaging adapters |
| **Surfaces** | 7 (CLI · TUI · Desktop · iOS · Watch · CarPlay · Channels) |
| **Memory layers** | 8 (FTS5 · vector · graph-RAG · episodic · semantic · temporal · working · archival) |
| **Orchestration patterns** | 10 genuine multi-step patterns |
| **Skills** | 86 progressive-disclosure markdown files |
| **Hook events** | 19 with 17+ built-in guards |

---

## Project Structure

```
src/
├── core/             Composition root (WotannRuntime) · agent bridge · types
├── providers/        19 adapters · router · rate limiter · format translator
├── middleware/       20+ layers (2 always-on, 16 conditional) + TTSR streaming
├── intelligence/     21 modules that meaningfully affect model behavior
├── orchestration/    10 multi-step patterns (coordinator · waves · PWR · Ralph · council · ...)
├── memory/           SQLite + FTS5 · 8 layers · vector · graph-RAG · episodic
├── context/          5 compaction strategies · Ollama KV cache compression
├── prompt/           Engine · 18 prompt modules · instruction provenance
├── hooks/            19 events · 17+ guards · DoomLoop · benchmark engineering
├── computer-use/     4-layer perception + action stack (text-mediated for any model)
├── channels/         25+ adapters + DM pairing + node registry
├── voice/            Push-to-talk · STT/TTS · WhisperKit · Edge TTS · faster-whisper
├── learning/         autoDream · instincts · skill-forge · pattern-crystallizer
├── identity/         Persona system · soul/identity loading · Norse mythology
├── security/         Anti-distillation · PII redaction · sandbox · guardrails · SSRF guard
├── telemetry/        Cost tracker · session analytics · audit trail
├── marketplace/      MCP registry · skill marketplace · ACP agent discovery
├── ui/               Ink TUI · 20 themes · voice controller · diff engine · OSC 133 blocks
├── desktop/          Tauri config · companion server · app state
├── mobile/           iOS handlers · pairing · haptics · live activities
└── daemon/           KAIROS engine · IPC · RPC · cron · heartbeat

desktop-app/          Tauri 2 desktop (React + Rust) · ⌘K command palette
ios/                  SwiftUI app (5 targets — main · Intents · Widgets · Watch · Share)
docs/                 Architecture references (auth · surface parity · capability adaptation · build)
design-brief/         Design system: tokens · brand identity · surface guidelines · reference shots
skills/               86 markdown skills (progressive disclosure)
```

---

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
| `wotann loop "prompt" --interval 5m` | Self-pacing recurring prompt |
| `wotann channels` | Manage messaging channel adapters |
| `wotann cost` | Predict or review session cost |

Run `wotann --help` for the full 78+ command surface.

---

## Platforms

- **macOS 13+** — full support including desktop DMG (ad-hoc signed)
- **Linux** — CLI + daemon (TUI optional)
- **Windows 11** — CLI + daemon (Tauri build supported)
- **iOS 18+** — companion app (TestFlight pending — clone + build in the meantime)
- **watchOS 11+** — Watch companion (paired via iPhone)

---

## Requirements

- **Node ≥ 20** (Node 22 recommended)
- **macOS 13+ / Linux / Windows 11**
- **Optional**: Ollama (local models), Python 3.11+ (for camoufox stealth browser backend), Xcode 16 (iOS builds)

---

## Privacy

Runs entirely locally by default. Telemetry is opt-out and triple-gated — industry-standard `DO_NOT_TRACK=1` is honored, plus WOTANN-specific `WOTANN_NO_TELEMETRY=1`, plus a sentinel file at `~/.wotann/no-telemetry`.

```bash
export WOTANN_NO_TELEMETRY=1
```

No data leaves your machine unless you explicitly send it to a provider you chose. No `phone-home`. No analytics pings. No crash reporting without consent.

---

## Configuration

Per-user config lives in `~/.wotann/`:

```
~/.wotann/
├── wotann.yaml              # Providers · channels · MCP servers
├── session-token.json       # 256-bit daemon RPC auth token (chmod 0600)
├── memory.db                # SQLite + FTS5 — gitignored
├── sessions/                # Per-session JSON snapshots
├── dreams/                  # Dream-pipeline outputs
├── episodes/                # Episodic memory
├── logs/                    # Daily JSONL daemon logs
└── identity/                # SOUL.md · IDENTITY.md · AGENTS.md · etc.
```

---

## Authentication

The daemon enforces session-token auth on every RPC call. Local clients (CLI, desktop, iOS) read `~/.wotann/session-token.json` automatically. For development, set `WOTANN_AUTH_BYPASS=1` — see [`docs/AUTH.md`](docs/AUTH.md).

---

## Documentation

| Doc | What's inside |
|---|---|
| [`docs/AUTH.md`](docs/AUTH.md) | Daemon RPC authentication convention |
| [`docs/SURFACE_PARITY_REPORT.md`](docs/SURFACE_PARITY_REPORT.md) | Per-surface capability matrix |
| [`docs/CAPABILITY_ADAPTATION_MATRIX.md`](docs/CAPABILITY_ADAPTATION_MATRIX.md) | How tool-calling / vision / thinking are synthesized on weaker models |
| [`docs/UI_DESIGN_SPEC_2026-04-16.md`](docs/UI_DESIGN_SPEC_2026-04-16.md) | Obsidian Precision theme — tokens, motion, component contracts |
| [`docs/SEA_BUILD_ENVIRONMENTAL_GATE.md`](docs/SEA_BUILD_ENVIRONMENTAL_GATE.md) | Single-executable (SEA) build environment requirements |
| [`docs/SELF_HOSTED_RUNNER_SETUP.md`](docs/SELF_HOSTED_RUNNER_SETUP.md) | Self-hosted GitHub Actions runner for SEA + iOS jobs |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |

---

## Contributing

Pull requests welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, coding conventions (TypeScript strict, no `any`, immutable data, 200–400 LOC files), and how the `planner → test-engineer → code-reviewer → verifier` agent dispatch works.

The short version: fork, branch, TDD, open a PR. The CI matrix runs typecheck, lint, build, and 2-shard test on every push.

---

## Security

Found a vulnerability? See [`SECURITY.md`](SECURITY.md) for responsible disclosure. The daemon's RPC surface, the sandbox, and the Tauri configuration are the primary review targets.

---

## Acknowledgements

WOTANN's harness ideas borrow generously from the open-source agent ecosystem. Notable inspirations: Hermes Agent (NousResearch), DeepAgents (LangChain), Open-SWE (LangChain), DeerFlow (ByteDance), oh-my-openagent, opcode, eigent, Aider, Cursor, Claude Code, Codex CLI, charmbracelet/crush, oraios/serena, can1357/oh-my-pi, Zed, Goose, and the Agent Communication Protocol (ACP) reference implementations.

---

## License

[MIT](LICENSE) © 2026 Gabriel Vuksani

<br/>

<div align="center">

> *"Think like Odin: see the whole board, pay the price for true knowledge,*
> *speak directly, build what will last, and let Huginn and Muninn carry the memory forward."*
>
> — `.wotann/SOUL.md`

<br/>

<sub>Built with TypeScript · SwiftUI · Rust · Ink · Tauri 2 · Vite</sub>

</div>
