# WOTANN iOS — Physical-Device Test Checklist

**Purpose.** This checklist is the canonical pre-release pass for WOTANN iOS on a *real* iPhone (and paired Mac). The Simulator is explicitly insufficient because too many code paths depend on device-only capabilities (HealthKit health data, NFC, LocalSend multicast, Continuity Camera, Apple Watch pairing, APNS push, CarPlay hardware, Live Activities on Dynamic Island, realistic network conditions).

**How to use.**
1. Flash the build to the device (see Prerequisites).
2. Walk the sections top-to-bottom. Each section can be run independently if time is tight; the recommended order minimises state resets.
3. For every feature: follow the *Test steps*, compare against *Expected*, record result in *Pass / Fail / Blocked*, and attach the diagnostic log on any fail.
4. File any failure as a GitHub issue with the log dump attached via `DiagnosticLogger.share()`.

**Scope.** iOS app + widgets + intents + share extension + watch companion + CarPlay + Live Activities. Relay/desktop-only code paths are exercised *from* the phone but do not validate desktop-internal correctness.

**Owner.** Gabriel Vuksani. Tests MUST be executed on hardware Gabriel owns (iPhone 15 Pro or newer running iOS 18.x; Apple Watch Series 8+ running watchOS 11.x; CarPlay head unit or CarPlay Simulator attached to the Mac).

**Previous session feedback incorporated:** `feedback_device_awareness.md` (never assume simulator), `feedback_verify_full_chain.md` (rebuild all affected targets before asserting pass), `feedback_wotann_quality_bars.md` (honest stubs, no silent success).

---

## 0. Prerequisites

Before the test pass starts, verify every item. A missing prerequisite will silently fail features and waste hours.

### 0.1 Hardware

- [ ] iPhone 15 Pro or newer (Dynamic Island required for Live Activities tests §12)
- [ ] iPhone is on iOS 18.0 or later; check via `Settings → General → About → iOS Version`
- [ ] Mac running macOS 14+ with Xcode 16+ (check via `xcodebuild -version`)
- [ ] USB-C cable (for Mac ↔ iPhone wired pairing if Wi-Fi trust fails)
- [ ] Apple Watch (Series 8+) paired to the iPhone under test — required for §14
- [ ] CarPlay head unit or the CarPlay Simulator (`Xcode → Open Developer Tool → Simulator → IO → External Displays → CarPlay`) — required for §13
- [ ] Second iPhone (optional, for NFC tap-to-pair §19 and LocalSend §17)

### 0.2 Xcode / provisioning

- [ ] Developer account signed into Xcode (`Xcode → Settings → Accounts`)
- [ ] Device registered at developer.apple.com (automatic via Xcode on first run)
- [ ] Provisioning profile includes the following capabilities:
    - HealthKit (NSHealthShareUsageDescription)
    - Push Notifications + Background Modes (remote-notification)
    - App Groups (`group.com.wotann.shared`)
    - NFC Tag Reading (NSNFCReaderUsageDescription)
    - CarPlay (`com.apple.developer.carplay-apps`)
    - WatchKit companion
- [ ] Provisioning profile regenerated after any entitlement change — `Xcode → Settings → Accounts → Download Manual Profiles`
- [ ] Device trust: on first install, unlock the iPhone and tap "Trust" on the *Developer Mode* prompt

### 0.3 Pairing bytes & desktop state

- [ ] Desktop WOTANN daemon running on the Mac: `wotann engine start` — verify with `wotann engine status`
- [ ] Desktop is advertising via Bonjour on `_wotann._tcp` — verify with `dns-sd -B _wotann._tcp` (shows a record)
- [ ] Same Wi-Fi SSID on Mac and iPhone (or Wi-Fi + Ethernet on the same subnet)
- [ ] Desktop firewall is not blocking inbound TCP on the paired port (default range 38490-38499)
- [ ] ECDH key material on the desktop is unused / not rotated since the last pair attempt — rotating mid-test forces re-pair

### 0.4 Diagnostic setup

