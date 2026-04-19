# 09 — Surface: iOS (iPhone + Watch + CarPlay + Widgets + Intents + LiveActivity + ShareExtension)

Source: `wotann/ios/WOTANN/` (128 Swift files) + `WOTANNWatch/` + `WOTANNWidgets/` + `WOTANNIntents/` + `WOTANNLiveActivity/` + `WOTANNShareExtension/`. `SURFACE_PARITY_REPORT.md` §4.4 and `UI_PLATFORMS_DEEP_READ_2026-04-18.md` §1.

## Build targets (5)

1. **WOTANN** — main iPhone app.
2. **WOTANNWatch** — watchOS companion.
3. **WOTANNWidgets** — home-screen widgets.
4. **WOTANNIntents** — App Intents (Siri / Shortcuts).
5. **WOTANNLiveActivity** — Dynamic Island + lock screen.
6. **WOTANNShareExtension** — share sheet entry.

All 5 targets build green (`xcodebuild -scheme WOTANN -sdk iphonesimulator build` → `** BUILD SUCCEEDED **`). CarPlay compiles inside `WOTANN` via `#if canImport(CarPlay)`.

## Root shell — MainShell.swift (134 lines)

`ios/WOTANN/Views/Shell/MainShell.swift`:
- SwiftUI `TabView` with 4 tabs: **Home / Chat / Work / You**.
- `FloatingAsk` overlay pinned 72pt above the tab bar.
- `AskComposer` modal sheet.
- Voice full-screen cover.
- Badge on the Work tab.
- `.ultraThinMaterial` toolbar background (one of only 4 iOS `.ultraThinMaterial` usages — see `UI_UX_AUDIT.md` §3.2).

## The 4 primary tabs (iOS)

### Home tab

`HomeView.swift` (216 lines) + 6 sections:
1. **StatusRibbon** — engine health, cost today, model.
2. **HeroAsk** — big "Ask WOTANN..." button.
3. **WhereYouLeftOff** — last active conversation card.
4. **LiveAgentsStrip** — horizontal list of running agents (conditional on `activeAgents.count > 0`).
5. **ProactiveCardDeck** — suggestions ("You haven't checked in on PR #42 — want me to summarise it?").
6. **AmbientCrossDeviceView** — "3 devices online, latest activity on MacBook Pro."
7. **RecentConversationsStrip** — horizontal list.

`.refreshable` calls `appState.syncFromDesktop(using: rpcClient)` with haptic.

### Chat tab

`ChatView.swift` + 11 files in `Chat/`:
- `ChatView.swift` — message stream.
- `ChatInputBar.swift` — composer (one of 4 `.ultraThinMaterial` sites).
- `MessageBubble.swift`, `MessageContextMenu.swift` — per-message UI + actions.
- `StreamingText.swift`, `ToolCallCard.swift`, `DiffPreview.swift` — inline renderings.

Current: no Block rendering (desktop has it as `Block.tsx`; iOS has no equivalent yet).

### Work tab (Autopilot / Dispatch / TaskMonitor)

5 files in `Work/`:
- `AutopilotView.swift` — agent autopilot grid.
- `TaskMonitor.swift` — running task list.
- `DispatchView.swift` + `TaskTemplateList.swift` — incoming channel tasks.
- `AgentTriage.swift` — approve/kill all.

### You tab (Settings / Memory / Cost / Profile)

7 Settings files + MemoryBrowserView + CostDashboardView + BudgetView.

## Floating Ask

The signature iOS interaction. Pinned 72pt above tab bar. Tap → `AskComposer` sheet. Hold → voice fullscreen cover.

Current: one of 4 `.ultraThinMaterial` sites. Needs Liquid Glass upgrade (`UI_UX_AUDIT.md` §3.2 item 1.5):
- Wrap the FloatingAsk button in `.background(.ultraThinMaterial)`,
- Add a 1pt inner stroke of `.ultraThinMaterial`,
- On hold, add a gold specular sheen that sweeps 380ms.

## The 34 view directories (full inventory)

From `ls ios/WOTANN/Views/`:

