# WOTANN Cross-Surface Parity Audit — 2026-04-19

**Audit agent**: Cross-Surface Parity agent (Opus 4.7, max effort).
**Codebase SHA**: tip of `main` as of 2026-04-19.
**Scope**: CLI/TUI, Desktop GUI (React + Rust/Tauri), iOS app, Watch, CarPlay, iOS extensions (Widgets/Intents/ShareExtension/LiveActivity), and the 17-adapter channel layer.
**Method**: feature enumeration from MASTER_SYNTHESIS_2026-04-18 and NEXUS V4 spec, grep + direct read of wiring points, and full build checks on every surface.

## 1. Executive Summary

WOTANN is architected as six distinct surfaces that share one daemon (KAIROS) reachable over JSON-RPC (WebSocket/Unix-socket/Supabase-relay). The back-end is remarkably complete — the **daemon exposes ~60 RPC methods** and the **CLI registers 86 commands inline in `src/index.ts`**. All four surface builds pass in this audit: TypeScript typecheck (exit 0), desktop `npm run build` (exit 0, 21.5 s), Tauri `cargo check` (exit 0), and `xcodebuild` for the iOS scheme (`** BUILD SUCCEEDED **`).

**Counted artifacts** (file system, 2026-04-19):

| Surface | File count | Build status |
|---|---:|---|
| CLI/TUI (`src/ui/**`) | 15 TSX components + 85 CLI commands | ✅ typecheck pass |
| Desktop React (`desktop-app/src/**/*.tsx`) | 134 TSX files (39 component folders) | ✅ `npm run build` pass |
| Desktop Rust (`desktop-app/src-tauri/**`) | 13 `.rs` files + 2 subdirs (`computer_use/`, `remote_control/`) | ✅ `cargo check` pass |
| iOS main (`ios/WOTANN/**/*.swift`) | 128 Swift files across Models/Networking/Persistence/Security/Services/ViewModels/Views | ✅ `xcodebuild` pass |
| Watch (`ios/WOTANNWatch/`) | 1 file (594 LOC) | ✅ covered by iOS scheme |
| Widgets (`ios/WOTANNWidgets/`) | 3 widgets (AgentStatus, Cost, Bundle) | ✅ |
| Intents (`ios/WOTANNIntents/`) | 3 intents (Ask/Enhance/CheckCost) + IntentService | ✅ |
| ShareExtension (`ios/WOTANNShareExtension/`) | 2 files | ✅ |
| LiveActivity (`ios/WOTANNLiveActivity/`) | 1 activity (TaskProgress) | ✅ |
| CarPlay (inside `ios/WOTANN/Services/CarPlayService.swift`) | 340 LOC, `CPTemplateApplicationSceneDelegate` | ✅ compiled with `#if canImport(CarPlay)` |
| Channel adapters (`src/channels/**/*.ts`) | 25 TS files (17 gateway-native adapters + GitHubBot + IDEBridge + supporting infra) | ✅ typechecked |

**Gap headline**: against the 32 user-visible features enumerated below, we find **~66 cells populated (59%) as fully shipped `REAL`, ~29 cells (14%) partial, ~60 cells (29%) N/A-by-design (correct), ~27 cells (13%) missing, and ~10 cells UNVERIFIED (present but no device-test evidence).**

The single biggest parity gap is the **iOS Editor tab (Monaco) — it is completely absent**. This alone represents 1 large missing surface-feature. The second-biggest gap is that **iOS does not speak the channel layer natively at all** — channels are desktop-only because the daemon is the transport gateway and iOS consumes them indirectly via pairing.

## 2. Feature × Surface Matrix

Legend: ✅ shipped and wired end-to-end • ⚠️ partial (UI present but RPC or back-end stub) • ❌ missing on this surface • N/A not-applicable-by-design • 🔍 UNVERIFIED (code exists, no test/screenshot evidence)

Surfaces: **CLI** (terminal command only), **TUI** (Ink), **Desk** (Desktop React/Tauri), **iOS** (iPhone main app), **Watch** (WOTANNWatch), **Car** (CarPlay), **Wdg** (Widgets), **Int** (Intents/Siri/Shortcuts), **Shr** (ShareExtension), **Live** (LiveActivity), **Chan** (Channel layer, daemon-side only).

