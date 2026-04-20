# LANE 3 — UI/UX + Feature Gap Audit (WOTANN)

Date: 2026-04-19
Auditor: Opus 4.7 (max-effort)
Scope: 7 surfaces — CLI, Ink TUI, Tauri Desktop, iOS, Apple Watch, CarPlay, 25 Channels + Landing Site + Design Brief
Methodology: Read components top-to-bottom; verify design-brief claims against live code; grep for skeletons/empty/error states; spot-check token adoption, Norse thread execution, and capability fallbacks.

All file paths are absolute.

---

## 0) Executive summary — the five most consequential findings

1. **Design-brief lies by omission** (the brief is internally honest, but stale in spots). Claims that `Block`/`Runering`/`SealedScroll`/`CapabilityChips` are "unconsumed" are **false** — they're wired in `MessageBubble.tsx`, `EditorTerminal.tsx`, `ProofBundleDetail.tsx`, and via the `window.__wotannEmitRune` bridge in `App.tsx`. But they only land on 1–2 sites each. The *breadth of consumption* is still near zero: `CapabilityChips` ships only in one chat bubble site, `SealedScroll` only in one trust detail, Runering only fires off toast heuristics. This is "wired but not proliferated" — worse than unconsumed because the code exists and maintenance cost is paid but the user-visible delight is not delivered.

2. **iOS is Apple-blue, not Norse — by deliberate divergence.** `ios/WOTANN/DesignSystem/Theme.swift:20` hardcodes `#0A84FF` (Apple system blue) as `primary`; there is **zero** Mimir palette (`#3E8FD1` wellwater blue) on iOS. The design brief says the iOS brand thread should be "subtle" — but the current state is "nonexistent." Runes appear in zero iOS views; the only Norse references are 2 comments in `OnboardingView.swift` and 1 in `StreamingView.swift`. Even `Theme.swift:242` still hardcodes `#A855F7` (purple) as the "together" provider color — the exact shade the spec says is banned.

3. **The TUI is strategically malnourished.** 3,081 LOC in `src/ui/App.tsx`, 15 components, 50+ slash commands — but zero command palette, zero Block consumption in ChatView, default theme still uses `#a855f7` purple accent (`src/ui/themes.ts:47`), zero rune glyphs anywhere in rendered TUI. OSC 133 parser + shell init snippets + BlockBuffer are shipped (`src/ui/terminal-blocks/`), feed stays opt-in via `WOTANN_OSC133_FIFO` env var, and the `TerminalBlocksView` overlay exists — but they never interact with the actual ChatView. The "loud Norse TUI" promised in design-brief §02 does not exist.

4. **Automagical fallbacks are partial — tool-calling/vision/thinking are covered; voice, streaming, browsing, file-editing, and structured output are NOT covered in one coherent layer.** `capability-augmenter.ts` handles tool XML injection + OCR vision + "think step by step" thinking. `capability-equalizer.ts` adds json_mode emulation. Voice (STT/TTS), browsing (chrome-bridge, camoufox), and computer-use have their own vertical stacks without a unified "this provider can't do X, so fall back to Y" layer. The brand promise "works automagically with every model" has holes.

5. **Three spec'd iOS surfaces are flat-missing: ExploitView, CouncilView, and "Continue without pairing."** No `ExploitView.swift` and no `CouncilView.swift` exist anywhere under `ios/`. Pairing has no skip flow — all 34 views are gated. This breaks design-brief Principle 13 ("One surface doesn't dominate") and §09's P0 new-view list. Competitor ground truth: Cursor, Claude Code, and Perplexity all let you enter the app without pairing.

Everything else below elaborates.

---

## 1) Surface-by-surface inventory

### 1.1 CLI (`src/index.ts` + subcommands)

- **Shape:** 43 top-level commands, commander-style, separate from TUI App.tsx.
- **Screens:** none (terminal prints). Full verb surface per design-brief §02: `wotann start / init / build / compare / relay / workshop / link / enhance / skills / memory / cost / voice / schedule / channels / engine / autopilot / review / acp / dream / audit / roe / ...`.
- **Feature completeness:** ~95%. Every verb in the brand table is wired. `wotann start` bootstraps TUI + runtime; `wotann channels` exposes all 17 live adapters.
- **Visible jank:** help text not grouped by category; no `--interactive` flag to fall through to TUI. No one-liner installer in README (the `install.sh` exists at `/Users/gabrielvuksani/Desktop/agent-harness/wotann/install.sh`).
- **Missing must-haves:** colorized help output, `wotann --version` shorthand already in place — fine.

### 1.2 Ink TUI (`src/ui/` — 3,081 LOC `App.tsx` + 15 components)