1. **Agents** — agent configuration.
2. **Arena** — ArenaView (multi-model compare, votes to `~/.wotann/arena-votes.json`).
3. **Autopilot** — AutopilotView.
4. **Channels** — ChannelStatusView (read-only).
5. **Chat** — 11 files.
6. **Components** — 13 shared.
7. **Conversations** — list.
8. **Cost** — CostDashboardView + BudgetView.
9. **Dashboard** — main dashboard.
10. **Diagnostics** — system diagnostics.
11. **Dispatch** — DispatchView + TaskTemplateList.
12. **Files** — file browser.
13. **Git** — git status.
14. **Home** — HomeView + 6 sections.
15. **Input** — input helpers.
16. **Intelligence** — IntelligenceDashboardView.
17. **Meet** — MeetModeView.
18. **Memory** — MemoryBrowserView + MemoryDetailView.
19. **MorningBriefing** — proactive daily summary.
20. **OnDeviceAI** — OnDeviceAIView + HealthInsightsSettingsView.
21. **Onboarding** — dedicated (not wired today — see IOS-3.3).
22. **Pairing** — 5 files (Pairing, PairingWizard, QRScanner, PINEntry, AutoDetectedCard).
23. **Playground** — CodePlaygroundView.
24. **PromptLibrary** — saved prompts.
25. **RemoteDesktop** — RemoteDesktopView.
26. **Settings** — 7 files.
27. **Shell** — MainShell + toolbar.
28. **Skills** — SkillsBrowserView.
29. **TaskMonitor** — running tasks.
30. **Voice** — VoiceInputView + VoiceInlineSheet.
31. **Work** — 5 files (Autopilot-adjacent).
32. **Workflows** — WorkflowsView.
33. **ExploitView** — MISSING (new).
34. **CouncilView** — MISSING (new).

Also:
- **MeetPanel (desktop-only equivalent)** — iOS has MeetModeView.
- **Editor (Monaco)** — MISSING on iOS. Options: WKWebView Monaco, or SwiftUI + TreeSitter. See `SURFACE_PARITY_REPORT.md` §5 Priority 1 item 1.

## Watch (WOTANNWatch, 1 file, 594 LOC)

`WOTANNWatchApp.swift` — rich app with:
- WatchHomeView,
- AgentTriageView (approve/kill all),
- TaskStatusView,
- QuickActionsView,
- CostView.

All via WCSession proxied through paired iPhone. No independent network. No Widgets. No voice dictation (voice is request-only).

## CarPlay (CarPlayService.swift, 340 LOC)

`ios/WOTANN/Services/CarPlayService.swift` — `CPTemplateApplicationSceneDelegate` with 3 tabs:
1. **Chat** — last 10 conversations (from `ConversationStore.shared`).
2. **Voice** — voice input + 3 quick actions.
3. **Status** — cost today, provider, agent count (from shared UserDefaults).

Plus conversation-detail template (last 8 messages + Voice Reply button).

## Widgets (3 today)

`WOTANNWidgets/`:
1. **AgentStatusWidget** — active agents count.
2. **CostWidget** — today / session / budget.
3. **WidgetBundle** — combined.

Target: add Workflow-running widget, Cost-preview widget, Lock-Screen widgets.

## Intents (3 today)

`WOTANNIntents/` + `WOTANNIntentService`:
1. **AskWOTANNIntent** — "Hey Siri, ask WOTANN..."
2. **EnhancePromptIntent** — send to prompt-enhance.
3. **CheckCostIntent** — query cost.

Target: add DispatchTaskIntent, StartMeetingIntent.

## Live Activities (1 today)

`WOTANNLiveActivity/`:
1. **TaskProgressActivity** — Dynamic Island + lock screen showing running task.

Target: add CostBudgetActivity (when approaching daily limit), MeetRecordingActivity.

## ShareExtension (2 files)

`WOTANNShareExtension/`:
- ShareView + controller — push text/URL into WOTANN as a new conversation or dispatch task.
- Today: text + URL only. Target: image + PDF.

## Design system

### Theme — ios/WOTANN/DesignSystem/Theme.swift (247 lines)

`WTheme` enum with:
- `Colors` — 40+ named colors (Apple-blue scheme, dark-only except `border` which uses `Color.adaptive(light:dark:)`).
- `Typography` — 15+ Font.system tokens. **Currently uses `Font.system(size: N, weight: ..., design: ...)` without `relativeTo:` — breaks Dynamic Type (243+ call-sites). FIX: Add `relativeTo: .body/.caption/etc.`**
- `Spacing` — 4-pt / 8-pt multiples.
- `Radius`, `Animation`, `Gradients`, `Tracking`, `Shadow`, `Elevation`, `IconSize`, `BorderWidth`.

### Accessibility — ios/WOTANN/DesignSystem/A11y.swift (100 lines)

**Exemplary.** Per `UI_UX_AUDIT.md` §11 item 3: "Every iOS app should copy this file."