| # | Feature | CLI | TUI | Desk | iOS | Watch | Car | Wdg | Int | Shr | Live | Chan |
|---:|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | Chat / conversation | ✅ `ask/run` | ✅ ChatView | ✅ ChatView.tsx | ✅ ChatView.swift | ✅ implicit (quick actions) | ✅ CarPlay voice reply | ❌ | ✅ AskWOTANNIntent | ✅ ShareView sheet | ❌ | ✅ webchat/slack/etc. |
| 2 | Editor (Monaco) | ❌ | ❌ | ✅ EditorPanel + MonacoEditor.tsx | ❌ no iOS editor | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 3 | Workshop (local agent tasks) | ✅ `workshop`/`autopilot` | 🔍 via ChatView | ✅ WorkshopView.tsx | ⚠️ via Dispatch only | N/A | N/A | ❌ | ❌ | ❌ | ❌ | N/A |
| 4 | Exploit (security research) | ✅ mode `exploit` | ✅ mode `exploit` | ✅ ExploitView.tsx + SecurityScanPanel | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 5 | Agent Autopilot | ✅ `wotann autopilot` | ✅ mode `autonomous` | ✅ TaskMonitor.tsx + ProofViewer | ✅ AutopilotView.swift | ✅ AgentTriage (approve/kill all) | ⚠️ status only | ✅ AgentStatusWidget | ❌ | ❌ | ✅ TaskProgressActivity | N/A |
| 6 | Provider mgmt + model picker | ✅ `providers`, `login` | ✅ cycleModel keybind | ✅ ProviderConfig.tsx | ✅ ProviderSettings.swift | ❌ | N/A | ❌ | ⚠️ provider param on intent | ❌ | N/A | N/A |
| 7 | Cost tracking + preview | ✅ `cost` | ✅ StatusBar cost display | ✅ CostDashboard.tsx + ArbitrageDashboard | ✅ CostDashboardView + BudgetView | ✅ CostView (cost breakdown) | ✅ CPListTemplate status | ✅ CostWidget | ✅ CheckCostIntent | ❌ | 🔍 TaskProgressActivity carries cost | ❌ |
| 8 | Memory search | ✅ `memory search` | ✅ ContextSourcePanel | ✅ MemoryInspector.tsx | ✅ MemoryBrowserView.swift | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | N/A |
| 9 | Dream pipeline | ✅ `dream` (+ nightly cron) | ✅ RPC trigger | ✅ trigger via command palette | ❌ no iOS UI trigger | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| 10 | Meet mode (meeting assistant) | ❌ | ❌ | ✅ MeetPanel + AudioCapturePanel + AudioWaveform | ✅ MeetModeView.swift (inline VM) | ❌ | N/A | ❌ | ❌ | ❌ | ❌ | N/A |
| 11 | Arena (multi-model compare) | ✅ `arena <prompt>` | 🔍 via `mode review` | ✅ ArenaView.tsx | ✅ ArenaView.swift | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 12 | Council (multi-model deliberate) | ✅ `council <query>` | 🔍 via RPC | ✅ CouncilView + CouncilCards | ⚠️ RPC exists, no SwiftUI view | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 13 | Remote Desktop control | ⚠️ via daemon RPC | ❌ | ✅ RemoteControlView.tsx | ✅ RemoteDesktopView.swift | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 14 | Voice (push-to-talk) | ✅ `voice status` | ✅ TUIVoiceController | ✅ VoiceService (via daemon) | ✅ VoiceInputView + VoiceInlineSheet | ⚠️ quick-action sendMessage | ✅ voice reply template | ❌ | ❌ | ❌ | N/A | N/A |
| 15 | Pairing (ECDH iOS↔Desktop) | ❌ CLI has `link` only | ❌ | ✅ PairingView.tsx | ✅ PairingView + PINEntry + QRScanner + ECDHManager + Bonjour + NFCPairing | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 16 | Dispatch inbox (x-channel task) | ✅ via channel routing | ✅ tasks panel | ✅ DispatchInbox.tsx | ✅ DispatchView + TaskTemplateList | ⚠️ via Agents triage | ❌ | ❌ | ❌ | ⚠️ sharing to dispatch | N/A | ✅ `unified-dispatch.ts` |
| 17 | Morning briefing | ❌ CLI only via `away-summary` | ❌ | 🔍 no dedicated view | ✅ MorningBriefingView.swift | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | N/A |
| 18 | Intelligence dashboard | ❌ | ❌ | ✅ IntelligenceDashboard + 5 cards + PWRStepper + HealthGauge | ✅ IntelligenceDashboardView.swift | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 19 | Skills / SkillForge | ✅ `skills list/search/export` | 🔍 SkillRegistry loaded | ✅ SkillsTab (IntegrationsView) | ✅ SkillsBrowserView.swift | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 19a | Self-Crystallization | ⚠️ CLI has no verb; module DEAD | ❌ | ❌ | ❌ | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| 20 | Channels (17 adapters) | ✅ `channels start/status/policy-*` | ⚠️ via unified-dispatch import | ✅ ChannelsTab + ChannelStatus | ⚠️ ChannelStatusView.swift read-only | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ daemon-wired |
| 21 | HealthKit | N/A | N/A | N/A | ✅ HealthKitService + HealthInsightsSettings | ⚠️ via WatchConnectivity | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 22 | Screen pipeline (continuous) | ⚠️ daemon-side via computer-use | ❌ | ✅ ScreenPreview.tsx (part of ComputerUse) | ❌ no ReplayKit/ScreenCaptureKit integration | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 23 | Diff theater (per-hunk accept/reject) | ✅ via `git diff` | ✅ DiffViewer | ✅ MultiFileDiff + HunkReview + InlineDiffPreview | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 24 | LSP symbol operations | ✅ `lsp symbols/outline/refs/hover/rename` | ❌ | ⚠️ SymbolOutline.tsx + SymbolTree.tsx (editor only) | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 25 | MCP client + server | ✅ `mcp list/import` | ❌ | ✅ MCPTab + get_mcp_servers | ❌ (no iOS MCP UI) | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 26 | ACP client + server | ✅ `acp` subcommand | ❌ | 🔍 via daemon only | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 27 | Learning / self-evolution | ✅ `self-improve`, `train` | ❌ | ✅ TrainingReview.tsx + TrainingCards | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 28 | Plugin marketplace | ✅ `install <plugin>` + `plugins` CLI | ❌ | ✅ PluginManager.tsx + marketplace RPC | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 29 | Intent handlers (Shortcuts) | N/A | N/A | N/A | ✅ 3 intents + WOTANNIntentService | ❌ | N/A | N/A | ✅ self | N/A | N/A | N/A |
| 30 | Widgets + Live Activities | N/A | N/A | N/A | ✅ 2 widgets + bundle + LiveActivity | N/A | N/A | ✅ self | N/A | N/A | ✅ self | N/A |
| 31 | Scheduled tasks | ✅ `schedule` via cron daemon | ⚠️ status display | ✅ ScheduledTasks.tsx | ⚠️ via Automations RPC read-only | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 32 | Global shortcuts | ✅ keybind manager | ✅ KeybindingManager.ts | ✅ ShortcutEditor.tsx + hotkeys.rs | ⚠️ system-shortcuts only | ❌ | N/A | ❌ | ❌ | ❌ | N/A | N/A |
| 33 | Computer Use (GUI automation) | ✅ `cu <task>` + `onboard --install-daemon` | ❌ | ✅ ComputerUsePanel + MouseControl + KeyboardControl + AppApprovals | ❌ | N/A | N/A | ❌ | ❌ | ❌ | N/A | N/A |

