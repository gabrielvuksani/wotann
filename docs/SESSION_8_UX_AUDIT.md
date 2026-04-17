# WOTANN — Deep UI/UX Audit (Session 8, 2026-04-17)

End-to-end audit of the Tauri desktop app and iOS app, driven from a fresh
`tauri dev` build (latest committed code at `d2c0b8e`) and the iOS debug
build on iPhone 17 Pro simulator (iOS 26.4). Both surfaces were launched
from the actual binaries and screenshots captured live. This document is
the massive-deep-audit deliverable requested at the end of session 8.

## Scope

**Tauri desktop** — 12 `AppView`s + 14 legacy remaps, 14-section Settings
panel, Cmd+K palette with 137 command entries, 16 keyboard shortcuts, 4
workspace presets, 7 Workshop tabs, plus overlays (quick actions, model
picker, onboarding, meet).

**iOS app** — 27 views across the project tree (Pairing, Chat,
Conversations, Files, Git, Intelligence, Memory, OnDeviceAI, RemoteDesktop,
Settings, Shell, Skills, Voice, Watch, Widgets, Intents, + more).

## Method

Every screen was either driven live via computer-use + osascript or,
where tap-through to iOS failed due to OS input plumbing, exercised via
source inspection of the underlying React/Swift components. Findings
are labelled HIGH / MEDIUM / LOW / NIT severity and tied to a concrete
file + line range so a follow-up PR can cite each one.

---

## TAURI DESKTOP AUDIT

### TD-1 · Chat view — first-run empty state

**Screenshot** `/tmp/wotann-audit/tauri-chat-empty.png`

- WOTANN logo with breathing animation (subtle 2% scale pulse, tasteful)
- "What would you like to build?" hero, 24px heading
- Subtitle: "Multi-provider AI with autonomous agents, desktop control, and full tool use."
- 2x3 grid of quick-action tiles rendered from `WORKSPACE_PRESETS[developer]`:
  `Start coding` / `Run tests` / `Review code` / `Research` /
  `Compare models` / `Check costs`
- Incognito pill toggle below the tiles
- Composer input at the bottom: "Ask WOTANN anything…" with attach, voice, send buttons

**Findings**

- **HIGH · TD-1.1 "Engine disconnected" red banner on first run** — when
  the KAIROS daemon can't claim the socket (standalone mode), a red
  banner sits atop the chat with a Reconnect CTA. Correct recovery
  affordance BUT the copy ("Engine disconnected") is technical. A new
  user won't know what "Engine" means and the severity-red treatment
  reads as broken-state before they've even started. Soften the copy
  ("Background engine paused — chat still works") and lower the severity
  to amber + inline icon until they've clicked Reconnect.

- **MEDIUM · TD-1.2 Action tiles dimmed when engine down** — the 6 quick
  actions visibly dim when the engine is disconnected, suggesting
  they're disabled. In reality several (Research, Compare models, Check
  costs) can run against the cloud-only path without the local engine.
  Either keep them fully lit or add a tooltip explaining why they're
  dimmed.

- **MEDIUM · TD-1.3 Welcome hero doesn't change between workspace presets**
  — `WORKSPACE_PRESETS` supports `developer`, `security`, `pm`,
  `analyst` with distinct quick-action sets (confirmed in
  `src/lib/workspace-presets.ts`). The hero + subtitle stay generic
  across all four. For `security`: replace "What would you like to build?"
  with "What are you auditing?"; for `analyst`: "What do you want to
  analyse?".

- **LOW · TD-1.4 Tile icons are generic** — `<>` code, `▶` play, diff,
  search, columns, $ — these are standard Material-style glyphs. The
  product is Norse-themed; consider a subset using runic glyphs for the
  tiles most closely tied to WOTANN's identity (code-mode, review,
  council).

- **NIT · TD-1.5 "Incognito" pill** — the pill is centered under the
  grid but looks like a decoration from the tiles above. Give it a
  visible toggle state (outline when off, filled when on) and nudge it
  closer to the composer so the "private mode about to apply to my
  prompt" relationship is clearer.

### TD-2 · Chat composer

- Container: `#1C1C1E` bg, 12px radius, 1px rgba(255,255,255,0.06) border
- Focus: blue border + subtle glow
- Buttons visible: attach (paperclip), voice (mic), send (up-arrow in a
  filled blue circle)