- [ ] `Console.app` open on the Mac with the iPhone selected under *Devices*
- [ ] Console filter set to `subsystem:com.wotann.ios` — this matches the subsystem used by `DiagnosticLogger`
- [ ] `idevicesyslog` installed (`brew install libimobiledevice`) for CLI log capture as backup
- [ ] In the app: `Settings → You → Diagnostics → Diagnostic Dump` is visible and enabled
- [ ] Clear prior diagnostic log before the pass: long-press the Diagnostic Dump row → "Clear Log"

### 0.5 Test accounts

- [ ] A test Anthropic / OpenAI / OpenRouter key is available (use a throwaway key — do NOT use production keys)
- [ ] HealthKit data is present on the device: verify `Health.app → Browse → Activity → Steps` shows at least one day of data; without data, §9 silently passes nothing
- [ ] Notifications permission NOT yet granted (we test the grant flow in §15)

---

## 1. App launch + cold start

**What it tests.** App launches without crash; main window renders; lock screen gates as expected when biometric-lock is enabled.

### Test steps

1. Force-quit the app from the App Switcher.
2. Tap the WOTANN icon.
3. Start a stopwatch on another device or screen record with `xcrun simctl io booted recordVideo`.
4. Record "time to first interactive pixel" — the point at which you can tap a tab.

### Expected

- Cold launch < 3.0 s on iPhone 15 Pro
- No crash; Xcode's crash-report folder (`~/Library/Logs/DiagnosticReports/`) has no new `WOTANN-*.ips` files
- Console log shows `launch.completed` at `.info` severity

### Pass / Fail / Blocked

### Known gotchas

- MLX model warm-up can block main thread on first launch; the `OnDeviceModelService` should dispatch warm-up off-main
- Cold launch after device reboot is slower because the dyld shared cache has to be rebuilt — budget 5.0 s there

---

## 2. ECDH pairing

**What it tests.** End-to-end pairing handshake using ECDH + PIN. Verifies the hand-off from Bonjour discovery → pair request → shared-secret derivation → first authenticated RPC.

### Test steps

1. On the desktop: `wotann pair --show-pin` — record the 6-digit PIN.
2. On the phone: fresh install, accept permissions, swipe through onboarding to the Pair screen.
3. Expected: Bonjour discovers the desktop within 3 s; it appears in the "Detected" list with the desktop hostname.
4. Tap the detected desktop.
5. Enter the PIN. Tap Pair.
6. Wait for "Paired" state.

### Expected

- PIN entry accepts only the correct PIN; wrong PIN displays inline error after 1 s and does NOT exchange keys
- After successful pair: encrypted-lock icon appears in Settings → Connection
- A fresh RPC request succeeds: pull-to-refresh on Home tab shows agent list from desktop
- Diagnostic log contains `pairing.ecdh.derived_shared_secret` and `pairing.persisted` events

### Pass / Fail / Blocked

### Known gotchas

- First-time Bonjour discovery requires the Local Network permission prompt; if the user has previously rejected, discovery silently fails — handled via explicit Settings deep link
- ECDH relies on `CryptoKit` — if the device has the Screen Time *Allowed Apps* restriction on cryptography (rare), pairing fails with a misleading error

---

## 3. Remote Desktop (screen mirroring + control)

**What it tests.** The phone receives a live screen stream from the paired desktop, can tap-to-click, and can send keyboard input.

### Test steps

1. After pairing: open `Work → Desktop Control`.
2. Grant Screen Recording permission on the Mac when prompted (System Settings → Privacy & Security → Screen Recording → WOTANN).
3. Wait for the first frame on the phone (budget 5 s).
4. Tap on a window — verify the desktop shows the click.
5. Drag the phone to scroll the desktop — verify scrolling occurs.
6. Tap the keyboard icon; type "hello" — verify the desktop text field receives it.

### Expected

- Frame rate ≥ 24 fps over LAN
- Tap-to-click latency < 150 ms
- No mis-scaling: tapping in the centre of a window clicks in the centre

### Pass / Fail / Blocked

### Known gotchas

- Requires the desktop to be unlocked (screen recording paused on the lock screen)
- If the Mac has multiple displays, only the primary is streamed unless the user switches in Settings