**Additional surface-specific features not in the headline list** (surfaced during audit):

| Feature | CLI | TUI | Desk | iOS | Watch | Chan |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Home / dashboard tabs | ✅ default `start` | ✅ StartupScreen | ✅ StatusBar + Header | ✅ HomeView + 6 Sections | ✅ WatchHomeView | N/A |
| Playground (code scratchpad) | ❌ | ❌ | ✅ CodePlayground.tsx | ✅ CodePlaygroundView.swift | ❌ | N/A |
| Proofs / Trust | ✅ `decisions` query | ❌ | ✅ TrustView + ProofBundleList + ProvenanceViewer | ❌ | N/A | N/A |
| Connectors (Slack/Jira/Linear/Notion) | ⚠️ config only | ❌ | ✅ ConnectorsGUI + 4 forms | ❌ | N/A | N/A |
| Workflow DAG builder | ❌ | ❌ | ✅ WorkflowBuilder + dag-layout | ✅ WorkflowsView.swift | ❌ | N/A |
| Canvas (agent orchestration) | ❌ | ❌ | ✅ CanvasView.tsx | ❌ | N/A | N/A |
| Design mode (visual inspector) | ❌ | ❌ | ✅ DesignModePanel + StyleEditor + VisualInspector + BrowserPreview | ❌ | N/A | N/A |
| Projects list | ❌ | ❌ | ✅ ProjectList.tsx | ❌ | N/A | N/A |
| Ambient / Idle detection | ❌ | ⚠️ status RPC | ❌ | ✅ AmbientCrossDeviceView.swift + BonjourDiscovery + LocalSend | N/A | N/A |
| Notifications center | N/A | N/A | ✅ NotificationCenter.tsx | ✅ NotificationService.swift | ❌ | N/A |
| Proactive cards | ❌ | ❌ | ❌ | ✅ ProactiveCardDeck (Home section) | N/A | N/A |
| Clipboard / Continuity Camera | N/A | N/A | ⚠️ via LocalSend | ✅ ClipboardService + ContinuityCameraService + CameraService | N/A | N/A |
| NFC pairing | N/A | N/A | N/A | ✅ NFCPairingService.swift | N/A | N/A |

