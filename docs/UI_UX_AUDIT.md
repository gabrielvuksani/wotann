# WOTANN UI/UX Audit — Apple Design Award Bar (Phase 10)

Date: 2026-04-19  
Scope: Current shipped code on `main` vs. Apple Design Award quality bar.  
Surfaces audited: Tauri desktop (`desktop-app/src/`), Ink TUI (`src/ui/`),
iOS native (`ios/WOTANN/`).  
Goal: brutally honest assessment; no re-derivation of prior work; concrete
fix list with file:line pointers.

Prior art read in full before drafting:
- `docs/UX_AUDIT_2026-04-17.md` — session 7 UX audit, 149 lines
- `docs/SESSION_8_UX_AUDIT.md` — session 8 UX audit, 547 lines
- `docs/UI_DESIGN_SPEC_2026-04-16.md` — UI/UX design spec, 481 lines
- `docs/UI_PLATFORMS_DEEP_READ_2026-04-18.md` — cross-platform deep read, 844 lines
- `docs/MASTER_AUDIT_2026-04-18.md` — master audit, 298 lines
- `docs/UI_REALITY.md` — Agent E visual archaeology (parent-level), 287 lines

---

## 1. Executive scorecard (1–10 per bar × per surface)

### 1.1 WOTANN today vs Apple Design Award bar

| Bar | Tauri Desktop | Ink TUI | iOS | Best-of-three |
|---|---|---|---|---|
| Typography | 6 | 7 | 7 | 7 |
| Spacing rhythm | 6 | 7 | 7 | 7 |
| Color palette | 7 | 7 | 7 | 7 |
| Motion design | 5 | 4 | 7 | 7 |
| Loading states | 7 | 6 | 7 | 7 |
| Empty states | 6 | 6 | 7 | 7 |
| Error states | 5 | 5 | 7 | 7 |
| Haptics | n/a | n/a | 8 | 8 |
| Responsive density | 6 | 8 | 7 | 8 |
| Glass / depth | 6 | n/a | 8 | 8 |
| Block-based units | 0 (primitive shipped, not consumed) | 0 | 0 | 0 |
| Keyboard parity | 7 | 9 | 5 | 9 |
| Voice / VoiceOver | 6 | n/a | 8 | 8 |
| Dynamic Type / scaling | 4 | n/a (terminal resize only) | 6 | 6 |
| Design-token unification | 3 (two schemes, inconsistent adoption) | 2 (separate Ink colors) | 3 (third scheme) | 3 |
| Brand identity (Norse thread) | 5 | 4 | 3 | 5 |

**Composite WOTANN score (unweighted mean of best-of-three): 6.5 / 10.**  
Apple Design Award floor: ~8.5. Gap of ~2 points — closeable in 4–6 focused
weeks of UI-polish work if distributed correctly (see §8 fix list).

### 1.2 WOTANN vs. 10 named competitors (current shipped surfaces only)

Per-bar scores, lower is worse. WOTANN is the first column. Columns sorted by
conventional Apple-ADA perceived bar.

| Bar | WOTANN | Glass | Superhuman | Linear | Raycast | Things 3 | Arc | Cursor 3 | Claude Code TUI | Codex | Zed | Conductor |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Typography | 7 | 9 | 9 | 9 | 9 | 10 | 9 | 8 | 7 | 6 | 8 | 7 |
| Spacing rhythm | 7 | 8 | 9 | 9 | 9 | 10 | 9 | 7 | 6 | 6 | 8 | 8 |
| Color palette | 7 | 9 | 8 | 8 | 8 | 9 | 8 | 7 | 6 | 5 | 7 | 8 |
| Motion design | 7 | 9 | 9 | 8 | 8 | 9 | 10 | 6 | 4 | 3 | 6 | 8 |
| Loading states | 7 | 9 | 9 | 8 | 8 | 9 | 8 | 7 | 4 | 4 | 7 | 7 |
| Empty states | 7 | 8 | 9 | 9 | 7 | 9 | 8 | 6 | 4 | 3 | 6 | 7 |
| Error states | 7 | 8 | 8 | 9 | 7 | 8 | 7 | 6 | 6 | 5 | 7 | 7 |
| Haptics (iOS) | 8 | n/a | 9 | n/a | n/a | 10 | n/a | n/a | n/a | n/a | n/a | n/a |
| Responsive density | 8 | 5 | 7 | 7 | 6 | 8 | 7 | 9 | 9 | 9 | 9 | 7 |
| Glass / depth | 6 | 10 | 5 | 5 | 6 | 6 | 7 | 4 | n/a | n/a | 4 | 9 |
| Block-based | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 3 | 2 | 0 | 0 | 0 (linear) |
| Keyboard parity | 9 | 3 | 8 | 9 | 10 | 7 | 6 | 7 | 10 | 7 | 9 | 5 |
| **Composite** | **6.7** | **7.7** | **8.2** | **8.1** | **7.8** | **8.5** | **7.6** | **6.3** | **5.5** | **4.8** | **6.7** | **7.2** |

Reading: WOTANN ties Zed in composite, beats Cursor 3/Claude Code TUI/Codex,
trails the Apple-ADA tier (Glass, Superhuman, Linear, Raycast, Things 3) by
1.0–1.5 points. The fastest ways to cross that gap are **Glass fidelity up to
9/10**, **block-based chat consumption up from 0 to 6**, **design-token
unification up from 3 to 9**, and **motion from 5→8 on desktop**.

### 1.3 Per-surface verdict

| Surface | Score | One-line verdict |
|---|---|---|
| Tauri desktop | 6.2 | Apple-flavoured dark base, partial Liquid Glass, unconsumed Block primitive, purple still in the palette despite anti-pattern rule |
| Ink TUI | 6.8 | Most keyboard-dense of any AI harness, but no Cmd-K palette, no inline-diff review flow, no runtime cost ticker in status bar (only totals) |
| iOS | 7.0 | 4-tab shell is strong; `.ultraThinMaterial` used in 4 sites only; strong A11y primitives but 243 hardcoded font sizes block Dynamic Type |

---

## 2. Prior-work summary — what was already concluded