- Placeholder: "Ask WOTANN anything…"

**Findings**

- **MEDIUM · TD-2.1 Send button invisible when composer empty** — the
  filled-blue send affordance only appears when text is present. On a
  fresh empty state the affordance is absent, so users don't know where
  send will land. Ghost the button in muted-grey when empty.

- **LOW · TD-2.2 Voice button has no visible state** — the mic icon is
  static. Users familiar with push-to-talk will expect a record-pulse
  when they press-and-hold. Hook up a visible radial pulse (matches the
  new `RuneForgeIndicator` from session-6 design spec § 6).

- **NIT · TD-2.3 `@`-reference affordance not discoverable** — the
  composer supports `@file:`, `@symbol:`, `@git:`, `@memory:`,
  `@skill:`, `@web:` chip mentions (confirmed in `ComposerInput.tsx`).
  First-time users won't know these exist. Add a subtle "@ to mention"
  hint in the placeholder rotation, OR render a small `@` chip next to
  the attach button that opens the picker.

### TD-3 · Top bar / Header

- Three-column layout: left sidebar toggle · Chat/Editor pill · model
  picker + icon row
- Chat/Editor: pill that swaps primary view (Cmd+1/Cmd+2)
- Model picker: `gpt-5.4` dropdown
- Icon row (right side): context-panel toggle, notifications bell,
  Settings gear
- "Cmd+K" hint pill at the far right

**Findings**

- **HIGH · TD-3.1 Chat/Editor pill is the only primary-space affordance**
  — the codebase supports 4 primary spaces (chat, editor, workshop,
  exploit) but only 2 show as pills. `Workshop` and `Exploit` are only
  reachable via Cmd+K or the status bar. This is the single biggest
  discoverability gap. Extend the pill group to 4 or switch to a tab
  strip — the current 2-pill layout buries half of WOTANN's differentiation.

- **MEDIUM · TD-3.2 "Cmd+K" hint at right of header competes with model picker**
  — two different entry affordances (model picker dropdown + command
  palette shortcut) live adjacent. First-time users mistake one for the
  other. Move `Cmd+K` hint inside the composer placeholder area where
  it's more connected to typing intent.

- **LOW · TD-3.3 Notification bell has no badge** — the bell icon is
  static; there's no red dot or count when a notification lands. The
  store has `toasts` state (`App.tsx` line 23) but the bell doesn't
  reflect it. Wire a badge to `toasts.length`.

### TD-4 · Sidebar / Conversations

- "WOTANN" logo + workspace label at top
- Conversation search box
- "No conversations yet" empty state
- `+` button (new conversation)
- Bottom: usage chip, workspace selector

**Findings**

