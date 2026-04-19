# 14 — Motion and haptics

Source: `wotann/desktop-app/src/styles/wotann-tokens.css:14-28` + `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` §6 + `ios/WOTANN/Services/HapticService.swift`.

## Motion primitives (tokenized)

### Four eases (canonical)

```
--wotann-ease-out-expo:   cubic-bezier(0.16, 1, 0.3, 1);     /* DEFAULT */
--wotann-ease-productive: cubic-bezier(0.4, 0, 0.2, 1);      /* material productive */
--wotann-ease-standard:   cubic-bezier(0.4, 0.14, 0.3, 1);   /* Carbon-style */
--wotann-ease-pop:        cubic-bezier(0.34, 1.56, 0.64, 1); /* playful bounce */
```

### Five durations

```
--wotann-duration-instant:    80ms;   /* hover, color swap */
--wotann-duration-fast:       150ms;  /* button press, state */
--wotann-duration-base:       240ms;  /* reveal, slide-in */
--wotann-duration-slow:       400ms;  /* drawer, sheet */
--wotann-duration-deliberate: 600ms;  /* page-level, streaming cursor */
```

Never more than 600ms outside of:
- **Sealed Scroll unroll** (420ms) — still under budget,
- **Raven's Flight** (800ms) — the one exception, opt-in delight,
- **Ember session-end** (880ms) — opt-in, triggered on app quit only.