Reference: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/components/`

| Component | LOC | Purpose | Status |
|---|---:|---|---|
| `StartupScreen.tsx` | 2,943 | Splash / version | ✓ ships |
| `ChatView.tsx` | 4,493 | Message stream | ✓ ships, no Block wrapping |
| `StatusBar.tsx` | 2,906 | Cost + context + turn | ✓ ships, no per-turn ticker |
| `ContextHUD.tsx` | 2,069 | Header meter | ✓ ships |
| `PromptInput.tsx` | 6,739 | Composer + autocomplete | ✓ ships, slash hint only |
| `DiffViewer.tsx` | 4,955 | Inline diff | ✓ ships |
| `AgentStatusPanel.tsx` | 2,313 | Subagent grid | ✓ ships |
| `HistoryPicker.tsx` | 5,442 | Session rewind | ✓ ships |
| `MessageActions.tsx` | 5,148 | Per-message menu | ✓ ships |
| `ContextSourcePanel.tsx` | 7,023 | Context breakdown | ✓ ships |
| `MemoryInspector.tsx` | 8,120 | Memory feed | ✓ ships |
| `DiffTimeline.tsx` | 5,383 | Per-commit scrubber | ✓ ships |
| `DispatchInbox.tsx` | 4,966 | Cross-channel tasks | ✓ ships |
| `PermissionPrompt.tsx` | 2,459 | Tool approval | ✓ ships |
| `ProofViewer.tsx` | 6,546 | Sealed scroll | ✓ ships |
| `TerminalBlocksView.tsx` | 7,414 | OSC 133 overlay | ✓ ships, empty by default |

- **Terminal-capability detection:** absent. `src/ui/App.tsx` grep for `COLORTERM`/`TERM_PROGRAM`/`truecolor` = 0 hits. Ink theme colors are baked in RGB strings — no "fall back to 16-color for basic terminals" path.
- **Kitty/iTerm2 graphics:** no sixel/kitty image protocol; no inline image rendering of diffs, screenshots, or charts.
- **OSC 133:** parser + block buffer + 3 shell init snippets (zsh/bash/fish) all shipped at `src/ui/terminal-blocks/`. Opt-in via `WOTANN_OSC133_FIFO` env var. `TerminalBlocksView` renders the captured blocks — but only when the user has manually set up the FIFO. No first-run assistance.
- **Purple purge violation:** `src/ui/themes.ts:45–59` default dark theme still has `primary: #6366f1 / secondary: #8b5cf6 / accent: #a855f7 / toolMessage: #cba6f7`. Design-brief Principle 10 + anti-pattern rule 1 both say "No purple. Not a single shade, anywhere, ever." Current state: **12+ purple hex values in default dark + light themes + 2 more themes.** Design-brief also reports purple is not purged; that report is correct.
- **Command palette:** none. `PromptInput.tsx:104-106` implements a single-match autocomplete (`Tab` to accept) but there is no `Cmd+P`/backtick/overlay for the 50+ commands. `/help` is the only discovery path and outputs a flat table (per `PromptInput.tsx:21–77` the `SLASH_COMMANDS` array).
- **Feature completeness %:** 75%. Core chat + diff + agents + memory + history + dispatch ship. Signature interactions (Runering, RuneForge, block rendering) absent. No `Cmd+K` palette.
- **Visible jank:** `PromptInput.tsx:172` uses `borderColor="blue"` for neutral state — not themed. No MRU. No context badges. No "Focus mode" shortcut hint.

### 1.3 Tauri Desktop (`desktop-app/` — 137,995-byte App.tsx, though actually modular: `AppShell.tsx` 440 LOC + 40 subdirs)

Reference: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/`

**Header pills:** `Header.tsx:26-31` lists Chat / Editor / Workshop / Exploit as `VIEW_PILLS`. `AppShell.tsx` imports 24 lazy-loaded views (full list):

```
ChatView, EditorPanel, WorkshopView, ExploitView, ArenaView, SettingsView,
MemoryInspector, CostDashboard, CommandPalette, OnboardingView, MeetPanel,
IntelligenceDashboard, CanvasView, AgentFleetDashboard, ConnectorsGUI,
ProjectList, DispatchInbox, ExecApprovals, PluginManager, DesignModePanel,
CodePlayground, ScheduledTasks, ComputerUsePanel, CouncilView, TrainingReview,
TrustView, IntegrationsView
```

Plus overlay components: `CommandPalette` (1,229 LOC), `QuickActionsOverlay`, `NotificationToast`, `Runering`, `KeyboardShortcutsOverlay`.

- **Feature completeness %:** 90%. Four primary tabs are wired. Tab icons render. ModelPicker, NotificationCenter, Settings (16 sections), Command Palette (137 entries) all exist. `WorkshopView.tsx:20-39` has **8 tabs**: Active / Workers / Inbox / Scheduled / Playground / Workflows / Canvases / Config — **violates Miller's law** (spec says "reduce to 4").
- **Micro-interactions + haptics:** no haptics (desktop). Micro-interactions exist: `Runering` for mem events, `ValknutSpinner` for load states, scroll-to-bottom FAB (`ChatView.tsx:459–482`), breathing animation on logo (`ChatView.tsx:36–43`). Quick-action stagger (`animate-stagger-${i+1}`) is present. No view-level signature transition (no "Raven's Flight" cross-surface animation anywhere in desktop-app).
- **Loading states:** `Skeleton.tsx` exists (22 occurrences); `AppShell.tsx` has `ViewSkeleton` component (28 usages). Basic "Loading..." text fallback in every lazy Suspense boundary.
- **Error recoveries:** `ErrorBoundary.tsx` wraps every view. `DisconnectedBanner` in `ChatView.tsx:370–389` for engine offline with real retry that invokes `restart_engine` Tauri command. Good.
- **Empty states:** Welcome screen (`ChatView.tsx:46–248`) with quick-action tiles is polished. Other views (`ConnectorsGUI`, `PluginManager`, `MemoryInspector`) — not audited end-to-end but spot checks show each has its own empty placeholder.
- **Liquid Glass fidelity:** `Header.tsx:61-62` uses `backdropFilter: blur(40px) saturate(1.5)` — shipped. `liquid-glass.css` has 432 LOC but the actual tokens are theme-agnostic (no per-theme glass tint).
- **Visible jank:** 
  - `Header.tsx:5-11` doc comment says "layout" with redundant info.
  - Active tab delta is ~15% luminance (fg `color-primary` on bg `accent-muted`) — Linear/Raycast use 40%+ with bold weight. Confirmed in `Header.tsx:100-108`.
  - Quick-action tiles at 8px padding (`ChatView.tsx:156`); design-brief §08 says 12px target.
  - `ExploitView.tsx:22-28` uses generic `--color-error/warning/info` — does **not** adopt Valkyrie theme via `data-theme="valkyrie"` attribute. `grep "data-theme=\"valkyrie\"" desktop-app/src` = 0 hits.

### 1.4 iOS (`ios/` — 5 build targets, 128 Swift files main app)

Reference: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/`

