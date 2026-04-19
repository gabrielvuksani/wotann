# 23 — Success criteria (grading rubric)

Source: `wotann/docs/UI_UX_AUDIT.md` §1.

## The rubric

Every variant produced by Claude Design is graded on **8 bars × 3 surfaces = 24 scores**. Each score is 1-10. The composite (mean) per surface must be **≥8.0** for the variant to ship; **≥9.0** to match the Apple Design Award bar.

## The 8 bars

For each surface, score on:

| # | Bar | What "10/10" looks like |
|---|---|---|
| 1 | **Typography** | Inter Variable + JetBrains Mono + feature-settings correct; 3 sizes per view max; -0.011em body tracking; runic accent used once per view |
| 2 | **Spacing rhythm** | 4/8/12/16/24 pt grid visible in every component; no hand-tuned pixel values; visual rhythm consistent |
| 3 | **Colour palette integrity** | All 5 themes work on all views; AAA contrast on primary-ink pairs; Valkyrie auto-activates in Exploit only; Bifrost used only in onboarding |
| 4 | **Motion craft** | 4 named eases + 5 durations respected; `prefers-reduced-motion` honored; every animation has a rationale |
| 5 | **State completeness** | All 10 states designed per view (default / empty / loading / streaming / error / success / disconnected / offline / low-battery / focus) |
| 6 | **Glass / depth / material fidelity** | Per-theme glass tokens; noise-grain 2% overlay; specular sheen on hover; layered translucency with 2+ blur radii |
| 7 | **Keyboard density (TUI/desktop) OR Haptic craft (iOS)** | All primary actions reachable by keyboard; `?` cheatsheet; iOS haptic palette (10 types) used correctly |
| 8 | **Brand identity (Norse thread)** | W logo 4-stop gradient; runic accents in 3-5 controlled places per view; Runestone theme as marketing hero |

## Current baseline (2026-04-19)

From `UI_UX_AUDIT.md` §1.1. This is what Claude Design must BEAT.

| Bar | Desktop | TUI | iOS |
|---|:-:|:-:|:-:|
| 1 Typography | 6 | 7 | 7 |
| 2 Spacing | 6 | 7 | 7 |
| 3 Colour | 7 | 7 | 7 |
| 4 Motion | 5 | 4 | 7 |
| 5 State completeness | 6 | 6 | 7 |
| 6 Glass | 6 | n/a | 8 |
| 7 Keyboard / Haptics | 7 | 9 | 8 |
| 8 Brand identity | 5 | 4 | 3 |
| **Composite** | **6.0** | **6.3** | **6.8** |

## Target (minimum to ship)

**Composite per surface ≥ 8.0.** Every bar ≥ 7.0.

## Apple Design Award target

**Composite per surface ≥ 9.0.** Every bar ≥ 8.5.

## How grading works

### Gabriel's grading protocol

1. Load the handoff bundle via `wotann import-design`.
2. Preview each variant against canonical views (WelcomeScreen + OnboardingView + SettingsView + first-message flow).
3. For each variant, score all 8 bars × 3 surfaces → produce a 24-cell table.
4. Compute composite per surface.
5. Select variant with highest composite that also passes ALL constraints in `22-constraints-and-antipatterns.md`.
6. Document rejected variants in `design-brief/grading-log.md` (to be created post-review).

### Variant rejection conditions

A variant is rejected (regardless of composite score) if:

- Any single bar scores < 5.0 (below baseline),
- Any constraint from `22-constraints-and-antipatterns.md` is violated,
- Any forbidden word from `17-copy-and-voice.md` appears in any visible string,
- `wotann import-design` fails on the bundle.

## Per-variant scoring template

Each variant gets a grading table:

```
Variant: <name>
Surface: <tui | desktop | ios>
Competitor inspirations: <list>

Bar                | Score | Rationale (1-2 sentences)
-------------------|-------|---------------------------
Typography         |       |
Spacing rhythm     |       |
Colour integrity   |       |
Motion craft       |       |
State completeness |       |
Glass fidelity     |       |
Keyboard/Haptic    |       |
Brand identity     |       |
-------------------|-------|---------------------------
Composite          | X.X   | (mean)

Constraint violations: <none | list>
Verdict: <SHIP | REVISE | REJECT>
```

## Per-surface grading notes

### Desktop grading emphasis

Highest-leverage bars (spend the most review time on):
- **Motion** (current 5 → target 8) — biggest gap,
- **Glass** (current 6 → target 9) — Liquid Glass ambition,
- **Brand identity** (current 5 → target 8) — Norse thread across 131 files,
- **State completeness** (current 6 → target 8) — every view needs all states designed.

Lowest priority:
- **Typography** (current 6 → target 8) — already near-competent, just needs polish.

### TUI grading emphasis

Highest-leverage bars:
- **Motion** (current 4 → target 7) — constrained by terminal but can improve (RuneForge over `...` spinner),
- **Brand identity** (current 4 → target 7) — runes and themes need consistent application,
- **State completeness** (current 6 → target 8) — need command palette + block rendering.

