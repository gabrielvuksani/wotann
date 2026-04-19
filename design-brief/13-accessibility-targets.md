# 13 — Accessibility targets (WCAG 2.2 AA+ floor)

Source: `wotann/docs/UI_UX_AUDIT.md` §7 + `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` §10 + `ios/WOTANN/DesignSystem/A11y.swift` (exemplary).

## Non-negotiables

1. **WCAG 2.2 AA minimum** on every surface.
2. **AAA (7:1 contrast)** on all primary-ink × background pairs. Mimir achieves this (21:1). Yggdrasil achieves 10:1. Runestone/Valkyrie pass. **Muted text currently fails 7:1 on desktop (5.35:1) — must be fixed**.
3. **`prefers-reduced-motion: reduce`** respected everywhere — no transforms, no parallax, no auto-play. Source: `wotann-tokens.css:218-229` (already honored in tokens file; must be extended to all animations).
4. **Minimum tap target 44×44 pt on touch; 32×32 pt on desktop** with expanded pointer-events padding.
5. **Focus rings non-negotiable** — `outline: 2px solid var(--wotann-accent-rune); outline-offset: 2px` on every focusable element. Principle 7.
6. **VoiceOver reading order rehearsed** on every view.
7. **Dynamic Type on iOS** — every `Font.system(size: N)` must use `relativeTo:` for scaling.

## Desktop audit findings (from UI_UX_AUDIT.md §7.1)

| Criterion | Status | Evidence |
|---|---|---|
| ARIA roles on interactive | **High** | 524 `aria-*|role=|tabIndex` occurrences across 118 files |
| Focus rings | **Present** | `--wotann-focus-ring` in `wotann-tokens.css:58` |
| Reduced motion | **Partial** | `wotann-tokens.css:218-229` zeroes durations; `globals.css` animations NOT guarded |
| Keyboard-first nav | **Strong** | 16+ shortcuts, all primary actions have bindings |
| Screen reader | **Moderate** | `aria-label` on icon buttons; no `sr-only` utility class |
| Tabular numerals on cost | **Strong** | `globals.css:477-480` — `[aria-label*="cost"]`, `[aria-label*="token"]` get `font-variant-numeric: tabular-nums` |
| Color-contrast 7:1 | **Partial** | `--color-text-muted #86868B` on `#000` = **5.35:1 — fails 7:1**, passes AA 4.5:1 |
| Skip-to-content | **Unverified** | Not grep-found |

**Fix list** (8 items, 10-hour total):

| # | Fix | Surface | Lift |
|---|---|---|---|
| A1 | `--color-text-muted` `#86868B` → `#A8A8AD` (7.0:1) | desktop `globals.css:50` | 5 min |
| A2 | Add `prefers-reduced-motion` guards to all animations in `globals.css` | desktop | 1 h |
| A3 | Switch iOS fonts to `Font.system(size: ..., relativeTo: .body)` | `Theme.swift:70-88` | 2 h |
| A4 | Codemod 243 hardcoded `Font.system(size: N)` call-sites to DynamicFont | iOS | 4 h |
| A5 | Add `sr-only` utility class + skip-to-content link | desktop `globals.css` + `AppShell.tsx` | 1 h |
| A6 | `aria-live="polite"` on toast region | desktop `NotificationToast.tsx` | 15 min |
| A7 | Expand `Color.adaptive` adoption to all 40 color tokens | iOS `Theme.swift` | 1 h |
| A8 | Verify VoiceOver reading order in FloatingAsk/AskComposer | iOS manual test | 1 h |

## iOS audit findings (from UI_UX_AUDIT.md §7.2)

