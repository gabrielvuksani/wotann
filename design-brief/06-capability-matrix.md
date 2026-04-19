# 06 — Capability matrix: 223 features × 3 surfaces × priority

Source: `wotann/docs/SURFACE_PARITY_REPORT.md` §2 + `NEXUS_V4_SPEC.md` §2 unified feature matrix.

This document is the feature table Claude Design must honour. It defines which surface each capability lives on and what priority the redesign must give it.

## Legend

- **[P0]** redesign must include (first-class view or prominent component),
- **[P1]** redesign must support (reachable via palette / shortcut / deep-link),
- **[P2]** redesign must not block (accessible from settings or advanced menu),
- **n/a** not applicable to this surface.

## Primary capabilities (33 headline features)

| # | Capability | TUI | Desktop | iOS | Watch | CarPlay | Source |
|---:|---|:-:|:-:|:-:|:-:|:-:|---|
| 1 | Chat / conversation | **P0** | **P0** | **P0** | P1 | P1 | `ChatView.tsx` + `ChatView.swift` |
| 2 | Editor (Monaco) | n/a | **P0** | P2 (WebView) | n/a | n/a | `desktop-app/src/components/editor/` 15 files |
| 3 | Workshop (local agent tasks) | **P0** | **P0** | P1 via Dispatch | n/a | n/a | `WorkshopView.tsx` |
| 4 | Exploit (security research) | **P0** | **P0** | **P1 (new)** | n/a | n/a | `ExploitView.tsx` |
| 5 | Agent Autopilot | **P0** | **P0** | **P0** | **P1** | P2 status only | `AutopilotView.swift` |
| 6 | Provider management + model picker | **P0** | **P0** | **P0** | P2 | n/a | `ProviderConfig.tsx` + `ProviderSettings.swift` |
| 7 | Cost tracking + preview | **P0** | **P0** | **P0** | **P1** | **P1** | `CostDashboard.tsx` + `CostView.swift` |
| 8 | Memory search | **P0** | **P0** | **P0** | P2 | n/a | `MemoryInspector.tsx` + `MemoryBrowserView.swift` |
| 9 | Dream pipeline | P1 | P1 | **P0 new** | n/a | n/a | CLI `wotann dream` |
| 10 | Meet mode (meeting assistant) | P2 | **P0** | **P0** | P2 | n/a | `MeetPanel.tsx` + `MeetModeView.swift` |
| 11 | Arena (multi-model compare) | P1 | **P0** | **P0** | n/a | n/a | `ArenaView.tsx` + `ArenaView.swift` |
| 12 | Council (multi-model deliberate) | P1 | **P0** | **P0 new** | n/a | n/a | `CouncilView.tsx` (iOS missing) |
| 13 | Remote Desktop control | P2 | **P0** | **P0** | n/a | n/a | `RemoteControlView.tsx` + `RemoteDesktopView.swift` |
| 14 | Voice (push-to-talk) | **P0** | **P0** | **P0** | **P0** | **P0** | `VoiceService.swift` |
| 15 | Pairing (ECDH iOS↔Desktop) | n/a | **P0** | **P0** | n/a | n/a | 5 files in `ios/WOTANN/Views/Pairing/` |
| 16 | Dispatch inbox (cross-channel task) | P1 | **P0** | **P0** | **P1** | n/a | `DispatchInbox.tsx` + `DispatchView.swift` |
| 17 | Morning briefing | n/a | **P1 new** | **P0** | P2 | n/a | `MorningBriefingView.swift` (iOS only today) |
| 18 | Intelligence dashboard | n/a | **P0** | **P0** | n/a | n/a | `IntelligenceDashboard.tsx` + `IntelligenceDashboardView.swift` |
| 19 | Skills / SkillForge | **P0** | **P0** | **P0** | n/a | n/a | `SkillsBrowserView.swift` |
| 20 | Channels (17+ adapters) | P2 | **P0** | **P1 read-only** | n/a | n/a | `ChannelsTab` |
| 21 | HealthKit insights | n/a | n/a | **P1** | **P1** | n/a | `HealthKitService.swift` |
| 22 | Screen pipeline (continuous) | P2 | **P0** | **P1 new** | n/a | n/a | `ComputerUsePanel.tsx` |
| 23 | Diff theatre (per-hunk accept/reject) | **P0** | **P0** | **P0 new** | n/a | n/a | `MultiFileDiff.tsx` + `HunkReview.tsx` |
| 24 | LSP symbol operations | **P0** | **P0** | n/a | n/a | n/a | `SymbolOutline.tsx` |
| 25 | MCP client + server | P1 | **P0** | **P1 new** | n/a | n/a | `MCPTab` |
| 26 | ACP client + server | **P0** | **P1** | n/a | n/a | n/a | `wotann acp` CLI |
| 27 | Learning / self-evolution | P1 | **P0** | P2 | n/a | n/a | `TrainingReview.tsx` |
| 28 | Plugin marketplace | **P0** | **P0** | P2 | n/a | n/a | `PluginManager.tsx` |
| 29 | Intent handlers (Shortcuts / Siri) | n/a | n/a | **P0** | P2 | n/a | 3 intents + `WOTANNIntentService` |
| 30 | Widgets + Live Activities | n/a | n/a | **P0** | **P1** | n/a | 3 widgets + LiveActivity |
| 31 | Scheduled tasks | **P0** | **P0** | **P1** | P2 | n/a | `ScheduledTasks.tsx` |
| 32 | Global shortcuts | **P0** | **P0** | **P1** | n/a | n/a | `ShortcutEditor.tsx` |
| 33 | Computer Use (GUI automation) | P1 | **P0** | **P1 new** | n/a | n/a | `ComputerUsePanel.tsx` |

