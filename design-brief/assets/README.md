# Design Brief Assets

## Files in this directory

- `wotann-tokens-current.css` — exact copy of `wotann/desktop-app/src/styles/wotann-tokens.css` as of 2026-04-19. The canonical source for the 5 WOTANN themes' CSS custom properties. Claude Design uses this to verify its `design-system.json` output matches existing token names.

## Token naming convention

Every CSS custom property uses `--wotann-*` prefix. The new token system (see `16-design-system-ambition.md`) keeps this prefix.

Example token name mapping between file formats:

| CSS (current) | W3C JSON |
|---|---|
| `--wotann-bg-canvas` (mimir) | `colors.mimir.bg.canvas.$value` |
| `--wotann-accent-rune` (mimir) | `colors.mimir.accent.rune.$value` |
| `--wotann-duration-base` | `motion.duration.base.$value` |
| `--wotann-ease-out-expo` | `motion.ease.out-expo.$value` |
| `--wotann-space-5` | `spacing.5.$value` |
| `--wotann-radius-card` | `radius.card.$value` |
| `--wotann-font-sans` | `typography.font-family.sans.$value` |

The build script `scripts/build-tokens.mjs` (to be created) will emit from YAML → CSS + Swift + Ink constants.

## No logos provided

Logo SVGs do NOT live in this directory today. The 5 variants (mimir / yggdrasil / runestone / bifrost / valkyrie) must be produced by Claude Design as part of the handoff bundle. Reference: `02-brand-identity.md` §"The brand mark — the W logo."

## No rune assets yet

24 Elder Futhark glyphs + 8 alchemical sigils need to be produced by Claude Design as 18×18 viewport single-path SVGs with `currentColor` stroke, per `UI_DESIGN_SPEC_2026-04-16.md` §13 ("All rune SVGs in apps/desktop/src/assets/runes/ — 24 Elder Futhark glyphs + 8 alchemical sigils as single-path SVGs, 18×18 viewport, currentColor stroke").

These go in the handoff bundle under `assets/runes/` and `assets/sigils/`.

## No fonts shipped

WOTANN references 4 font families (Inter Variable, JetBrains Mono Variable, Geist Sans, Noto Sans Runic) but does not self-host any. If Claude Design recommends self-hosting, fonts go in `assets/fonts/` in the handoff bundle.
