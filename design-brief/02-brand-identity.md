# 02 — Brand identity

## Name

**WOTANN** — the Germanic All-Father. God of wisdom, war, poetry, magic, and the runes. Source: `wotann/CLAUDE.md`. Product URL: `wotann.com`. Config directory: `.wotann/`. URL scheme: `wotann://`.

WOTANN is pronounced to rhyme with "lot on" — stress on the first syllable. Not "oh-TAHN." Not "VO-tan." The `W` is silent-ish / a soft `V`, the way English speakers naturally pronounce it without Germanicising.

## The two-name rule

| Layer | Style | Audience |
|---|---|---|
| **User-facing** | Clear English | End users in UI, docs, marketing |
| **Internal code** | Norse-themed | Developers, system prompts, tracing |

### User-facing names (clear English — no jargon)

From `wotann/CLAUDE.md` §"User-Facing Feature Names":

| Feature | User-facing name | CLI |
|---|---|---|
| Send task phone → desktop | **Relay** | `wotann relay` |
| Local agent tasks | **Workshop** | `wotann workshop` |
| Agent-crafted outputs | **Creations** | — |
| Side-by-side code editing | **Editor** | — |
| Model comparison | **Compare** | `wotann compare` |
| Multi-model review | **Review** | `wotann review` |
| Connect devices | **Link** | `wotann link` |
| Screen control | **Desktop Control** | — |
| Agent builds / creates | **Build** | `wotann build` |
| Background task executors | **Workers** | — |
| Autonomous execution | **Autopilot** | `wotann autopilot` |
| Always-on daemon | **Engine** | `wotann engine` |
| Phone ↔ desktop connection | **Bridge** | — |
| Prompt improvement | **Enhance** | `wotann enhance` |
| Reusable capabilities | **Skills** | `wotann skills` |
| Behavioural safeguards | **Guards** | — |
| Persistent knowledge | **Memory** | `wotann memory` |
| Cost prediction | **Cost Preview** | `wotann cost` |
| Voice input | **Voice** | `wotann voice` |
| Scheduled tasks | **Schedule** | `wotann schedule` |
| Channel messaging | **Channels** | `wotann channels` |

### Internal code names (Norse-themed — NOT shown to users)

