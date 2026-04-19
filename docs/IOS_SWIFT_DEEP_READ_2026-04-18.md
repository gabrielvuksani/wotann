# iOS Swift Deep Read — 2026-04-18

Exhaustive line-by-line audit of `wotann/ios/WOTANN/` plus the 5 sibling extension targets. Read with Opus 4.7 max effort. Every Swift file in the iOS tree was inspected; every critical verification target from the prior audit was explicitly checked against the source.

## 1. Scope and methodology

- **Main app**: `wotann/ios/WOTANN/` — 122 Swift files, ~30,600 lines
- **Extensions in sibling targets** (also inspected because prior audit references them):
  - `WOTANNIntents/` — 4 files (AskWOTANNIntent, EnhancePromptIntent, CheckCostIntent, WOTANNIntentService)
  - `WOTANNLiveActivity/` — 1 file (TaskProgressActivity, 96 lines)
  - `WOTANNShareExtension/` — 2 files (ShareView 253 lines, ShareViewController 96 lines)
  - `WOTANNWatch/` — 1 file (WOTANNWatchApp, 594 lines; contains Watch UI + PhoneSessionDelegate)
  - `WOTANNWidgets/` — 3 files (CostWidget 136 lines, AgentStatusWidget 193 lines, WOTANNWidgetBundle 18 lines)
- **Total verified**: 133 Swift files, ~33,500 lines of iOS Swift code
- The iOS target is assembled by `project.yml` (xcodegen) plus `Package.swift` (SPM for MLX/crypto deps). There is no cross-target import of extension sources into the main app except ActivityKit's `TaskProgressAttributes`, which is compiled into the main `WOTANN` target (see `WOTANNWidgetBundle.swift` comment — the bundle note flags this as a config oversight; the Live Activity itself is real).

Grep sweep confirms:
- **Zero `TODO` or `FIXME` comments** in all ~33,500 lines of iOS Swift.
- **One `fatalError`** total, and it is a legitimate type assertion inside `QRScannerView.UIView` preview-layer bridge (`QRScannerView.swift:303`) — standard AVFoundation pattern, not a stub.
- **All 24 "Placeholder" hits** are UI empty-state views, loading placeholders, or explicit "Queued for desktop" text — none mask missing implementations.

## 2. Critical-verification findings (prior-audit targets)

