# 04 — The 15 Design Principles

These are the non-negotiables every redesign candidate must satisfy. Every principle has an enforcement test. If Claude Design produces a variant that fails any test, that variant is disqualified from the grading rubric in `23-success-criteria.md`.

## The 15 principles

### 1. Truth before beauty

No marketing fluff in system UI. Every banner, toast, error, and empty-state must name WHAT is true, not decorate the truth. Source: `CLAUDE.md` + session-2 quality bars (`feedback_wotann_quality_bars_session2.md` — "honest stubs over silent success").

**Enforcement**: every copy change must be runnable by a code test that checks for forbidden words: "sorry", "oops", "something", "great", "awesome", "!", "we think", "maybe."

### 2. Keyboard density is first-class

The TUI has 50+ slash commands and must be navigable entirely without a mouse. The desktop has 16+ shortcuts — not hidden, discoverable via a `?` cheatsheet overlay. iOS has full VoiceOver + swipe-gesture parity. Source: `UI_UX_AUDIT.md` §6 — WOTANN composite keyboard parity = 9/10 today.

**Enforcement**: every primary surface action has a keyboard path documented in `07-surface-tui.md`, `08-surface-gui-desktop.md`, `09-surface-ios.md`.

### 3. Free-tier first-class

Ollama + Gemma + local models are never second-class. Paid models are an upgrade. The UI must signal this: the cost meter starts at `$0.00 (Ollama local)` and glints gold only when a paid key is added. Source: `CLAUDE.md` + `UI_DESIGN_SPEC_2026-04-16.md` §7.4.

**Enforcement**: the first-run cost indicator shows "$0.00 (local)" — not an empty state. The provider picker always lists Ollama first when available. No "Upgrade to Pro" CTA anywhere; only neutral "Add API key" when the user chooses.

### 4. Honest errors, no silent success

A stub is acknowledged as a stub. An error surfaces the root cause, never a generic "Something went wrong." Source: session-2 quality bars + `UI_PLATFORMS_DEEP_READ_2026-04-18.md` — "6 honest stubs, no silent failures."

**Enforcement**: every error path has a name + a concrete next action. No "try again" without an explanation. No fake success.

### 5. Block everything

Every turn — user prompt, assistant response, tool call, terminal command, diff — is a Block with status, gutter, copy, share, rerun, keyboard nav. Source: `Block.tsx` exists at 327 LOC and must be consumed across ChatPane, MessageBubble, ToolCallCard, EditorTerminal, TerminalPanel. Source: `UI_UX_AUDIT.md` §4.

**Enforcement**: 0 appearances of free-text chat message bubbles outside Blocks. Every turn must render as `<Block>` or the Ink TUI equivalent.

### 6. Proof before done

Every task ends with a Sealed Scroll proof bundle — 4 seals (Tests, Typecheck, Diff, Screenshots). Each seal has a state: pending / running / passed / failed. Source: `UI_DESIGN_SPEC_2026-04-16.md` §4.3 + `SealedScroll.tsx` exists.

**Enforcement**: no "task complete" without a proof bundle. If tests don't run, the seal is "not-run" (cracked grey icon), never "passed by default."

### 7. Apple-bar accessibility floor

- WCAG 2.2 AA everywhere, AAA (7:1) where feasible on Mimir theme (`--wotann-ink-primary` on `--wotann-bg-canvas` = 21:1).
- `prefers-reduced-motion: reduce` respected everywhere.
- Minimum tap target 44×44 pt on touch; 32×32 pt on desktop with expanded pointer-events.
- Dynamic Type on iOS (every `Font.system(size: N)` must use `relativeTo:`).
- VoiceOver reading order rehearsed on every view.

Source: `UI_DESIGN_SPEC_2026-04-16.md` §10 + `UI_UX_AUDIT.md` §7.

**Enforcement**: `/a11y-audit` skill run passes on every view. `axe` lint = 0 violations.

### 8. One unified token system

Every color, spacing, radius, shadow, motion, and z-index lives in one canonical token file (`packages/design-tokens/tokens.yaml`) that emits CSS for desktop, Swift constants for iOS, and Ink theme constants for TUI. Source: `UI_UX_AUDIT.md` §5.5.

**Enforcement**: `grep -r "color-primary\|bg-base\|surface-1" desktop-app/src` returns 0 hits post-codemod. Every surface reads from `--wotann-*`.

### 9. Motion with intent