---

## 4. Streaming chat

**What it tests.** End-to-end streaming from user input → desktop → provider → back to the phone as token-by-token rendering.

### Test steps

1. Open `Chat` tab.
2. Compose a prompt that will produce ≥ 5 sentences ("Write a short story about a Viking and a raven").
3. Tap Send.
4. Observe the response rendering.

### Expected

- First token arrives < 2 s after Send
- Rendering is smooth (no batched chunks); cursor animates during streaming
- Mid-stream "Stop" button cancels within 500 ms and shows a partial message
- Completed message is persisted after reopening the app
- Copy-to-clipboard on the message works (test via paste into Notes)

### Pass / Fail / Blocked

### Known gotchas

- Streaming uses WebSocket; dropping to cellular mid-stream should trigger `ConnectivityMonitor` to queue the remainder via `OfflineQueueService`
- If the desktop provider errors (rate limit, key revoked), the error must surface as a visible banner, NOT a silent truncation

---

## 5. Memory search

**What it tests.** Full-text search against the SQLite+FTS5 memory store on the desktop, streamed to the phone.

### Test steps

1. Open `Work → Memory`.
2. In search field: type "test".
3. Observe results.
4. Tap a result; verify the detail view shows the full observation text.

### Expected

- Results appear < 500 ms after typing stops
- Results are relevance-ordered (best matches first)
- Detail view renders markdown correctly
- Empty-state ("No results") appears if the store is empty

### Pass / Fail / Blocked

### Known gotchas

- If the memory store has zero rows, the search will look broken; seed it first with `wotann memory add "test row"` on the desktop
- FTS5 queries with special characters (`*`, `"`) must be escaped; the UI should strip or escape them before sending

---

## 6. Voice (push-to-talk)

**What it tests.** Live audio capture → transcription → send as chat message.

### Test steps

1. Long-press the Floating Ask button (bottom centre of the tab bar).
2. Hold for 5 s while speaking a short sentence.
3. Release.

### Expected

- A waveform appears during recording
- On release: the transcription appears in the chat composer within 2 s
- Tap Send; the message is delivered

### Pass / Fail / Blocked

### Known gotchas

- First-run triggers *two* permission prompts: Microphone and Speech Recognition — both MUST be granted
- Silent audio (muted mic) should NOT produce a fake "..." transcription; check with mic physically covered
- On iOS 18, on-device speech recognition is used when the language is available locally; otherwise cloud — check `Settings → General → Dictation` for the on-device toggle

---

## 7. HealthKit

**What it tests.** Step count, sleep, and active-energy reads, surfaced as a "Health correlation" in the agent context.

### Test steps

1. Open `Settings → You → Health Insights`.
2. Toggle "Enable Health Correlation" ON.
3. Grant read permissions in the system prompt (steps, sleep, active energy).
4. Return to the app; verify the latest step count is displayed.
5. Open `Chat` and ask: "How many steps did I take today?"

### Expected

- Grant flow completes without crash
- Latest step count matches `Health.app`
- Agent response references the real step count, NOT a hallucinated number

### Pass / Fail / Blocked

### Known gotchas

- *Device-only.* Simulator returns empty HealthKit queries — this test CANNOT run on simulator
- If no health data exists on the device, the agent must honestly say "no data" (NOT invent a number)
- HealthKit reads must be scoped to authorised types only — attempting to read heart rate without permission throws and must be handled

---

## 8. Dispatch Inbox

**What it tests.** Outgoing task relay from phone → desktop; desktop executes and posts back a result card.

### Test steps

1. Open `Work → Dispatch`.
2. Tap "New Task".
3. Select a template ("Code review of last commit").
4. Tap Dispatch.
5. Return to Dispatch inbox.

### Expected

- The task appears in the "Running" section with a progress bar
- On completion: result card moves to "Completed"
- Tapping the card opens a detail view with the result text / diff
- If the desktop is disconnected, the task queues and auto-dispatches on reconnect

### Pass / Fail / Blocked

### Known gotchas

