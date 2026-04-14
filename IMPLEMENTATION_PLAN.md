# WOTANN Enhancement Implementation Plan
## Based on Competitive Research (April 2, 2026)

### Research Summary
- LangChain: 52.8% → 66.5% on Terminal Bench 2.0 (harness only, same model)
- SWE-bench: 22-point swing between basic and optimized scaffolds (same model)
- WarpGrep: +4% SWE-bench via agentic code search MCP
- Cursor: Dynamic context discovery, agent swarm (4.5x latency reduction)
- OpenClaw: 50+ channels via unified gateway, soul/identity, companion apps
- Context: Claude 1M, Gemini 1M, GPT-5.4 272K, Ollama 256K (KV doubles)

### Implementation Order (by impact)

1. **Context Window Intelligence** — provider-aware limits, auto-KV config
2. **Benchmark Engineering Middleware** — TerminalBench boosting techniques
3. **Autonomous Mode Enhancement** — wire into mode cycling, screen verify
4. **Channel Gateway** — unified gateway with WebChat
5. **15 Essential Skill Files** — SKILL.md content
6. **Voice Mode Enhancement** — faster-whisper local STT
7. **MCP Registry Enhancement** — import from Claude Code
8. **Comprehensive Test Upgrades** — all new modules tested
