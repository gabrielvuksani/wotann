# 01 — Product overview

## What WOTANN is (one paragraph)

WOTANN is a unified AI agent harness that amplifies any frontier model (Claude, GPT-5, Gemini, Grok, Opus 4.x, Sonnet 4.x, locally-run Gemma, Ollama, and 12+ other providers) with a 16-layer middleware pipeline, a persistent daemon (KAIROS), an 8-layer memory system, a 4-layer Computer Use stack, kernel-level sandboxing, and a dispatch plane that routes tasks across Telegram, Discord, Slack, iMessage, Email, GitHub, and 19 other channels. Source: `NEXUS_V4_SPEC.md` §2 and §3.

It ships three first-class surfaces — a terminal UI (Ink), a Tauri desktop app, and a native iOS app (plus Watch, CarPlay, Widgets, Intents, LiveActivity, ShareExtension) — all of which are RPC clients to the same local KAIROS daemon. Source: `wotann/docs/SURFACE_PARITY_REPORT.md` §1.

## Positioning — what it is, what it is not

**It is**:

- A **workshop** — a place where code is forged, verified, and shipped with proof bundles.
- A **council chamber** — where multiple models deliberate, disagree, and converge on a decision.
- A **proving ground** — where every plan is tested, every diff is reviewed, every claim is auditable.
- **Free-tier first-class** — Ollama + Gemma + free endpoints are never second-class citizens; paid models are an upgrade, never a requirement.

**It is not**:

- "A faster Cursor." The competitor field converges on dark-chrome sidebars, purple accents, and translucent panels. WOTANN refuses those (source: `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` §1).
- "An AI IDE." WOTANN embeds a Monaco editor but the primary surface is the conversation and the proof bundle, not the file tree.
- "A wrapper." WOTANN has 481 source files, 19 provider adapters, 25 channel adapters, 86 skills, and a 5,366-line daemon RPC layer. Source: `wotann/docs/WOTANN_INVENTORY.md`.

## Ideal customer profile (ICP)

Five archetypes, in declining size:

1. **Senior engineer at a startup** — writes code daily, uses Claude Code / Cursor / GitHub Copilot, has an Anthropic and/or OpenAI subscription, wants a single harness that doesn't lock them to one vendor.
2. **Security researcher / red-teamer** — needs the Exploit mode for CVSS-scored findings and MITRE ATT&CK linkage.
3. **Operations / DevOps engineer** — uses the Workshop tab to dispatch scheduled / recurring tasks; integrates with Slack and GitHub.
4. **Academic / data scientist** — uses Council mode to cross-validate model outputs; uses the Arena view to benchmark local vs frontier models.
5. **Accessibility-first engineer** — needs keyboard-only navigation (Ink TUI), macOS VoiceOver parity (desktop), iOS VoiceOver + Dynamic Type (iOS).

## Competitive context (what WOTANN beats and what it lags)

The fastest-growing competitors in April 2026:

- **Cursor 3 Glass** (launched Apr 2 2026) — agent-first IDE; Canvases render React; Design Mode; cloud↔local handoff.
- **Claude Code** — SWE-bench 80.8%, TerminalBench 39th. Locked system prompt.
- **Codex CLI** — kernel-level sandbox; no memory; no multi-provider.
- **Claude Design** (Anthropic Labs, launched Apr 17 2026) — prompt-to-prototype, handoff bundles.
- **Perplexity Computer** (Feb 25 2026) — 19-model orchestration, 400+ app connectors.
- **Gemini for Mac** — Liquid Glass HUD, ⌥Space hotkey.
- **Glass** (glassapp.dev) — Zed fork with Liquid Glass.
- **Conductor.build** — git-worktree-per-agent; comment-on-diff.
- **Warp** — OSC 133 block terminal; Agent Mode approval policies.
- **Linear / Superhuman / Raycast / Things 3** — the Apple Design Award polish tier.

**Where WOTANN beats the field today**:
- Keyboard density (best in class — 16 desktop shortcuts + 50+ TUI slash commands),
- Free-tier provider support (Ollama native, Gemma 4 bundled — `NEXUS_V4_SPEC.md` §5),
- Multi-surface parity (TUI + Desktop + iOS + Watch + CarPlay all reachable from one daemon),
- Council / Arena — parallel multi-model deliberation surfaced as first-class UI,
- iOS accessibility primitives — `ios/WOTANN/DesignSystem/A11y.swift` is exemplary (audit verdict: "every iOS app should copy this file" — `wotann/docs/UI_UX_AUDIT.md` §7.2).

**Where WOTANN lags today** (from the scorecard):
- Motion design (5/10 on desktop, 4/10 on TUI, 7/10 on iOS),
- Liquid Glass fidelity (6/10 desktop, 8/10 iOS via `.ultraThinMaterial` — but only 4 iOS call-sites),
- Design-token unification (3/10 — three parallel token schemes, 8.4% adoption of the canonical `wotann-tokens.css`),
- Block-based chat / terminal (primitive `Block.tsx` shipped but zero consumption — 0/10),
- First-run tour (none on any platform — CP-3 finding from session-8 audit).

## Surface summary

| Surface | Files | Status | Scorecard |
|---|---:|---|---|
| Ink TUI (`wotann/src/ui/`) | 15 components + `App.tsx` (2,979 lines) | Build green; `node dist/index.js --help` returns 43 top-level commands | 6.8/10 |
| Desktop (`wotann/desktop-app/`) | 134 TSX + 13 Rust + 104 Tauri commands + 24 lazy views | Build green (`npm run build` 21.5s); 19 of 24 views visually unverified | 6.2/10 |
| iOS (`wotann/ios/WOTANN/`) | 128 Swift files + Watch + Widgets + Intents + LiveActivity + ShareExt | `xcodebuild` build success; 33 of 34 views visually unverified | 7.0/10 |

Composite WOTANN score: **6.5 / 10**. Apple Design Award floor: **~8.5**. Gap to close in 4-6 focused polish weeks — this is what Claude Design will help us cross.

## The deliverable we want from Claude Design

1. **Three candidate UI redesigns per surface** — so we can A/B each instead of defaulting to the first idea.
2. A **unified design-system JSON** (W3C Design Tokens format) that emits consistent CSS for desktop, Swift constants for iOS, and Ink theme constants for the TUI.
3. A **component library JSON** (`components.json`) matching the schema in `21-handoff-bundle-schema.md` — so `wotann import-design <bundle.zip>` can ingest it deterministically.
4. **Annotated wireframes** for every view listed in `07-surface-tui.md`, `08-surface-gui-desktop.md`, `09-surface-ios.md`.
5. **Motion + haptic specs** per `14-motion-and-haptics.md` — exact durations, eases, physics.
6. **Accessibility traces** — WCAG 2.2 AA+ per `13-accessibility-targets.md`, VoiceOver reading order, Dynamic Type scaling.
7. **Copy + voice** edits per `17-copy-and-voice.md` — honest errors, no gratuitous Norse, no marketing fluff.
8. **Exports** to Canva, PDF, PPTX, HTML for review — Claude Design's native export.

---

*End of 01-product-overview.*