- Dispatch requires the desktop to have an agent runtime configured — if not, it must fail loudly, NOT pretend to dispatch

---

## 9. Morning Briefing

**What it tests.** Scheduled pull of health + calendar + cost + recent tasks, formatted as a single briefing.

### Test steps

1. Open `Home → Morning Briefing`.
2. Tap "Refresh Now".
3. Verify the sections: Health, Calendar (next 3 events), Cost (last 24h), Recent Tasks.
4. Open Settings → Briefing; set schedule to 07:00.
5. Background the app; wait until 07:00 (or trigger via `xcrun simctl push` on simulator for schedule logic — but the actual delivery must be tested on device).

### Expected

- Manual refresh returns a briefing in < 3 s
- Scheduled briefing fires at 07:00 ± 15 min (system background scheduler tolerance)
- Delivered as a Local Notification with a rich preview

### Pass / Fail / Blocked

### Known gotchas

- Background scheduled tasks (BGAppRefreshTask) are throttled by the system; on a device with low battery / low usage, the OS may delay the 07:00 fire
- Notifications permission must be granted first (§15)

---

## 10. Meet Mode

**What it tests.** Ultra-minimal "AI co-pilot in a meeting" mode: shows live transcription, key points, and allows one-tap question.

### Test steps

1. From Home: tap "Meet Mode" (or deep-link `wotann://meet`).
2. Grant mic permission if prompted.
3. Have a 60-second conversation with someone near the phone.
4. Observe the transcription and the "Key points" summary.

### Expected

- Transcription is ≥ 85% accurate on clear speech
- Key-point summary updates every ~15 s
- "Ask WOTANN" button sends the current transcript as context and displays a streaming response

### Pass / Fail / Blocked

### Known gotchas

- Simulator has no realistic microphone input; this test must run on device
- Background audio is NOT allowed for privacy — app must pause transcription when backgrounded

---

## 11. Arena (model comparison)

**What it tests.** Same prompt sent to 2-4 models simultaneously; results shown side-by-side.

### Test steps

1. Open `Chat`; switch mode to `Compare`.
2. Select 2 models from different providers (e.g. `anthropic:sonnet`, `openai:gpt-5`).
3. Send the prompt "Write a haiku about Odin".
4. Observe both streams.

### Expected

- Both responses stream in parallel
- Cost + latency + token count shown beneath each response
- A "winner" vote button per model; tapping records the preference to memory

### Pass / Fail / Blocked

### Known gotchas

- Rate limits: both providers need valid keys; if one fails, the other must still complete
- Cost tally must match what the desktop daemon reports (cross-check with `wotann cost today`)

---

## 12. Live Activities (Dynamic Island)

**What it tests.** Long-running tasks surface on the Dynamic Island and Lock Screen with live progress.

### Test steps

1. Dispatch a long-running task from §8 (pick one that will run > 30 s).
2. Lock the phone.
3. Observe the Lock Screen.
4. Unlock and check the Dynamic Island.

### Expected

- Live Activity appears within 2 s of task start
- Progress bar / status updates live (polled every ~15 s)
- Tapping the Live Activity deep-links to the task detail view
- On task completion: Live Activity shows "Done" for 30 s then dismisses

### Pass / Fail / Blocked

### Known gotchas

- Requires iPhone 14 Pro or newer for the Dynamic Island; older iPhones show only the Lock Screen variant
- ActivityKit tokens are sandboxed per task; max 4 concurrent activities — the 5th attempt must fail gracefully

---

## 13. CarPlay

**What it tests.** CarPlay scene shows a minimal "Recent Conversations" + "Ask" list; voice input dictates; responses are read aloud.

### Test steps

1. Connect the phone to a CarPlay head unit (or the CarPlay Simulator).
2. Launch WOTANN from the CarPlay home.
3. Tap "Ask".
4. Say "What tasks are running?".

### Expected

- CarPlay scene loads within 2 s
- Voice prompt accepted; response read aloud via AVSpeechSynthesizer
- List view shows the last 5 conversations

### Pass / Fail / Blocked

### Known gotchas