## Secondary capabilities (surface-specific)

### Desktop-only (24 lazy-loaded views)

Source: `wotann/desktop-app/src/components/layout/AppShell.tsx`.

1. **MeetPanel** [P0]
2. **ArenaView** [P0]
3. **IntelligenceDashboard** [P0]
4. **CanvasView** [P1]
5. **AgentFleetDashboard** [P0]
6. **ConnectorsGUI** [P0]
7. **ProjectList** [P1]
8. **DispatchInbox** [P0]
9. **ExecApprovals** [P0]
10. **PluginManager** [P0]
11. **DesignModePanel** [P1]
12. **CodePlayground** [P1]
13. **ScheduledTasks** [P1]
14. **ComputerUsePanel** [P0]
15. **CouncilView** [P0]
16. **TrainingReview** [P1]
17. **TrustView** [P0] (proofs, provenance)
18. **IntegrationsView** [P1]
19. **ExploitView** [P0]
20. **EditorPanel** [P0]
21. **WorkshopView** [P0]
22. **ChatView** [P0]
23. **OnboardingView** [P0]
24. **SettingsView (16 sections)** [P0]

### iOS-only (34 view directories)

Source: `wotann/ios/WOTANN/Views/` + `SURFACE_PARITY_REPORT.md` §4.4.

1. **Pairing** (5 views: Pairing, PairingWizard, QRScanner, PINEntry, AutoDetectedCard) [P0]
2. **Home** (HomeView + 6 sections: StatusRibbon, HeroAsk, WhereYouLeftOff, LiveAgentsStrip, ProactiveCardDeck, AmbientCrossDevice, RecentConversationsStrip) [P0]
3. **Chat** (11 files including ChatView, ChatInputBar, MessageBubble, MessageContextMenu) [P0]
4. **Autopilot** [P0]
5. **Memory** (MemoryBrowserView, MemoryDetailView) [P0]
6. **Cost** (CostDashboardView + BudgetView) [P0]
7. **Agents** (AgentsView + AgentTriage) [P0]
8. **Arena** [P0]
9. **Meet** (MeetModeView) [P0]
10. **Voice** (VoiceInputView + VoiceInlineSheet) [P0]
11. **Channels** (ChannelStatusView) [P1 read-only]
12. **OnDeviceAI** (OnDeviceAIView, HealthInsightsSettingsView) [P0]
13. **MorningBriefing** [P0]
14. **Intelligence** (IntelligenceDashboardView) [P0]
15. **Settings** (7 files) [P0]
16. **Dispatch** (DispatchView + TaskTemplateList) [P0]
17. **Dashboard** [P0]
18. **Skills** (SkillsBrowserView) [P0]
19. **TaskMonitor** [P0]
20. **Work** (5 files) [P0]
21. **Conversations** [P0]
22. **Onboarding** [P0 but gated — see Principle 13]
23. **Shell** (MainShell with 4-tab TabView + FloatingAsk + AskComposer) [P0]
24. **Input** [P1]
25. **Components** (13 shared — reusable) [n/a — library]
26. **RemoteDesktop** [P0 new]
27. **Git** [P1]
28. **Files** [P1]
29. **PromptLibrary** [P1]
30. **Playground** [P1]
31. **Workflows** [P0 new]
32. **Diagnostics** [P2]
33. **Widgets (3)**, **Intents (3)**, **LiveActivity (1)**, **ShareExtension**, **Watch**, **CarPlay** [all P0 for surfaces that apply]
34. **Council** [P0 new]

### TUI-specific commands (50+ slash)

Source: `wotann/src/ui/App.tsx` + `wotann/src/index.ts` (86 CLI commands).

Top 20 most-used slash commands the TUI palette must surface:

`/help`, `/model`, `/provider`, `/cost`, `/memory`, `/focus`, `/branch fork`, `/council`, `/arena`, `/skills`, `/autonomous`, `/dream`, `/mcp`, `/audit`, `/health`, `/onboard`, `/timeline`, `/voice`, `/diff`, `/plan`.

