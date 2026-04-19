# 03 — Current design audit (honest assessment)

## Composite scorecard

Source: `wotann/docs/UI_UX_AUDIT.md` §1 and `wotann/docs/UI_REALITY.md` "Design quality scorecard." Date: 2026-04-19.

### Per-surface, per-bar, 1-10

| Bar | Desktop | TUI | iOS | Best-of-three |
|---|:-:|:-:|:-:|:-:|
| Typography | 6 | 7 | 7 | 7 |
| Spacing rhythm | 6 | 7 | 7 | 7 |
| Colour palette | 7 | 7 | 7 | 7 |
| Motion design | **5** | **4** | 7 | 7 |
| Loading states | 7 | 6 | 7 | 7 |
| Empty states | 6 | 6 | 7 | 7 |
| Error states | 5 | 5 | 7 | 7 |
| Haptics | n/a | n/a | 8 | 8 |
| Responsive density | 6 | 8 | 7 | 8 |
| Glass / depth | **6** | n/a | **8** | 8 |
| Block-based units | **0** | **0** | **0** | **0** |
| Keyboard parity | 7 | 9 | 5 | 9 |
| Voice / VoiceOver | 6 | n/a | 8 | 8 |
| Dynamic Type / scaling | 4 | n/a | 6 | 6 |
| Design-token unification | **3** | **2** | **3** | **3** |
| Brand identity (Norse thread) | 5 | 4 | 3 | 5 |

**Composite (unweighted mean of best-of-three): 6.5 / 10.**
**Apple Design Award floor: ~8.5.**
**Gap: 2.0 points.**

### Per-surface composite

| Surface | Score | One-line verdict |
|---|:-:|---|
| Desktop | **6.2** | Apple-flavoured dark base, partial Liquid Glass, unconsumed Block primitive, purple still in Ink palette despite anti-pattern rule |
| TUI | **6.8** | Most keyboard-dense harness in the peer set, but no Cmd-K palette, no inline-diff review flow, no runtime cost ticker in status bar |
| iOS | **7.0** | 4-tab shell is strong; `.ultraThinMaterial` used in only 4 of 128 files; strong a11y primitives but 243 hardcoded font sizes block Dynamic Type |

## Top 12 concrete problems

Ranked by impact × reach. Every item has a file citation.

### 1. Design-token unification is at 3 / 10

Three parallel token schemes:

- `src/ui/themes.ts` — 65 Ink themes (contains purple in 10+ themes, violating anti-pattern rule 1).
- `desktop-app/src/styles/globals.css` — 2,253 lines, Apple Obsidian Precision palette.
- `desktop-app/src/styles/wotann-tokens.css` — 230 lines, 5 Norse themes.
- `ios/WOTANN/DesignSystem/Theme.swift` — 247 lines, Apple-blue scheme.

WOTANN tokens are adopted in only **11 of 131 desktop files** — **8.4%**. The remaining 91.6% still read `--color-primary`, `--bg-base`, etc. from globals.css. **Root cause of all brand-inconsistency findings.** Source: `UI_UX_AUDIT.md` §5.

### 2. Block primitive is unshipped

`desktop-app/src/components/wotann/Block.tsx` (327 lines, production-quality) exists but is **imported only by itself**. Every chat message, tool call, and terminal command still renders as free text. Competitors Warp / Conductor / Fig / Soloterm all have block UIs. Source: `UI_UX_AUDIT.md` §4.

### 3. Ink TUI has no ⌘K command palette

Only a single-match slash autocomplete hint (`src/ui/components/PromptInput.tsx:177-181`) when typing `/`. Users must remember 50+ slash commands or type `/help` for a 40-line ASCII table. Source: `UI_UX_AUDIT.md` §6.2.

### 4. iOS Dynamic Type regression

`ios/WOTANN/DesignSystem/Theme.swift:70-88` uses `Font.system(size: N, weight: ..., design: ...)` without `relativeTo:`. Breaks text-size accessibility across 243+ call-sites. Source: `UI_UX_AUDIT.md` §9 item 4 + `SESSION_8_UX_AUDIT.md` iOS-3.2.

### 5. Purple not purged from Ink themes

`src/ui/themes.ts:55` default dark has `accent: "#a855f7"`. 10+ other themes use purple as primary or accent. Violates `UI_DESIGN_SPEC_2026-04-16.md` §11 anti-pattern rule 1: "No purple. Not a single shade, anywhere, ever." Source: `UI_UX_AUDIT.md` §5.4.

### 6. Liquid Glass is 6 / 10 on desktop, not the 9+ target

Shipped (`backdrop-filter: blur(20px) saturate(1.4)` in 29 desktop locations + 4 iOS `.ultraThinMaterial` sites) but as **single-layer translucency**. Missing:
- Per-theme glass tokens (tokens are theme-agnostic today),
- Noise-grain overlay (2% SVG noise),
- Specular sheen on hover,
- Dynamic tint sampling (`saturate()` is set but `contrast()` is never applied).

Source: `UI_UX_AUDIT.md` §3.3.

### 7. iOS material coverage is 4 / 128 Swift files

`.ultraThinMaterial` appears only in:
- `DesignSystem/ViewModifiers.swift:30`,
- `Views/Shell/MainShell.swift:56` (toolbar background),
- `Views/Input/ChatInputBar.swift:105`,
- `Views/Arena/ArenaView.swift:243`.