- CarPlay entitlement must be in the provisioning profile (usually requires Apple approval)
- Text must be readable at arm's length — min 20pt font
- Only "while driving is safe" UI patterns are allowed — Apple will reject anything else in review

---

## 14. Watch companion

**What it tests.** WatchConnectivity messages flow both ways; Watch complication updates with today's cost; quick actions from the watch trigger desktop-side effects.

### Test steps

1. On the watch: open the WOTANN app.
2. Verify: agent count, today cost, desktop-connected indicator are all displayed.
3. Tap "Kill All" — confirm the prompt.
4. On the phone: verify all active agents show cancelled status.
5. Add the WOTANN complication to a watch face; wait 60 s; verify it shows today's cost.

### Expected

- Watch data refreshes within 5 s of phone data changing
- Quick actions (approve all / kill all / run tests / voice input) work end-to-end
- Complication updates within 60 s of a cost change

### Pass / Fail / Blocked

### Known gotchas

- `WCSession.isReachable` requires both devices awake; a sleeping watch returns `false` and the phone must handle that
- Complication refresh budgets are tight (~50 per day); do NOT refresh on every cost change — throttle

---

## 15. Widgets

**What it tests.** Home-screen widgets show live agent status and today cost.

### Test steps

1. Long-press the home screen; tap + → WOTANN → Agent Status widget (small).
2. Add the widget.
3. Wait 60 s.
4. Dispatch a task from the app.
5. Wait 2 min; verify the widget count increments.

### Expected

- Widget renders without "Unable to load" state
- Widget timeline refreshes every 15 min minimum
- Tapping the widget deep-links to Work → Dispatch

### Pass / Fail / Blocked

### Known gotchas

- Widgets are in their own process; they read from `UserDefaults(suiteName: "group.com.wotann.shared")` — must verify the app is writing there (it does, via `writeAgentStatusToSharedDefaults`)
- On iOS 18, widgets can be interactive; tap targets must be ≥ 44pt

---

## 16. Share Extension

**What it tests.** Selecting text or a URL in any other app and sharing it to WOTANN queues it as a new conversation.

### Test steps

1. Open Safari. Select some text. Tap Share.
2. Find "WOTANN" in the share sheet.
3. Tap it. Confirm the preview.
4. Tap Send.
5. Open the WOTANN app. Verify the shared content appears as a new conversation.

### Expected

- WOTANN is discoverable in the share sheet
- Send button is disabled when content is empty
- After send: Share Extension dismisses; on next WOTANN launch, a conversation exists with the shared content as the first message

### Pass / Fail / Blocked

### Known gotchas

- Share extensions have a separate bundle ID (`com.wotann.ios.share`) and must be re-signed when the provisioning profile changes
- Extension and main app share data via `UserDefaults(suiteName: "group.com.wotann.shared")` under the `pendingShares` key

---

## 17. LocalSend (peer-to-peer)

**What it tests.** LocalSend-compatible multicast discovery + TCP transfer to another WOTANN device or a LocalSend client on the same LAN.

### Test steps

1. Open `Settings → File Sharing → Enable LocalSend Discovery`.
2. Open a LocalSend client on a second device on the same LAN.
3. Observe discovery — both devices should appear in each other's list.
4. Send a small file (< 1 MB) from the other device to the phone.
5. Accept the incoming transfer.
6. Verify the file appears in the in-app inbox.

### Expected

- Discovery within 5 s
- Transfer succeeds; file appears with correct size + checksum
- Cancel mid-transfer is clean (no partial file left)

### Pass / Fail / Blocked

### Known gotchas

- LocalSend binds multicast `224.0.0.167:53317`; if the app was launched twice (simulator + device), the second instance fails with EADDRINUSE — WOTANNApp gates activation to opt-in only
- Requires Local Network permission

---

## 18. Intents (Siri Shortcuts)

**What it tests.** App Intents are discoverable via Shortcuts; `AskWOTANNIntent`, `CheckCostIntent`, `EnhancePromptIntent` all execute correctly.

### Test steps