| Criterion | Status | Evidence |
|---|---|---|
| VoiceOver labels | **Strong** | 149 `accessibilityLabel|Hint` across 43 files; `A11y.swift` helpers |
| Reduced motion | **Excellent** | `A11y.swift:43-51` — `respectsReduceMotion(spring:value:)` swaps spring for `.easeInOut(0.2)` |
| Min tap target 44pt | **Strong** | `A11y.swift:56-75` — `hitTarget(onTap:)` enforces 44pt + `contentShape(Rectangle())` |
| Haptics | **Strong** | 137 haptic call-sites, typed palette |
| Dynamic Type | **REGRESSION** | `Theme.swift:70-88` uses fixed-pt fonts — 243+ call-sites fail |
| Smart Invert | **Unverified** | Needs manual audit |
| Light/Dark mode | **Partial** | `Color.adaptive` used in only 1 of 40 color tokens |

## TUI audit findings (from UI_UX_AUDIT.md §7.3)

| Criterion | Status | Evidence |
|---|---|---|
| Keyboard-first | **Excellent** | Only mouse-free harness in peer set |
| Screen reader | **N/A** | Ink runs inside terminal; relies on terminal's own support |
| Color contrast | **Variable** | 65 themes — several ADA-compliant; default uses purple/blue on `#1e1e2e` — needs per-theme check |
| Reduced motion | **None** | Only StreamingIndicator pulse — minimal impact |

**Purge purple from default themes per `UI_UX_AUDIT.md` §5.4**: `themes.ts:55` default dark has `accent: "#a855f7"` — violates anti-pattern rule 1.

## What Claude Design must design for

### Color contrast checks

Every color combination must be tested on all 5 themes:

- Mimir: `--wotann-ink-primary #E8EEF7` on `--wotann-bg-canvas #07090F` = **19.5:1** ✓
- Mimir: `--wotann-ink-muted #5F7389` on `#07090F` = **4.9:1** — passes AA body text but fails AA 7:1. **Raise to #7E91A6 for 7:1.**
- Yggdrasil: `#1A1612` on `#F3EFE6` = **15.2:1** ✓
- Runestone: `#F5F1E8` on `#030508` = **20.8:1** ✓
- Valkyrie: `#F0E8E0` on `#0A0808` = **17.4:1** ✓
- Bifrost: panel `rgba(27,18,48,0.72)` on gradient — needs to be tested at worst case gradient stop.

### Focus ring design

Must be visible on every interactive element, every theme:

```css
:focus-visible {
  outline: 2px solid var(--wotann-accent-rune);
  outline-offset: 2px;
  border-radius: inherit;
}
```

On iOS: use `focused(...)` modifier + visible ring (1.5pt stroke, color = theme accent).

### Reduced-motion fallbacks

For every animation spec in `14-motion-and-haptics.md`, provide a reduced-motion fallback:

| Animation | Default | Reduced-motion |
|---|---|---|
| Streaming word fade | 140ms each word | 0ms (immediate) |
| RuneForge thinking | 320ms each rune | static (single rune, no loop) |
| Tool call expand | spring stiffness 380 | linear 150ms |
| Sealed Scroll unroll | 420ms | 0ms (instant expand) |
| Raven's Flight | 800ms arc | no animation (instant transfer) |
| Sigil Stamp blink | 140ms | 0ms (static stamp) |
| Ember session-end | 880ms | hard cut |

### VoiceOver reading order

Every view must have a documented reading order:

**Example — Desktop ChatView Welcome**:
1. "WOTANN" (logo image alt)
2. "What would you like to build?" (heading)
3. "Multi-provider AI with autonomous agents, desktop control, and full tool use — all running locally on your machine." (subtitle)
4. 6 quick-action tiles in row order: "Start coding. Open the code editor." "Run tests. Run project tests." etc.
5. "Incognito mode off. Toggle for private conversation not saved to memory."
6. "Ask WOTANN anything. Text input. Press Enter to send. Shift+Enter for newline."

**Example — iOS HomeView**:
1. "WOTANN Home"
2. "StatusRibbon: Engine connected. Model: Opus. Cost today: 0 dollars."
3. "Ask WOTANN anything" (HeroAsk)
4. "Where you left off" (if WhereYouLeftOff has content)
5. etc.

