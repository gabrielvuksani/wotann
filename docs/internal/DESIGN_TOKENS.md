# ADR: Unified Design Tokens (P2)

**Status**: Accepted (2026-04-21)
**Owner**: WOTANN design system
**Supersedes**: Ad-hoc CSS vars in `desktop-app/src/styles/wotann-tokens.css` and hardcoded hex in Swift + TSX files.

## Context

Prior to P2, WOTANN had three independent sources of design values:

| Surface | Source | Format |
|---|---|---|
| TUI (Ink/terminal) | `src/ui/themes.ts` | TS palette objects (5 palettes × 19 tokens) |
| Desktop (Tauri webview) | `desktop-app/src/styles/wotann-tokens.css` + inline `#...` in tsx | CSS custom properties + hardcoded hex |
| iOS (SwiftUI) | `ios/WOTANN/DesignSystem/Theme.swift` | Swift enums with hex literals |

Each source was maintained by hand. Keeping them in sync was impossible in practice — a cyan accent in themes.ts drifted from a blue accent in Swift and an Apple-blue accent in globals.css.

## Decision

Create **one canonical graph** at `src/design/tokens.ts` that re-exports palette values from `themes.ts` and adds the five missing token families (typography, spacing, radius, shadow, motion). A set of per-surface **emitters** in `src/design/token-emitters/` each produce a different artifact:

| Emitter | Output | Consumed by |
|---|---|---|
| `tui.ts` | Ink-ready palette POJO | TUI components |
| `desktop.ts` | CSS custom properties + TS helper module | Tauri webview |
| `ios.ts` | SwiftUI enum of Color/CGFloat/TimeInterval | iOS app |
| `w3c-tokens.ts` | W3C Design Tokens CG JSON | Figma / Tokens Studio / Style Dictionary |

A generator script `scripts/generate-tokens.mjs` writes the emitter output to disk. Generated files are checked in so they're diffable and reviewable (`desktop-app/src/design/tokens.generated.{ts,css}`, `ios/WOTANN/DesignSystem/WotannTokens.swift`, `docs/internal/design-tokens.w3c.json`). CI runs `node scripts/generate-tokens.mjs --check` to fail if a PR forgets to regenerate.

## Consequences

**Positive**
- Changing a palette value in `themes.ts` propagates to all three surfaces automatically after `node scripts/generate-tokens.mjs`.
- Tests enforce a regression lock: `tokens.ts` palette reference IS `themes.ts` PALETTES (object identity check).
- 95 color tokens (19 × 5 palettes) + typography/spacing/radius/shadow/motion families — ~200 total values under the same authority.
- Desktop components can now write `color("accent")` and get the active theme's accent via CSS custom property, with type-safety on the token name.
- iOS side gets a mirror `WotannTokens.swift` that can be imported alongside `Theme.swift` for new screens; legacy screens keep using Theme.swift.

**Negative**
- The generator runs at author time, not runtime. Designers need to remember `npm run tokens:generate` after editing `tokens.ts`. Mitigation: CI `--check` mode.
- Not all desktop components were migrated in P2 — a POC of 12 was completed (48 -> 3 hex, -94%). The remaining 60+ desktop files still contain hardcoded hex and remain tracked for follow-on work.
- iOS emitter does not yet replace the existing `Theme.swift` — it adds `WotannTokens.swift` alongside it. A follow-on PR can migrate `Theme.swift` to consume generated tokens.

## Non-goals

- Theme switching UX (already handled by `ThemeManager` in `src/ui/themes.ts`).
- Runtime-mutable tokens. The graph is build-time frozen; switch themes via `[data-theme="..."]` on the desktop root.
- Style Dictionary integration. The W3C JSON is produced as a hand-off artifact; external tool integration is out of scope.

## File map

```
src/design/
  tokens.ts                    # canonical graph (this ADR's main artifact)
  token-emitters/
    tui.ts                     # Ink emitter
    desktop.ts                 # CSS + TS emitter
    ios.ts                     # SwiftUI emitter
    w3c-tokens.ts              # W3C JSON emitter
    index.ts                   # barrel

scripts/
  generate-tokens.mjs          # runs all 4 emitters, writes to disk

desktop-app/src/design/
  tokens.generated.ts          # GENERATED (committed)
  tokens.generated.css         # GENERATED (committed)

ios/WOTANN/DesignSystem/
  WotannTokens.swift           # GENERATED (committed)
  Theme.swift                  # unchanged, coexists

docs/internal/
  design-tokens.w3c.json       # GENERATED (committed) — external tool interop

tests/design/
  tokens.test.ts               # 22 tests — palette completeness, regression lock
  token-emitters.test.ts       # 23 tests — per-surface emitter contracts
```

## Commands

```bash
# Regenerate all artifacts
node scripts/generate-tokens.mjs

# Check mode — exit 1 if generated files are out of date
node scripts/generate-tokens.mjs --check

# Test
npx vitest run tests/design
```