Every sheet (`AskComposer`, `VoiceInlineSheet`), every card (`ProactiveCardDeck`, `RecentConversationsStrip`), every detail surface ships flat. Source: `UI_UX_AUDIT.md` §3.2.

### 8. Muted text fails 7:1 contrast on desktop

`--color-text-muted: #86868B` on `#000000` canvas = **5.35:1** — passes WCAG AA (4.5:1) but fails the spec's 7:1 floor. Fix: `#A8A8AD` = 7.0:1 (5-minute change in `globals.css:50`). Source: `UI_UX_AUDIT.md` §7.1.

### 9. Active-tab treatment too subtle

`desktop-app/src/components/layout/Header.tsx:96-107` uses `accent-muted` tint only. Luminance delta between active and inactive tabs is ~15%. Linear / Raycast use ~40% delta + bold weight + accent underline. Source: `UI_REALITY.md` gap 1.

### 10. Stale / contradictory doc comment in Header.tsx

`Header.tsx:5-11` says "The 4-tab header (Chat|Editor|Workshop|Exploit) is eliminated" — then lines 24-29 immediately declare the `VIEW_PILLS` array with exactly those 4 pills. Evidence of churn. Source: `UI_REALITY.md` code-churn evidence.

### 11. Signature interactions are all spec'd + half-built but zero-consumption

From `UI_DESIGN_SPEC_2026-04-16.md` §4, seven signature interactions:

1. **Runering** (`Runering.tsx` exists) — unconsumed.
2. **Huginn / Muninn twin-raven split pane** — spec'd, not built.
3. **Sealed Scroll Proof Bundle** (`SealedScroll.tsx` exists) — unconsumed.
4. **Capability Chips** (`CapabilityChips.tsx` exists) — unconsumed.
5. **Raven's Flight (iOS↔desktop sync)** — not built.
6. **Sigil Stamp (shadow-git auto-commit)** — not built.
7. **Council Mode** (`CouncilView.tsx` exists on desktop) — built but iOS has no view.

Source: `UI_UX_AUDIT.md` §9 item 12.

### 12. Three first-run-tour gaps

- **No tour on any platform** (CP-3 from session-8).
- **No "Continue without pairing" iOS flow** — all 34 iOS views are gated on pairing (IOS-DEEP-1).
- **Welcome subtitle drift** — screenshot says "— all running locally on your machine"; current `ChatView.tsx:134` dropped the `locally` clause. Source: `UI_REALITY.md` gap 1.

## What IS at Apple-ADA quality today

From `UI_UX_AUDIT.md` §11. Preserve these in the redesign:

1. **Typography system** — Inter Variable + JetBrains Mono Variable + SF Pro + feature-set (cv01, cv02, ss03, tnum). Competent and premium.
2. **Desktop onboarding** — 5-step Welcome → System → Engine → Providers → Ready is 7/10, competitive with Superhuman.
3. **iOS a11y primitives** — `wotannAccessible`, `respectsReduceMotion`, `hitTarget` helpers in `ios/WOTANN/DesignSystem/A11y.swift` (100 lines). "Every iOS app should copy this file."
4. **iOS haptic palette** — 137 call-sites across 39 files, with explicit types for `pairingSuccess`, task completion, etc. Source: `HapticService.swift` + `Haptics.swift`.
5. **Keyboard shortcut density** — 16 desktop bindings + 50+ TUI slash commands. At or above Raycast for power users.

## Deltas since prior audits

From `UI_UX_AUDIT.md` §2.1, 2026-04-18 → 2026-04-19:

- No new UI commits in the last 24 hours — the git log shows infrastructure commits (prompt cache, telemetry, self-healing) but zero `feat(desktop/ui)` or `feat(ios/ui)`.
- **Nothing listed in prior audits' "top fixes" has shipped.** This re-prioritises the same backlog.
- Between session-8 (2026-04-17) and now: `TD-3.1 4-tab pills` shipped, `TD-8.1 Cmd+3/Cmd+4` shipped, `TD-5.0 backdrop blur` partial (utility exists, Settings scrim still missing). Other items open.

## Screenshots evidence

30 PNGs in `19-reference-screenshots/` capture the current state. Three generations visible:

- **Generation 1 (Apr 5)** — 4-pill Chat/Build/Autopilot/Compare header, sub-tabs (Chats/Projects/Skills/Workers). **Retired.**
- **Generation 2 (Apr 5 late)** — 5-step onboarding redesign (Welcome → System → Engine → Providers → Ready). **Current.**
- **Generation 3 (Apr 6 23:30+)** — 4-pill Chat/Editor/Workshop/Exploit header, vertical icon sidebar rail, 6-action quick-start grid. **Current.**

Source: `UI_REALITY.md` screenshot inventory table.

## Build health evidence

All four surface builds PASS as of this audit:

| Surface | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Desktop web | `npm run build` | exit 0, 21.5 s, main bundle 614 kB |
| Tauri Rust | `cargo check` | exit 0 |
| iOS | `xcodebuild -scheme WOTANN -sdk iphonesimulator` | `** BUILD SUCCEEDED **` |

Source: `wotann/docs/SURFACE_PARITY_REPORT.md` §3.

The UI problems are **not compilation problems** — they are adoption, polish, and interaction-depth problems. The foundation is solid; the craft layer is thin.

---

*End of 03-current-design-audit.*