No animation for its own sake. Every transition is either:
- **Instant** (80ms) — color, opacity swaps on hover,
- **Fast** (150ms) — button press, state change,
- **Base** (240ms) — reveal, slide-in,
- **Slow** (400ms) — drawer, sheet open,
- **Deliberate** (600ms) — page-level transitions, streaming cursor.

All curves from the 4 named eases: `out-expo`, `productive`, `standard`, `pop`. Source: `wotann-tokens.css:14-28`.

**Enforcement**: no CSS `transition: all` except on well-defined properties. No animation > 600ms. Every motion has a spec document entry in `14-motion-and-haptics.md`.

### 10. Five themes, five moods

Mimir (default dark), Yggdrasil (light), Runestone (marketing hero), Bifrost (onboarding ONLY), Valkyrie (Exploit ONLY). Bifrost is NEVER a sustained work surface. Valkyrie auto-activates only inside Exploit. Source: `UI_DESIGN_SPEC_2026-04-16.md` §3.

**Enforcement**: the `data-theme="bifrost"` class is only allowed in `OnboardingView.tsx` and `CelebrationOverlay.tsx`. The `data-theme="valkyrie"` class is only allowed inside `ExploitView.tsx`.

### 11. Norse identity at calibrated volume

Brand thread must land on every surface at different volume levels:
- TUI: loud (runes everywhere),
- Desktop: medium (W logo + Runestone theme + Council runic dividers),
- iOS: subtle (logo on first-launch + gold hairline in tab bar, runes opt-in in Settings).

Source: `02-brand-identity.md`.

**Enforcement**: iOS default theme has 0 user-visible runes. Desktop default Mimir has the W logo + 1 rune in palette placeholder.

### 12. No vendor bias in ?? fallbacks

From session-1 quality bars (`feedback_wotann_quality_bars.md`): no code or UI that biases toward one provider's branding. The provider picker lists providers alphabetically (Anthropic, Google, Groq, Ollama, OpenAI, ...). Source: `CLAUDE.md` naming convention + session-1 rules.

**Enforcement**: the ModelPicker dropdown default sort is alphabetical. Ollama appears only at the top when it's the free-tier recommendation, not because it's favoured.

### 13. One surface doesn't dominate

The TUI, Desktop, and iOS are peers. No surface is "the real WOTANN" and the others are "also there." The TUI has features the desktop doesn't have (e.g., every Ink slash command). The iOS app has features neither has (HealthKit, ProactiveCardDeck, MorningBriefing).

**Enforcement**: `06-capability-matrix.md` explicitly calls out when a feature is TUI-only, desktop-only, or iOS-only. Claude Design must design for all three; no surface gets a "tbd" placeholder in its deliverable.

### 14. Craft, not cosplay

Norse-inspired, not World of Warcraft. Dieter Rams × the Lewis Chessmen × Bloomberg Terminal, not a fantasy RPG UI kit. Source: `UI_DESIGN_SPEC_2026-04-16.md` §1 thesis.

**Enforcement**: no curved-sword icons, no shield backgrounds, no "epic loot" styling. Runic glyphs must be single-path SVG from a real runic alphabet, used sparingly, never decoratively.

### 15. Scope discipline

Do what was asked; nothing more. If Claude Design thinks it has a great idea for a feature not named in this brief, it goes in a "future considerations" appendix of the output, not in the main deliverable.

Source: `CLAUDE.md` coding-style rules + `rules/coding-style.md` "Scope Discipline" section.

**Enforcement**: the final handoff bundle's `manifest.json` has a `scope_extensions` array. Anything not in `06-capability-matrix.md` must appear there, with justification.

## How these principles map to the scorecard

| Principle | Scorecard bar it defends |
|---|---|
| 1 Truth | Copy / voice |
| 2 Keyboard | Keyboard parity |
| 3 Free-tier | Brand identity |
| 4 Honest errors | Error states |
| 5 Block everything | Block-based units |
| 6 Proof before done | State completeness |
| 7 Accessibility | Voice / VoiceOver + Dynamic Type |
| 8 Token unification | Design-token unification |
| 9 Motion with intent | Motion design |
| 10 Five themes | Colour palette |
| 11 Brand thread | Brand identity |
| 12 No vendor bias | Copy / voice |
| 13 Surface parity | Responsive density |
| 14 Craft not cosplay | Brand identity |
| 15 Scope discipline | (meta — prevents drift) |

A variant must satisfy ALL 15 principles to advance to the grading rubric. A variant that violates any one is eliminated.

---

*End of 04-design-principles.*