### Dynamic Type (iOS)

Every text rendering must use `Font.system(size: N, relativeTo: .body)` OR a named SwiftUI font like `Font.body`, `Font.headline`, `Font.caption`.

Current `Theme.swift:70-88`:

```swift
// WRONG — does not scale with Dynamic Type:
static let bodyRegular = Font.system(size: 17, weight: .regular)

// RIGHT — scales with user's text-size setting:
static let bodyRegular = Font.system(size: 17, weight: .regular, design: .default).relativeTo(.body)
```

All 243 call-sites across iOS code must be codemodded.

### Keyboard paths (desktop + TUI)

Every action must have a keyboard binding documented in the Keyboard Shortcuts overlay (`⌘/`). Current 16 desktop shortcuts + 50+ TUI slash commands must grow:

| Action | Desktop | TUI |
|---|---|---|
| Command palette | ⌘K | ⌃P or backtick |
| New conversation | ⌘N | /new |
| Toggle sidebar | ⌘B | (TBD) |
| Toggle terminal | ⌘J or ⌘` | (TBD) |
| Toggle context panel | ⌘. | (TBD) |
| Settings | ⌘, | /settings |
| Chat tab | ⌘1 | /chat |
| Editor tab | ⌘2 | (n/a) |
| Workshop tab | ⌘3 | /workshop |
| Exploit tab | ⌘4 | /exploit |
| File search | ⌘P | /find |
| Model picker | ⌘M | /model |
| Diff panel | ⌘⇧D | /diff |
| Quick actions | ⌘⇧A | /actions |
| Code mode | ⌘⇧E | /build |
| Meet mode | ⌘⇧M | /meet |
| Cheatsheet | **?** (new) | /help |
| Close overlay | Escape | Escape |
| Focus mode | ⌘⇧G (new) | /focus |

### Haptic accessibility (iOS)

- Every haptic respects `UIAccessibility.isReduceMotionEnabled`.
- Critical haptics (pairingSuccess, taskCompletion) play at reduced strength when reduce motion is on.
- Non-critical haptics (hover, scroll) are suppressed entirely.

### Skip-to-content + landmarks

- Desktop: first focusable element after `<body>` is a skip link (visible on focus, sr-only otherwise).
- Skip link target: main pane.
- ARIA landmarks: `<header>` / `<nav>` / `<main>` / `<aside>` / `<footer>` correctly assigned.
- `<main>` has `id="main-content"` for skip target.

### Colorblind-safe palettes

Valkyrie theme (Exploit mode) uses red + moss for status. These must ALSO be distinguishable by:

- **Shape**: cracked seal vs solid seal icon,
- **Text label**: "FAILED" vs "PASSED",
- **Position**: failures sort to top in reports.

Never rely on color alone.

### Screen-reader-only utilities

Desktop must add a `.sr-only` utility class:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

Example usages:
- Sealed Scroll icon: `<span aria-hidden="true">ᛏ</span><span class="sr-only">Proof bundle sealed</span>`
- Cost chip: `<span aria-label="Cost: four cents">$0.04</span>`

## Testing checklist (per surface)

Before a Claude Design variant advances to the grading rubric:

- [ ] `axe-core` 0 errors on every view,
- [ ] `lighthouse` a11y score ≥95,
- [ ] Keyboard-only navigation walkthrough recorded,
- [ ] VoiceOver walkthrough recorded (desktop via Safari, iOS via Simulator),
- [ ] Color contrast tested on all 5 themes,
- [ ] `prefers-reduced-motion: reduce` applied — no jarring animation,
- [ ] Dynamic Type scaled to xxxLarge on iOS — no clipping,
- [ ] Smart Invert on — no unreadable color swaps,
- [ ] Tap targets ≥44×44pt (auto-checked by WCAG 2.2 rule 2.5.8).

---

*End of 13-accessibility-targets.*
