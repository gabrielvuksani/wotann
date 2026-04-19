# 24 — The prompt Gabriel will paste into Claude Design

The text below is what Gabriel copies into Claude Design's chat after uploading the `design-brief/` folder.

---

## The prompt

```
I'm Gabriel Vuksani (gabrielvuks@gmail.com), building WOTANN — a unified AI
agent harness. I've uploaded a briefing package (design-brief/). READ EVERY
FILE before generating. Do not skim. Do not guess. This brief is the single
most important deliverable for the next 60 days of WOTANN product
development.

## What WOTANN is (3 sentences)

WOTANN is a unified AI agent harness that amplifies any frontier model
(Claude, GPT-5, Gemini, Grok, Gemma, Ollama, and 13+ other providers) with
a 16-layer middleware pipeline, a persistent daemon (KAIROS), an 8-layer
memory system, a 4-layer Computer Use stack, kernel-level sandboxing, and
25+ channel adapters (Slack, Telegram, iMessage, GitHub, etc.). It ships
three first-class surfaces that are peers, not subordinates: a terminal UI
(Ink), a Tauri desktop app (React + Rust), and a native iOS app (plus Watch,
CarPlay, Widgets, Intents, LiveActivity, ShareExtension). All three surfaces
are RPC clients to the same local KAIROS daemon — one engine, many doors.

## What I want from you

Three variants per surface (TUI + desktop + iOS) of a REDESIGN that
moves WOTANN from its current 6.5/10 composite score (per
03-current-design-audit.md) to 9.0+ on the 8-bar Apple Design Award
rubric in 23-success-criteria.md. Do not produce one variant; produce
three per surface so I can A/B.

## The scoring rubric (grade yourself against these 8 bars × 3 surfaces)

1. Typography — Inter Variable + JetBrains Mono + feature-settings correct
2. Spacing rhythm — 4/8/12/16/24 pt grid visible, no hand-tuned values
3. Colour palette integrity — all 5 themes work; AAA contrast primary-ink
4. Motion craft — 4 named eases + 5 durations + prefers-reduced-motion
5. State completeness — all 10 states per view (default, empty, loading,
   streaming, error, success, disconnected, offline, low-battery, focus)
6. Glass / depth / material fidelity — per-theme glass tokens, noise grain,
   specular sheen, layered translucency with 2+ blur radii
7. Keyboard density (TUI/desktop) OR Haptic craft (iOS)
8. Brand identity (Norse thread) — W logo 4-stop gradient, runic accents in
   3-5 controlled places per view

Each variant must self-score on this rubric in the handoff manifest.

## The brand

WOTANN — the Germanic All-Father. God of wisdom, war, poetry, magic, and
the runes. Tone: direct, craftsmanlike, quiet. Never cosplay. Never kitsch.
Dieter Rams × Lewis Chessmen × Bloomberg Terminal — NOT a fantasy RPG UI
kit. See 02-brand-identity.md for the 5 canonical themes (Mimir's Well
default dark, Yggdrasil light, Runestone marketing hero, Bifrost gradient
onboarding-only, Valkyrie Exploit-only).

## The constraints (22 anti-patterns in 22-constraints-and-antipatterns.md)

Most important:
1. NO purple anywhere except the W logo gradient.
2. NO emoji in system UI — runes + alchemical sigils only.
3. NO chat-bubble rounded-rectangle messages — flush-left typographic Blocks.
4. NO exclamation marks in any button / banner / heading.
5. NO "sorry" / "oops" / "something" / "we think" / "maybe" in any string.
6. NO animation over 600ms except 3 opt-in exceptions (Sealed Scroll unroll
   420ms, Raven's Flight 800ms, Ember session-end 880ms).
7. Bifrost theme is ONLY for onboarding + celebrations — never a work
   surface.
8. Valkyrie theme is ONLY for Exploit tab — auto-activates.
9. prefers-reduced-motion: reduce must zero all transforms.

## The handoff bundle (the EXACT output format)

Package your output as a ZIP matching 21-handoff-bundle-schema.md exactly:

  bundle.zip
  ├── manifest.json              (with competitor_inspirations array)
  ├── design-system.json         (W3C Design Tokens v6.3 format)
  ├── tokens.json                (optional alias)
  ├── components.json            (array of ~50 components)
  ├── figma.json                 (if Figma export available)
  ├── code-scaffold/             (React/Vue/HTML starters)
  └── assets/                    (logos, runes, fonts)

The WOTANN CLI ships a receiver at `wotann import-design <bundle.zip>`
that validates the ZIP against that schema. Malformed bundles fail
loudly (not silently). Source: wotann/src/design/handoff-receiver.ts.

Required manifest fields: name, version, bundle_version.
Supported bundle_version values: "1", "1.0", "1.0.0".

## Competitor inspirations (for each variant, list explicitly)

Every variant must cite which competitor patterns it borrows from,
from 20-competitor-screenshots.md:

Tier A (Apple Design Award polish to match/beat):
  - Glass (glassapp.dev) — layered translucency, specular sheen
  - Superhuman — typography, keyboard motion as reward
  - Linear — tab underline slide, inline Cmd+K palette
  - Raycast — palette density + MRU + right-edge shortcut hints
  - Things 3 — 4/8 pt grid discipline + celebration motion

Tier B (agent harness peers to match/beat):
  - Cursor 3 Glass (Apr 2 2026) — Canvases
  - Gemini for Mac — Liquid Glass HUD + ⌥Space
  - Claude Code TUI — slash command pattern + /focus
  - Warp — Block UI + OSC 133 + .warp.md notebooks
  - Zed — ACP host + multibuffer
  - Conductor.build — comment-on-diff + @terminal mention
  - Perplexity Computer (Feb 25 2026) — 19-model orchestration

Do NOT clone any competitor pixel-for-pixel. For each borrowed pattern,
document what WOTANN does DIFFERENTLY (our innovation).

## The 3 surfaces

### TUI (Ink, terminal)
15 components in wotann/src/ui/components/. Primary gap: no command
palette (⌘K). Block-based chat rendering not shipped. Per-turn cost
ticker missing. See 07-surface-tui.md for the full wireframe.

### Desktop (Tauri + React)
134 TSX + 13 Rust files. 24 lazy-loaded views. 104 Tauri commands.
4 primary tabs: Chat / Editor / Workshop / Exploit. 5 themes shipped;
adoption at 8.4% of the canonical token system. See 08-surface-gui-desktop.md.

### iOS (SwiftUI)
128 Swift files + 5 build targets (Main / Watch / Widgets / Intents /
ShareExt / LiveActivity). 34 view directories. 4-tab MainShell
(Home / Chat / Work / You) + FloatingAsk + AskComposer. See 09-surface-ios.md.

## The 33 capabilities to design for

See 06-capability-matrix.md for the 223-feature × 3-surface priority
table. Not every feature needs a primary view — some are palette-only
(P1) or settings-only (P2). For each P0 capability, design a primary
view. For each P1, design the reachability path (palette entry + deep
link). For each P2, design the Settings pane.

## Deliver in this order

Generate in this phased approach:

Phase 1 — Tokens:
Produce the design-system.json first. Get theme coverage right before
designing any components. 5 themes × ~25 tokens each = 125+ color
tokens + typography + motion + spacing + radii + shadows.

Phase 2 — Foundation components:
Block, Runering, SealedScroll, CapabilityChips, ValknutSpinner,
RuneForge, CommandPalette. These are the primitives every view uses.

Phase 3 — 3 variants per surface:
For each of TUI / desktop / iOS, produce 3 distinct variants. Each
variant is internally consistent; variants differ on emphasis (e.g.,
variant 1 "Linear-forward" vs variant 2 "Raycast-forward" vs variant 3
"Glass-maximal").

Phase 4 — States inventory:
For every view × every state in 11-states-inventory.md, produce a
wireframe or mockup. Do not skip states.

Phase 5 — Motion + haptic spec:
From 14-motion-and-haptics.md — produce the full motion catalog with
exact parameters and reduced-motion fallbacks.

Phase 6 — Exports:
Canva deck per surface + PDF + PPTX + HTML interactive preview.
Motion videos for the top 5 interactions per surface.

Phase 7 — Self-audit:
Grade your output against 23-success-criteria.md. Honest scores only.
Flag any constraint violations from 22-constraints-and-antipatterns.md
in the manifest's scope_extensions array with rationale.

## Success definition

A variant ships if:
- Composite ≥ 8.0 per surface,
- Every bar ≥ 7.0,
- Zero constraint violations,
- `wotann import-design bundle.zip --require-components` succeeds.

Apple Design Award target: composite ≥ 9.0.

## What NOT to do

- Do NOT produce a single variant per surface. I need 3 per surface.
- Do NOT fabricate data or screenshots — use the 42 current-state
  reference screenshots in 19-reference-screenshots/.
- Do NOT propose features outside 06-capability-matrix.md. If you
  have an idea that's out of scope, put it in
  manifest.scope_extensions with rationale.
- Do NOT copy any competitor pixel-for-pixel. Borrow patterns,
  innovate on them.
- Do NOT output bundles that fail wotann import-design. Validate
  your manifest.json, design-system.json, and components.json.
- Do NOT use purple anywhere except the W logo gradient.
- Do NOT use emoji anywhere except the 5 allowed alchemical sigils
  (🜂 fire = vision, 🜃 earth = thinking, 🜄 air = tools, 🜁 water =
  memory) — and even those are opt-in per view.

## References inside the brief

Every claim I've made is cited. Primary references you should load
first (they're in design-brief/):
- README.md (this package's TOC)
- 01-product-overview.md
- 02-brand-identity.md
- 03-current-design-audit.md (the HONEST 6.0/10 scorecard)
- 04-design-principles.md (the 15 non-negotiables)
- 06-capability-matrix.md (223 features × 3 surfaces)
- 07-surface-tui.md
- 08-surface-gui-desktop.md
- 09-surface-ios.md
- 11-states-inventory.md
- 14-motion-and-haptics.md
- 15-design-tokens-current.json (W3C tokens — direct ingest)
- 17-copy-and-voice.md (every forbidden word)
- 21-handoff-bundle-schema.md (THE output contract)
- 22-constraints-and-antipatterns.md (the 22 don't-dos)
- 23-success-criteria.md (the 8-bar rubric)

## Deliver

Produce the handoff bundle. Time to beat: 9 days to my benchmark
review (target: 9.0+ composite per surface). Clarify anything in the
brief that's ambiguous BEFORE generating — do not guess.
```