| Doc | Key conclusions | Current status |
|---|---|---|
| `UX_AUDIT_2026-04-17.md` (session 7) | 2 bug clusters fixed inline: engine-disconnect (3 compounding bugs) + provider/model picker lies (4 root causes). Listed CHAT/SET/PAL/IOS findings plus 5 session-9 top items. | Bugs fixed in code (see `desktop-app/src-tauri/src/sidecar.rs`, `desktop-app/src-tauri/src/commands.rs`). Editor view ErrorBoundary (CHAT-1) status: re-verified; need runtime reproduction. |
| `SESSION_8_UX_AUDIT.md` | 11 HIGH + 18 MEDIUM findings across Tauri + iOS. Top 10 prioritized: TD-3.1 4-tab pills, TD-7.1 palette grouping, TD-1.1 banner copy, iOS-1.1 truncation, CP-1 brand parity, TD-5.0 backdrop blur, TD-9.1 workshop tabs, iOS-3.1 consolidate 27 views, TD-8.1 Cmd+3/+4, CP-3 first-run tour. | TD-3.1 **FIXED** (`Header.tsx:24-29` ships 4 pills). TD-8.1 **FIXED** (session-10 Cmd+3/⌘4). TD-5.0 **PARTIAL** (backdrop-filter exists but no blur on Settings scrim confirmed). Rest: **OPEN**. |
| `UI_DESIGN_SPEC_2026-04-16.md` | Aspirational spec: 5 themes (mimir/yggdrasil/runestone/bifrost/valkyrie), 7 signature interactions (Runering, Huginn/Muninn twin-raven, Sealed Scroll, Capability Chips, Raven's Flight, Sigil Stamp, Council), 3 layout innovations, 10 micro-interactions, 5 onboarding hooks, sound design, mobile/watch/widgets/CarPlay IA, a11y floor, anti-patterns. | `wotann-tokens.css` shipped with all 5 themes (230 lines). `Runering.tsx`, `CapabilityChips.tsx`, `SealedScroll.tsx`, `Well.tsx`, `ValknutSpinner.tsx`, `WotannThemePicker.tsx`, `Block.tsx` **all exist** — but **adoption is 11/131 desktop-app files** (8.4%). Huginn/Muninn, Braids, Conversation Braids, Raven's Flight, Sigil Stamp, Council mode still **unshipped as UI**. |
| `UI_PLATFORMS_DEEP_READ_2026-04-18.md` | Every Tauri integration is real (104 commands, 7.5k LOC Rust). iOS is 93–95% production-grade. TUI's 16 Ink components all mounted. 6 honest stubs, no silent failures. | **Still accurate.** Code hasn't regressed. |
| `MASTER_AUDIT_2026-04-18.md` § "Where WOTANN lags" | (a) OS-level sandbox missing. (b) Liquid Glass: "zero backdrop-filter usage in WOTANN CSS" — **obsolete claim**; 29 backdrop-filter occurrences today across 11 TSX + heavy use in globals.css. (c) Block-based terminal unshipped. (d) Warp-style agent-first TUI unshipped. (e) Collaborative cursors unshipped. (f) 3 separate design systems. | Claim (b) **fixed** (Liquid Glass is shipped). Claim (f) **still true** — see §5. Claim (c) **partial** (primitive exists, not consumed). Claims (d) and (e) **still true**. |
| `UI_REALITY.md` (Agent E visual archaeology) | Composite score 6.0/10 on Tauri. Typography 6, Spacing 6, Color 7, Motion 5, Affordance 6. 10 concrete polish gaps named. Overall ranking: WOTANN sits "below Claude Code TUI / Zed and above no one in the panel." | **All gaps still open** except Header's top-pill fix for 4 spaces (shipped). |

### 2.1 Deltas since last audit (2026-04-18 → 2026-04-19)

- No new UI commits since the prior audit — the git log shows infrastructure
  commits (prompt cache, telemetry, self-healing, etc.) but zero
  `feat(desktop/ui)` or `feat(ios/ui)` commits in the last 24 hours.
- The only relevant change: Agent E (parent-level) captured `UI_REALITY.md`
  on 2026-04-19, confirming the Apr-18 master-audit claims.
- **Nothing listed in prior audits' "top fixes" has shipped between 2026-04-18
  and 2026-04-19.** This audit therefore re-prioritises and sharpens the same
  backlog.

---

## 3. Liquid Glass audit — shipped? yes, partially; scope & remaining work

**Prior master-audit claim**: "zero backdrop-filter usage in WOTANN CSS."  
**Current reality**: that claim is stale. `backdrop-filter` lands in **29
locations across 11 desktop-app files** plus iOS `.ultraThinMaterial` in 4
call-sites. Detail below.

### 3.1 Desktop (Tauri) — what's shipped

**CSS base** (`desktop-app/src/styles/globals.css`):
- Line 441: `.bg-glass` utility class: `backdrop-filter: blur(20px) saturate(1.4)`.
- Lines 661–663: `@keyframes dialog-backdrop-fade` with `backdrop-filter: blur(0→4px)`.
- Line 726–734: 2 panel-level glass surfaces with `blur(12–16px) saturate(1.3–1.5)`.
- Line 741–742: `blur(8px) saturate(1.1)` — secondary.
- Line 749–750: `blur(20px) saturate(1.5)` — palette.
- Line 812–813: `blur(8px)` — modal backdrop.
- Line 846–847: `blur(20px) saturate(1.4)` — sidebar.
- Line 1337–1338: `.sidebar-container` with `blur(40px) saturate(150%)`.

Per-component inline usage (11 TSX files):
- `components/layout/Header.tsx:59-60` — `blur(40px) saturate(1.5)` at top bar.
- `components/layout/Sidebar.tsx` (via `.sidebar-container`).
- `components/palette/CommandPalette.tsx:2` — heavy blur.
- `components/input/ModelPicker.tsx:1` — dropdown blur.
- `components/shared/OverlayBackdrop.tsx:2` — modal scrim.
- `components/shared/KeyboardShortcutsOverlay.tsx:1`.
- `components/chat/AtReferences.tsx:1`, `ChatView.tsx:1`, `ChatPane.tsx:1`.
- `components/settings/SettingsView.tsx:1` — **but the scrim lacks blur**
  per SESSION_8 TD-5.0, verified still missing.
- `components/notifications/NotificationToast.tsx:88`.

**Verdict**: Liquid Glass is shipped at the chrome level (header / sidebar /
palette / dropdowns / toasts) but **not at the content level** (chat
messages, editor panels, workshop cards). Scrim blur on Settings modal is
still missing.

### 3.2 iOS — what's shipped

Only 4 `.ultraThinMaterial` call sites across ~128 Swift files:
- `DesignSystem/ViewModifiers.swift:30`
- `Views/Shell/MainShell.swift:56` — `.toolbarBackground(.ultraThinMaterial, for: .tabBar)`
- `Views/Input/ChatInputBar.swift:105`
- `Views/Arena/ArenaView.swift:243`

This is the **bare minimum**. iOS 17+ supports `.background(.ultraThinMaterial)`,
`.regularMaterial`, `.thickMaterial`, plus custom `TranslucentView` modifiers.
Glass-app parity requires materials on: every floating pill (FloatingAsk),
every sheet (`AskComposer`, `VoiceInlineSheet`), every card (ProactiveCard,
RecentConversationsStrip), and every detail surface. Currently zero of those
have explicit `.ultraThinMaterial` backings.

### 3.3 Apple-ADA gap (Glass app at 10/10, WOTANN at 6/10)

Apple-ADA-winning glass (per Glass app, Conductor, iOS 17 Control Center) has:
1. **Layered translucency** — two+ layers of glass with different blur
   radii for depth parallax. WOTANN has single-layer.
2. **Noise-grain overlay** — 2% opacity SVG noise on translucent surfaces.
   WOTANN has none.
3. **Animated highlights** — specular sheen sweeping across glass on hover.
   WOTANN has none.
4. **Dynamic tint sampling** — color from underlying content bleeds through
   the glass (`saturate(1.5+)` gets close; `contrast()` helps). WOTANN's
   saturate values (1.3–1.5) are competent; contrast is never applied.
5. **Per-theme glass tokens** — each theme should define its own glass
   opacity / tint / border. `wotann-tokens.css` does NOT include glass tokens
   per theme today; all glass reads from `--glass-bg` in globals.css which
   is theme-agnostic.

### 3.4 Shipping plan (Tier 1)

| # | Task | File | Lift |
|---|---|---|---|
| G1 | Add `--wotann-glass-bg`, `--wotann-glass-stroke`, `--wotann-glass-tint` per theme | `wotann-tokens.css` | 1h |
| G2 | Adopt the tokens in Header / Sidebar / Palette / ModelPicker | `Header.tsx:59`, `Sidebar.tsx`, `CommandPalette.tsx:2`, `ModelPicker.tsx:1` | 2h |
| G3 | Ship scrim blur on Settings modal (TD-5.0 from session-8) | `SettingsView.tsx:1` + Overlay wrapper | 0.5h |
| G4 | Add 2% SVG noise overlay class `.bg-glass-grain` | `globals.css` | 1h |
| G5 | Ship specular-sheen hover on glass chrome (gold at 20% opacity, 380ms sweep) | new CSS keyframes + `.glass-sheen` class | 2h |
| G6 | iOS: wrap all sheets + FloatingAsk in `.background(.ultraThinMaterial)` with 1px `.ultraThinMaterial` stroke | `AskComposer.swift`, `FloatingAsk.swift`, `VoiceInlineSheet.swift`, `ProactiveCardDeck.swift`, `RecentConversationsStrip.swift` | 2h |
| G7 | iOS: replace flat `WTheme.Colors.surface` with `.thinMaterial` backgrounds on all cards | 22 view files | 4h |

Total Liquid Glass shipping: **~12.5 hours** to reach ~9/10 parity.

---

## 4. Block-based TUI / chat audit — primitive exists, **zero adoption**

### 4.1 What shipped

`desktop-app/src/components/wotann/Block.tsx` (327 lines, commit `ebc5726`):
- `Block` component with `command`, `output`, `status`, `duration` props.
- Status: `running | success | error | cancelled` with pulse animation.
- Actions: Copy (clipboard write), Rerun (user callback), Share (user callback).
- `BlockStream` — list renderer with consistent gaps.
- 3px left rule (colored by status) — Warp-style gutter.
- Token-driven colors (`--wotann-rune-cyan`, `--wotann-rune-moss`, `--wotann-rune-blood`).

The component is **production-quality**: a11y `role="group"` + `aria-label`,
keyboard `tabIndex`, selection state, ellipsised command header, scrollable
320px body.

### 4.2 Where it's consumed — NOWHERE

Import graph scan:
- `Block`/`BlockStream` is **not imported** in any component outside
  itself.
- `ChatPane.tsx`, `MessageBubble.tsx`, `ToolCallCard.tsx`,
  `EditorTerminal.tsx`, `TerminalPanel.tsx`, `WorkshopView.tsx`,
  `CodePlayground.tsx` — all render command/output turns **without** Block.
- Ink TUI (`src/ui/App.tsx`, `src/ui/components/ChatView.tsx`) has no
  analogous primitive.

### 4.3 Apple-ADA gap

Warp, Conductor, Fig, Soloterm — the competitive bar — wrap every
command+output turn in a **Block** that can be:
1. Selected with one click (no text-highlight fiddling).
2. Copied (command + output).
3. Shared (permalink / markdown export).
4. Rerun (sends command through engine again).
5. Navigated via keyboard (`j`/`k` or arrow keys).
6. Right-click contextual menu (bookmark, AI-ize, delete from history, etc.).

WOTANN ships primitives 1–3, stubs out 4, has no 5 (`BlockStream` renders but
no active-selection state / keyboard nav), has no 6.

### 4.4 Shipping plan (Tier 1)

| # | Task | File | Lift |
|---|---|---|---|
| B1 | Wire `BlockStream` into `ChatPane.tsx` — every assistant message + tool call becomes a Block | `ChatPane.tsx`, `MessageBubble.tsx`, `ToolCallCard.tsx` | 4h |
| B2 | Wire Blocks into `EditorTerminal.tsx` + `TerminalPanel.tsx` — each shell command is a Block with Rerun | `EditorTerminal.tsx`, `TerminalPanel.tsx` | 3h |
| B3 | Add active-block selection state + keyboard nav (`j`/`k`, arrow keys) to `BlockStream` | `Block.tsx:308-326` | 2h |
| B4 | Right-click contextual menu: Copy / Share / Rerun / Bookmark / Delete / AI-ize | new `BlockContextMenu.tsx` | 3h |
| B5 | OSC 133 parsing in terminal → auto-generates Block boundaries | `EditorTerminal.tsx` | 4h |
| B6 | Ink TUI: port Block as `<Block>` Ink component | `src/ui/components/Block.tsx` (new) | 4h |
| B7 | Ink TUI: wire into ChatView message rendering | `src/ui/components/ChatView.tsx` | 2h |

Total Blocks adoption: **~22 hours** to reach Warp-parity.

---

## 5. Design-token unification — **three schemes still, adoption is partial**

### 5.1 Inventory of token schemes

1. **Ink TUI (`src/ui/themes.ts`)** — 65 themes, flat `ThemeColors` struct
   with 19 keys. No shared type with web/iOS.
2. **Desktop React — globals.css (`desktop-app/src/styles/globals.css`)** —
   Apple Obsidian Precision palette, ~200 CSS custom properties. 2253 lines.
3. **Desktop React — wotann-tokens.css (`desktop-app/src/styles/wotann-tokens.css`)** —
   5 WOTANN-themed palettes + theme-agnostic motion/radii/typography. 230 lines.
4. **iOS (`ios/WOTANN/DesignSystem/Theme.swift`)** — `WTheme` enum with
   Colors, Typography, Spacing, Radius, Animation, Gradients, Tracking,
   Shadow, Elevation, IconSize, BorderWidth. 247 lines.

### 5.2 Has a single-source-of-truth token file been created?

**No.** Glob searches for `tokens.ts`, `design-tokens.json`, `wotann-tokens.yaml`
all return **zero files**. The spec explicitly called for
`packages/motion/` (referenced by TUI lipgloss equivalents and iOS SwiftUI);
this directory does not exist.

### 5.3 Adoption of `wotann-tokens.css` in the desktop app

- 11 of 131 desktop TSX files reference `var(--wotann-*)` — **8.4% adoption**.
- Every consumer is inside `components/wotann/*` or a session-10 addition
  (FocusView, KeyboardShortcutsOverlay).
- The remaining 91.6% of desktop files still read `--color-primary`,
  `--bg-base`, `--surface-1`, etc. from `globals.css` (Apple Obsidian Precision).
- Net effect: **the Apple-blue Obsidian palette (globals.css) is the de-facto
  active palette**, and the WOTANN Norse palette (wotann-tokens.css) is the
  active palette ONLY for the 7 wotann-branded components.

### 5.4 Anti-pattern rule violations (from UI_DESIGN_SPEC §11)

| Anti-pattern | Rule | WOTANN reality |
|---|---|---|
| "No purple. Not a single shade, anywhere, ever." | Strict. | Ink TUI (`src/ui/themes.ts:55`): `accent: "#a855f7"` (default dark). `src/ui/themes.ts:95,101,110,120,122,127,133,143,149`: 10+ themes include purple as primary or accent. |
| "No emoji in system UI." | Strict. | `src/ui/App.tsx` uses unicode arrows + pipes for `/help` output; no emoji in critical paths — pass. |
| "No gradient avatar rings." | Strict. | `globals.css:128` defines `--gradient-accent: linear-gradient(135deg, #0A84FF, #5AC8FA)` — used as text gradient on brand surfaces, not rings — pass. |
| "No tooltips for discoverable features." | Soft. | Tauri desktop has `title=""` tooltips on every icon button (Header's `aria-label title="Cmd+B"`). This is the correct fallback pattern; pass. |

### 5.5 Shipping plan (Tier 0)

| # | Task | File | Lift |
|---|---|---|---|
| T1 | Create `packages/design-tokens/tokens.yaml` as single source | new file | 2h |
| T2 | Build step: emit `wotann-tokens.css` from YAML | new `scripts/build-tokens.mjs` | 3h |
| T3 | Build step: emit `WOTANNTokens.swift` constants from YAML | same script | 2h |
| T4 | Build step: emit `ink-themes.ts` from YAML (all 65 preserved + 5 WOTANN) | same script | 2h |
| T5 | Replace globals.css's duplicated palette with `@import "./wotann-tokens.css"` and overrides-only | `globals.css` | 3h |
| T6 | Migrate 120 desktop-app files from `--color-*` → `--wotann-*` via codemod | jscodeshift | 4h |
| T7 | Remove purple from Ink TUI themes or flag non-WOTANN themes as "legacy" | `src/ui/themes.ts` | 1h |

Total token unification: **~17 hours** to cross from 3→9.

---

## 6. TUI / GUI / iOS feature parity matrix — Cursor 3 / Claude Code / Codex

### 6.1 Features compared

| Feature | WOTANN TUI | WOTANN Desktop | WOTANN iOS | Cursor 3 | Claude Code TUI | Codex |
|---|---|---|---|---|---|---|
| Command palette (⌘K) | **No** (only slash-command inline autocomplete) | Yes (137 entries) | No (voice input only) | Yes | Yes (`/help`) | Yes |
| Inline diff review | Partial (DiffViewer only mounts with panel) | Yes (InlineDiffPreview, DiffOverlay) | Partial (diff cards in Work) | Yes | Yes | Limited (CLI) |
| Model picker | Yes (`/model` slash) | Yes (dropdown, 137 models) | Yes (picker sheet) | Yes | Yes (`/model`) | Yes |
| Cost ticker | No (only totals, no live per-turn) | Yes (Session + Today) | Yes (widget-ready) | No | Yes | No |
| Session rewind | Partial (`/branch fork`, `/actions fork`) | Yes (fork-at-turn in MessageActions) | No | Yes (in Cursor 3) | Yes (`thread/rollback`) | Yes (`thread/rollback`) |
| Git worktree isolation | No | Yes (`remote_control/mod.rs`, 153 LOC) | No | Yes | Yes | Yes |
| Block-based turns | No | Primitive shipped, not consumed | No | Yes | No | No |
| Keyboard shortcut cheatsheet | No | Yes (`⌘/` overlay — `KeyboardShortcutsOverlay.tsx`) | No | Yes | Yes | No |
| Voice input | Yes (`/voice`) | Yes (composer mic button) | Yes (full screen) | Partial (extension) | No | No |
| Token-limit meter | Yes (ContextHUD 98 LOC) | Yes (StatusBar) | No | Yes | Yes | No |
| Multi-model council | Yes (`/council`) | Yes (CouncilView) | No | No | No | No |
| Per-prompt model override | Yes (`/model per-prompt`) | Yes (ModelPicker) | Yes | No | No | No |
| Focus view collapse | Yes (`/focus`) | Yes (FocusView.tsx) | No | No | Yes (`/focus`) | No |
| Shadow-git auto-commit | Yes (documented) | Yes | No | No | Partial (branch-per-session) | Yes |

### 6.2 Score per-surface vs each competitor (10 scale)

| Feature cluster | WOTANN TUI | WOTANN Desktop | WOTANN iOS | Cursor 3 | Claude Code TUI | Codex |
|---|---|---|---|---|---|---|
| Discoverability (palette, tour, cheatsheet) | 4 (no ⌘K palette) | 7 | 4 | 7 | 9 | 6 |
| Power-user keyboard | 9 | 8 | 5 | 8 | 10 | 7 |
| Inline-review workflow | 5 | 8 | 6 | 8 | 7 | 6 |
| Session control (fork, rewind, branch) | 7 | 8 | 3 | 9 | 9 | 9 |
| Cost transparency | 6 | 8 | 6 | 5 | 7 | 4 |

**WOTANN's TUI biggest hole**: no ⌘K-equivalent command palette. The slash
autocomplete hint (PromptInput.tsx:177-181) shows ONE match below the input
when typing `/`, but there's no overlay list of all 50+ slash commands. Users
must remember or type `/help` for the 40-line ASCII table. This is fixable in
~4 hours by porting Ink's command palette pattern.

**WOTANN's Desktop biggest hole**: no inline review flow for tool calls. Tool
calls render as `ToolCallCard` cards, but an agent that produces a diff plus
a tool call plus an edit doesn't render as a stacked set of Blocks with
per-hunk accept/reject. This is the reason Block.tsx was built but not yet
consumed (§4).

### 6.3 Shipping plan (Tier 1 — parity)

| # | Task | File | Lift |
|---|---|---|---|
| P1 | Ink TUI command palette overlay — ⌃P or backtick to open, fuzzy search 50+ slash commands + theme list + memory topics | `src/ui/components/CommandPalette.tsx` (new) | 6h |
| P2 | Ink TUI: MRU surfacing in the palette | same file | 1h |
| P3 | Ink TUI: per-turn cost ticker in StatusBar | `src/ui/components/StatusBar.tsx` | 1h |
| P4 | iOS: session rewind sheet accessible from MessageContextMenu | `ios/WOTANN/Views/Chat/MessageContextMenu.swift` | 3h |
| P5 | Desktop: per-hunk diff review UI (blocks-aware) | consume `Block.tsx`, extend `InlineDiffPreview.tsx` | 4h |
| P6 | Keyboard cheatsheet on iOS (slide-in sheet from MainShell) | new `ios/WOTANN/Views/Shell/KeyboardSheet.swift` | 2h |

Total parity push: **~17 hours** to close the delta to Cursor-3/Claude-Code.

---

## 7. Accessibility checklist

### 7.1 Tauri desktop

| Criterion | Coverage | Evidence |
|---|---|---|
| ARIA roles on interactive | **High** | 524 `aria-*|role=|tabIndex` occurrences across 118 files (grep-count). |
| Focus rings | **Present** | `--wotann-focus-ring` token (`wotann-tokens.css:58`). Default browser focus ring on `button`, `input`, `[tabIndex]`. |
| Reduced motion | **Partial** | `wotann-tokens.css:218-229` zero out durations under `prefers-reduced-motion: reduce`. `globals.css` has no equivalent guard on its animations — motion will keep running. |
| Keyboard-first nav | **Strong** | 16+ shortcuts including ⌘1–⌘4 tabs, ⌘K palette, ⌘N new, ⌘P file-search, ⌘/ shortcut overlay, ⌘J/⌘` terminal, ⌘Shift+E/M/A/D/F, Escape. |
| Screen reader | **Moderate** | No `sr-only` utility class in globals.css; `aria-label` used on icon buttons (Header.tsx line 66+). Notifications have `aria-live`? Check needed. |
| Tabular numerals on cost | **Strong** | `globals.css:477-480` — `.mono-numbers, .statusbar, [role="meter"], [aria-label*="cost"], [aria-label*="token"] { font-variant-numeric: tabular-nums }`. |
| Color-contrast 7:1 | **Partial** | wotann-tokens.css claims 7.1:1 for Mimir; globals.css Apple-blue text (`#F5F5F7` on `#000000`) is 21:1 — excellent. Muted `#86868B` on `#000` is 5.35:1 — **FAILS WCAG AA body text at 4.5:1 but fails 7:1**. |
| Min tap target 44pt | **n/a desktop** | |
| Skip-to-content | **Unverified** | Not grep-found in sidebar. |

### 7.2 iOS

| Criterion | Coverage | Evidence |
|---|---|---|
| VoiceOver labels | **Strong** | 149 `accessibilityLabel|accessibilityHint|wotannAccessible` occurrences across 43 Swift files. `A11y.swift` defines reusable `wotannAccessible(label:hint:)` modifier. |
| Reduced motion | **Excellent** | `A11y.swift:43-51` provides `respectsReduceMotion(spring:value:)` that swaps springs for `.easeInOut(0.2)` on `prefers-reduced-motion: reduce`. |
| Min tap target 44pt | **Strong** | `A11y.swift:56-75` `hitTarget(onTap:)` enforces 44pt minimum + Rectangle `contentShape`. |
| Haptic feedback | **Strong** | 137 haptic call-sites across 39 files. `HapticService.swift` + `Haptics.swift`. |
| Dynamic Type | **Weak** | 146 references to `accessibility*/dynamicTypeSize/minimumScaleFactor/ScaledMetric` — but the iOS-3.2 finding from session-8 said "243 hardcoded font sizes, no Dynamic Type support." `Theme.swift:70-88` introduces fixed `Font.system(size: 17, weight: .regular)` helpers that **don't scale** with user's text-size setting. The new Obsidian Precision font tokens are fixed-pt, not Dynamic-Type. **Regression** from Apple HIG. |
| Smart Invert safe | Unverified | Need manual audit of all color-coded status chips. |
| Light/Dark mode | **Present** | `WTheme.Colors.border` uses `Color.adaptive(light: 0xE2E8F0, dark: 0x3A3A3C)` — only 1 adaptive call-site out of ~40 colors. Everything else is dark-only hex. |

### 7.3 Ink TUI

| Criterion | Coverage | Evidence |
|---|---|---|
| Keyboard-first | **Excellent** | Only mouse-free harness in the peer set. |
| Screen reader | **N/A** | Ink runs inside a terminal emulator — relies on terminal's own screen-reader support. |
| Color contrast | **Variable** | 65 themes; several (high-contrast, monochrome) explicitly ADA-compliant. Default uses purple/blue on `#1e1e2e` — need ratio-check per theme. |
| Reduced motion | **None** | No motion animation in TUI except StreamingIndicator pulse — minimal impact. |

### 7.4 A11y fix plan

| # | Task | Surface | Lift |
|---|---|---|---|
| A1 | Fix muted text ratio: `--color-text-muted` from `#86868B` to `#A8A8AD` (7.0:1) | desktop globals.css:50 | 5min |
| A2 | Add `prefers-reduced-motion` guards to all animations in globals.css | globals.css | 1h |
| A3 | Switch iOS font tokens to `Font.system(size: ..., relativeTo: .body)` so they scale with Dynamic Type | `Theme.swift:70-88` | 2h |
| A4 | Replace hardcoded `Font.system(size: N)` call-sites (session-8 found 243) with DynamicFont equivalents | codemod across 243 sites | 4h |
| A5 | Add `sr-only` utility class + skip-to-content link in AppShell | `globals.css`, `AppShell.tsx` | 1h |
| A6 | `aria-live="polite"` on toast region | `NotificationToast.tsx` | 0.25h |
| A7 | iOS: expand `Color.adaptive` adoption to all ~40 color tokens | `Theme.swift` | 1h |
| A8 | Verify VoiceOver reading order in FloatingAsk/AskComposer | manual test | 1h |

Total a11y work: **~10 hours** to reach Apple-HIG parity.

---

## 8. Concrete fix list — ranked by impact × effort

### Tier 0 — Unblock Apple-ADA candidacy (must-do)

| # | Task | Impact | Effort | File:line |
|---|---|---|---|---|
| 0.1 | Unify design tokens to single YAML + build script emitting CSS/Swift/Ink | 10 | 17h | new `packages/design-tokens/tokens.yaml` + `scripts/build-tokens.mjs` |
| 0.2 | Migrate desktop-app from `--color-*` (globals.css) to `--wotann-*` (wotann-tokens.css) via codemod | 10 | 4h | 120 files |
| 0.3 | Ship iOS Dynamic Type — replace fixed-pt Font.system with relativeTo-scaled equivalents | 8 | 6h | `Theme.swift:70-88` + 243 call-sites |
| 0.4 | Eliminate purple from Ink TUI themes.ts or flag non-WOTANN themes as "legacy" | 6 | 1h | `src/ui/themes.ts:55,95,101,110,...` |

Tier 0 total: **28 hours**. Fixes 4 systemic issues blocking "unified brand."

### Tier 1 — Differentiators vs competitors (should-do)

| # | Task | Impact | Effort | File:line |
|---|---|---|---|---|
| 1.1 | Wire `BlockStream` into ChatPane / MessageBubble / ToolCallCard — every turn becomes a Block | 10 | 4h | `desktop-app/src/components/chat/ChatPane.tsx`, `MessageBubble.tsx`, `ToolCallCard.tsx` |
| 1.2 | Wire Blocks into EditorTerminal + TerminalPanel with OSC 133 parsing | 9 | 7h | `desktop-app/src/components/editor/EditorTerminal.tsx`, `layout/TerminalPanel.tsx` |
| 1.3 | Ink TUI command palette overlay (⌃P / backtick) | 9 | 7h | `src/ui/components/CommandPalette.tsx` (new) |
| 1.4 | Complete Liquid Glass: per-theme glass tokens + noise-grain + specular sheen | 8 | 6h | `wotann-tokens.css`, `globals.css` |
| 1.5 | iOS: wrap FloatingAsk + all sheets in `.ultraThinMaterial` | 7 | 2h | `AskComposer.swift`, `FloatingAsk.swift`, `VoiceInlineSheet.swift` |
| 1.6 | Block-level keyboard nav (j/k, arrow keys, right-click menu) | 8 | 5h | `Block.tsx:308-326` + new `BlockContextMenu.tsx` |
| 1.7 | Ink TUI: Block-based rendering for tool calls and shell output | 7 | 6h | `src/ui/components/Block.tsx` (new) + `ChatView.tsx` |
| 1.8 | Huginn/Muninn twin-raven split pane — signature interaction from spec §4.2 | 8 | 8h | new `TwinRavenView.tsx` + shortcut `⌘⇧2` |
| 1.9 | Per-turn live cost ticker in all three StatusBar/HUD surfaces | 7 | 3h | `src/ui/components/StatusBar.tsx`, `desktop-app/src/components/layout/StatusBar.tsx`, `ios/WOTANN/Views/Home/Sections/StatusRibbon.swift` |
| 1.10 | Sealed Scroll Proof Bundle — spec §4.3 (already in component library, wire onTaskComplete) | 8 | 3h | `SealedScroll.tsx` + `MessageBubble.tsx` |

Tier 1 total: **51 hours**. Closes motion/empty/error/block gaps.

### Tier 2 — Polish (nice-to-have for ADA bar)

| # | Task | Impact | Effort | File:line |
|---|---|---|---|---|
| 2.1 | Runestone theme preview in Appearance settings — live | 5 | 3h | `WotannThemePicker.tsx` + `SettingsView.tsx` |
| 2.2 | Sigil Stamp shadow-git auto-commit animation | 6 | 4h | spec §4.6 — new `SigilStamp.tsx` |
| 2.3 | Ember session-end animation | 5 | 2h | spec §6 item 10 — on window close |
| 2.4 | Settings search bar across 16 sections (TD-5.0.1 from session-8) | 7 | 3h | `SettingsView.tsx` |
| 2.5 | Rune-forge thinking indicator replace three-dot spinner everywhere | 6 | 4h | 40 `animate-spin` sites → `ValknutSpinner` or new `RuneForge` |
| 2.6 | Conversation Braids — `⌘⇧B` opens 2–4 thread canvas (spec §5.2) | 9 | 12h | new `BraidView.tsx` |
| 2.7 | The Well — shadow-git timeline scrubber ribbon (spec §5.3) | 8 | 8h | `Well.tsx` (exists!) + timeline panel |
| 2.8 | Capability Chips on every assistant message (spec §4.4, CapabilityChips.tsx exists) | 7 | 3h | wire into `MessageBubble.tsx` |
| 2.9 | Mead-Hall morphing command palette (spec §5.1) | 9 | 16h | extend `CommandPalette.tsx` |
| 2.10 | Raven's Flight iOS↔desktop sync animation (spec §4.5) | 5 | 4h | new `RavenFlight.tsx` + iOS equivalent |
| 2.11 | First-run Well of Mimir onboarding (spec §7.1) | 8 | 6h | replace current Welcome step |
| 2.12 | Bind `?` key to keyboard-cheatsheet overlay | 4 | 0.25h | `useShortcuts.ts` |
| 2.13 | iOS consolidate 27 views to 4-tab IA (session-8 iOS-3.1, now MainShell has 4 tabs — needs Agent view mapping) | 6 | 4h | Agents / Autopilot / Dispatch / TaskMonitor consolidation |

Tier 2 total: **69 hours**. Closes "delightful/distinctive" gap to Glass/Superhuman.

### Tier 3 — Cleanups (tax debt)

| # | Task | Impact | Effort | File:line |
|---|---|---|---|---|
| 3.1 | Remove or update `Header.tsx:5-11` stale comment contradicting the code | 3 | 5min | `Header.tsx:5-11` |
| 3.2 | Deprecate `ModePicker.tsx` (Chat/Build/Autopilot/Compare/Review — obsolete 5-mode picker) or wire into current 4-tab IA | 5 | 3h | `ModePicker.tsx` |
| 3.3 | Drop the 40 unused `animate-spin` sites in favor of `ValknutSpinner` | 4 | 2h | 40 files |
| 3.4 | Restore "all running locally on your machine" copy in Welcome subtitle | 4 | 10min | `ChatView.tsx:134` |
| 3.5 | iOS-1.1: fix truncated "Scan or disc…" stepper label in PairingView | 5 | 20min | `ios/WOTANN/Views/Pairing/PairingView.swift` |
| 3.6 | Lower Engine-disconnected banner severity (amber + icon, TD-1.1 from session-8) | 6 | 0.5h | `desktop-app/src/components/layout/AppShell.tsx` banner |
| 3.7 | "Run diagnostics" secondary link in reconnect flow (TD-6.2) | 4 | 0.5h | same location |
| 3.8 | Active-tab treatment: bold weight + accent underline (from UI_REALITY.md gap 1) | 7 | 1h | `Header.tsx:96-107` (approx) |
| 3.9 | Logo-to-heading gap: 16→24px (UI_REALITY.md gap 3) | 3 | 10min | `ChatView.tsx` welcome screen |

Tier 3 total: **~8 hours**. Tax-debt cleanups.

### Tier summary

| Tier | Hours | Net score-lift | Purpose |
|---|---|---|---|
| 0 | 28 | +1.0 to design-token adoption; +0.5 a11y | Unblock "is this one unified product" question |
| 1 | 51 | +1.5 Apple-ADA composite | Ship the Norse/Glass/Block moats named in the spec |
| 2 | 69 | +1.0 Apple-ADA composite | Convert good → delightful |
| 3 | 8 | +0.5 a11y/polish | Tax-debt sweep |
| **Total** | **156** | **+4.0** | Target: 6.5 → 10.5 composite. Realistic ceiling ~9.5 (ADA floor). |

At 30h/week (one focused engineer), this is **5 weeks of polish**. At 50h/week
(two engineers pair-programming), it's **~3 weeks**.

---

## 9. Findings summary (top 25 ranked)

1. **Design tokens unification** — three schemes (Ink `themes.ts`, desktop
   `globals.css`, desktop `wotann-tokens.css`, iOS `Theme.swift`), no single
   source of truth. Adoption of WOTANN tokens is 8.4% in the desktop app.
   **Root cause of all brand-inconsistency findings.**
2. **Block primitive unshipped** — `Block.tsx` (327 lines, production-quality)
   exists but is imported only by itself. Every chat message, tool call,
   terminal command still renders as free text.
3. **Ink TUI has no ⌘K command palette** — only a single-match slash
   autocomplete hint (PromptInput.tsx:177-181). Users must type `/help` to
   discover 50+ commands.
4. **iOS Dynamic Type regression** — new Obsidian Precision font tokens
   (`Theme.swift:70-88`) use `Font.system(size: N, weight: ..., design: ...)`
   without `relativeTo:`, breaking text-size accessibility for 243+ call-sites.
5. **Purple not purged from Ink themes** — `src/ui/themes.ts` default dark has
   `accent: "#a855f7"`; 10+ additional themes use purple as primary. Violates
   spec §11 rule 1 ("No purple. Not a single shade, anywhere, ever.").
6. **Glass fidelity at 6/10** — shipped as single-layer translucency; missing
   per-theme glass tokens, noise-grain overlay, specular sheen, dynamic tint.
7. **iOS material coverage is 4/128 files** — `.ultraThinMaterial` only on
   MainShell tabBar, ViewModifiers, ChatInputBar, ArenaView. Every sheet
   (AskComposer, VoiceInlineSheet) ships flat.
8. **Muted text fails 7:1 contrast** — `--color-text-muted: #86868B` on black
   is 5.35:1 — passes WCAG AA (4.5:1) but fails the spec's 7:1 floor.
9. **Active-tab treatment too subtle** — `Header.tsx` uses `accent-muted` tint
   only; Linear/Raycast add bold weight + accent underline. Mentioned in
   UI_REALITY.md but not fixed.
10. **Stale/contradictory comment in Header.tsx:5-11** — says 4-tab header is
    eliminated, but lines 24-29 declare the 4-tab VIEW_PILLS array. A past
    session deleted and re-added but never updated the doc comment.
11. **Per-turn cost ticker missing** — StatusBar shows session/today totals
    but not per-turn or running-during-stream.
12. **Signature interactions not wired** — Huginn/Muninn, Raven's Flight,
    Sigil Stamp, Conversation Braids, Capability Chips (component exists!),
    Sealed Scroll (component exists!), Ember, Mead-Hall, Well scrubber (Well
    exists!) — all **spec'd, half-built as primitives, zero-consumption**.
13. **No first-run tour on any platform** — CP-3 from session-8, still open.
14. **"Run diagnostics" link missing in reconnect flow** — TD-6.2 from
    session-8.
15. **Engine-disconnect banner copy technical + red severity** — TD-1.1 from
    session-8; unchanged.
16. **iOS PairingView truncates "Scan or disc…"** — iOS-1.1 from session-8;
    unchanged.
17. **iOS AES-256-GCM footer is scare-text on first-run** — iOS-1.2 from
    session-8; move to trust chip.
18. **Settings has 16 sections, no search** — TD-5.0.1 from session-8.
19. **Settings scrim lacks blur** — TD-5.0 from session-8; globals.css has
    blur utility but the Settings overlay doesn't use it.
20. **No prefers-reduced-motion guards in globals.css animations** — only
    wotann-tokens.css zeroes motion; globals.css keyframes (logoBreathe,
    dialog-backdrop-fade) run regardless.
21. **ModePicker.tsx is dead** — still imports old 5-mode (Chat/Build/Autopilot/
    Compare/Review) scheme; secondary mode picker is confusing alongside
    primary 4-tab nav.
22. **Cost-preview on PromptInput isn't hooked to live token-count stream**.
23. **No `?`-key cheatsheet overlay** — 20-min fix that massively boosts
    keyboard discoverability.
24. **Runic font declared but never used** — `--wotann-font-rune` token in
    CSS, zero call-sites. Brand thread missed for single accent use.
25. **40+ `animate-spin` sites still use default CSS spinner** — only
    ConnectorsGUI has been swapped to `ValknutSpinner`; the signature spinner
    has 1 exposure surface vs. 40 possible.

---

## 10. Three "shipping would redefine the app" recommendations

If the team had **2 weeks** to move from 6.7→9.5, the highest ROI set is:

1. **Design-token unification (Tier 0, 28h)** — one YAML, three emitters.
   After this: purple is gone, brand is unified, the Norse identity is the
   product-wide truth, not an isolated 11-file thread. Emotional lift: the
   app stops feeling like three products stitched together.

2. **Block-based rendering across desktop chat + terminal (Tier 1 items 1.1,
   1.2, 1.6, 1.7 — 22h)** — every assistant turn becomes a copyable,
   rerunnable, bookmarkable, keyboard-navigable unit. This is the Warp/Fig
   moat, the primitive we already built but never wired.

3. **Signature interactions from the spec (Tier 1 item 1.8 Huginn/Muninn,
   Tier 2 items 2.6 Braids, 2.7 Well scrubber, 2.8 Capability Chips, 2.4
   Settings search — 42h)** — these are what make the app **delightful**,
   not just competent. Huginn/Muninn and Braids are unmatched in the
   competitor set (no other AI harness has parallel-model-as-critic or
   multi-thread canvas as first-class UI).

Total: **92 hours**. That is the 2-week blitz.

---

## 11. What DOES land at Apple-ADA quality today

Not everything is behind. These five things are at or above the bar:

1. **Typography system** — Inter Variable + JetBrains Mono Variable + SF Pro
   fallbacks + feature-set (`cv01`, `cv02`, `ss03`, `tnum`) is correct and
   premium. Missing only variable-weight transitions on hover.
2. **Onboarding flow on desktop** — 5-step Welcome → System → Engine →
   Providers → Ready with progress bar is 7/10 polish, competitive with
   Superhuman's onboarding.
3. **iOS A11y primitives** — `wotannAccessible`, `respectsReduceMotion`,
   `hitTarget` helpers in A11y.swift (100 lines) are exemplary. Every iOS
   app should copy this file.
4. **Haptic palette on iOS** — 137 call-sites across 39 files, with explicit
   types for `pairingSuccess`, task completion, etc.
5. **Keyboard shortcut density** — 16 bindings on desktop + 50+ slash
   commands in TUI put WOTANN at or above Raycast for power users. The
   remaining gap is discoverability (no palette in TUI, no cheatsheet on
   iOS).

---

## References (absolute paths)

- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/styles/wotann-tokens.css` — 5-theme design tokens, 230 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/styles/globals.css` — Apple Obsidian Precision palette, 2253 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/wotann/Block.tsx` — Warp-style Block primitive, 327 lines (unconsumed)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/layout/Header.tsx` — 4-tab header (stale doc comment at lines 5-11)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/palette/CommandPalette.tsx` — ⌘K palette, 1235 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/chat/ChatView.tsx` — Chat + Welcome, 492 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/App.tsx` — Ink TUI root, 2979 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/themes.ts` — 65 Ink themes (contains purple)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/components/PromptInput.tsx` — Slash autocomplete (no palette), 212 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/DesignSystem/Theme.swift` — iOS WTheme, 247 lines (Apple-blue scheme, fixed-pt fonts)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/DesignSystem/A11y.swift` — iOS a11y helpers, 100 lines (exemplary)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/Views/Shell/MainShell.swift` — 4-tab shell + FloatingAsk, 134 lines
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` — canonical UI/UX spec, 481 lines

---

*End of UI_UX_AUDIT — 2026-04-19.*