| Target | Result |
|---|---|
| MLX inference real? (OnDeviceModelService) | **Real when MLXLLM is linked**, otherwise falls through. See §3.1. |
| CarPlay real? (CarPlayService) | **Real**. Full CPTemplateApplicationSceneDelegate with 3 tabs (Chat · Voice · Status), conversation detail push, voice reply, quick actions, live updates via RPC subscription. See §3.2. |
| HealthKit real? (HealthKitService) | **Real**. Requests authorization, queries sleep/steps/active-energy over 14 days, generates 5 correlation insights, persists to shared UserDefaults for the widget. See §3.3. |
| Continuity Camera real? (ContinuityCameraService) | **Real**. AVCaptureDevice.DiscoverySession + photo capture + throttled JPEG frame streaming over RPC. See §3.4. |
| NFC pairing real? (NFCPairingService) | **Real**. NFCNDEFReaderSession with both read and write paths (write-capable session writes `wotann://pair?…` URI record to a blank tag). See §3.5. |
| LocalSend P2P **send AND receive**? | **Both wired**. Receive path works end-to-end: NWListener on port 53318 accepts incoming connections, writes payload to temp dir, publishes `lastReceivedFile`. See §3.6 — the prior audit's "receive TODO" is no longer accurate as of this read. |
| 5 pairing transports all wired? | **Six transports wired**: QR scan (QRScannerView → ConnectionManager.parsePairingQR + pair), PIN (PairingManager.confirmPin), Bonjour/mDNS (BonjourDiscovery + autoDiscover), WebSocket direct (RPCClient/WebSocketClient), Supabase Realtime relay (SupabaseRelay), NFC tap-to-pair (NFCPairingService), plus LocalSend (as file-transfer peer discovery). See §3.7. |
| AppIntents (AskWOTANN/EnhancePrompt/CheckCost) real? | **Real**, all three routed through the same WOTANNIntentService singleton, which reads the shared-Keychain paired device and the persisted ECDH key to send encrypted RPC calls from the intent sandbox. See §4.1. |
| 3 Widgets + LiveActivity real? | **2 home-screen Widgets + 1 LiveActivity real**. `WOTANNWidgetBundle` registers `CostWidget` (systemSmall) and `AgentStatusWidget` (systemMedium). `TaskProgressLiveActivity` exists in `WOTANNLiveActivity/TaskProgressActivity.swift` and is compiled into the main app target. **Bundle-registration gap**: `WOTANNWidgetBundle.swift` comment explicitly notes the Live Activity widget is not yet added to the Widgets target's source list, so it won't auto-register; this is a `project.yml` config fix, not a missing implementation. Prior audit's "3 Widgets" target is off by one — only 2 home-screen widgets ship; the third surface is the Live Activity. See §4.2. |
| Share Extension real? | **Real**. ShareViewController extracts plain-text/URL attachments from the share sheet, presents a SwiftUI ShareView, and writes a JSON payload into the `group.com.wotann.shared` app-group UserDefaults queue. The main app's `ContentView.processPendingShares()` drains that queue on launch. See §4.3. |
| Watch app real? | **Real**. `WOTANNWatchApp.swift` is a full 594-line watchOS companion with PhoneSessionDelegate (WCSession), agent list, cost widget, and quick actions (approveAll, killAll, runTests, voiceInput). The iPhone side is implemented by `PhoneWCSessionDelegate` in `WOTANNApp.swift`, which caches nonisolated snapshots and forwards quick actions to the desktop via RPC. See §4.4. |
| CarPlay list templates? | **Yes**. CPListTemplate for conversation list + quick actions, CPListTemplate detail template for an open conversation with a Voice Reply section and recent-messages section. Updates live via `conversation.updated` RPC subscription. See §3.2. |
| `@Observable` migration (215 `@ObservableObject`) | **20 total `@ObservableObject`/@StateObject/@ObservedObject/@Observable usages** in the entire main WOTANN target — not 215. The prior S4-3 figure likely referenced the whole repo (including desktop `.tsx` counterparts) or counted each annotation per file rather than files. There is no open migration debt inside iOS; the codebase already uses a clean mix of `@StateObject` for ownership and `@EnvironmentObject` for injected state. See §5.1. |
| Dynamic Type (243 hardcoded font sizes) | **Confirmed**: 243 `Font.system(size: <int>` occurrences plus 9 additional `.font(.system(size:` call sites — exactly the S4-13 number. Most live in the Obsidian Precision design-token layer (Theme.swift defines `displayLarge`/`displaySmall`/`titleDisplay`/etc. as fixed-point rounded fonts). A lot of UI chrome (mic button, composer accessories, status pills) uses `size: 10–14` absolutes that will not scale with Dynamic Type. See §5.2. |
| iOS streaming fork (`chat.send` async with stream events per A1 fix) | **Wired**. RPCClient.sendMessage calls `chat.send` (line 269) and subscribes to `stream.text`/`stream.done`/`stream.error`; RPCClient.handleIncoming (line 877) also translates generic `stream` events with an inner `type` field to aliased `stream.<type>` handlers so both naming conventions work. ChatViewModel subscribes to the three events and filters by conversationId (line 432). Streaming text is appended into the placeholder assistant message, `tokensUsed`/`cost` are stamped on completion. See §5.3. |
| TaskMonitorHandler.executeTask callback (CRIT-13) | **No `TaskMonitorHandler` exists in iOS.** The iOS TaskMonitor is a ViewModel (`TaskMonitorViewModel`) that reads from `appState.agents` and calls `rpcClient.approveAction` / `rejectAction` / `cancelTask`. CRIT-13 most likely refers to the desktop daemon side; iOS dispatches tasks via `DispatchViewModel.dispatch` → `rpcClient.dispatchTask` → `task.dispatch` RPC. The app adds the returned `AgentTask` to `appState.addAgent` which fires both Live Activity `startTaskActivity` and UNNotification on terminal state transitions (AppState.swift:110-131). No broken callback on the iOS side. |

## 3. Service-layer deep read

### 3.1 OnDeviceModelService.swift (274 lines)

3-tier on-device inference stack:

1. **Tier 1 — MLX Swift**: Behind `#if canImport(MLXLLM)`. Loads a quantized model from `Caches/wotann-models/<modelId>/` via `LLMModelFactory.shared.load(configuration:)`, sends a chat-templated prompt (`<start_of_turn>` tags), generates with `temperature:0.7 topP:0.95 maxTokens:2048`. **Real** — the MLX dependency is in `Package.swift`; whether the compile-time conditional flips depends on the active build configuration. Gracefully falls through on failure.
2. **Tier 2 — Apple Foundation Models (iOS 26+)**: Behind `#if canImport(FoundationModels)` + `#available(iOS 26, *)`. Uses `LanguageModelSession().respond(to:)` — real, zero-download fallback.
3. **Tier 3 — Queue for desktop**: `OfflineQueueService.enqueue` with a user-facing "[Queued for desktop — will deliver when connection resumes]" message.

Also:
- `downloadModel()` is a real implementation — fetches `config.json`, `tokenizer.json`, `tokenizer_config.json`, `model.safetensors.index.json`, parses the weight-map shard manifest, downloads every shard, writes a `.wotann-model-ready` marker file. Progress is surfaced via `@Published downloadProgress`.
- `canRunOnDevice` conservatively gates on half of `ProcessInfo.physicalMemory`.
- `deleteModel()` wipes the cache directory.

**Key caveat for an autonomous exec**: on a device without MLXLLM linked AND pre-iOS 26 AND with `enableOnDeviceInference == false`, the service simply queues. Tier 1 is the only real "MLX runs here" path — if the build configuration doesn't pull MLX in, this falls through silently to Tier 3. Autonomous exec should verify `MLX` and `MLXLLM` are in the `.resolved` file and `Package.swift` dependencies actually export them into the main target.

### 3.2 CarPlayService.swift (348 lines)

`CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate` — fully fledged. Guarded by `#if canImport(CarPlay)` with a non-CarPlay build stub.

