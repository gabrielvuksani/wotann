# WOTANN

> The All-Father of AI agent harnesses. One install. Every model. Every channel. Full autonomy.

WOTANN is a unified AI agent harness that treats the LLM as just the inference call — everything else (memory, tools, sandbox, orchestration, learning) is provided by the harness. A local Gemma gets the same intelligence scaffolding as Claude Opus.

## Quick Start

```bash
npm install -g wotann
wotann init
wotann engine        # start the daemon
wotann               # launch TUI
```

## Why WOTANN

**Most agents lock you in. WOTANN doesn't.** Switch from Claude to Gemini to local Gemma mid-session without losing context, tools, or capabilities. Every provider gets the same 42 intelligence modules, 8-layer memory, and 29 orchestration patterns.

**Free-tier first-class.** Run entirely on Ollama + Groq + Gemini free tier. The harness makes a 3B local model as capable as a frontier API.

**Multi-surface.** Same agent via CLI, TUI, desktop app (Tauri + Monaco), iOS (with Watch, CarPlay, Widgets, Siri), or any of 18 messaging channels.

**Autonomous with proof.** `wotann autopilot "fix the failing tests"` runs until verification passes. Every completion ships with a proof bundle.

## Requirements

- Node.js ≥ 20
- macOS 13+ (desktop app), Linux, or Windows 11

## Commands

| Command | Purpose |
|---------|---------|
| `wotann init` | Initialize workspace |
| `wotann engine` | Start the KAIROS daemon |
| `wotann doctor` | Health diagnostics |
| `wotann compare` | Arena — compare models blind |
| `wotann autopilot <task>` | Autonomous execution |
| `wotann link` | Pair a phone |
| `wotann debug share` | Generate debug report |
| `wotann profile <list\|switch>` | Named harness profiles |

## Privacy

Runs entirely locally by default. To opt out of all telemetry: `export WOTANN_NO_TELEMETRY=1`.

## License

MIT © 2026 Gabriel Vuksani

See [`docs/DEEP_AUDIT_2026-04-13.md`](docs/DEEP_AUDIT_2026-04-13.md) for the full architecture audit and 76-item roadmap.
