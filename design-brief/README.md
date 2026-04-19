# WOTANN — Claude Design Briefing Package

**Audience**: Anthropic Labs' Claude Design (https://claude.ai/design), Opus 4.7 powered.
**Purpose**: Redesign WOTANN across all three surfaces — TUI (Ink), GUI (Tauri desktop), iOS (SwiftUI) — to Apple Design Award quality.
**Owner**: Gabriel Vuksani (gabrielvuks@gmail.com).
**Date**: 2026-04-19.
**Bundle version**: 1.0.

---

## What WOTANN Is (read this first)

WOTANN is a unified AI agent harness. Every feature works across:

- A **terminal (Ink) UI** launched via `wotann start`,
- A **Tauri desktop app** that fronts the same engine,
- A **native iOS app** (iPhone + Watch + CarPlay + Widgets + Intents + LiveActivity + Share Extension) that pairs to the desktop via ECDH over WebSocket or Supabase Realtime relay.

The back-end is a single always-on daemon called KAIROS. All three surfaces are RPC clients to that daemon. They already build green on main (TypeScript `tsc --noEmit` exit 0, desktop `npm run build` exit 0 in 21.5s, Rust `cargo check` exit 0, `xcodebuild` `** BUILD SUCCEEDED **` per `wotann/docs/SURFACE_PARITY_REPORT.md`).

The current UI composite scorecard is **6.0 / 10** against the Apple Design Award bar (source: `wotann/docs/UI_REALITY.md`). Liquid Glass is at **3 / 10**, Motion is at **5 / 10** (source: `wotann/docs/UI_UX_AUDIT.md` §1.1). The ambition is to get every surface to **9.0+** on the same 16-bar scorecard without compromising WOTANN's three non-negotiables: keyboard-density, free-tier first-class, and honest no-silent-success behaviour.

---

## How to use this package with Claude Design

1. **Upload the entire `design-brief/` folder** as an input corpus. Claude Design accepts folders of markdown + JSON + images.
2. **Paste the prompt from `24-claude-design-prompt.md`** into Claude Design's chat. That prompt instructs Claude Design to read every file in this folder before generating.
3. **Request three variants per surface** (not one) — see `24-claude-design-prompt.md` for the exact phrasing. A/B comparison beats a single opinion.
4. **Ask for a handoff bundle** conforming exactly to `21-handoff-bundle-schema.md`. The WOTANN CLI ships a receiver at `wotann import-design <bundle.zip>` that validates the ZIP against that schema; if the generated bundle does not match, import fails loudly rather than silently producing broken imports. The receiver code lives at `wotann/src/design/handoff-receiver.ts`.
5. **Grade the output** against the 8-bar × 3-surface matrix in `23-success-criteria.md`. The minimum acceptable score is **8.0** per surface per bar.

---

## Package contents

| File | Purpose |
|---|---|
| `01-product-overview.md` | What WOTANN is, positioning, ICP, competitive context |
| `02-brand-identity.md` | Norse lore, tone, color, typography, brand mark |
| `03-current-design-audit.md` | Honest current-state assessment (6.0/10 scorecard) |
| `04-design-principles.md` | The 15 principles — Apple Design Award bar |
| `05-competitor-references.md` | What to match, beat, learn from |
| `06-capability-matrix.md` | 223 features × 3 surfaces × priority ranking |
| `07-surface-tui.md` | Ink TUI — commands, components, states |
| `08-surface-gui-desktop.md` | Tauri desktop — every view, every state |
| `09-surface-ios.md` | iOS — phone, Watch, CarPlay, extensions |
| `10-interactions-and-flows.md` | User journeys — onboard to chat to editor to workshop to exploit |
| `11-states-inventory.md` | Empty / loading / error / success / offline / focus |
| `12-channels-multi-surface.md` | 25+ channel adapters, how UI surfaces them |
| `13-accessibility-targets.md` | WCAG 2.2 AA+ floor, per-surface |
| `14-motion-and-haptics.md` | Entrance, exit, feedback — exact timings |
| `15-design-tokens-current.json` | Current W3C Design Tokens (direct Claude Design input) |
| `16-design-system-ambition.md` | What the new token system should enable |
| `17-copy-and-voice.md` | Microcopy rules — honest errors, no silent success |
| `18-data-visualization.md` | Cost meter, context meter, provider status, memory palace |
| `19-reference-screenshots/` | Current-state PNGs (42 images, ~3 MB) |
| `20-competitor-screenshots.md` | URLs + study notes (Cursor 3, Gemini Liquid Glass, Glass, Linear, Raycast, Superhuman, Things 3, Conductor, Warp, Zed) |
| `21-handoff-bundle-schema.md` | EXACT schema Claude Design's output must match |
| `22-constraints-and-antipatterns.md` | What NOT to do |
| `23-success-criteria.md` | Per-surface 1-10 grades on 8 bars |
| `24-claude-design-prompt.md` | The actual prompt Gabriel will paste |
| `assets/` | Current logo swatches + `wotann-tokens-current.css` |

Total: ~25 spec files + 42 screenshots.

---

## Source of truth — every claim here is traceable

Every claim in these documents cites an absolute path inside the WOTANN repo (`wotann/src/...`, `wotann/desktop-app/src/...`, `wotann/ios/WOTANN/...`, or `wotann/docs/...`). If a claim has no citation, it is an explicit creative ambition and is flagged as such.

Primary citations:

- **Product spec**: `/Users/gabrielvuksani/Desktop/agent-harness/NEXUS_V4_SPEC.md` (7,928 lines, 223 features, 26 appendices A-Z)
- **Project conventions**: `wotann/CLAUDE.md`
- **UX audits**: `wotann/docs/UX_AUDIT_2026-04-17.md`, `wotann/docs/SESSION_8_UX_AUDIT.md`, `wotann/docs/UI_UX_AUDIT.md`
- **Current-state truth**: `wotann/docs/UI_REALITY.md` (Agent E honest archaeology)
- **Design spec**: `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md`
- **Surface parity**: `wotann/docs/SURFACE_PARITY_REPORT.md`
- **Platform deep read**: `wotann/docs/UI_PLATFORMS_DEEP_READ_2026-04-18.md`
- **Handoff receiver**: `wotann/src/design/handoff-receiver.ts`

---

## Grading rubric (summary)

Per surface, per bar, 1-10:

1. Typography
2. Spacing rhythm
3. Colour palette integrity
4. Motion craft
5. State completeness (empty / loading / error / success)
6. Glass / depth / material fidelity
7. Keyboard density (TUI/desktop) OR Haptic craft (iOS)
8. Brand identity presence (the Norse thread)

Composite floor: **8.0**. Apple Design Award target: **9.0**. See `23-success-criteria.md` for the full rubric and scoring narrative.

---

*End of README.*