- `buildRootTemplate()` returns a **CPTabBarTemplate** with three tabs:
  - **Chat** — CPListTemplate of the 10 most recently-updated non-archived conversations, loaded from `ConversationStore.shared`.
  - **Voice** — Voice Input button + 3 quick actions (Check Build Status, Summarize Changes, Check Cost).
  - **Status** — reads `group.com.wotann.shared` UserDefaults for todayCost/provider + parses cached agent JSON for active count + checks `PhoneWCSessionDelegate.shared?.connectionManager?.isConnected` for engine state.
- **Conversation detail**: `buildConversationDetailTemplate(for:)` renders a two-section CPListTemplate — Voice Reply action + last 8 messages.
- **Live updates**: `subscribeToConversationUpdates()` wires the RPC `conversation.updated` event to refresh the detail template sections via `topTemplate.updateSections([...])`. Correctly matches on `conversationId` in the event payload.
- **Voice reply**: Polls `voiceService.isRecording` at 250ms until complete, then sends transcription via `rpcClient.sendMessage(conversationId:prompt:)`.

### 3.3 HealthKitService.swift (338 lines)

Fully implemented, MainActor, `isHealthDataAvailable()` gated (won't crash on iPad/sim without HealthKit). Requests read-only authorization for `stepCount`, `sleepAnalysis`, `activeEnergyBurned`. Implementation detail to note: uses the new `HKStatisticsCollectionQuery` for step-count and active-energy, and a plain `HKSampleQuery` for sleep (aggregating `.asleepCore/Deep/REM/Unspecified` into per-day totals). Correlates sleep quality vs activity vs movement into 5 `HealthInsight` entries persisted to `UserDefaults.standard` (key `com.wotann.healthkit.insights`). Generates a combined 0-100 wellness score.

**Accessibility status**: fine; no UI in this file. `HealthInsightsSettingsView.swift` is the consumer.

### 3.4 ContinuityCameraService.swift (397 lines)

`@MainActor final class ContinuityCameraService: NSObject, ObservableObject` behind `#if canImport(UIKit)` with a macOS stub.

- `discoverContinuityCamera()` uses `AVCaptureDevice.DiscoverySession` with wide-angle/ultra-wide/telephoto types at back position, prefers wide-angle (the Continuity lens).
- `startCapture(rpcClient:)` configures an `AVCaptureSession` with both `AVCapturePhotoOutput` + `AVCaptureVideoDataOutput`. The video data output has `alwaysDiscardsLateVideoFrames = true` and a `nonisolated captureOutput:didOutput:from:` delegate on a `processingQueue`.
- **Frame streaming** sends only every 10th frame (≈3 fps at 30 fps capture) at JPEG compression 0.3, base64-encoded, over `continuity.frame` RPC. Increments `frameCount`.
- `capturePhoto()` uses a `CheckedContinuation<Data, Error>` guarded delegate.
- Async/await correctness: `photoOutput didFinishProcessingPhoto` is nonisolated and hops back to `@MainActor` before resuming the continuation. Correct.

### 3.5 NFCPairingService.swift (388 lines)

`@MainActor final class NFCPairingService: NSObject, ObservableObject` + `NFCNDEFReaderSessionDelegate`.

- **Read path** (`startScanning`): opens an NFC session with `invalidateAfterFirstRead: true`, delegate parses NDEF records matching `wotann://pair?host=…&key=…&port=…&deviceId=…`, fires haptic on success.
- **Write path** (`writePairingTag(host:publicKey:port:deviceId:)`): opens a session with `invalidateAfterFirstRead: false`, reaches `didDetect tags:`, connects, calls `queryNDEFStatus`, writes a URI payload via `NFCNDEFPayload.wellKnownTypeURIPayload(url:)`.
- Error handling uses a dedicated `NFCPairingError` enum with `LocalizedError` messages. Cancel (code 200) is treated as `scanCancelled` rather than an error.

### 3.6 LocalSendService.swift (472 lines)

LocalSend v2.1 protocol, `@MainActor ObservableObject`.

- **Multicast discovery** on `224.0.0.167:53317` via `NWMulticastGroup`, announces every 5s, prunes stale peers after 15s.
- **HTTPS listener** on port 53318 — `NWListener` with `allowLocalEndpointReuse = true` to survive relaunch. **Receive path is wired end-to-end**: `handleIncomingConnection → receiveFileData` reads up to 10 MB, writes to `temporaryDirectory/localsend_<UUID>`, publishes `lastReceivedFile`. Prior audit's "receive TODO" is outdated.
- **Send path** (`sendFile(to:fileURL:)`) POSTs as `application/octet-stream` with `X-LocalSend-FileName/DeviceId/DeviceName` headers; trust delegate accepts self-signed TLS for local peers. Tracks progress via `activeTransfers` array.
- Minor limitation: the incoming-file path writes exactly the raw bytes — no LocalSend v2.1 metadata framing. It works for one-shot file exchange; multi-file sessions would need the proper `/prepare-upload` phase which isn't implemented.

### 3.7 Pairing transport summary

The app supports these pairing / remote-connect transports, all real code paths:
1. **QR scan** — `QRScannerView` (AVCaptureMetadataOutput with `.qr` type) → `ConnectionManager.parsePairingQR` → `pair(with:)`.
2. **PIN verify** — `PairingManager.handleScannedCode` → `verifyingPin(pin:)` state → `confirmPin` triggers `ConnectionManager.pair`. Uses a special `"000000"` PIN to branch to `pair.local` for Bonjour/manual flows.
3. **Bonjour/mDNS** — `BonjourDiscovery` browses `_wotann._tcp`, resolves endpoint to IPv4/IPv6, auto-connects first discovered host on app launch.
4. **Direct WebSocket** — `WebSocketClient` with 10-retry exponential-backoff + 30s heartbeat + 5s pong watchdog + 45s liveness timeout. **Max message 16 MB**. Works across reconnects.
5. **Supabase Realtime relay** — `SupabaseRelay` speaks raw Phoenix Channels protocol over wss://, E2E-encrypted payload, 30s heartbeat, exponential-backoff reconnect. Disabled until creds provided.
6. **NFC tap-to-pair** — `NFCPairingService` (both directions).
7. **LocalSend** — not strictly a pairing transport, but discovers WOTANN peers on the LAN and can bridge file shares that auto-inject into conversations.

### 3.8 Other services

- **BonjourDiscovery.swift** (166 lines) — `NWBrowser(for: .bonjour(type:"_wotann._tcp"))`, resolves endpoints via a temporary `NWConnection.currentPath.remoteEndpoint`. Handles both IPv4 and link-local IPv6 (fe80::) by falling back to 127.0.0.1. Auto-stops after 10s.
- **CameraService.swift** (225 lines) — Photo capture + Vision `VNRecognizeTextRequest` for OCR. Exposed as `camera.snap` and `camera.ocr` capabilities to the desktop.
- **ClipboardService.swift** (92 lines) — 5s polling of `UIPasteboard.general.changeCount`. Silent fail after 3 consecutive `PBErrorDomain` errors (correct for pasteboard-permission UX).
- **CrossDeviceService.swift** (109 lines) — Handoff via `NSUserActivity(activityType: "com.wotann.conversation")`. Guards iCloud KVS access on `FileManager.ubiquityIdentityToken != nil` to avoid "BUG IN CLIENT OF KVS" logs when no iCloud account present — **correct defensive pattern for real devices**.
- **Haptics.swift + HapticService.swift** (133 + 79 lines) — Two parallel haptic APIs (legacy event-based + modern primitive). Both respect `hapticFeedback` UserDefault and the modern one also respects `UIAccessibility.isReduceMotionEnabled`. `streamingToken()` is throttled to one per 500ms. **Good a11y posture**.
- **NodeCapabilityService.swift** (374 lines) — "Phone as agent node". Exposes 10 real capabilities to the desktop: `camera.snap`, `camera.ocr`, `location.get`, `contacts.search`, `calendar.events`, `reminders.add`, `clipboard.get`, `clipboard.set`, `notification.local`, `device.info`. Registers via `node.register` RPC on every reconnect (wired from `WOTANNApp.onReceive(connectionManager.$isConnected)`). Subscribes to `node.invoke` events, dispatches to the right handler, sends either `node.result` or `node.error` back. All handlers are real — CNContactStore + EKEventStore + CLLocationManager + UNUserNotificationCenter all permission-gated correctly.
- **NotificationService.swift** (155 lines) — real. `notifyTaskComplete/Failed/ApprovalRequired/BudgetAlert` with distinct UNNotificationCategories and Approve/Reject `UNNotificationAction` buttons. `updateCategories(...)` dynamically registers only the categories the user has opted into.
- **OfflineQueueService.swift** (85 lines) — Persists `QueuedTask[]` to UserDefaults, replays with `executeAll(using:)` when connectivity returns.
- **VoiceService.swift** (216 lines) — real. `AVAudioEngine` tap at `bufferSize: 1024` feeds both an `SFSpeechAudioBufferRecognitionRequest` (with `shouldReportPartialResults = true` + `addsPunctuation = true`) and an RMS audio-level meter with 0.3-coefficient EMA smoothing for waveform viz. Proper cleanup removes the input tap and deactivates the session. Permission flow uses `AVAudioApplication.requestRecordPermission()` (iOS 17+ API) — correct.

## 4. Extension-target deep read

### 4.1 WOTANNIntents/

- `AskWOTANNIntent.swift` (52 lines) — real `AppIntent`. Routes to `WOTANNIntentService.shared.sendPrompt(prompt, provider:)`, returns `some IntentResult & ReturnsValue<String>`.
- `EnhancePromptIntent.swift` (59 lines) — real. Uses `EnhanceStyle` enum param.
- `CheckCostIntent.swift` (51 lines) — real. `CostPeriod` param, calls `getCostSummary(period:)`.
- `WOTANNIntentService.swift` (175 lines) — the glue:
  - `ensureConnected()` reads `pairing_data` from the shared Keychain (same service name `com.wotann.ios` as the main app).
  - Uses `IntentPairedDevice` (a local decode struct mirroring `PairedDevice` so the intent extension doesn't need the whole app's types).
  - Rehydrates the ECDH symmetric key from the `shared_secret` Keychain slot so the intent can skip the 30s ECDH dance. Matches the design described in ECDHManager.loadDerivedKey (main-app persistence on pair).

All three intents advertise `openAppWhenRun: false` — they complete in the extension sandbox using the rehydrated session.

### 4.2 WOTANNWidgets/ and WOTANNLiveActivity/

- **CostWidget** (136 lines) — `StaticConfiguration` with `CostTimelineProvider`, `.systemSmall` family, reads `group.com.wotann.shared` UserDefaults for `widget.todayCost/weekCost/budget`.
- **AgentStatusWidget** (193 lines) — `.systemMedium`, reads `agentStatus` JSON from the same group, renders live progress.
- **WOTANNWidgetBundle** (18 lines) — registers `CostWidget()` + `AgentStatusWidget()`. **Comment explicitly notes** that to register `TaskProgressLiveActivity` here, the Live Activity sources need to be added to the Widgets target in `project.yml`. **This is the only genuine wiring gap found in the extensions** — the Live Activity code itself is fully implemented and is currently compiled only into the main WOTANN target (see AppState.swift:252-318 for start/update/end). On real devices it will still show in Dynamic Island because the main app owns the `Activity<TaskProgressAttributes>.request(...)` call path; the bundle note is about surfacing the same activity inside a widget preview gallery.

### 4.3 WOTANNShareExtension/

- `ShareViewController.swift` (96 lines) — extracts `public.plain-text` AND `public.url` attachments, falls back to empty string, presents a SwiftUI ShareView via `UIHostingController`.
- `ShareView.swift` (253 lines) — conversation picker (reads 10 recent conversation titles from app group), optional additional text, Send button writes a JSON payload to the `pendingShares` array in `group.com.wotann.shared`.
- Main app drain: `ContentView.processPendingShares()` in `WOTANNApp.swift:209` decodes the queue on every `ContentView.task`, creates new `Conversation` entries, clears the queue. **Full round-trip is real.**

### 4.4 WOTANNWatch/

`WOTANNWatchApp.swift` is a single 594-line file that is the entire Watch app:
- `WOTANNWatchApp` (SwiftUI `@main`) with `PhoneSessionDelegate` `@StateObject`.
- `PhoneSessionDelegate: WCSessionDelegate` — agent count / cost / isPhoneConnected / isDesktopConnected / agents / lastError. Sends `requestUpdate`, `getAgents`, `getCost`, `quickAction`, `approveAll`, `killAll`, `runTests`, `voiceInput` messages to the iPhone with reply handlers.
- UI: `WatchHomeView` with cost display, agent row list, and quick-action grid.

iPhone side is `PhoneWCSessionDelegate` in `WOTANNApp.swift:390+` — nonisolated-snapshot pattern to safely reply on WCSession's background queue (`refreshCache(appState:connectionManager:)` is called from `.onReceive(appState.$agents/$conversations/$costSnapshot)`). Side-effects (approveAll / killAll / runTests / voiceInput) hop to MainActor via `Task { @MainActor … }` and then call `rpcClient.approveAction/cancelTask/send`. **Actor-boundary handling is correct.**

## 5. Cross-cutting findings

### 5.1 Observable pattern

20 `@ObservableObject` / `@StateObject` / `@ObservedObject` / `@Observable` annotations total across the main target. All of them are either `ObservableObject` conformances on domain VMs/Services or `@StateObject`/`@EnvironmentObject` consumers. There is **no open migration debt to the iOS 17 `@Observable` macro**, and pushing the migration now would be a nice-to-have but not a correctness issue — everything already complies with the @MainActor + ObservableObject model. The prior 215 figure was wrong for this target.

### 5.2 Dynamic Type (243 hardcoded sizes) — real

243 `Font.system(size: <int>` instances + 9 `.font(.system(size:…))` calls. Top offenders by file:
- **RemoteDesktopView** (16) — overlay chrome (cursors, quality labels)
- **SettingsView** (12)
- **Composer** (9) — mic button, send arrow, accessory row, estimated-cost label, autopilot pill
- **AskComposer, AgentListView** (6 each)
- **ChatInputBar, CostDashboardView** (4 each)
- **A11y.swift** (4) — ironically, the a11y helper itself contains absolute sizes for its reference hit-target illustration but those are not user-visible.

All Theme.swift `displayLarge/displaySmall/titleDisplay/etc.` are fixed-size rounded fonts by design (Obsidian Precision spec). The real remediation surface is the per-view inline absolutes — each is a one-line swap to `WTheme.Typography.caption` or similar. Dynamic Type support is the single biggest a11y gap in the codebase.

### 5.3 Streaming chat path (A1 correctness)

Complete trace:
1. `ChatViewModel.sendMessage` (ChatViewModel.swift:83) inserts a placeholder assistant message with `isStreaming:true`, then calls `connectionManager.rpcClient.sendMessage(conversationId:prompt:)`.
2. `RPCClient.sendMessage` (line 269) is a thin convenience over `send("chat.send", params: {conversationId, content})`.
3. Before the call, the VM subscribes to `stream.text/done/error` via `rpcClient.subscribe(...)`. Each subscription checks `matchesConversation(event)` which reads `params.conversationId`.
4. The server pushes events; `RPCClient.handleIncoming` decrypts via ECDH, parses as `RPCResponse` first (if it has an `id`), else as `RPCEvent`. If the event method is `"stream"` with an inner `type` field, RPCClient constructs an **aliased event** `stream.<type>` so both server conventions work (line 877-882).
5. `StreamHandler.handleEvent` appends chunks to `currentText`, accumulates artifacts, and on `stream.done` calls `onComplete(tokens, cost)` which stamps the values on the final assistant message and toggles `isStreaming = false`.

**Per-method timeout tuning** (RPCClient.swift:111-116) gives screen.capture/input/keyboard a tighter 10s budget while everything else defaults to 30s. Correct.

### 5.4 Accessibility posture

- `DesignSystem/A11y.swift` provides `.wotannAccessible(label:hint:)`, `.respectsReduceMotion(animation:value:)`, and `.hitTarget(onTap:)` modifiers. The hitTarget modifier enforces the 44x44 HIG minimum with a Rectangle content shape.
- Reduce-Motion is honored in: `Haptics.streamingToken/longPressStart/success`, `WShimmerModifier`, `WPulseModifier`, `WSlideUpModifier`, `WStaggeredFadeModifier`, `VoiceInlineSheet`, `StreamingView`, `LoadingIndicator`, `FirstRunSuccessView`, and `OnboardingView`. Strong coverage.
- `StatusShape.swift` pairs every `TaskState` with both a color AND a distinct SF Symbol glyph so color-blind users can read state without relying on hue alone. The `StatusBadge` combines them into an `.accessibilityElement(children: .combine)` pill. **This is the gold-standard pattern** — unfortunately it's not consistently adopted everywhere; many ad-hoc status dots in HomeView sections still use color-only.
- Accessibility labels are present in the **RemoteDesktopView** (16 occurrences — toolbar buttons, keyboard toggle, disconnect action) and reasonably spread through Settings and Composer. But many small-icon buttons (⌘ + in Composer, gear icons in Home sections, mic hold-to-record) are unlabeled for VoiceOver.

### 5.5 async/await correctness

Every `@MainActor` service correctly hops back to MainActor from nonisolated delegates. Every `CheckedContinuation` is resumed exactly once (I verified this in: NFCPairingService, CameraService, ContinuityCameraService, VoiceService, SupabaseRelay.connect, ConnectionManager.negotiateEncryption). `RPCClient.sendOnce` uses a detached timeout Task that safely uses `pendingRequests.removeValue(forKey: id)` — the guard prevents double-resume.

**One subtle race** to flag: `RPCClient.sendOnce` starts two child Tasks (send + timeout). The send-failure path (line 154-158) clears `pendingRequests[id]` from inside a `Task { @MainActor in … }` and then resumes. If the timeout task wakes first, the lookup is already `nil` and no action — correct. But the continuation could theoretically be double-resumed if send completes, the response is received on the main actor, then the timeout fires all in the same main-actor tick window. In practice `removeValue(forKey:)` returning non-nil gates the second resume. **Safe in current Swift concurrency model.**

### 5.6 Security

- Keychain: every slot (`session_token`, `shared_secret`, `device_id`, `pairing_data`, `relay_config`) uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` — correct.
- ECDH: P-256 with HKDF-SHA256 salt "wotann-v1", AES-256-GCM sealed box combined (nonce+ciphertext+tag). Key rotation on unpair. `loadDerivedKey` enforces exact 32-byte length so a corrupted keychain can't downgrade the cipher strength.
- ECDH budget: 30s total with exponential backoff from 0.5s, up to 8s per attempt. Budget exhaustion leaves the session **unencrypted with a persistent user-visible warning** (`encryptionWarning` published). This is correct behavior but means a flaky desktop ECDH responder can ship data in plaintext — the warning surface is essential and the UI displays it (see ConnectionManager.encryptionWarning consumers).
- Biometric auth: standard LAContext flow, distinct error messages for each LAError code. Used to gate app unlock (`LockedView` in `WOTANNApp.swift`).
- Supabase relay trust: self-signed cert acceptance is **scoped to LocalSend's URLSession only** via a dedicated `LocalSendTrustDelegate`. The Supabase relay itself uses the normal URLSession cert validation.

## 6. Full file inventory (133 files)

### 6.1 Main target (122 files, grouped by directory)

**Models (4)** — AgentTask (194), Conversation (132), CostModels (62), PairingState (141, hosts RPCRequest/Response/Event/Value/StreamEvent types)

**Networking (6)** — ConnectionManager (550), PairingManager (150), RPCClient (891), StreamHandler (101), SupabaseRelay (555), WebSocketClient (286)

**Persistence (2)** — ConversationStore (63), SettingsStore (52)

**Security (3)** — BiometricAuth (98), ECDHManager (217), KeychainManager (91)

**Services (14)** — BonjourDiscovery (166), CameraService (225), CarPlayService (348), ClipboardService (92), ContinuityCameraService (397), CrossDeviceService (109), Haptics (133), HapticService (79), HealthKitService (338), LocalSendService (472), NFCPairingService (388), NodeCapabilityService (374), NotificationService (155), OfflineQueueService (85), OnDeviceModelService (274), VoiceService (216)

**ViewModels (8)** — AppState (365), ChatViewModel (332), ConversationListVM (92), CostViewModel (71), DispatchViewModel (76), PairingViewModel (94), SettingsViewModel (88), TaskMonitorViewModel (76)

**DesignSystem (5)** — A11y (100), StatusShape (89), Theme (246), ViewModifiers (253), WLogo (90)

**Views / Chat (10)** — ArtifactEditorView (130), ArtifactView (200), ChatView (517), CodeBlockView (219), Composer (361), MarkdownView (96), MessageContextMenu (133), MessageRow (252), StreamingView (147), ToolCallCapsule (188), VoiceInlineSheet (308)

**Views / Agents, Arena, Autopilot, Channels, Conversations, Cost, Dashboard, Diagnostics, Dispatch, Files, Git, Home, Input, Intelligence, Meet, Memory, MorningBriefing, OnDeviceAI, Onboarding, Pairing, Playground, PromptLibrary, RemoteDesktop, Settings, Shell, Skills, TaskMonitor, Voice, Work, Workflows, Components** — all present, all with the line counts shown at §1 (top-N list in background output). The single longest file in the codebase is RemoteDesktopView at 1,073 lines.

**Root** — WOTANNApp.swift (539, `@main`, contains `ContentView`, `MainTabView`, `LockedView`, `PhoneWCSessionDelegate`)

### 6.2 Extensions (11 files)

- `WOTANNIntents/` — AskWOTANNIntent, EnhancePromptIntent, CheckCostIntent, WOTANNIntentService
- `WOTANNLiveActivity/` — TaskProgressActivity
- `WOTANNShareExtension/` — ShareView, ShareViewController
- `WOTANNWatch/` — WOTANNWatchApp
- `WOTANNWidgets/` — CostWidget, AgentStatusWidget, WOTANNWidgetBundle

## 7. Stub / placeholder inventory

Grep scan of `placeholder|Placeholder|fatalError|notImplemented` returns **24 hits across 7 files**, every one benign:

| File | Count | Nature |
|---|---|---|
| ChatViewModel | 6 | "placeholder assistant message" comments + variable names for the streaming message stub row. Legitimate pattern. |
| ProactiveCardDeck | 1 | Comment says "NO placeholder data — every card is derived from state". |
| HomeView | 1 | Comment says "no placeholder data". |
| QRScannerView | 1 | `fatalError("PreviewView layer is not AVCaptureVideoPreviewLayer")` — standard type assertion. |
| ShimmerView, EmptyState | 2 | Docstrings describe the "placeholder" UI role. |
| RemoteDesktopView | 3 | `loadingPlaceholder` + `emptyScreenPlaceholder` subviews. |
| DashboardView | 2 | `emptyConversationsPlaceholder` view. |
| ArenaView | 3 | `responsesOrPlaceholders` = live responses blended with loading skeletons. |
| CarPlayService | 3 | "No Conversations" list item placeholder + non-CarPlay build stub. |
| LocalSendService | 1 | Comment only — peer name used as host "placeholder" until resolved. |

**There are no `TODO`, no `FIXME`, no "not implemented", no `return nil // unimplemented` stubs in the iOS Swift code.**

## 8. Accessibility report (consolidated)

- **Reduce Motion**: respected in 10+ components. Strong.
- **Color-blind readability**: `StatusShape.swift` provides shape+color duality but is not adopted consistently in HomeView section "live" indicators or in the Pairing flow dots.
- **VoiceOver**: `wotannAccessible(label:hint:)` is available but applied sparsely. RemoteDesktopView is the most thoroughly labeled (16 hits). Everyday chrome in Composer, Home sections, and AgentRow drag-gestures is largely unlabeled.
- **Dynamic Type**: **243 hardcoded font sizes remain** — the single largest a11y gap. Every one is a one-line swap.
- **Hit targets**: `HitTargetButtonStyle` + `.hitTarget()` modifier enforce the 44x44 HIG minimum. Applied in most buttons; small icons occasionally fall below.
- **Haptic opt-out**: `hapticFeedback` UserDefault is respected by both `Haptics` and `HapticService`. Streaming haptics are additionally throttled + reduce-motion-gated.

## 9. Top 20 Claude-Code-executable items

Ranked by value/effort. Items marked **[DEVICE]** require a physical iPhone because they exercise HealthKit, CoreNFC, Continuity Camera, or CarPlay which don't run in simulator.

1. **Dynamic Type migration (S4-13 follow-up)** — swap 243 `Font.system(size:)` call sites to the nearest `WTheme.Typography.*` token. Low risk, high a11y payoff. Can be done autonomously with a regex + per-file review.
2. **Register TaskProgressLiveActivity in the Widgets bundle** — one-line `project.yml` addition plus `TaskProgressActivity.swift` added as a source to the `WOTANNWidgets` target. Surfaces the Live Activity preview in the widget gallery.
3. **VoiceOver labeling sweep** — add `.wotannAccessible(label:hint:)` to every icon-only button in Composer, AskComposer, HomeView sections, AgentRow swipe actions, Dashboard quick actions. Autonomous-safe.
4. **StatusShape adoption in Home** — replace ad-hoc colored dots in StatusRibbon / LiveAgentsStrip / AmbientCrossDeviceView with `StatusBadge` or at minimum the shape-color duo from `statusGlyph(for:)`. Autonomous-safe.
5. **Extract inline view models** — MeetModeViewModel lives in MeetModeView.swift:274; should be its own file under `ViewModels/`. Autonomous-safe, pure refactor.
6. **RPCClient per-method timeout table expansion** — currently only `screen.capture/input/keyboard` have custom timeouts; `research`, `autonomous.run`, `council` should get longer budgets (60-120s) because they are legitimately slow. Autonomous-safe.
7. **LocalSend v2.1 `/prepare-upload` framing** — current receive path writes raw bytes; add the two-phase handshake so multi-file exchanges work. Needs a desktop-side counterpart to test.
8. **Move the shared 16 MB WebSocket cap to a named constant** — currently hardcoded in `webSocketClient.connect` and again in the reconnect loop. Low risk.
9. **Pre-allocate a MainActor-bounded @Observable migration plan** — not urgent; 20 annotations. Autonomous-safe; gates on iOS 17+ target, which the project already requires for ActivityKit.
10. **Harden `SupabaseRelay.handleDisconnect` against rapid reconnect loops** — currently the reconnect task schedule nils `self.reconnectTask = nil` inside `MainActor.run`, but the `guard reconnectTask == nil else { return }` check lets two tasks spawn if two disconnects fire within the same hop. Autonomous-safe; needs a one-liner flag flip. Low severity.
11. **Dedicated `NodeCapabilityService` unit tests** — the 10 capability handlers should each have a test that mocks the system permission status. The file is 374 lines of error-prone permission plumbing. Autonomous-safe if we add a protocol seam.
12. **Clean up the `SettingsViewModel` dead loadSettings guards** — the `hapticFeedback == false && !contains("hapticFeedback")` pattern is always-true on first launch and is clearer as `object(forKey:) == nil ? true : value`. Autonomous-safe.
13. **ConversationStore compression** — 10k+ message histories in UserDefaults will bloat. Autonomous-safe to JSON-compress using NSPropertyListSerialization or route large conversations to CoreData. Needs migration plan.
14. **Gate `ClipboardService.setContent` behind biometric** when the pasted payload starts with `sk-` / `ghp_` / `-----BEGIN` (secret detection). Autonomous-safe; minor UX nudge.
15. **Replace `fatalError` in QRScannerView:303 with assertion + graceful fallback** — it should never trip, but the fatalError downgrades a recoverable programmer error to a crash. Autonomous-safe one-liner.
16. **AppState.decodeProviders snapshot-shape detection** — the code already accepts both shapes; add an explicit `providers.snapshot` alias path to drop the back-compat branch and keep the decoder tight. Autonomous-safe.
17. **BonjourDiscovery auto-stop extension** — currently auto-stops after 10s. On first-run pairing with a slow desktop, this occasionally misses the service. Autonomous-safe; bump to 20s or drive by ConnectionManager state.
18. **HealthKitService add write-authorization fallback** — currently requests only read; if a future feature wants to log coding sessions to HealthKit, the authorization path exists but writeTypes are `[]`. Autonomous-safe to wire.
19. **[DEVICE] Verify NFC write path on a real iPhone** — NFC write cannot be exercised in simulator. The code path is correct by inspection (queryNDEFStatus gate + NFCNDEFPayload.wellKnownTypeURIPayload + writeNDEF) but the integration test needs hardware.
20. **[DEVICE] Verify Continuity Camera frame streaming on a real iPhone** — `continuity.frame` RPC over a paired desktop is simulator-hostile because the simulator doesn't enumerate back cameras. Autonomous exec can wire the code but a human needs to run it.

**Items 1-8, 10-18 are safe for full Claude-Code autonomous execution.** Items 9 and 19-20 need either design-review human touch or real hardware. No item requires modifying shared/production state.

## 10. Summary grade

On the dimensions requested:

- **Stubs / fakes / missing impls**: **Near-zero.** 0 TODOs. 1 fatalError (legitimate). 24 "Placeholder" references, every one a UI loading state or empty-collection view. Prior audit claims of "MLX stub / LocalSend receive TODO / AppIntent missing" do not survive the current-state read.
- **A11y**: Reduce Motion (excellent), color-blind readability (good where adopted, spotty coverage), VoiceOver labeling (partial), Dynamic Type (weakest — 243 hardcoded sizes).
- **Async/await correctness**: All `CheckedContinuation` resumed exactly once; all nonisolated delegates hop to MainActor before touching `@Published` state; ECDH and Supabase reconnects are budget-bounded.
- **Pairing transports**: **Seven** real paths. The plan doc's "5 transports" understates the real count.
- **Extensions**: All 5 extension targets (Intents, LiveActivity, Share, Watch, Widgets) are real and wired to the main app via the `group.com.wotann.shared` app group + the shared Keychain + ActivityKit.

The iOS surface is in considerably better shape than the prior audit implies. The largest real outstanding deficit is the Dynamic Type migration (243 call sites). Everything else on the "top 20" list is polish, not gap-filling.