1. Open Shortcuts app. Create new shortcut.
2. Add action → search "WOTANN".
3. Add "Ask WOTANN" → parameter: "What is Valhalla?".
4. Run the shortcut.

### Expected

- All 3 intents appear in Shortcuts search
- "Ask WOTANN" returns a text response within 5 s
- "Check Cost" returns today's cost as a number
- Siri voice invocation works ("Hey Siri, ask WOTANN …")

### Pass / Fail / Blocked

### Known gotchas

- Intents extension is a separate target (`com.wotann.ios.intents`); it needs a subset of the main app's files (see `project.yml`)
- Siri requires the phone to be unlocked OR "Allow When Locked" enabled per intent

---

## 19. NFC pairing

**What it tests.** Tap-to-pair between two iPhones via NDEF.

### Test steps

1. On the desktop / second device: prepare a "Pair Invite" NFC tag or have a second iPhone with WOTANN.
2. On the phone: `Settings → Connection → Pair via NFC`.
3. Hold the two phones back-to-back (or the phone to the NFC tag).
4. Accept the system NFC prompt.

### Expected

- NFC prompt appears within 2 s
- Tag payload decoded; PIN + host + port extracted
- Pairing completes without manual entry

### Pass / Fail / Blocked

### Known gotchas

- *Device-only.* Simulator has no NFC radio
- NFC read requires iPhone 7 or newer; the NSNFCReaderUsageDescription must be in Info.plist (it is)
- Tag payload MUST be signed; unsigned payloads are rejected to prevent MITM

---

## 20. Continuity Camera

**What it tests.** Use the Mac's camera from the phone — or use the phone as a webcam for the Mac — within a WOTANN chat.

### Test steps

1. Ensure Handoff is enabled on both Mac and phone, signed into the same iCloud.
2. From the chat composer: tap the camera icon → "Use iPhone".
3. Take a photo from the Mac-side that uses the phone.
4. Attach to the prompt.

### Expected

- Phone camera viewfinder appears on the Mac
- Captured image attaches to the chat message
- Resolution is preserved (not thumbnailed)

### Pass / Fail / Blocked

### Known gotchas

- Works only over Wi-Fi + Bluetooth on the same iCloud account
- Phone must be within 10 m of the Mac

---

## 21. Deep links (`wotann://`)

**What it tests.** All supported deep link routes resolve correctly.

### Test steps

From Safari / Notes / Messages, tap each link:

1. `wotann://pair?pin=ABC123&host=192.168.1.5&port=3849`
2. `wotann://chat?id=<UUID>` (use an existing conversation UUID from the app)
3. `wotann://dispatch`
4. `wotann://meet`
5. `wotann://agent?id=<UUID>`
6. `wotann://settings`

### Expected

- Each link opens WOTANN and navigates to the correct screen
- `pair` initiates a pair attempt
- `chat` selects the matching conversation; missing UUID is a no-op (no crash)
- `dispatch` selects Work tab → Dispatch view
- `meet` presents the Meet Mode sheet
- `agent` opens Agents with the matching agent selected
- `settings` selects You tab

### Pass / Fail / Blocked

### Known gotchas

- Invalid parameters (non-hex PIN, malformed UUID) must not crash; they must be silently ignored
- If the app is locked (biometric), the deep link must wait for unlock before routing

---

## 22. Offline mode

**What it tests.** App behavior when the desktop is unreachable: queued messages, cached conversations, graceful banners.

### Test steps

1. With the app running and paired: turn off the desktop (or kill the WOTANN daemon).
2. Wait 10 s for the phone to detect disconnection.
3. Observe the UI.
4. Compose a chat message; tap Send.
5. Restart the desktop; observe reconnection.

### Expected

- Disconnection banner appears within 10 s
- Queued message persists in the chat composer with "Pending" state
- On reconnect: queued message auto-sends; "Pending" → "Sent"
- Memory search + recent conversations remain viewable from cache

### Pass / Fail / Blocked

### Known gotchas

- Desktop reconnect uses `ConnectionManager.autoDiscover()` which runs on `onAppear`; force a scene foreground transition to trigger

---

## 23. Push notifications (APNS)