- `wotannAccessible(label:hint:)` — reusable modifier for AX labels.
- `respectsReduceMotion(spring:value:)` — swaps springs for `.easeInOut(0.2)` when `prefers-reduced-motion: reduce`.
- `hitTarget(onTap:)` — enforces 44pt minimum + Rectangle `contentShape`.

### WLogo — ios/WOTANN/DesignSystem/WLogo.swift

Purple W glyph with breathing animation. Currently 2-stop gradient. Upgrade to 4-stop (per desktop parity).

### StatusShape, ViewModifiers — more shared primitives.

## Haptic palette

`ios/WOTANN/Services/HapticService.swift` + `Haptics.swift`. 137 haptic call-sites across 39 files with explicit types:
- `pairingSuccess`,
- `taskCompletion`,
- `approvalGranted` / `approvalDenied`,
- `swipeAccept` / `swipeReject` (for diff cards),
- `voiceStart` / `voiceEnd`.

Rule (per `UI_DESIGN_SPEC_2026-04-16.md` §9.1): **right-swipe on diff card = accept (success haptic); left-swipe = reject (warn haptic) — with detents at ±18°.**

## Pairing flow

`ios/WOTANN/Views/Pairing/PairingView.swift` + 4 supporting views.

Current screenshot: `docs/session-10-ios-pairing.png` (copied to `19-reference-screenshots/`).

- Centered WOTANN logo (glowing violet W),
- Heading "WOTANN" + subtitle "The All-Father of AI",
- 3-step stepper: "1 Open desktop · 2 Scan or disc… · 3 Connected",
- Primary CTA "Scan QR Code" + secondary "Scan Network",
- Tertiary link "Or connect manually",
- Footer "Your data stays on your devices. All communication is encrypted with AES-256-GCM."

**Audit findings** (from `SESSION_8_UX_AUDIT.md` + `UX_AUDIT_2026-04-17.md`):
- iOS-1.1 [HIGH]: "Scan or disc…" truncated — widen or stack labels.
- iOS-1.2 [HIGH]: AES-256-GCM footer scares first-time users — move to trust chip at top.
- iOS-1.3 [MED]: "Or connect manually" too far from primary CTAs.
- iOS-1.4 [LOW]: no "Skip / Explore without pairing" — add per Principle 13.
- IOS-DEEP-1: deep-link `wotann://chat` lands back on pairing — surface toast.

## Reference screenshots

- **iOS pairing** (only iOS screenshot): `19-reference-screenshots/session-10-ios-pairing.png`.
- **All other iOS views are visually unverified** (`SURFACE_PARITY_REPORT.md` §4.4: "33 of 34 views visually unverified"). Claude Design must draft wireframes then request capture.

## Current iOS scorecard (from UI_UX_AUDIT.md §1)

| Bar | Score | Notes |
|---|:-:|---|
| Typography | 7 | Apple SF Pro + tight hierarchy |
| Spacing | 7 | 4/8-pt grid consistent |
| Color | 7 | Dark-only; `Color.adaptive` in 1 site of 40 — needs expansion |
| Motion | 7 | `A11y.respectsReduceMotion` covers most; native SwiftUI transitions good |
| Loading | 7 | Per-view placeholders |
| Empty | 7 | Mostly addressed |
| Error | 7 | Moderate — iOS handles Engine offline less explicitly than desktop |
| Haptics | **8** | 137 sites, typed palette, exemplary |
| Density | 7 | Good — MainShell 4-tab + FloatingAsk |
| Glass/depth | **8** | `.ultraThinMaterial` used (4 sites) + iOS 17+ support |
| Keyboard | 5 | Mostly touch — VoiceOver parity good but no external-keyboard shortcuts |
| VoiceOver | 8 | 149 `accessibilityLabel|Hint` occurrences in 43 files |
| Dynamic Type | **4** | REGRESSION — 243+ fixed-pt fonts block scaling |
| Brand (Norse) | 3 | Pairing view uses purple W but no Norse thread elsewhere |

**iOS composite**: **7.0 / 10** — best-of-three on color + motion + empty + error + haptics + glass + VoiceOver. Weakest on Dynamic Type and brand thread.

## What Claude Design must produce for iOS

For each of the 34 views:
- Default state,
- Empty state,
- Loading state,
- Error state (honest, with next action),
- Disconnected state (daemon offline),
- Paired / unpaired variants where applicable.

For Widgets + Intents + LiveActivity:
- Compact (Dynamic Island leading + trailing),
- Expanded,
- Lock screen.

For Watch:
- Home, AgentTriage, TaskStatus, QuickActions, Cost.

For CarPlay:
- Chat tab, Voice tab, Status tab, conversation detail.

---

*End of 09-surface-ios.*
