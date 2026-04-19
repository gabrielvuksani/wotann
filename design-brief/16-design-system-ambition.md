# 16 — Design system ambition (what the NEW token system should enable)

Source: `15-design-tokens-current.json` + `wotann/docs/UI_UX_AUDIT.md` §5.5.

This file describes what the target token system must deliver that the current one does not.

## The three gaps to close

### Gap 1 — Single source of truth

**Today**: three parallel token schemes (`src/ui/themes.ts`, `desktop-app/src/styles/globals.css`, `wotann-tokens.css`, `ios/WOTANN/DesignSystem/Theme.swift`). WOTANN tokens are adopted in 8.4% of desktop files.

**Target**: `packages/design-tokens/tokens.yaml` emits:
- `wotann-tokens.css` (desktop) via `scripts/build-tokens.mjs`,
- `WOTANNTokens.swift` (iOS) constants,
- `ink-themes.ts` (TUI) constants.

One YAML → three binding files. Every surface consumes the same source.

### Gap 2 — Per-theme glass tokens

**Today**: `.bg-glass` class in `globals.css` uses hardcoded `rgba(12,17,24,0.6)` backdrop — theme-agnostic. When user switches to Yggdrasil (light), the glass still renders as dark.

**Target**: per-theme glass tokens in the new system:

```yaml
glass:
  mimir:
    bg: rgba(12, 17, 24, 0.6)
    stroke: rgba(138, 176, 224, 0.12)
    tint: cool
    blur: 20px
    saturate: 1.4
  yggdrasil:
    bg: rgba(243, 239, 230, 0.7)
    stroke: rgba(26, 22, 18, 0.10)
    tint: warm
    blur: 20px
    saturate: 1.2
  runestone:
    bg: rgba(3, 5, 8, 0.75)
    stroke: rgba(201, 161, 74, 0.18)
    tint: gold
    blur: 24px
    saturate: 1.5
  bifrost:
    bg: rgba(27, 18, 48, 0.72)
    stroke: rgba(244, 230, 160, 0.20)
    tint: rainbow
    blur: 24px
    saturate: 1.2
  valkyrie:
    bg: rgba(20, 16, 16, 0.72)
    stroke: rgba(209, 58, 42, 0.16)
    tint: blood
    blur: 20px
    saturate: 1.3
```

### Gap 3 — Motion + haptic as tokens

**Today**: motion durations + eases are in `wotann-tokens.css:14-28` as CSS custom properties. iOS has its own `WTheme.Animation`. Haptics are in a Swift enum `HapticService`. Nothing is cross-referenceable.

**Target**: motion curves + durations tokenized once in YAML and consumed by CSS, SwiftUI, and Ink:

```yaml
motion:
  duration:
    instant: 80ms
    fast: 150ms
    base: 240ms
    slow: 400ms
    deliberate: 600ms
  ease:
    out-expo: cubic-bezier(0.16, 1, 0.3, 1)
    productive: cubic-bezier(0.4, 0, 0.2, 1)
    standard: cubic-bezier(0.4, 0.14, 0.3, 1)
    pop: cubic-bezier(0.34, 1.56, 0.64, 1)
```

Haptics tokenized as a named palette:

```yaml
haptics:
  pairing-success: { type: success, intensity: 1.0 }
  task-completion: { type: heavy, intensity: 1.0, followup: light-light }
  approval-granted: { type: soft-tap, intensity: 0.7, followup: rising-hum-80ms }
  approval-denied:  { type: warning-short, intensity: 0.8 }
  swipe-accept:     { type: medium-detent, intensity: 0.6 }
  swipe-reject:     { type: soft-detent, intensity: 0.5 }
  voice-start:      { type: rigid-short, intensity: 0.8 }
  voice-end:        { type: soft-thunk, intensity: 0.5 }
  error-critical:   { type: error-sharp, intensity: 1.0 }
  critical-alert:   { type: warning-rising, intensity: 1.0 }
```

## The target token API (what Claude Design should emit)

When Claude Design produces a redesign, the `design-system.json` in the handoff bundle should match the W3C Design Tokens format with these top-level groups:

```
motion/
  ease/
  duration/
radius/
spacing/
typography/
  font-family/
  size/
  weight/
  line-height/
  tracking/
  feature-settings/
colors/
  mimir/
    bg/
    surface/
    ink/
    accent/
    warn/
    success/
    elevation/
  yggdrasil/
  runestone/
  bifrost/
  valkyrie/
z-index/
glass/
  mimir/
  yggdrasil/
  runestone/
  bifrost/
  valkyrie/
haptics/
```

See `15-design-tokens-current.json` for the current-state export. Claude Design should deliver an EXPANDED version of this with:

1. Per-theme glass variants,
2. Per-theme focus-ring colors,
3. Haptic palette,
4. Named breakpoints (mobile/tablet/desktop/wide),
5. Component-specific tokens (e.g. `tokens.chat.bubble-gap`, `tokens.diff.hunk-gutter`).