**What it tests.** Remote push notifications from the desktop / relay service.

### Test steps

1. Ensure `Settings → You → Notifications → Enable Notifications` is ON.
2. Grant system push permission when prompted.
3. Verify the APNS device token is logged in the diagnostic log (`push.token.registered`).
4. Trigger a test push from the desktop: `wotann push-test`.
5. Observe the notification.

### Expected

- Permission grant flow completes cleanly
- Device token registered with desktop / relay
- Test push arrives within 5 s
- Tapping the push deep-links to the referenced task / conversation

### Pass / Fail / Blocked

### Known gotchas

- **Requires a paid Apple Developer account** — free accounts cannot register APNS tokens
- Sandbox APNS differs from production; ensure the server targets the correct environment
- A token can rotate; app must re-register on every launch

---

## 24. Dynamic Type (all size classes)

**What it tests.** Text scales correctly at every accessibility size without clipping or overlap.

### Test steps

For each setting in `Settings → Display & Text Size → Text Size`:
1. `xSmall`
2. `Small`
3. `Medium` (default)
4. `Large`
5. `xLarge`
6. `xxLarge`
7. `xxxLarge`
8. `Accessibility Medium`
9. `Accessibility Large`
10. `Accessibility XL`
11. `Accessibility XXL`
12. `Accessibility XXXL`

At each size: open all 4 main tabs; verify no text is clipped, buttons are tappable (≥ 44pt), no overlap with bars.

### Expected

- No clipped text on any tab
- All tappable controls remain ≥ 44pt
- Scroll views adjust for larger content

### Pass / Fail / Blocked

### Known gotchas

- The app uses `wotannScaled()` and `wotannDynamicType()` modifiers that clamp upper sizes to keep dense surfaces (Dispatch, Arena) readable — verify the clamp takes effect at Accessibility XXL+

---

## 25. Dark / Light theme switch

**What it tests.** All screens render correctly in both color schemes, including the OLED-black dark mode and the light mode.

### Test steps

1. `Settings → You → Appearance → Dark`
2. Walk all tabs
3. `Settings → You → Appearance → Light`
4. Walk all tabs
5. `Settings → You → Appearance → System` — switch system appearance and verify live transition

### Expected

- No illegible text in either mode
- Status colors (success, warning, error) remain perceptible in light mode
- No hardcoded black/white that assumes one mode

### Pass / Fail / Blocked

### Known gotchas

- The theme uses `Color.adaptive(light:dark:)` — any color NOT using it is a regression
- Some surfaces (gradient overlays) may look washed-out in light mode — acceptable if text contrast ≥ 4.5:1

---

## Log collection

When any section fails:

1. Trigger a diagnostic dump: `Settings → You → Diagnostics → Diagnostic Dump → Share` — this opens the iOS share sheet with the `.log` file attached.
2. Alternatively, from CLI on the Mac with the phone attached:
   ```bash
   idevicesyslog -u $(idevice_id -l | head -1) | grep com.wotann.ios > /tmp/wotann-device.log
   ```
3. Console.app: apply the filter `subsystem:com.wotann.ios`, right-click → Save Selected Messages As.
4. For crashes: `Settings → Privacy & Security → Analytics & Improvements → Analytics Data` — find `WOTANN-*` entries.
5. Attach the collected log to the GitHub issue; include device model, iOS version, and the section number that failed.

## Environment-hook: `WOTANN_DIAG_DUMP_AT_LAUNCH`

For automated retrieval via `fastlane` or a test runner, set the environment variable:

```
WOTANN_DIAG_DUMP_AT_LAUNCH=1
```

When set, the app opens the share sheet for the current diagnostic log on launch. This is a debug-only hook; production builds with this flag set still require explicit user action to dismiss the sheet.

## Pass criteria

A full pass requires every section to be `Pass` or `Blocked` with a documented reason (e.g. "no paid developer account → APNS skipped"). Any `Fail` blocks the release until a fix + re-test.

---

*Last updated: Session 6 — 2026-04-19. Maintainer: Gabriel Vuksani (gabrielvuks@gmail.com).*