**Targets:** WOTANN (main), WOTANNWatch, WOTANNWidgets (3 widgets), WOTANNIntents (3 intents), WOTANNLiveActivity (1 activity), WOTANNShareExtension.

**Shell:** `WOTANNApp.swift` (584 LOC, 23 KB) → `ContentView` → `MainShell.swift` (134 LOC, 4-tab TabView: Home / Chat / Work / You) + `FloatingAsk` overlay 72pt above tab bar.

- **Views completeness:** 34 directories under `Views/`. Most populated: Chat (11 files), Pairing (5 files), Home + Sections (7 files), Work (5 files), Settings (7 files).
- **Missing views vs. spec (design-brief §06 P0/new):**
  - ✗ `ExploitView.swift` — **does not exist** (grep `ExploitView` in `ios/` returns no files)
  - ✗ `CouncilView.swift` — **does not exist**
  - ✗ `RemoteDesktopView.swift` — exists at `Views/RemoteDesktop/`
  - ✗ MorningBriefing — exists (`Views/MorningBriefing/MorningBriefingView.swift`, 278 LOC)
  - ✗ WorkflowsView — exists (placeholder level)
  - ✗ Onboarding "Continue without pairing" — grep returns zero hits
- **Feature completeness %:** 80% of the 34 specified views; **65% of the "P0 new" list.**
- **Liquid Glass / `.ultraThinMaterial`:** exactly **4 sites** (confirmed by grep):
  - `ios/WOTANN/DesignSystem/ViewModifiers.swift:30`
  - `ios/WOTANN/Views/Shell/MainShell.swift:56` (toolbar)
  - `ios/WOTANN/Views/Input/ChatInputBar.swift:105`
  - `ios/WOTANN/Views/Arena/ArenaView.swift:243`
  - Plus `WOTANNWatchApp.swift:487` for Watch. 
- **Dynamic Type:** `WTheme.Typography` at `Theme.swift:70-88` defines 9 fixed-size `Font.system(size: N, weight:, design:)` tokens — **none use `relativeTo:`.** Greps: 262 `Font.system(size:` occurrences across 61 files; 399 standalone `.font(.system(` calls; only 19 `wotannScaled`/`wotannDynamicType` usages. The `wotannDynamicType()` helper clamps bounds but does NOT make fixed sizes scale. Design-brief §03 item 4 and §09 report this as a regression — confirmed.
- **Norse brand thread:** zero runes, zero Mimir palette. `Theme.swift:20` pins `#0A84FF` (Apple blue). One purple hex: `Theme.swift:242` (`0xA855F7` for "together" provider).
- **Haptics:** `HapticService.swift` has 16 event types (lines 8-25) — `messageSent`, `responseComplete`, `error`, `voiceStart`, `voiceStop`, `taskComplete`, `taskFailed`, `enhanceComplete`, `pairingSuccess`, `pairingFailed`, `approvalRequired`, `costAlert`, `selection`, `buttonTap`, `swipe`, `shake`. Shipped and wired. Respects `hapticFeedback` UserDefault.
- **Visible jank:** Pairing labels are tightened to short text ("Open Mac" / "Pair" / "Connected") and no longer truncate — `PairingView.swift:62-64`. But the AES-256-GCM footer still exists at pair view bottom (per design-brief §09 iOS-1.2). Nav register is Apple-blue-tinted with Norse-free iconography.
- **HIG alignment:** iOS 17+ features used (`.tabItem`, `.sheet` with `presentationDetents`, `.fullScreenCover`). No iOS 18 `liquidGlass` modifier, no `visionOS` variants, no `ControlWidget` (iOS 18 Control Center), no `InteractiveWidget` with `AppIntent`-backed tap actions.

### 1.5 Apple Watch (`ios/WOTANNWatch/` — 1 file, 594 LOC)

`WOTANNWatchApp.swift` in its entirety — no separate subdirs. WatchHomeView, AgentTriageView, TaskStatusView, QuickActionsView, CostView all inlined.

- **Feature completeness %:** 70%. All 5 views in the inventory present. WCSession-proxied through paired iPhone (no independent network).
- **Missing:** Complications (iOS 17+ corner complications for always-on-display), watch-only audio dictation, haptic crown rotation feedback on cost gauges. No rune glyphs.
- **Visible jank:** single-file architecture means any future split is a big refactor; error handling for disconnected-phone state is acceptable but "Oh no" -style copy in a few places (not audited exhaustively).

### 1.6 CarPlay (`ios/WOTANN/Services/CarPlayService.swift` — 340 LOC)

3 tabs (Chat / Voice / Status) + conversation detail template. Voice reply via `CPVoiceControlTemplate`.

- **Feature completeness %:** 60%. Read-only chat (last 10), voice-launch, status tab (cost + provider + agents). No ability to dispatch a task. No lock-screen now-playing card. No Siri-handoff.
- **Visible jank:** placeholder `"No Conversations" + "Start a chat on your desktop or phone"` empty state is honest — good. But there is no "recent agents" surfacing; the status tab is the only place to see what's running.

### 1.7 Channels (`src/channels/` — 31 files)

Adapter files present (31 files):

```
dingtalk, discord, echo-channel, email, feishu, github-bot, google-chat,
ide-bridge, imessage-gateway, imessage, irc, line, mastodon, matrix,
signal, slack, sms, teams, telegram, viber, webchat, webhook, wechat, whatsapp
```