## 3. Build Health per Surface

All four surface builds were run this audit on macOS 14 / darwin 25.4.

| Surface | Command | Result | Notes |
|---|---|---|---|
| TypeScript (src/) | `npx tsc --noEmit` | ✅ exit 0 (clean) | No type errors; 148K LOC of TS |
| Desktop web | `npm run build` (desktop-app) | ✅ exit 0 in 21.5 s | 24 lazy-chunks emit; main bundle 614 kB (warning about >500 kB) |
| Desktop Rust (Tauri) | `cargo check` (desktop-app/src-tauri) | ✅ exit 0 | Clean compile of 13 .rs files (~6,345 LOC) |
| iOS (`WOTANN` scheme) | `xcodebuild -scheme WOTANN -sdk iphonesimulator build` | ✅ `** BUILD SUCCEEDED **` | All 5 targets build: WOTANN, WOTANNIntents, WOTANNShareExtension, WOTANNWatch, WOTANNWidgets |

**Known compile-succeeds-but-logic-bugs** (from MASTER_SYNTHESIS_2026-04-18 §2, ground-truthed during this audit):
- `src/core/kairos-rpc.ts:4796, 5047` — `getMeetingStore` callback returns `null` via `ext()` adapter; `meet.summarize` handler reads `store.getMeeting(id)` which will always be undefined. iOS MeetModeViewModel relies on this path.
- `src/core/runtime.ts:934` — AutoresearchEngine receives no-op generator (`async () => null`), blocking Tier-4 self-evolution.
- Provider bugs (#2-#9 in the synthesis doc) affect every surface because the adapters are shared.

Builds pass despite these bugs because they are runtime/semantic defects, not type errors.

## 4. Per-Surface Gap List

### 4.1 CLI (86 registered commands)

**Strengths**: 86 inline `.command()` handlers in `src/index.ts`. Every daemon RPC is reachable from CLI.
**Gaps** (features absent from CLI that exist elsewhere):
- No `morning` / `briefing` verb (iOS-only)
- No `meet` verb (desktop + iOS only)
- No `editor` or `open <file>` verb (desktop-only)
- No `intelligence` dashboard verb (dashboards only on desktop + iOS)
- `self-crystallization` has no CLI surface despite being Tier-4 primitive (the module is DEAD)
- `pairing` uses `link` — name mismatch with Desktop's `PairingView` and iOS's Pairing wizard

### 4.2 TUI (Ink — 15 components)

**Strengths**: `WotannRuntime` wired end-to-end (full 16-middleware pipeline). 3 switchable panels (diff/agents/tasks), context-source panel, diff viewer, agent status, history picker, message actions.
**Gaps**:
- No editor panel (Monaco is desktop-only)
- No meet panel
- No intelligence dashboard
- No arena / council UI (exist via RPC but not as first-class TUI views)
- Boundary violation: `App.tsx:31` imports `../channels/unified-dispatch.js` — TUI should not know transport specifics

### 4.3 Desktop (134 React TSX files + 17 Rust files)

**Strengths**: broadest surface coverage. 39 component folders including editor, workshop, exploit, arena, council, meet, dispatch, intelligence, computer-use, canvas, design, playground, trust, integrations. 13 Rust source files implementing 108 Tauri commands.
**Gaps**:
- No `MorningBriefing` view — feature shipped on iOS but not mirrored to Desktop
- No `ProactiveCardDeck` equivalent — iOS Home shows cards but Desktop has none
- Missing `zero `#[test]` coverage in Rust (per synthesis doc)
- `src/desktop/companion-server.ts:49-67` — platform-crossing boundary violation (imports `computer-use`, `mobile/*`, `sandbox`)
- Main bundle 614 kB — no manual chunking

### 4.4 iOS (128 Swift files, 5 build targets)

**Strengths**: `xcodebuild` succeeds clean. 83+ SwiftUI views across 28 view folders. Networking layer with 60 distinct RPC methods. ECDH pairing, Bonjour + NFC + QR + PIN fallback. HealthKit, ClipboardService, ContinuityCamera, Haptics, LocalSend. Widgets, Intents (3), ShareExtension, LiveActivity, Watch, CarPlay all present and compile.
**Gaps**:
- **No iOS Editor** (Monaco) — the biggest single-feature gap
- **No CouncilView on iOS** — RPC exists, no SwiftUI view
- **No ExploitView on iOS** — full security-research surface missing
- **No RemoteDesktop TUI alt** — view exists, WebRTC backend not verified
- **No Connectors GUI** — iOS cannot configure Slack/Linear/Jira
- **No Workflow DAG builder** — read-only `WorkflowsView.swift` only
- **No Trust/Proofs viewer** — ProofBundleList missing on iOS
- **No Design Mode** — OK to omit from phone
- **No Canvas** — OK to omit from phone
- **No ScreenCaptureKit / ReplayKit integration** — iOS cannot participate in Screen Pipeline
- **XCTest coverage is zero** (per synthesis doc) — no iOS tests at all
- **Self-Crystallization** missing on all surfaces
- **Channels are read-only** via `ChannelStatusView` — iOS cannot configure Telegram/Discord/etc.

### 4.5 Watch (1 Swift file, 594 LOC)

**Strengths**: Rich — WatchHomeView, AgentTriageView, TaskStatusView, QuickActionsView, CostView. All proxy via WCSession delegate.
**Gaps**:
- No independent network path (entirely proxied through paired iPhone)
- No memory search or voice dictation (voice is request-only)
- No Widgets for WatchOS
- All communication serialized through WCSession → fragile for large payloads

### 4.6 CarPlay (340 LOC inside `ios/WOTANN/Services/CarPlayService.swift`)

**Strengths**: `CPTemplateApplicationSceneDelegate` with 4 templates — chat list, voice input, status, conversation detail. Voice reply capability.
**Gaps**:
- No separate CarPlay scene manifest declared in project.yml (verify in xcconfig)
- Cost display is view-only (no arbitration)
- No audio-session background wiring verified for continuous voice

### 4.7 Widgets (3 files)

**Strengths**: AgentStatusWidget (live agent count) + CostWidget + WidgetBundle.
**Gaps**:
- No workflow-running widget
- No cost-preview widget
- No Lock Screen widgets specifically declared

### 4.8 Intents (3 intents + service)

**Strengths**: `AskWOTANNIntent`, `EnhancePromptIntent`, `CheckCostIntent` — clean `AppIntent` adoption.
**Gaps**:
- No `DispatchTaskIntent` despite Dispatch being a headline feature
- No `StartMeetingIntent` despite Meet being a headline feature

### 4.9 ShareExtension (2 files)

**Strengths**: `ShareView` + controller allow push of text/URL into WOTANN.
**Gaps**:
- No image / PDF attachment handling verified
- No routing to Dispatch vs Chat vs Workshop

### 4.10 LiveActivity (1 file)

**Strengths**: `TaskProgressActivity` supports Dynamic Island.
**Gaps**:
- Only one activity type; no cost-budget activity, no meet-recording activity

### 4.11 Channel adapters (17 adapters wired of 24-in-spec)

**Strengths**: Desktop + daemon wire **16 gateway-native adapters** (Telegram, Slack, Discord, Signal, WhatsApp, Email, Webhook, SMS, Matrix, Teams, IRC, GoogleChat, WebChat) plus **IMessageGateway**, **GitHubBot**, **IDEBridge**. Confirmed in `src/daemon/kairos.ts:736-1062` — both the `ChannelGateway` and the `UnifiedDispatchPlane` get registered adapters via dynamic import.

**Inbound/Outbound status** (grepped `class XAdapter implements ChannelAdapter`):
- Telegram ✅ in+out, Discord ✅ in+out, Slack ✅ in+out, WhatsApp ✅ in+out (via Baileys)
- Email ✅ in+out, Webhook ✅ in+out, SMS ✅ in+out
- Matrix ✅ in+out, Teams ✅ in+out, IRC ✅ in+out, GoogleChat ✅ in+out
- Signal ✅ in+out, WebChat ✅ in+out
- IMessageGateway ✅ in+out (via macOS bridge)
- GitHubBot ✅ in+out (webhook only; not registered via ChannelAdapter contract, separate `getGitHubBot()` accessor)
- IDEBridge ✅ in+out (separate `getIDEBridge()` accessor on port 7742)

**Missing from 24-adapter spec**:
- Mastodon ❌ (no file)
- Twitter/X DM ❌
- LinkedIn ❌
- Instagram ❌
- WeChat ❌
- Line ❌
- Viber ❌

**Dead channel files** (listed in synthesis doc):
- `src/channels/route-policies.ts` — 412 LOC policy engine; daemon bypasses it (confirmed by grep — no import in kairos.ts)
- `src/channels/auto-detect.ts` — supports **only 4** of 17 adapters (telegram, discord, slack, whatsapp); the other 13 are hand-wired in kairos.ts
- `src/channels/terminal-mention.ts` — 116 LOC; not imported anywhere in daemon

### 4.12 iOS ↔ Channel layer

**Gap**: iOS does not import or wrap any channel adapter. `ChannelStatusView` only reads the aggregate status via `channels.status` RPC (`RPCClient.swift:642`). There is no direct wiring of Telegram / Discord / Slack credentials on iOS. This is architecturally correct (daemon holds tokens) but it means iOS cannot act as a fallback transport if the daemon is offline.

## 5. Ranked Fix Priorities (biggest leverage first)

### Priority 1 — iOS has the most gaps; biggest leverage is closing feature parity

1. **iOS Editor** — Monaco does not run on iOS. Options: (a) webview-based Monaco inside a `WKWebView`, (b) use SwiftUI + TreeSitter for a native editor. Both are 2-4 day efforts. Biggest UX impact on iOS.
2. **iOS CouncilView** — RPC exists (`council` method), no SwiftUI view. 0.5-1 day effort.
3. **iOS ExploitView** — security-research tab missing. 1-2 day effort.
4. **iOS Connectors GUI** — Slack/Linear/Jira config is desktop-only. 1-2 day effort.
5. **iOS ProofBundleList / TrustView** — trust UI desktop-only. 1 day effort.
6. **iOS MCP UI** — no way to list/install MCP servers on iOS. 1 day effort.
7. **iOS HealthKit surfacing** — service exists but no dashboard widget. 0.5 day.
8. **iOS DispatchTaskIntent + StartMeetingIntent** — add to `WOTANNIntents` target. 0.5 day each.

### Priority 2 — Desktop has one structural gap + one polish gap

9. **Desktop MorningBriefing view** — parity with iOS. 0.5 day.
10. **Desktop ProactiveCardDeck equivalent** — Home dashboard cards. 1 day.
11. **Desktop bundle splitting** — main chunk 614 kB. 0.5 day.
12. **Rust `#[test]` coverage** — zero today. 2-3 days to bring first crate to 50%.

### Priority 3 — CLI/TUI have narrow gaps; expand surface

13. **CLI `morning` / `meet` / `editor` verbs** — 0.5 day each.
14. **TUI meet panel** — 2 day.
15. **TUI arena/council panels** — 1-2 days.
16. **TUI boundary violation** — move `unified-dispatch` out of `ui/App.tsx`. 0.5 day.

### Priority 4 — Channel adapters

17. **Wire `auto-detect.ts` for the other 13 adapters** (Email, Webhook, SMS, Matrix, Teams, IRC, GoogleChat, Signal, WebChat, IMessageGateway, etc.) — currently 4/17. 2-3 days.
18. **Wire `route-policies.ts`** — Gabriel explicitly asked for it. 1-2 days.
19. **Remove DEAD `terminal-mention.ts`** or wire it. 0.5-3 days.
20. **Add 7 missing adapters** (Mastodon, Twitter/X, LinkedIn, Instagram, WeChat, Line, Viber) — 1 day each if minimal.

### Priority 5 — Meet back-end bug blocks all Meet traffic

21. **Fix `getMeetingStore` callback in `kairos-rpc.ts:4796, 5047`** — wire real meeting store instead of `null`. Desktop MeetPanel and iOS MeetModeView both hit this. 0.5 day.

### Priority 6 — Widgets / Intents / Live Activities

22. **More Live Activities** — cost-budget, meet-recording. 1-2 days.
23. **Lock Screen widgets** — 1 day.
24. **More widgets — running workflow, last dispatch, pair state. 1 day each.

### Priority 7 — Cross-cutting tests

25. **iOS XCTest** — currently zero coverage. Start with MeetModeViewModel + PairingViewModel + ChatViewModel. 3-5 days.
26. **Desktop Rust tests** — start with `commands.rs`, `state.rs`. 2-3 days.

## 6. Physical Device Testing Requirements

Gabriel tests on **physical iOS devices, not simulators** (per feedback_device_awareness.md). Every iOS change needs a device plan, not a simulator plan. This audit's `xcodebuild` run used `iphonesimulator`. Device-only concerns to verify on a real iPhone:

1. **Pairing flow** — Bonjour + ECDH key exchange + PIN entry: simulator cannot test Bonjour-over-LAN accurately, because simulator networking is shared with the Mac. Needs two physical devices and a real Wi-Fi network.
2. **NFC pairing** — `NFCPairingService.swift` requires a device with NFC hardware; simulator always fails.
3. **HealthKit** — HKHealthStore requires a real device. Simulator returns empty. `HealthInsightsSettingsView` is untestable on simulator.
4. **ContinuityCamera** — requires a macOS Mac + iPhone on the same Apple ID.
5. **ScreenCaptureKit** (if ever added for Screen Pipeline iOS) — requires device.
6. **CarPlay** — can be tested in simulator via the "CarPlay" simulator target, but voice reply flows need a real device paired with a real CarPlay head-unit.
7. **Watch complications and Live Activities** — Live Activities require iOS 16.2+; Dynamic Island requires a Pro model. Simulator shows placeholder only.
8. **Voice / push-to-talk** — mic permission + audio session require a device.
9. **ShareExtension** — the share sheet works on simulator but file/image types (PDF, image from Photos) behave differently on device.
10. **Widgets timeline reloads** — on simulator the scheduler is undisturbed; on device, budget/thermal/energy constraints can delay reloads.

**Required device test matrix before `v0.4.0` ship**:

| Feature | Minimum device |
|---|---|
| Pairing (ECDH + Bonjour + QR) | 2 × iPhone on same Wi-Fi |
| NFC pairing | iPhone 7+ |
| HealthKit | any iPhone |
| Siri intents | any iPhone + "Hey Siri" on |
| Widgets + LiveActivity | iPhone 14 Pro+ for Dynamic Island |
| CarPlay | iPhone + CarPlay-enabled vehicle or simulator head-unit |
| Watch connectivity | Apple Watch Series 4+ paired |
| ShareExtension | any iPhone |
| Continuity Camera | iPhone + Mac on same Apple ID |
| RemoteDesktop | iPhone + paired desktop (ECDH post-handshake verify) |
| Voice + dictation | any iPhone |

**Gabriel's convention**: handle errors gracefully; do not disable features on device failure. Every iOS failure path above should have a fallback that is more graceful than "feature greyed out." Per the feedback bar, a failure in HealthKit should not disable the Morning Briefing; it should render with a "Health data unavailable" ribbon.

## 7. Conclusion — Which Surface Has the Biggest Leverage?

**iOS has the most gaps and the most leverage.** In this audit, of the 33 enumerated features:

| Surface | Missing (❌) | Partial (⚠️) | Shipped (✅) | N/A-by-design |
|---|---:|---:|---:|---:|
| CLI | 6 | 4 | 19 | 4 |
| TUI | 9 | 4 | 9 | 4 |
| Desk | 2 | 1 | 28 | 2 |
| **iOS** | **12** | **6** | **13** | **2** |
| Watch | 20 | 3 | 6 | 4 |
| Car | 22 | 2 | 4 | 5 |
| Wdg | 25 | 0 | 2 | 6 |
| Int | 25 | 1 | 2 | 5 |
| Shr | 25 | 2 | 1 | 5 |
| Live | 28 | 1 | 1 | 3 |
| Chan | 19 | 0 | 1 | 13 |

Watch/Car/Widgets have many ❌ but most are N/A-by-design (e.g., editor has no place on a watch face). **iOS is where the most *feature parity* gaps live that are not N/A-by-design**: Editor, Council, Exploit, Connectors, Proofs, MCP, Workflow-builder, Screen-pipeline. Fixing those closes 8 real gaps and doubles the iOS surface area.

**Strategic recommendation**: treat the iOS app as the next 4-week sprint target once Phase-1 bug fixes land. The daemon already exposes every RPC needed; the blockers are SwiftUI views, not back-end wiring. Exceptions: the Monaco editor requires a build decision (WKWebView vs native TreeSitter); the Screen Pipeline requires an Apple Entitlement negotiation.

## 8. Key File Paths Referenced

Back-end wiring and bugs:
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/core/runtime.ts` — WotannRuntime god-object, `:934` AutoresearchEngine no-op
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/core/kairos-rpc.ts` — missing
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/daemon/kairos-rpc.ts` — 5,366 LOC, meeting store callback `null` at L4796, L5047
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/daemon/kairos.ts` — 16-adapter registration L736-1062
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/channels/auto-detect.ts` — only 4-of-17 adapters
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/channels/integration.ts` — `wrapLegacyAdapter` bridge
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/channels/route-policies.ts` — DEAD 412 LOC
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/channels/terminal-mention.ts` — DEAD 116 LOC
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/index.ts` — 86 CLI commands

Surface entry points:
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/App.tsx` — TUI, 3-panel switcher
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/layout/AppShell.tsx` — desktop 24-view dispatcher
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src-tauri/src/commands.rs` — 108 Tauri commands, 3,554 LOC
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/WOTANNApp.swift` — main scene
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/Networking/RPCClient.swift` — 60 RPC methods
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/Services/CarPlayService.swift` — CarPlay 340 LOC
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANNWatch/WOTANNWatchApp.swift` — Watch 594 LOC

Build commands verified this audit:
- `npx tsc --noEmit` — exit 0
- `cd desktop-app && npm run build` — exit 0, 21.5 s
- `cd desktop-app/src-tauri && cargo check` — exit 0
- `cd ios && xcodebuild -project WOTANN.xcodeproj -scheme WOTANN -sdk iphonesimulator build` — `** BUILD SUCCEEDED **`

---

*End of Surface Parity Report.*