Lowest priority:
- **Keyboard** (current 9 → target 9) — already at bar.

### iOS grading emphasis

Highest-leverage bars:
- **Brand identity** (current 3 → target 7) — iOS has least Norse thread today,
- **State completeness** (current 7 → target 9) — need disconnected + low-battery + offline variants,
- **Motion craft** (current 7 → target 9) — add Raven's Flight, Sigil Stamp,
- **Typography** (current 7 → target 9) — Dynamic Type must be fixed (243 fixed-pt sites).

Lowest priority:
- **Haptics** (current 8 → target 9) — already best-in-class.
- **Glass** (current 8 → target 9) — `.ultraThinMaterial` adoption across sheets.

## Bar-by-bar gap targets

### Bar 1 — Typography (target 9.0)

Gap closers:
- Variable-weight transitions on hover (400 → 500),
- Italics for tone shifts,
- Quick-action label size 11 → 13px,
- Runic font used once per view,
- iOS Dynamic Type fix (relativeTo:).

### Bar 2 — Spacing rhythm (target 8.5)

Gap closers:
- Quick-action card padding 8 → 12px,
- Logo-to-heading gap 16 → 24px,
- Settings sidebar overflow fix,
- iOS Card spacing pass.

### Bar 3 — Colour integrity (target 9.0)

Gap closers:
- Purge purple from Ink themes,
- Muted text #86868B → #A8A8AD (7.0:1),
- Per-theme glass tokens,
- Valkyrie full adoption in Exploit (not just accent),
- iOS `Color.adaptive` expansion.

### Bar 4 — Motion craft (target 8.5)

Gap closers:
- Tab underline slide,
- Command palette entrance,
- Notification scale-in,
- Staggered welcome tiles,
- Runering wired to `mem_save`,
- RuneForge replaces 40+ `animate-spin` sites.

### Bar 5 — State completeness (target 9.0)

Gap closers:
- Every state for every view (see `11-states-inventory.md`),
- First-run tour (currently missing on all platforms),
- "Continue without pairing" iOS flow,
- Engine-disconnected copy softened + amber severity,
- Settings scrim blur.

### Bar 6 — Glass / depth / material (target 9.0)

Gap closers:
- Per-theme glass tokens (4 new CSS vars per theme),
- Noise-grain overlay,
- Specular sheen,
- iOS `.ultraThinMaterial` wrapping (FloatingAsk, AskComposer, VoiceInlineSheet, ProactiveCardDeck, RecentConversationsStrip),
- iOS flat `WTheme.Colors.surface` → `.thinMaterial` across 22 view files.

### Bar 7 — Keyboard density / Haptic craft (target 9.0)

Desktop:
- `?` cheatsheet overlay,
- Inline keyboard hints in palette rows,
- Bind `/focus` to Cmd+Shift+G.

TUI:
- Command Palette overlay (⌃P or backtick),
- Per-turn cost ticker in StatusBar.

iOS:
- Expand haptic palette where ProactiveCardDeck and Sealed Scroll fire,
- Dynamic Island coverage for Meet + Cost budgets.

### Bar 8 — Brand identity (target 8.5)

Gap closers:
- W logo 4-stop gradient upgrade,
- Runestone theme available from Settings > Appearance live preview,
- Runic font used once per view,
- Council Mode runic dividers,
- iOS first-launch + gold hairline tab separator + Settings opt-in runes.

## Per-variant walkthrough template (Gabriel's rehearsal)

For each variant, rehearse:

1. Launch the app (TUI / desktop / iOS),
2. Go through the 12 critical flows in `10-interactions-and-flows.md`,
3. Tick off state completeness per `11-states-inventory.md`,
4. Screenshot each view × state,
5. Grade per 24-cell table,
6. Note any constraint violations,
7. Summarize: "Variant X — SHIP" / "Variant Y — REVISE with note <...>" / "Variant Z — REJECT because <...>."

## Delivery expectation from Claude Design

For each variant:
- Full handoff bundle (see `21-handoff-bundle-schema.md`),
- **Self-score** table — Claude Design's own grading (honest),
- **Self-audit** against constraints (list any triggered),
- **Canva preview deck** (one per surface) for quick visual review,
- **Motion preview video** (60fps, up to 60s) showing key interactions.

Gabriel re-scores independently. If Gabriel's scores differ from Claude Design's self-score by more than 1.5 on any bar, Gabriel's scores win and variant requires revision.

## Ship threshold summary

- **SHIP**: composite ≥ 8.0 per surface, every bar ≥ 7.0, zero constraint violations.
- **REVISE**: composite 7.0-7.9 or 1-2 bars at 5.0-6.9 — round 2 of generation.
- **REJECT**: composite < 7.0 or any bar < 5.0 or any constraint violated.

The Apple Design Award target is composite ≥ 9.0; 8.0 is the floor.

---

*End of 23-success-criteria.*