## Component naming convention

Every component emitted in `components.json` uses:

- **PascalCase** names,
- **noun-first** naming: `ChatBubble` not `BubbleChat`, `SealedScroll` not `ScrollSealed`,
- Norse names OK in internal code but English names in user-facing copy,
- Variant props use **kebab-case values**: `{variant: "primary" | "secondary" | "ghost"}`,
- Boolean props start with `is-`, `has-`, `can-`.

Examples of canonical component names:

```
Block                — Warp-style command/output block
BlockStream          — Block container with gaps + keyboard nav
Runering             — Memory-save feedback glyph
SealedScroll         — Proof bundle card
CapabilityChips      — Provenance chip strip
TwinRavenView        — Huginn/Muninn split pane
ValknutSpinner       — Signature spinner
RuneForge            — Thinking indicator
SigilStamp           — Shadow-git checkpoint flash
RavenFlight          — iOS↔desktop sync animation
Well                 — Shadow-git timeline scrubber (exists!)
ChatBubble           — individual chat message
CommandPalette       — ⌘K overlay
ModelPicker          — provider+model dropdown
NotificationCenter   — top-right panel
KeyboardSheet        — ⌘/ overlay
```

## What each token enables

| Token group | Enables |
|---|---|
| `motion/duration` + `motion/ease` | Every animation in the app looks like it belongs to the same product |
| `radius` | Every border matches — no hand-tuned pixel values |
| `spacing` | 4/8-pt grid enforced — audit finding (cramped padding) fixes itself |
| `typography` | Typography is at Apple-ADA bar today (7/10); target: 9/10 with variable-weight transitions + one runic accent |
| `colors/<theme>/*` | Every theme switch works on every surface — no "it's half-themed" bug |
| `z-index` | Stack order is predictable — no fighting with stray `z-index: 9999` |
| `glass/<theme>` | Glass reads correctly on every theme (currently dark-glass on light-theme bug) |
| `haptics/*` | Haptics are cross-referenceable — iOS + Watch both reference `haptics.swipe-accept` |

## Build pipeline (what scripts/build-tokens.mjs should do)

1. Read `tokens.yaml`,
2. Validate against W3C Design Tokens schema,
3. Emit `desktop-app/src/styles/wotann-tokens.css` with all 5 themes,
4. Emit `ios/WOTANN/DesignSystem/WOTANNTokens.swift` as an enum with static properties,
5. Emit `src/ui/themes.ts` with the 5 named themes + preserve the 60 legacy Ink themes,
6. Emit TypeScript types: `src/design-tokens.d.ts`,
7. Write a changelog: `packages/design-tokens/CHANGELOG.md`.

Run via `npm run build:tokens`. Includes it in `npm run build`.

## Migration plan (12 weeks vs 4 weeks)

If Claude Design proposes a new token system, the port path:

**Week 1** — Emit new `wotann-tokens.css`, run side-by-side with `globals.css`.
**Week 2** — Codemod 120 desktop files from `--color-*` → `--wotann-*`.
**Week 3** — Remove `globals.css` palette duplication; reduce to `@import "./wotann-tokens.css"` + overrides-only.
**Week 4** — Codemod iOS: replace `WTheme.Colors.foo` → `WOTANNTokens.Colors.mimir.bg.canvas` etc.
**Week 5-6** — Codemod TUI: consolidate 65 themes into 5 named + legacy group.
**Week 7-12** — Ship per-theme glass, Runic font accents, Haptic palette, test across all views.

Per audit (`UI_UX_AUDIT.md` §8 Tier 0): this is **28 hours of engineering** to unblock the unified-brand question.

## Scope Claude Design should NOT expand

Claude Design must NOT:
- Invent new themes (stick to the 5: mimir, yggdrasil, runestone, bifrost, valkyrie),
- Invent new color scales (use Radix 12-step for any derived palette),
- Add font families beyond the 4 listed (Inter, JetBrains Mono, Geist, Noto Sans Runic),
- Change the 4 named eases or 5 durations without explicit justification,
- Introduce purple anywhere (anti-pattern rule 1).

Claude Design MAY:
- Propose additional component-level tokens (e.g. `tokens.chat.bubble-gap`),
- Propose a **single** new accent shade per theme if needed (documented with rationale),
- Propose per-breakpoint typography overrides (mobile / tablet / desktop / wide).

## Deliverables from Claude Design

1. **A new `design-system.json`** matching the W3C Design Tokens v3.0 format. This goes in the handoff bundle.
2. **A 5-page `tokens-rationale.md`** explaining every deviation from `15-design-tokens-current.json`.
3. **A 3-variant color preview PDF** (Canva export) showing each new theme applied to a canonical view (ChatView Welcome).
4. **A motion preview video** (MP4 or animated SVG) showing every new animation at 60fps.

---

*End of 16-design-system-ambition.*