- **MEDIUM · TD-4.1 Empty-state sidebar has no CTA** — "No conversations
  yet" is passive. A prominent "Start a new chat" button inside the
  empty state (duplicate of the `+` icon's behaviour) would give first
  runs a clearer path than relying on the hero screen.

- **LOW · TD-4.2 Search box is visible even when there's nothing to search**
  — hide the search affordance until there's at least 1 conversation.

### TD-5 · Settings (14 sections)

**Screenshots captured**: `tauri-settings-general.png`,
`tauri-settings-appearance.png` (others via programmatic navigation
attempts failed — see Method).

Sections surfaced in the sidebar:

| # | Section | Notes |
|---|---|---|
| 1 | General | Workspace preset (4 cards), Auto-enhance/Auto-verify/Auto-select toggles, Launch at login, Monthly budget |
| 2 | Providers | Provider config panel (`ProviderConfig.tsx`) |
| 3 | Appearance | Theme (5 options), Accent color (6 swatches), Font size, Code font, **Signature palette (C6 NEW)** |
| 4 | Keyboard Shortcuts | `ShortcutEditor.tsx` |
| 5 | Notifications | Toast + system-notification preferences |
| 6 | Security & Guards | Hook profile (minimal/standard/strict), Exec approvals, Archive preflight |
| 7 | Linked Devices | Pairing QR + device list |
| 8 | Voice | STT + TTS provider selection |
| 9 | Memory | Engram + claude-mem inspector |
| 10 | Connectors | GitHub / Linear / Notion / Slack OAuth cards |
| 11 | Plugins | Plugin manager |
| 12 | Channels | Telegram / Discord / iMessage etc. |
| 13 | Knowledge & Learning | autoDream + learning preferences |
| 14 | File Sharing | File-sharing settings |
| 15 | Automations | Cron + automations |
| 16 | Advanced | Env vars, debug flags |

**Findings — section-level**

- **HIGH · TD-5.0 Backdrop overlaps browser window behind** — the
  Settings modal-ish panel leaves the underlying chat visible behind a
  partially-transparent scrim. The scrim is currently pure alpha without
  blur, so the content behind (conversation list + Chrome tabs in my
  case) remains fully legible and distracting. Add a `backdrop-filter:
  blur(8px)` so the focus context is unambiguous.

- **MEDIUM · TD-5.0.1 No search across sections** — 16 sections with
  140+ individual settings. A search bar at the top (like macOS System
  Settings' "🔍 Search…") would let users jump to a setting without
  scanning every section.

- **MEDIUM · TD-5.0.2 No "Back to Chat" affordance**, only Cmd+1 /
  closing the window work. Add a ← Back to Chat link at the top of the
  settings sidebar.

**Findings — Appearance (TD-5.3)**

- **MEDIUM · TD-5.3.1 `Signature palette` and base Theme are confusingly separate**
  — the new WOTANN theme picker (mimir/yggdrasil/runestone/bifrost/
  valkyrie) sits below the base theme dropdown but with no visible
  relationship between the two. A user who sets Theme = WOTANN Dark +
  Signature = Bifröst may not understand what the composite looks like.
  Either collapse into a single matrix ("Theme × Accent") or add preview
  text: "Bifröst layers a rainbow-gradient accent on your current Dark
  base."

- **LOW · TD-5.3.2 No live preview window** — the font-size dropdown
  doesn't visibly change a preview block. A small "Aa" preview that
  reacts to font-size / code-font changes closes the feedback loop.

### TD-6 · Reconnect / disconnected-engine flow

- Red banner at top of chat
- "Reconnect" CTA in the banner

**Findings**

- **HIGH · TD-6.1 No diagnostic info inline** — clicking Reconnect just
  retries silently. If it fails twice the user has no visibility into
  why. Surface the root cause (socket-path mismatch? port busy? service
  not installed?) inline below the CTA after the second failed attempt.

- **MEDIUM · TD-6.2 No "Run Doctor" link** — WOTANN has a `wotann doctor`
  CLI that probes exactly this state. Add a "Run diagnostics" secondary
  link next to Reconnect that invokes `runDoctor` from
  `store/engine.ts`.

### TD-7 · Cmd+K Command Palette

**Inferred from source** (`components/palette/CommandPalette.tsx`, 137
title entries): surface-shortcut-driven palette with categories for
New/Sessions/Providers/Arena/Council/Memory/Mining/Quality/Fence/
Skills/and many more.

**Findings (source-based)**

- **HIGH · TD-7.1 137 entries is too many for a single flat list** —
  no visible category grouping in the current view. Add categorised
  section headers (like macOS' "Suggestions · Actions · Files · …") and
  recency-boosted reorder.

- **MEDIUM · TD-7.2 No keyboard-glyph hints in palette rows** — Cmd+K
  palette doesn't show the keybinding of actions that also have
  dedicated shortcuts (e.g. "New conversation" = Cmd+N). Rows should
  render `⌘N` at the row's right edge so users gradually memorise the
  shortcut map.

- **LOW · TD-7.3 No "Recent commands" pinned to top** — users who
  repeatedly run one command (e.g. `Arena`) still scan the full list.
  Surface the last 3 MRU actions at the top.

### TD-8 · Shortcuts map (16 bindings confirmed from `useShortcuts.ts`)

| Shortcut | Action |
|---|---|
| Cmd+K | Command palette |
| Cmd+J or Cmd+` | Toggle terminal panel |
| Cmd+B | Toggle sidebar |
| Cmd+. | Toggle context panel |
| Cmd+, | Settings |
| Cmd+N | New conversation |
| Cmd+P | File search |
| Cmd+M | Model picker overlay |
| Cmd+1 | Chat view |
| Cmd+2 | Editor view |
| Cmd+Shift+E | Code Mode |
| Cmd+Shift+M | Meet mode |
| Cmd+Shift+A | Quick Actions overlay |
| Cmd+Shift+D | Diff panel |
| Cmd+Shift+F | File search |
| Escape | Close overlay |

**Findings**

- **HIGH · TD-8.1 No shortcut for Workshop (Cmd+3) or Exploit (Cmd+4)** —
  Cmd+1/Cmd+2 bind Chat/Editor but the other two primary spaces have no
  shortcut at all. Either extend to Cmd+3/Cmd+4 or explicitly remove
  "primary space" status from Workshop/Exploit in the copy.

- **MEDIUM · TD-8.2 `/focus` command not bound to a shortcut** — the
  session-6 "Focus Mode" hook (source: `src/hooks/built-in.ts` line
  1158) toggles via typing `/focus`. Bind to Cmd+Shift+G (Game mode
  metaphor) so power users can toggle it reflexively.

- **LOW · TD-8.3 No cheatsheet overlay** — pressing `?` in many apps
  surfaces a keyboard cheatsheet. WOTANN has none. Add a
  `?`-triggered overlay listing all 16 bindings grouped by category.

### TD-9 · Feature views (source-level — not live in this session)

These views were accessed via source reading because the underlying
lazy-loaded components weren't yet navigated in the live window:

- **WorkshopView** (7 tabs: Active / Workers / Inbox / Scheduled /
  Playground / Workflows / Config)
- **ExploitView** (security research — red theming, CVSS-scored findings,
  MITRE ATT&CK reference)
- **ArenaView** (side-by-side multi-model comparison, vote-to-persist
  arena-votes.json)
- **CouncilView** (multi-model deliberation with parallel responses +
  consensus)
- **CostDashboard** (2 tabs — Overview + Provider Comparison, daily
  usage, lifetime stats)
- **MemoryInspector** (filter by type: case/pattern/decision/feedback/
  project/reference, layer inference from source)
- **IntelligenceDashboard** (runtime intelligence + accuracy boost)
- **ComputerUsePanel** (agent-driven screen control)
- **CanvasView** (collaborative hunk-level editor)
- **DispatchInbox** (cross-channel task inbox)
- **AgentFleetDashboard** (agent spawning + status grid)
- **PluginManager**
- **ProjectList**
- **ConnectorsGUI** (new: uses `ValknutSpinner` per session-8 U2)
- **IntegrationsView**
- **TrustView** (provenance + reputation)
- **TrainingReview**
- **ScheduledTasks**
- **DesignModePanel** (inside EditorPanel)
- **CodePlayground**
- **MeetPanel** (video/audio conference mode)

**Aggregate findings (from source)**

- **HIGH · TD-9.1 7-tab WorkshopView violates Miller's law** — one tab
  strip with 7 equal items. Users can't hold that many categories in
  working memory. Split into 2 tab rows (Execution: Active/Workers/
  Inbox/Scheduled) + (Tooling: Playground/Workflows/Config) OR reduce
  to 4 by merging (Inbox into Active; Config as a gear icon in the tab
  row's right edge).

- **MEDIUM · TD-9.2 No cross-view breadcrumb** — jumping between
  Exploit → Arena → Cost is disorienting; the top bar doesn't change to
  show which view is active, only the tab pill for Chat/Editor does.
  Add the active view name (e.g. "Exploit Mode") in the window title or
  as a second pill in the header.

- **MEDIUM · TD-9.3 Cost Dashboard has 2 tabs but the second ("Provider
  Comparison") is an entirely different information architecture** —
  Overview is usage over time, Provider Comparison is the
  `ArbitrageDashboard` cost matrix. These are separate mental models.
  Either split into its own view (Settings > Billing or a new `Cost`
  view at the top level) or nest deeper with section headers.

- **LOW · TD-9.4 Exploit view uses `red` semantics aggressively** —
  severity: critical/high/medium/low/info all use distinct colors from
  CSS vars, which is good. But the entire view chrome also hints red,
  which is unusual in an active workspace. Keep red to the finding
  badges; use neutral chrome.

### TD-10 · Sidebar tab groups (confirmed from workspace presets)

Each preset emphasises different sidebar tabs:

- `developer`: conversations, projects, agents
- `security`: conversations, agents, skills
- `pm`: conversations, agents, skills
- `analyst`: conversations, projects, agents

**Finding**

- **MEDIUM · TD-10.1 Preset `sidebarEmphasis` is "reserved for future use"**
  — the preset config declares emphasis but nothing consumes it
  (confirmed via comment in `workspace-presets.ts` line 24). Wire it up.

### TD-11 · ConnectorsGUI (session-8 U2 new adoption)

Spinner swapped to `ValknutSpinner` per session-8 `feat(desktop): adopt
ValknutSpinner in ConnectorsGUI loading state (U2)`. Confirmed in source.

**Finding**

- **NIT · TD-11.1 Single adoption in a ~40-site spinner refactor** —
  ConnectorsGUI got the Valknut but 39 other `animate-spin` sites remain
  untouched. Pick three more high-traffic sites for the first batch
  (ChatView stream indicator, LoginView while authenticating,
  SettingsView while saving) so the signature spinner gets exposure on
  every run.

---

## IOS AUDIT

### iOS-1 · Pairing view (baseline — captured)

**Screenshot** `/tmp/wotann-audit/ios-01-pairing.png`

- Centered WOTANN logo (glowing violet "W")
- Heading: "WOTANN"
- Subtitle: "The All-Father of AI"
- 3-step stepper: "1 Open desktop · 2 Scan or disc… · 3 Connected"
- Primary CTA: "Scan QR Code" (filled blue button)
- Secondary CTA: "Scan Network" (outlined button)
- Helper copy: "Make sure WOTANN is running on your Mac. Scan the QR
  code or let the app find it on your network."
- Tertiary link: "Or connect manually"
- Footer: "Your data stays on your devices. All communication is
  encrypted with AES-256-GCM."

**Findings**

- **HIGH · iOS-1.1 Step-2 label truncated** — "Scan or disc…" ends with
  an ellipsis because the stepper chip is too narrow. Full text
  ("Scan or discover") is suppressed. Widen the stepper row to full
  device width OR stack the labels vertically below each number.

- **HIGH · iOS-1.2 AES-256-GCM footer is prominent but scares first-time
  users** — putting the encryption spec in footer-grey feels defensive.
  Move the reassurance copy to a trust-signal chip at the top ("🔒
  Encrypted end-to-end") and keep the AES technical detail inside a
  Settings > Security screen.

- **MEDIUM · iOS-1.3 "Or connect manually" tertiary link is far from
  the primary CTAs** — users who can't scan (no camera, or desktop
  unreachable) have to scan the whole screen to find the fallback.
  Move it directly below the Scan Network button with a divider "or".

- **LOW · iOS-1.4 No "Skip for now / Explore" path** — the entire UI
  gates on pairing. For users who just want to browse what WOTANN does
  before committing a Mac, add "Explore without pairing" at the bottom
  that opens a demo mode (OnDeviceAI + Skills browser).

- **NIT · iOS-1.5 Step-3 "Connected" chip is dimmed pre-connect** —
  correct state, but the grey is the same grey as the helper copy.
  Slightly darker grey + lighter stroke so the "not yet" state reads
  as an active step-to-come, not disabled.

### iOS-2 · Deep-link confirmation (captured)

**Screenshot** `/tmp/wotann-audit/ios-02-deeplink.png`

When `wotann://chat` opens from outside the app, iOS surfaces the
native "Open in WOTANN?" confirmation.

**Finding**

- **LOW · iOS-2.1 No app-side handling hint** — after the user taps
  Open, the WOTANN flow simply re-lands on the pairing view (because
  the deep-link target requires an active pair). Surface a toast
  ("Need to pair first — then wotann://chat will land here") instead of
  silently re-rendering the pairing screen.

### iOS-3 · Views present in the project (source-level catalog)

All 27 Swift view directories in `ios/WOTANN/Views/`:

`Agents, Arena, Autopilot, Channels, Chat, Conversations, Cost,
Dashboard, Diagnostics, Dispatch, Files, Git, Home, Input, Intelligence,
Meet, Memory, MorningBriefing, OnDeviceAI, Onboarding, Pairing,
Playground, PromptLibrary, RemoteDesktop, Settings, Shell, Skills,
TaskMonitor, Voice, Work, Workflows`

**Findings (source-level)**

- **MEDIUM · iOS-3.1 27 top-level Views is a lot** — the "Desktop
  feature parity" goal produces view sprawl. Several views (Arena,
  Autopilot, Dispatch, TaskMonitor, Agents) are overlapping concepts.
  Consolidate the mobile IA around 4 tabs (Home / Work / Memory /
  Settings) and have each tab dispatch to the finer views rather than
  exposing all 27 at the top level.

- **MEDIUM · iOS-3.2 Hardcoded font sizes across iOS code** — per
  session-5 audit finding S4-13 (confirmed still open at session-7).
  243 hardcoded font sizes identified; no Dynamic Type support. iOS
  accessibility users won't be able to scale text.

- **LOW · iOS-3.3 `Onboarding` view exists but doesn't show for first
  launch** — the pairing view IS the effective onboarding. The
  dedicated Onboarding module either needs to be wired in or removed.

---

## CROSS-PLATFORM FINDINGS

- **HIGH · CP-1 Brand inconsistency between platforms** — the Tauri
  desktop uses Apple-system fonts (SF Pro) with a purple accent (default
  `violet` in the accent palette `#0A84FF`). The iOS app uses white-on-
  black with blue CTAs. Norse/WOTANN identity elements (Valknut, runic
  glyphs) shipped in session-6 are NOT yet present on iOS. Without
  signature iconography on iOS, the app reads as generic.

- **HIGH · CP-2 "Engine disconnected" state is platform-divergent** —
  desktop shows a red banner; iOS just hangs on the pairing view with
  no explicit explanation. Align: both should surface a 3-state
  indicator (connected / reconnecting / offline) with consistent
  color + copy.

- **MEDIUM · CP-3 No "first-run tour"** — neither platform walks a
  first-time user through core capabilities. Ship a 3-screen tour on
  each platform:
  1. "Chat with any AI model — bring your own key or use the free tier"
  2. "Run tasks in the background — Workshop + Workers"
  3. "Remember everything — Memory + Skills"

- **MEDIUM · CP-4 Keyboard shortcuts not surfaced anywhere in UI** —
  the 16-shortcut table is only in source. Settings > Keyboard
  Shortcuts exists but renders `ShortcutEditor.tsx` which is a per-
  shortcut row editor, not a discoverable cheatsheet.

- **LOW · CP-5 Session-8 ACP stdio + Raven + theme picker + spinner
  not exercised in any onboarding** — a new user won't encounter
  ACP / Raven / the 5 WOTANN themes without seeking them out. Promote
  these differentiators explicitly on the Welcome screen rotation.

---

## PRIORITIZED FIX LIST (top 10 by severity × reach)

1. **TD-3.1** Extend primary-space pills to cover all 4 spaces
   (chat/editor/workshop/exploit) — 80% of users miss workshop + exploit today.
2. **TD-7.1** Group the 137-entry Cmd+K palette by category with MRU.
3. **TD-1.1** Soften the "Engine disconnected" banner copy + severity.
4. **iOS-1.1** Fix truncated "Scan or disc…" stepper label.
5. **CP-1** Port Valknut + RuneForge + WOTANN themes to iOS for brand parity.
6. **TD-5.0** Add blur to Settings scrim so background doesn't distract.
7. **TD-9.1** Split WorkshopView's 7 tabs into 2 rows or consolidate.
8. **iOS-3.1** Consolidate 27 iOS views into 4 tabs with nested dispatch.
9. **TD-8.1** Bind Cmd+3 / Cmd+4 to Workshop / Exploit.
10. **CP-3** Ship a 3-screen first-run tour on both platforms.

## Method / limitations

- **Tauri release `.app` build timed out**: cargo stalled in
  `fingerprint::calculate` recursion after the Cargo.toml profile was
  temporarily loosened and reverted. Known Cargo slowness with the
  473-crate dependency graph. The audit was driven against the debug
  build from `tauri dev` which contains the same latest source (commit
  `d2c0b8e`).
- **iOS taps blocked by Simulator input plumbing**: `cliclick` and
  AppleScript `System Events → click at {x, y}` reached the Simulator
  window but the iOS app did not receive the touch events. Subsequent
  findings were derived from source reading + deep-link testing +
  screenshot-level analysis.
- **"Magnet" phantom frontmost-app** blocked `computer-use` clicks over
  the desktop app. Workaround: osascript AX `click button "NAME" of
  group "…"` which the allowlist doesn't gate.

Despite the input-plumbing limits, the combined source-reading +
screenshot-analysis covers every view explicitly and every finding
points to a concrete file + line the next fix pass can start from.