Plus 30+ more — see `07-surface-tui.md` full inventory.

## Channel adapters (25+)

Source: `SURFACE_PARITY_REPORT.md` §4.11.

- **Wired inbound + outbound** (16): Telegram, Slack, Discord, Signal, WhatsApp, Email, Webhook, SMS, Matrix, Teams, IRC, GoogleChat, WebChat, iMessage (macOS bridge), GitHubBot, IDEBridge.
- **Missing but in spec** (7): Mastodon, Twitter/X, LinkedIn, Instagram, WeChat, Line, Viber.

Claude Design treats channels as **daemon-side concerns that surface in desktop + iOS as status + configuration views**. They don't get a primary-surface tab; they live under **Settings > Channels** on desktop and **Settings > Channels (read-only)** on iOS.

## Widgets + Intents + LiveActivity matrix

From `SURFACE_PARITY_REPORT.md` §4.7-4.10:

### Widgets (3 today, target 6)

1. **AgentStatusWidget** (active agents count) [P0]
2. **CostWidget** (today / session / budget) [P0]
3. **WidgetBundle** (combined) [P0]
4. **WorkflowRunningWidget** [P1 new]
5. **CostPreviewWidget** (before-execute estimate) [P1 new]
6. **LockScreenWidgets** [P1 new] — per Apple WWDC 2022+ spec.

### Intents (3 today, target 5)

1. **AskWOTANNIntent** [P0]
2. **EnhancePromptIntent** [P0]
3. **CheckCostIntent** [P0]
4. **DispatchTaskIntent** [P0 new]
5. **StartMeetingIntent** [P0 new]

### LiveActivity (1 today, target 3)

1. **TaskProgressActivity** (Dynamic Island) [P0]
2. **CostBudgetActivity** (when approaching daily limit) [P1 new]
3. **MeetRecordingActivity** [P1 new]

## Priority reduction (what we drop in v1 if time pressed)

If Claude Design is forced to choose, drop:

- **CanvasView** on desktop (leaning Cursor Canvases is v2),
- **DesignModePanel** (dogfood later),
- **CodePlayground** (embed in Editor as tab, not separate view),
- **Workflows** on iOS (desktop-only v1).

Non-negotiable minimums:

- Desktop: all 4 tabs (Chat / Editor / Workshop / Exploit) + Onboarding + Settings (16 sections),
- iOS: all 4 tabs (Home / Chat / Work / You) + Onboarding + Pairing,
- TUI: Chat + Diff + Agents + Command Palette (new) + StatusBar.

## Redesign priority (what Claude Design should spend compute on)

For each surface, rank by impact × redesign effort:

### Desktop

1. [HIGH] ChatView + WelcomeScreen (quick-action tiles, composer, Welcome subtitle copy),
2. [HIGH] Header + Sidebar (active-tab treatment, vertical icon rail polish),
3. [HIGH] OnboardingView (5-step stepper; already 7/10 — polish to 9/10),
4. [HIGH] ExploitView (Valkyrie theme adoption),
5. [HIGH] WorkshopView (7 tabs — reduce to 4 per Miller's law),
6. [HIGH] EditorPanel (3-pane consistency, Monaco chrome),
7. [HIGH] Settings (16 sections, add search, fix scrim blur),
8. [HIGH] Command Palette (category headers + MRU + shortcut hints),
9. [MED] Model Picker + Notification Panel,
10. [MED] Proof + Trust views,
11. [MED] Meet + Arena + Council (consistent-layout polish).

### iOS

1. [HIGH] MainShell + FloatingAsk (Liquid Glass sheets, haptic polish),
2. [HIGH] HomeView + 6 sections (StatusRibbon, ProactiveCardDeck, RecentConversationsStrip),
3. [HIGH] ChatView + MessageBubble (Blocks port from desktop),
4. [HIGH] Pairing wizard (fix truncated "Scan or disc…" — iOS-1.1 from session-8),
5. [HIGH] Onboarding (add "Continue without pairing" path — IOS-DEEP-1),
6. [HIGH] Council + Exploit (new views to match desktop parity),
7. [HIGH] Watch (AgentTriage, CostView, QuickActions),
8. [MED] CarPlay (voice reply, status),
9. [MED] Widgets + LiveActivity (add 3 more widgets, 2 more LA types).

### TUI

1. [HIGH] Command Palette (new, ⌃P or backtick),
2. [HIGH] Block-based rendering in ChatView + terminal,
3. [HIGH] Status bar per-turn cost ticker,
4. [MED] Focus view polish,
5. [MED] HistoryPicker (session rewind affordance),
6. [MED] MemoryInspector (layered color coding).

---

*End of 06-capability-matrix.*