- `WotannRuntime` (composition root in `src/core/runtime.ts`)
- `WotannEngine` (the always-on daemon)
- `KairosDaemon` (internal reference in architecture docs)
- `MimirStore` (memory — from Mimir's Well of wisdom)
- `HuginnBuffer` (thought buffer — Huginn = "thought")
- `MuninnCache` (memory cache — Muninn = "memory")
- `ValknutSpinner` (existing React component — the triple-triangle Norse symbol)
- `RuneForge` (a new thinking indicator we want — see `14-motion-and-haptics.md`)

**Rule**: Norse references appear **in comments, class names, Git commit messages, and architecture docs**. They NEVER appear in UI-facing copy unless they've been promoted into the user-facing names table above. See `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` §11 anti-pattern 8 — "No ghost onboarding text."

## Tone of voice

### Three adjectives

1. **Direct** — "Engine disconnected. Retry?" not "It looks like the engine might be having some trouble right now."
2. **Craftsmanlike** — "Forge a plan" not "Let me generate some ideas." Verbs that imply effort.
3. **Quiet** — No exclamation marks in system UI. No "!" ever on a button. Celebrations are earned.

### Four things the voice does NOT do

- **No emoji in system UI.** Runes, sigils, and alchemical marks yes; 🚀 ✨ 🎉 never. Source: `UI_DESIGN_SPEC_2026-04-16.md` §11 rule 7.
- **No "AI sparkle" language.** "Let our AI help you" is forbidden. Source: same §11.
- **No passive disclaimers.** Not "This feature is experimental." Either ship or hide.
- **No fake politeness.** Not "Sorry, something went wrong." The error names what broke; sorry is implicit.

### Register across surfaces

| Surface | Register |
|---|---|
| TUI | Terse, monospace, technical. Full sentences rare. |
| Desktop | Conversational but disciplined. Verbs first, nouns after. |
| iOS | Warmer — first-time users need a gentler hand; experienced users still get direct. |

## Colour palette (canonical)

From `wotann/desktop-app/src/styles/wotann-tokens.css` (see `15-design-tokens-current.json` for the W3C version). Five themes total:

### Mimir's Well (default dark — "deep cognition")

```
bg.canvas       #07090F   iron-midnight
bg.panel        #0C1118
bg.raised       #111823
bg.overlay      #18212F
surface.stroke  rgba(138,176,224,0.08)

ink.primary     #E8EEF7   bone-ash (21:1 on canvas)
ink.secondary   #9FB1C8
ink.muted       #5F7389

accent.rune     #3E8FD1   wellwater blue (7.1:1 on canvas)
accent.glyph    #7DC4F5
accent.gold     #C9A14A   hearthgold — proof-sealed, premium provider

warn.blood      #C04A3E
success.moss    #4FA37F
```

### Yggdrasil (light — "rooted, daylight")

```
bg.canvas       #F3EFE6   oat-parchment
bg.panel        #ECE5D5
bg.raised       #FFFFFF

ink.primary     #1A1612   bark-ink
ink.secondary   #4A4035

accent.rune     #3B6B3A   mossgreen
accent.glyph    #8A5A2B
accent.gold     #B3882F
```

### Runestone (marketing hero — high-contrast obsidian)

```
bg.canvas       #030508   volcanic
bg.panel        #06090E
surface.stroke  #C9A14A at 14%   hairline gold 0.5px

accent.gold     #E8C268   primary
accent.rune     #8A6A2B
rune labels     1px gold inner stroke + 2px outer glow @ 20%
```

### Bifrost (gradient — onboarding + celebrations ONLY)

```
bg.gradient     linear-gradient(160deg, #1B1230, #3A2B55, #7A3B6C,
                                 #C95C5C, #E8A24A, #F4E6A0)
bg.panel        rgba(27,18,48,0.72) + backdrop-filter blur(24px) saturate(1.2)
accent.prism    conic-gradient(from 210deg, #5EC8F0, #9B6BF0, #F06BA0,
                               #F0B85E, #6BF0B5, #5EC8F0)
```

Rule: **Bifrost is NEVER a sustained work surface.** Only first-run, major version upgrade, "quest complete" celebration.

### Valkyrie (battle-ready — Exploit tab ONLY)

```
bg.canvas       #0A0808
bg.panel        #141010
accent.blood    #D13A2A
accent.steel    #8FA0AE
accent.warn     #E8A344
critical        2px blood inner glow + 8px blur @ rgba(209,58,42,0.45)
```

Rule: **Valkyrie auto-activates when the user enters the Exploit tab. Never in Chat or Editor.**

## Typography stack

From `wotann-tokens.css:52-55`:

```
--font-sans:    "Inter Variable", "SF Pro Text", system-ui
--font-mono:    "JetBrains Mono Variable", "SF Mono", ui-monospace
--font-display: "Geist Sans", "Inter Variable"
--font-rune:    "Noto Sans Runic", "Segoe UI Symbol"
```

**Size scale**: 11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32 / 48 / 64 px.
**Weights**: 400 / 500 / 600. No 700 except display + rune.
**Leading**: 1.0 display, 1.35 body, 1.5 long-form.
**Tracking**: -0.02em display, -0.011em body, 0 mono, +0.08em ALL-CAPS labels.
**Features**: `cv11`, `ss03` (Inter), tabular-nums on data cells (cost, tokens, context).

The **Runic font** (`--font-rune`) is declared but today **not used anywhere** (audit finding `UI_UX_AUDIT.md` §9 item 24). Claude Design must find 1-3 discrete places to use it — e.g., the `ᚨ` glyph in the command-palette placeholder, a single accent on the logo wordmark, or the status-ribbon during Council Mode. Never decorative spam.

## The brand mark — the W logo

- Current: a purple-gradient "W" glyph with a soft inner glow. Source: `ios/WOTANN/DesignSystem/WLogo.swift` + `desktop-app/src/assets/logo.svg` (not shown in screenshots).
- The gradient is **2-stop** today. Audit finding (`UI_REALITY.md` §scorecard "Color" gap 7): upgrade to **4-stop** (Linear/Superhuman-class), keep the W silhouette.
- In **Mimir theme**: purple → violet gradient.
- In **Runestone**: gold foil on black — a single stroke, 1px inner gold bevel.
- In **Bifrost**: prism conic-gradient (spec-fed).
- In **Valkyrie**: red-tinted W with a 2px blood inner glow.

The W is not a capital W alone — it has a slight Norse runic undertone (subtle angular bends in the serifs). Do not cross it with a rune explicitly; the W + the wordmark "WOTANN" is the mark.

## Iconography

**Never emoji in system UI.** Use:

1. **Runes** (Elder Futhark) — `ᚨ` Ansuz (messenger), `ᚱ` Raidho (journey, running state), `ᚲ` Kenaz (discovery, insight), `ᚷ` Gebo (gift, handoff), `ᚠ` Fehu (wealth, cost), `ᛉ` Algiz (protection, guard), `ᛏ` Tiwaz (victory, seal complete), `ᛒ` Berkano (growth, new), `ᛗ` Mannaz (human — the user), `ᛟ` Othala (ancestry, memory).
2. **Alchemical sigils** — `🜂` fire (vision), `🜃` earth (thinking), `🜄` air (tools), `🜁` water (memory).
3. **Custom SVG** for all 24 Elder Futhark glyphs + 8 alchemical sigils as single-path SVGs, 18×18 viewport, `currentColor` stroke.

Specified in `UI_DESIGN_SPEC_2026-04-16.md` §13 — assets expected at `apps/desktop/src/assets/runes/`. They do not yet exist (audit finding).

## Brand thread across surfaces

The Norse identity must land the same way on every surface but at different volume levels:

- **TUI (loud)** — the `ᚨ` glyph in the palette placeholder, the `ᚱ` rune pulsing during streaming, the `ᛏ` rune on task-complete.
- **Desktop (medium)** — the W logo + the Runestone theme as marketing hero + Council Mode uses runic dividers.
- **iOS (subtle)** — WLogo on first-launch + MainShell tab-bar separator gets a faint gold hairline + MorningBriefing's card has a Runestone-textured background. No runes in the default UI; they surface in Settings > Appearance where the user can opt in.

**Rule**: Never cosplay. Never kitsch. Think Dieter Rams' Braun catalog meets the Lewis Chessmen meets Bloomberg Terminal. Not "World of Warcraft UI."

---

*End of 02-brand-identity.*