### Reduced-motion override (already shipped at `wotann-tokens.css:218-229`)

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --wotann-duration-instant: 0ms;
    --wotann-duration-fast: 0ms;
    --wotann-duration-base: 120ms;
    --wotann-duration-slow: 120ms;
    --wotann-duration-deliberate: 120ms;
    --wotann-ease-out-expo: linear;
    --wotann-ease-pop: linear;
    --wotann-ease-standard: linear;
  }
}
```

## The 10 signature micro-interactions (canonical)

From `UI_DESIGN_SPEC_2026-04-16.md` §6. Every interaction has exact parameters. Claude Design must not deviate without explicit reason.

### 1. Streaming text fade-in

- Each **word** enters at opacity 0 → 1 over **140ms**, `cubic-bezier(0, 0, 0.4, 1)`,
- Stagger: **18ms per word**,
- On punctuation insert: **60ms micro-pause**,
- **Never character-by-character** (looks like a slow typewriter, not a thoughtful speaker).

### 2. Thinking indicator — RuneForge

Three Elder Futhark glyphs `ᚠ ᛉ ᚹ`:
- **Stroke-dash from 0 → 100%** in sequence, **320ms each**,
- Fill with `--wotann-accent-rune` for **120ms**,
- **Un-stroke** in reverse,
- Infinite loop,
- SVG `stroke-dasharray` + `stroke-dashoffset` animated via GPU transform,
- **Accessibility**: `aria-label="WOTANN is thinking"`, `role="status"`, `aria-live="polite"`.

### 3. Tool call expand

Collapsed state: 28px pill with tool glyph + name. Click:
- Height: 28 → auto, **spring stiffness 380, damping 32** (about 440ms),
- Width: 240 → 100%,
- Content cross-fades at **180ms offset**.

Re-collapse: reverse with **60ms faster damping**.

### 4. Diff accept / reject (physics)

Accepted:
- Slide right 16px then settle (elastic **380ms**),
- Green flash `rgba(79,163,127,0.3)` → transparent over **620ms**.

Rejected:
- Slide left **24px**,
- Fade 240ms,
- Collapse height 180ms — remove from DOM.

### 5. Provider chip hover

- `transform: scale(1.04)`,
- Elevation 1 → 2 over **180ms `ease-out-expo`**,
- Chip text slides up 2px,
- 1px accent border grows from center to full width in **220ms**.

### 6. Message hover actions

Right-side 24px ghost icons (copy, branch, save-as-skill, star):
- Fade in 0 → 0.7 over **160ms**,
- Stagger **24ms each**.

Individual icon hover:
- Opacity 1 + 2px lift.

### 7. Input focus ritual

- Border 1px `surface.stroke` → 2px `accent.rune` over **180ms**,
- Simultaneously **1px inner glow breathes at 2s sin cycle** (opacity 0.1 ↔ 0.25),
- On Enter: border flashes `accent.gold` **140ms** before message lifts out of composer.

### 8. Sidebar collapse

- Width 260 → 56 over **320ms `ease-out-expo`**,
- Labels cross-fade 0 → 120ms,
- Icons remain.

On re-expand:
- Spring,
- Labels stagger-in **24ms** from top.

### 9. Error shake

- `translateX(0, -4px, 4px, -2px, 2px, 0)` over **320ms** `cubic-bezier(0.36, 0.07, 0.19, 0.97)`,
- **Only for destructive confirmations**,
- **Never** on parse errors (use amber banner instead).

### 10. Session end — Ember

On app quit:
- All text fades to **40% opacity** over **640ms**,
- Small ember particle emerges at center:
  - radius 6 → 0,
  - opacity 1 → 0,
  - y drift 0 → -24px,
  - over **880ms**,
- Hard cut to dock.

**Users remember this.** Opt-in only.

## The 7 signature interactions (view-level)

From `UI_DESIGN_SPEC_2026-04-16.md` §4. These are larger sequences that compose multiple micro-interactions.

### 1. The Runering (memory-save feedback)

When `mem_save` fires:
- 18px Elder Futhark glyph appears at top-right of active panel:
  - `ᚨ` Ansuz for decisions,
  - `ᚱ` Raidho for patterns,
  - `ᚲ` Kenaz for discoveries,
  - `ᚾ` Naudhiz for blockers,
- 1px gold stroke traces a full 360° circle around it in **480ms** `cubic-bezier(0.65, 0, 0.35, 1)`,
- Circle completes,
- Glyph pulses once (scale 1 → 1.08 → 1, opacity 1 → 0.6 over **280ms**),
- Both fade over **600ms**.

**Current component**: `Runering.tsx` exists, not consumed. Wire into every `mem_save` call.

### 2. Huginn & Muninn — Twin-Raven Split Pane

Keyboard `⌘⇧2`:
- Conversation splits into Huginn (Thought, left) and Muninn (Memory, right),
- Huginn runs live model; Muninn runs second provider with divergent system prompt ("critique, don't agree"),
- Outputs stream side-by-side at ~**380ms offset**,
- Each raven renders as 14px SVG glyph at top of its pane,
- When one raven flags a contradiction: glyph **tilts 6°**, turns gold for **800ms**, drops a hairline connecting the two panes at the diverging line.

**New component needed**: `TwinRavenView.tsx`.

### 3. Sealed Scroll Proof Bundle

On task completion:
- Vellum-textured card **unrolls from bottom** (height 0 → auto, **420ms**),
- 4 seals in a horizontal row — Tests, Typecheck, Diff, Screenshots,
- Each is a 32×32 wax-seal SVG with 4 states: empty circle (pending) / spinning rune (running) / solid gold (passed) / cracked red (failed),
- Rolled scroll icon at left edge,
- Clicking scroll: re-roll animation (scrollY 0 → -8px → 0 over **320ms**) exports bundle as markdown + embedded SHA.

**Current component**: `SealedScroll.tsx` exists, not wired. Hook into every `onTaskComplete`.

### 4. Capability Chips with Provenance Glyphs

Every assistant message header shows chip strip:
- Provider chip: `[ Opus ◈ 1M ]` gold stroke for paid, green for local,
- Augmentation chips: `[ 🜂 vision ]` `[ 🜃 thinking ]` `[ 🜄 tools ]` using alchemical sigils,
- Cost chip: `$0.08` or `$0 (Ollama)` in hearthgold,
- Shadow-git chip: `[ ⚒ 7a3f2 ]` truncated SHA with scrubber affordance.

**Current component**: `CapabilityChips.tsx` exists, not wired. Consume on every message.

### 5. The Raven's Flight (iOS ↔ desktop sync)

When session transfers device:
- Two raven silhouettes fly across full-screen canvas on parabolic arc (**800ms** `cubic-bezier(0.25, 0.1, 0.25, 1)`),
- Disappear through gold portal in top-right corner.

**Opt-in delight.** New components: `RavenFlight.tsx` (desktop) + `RavenFlightView.swift` (iOS).

### 6. Sigil Stamp (shadow-git auto-commit)

Before every tool call, shadow-git stamps a checkpoint:
- 4×4 gold sigil **blinks once** at top-left of modified file tab,
- Contracts into tab icon,
- Sigil persists as **subtle 1px gold underline** under filename,
- Hover reveals "12 shadow-commits in this session → scrub timeline."

### 7. Council Mode (⌘⇧C)

- Single query fans out to 3-4 concurrent providers,
- Conversation pane transforms into **horizontal council table**,
- N columns, each titled with provider chip,
- Responses stream simultaneously,
- Bottom: unified voting bar shows convergence,
- Operator selects which to merge with number keys `1-4` or drag-up gesture,
- Dismissed responses **fade to 32% opacity** but remain in shadow-git log.

**Current**: `CouncilView.tsx` on desktop exists. iOS missing.

## Haptic palette (iOS)

Source: `ios/WOTANN/Services/HapticService.swift` + `Haptics.swift`. 137 call-sites across 39 files.

### Canonical 10 haptic types

| Type | Pattern | Trigger |
|---|---|---|
| `pairingSuccess` | Success + soft tap | ECDH complete, device paired |
| `taskCompletion` | Heavy + light-light | Agent finishes task, proof bundle sealed |
| `approvalGranted` | Soft tap + rising hum (80ms) | User approves a tool call |
| `approvalDenied` | Warning short | User denies a tool call |
| `swipeAccept` | Medium + detent | Diff card swiped right |
| `swipeReject` | Soft + detent | Diff card swiped left |
| `voiceStart` | Rigid short | Voice input begins |
| `voiceEnd` | Soft + thunk | Voice input ends |
| `errorCritical` | Error sharp | Critical Exploit finding |
| `criticalAlert` | Warning + rising | Red-team CVSS critical |

All haptics:
- Respect `UIAccessibility.isReduceMotionEnabled`,
- Play at reduced strength when reduce motion is on,
- Non-critical haptics suppressed entirely under reduce motion.

### Swipe detent (Tinder-style diff review)

From `UI_DESIGN_SPEC_2026-04-16.md` §9.1:

- Left swipe → reject (haptic detent at **±18°**),
- Right swipe → accept (haptic detent at ±18°),
- Card returns to center if swipe doesn't cross 45° threshold.

### Haptic timing budget

- Haptics should NEVER play simultaneously with another haptic,
- Minimum 160ms between haptics,
- Critical haptics preempt non-critical (if voiceEnd and taskCompletion fire within 160ms, taskCompletion wins).

## Sound design (opt-in)

From `UI_DESIGN_SPEC_2026-04-16.md` §8. All sounds produced in-house, WAV, 48kHz, 24-bit, peak -12dBFS. All <400ms. **All OFF by default.**

| Cue | Duration | Character | Trigger |
|---|---|---|---|
| Rune-tap | 80ms | Wooden mallet on bronze, 320Hz + 1.2kHz overtone | Tool-call success |
| Well-hum | 2400ms loop, -22dB | Low cavern tone, 80Hz w/ 0.3Hz wobble | Session open (first 2.4s) |
| Wax-seal press | 180ms | Low-mid thud + brief high sizzle tail | Proof bundle sealed |
| Wood-knock | 120ms | Single oak rap, no resonance | Error shake / destructive warning |

**Never**: beeps, swooshes, button clicks, generic success chimes. Default: all sounds off.

Sound assets under `apps/desktop/src-tauri/resources/sfx/`.

## Cross-surface motion choreography

Certain animations must play on BOTH sides (iOS + desktop) to reinforce the bridge:

1. **Raven's Flight** — when iOS relays a task, desktop shows matching arrival animation,
2. **Sigil Stamp on shadow-git commit** — if triggered on desktop, iOS ActivityFeed shows a brief sigil stamp notification,
3. **Proof Bundle sealed** — both surfaces show a Sealed Scroll.

This reinforces the "one product, many surfaces" narrative.

## What Claude Design must produce

For every motion:
1. **Spec** — duration, ease, property changes,
2. **Reduced-motion fallback** — what plays when `prefers-reduced-motion: reduce`,
3. **Keyboard trigger** — how power users invoke it,
4. **Test recipe** — how to verify it didn't drift,
5. **Prototype** — video loop at 60fps showing the animation.

For every haptic:
1. **Pattern JSON** — CoreHaptics `CHHapticPattern` equivalent,
2. **Fallback** — non-haptic feedback (visual flash, sound tap) when haptics disabled.

---

*End of 14-motion-and-haptics.*