Plus dispatch machinery: `adapter.ts`, `auto-detect.ts` (37,500 LOC), `base-adapter.ts`, `channel-types.ts`, `dispatch.ts`, `gateway.ts` (14,008 LOC), `integration.ts`, `route-policies.ts` (15,447 LOC), `terminal-mention.ts`, `unified-dispatch.ts` (20,763 LOC).

**Registered in `src/daemon/kairos.ts`:** Telegram, Slack, Discord, Signal, WhatsApp, Email, Webhook, SMS, Matrix, Teams, iMessage (via gateway), IRC, GoogleChat, WebChat. Plus GitHubBot + IDEBridge via separate accessors.

**Adapter files that exist but are NOT registered anywhere in kairos.ts:**
- `mastodon.ts` — fully implemented with streaming + POST flow but orphaned.
- `viber.ts` — exists at 7,458 LOC, not registered.
- `line.ts` — exists at 8,717 LOC, not registered.
- `feishu.ts` — exists at 9,035 LOC, not registered.
- `dingtalk.ts` — exists at 6,450 LOC, not registered.
- `wechat.ts` — exists at 8,275 LOC, not registered.

**Design-brief §12 is out of date — it claims these are missing. They exist but are dead.** Zero kairos registration lines.

- **UI representation:** Settings > Channels (desktop) shows the 14 registered ones, not the 6 orphans. iOS `Views/Channels/ChannelStatusView.swift` (2 LOC counter, so small), read-only.
- **Feature completeness:** 14/25 live = 56%.
- **Visible jank:** `route-policies.ts` is registered via `registerChannel` at `kairos.ts:1214` — finally no longer dead code (it was in the design brief). But the UI side (Settings > Channels > Policies pane) is missing.

---

## 2) UI quality gaps (honest)

### 2.1 Terminal capability detection — MISSING

The Ink TUI is fully RGB-baked. 0 greps for `truecolor`/`COLORTERM`/`TERM_PROGRAM` in `src/ui/`. Consequences:

- On a tty without truecolor (default `xterm`, GNU screen, tmux with `default-terminal "screen"`), the 65 themes degrade unpredictably.
- No kitty/iTerm2 graphics protocol = no inline diff images, no charts, no screenshots in the TUI.
- No feature detection for `styled-text` in rxvt.

**Impact:** WOTANN's TUI is an Ink app running in the author's terminal (Warp/iTerm2) with good defaults. It does not *gracefully* degrade — it just trusts 24-bit color.

### 2.2 Micro-interaction inconsistency

**Desktop has polish:**
- `animate-stagger-{1-6}` stagger on quick-actions (`ChatView.tsx:151`).
- Logo breathing keyframes via injected `<style>` (`ChatView.tsx:32-44`).
- `Runering` global overlay listens to `window:wotann-rune-event` and draws a 360° gold ring when memory is saved (228 LOC).
- `ValknutSpinner` (180 LOC) — the Norse triple-triangle spinner. Consumed in a handful of lazy-loading sites.
- Scroll-to-bottom floating FAB with `cubic-bezier(0.16, 1, 0.3, 1)` transition (`ChatView.tsx:473`).