---

## Prompt usage notes for Gabriel

1. **Upload the folder first** — Claude Design supports folder input. The `design-brief/` folder must be uploaded intact (all 25 files + 42 screenshots + `assets/`).

2. **Do NOT upload a zip** — Claude Design parses folders natively.

3. **Paste the prompt above** — verbatim. Do not paraphrase.

4. **Expect ~30 minutes of generation** — Claude Design runs Opus 4.7 with long compute. Budget the session for ~45 minutes of interaction.

5. **If Claude Design asks clarifying questions** — answer them citing the brief ("see 04-design-principles.md Principle 5"). Do not freelance answers; the brief is the source of truth.

6. **If Claude Design proposes an out-of-scope feature** — tell it to put the proposal in `manifest.scope_extensions` with rationale. Do not accept scope creep into the main deliverable.

7. **Validate the output** — after Claude Design produces the bundle, run:
   ```bash
   wotann import-design ~/Downloads/wotann-redesign-2026-04-xx.zip \
     --require-components \
     --output-dir=/tmp/wotann-design-test
   ```
   Confirm it exits zero with the expected summary.

8. **Grade the variants** — use the template in `23-success-criteria.md` §"Per-variant scoring template" to score each variant. Take notes.

9. **Ask for revisions** — if any variant is REVISE, paste the bar-by-bar score table back into Claude Design and ask for a second pass on only that variant.

10. **Archive the winning variant** — once SHIP is declared, copy the bundle into `wotann/design-bundles/<date>/<variant>/` and open a PR with the imported tokens + components.

## Prompt word count

The prompt above is ~950 words. Within the 500-1000 range specified by the briefing.

---

*End of 24-claude-design-prompt.*