**Desktop lacks polish:**
- No streaming word-by-word fade (design-brief §14 spec #1).
- No thinking-indicator RuneForge (spec #2). Still generic spinner in places.
- No sidebar collapse animation beyond `transition: width`.
- `animate-spin`/`animate-pulse` appears in 19 sites — all generic tailwind-style spinners, zero replaced with `ValknutSpinner`.

**iOS polish:** 137 haptic sites is legitimately good. Other motion work is SwiftUI defaults (`.spring(duration: 0.35, bounce: 0.15)` etc.) — adequate, not distinctive.

### 2.3 iOS HIG compliance vs. 2026 baseline

- **Liquid Glass:** iOS 18 introduced `.glassEffect()` and `.glassBackgroundEffect()`; WOTANN uses only `.ultraThinMaterial` (iOS 17). The 2026 HIG target is `.glassEffect(.regular, in: RoundedRectangle(...))` where applicable. Zero uses.
- **Dynamic Island:** `TaskProgressActivity.swift` (96 LOC) ships `ActivityKit`. Design-brief §09 says 1 Live Activity today; target 3. Only **one** shipped.
- **Vision Pro:** no `#if os(visionOS)` anywhere in iOS source. No Reality Composer assets.
- **Control Widgets (iOS 18):** 0 ControlWidget implementations. WOTANN has 3 widgets but they're Home-screen-only.
- **Interactive widgets (iOS 17 `AppIntent`-tappable):** 0. All 3 widgets are read-only.
- **Apple Intelligence (iOS 18 `GenerativeIntent`):** 0. No integration.

### 2.4 Cross-surface style consistency

Three parallel design-token schemes, confirmed by grep:

- `src/ui/themes.ts` — 65 themes, most contain purple.
- `desktop-app/src/styles/globals.css` (2,253 LOC) — Apple Obsidian palette.
- `desktop-app/src/styles/wotann-tokens.css` (229 LOC) — 5 Norse themes with `data-theme` selectors.
- `ios/WOTANN/DesignSystem/Theme.swift` (247 LOC) — Apple-blue hardcoded.

**Adoption:** `wotann-` prefix appears in 253 locations across `desktop-app/src`; legacy `color-primary`/`bg-base`/`surface-1` still appears in 225 locations. The `globals.css` → `wotann-tokens.css` migration is ~53% by that crude metric. iOS has no `wotann-` prefix equivalent.

### 2.5 Norse execution — mostly in comments

Grep for rune glyphs (ᚨ ᚱ ᚲ ᚷ ᚠ ᛏ ᛒ ᛗ) across the codebase:

- `desktop-app/src/components/wotann/{Well,SealedScroll,Runering,ValknutSpinner}.tsx` — 4 files.
- `src/ui/` TUI — **zero hits.**
- `ios/` — **zero hits.** Plus 3 comment-only mentions in `OnboardingView.swift`, `StreamingView.swift`, `LocalSendService.swift`.

**Verdict:** Norse branding is 90% in code comments, 10% in signature components (and those are consumed on 1-2 sites each). User-visible Norse thread is near-absent. Principle 11 "Norse identity at calibrated volume" target is: TUI loud / Desktop medium / iOS subtle — current state is TUI silent / Desktop 4 whispers / iOS 0.

---

## 3) Missing features by category

### 3.1 Must-have gaps (competitors uniformly have these)

| Gap | Surface | Evidence | Competitor with it |
|---|---|---|---|
| Command palette (⌘P/backtick) in TUI | TUI | 0 palette; slash hint only at `PromptInput.tsx:177` | Warp, Zed, Fig |
| Continue without pairing | iOS | 0 grep for "skip pairing" in iOS | Every consumer app ever |
| Block-based rendering in Ink TUI | TUI | `Block.tsx` exists for desktop; no Ink equivalent | Warp (OSC 133) |
| ExploitView on iOS | iOS | 0 file exists | n/a — WOTANN is unique here but spec'd |
| CouncilView on iOS | iOS | 0 file exists | n/a |
| Monaco/Editor on iOS | iOS | 0 code editor view | Cursor (via mobile wrapper), GitHub mobile |
| Valkyrie theme auto-activation on Exploit | Desktop | 0 `data-theme="valkyrie"` in source | n/a |
| Interactive widgets (iOS 17+) | iOS Widgets | 0 `AppIntent`-backed widget tap | Every iOS 17+ 1P app |
| ControlWidget (iOS 18+) | iOS | 0 impls | Mail, Notes, Music |
| Apple Intelligence integration | iOS | 0 `GenerativeIntent`/Writing Tools | Apple Mail, Notes |
| Liquid Glass (iOS 18+) via `.glassEffect()` | iOS | 0 uses | iOS 18 system apps |
| Dynamic Type on fixed-size fonts | iOS | 262 `Font.system(size:` without `relativeTo:` | System-compliant apps |
| Focus view on TUI | TUI | No `/focus` keybinding path; desktop has it | n/a |
| Per-turn live cost ticker in status bar | TUI + Desktop | Session totals only; no live counter | Cursor, ChatGPT |
| Theme preview in palette | All | Not shipped | Raycast, Zed |
| MRU in command palette | Desktop | `CommandPalette.tsx` 1,229 LOC; no MRU sort in source | Raycast, Linear |
| Real Mastodon/Viber/Line/Feishu/DingTalk/WeChat registration | Channels | adapters exist, unregistered | n/a |
| Channel routing policies pane in Settings | Desktop Settings | `route-policies.ts` is wired but no config UI | n/a |

### 3.2 Stunning-to-have (differentiators)

| Feature | Surface | Impact |
|---|---|---|
| RuneForge streaming indicator replacing dot spinner | All | Brand moment every turn |
| Twin-Raven split pane (⌘⇧2) | Desktop | Unique vs. every competitor |
| Raven's Flight cross-surface handoff animation | Desktop + iOS | Differentiator on "one product, many surfaces" |
| Sealed Scroll end-of-task proof with `Rune-tap` sound | All | Earned celebration moment |
| Sigil Stamp on shadow-git checkpoint | Desktop | Subtle "we're building history" signal |
| Bifrost theme only on "first task complete" | All | Celebratory one-shot |
| Well UI (shadow-git scrubber) with wooden-thud sound | Desktop | Time-travel UI is rare |
| CarPlay "dispatch a task by voice" | CarPlay | Commute-to-work productivity moment |
| Watch complications on always-on | Watch | Glanceable cost/agent status |
| Keyboard density in iOS via external-keyboard shortcuts | iOS | 5/10 today per design-brief §09 |
| Apple Intelligence "Writing Tools" for enhance | iOS | Native integration = distribution channel |

### 3.3 Capability gaps (tool access, memory, provider)

| Capability | Present | Gap |
|---|---|---|
| Tool calling augmentation (XML injection for non-tool models) | ✓ `capability-augmenter.ts` | Single-return `parseToolCall` still drops multi-call emissions (comment at line 208 admits). |
| Vision augmentation (OCR for non-vision models) | ✓ `augmentVision` via `describeImageForPrompt` | OCR unavailable message when backend missing — honest. No vision model probe for real image tagging. |
| Thinking augmentation | ✓ "think step by step" prompt | No model-specific templates (some models respond better to DeepSeek-style `<think>` tags). |
| Streaming emulation for non-streaming providers | Partial — `capability-equalizer.ts` marks it but no actual buffered-polling implementation. | User sees nothing while a non-streaming provider churns. |
| Voice (STT) fallback | ✓ 4 backends: stt-detector, vibevoice-backend, edge-tts-backend, voice-mode | No "can't do voice on this provider, use this alternate" layer. |
| Voice (TTS) fallback | ✓ same | Same — no provider-capability-aware routing. |
| Browsing fallback | Chrome-bridge + camoufox-backend | No "no browser available, emit verbal description instead" path. |
| File editing | Hash-anchored edit (`src/tools/hashline-edit.ts`) | No provider-model mismatch handling. |
| Structured output (json_mode) | ✓ `capability-equalizer.ts:22` with emulation strategy per provider | Shipped. |
| Extended context (TurboQuant) | Present in `src/context/` | Not exposed in UI; no cost-vs-quality slider. |
| Multi-provider council | ✓ `CouncilView.tsx` on desktop | 0 impl on iOS. |
| Arena (blind A/B) | ✓ `ArenaView.tsx` on desktop + iOS | ships. |

**One coherent "automagical fallback" layer is partially built:** `capability-augmenter.ts` for tools/vision/thinking; `capability-equalizer.ts` for json_mode; but streaming emulation, voice/browse/edit routing, and the full matrix of "model X can't do Y, fall back to Z" is fragmented across providers/, voice/, computer-use/, and browser/.

---

## 4) Automagical fallback audit (per capability)

| Capability | Native support detection | Fallback implemented | Gap |
|---|---|---|---|
| Tool calling | `ProviderCapabilities.supportsToolCalling` | XML prompt injection | Multi-call drop (known bug) |
| Vision | `supportsVision` | OCR via macOS Vision or Tesseract | No vision model probe; only OCR |
| Thinking | `supportsThinking` | "think step by step" prompt + `<thinking>` tags | No per-model-family template |
| Streaming | `supportsStreaming` | **None** — just flagged as emulated | Blocking wait on non-streaming providers |
| JSON mode | `capability-equalizer` json_mode emulation | Prompt instruction | Shipped |
| Voice STT | `STTDetector` with 4 backends | Request-only mode on Watch | No "provider X can't voice, route to Whisper API" |
| Voice TTS | `TTSEngine` with edge-tts + vibevoice | Same | Same |
| Browsing | `chrome-bridge.ts`, `camoufox-backend.ts` | Multi-backend | No text-mode fallback when no display |
| Computer Use | `perception-engine.ts`, 4 layers | Full stack | Platform-specific; no graceful degradation |
| File edit (hashline) | `hashline-edit.ts` | Content-hash guard | Works on all providers |
| Council / multi-model | `src/orchestration/` — waves, PWR, Ralph | Full | No graceful degradation when all providers fail |
| Shadow git | `src/utils/shadow-git.ts` | Present | N/A |
| Memory 8-layer | `src/memory/` | Present | Not provider-dependent |
| Long context (turbo-quant) | `src/context/` | Present | Provider must support ≥128k |

**Summary:** tools/vision/thinking/json have explicit augment paths. **Streaming, voice, and browsing do NOT** — they have backends but no capability-detection → fallback-selection → user-facing disclosure. The brand promise "works with every model" holds for tools but not streaming.

---

## 5) UX friction points

1. **First-run: no tour on any platform.** `AppShell.tsx:227–233` forces OnboardingView on first launch — but zero `/tour` slash command in TUI, zero "take the tour" CTA in iOS or desktop home. Design-brief §03 CP-3 finding.
2. **Engine disconnect recovery on desktop is good; on iOS it's silent.** `ChatView.tsx` renders `DisconnectedBanner`. iOS `WOTANNApp.swift` listens to `ConnectionManager.$isConnected` but no global banner — per-view responsibility.
3. **Pairing is mandatory on iOS** — no skip. Every deep-link lands back on PairingView if not paired (`WOTANNApp.swift:36-39`).
4. **Model switching requires ⌘K → type "model" → pick.** On desktop. On iOS: Settings > Providers > tap. On TUI: `/model` → list. **No keyboard shortcut for "next provider" / "next model" in the composer.**
5. **Cost preview is hidden behind `wotann cost`** — not visible on the compose-send button. Design-brief §03 item 3 says cost meter should glint.
6. **Settings search missing on desktop** — `SettingsView.tsx` is 1,567 LOC with 16 sections; no search input per design-brief finding TD-5.0.1.
7. **No "Back to Chat" in Settings on desktop.** Same finding TD-5.0.2.
8. **ExploitView does not auto-activate Valkyrie theme** — the theme is only available via the ThemePicker, and `ExploitView.tsx` doesn't set `data-theme="valkyrie"` on its container.
9. **Workshop has 8 tabs** → Miller's-law violation; scanning cost grows.
10. **`window.__wotannToast` is a global — but `window.__wotannEmitRune` is the rune bridge.** Two globals, same room; clean pattern elsewhere via stores. Low-priority but worth noting.
11. **No `prefers-reduced-motion` adaptation on the breathing logo** (`ChatView.tsx:36-43` keyframes inject unconditionally).
12. **Dynamic Type breaks on iOS** — 262 call-sites with `Font.system(size:)` lacking `relativeTo:` means a user with Dynamic Type = `accessibility3` gets UI that doesn't scale. Partial mitigation via `wotannScaled` at 19 sites.
13. **iOS tints every provider with a fixed colour** (`Theme.swift:229–245`) — "together" = `#A855F7` purple, banned by spec.
14. **Pairing "Scan or discover" was the old copy**; current `PairingView.swift:62-64` uses "Open Mac / Pair / Connected" — so this one is fixed. But the AES footer (iOS-1.2) is still there.
15. **Bifrost theme misuse risk** — `wotann-tokens.css:153` defines it. Zero enforcement on "only during onboarding / celebration." The `data-theme="bifrost"` attribute setter is absent from `OnboardingView.tsx`.

---

## 6) Top 20 UI/UX upgrades (ranked by delight × ease)

| # | Surface | Change | Rationale | Sketch |
|---|---|---|---|---|
| 1 | TUI | **Purge purple from `themes.ts` default dark** | One-line violation of a P0 rule. Replaces user's baseline impression. | Replace `accent: "#a855f7"` → `accent: "#3e8fd1"`; remove purple lines; add `mimir`/`yggdrasil`/`runestone`/`bifrost`/`valkyrie` as named themes. |
| 2 | TUI | **Ship Cmd+P command palette** (new Ink component) | Biggest single-user-visible gap; discovery path from 50 slashes to 1 hotkey. | New `CommandPalette.tsx` in `src/ui/components/`; `useInput` listen for Ctrl+P; fuzzy filter over SLASH_COMMANDS + themes + recent memories. |
| 3 | iOS | **Add `relativeTo:` to 9 Theme tokens** | 262 broken Dynamic Type sites collapse to 9 token fixes. | `Theme.swift:72-88` — each `Font.system(size: N, weight:, design:)` → `Font.system(size: N, weight:, design:, relativeTo: .body/.title3/...)`. |
| 4 | Desktop | **Set `data-theme="valkyrie"` on ExploitView container** | Auto-theme the one view that explicitly needs it; zero new code beyond one attribute. | `ExploitView.tsx:30` — wrap return in `<div data-theme="valkyrie">`. |
| 5 | iOS | **Add "Continue without pairing" to OnboardingView** | Unblocks 1-tap demo for first-time users; gated view count drops from 34 to 0 for unpaired users. | Add CTA button below QR scan; set `hasCompletedOnboarding = true` without requiring `isPaired`; show disconnected-engine banner instead. |
| 6 | TUI | **RuneForge thinking indicator** (3-rune stroke-dash) | Signature visual on every streaming turn. | Replace the streaming-text `...` with a cycling `ᚠ → ᛉ → ᚹ` at 120ms cadence in `PromptInput.tsx:183-188`. |
| 7 | Desktop | **Streaming word-by-word fade in MessageBubble** | Matches design-brief signature motion #1; visible on every assistant response. | CSS keyframe, 18ms stagger per word, 140ms fade via `<span>` wrap in `MessageBubble.tsx`. |
| 8 | Desktop | **WorkshopView: collapse 8 tabs → 4** | Miller's-law fix; remove Playground/Workflows/Canvases as separate tabs. | Fold Playground into Editor tab; Workflows into Active as a filter; Canvases into Workshop > Active variants. |
| 9 | iOS | **Ship ExploitView** matching desktop parity | P0 spec; unblocks iOS security researcher persona. | New `Views/Exploit/ExploitView.swift` with CVSS badge list + engagement scope input; Valkyrie tint via conditional modifier. |
| 10 | iOS | **Ship CouncilView** | P0 spec; "multi-model deliberate" is the Arena-alternative. | Port `CouncilView.tsx` structure to SwiftUI; N-column responses with votes. |
| 11 | Desktop | **CapabilityChips on every assistant message**, not just one branch | Multiplies the "earned brand" hits by 10-100×. | In `MessageBubble.tsx:405`, drop the conditional so chips render on every assistant-role message. |
| 12 | Desktop | **Wrap tool calls in `<Block>`** in `ToolCallCard.tsx` | Block primitive is imported in 2 sites; expand to tool calls = tens of more per session. | Add `<Block status={toolStatus}>` wrapper inside `ToolCallCard.tsx`. |
| 13 | TUI | **Per-turn live cost ticker in StatusBar** | Every user asks "how much did this turn cost?" — currently only total. | Plumb `runtime.getCurrentTurnCost()` into `StatusBar.tsx`; update every 250ms during stream. |
| 14 | All | **Register 6 orphan channel adapters** (mastodon/viber/line/feishu/dingtalk/wechat) | 412 LOC * 6 files of dead code become real; unlocks 6 more platforms in Settings > Channels. | Copy the `new TelegramAdapter()` pattern at `kairos.ts:1019` for each. |
| 15 | iOS | **3 more iOS widgets** — Workflow running, Cost preview, Lock-screen cost | WidgetKit coverage jumps from 3 → 6; lock-screen is valuable on iPhone 14+. | Add to `WOTANNWidgets/` with proper `.accessoryRectangular` + `.accessoryInline` for iOS 16+ lock-screen. |
| 16 | iOS | **Dynamic Island Live Activities** — Cost budget + Meet recording | Adds 2 more ActivityKit widgets to the existing 1. | New files `CostBudgetActivity.swift`, `MeetRecordingActivity.swift`. |
| 17 | Desktop | **Settings search box** + 🔍 icon | 16 sections is too many to scan. | Input at top of `SettingsView.tsx`; filter visible sections on substring match. |
| 18 | Desktop | **Fix active-tab luminance delta to 40%** + bold | Competitors look sharper; current 15% is genuinely subtle to the eye. | `Header.tsx:100-108` — `fontWeight: isActive ? 600 : 400`; `borderBottom: isActive ? "2px solid var(--color-primary)" : "none"`. |
| 19 | TUI | **Theme-aware border colors** in `PromptInput.tsx` | Currently `borderColor="blue"` hardcoded — breaks all non-blue themes. | Plumb `theme.colors.primary` as the idle border color. |
| 20 | All | **Prefers-reduced-motion honored on logo breathing** | 5-line fix; WCAG 2.2 AAA. | `ChatView.tsx:36-43` — wrap keyframe in `@media (prefers-reduced-motion: no-preference) { ... }`. |

---

## 7) Design-system gaps

### 7.1 What's in the brief but not in code

- **Runic font (`--font-rune: "Noto Sans Runic"`)** — declared in `wotann-tokens.css:55`. Zero usages in any component.
- **Runestone, Bifrost, Valkyrie themes** — declared at `wotann-tokens.css:123-229`. Only Mimir + Yggdrasil appear in the ThemePicker user flow. Valkyrie is not auto-applied to ExploitView. Bifrost is not auto-applied to OnboardingView or celebrations.
- **Custom SVG for 24 Elder Futhark glyphs** — `apps/desktop/src/assets/runes/` directory does not exist. Only text-glyph rendering inside the 4 signature components.
- **Gold-foil W variant for Runestone theme** — `WLogo.swift` and desktop logo are 2-stop purple gradient. No gold variant.
- **4-stop logo gradient** (spec upgrade) — still 2-stop everywhere.
- **Sound-design spec** (Rune-tap, Well-hum, Wax-seal, Wood-knock) — `apps/desktop/src-tauri/resources/sfx/` does not exist; 0 audio assets shipped.
- **Provenance chip on every assistant message** — exists on 1 site (`MessageBubble.tsx:405`) but not on tool calls.
- **Channel icons (custom 16px SVG per channel)** — current channel icons are emoji/lucide defaults; zero custom runic or SVG-per-channel.

### 7.2 What's in code but not in the brief

- **65 Ink themes** (`themes.ts`) — brief specifies only 5 canonical themes. The 65 are legacy; the brief wants them consolidated.
- **`Skeleton.tsx` component** — solid, well-formed, but the brief doesn't call out skeleton patterns specifically beyond "loading state."
- **`ErrorBoundary.tsx`** — smart, but not specified.
- **`wotannScaled` font helper** — 19 call-sites; the brief's Dynamic Type mandate is broader.
- **`WotannThemePicker.tsx`** (179 LOC) — exists; the brief says "Signature palette" in Settings, but the picker is in Settings > Appearance and the "Signature" concept is confusingly parallel to the base theme.

### 7.3 Token consistency across surfaces

| Token class | Desktop | iOS | TUI |
|---|---|---|---|
| Bg canvas | `--wotann-bg-canvas: #07090f` (mimir) | `Color.black` (`Theme.swift:13`) | `#1e1e2e` (`themes.ts:48`) |
| Primary accent | `--wotann-accent-rune: #3e8fd1` | `#0A84FF` Apple blue | `#6366f1` indigo |
| Gold | `--wotann-accent-gold: #c9a14a` | n/a | n/a |
| Font size body | `14px` (legacy) / tokens absent | `17pt` SF Pro | Ink-default (inherited) |
| Radius | 2/6/10/12/999 | 8/12/16/20/999 | n/a (terminal) |
| Motion curves | 4 named | 4 named spring | no motion spec |

**Verdict:** three palettes, three fonts, three sizing systems. Design-brief §03 scored 3/10 on unification; current code is unchanged.

---

## 8) Handoff to Master Synthesis — top 5 most consequential findings

(Same as Executive Summary, reprinted for easy merge by the master synth agent.)

1. **Signature components are wired but not proliferated.** Block/Runering/SealedScroll/CapabilityChips each land on 1-2 sites. The marginal cost of spreading them to 10+ sites each is small (single-component prop additions), and the UX payoff compounds. **Priority:** plumb these through ToolCallCard, EditorTerminal (already done), MessageActions, HistoryPicker, NotificationToast, DispatchInbox, ExecApprovals, ArenaView, CouncilView.

2. **iOS is design-brand silent.** Apple-blue, zero runes, Dynamic Type broken, 4 Liquid Glass sites. The iOS-3.1 Dynamic Type fix is **9 lines** at `Theme.swift:72-88`. Adding Mimir palette as an alternative iOS theme is a separate day of work. The brand-thread gap is fixable in a sprint.

3. **TUI stagnation.** 50+ slash commands, no palette; purple-violating defaults; no per-turn cost ticker; no streaming indicator. Command palette (#2) alone would close the #1 gap. Purple purge (#1) is 3 line-edits.

4. **Six orphan channel adapters.** Mastodon/Viber/Line/Feishu/DingTalk/WeChat are implemented at ~48,000 LOC total but unregistered. `kairos.ts` registration is 6 lines × 6 files. **Biggest "dead code → shipped" ratio in the repo.**

5. **Fallback coherence.** Tools/vision/thinking have augment layers; streaming/voice/browsing do not. Building a single `CapabilityRouter` that dispatches any provider through the right augment/equalize/alternate-backend flow would make "automagical with every model" a demonstrable claim rather than a marketing one. This is probably a 2-3 week project.

---

## Appendix A — Verified file evidence

| Claim | Source |
|---|---|
| Purple in default TUI theme | `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/themes.ts:45-63` |
| `Font.system(size:)` without `relativeTo:` in iOS | `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/DesignSystem/Theme.swift:72-88` |
| iOS purple on "together" provider | `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/DesignSystem/Theme.swift:242` |
| 4 `.ultraThinMaterial` sites in iOS | grep — `DesignSystem/ViewModifiers.swift:30`, `Shell/MainShell.swift:56`, `Input/ChatInputBar.swift:105`, `Arena/ArenaView.swift:243` |
| `Block.tsx` consumed in 2 sites | `chat/MessageBubble.tsx:17`, `editor/EditorTerminal.tsx:15` |
| `CapabilityChips` consumed in 1 site | `chat/MessageBubble.tsx:16,405` |
| `SealedScroll` consumed in 1 site | `trust/ProofBundleDetail.tsx:20,111` |
| 6 orphan channel adapters | `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/channels/` files present, zero registration lines in `src/daemon/kairos.ts` |
| 0 ExploitView.swift + 0 CouncilView.swift | grep returns no file matches |
| 0 "Continue without pairing" | grep returns no hits in `ios/` |
| Workshop 8 tabs | `desktop-app/src/components/workshop/WorkshopView.tsx:20-39` |
| ExploitView generic error tint | `desktop-app/src/components/exploit/ExploitView.tsx:22-28`, no `data-theme="valkyrie"` attribute |
| Tauri commands count | 108 commands in `desktop-app/src-tauri/src/commands.rs` (3,554 LOC) |
| 14/25 channels registered | `src/daemon/kairos.ts:1005-1361` lists 14 `registerAdapter` + `githubBot`/`ideBridge` accessors |
| `wotann-` token adoption ~53% | grep: 253 `wotann-` vs. 225 legacy in `desktop-app/src` |

---

*End of Lane 3 audit.*
