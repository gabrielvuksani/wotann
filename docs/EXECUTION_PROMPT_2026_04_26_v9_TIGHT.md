# WOTANN — TIGHT EXECUTION PROMPT v9 (2026-04-26)

**Paste into a fresh Claude Code session running Opus 4.7 (1M ctx) with auto + bypass mode.**

---

## TASK

You are Claude Opus 4.7 (1M ctx) executing WOTANN V9 GA brutal-honesty post-correction round 3. v8 closed 14 SHIP-BLOCKERS. v9 verification (4 parallel META-AUDITs I/J/K/L) confirmed all 14 valid AND surfaced **7 NEW SHIP-BLOCKERS** that nobody had checked before:
- 3 iOS App Submission Readiness (AppShortcutsProvider duplicate, Continuity/UL/Spotlight all theatrical, BGTaskScheduler entirely missing)
- 4 macOS Distribution Readiness (Tauri auto-updater pubkey is TODO placeholder, signingIdentity null, sqlite-vec writes without WAL, no notarization script)

v9 also EMPIRICALLY squashed the v7-vs-v8 dead-defense contradiction (BOTH partially wrong; truth ~1490 LOC dead; 2 zombie instances introduced new pattern). And web-verified 12/13 META-AUDIT-G claims (G-6 rustls-webpki CVE numbers misattributed — should cite GHSA/RUSTSEC IDs).

**TIER 0 — Day-and-a-half: ~150 LOC across 18 files closes V9 GA shippability for BOTH App Store iOS and DMG macOS.**
**TIER 1+ — Multi-week cleanup follows.**

**Working directory**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann`
**HEAD baseline**: `5f57e55` (v8 prompt committed; current working tree)

---

## STEP 0 — RECOVERY (5 min)

Run in parallel:

```
mem_context project=wotann limit=40
mem_search project=wotann query="v9 brutal meta audit ship blockers iOS macOS distribution"
mem_search project=wotann query="AASA file HTML homepage Universal Links broken production"
mem_search project=wotann query="BGTaskScheduler missing UIBackgroundModes processing App Review fail"
mem_search project=wotann query="Tauri updater pubkey TODO signingIdentity null notarization script"
mem_search project=wotann query="sqlite-vec WAL data loss memory vector store"
mem_search project=wotann query="dead defense plugin-scanner privacy-router zombie instance"
```

**READ THESE FILES IN FULL** (priority order):

1. **`/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_26_BRUTAL_v9.md`** ← **PRIMARY EXECUTION CONTEXT** (~570 lines, single source of truth, supersedes v8/v7)
2. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_26_BRUTAL_v8.md` (referenced for v7+v8 SB detail; v9 §1 abbreviates)
3. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md` (Quality Bars #1-18 + provider-neutrality)
4. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md`
5. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/RELEASE_INFRA.md`
6. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs`

**Optional reference**:
- `docs/EXECUTION_PROMPT_2026_04_26_v8_TIGHT.md` (v8 prompt — superseded)

---

## STEP 1 — PRE-FLIGHT (5 min)

```bash
git status --short              # confirm clean working tree
git log --oneline -5            # confirm HEAD = 5f57e55 (or descendant)
npx tsc --noEmit 2>&1 | tail -5
cd desktop-app && npm run build 2>&1 | tail -5 ; cd ..
node scripts/v9-drift-check.mjs # expect 6/6 OK
npx vitest run --reporter=default 2>&1 | tail -5  # expect 9552 passing baseline
gh run list --limit 3 --json conclusion,displayTitle
find . -name '* 2.*' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | wc -l
npm audit --omit=dev 2>&1 | tail -3   # expect 0 vulns
cd desktop-app && npm audit 2>&1 | tail -5 ; cd ..
cd desktop-app/src-tauri && cargo audit 2>&1 | tail -10 ; cd ../..  # expect 22 advisories on Linux GTK/X11 stack (HIGH)
```

**Then run TIER 0 NEW v9 reproducers BEFORE fixing**:

```bash
# SB-N4 (v9 NEW): AppShortcutsProvider duplicate
grep -rn "AppShortcutsProvider" ios/ | grep -v "//" | head -5
# Expect: 2 declarations — AskWOTANNShortcuts (ext) + WOTANNControlAppShortcuts (main)

# SB-N5 (v9 NEW): Universal Links AASA file MISSING in production
curl -sS -w "\n--- Content-Type: %{content_type}\n" https://wotann.com/.well-known/apple-app-site-association | head -3
# Expect: text/html (NOT application/json)
python3 -c "import plistlib; p=plistlib.load(open('ios/WOTANN/Info.plist','rb')); print('NSUserActivityTypes:', p.get('NSUserActivityTypes', 'NOT SET'))"
# Expect: NOT SET
grep -rln "onContinueUserActivity\|continueUserActivity" ios/WOTANN/WOTANNApp.swift
# Expect: 0 (handler missing)
grep -rln "CSSearchableItem\|CoreSpotlight" ios/
# Expect: 0 (no Spotlight indexing)

# SB-N6 (v9 NEW): BGTaskScheduler entirely missing
python3 -c "import plistlib; p=plistlib.load(open('ios/WOTANN/Info.plist','rb')); print('BGTasks:', p.get('BGTaskSchedulerPermittedIdentifiers', 'NOT SET'))"
# Expect: NOT SET
grep -rln "BGTaskScheduler.shared.register\|BGTaskScheduler\.shared\.submit" ios/
# Expect: 0
grep -A3 "UIBackgroundModes" ios/WOTANN/Info.plist | head -10
# Expect: includes 'processing' (unbacked claim)

# SB-N7 (v9 NEW): Tauri updater pubkey TODO
grep -n "TODO-USER-ACTION\|pubkey" desktop-app/src-tauri/tauri.conf.json
# Expect: TODO placeholder

# SB-N8 (v9 NEW): macOS signingIdentity null
grep -n "signingIdentity" desktop-app/src-tauri/tauri.conf.json
# Expect: "signingIdentity": null

# SB-N9 (v9 NEW): sqlite-vec writes without WAL
grep -n "journal_mode" src/memory/sqlite-vec-backend.ts
# Expect: 0 hits (data loss risk)

# SB-N10 (v9 NEW): No notarization script
ls scripts/release/ | grep -i "notariz\|notarize"
# Expect: 0 hits
```

---

## STEP 2 — TIER 0 EXECUTION (DAY-AND-A-HALF MAX)

Total ~150 LOC across 18 files. v8 carryover: SB-NEW-1..5, SB-N1, SB-N2, SB-N3, NB-5 (per `docs/EXECUTION_PROMPT_2026_04_26_v8_TIGHT.md` §STEP 2 details — not duplicated here).

### v9 NEW iOS SHIP-BLOCKERS (3) — App Store submission readiness

#### SB-N4: Consolidate AppShortcutsProvider in main target

**Files**: `ios/WOTANN/Models/ControlWidgetIntents.swift` (consolidate) + `ios/WOTANNIntents/AskWOTANNIntent.swift:45-88` (delete shadow)

**Strategy**:
1. In `ios/WOTANN/Models/ControlWidgetIntents.swift`: extend `WOTANNControlAppShortcuts` to also include AskWOTANNIntent + RewriteWithWOTANNIntent + SummarizeWithWOTANNIntent + ExpandWithWOTANNIntent + EnhancePromptIntent + CheckCostIntent
2. In `ios/WOTANNIntents/AskWOTANNIntent.swift:45-88`: DELETE the `AskWOTANNShortcuts: AppShortcutsProvider` struct (the comment correctly notes "iOS only allows a single AppShortcutsProvider per app target" — but currently TWO are declared and main wins)
3. Update `ios/WOTANNIntents/Info.plist` IntentsSupported array to include all 7 intents (currently only 3: Ask + CheckCost + EnhancePrompt — missing Rewrite, Summarize, Expand, AskWOTANN-extension)

**Verify**:
```bash
grep -c "AppShortcutsProvider" ios/WOTANN/Models/ControlWidgetIntents.swift
# Expect: 1
grep -c "AppShortcutsProvider" ios/WOTANNIntents/AskWOTANNIntent.swift
# Expect: 0 (deleted)
```

After build, on a real device confirm: Spotlight search for "Ask WOTANN" shows the Siri shortcut (currently dead).

---

#### SB-N5: Wire iOS Continuity/Universal Links/Spotlight (full surface)

**Files**: `ios/WOTANN/WOTANNApp.swift` + `ios/WOTANN/Info.plist` + `ios/WOTANN/WOTANN.entitlements` + `wotann.com/.well-known/apple-app-site-association` (deployment side)

**Strategy** — 5 parts:

1. **AASA file (production deployment)**: deploy a JSON file at `https://wotann.com/.well-known/apple-app-site-association` (NOT the HTML homepage). Required content (replace TEAMID with actual Apple Team ID):
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.com.wotann.ios",
        "paths": ["/share/*", "/conversation/*", "/pair/*"]
      }
    ]
  }
}
```
Serve with `Content-Type: application/json`. Verify with `curl -I https://wotann.com/.well-known/apple-app-site-association`.

2. **Drop dev-mode entitlement**: `ios/WOTANN/WOTANN.entitlements:62` → change `applinks:wotann.com?mode=developer` to `applinks:wotann.com` (production mode requires real AASA file from step 1).

3. **NSUserActivityTypes plist key**: add to `ios/WOTANN/Info.plist`:
```xml
<key>NSUserActivityTypes</key>
<array>
    <string>com.wotann.conversation</string>
    <string>com.wotann.pair</string>
</array>
```

4. **`onContinueUserActivity` handler in WOTANNApp.swift root scene**:
```swift
WindowGroup {
    ContentView()
        .onContinueUserActivity("com.wotann.conversation") { userActivity in
            // Resume conversation from another device
            if let convoId = userActivity.userInfo?["conversationId"] as? String {
                Task { @MainActor in
                    await ConversationStore.shared.openConversation(id: convoId)
                }
            }
        }
        .onOpenURL { url in
            // Universal Link handler — wotann://, https://wotann.com/share/...
            DeepLinkRouter.handle(url)
        }
}
```

5. **CSSearchableItem indexing** (Spotlight): add to `ConversationStore.shared` a method that when a conversation is created/updated, calls:
```swift
let attributeSet = CSSearchableItemAttributeSet(itemContentType: kUTTypeText as String)
attributeSet.title = conversation.title
attributeSet.contentDescription = conversation.lastMessageSnippet
let item = CSSearchableItem(uniqueIdentifier: conversation.id, domainIdentifier: "com.wotann.conversation", attributeSet: attributeSet)
CSSearchableIndex.default().indexSearchableItems([item])
```

**Verify**:
```bash
curl -sS -w "Content-Type: %{content_type}\n" https://wotann.com/.well-known/apple-app-site-association | tail -2
# Expect: Content-Type: application/json
python3 -c "import plistlib; p=plistlib.load(open('ios/WOTANN/Info.plist','rb')); print(p.get('NSUserActivityTypes'))"
# Expect: ['com.wotann.conversation', 'com.wotann.pair']
grep -c "onContinueUserActivity" ios/WOTANN/WOTANNApp.swift
# Expect: 1+
```

---

#### SB-N6: Implement BGTaskScheduler OR drop unused background mode

**Files**: `ios/WOTANN/WOTANNApp.swift` + `ios/WOTANN/Info.plist` + new `ios/WOTANN/Services/BackgroundTaskCoordinator.swift`

**Strategy** — pick ONE:

**Option A (recommended)**: Implement BGTaskScheduler for offline queue flush + memory sync.

1. Add to `ios/WOTANN/Info.plist`:
```xml
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.wotann.ios.offlinequeue.flush</string>
    <string>com.wotann.ios.memory.sync</string>
</array>
```

2. Create `ios/WOTANN/Services/BackgroundTaskCoordinator.swift`:
```swift
import BackgroundTasks
import Foundation

@MainActor
final class BackgroundTaskCoordinator {
    static let shared = BackgroundTaskCoordinator()

    func registerTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: "com.wotann.ios.offlinequeue.flush",
            using: nil
        ) { task in
            self.handleOfflineQueueFlush(task: task as! BGProcessingTask)
        }
        // Repeat for memory.sync
    }

    func scheduleOfflineQueueFlush() {
        let request = BGProcessingTaskRequest(identifier: "com.wotann.ios.offlinequeue.flush")
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(request)
    }

    private func handleOfflineQueueFlush(task: BGProcessingTask) {
        // Delegate to OfflineQueueService.flushOnBackground (per H-E14 fix)
        Task {
            await OfflineQueueService.shared.flushOnBackground { success in
                task.setTaskCompleted(success: success)
            }
        }
        scheduleOfflineQueueFlush()  // re-schedule
    }
}
```

3. In `WOTANNApp.swift:wireServices()`:
```swift
BackgroundTaskCoordinator.shared.registerTasks()
```

4. In `handleScenePhaseChange` `.background` case:
```swift
BackgroundTaskCoordinator.shared.scheduleOfflineQueueFlush()
```

**Option B (faster, ship-blocker minimum)**: Drop `processing` from UIBackgroundModes. Requires:
- Remove `processing` from `ios/WOTANN/Info.plist` UIBackgroundModes array
- Remove or comment out flushOnBackground references that depend on it
- App passes Apple App Review guideline 2.5.4

**Verify**:
```bash
python3 -c "import plistlib; p=plistlib.load(open('ios/WOTANN/Info.plist','rb')); print('UIBackgroundModes:', p.get('UIBackgroundModes')); print('BGTaskSchedulerPermittedIdentifiers:', p.get('BGTaskSchedulerPermittedIdentifiers'))"
# Option A expects: both populated
# Option B expects: UIBackgroundModes WITHOUT 'processing', BGTask key not set
```

---

### v9 NEW macOS SHIP-BLOCKERS (4) — DMG distribution readiness

#### SB-N7: Generate Tauri updater keypair

**File**: `desktop-app/src-tauri/tauri.conf.json:61`

```bash
cd desktop-app/src-tauri
npx @tauri-apps/cli signer generate
# Outputs: ~/.tauri/wotann.key + ~/.tauri/wotann.key.pub
```

Then paste the **public key CONTENT** (NOT path — per META-AUDIT-G G-7 confirmed) into `tauri.conf.json:61`:
```json
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...."
```

Store the private key in 1Password / your secrets manager. **NEVER commit it.**

**Verify**:
```bash
grep -n "TODO-USER-ACTION\|^.*pubkey.*:" desktop-app/src-tauri/tauri.conf.json
# Expect: pubkey line shows real PEM content, no TODO placeholder
```

---

#### SB-N8: Set macOS signingIdentity

**File**: `desktop-app/src-tauri/tauri.conf.json:44`

```bash
# Find your signing identity:
security find-identity -v -p codesigning
# Look for: Developer ID Application: Gabriel Vuksani (TEAMID)
```

Then update `tauri.conf.json:44`:
```json
"signingIdentity": "Developer ID Application: Gabriel Vuksani (XXXXXXXXXX)"
```

Plus add `Entitlements.mac.plist` for Hardened Runtime (required for notarization):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
    <key>com.apple.security.network.client</key><true/>
    <key>com.apple.security.network.server</key><true/>
</dict>
</plist>
```

Reference from `tauri.conf.json` macOS section.

**Verify**:
```bash
grep -A1 "signingIdentity" desktop-app/src-tauri/tauri.conf.json
# Expect: identity string, NOT null
ls desktop-app/src-tauri/Entitlements.mac.plist
# Expect: file exists
```

---

#### SB-N9: Add WAL mode to sqlite-vec-backend.ts (data loss prevention)

**File**: `src/memory/sqlite-vec-backend.ts`

**Strategy**: Add `pragma("journal_mode = WAL"); pragma("synchronous = NORMAL"); pragma("foreign_keys = ON"); pragma("busy_timeout = 5000")` BEFORE first write. Mirror the pattern already in `src/memory/store.ts:389` and `src/orchestration/plan-store.ts:135`.

Refactor: extract a helper `initSqliteStore(db: Database, options?: { walMode?: boolean })` to `src/utils/sqlite-store-init.ts` and call it from ALL 7 SQLite stores so future stores can't forget. Stores to update:
- `src/memory/store.ts` (already WAL — leave but use helper)
- `src/orchestration/plan-store.ts` (already WAL — leave but use helper)
- `src/telemetry/audit-trail.ts` (already WAL — leave but use helper)
- `src/meet/meeting-store.ts` (already WAL — leave but use helper)
- `src/scheduler/schedule-store.ts` (already WAL — leave but use helper)
- `src/daemon/cron-store.ts` (already WAL — leave but use helper)
- **`src/memory/sqlite-vec-backend.ts` (NEW — WAL + helper)** ← actual fix

**Verify**:
```bash
grep -n "journal_mode" src/memory/sqlite-vec-backend.ts
# Expect: 1+ hit
ls src/utils/sqlite-store-init.ts
# Expect: file exists
```

---

#### SB-N10: macOS notarization script

**File**: NEW `scripts/release/notarize-macos.sh`

```bash
#!/bin/bash
# notarize-macos.sh — Submit macOS DMG to Apple notarization service.
# Required since macOS Mojave for distribution outside the App Store.

set -euo pipefail

DMG_PATH="${1:-desktop-app/src-tauri/target/release/bundle/dmg/WOTANN.dmg}"
APPLE_ID="${APPLE_ID:?APPLE_ID env var required}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:?APPLE_TEAM_ID env var required}"
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD env var required (app-specific password)}"

if [ ! -f "$DMG_PATH" ]; then
    echo "ERROR: DMG not found at $DMG_PATH"
    exit 1
fi

echo "Submitting $DMG_PATH for notarization..."
xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait \
    --timeout 30m

echo "Stapling notarization ticket to DMG..."
xcrun stapler staple "$DMG_PATH"

echo "Verifying staple..."
xcrun stapler validate "$DMG_PATH"

echo "Notarization complete: $DMG_PATH"
```

`chmod +x scripts/release/notarize-macos.sh`. Document in `docs/RELEASE_INFRA.md` that env vars `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` must be set before running.

**Verify**:
```bash
ls -la scripts/release/notarize-macos.sh
# Expect: file exists, executable
bash -n scripts/release/notarize-macos.sh
# Expect: syntax check passes
```

---

## STEP 3 — VERIFICATION (45 min)

After all 21 SHIP-BLOCKERS (8 v9 NEW + 13 v8 carryover) closed:

```bash
# Type-check + build:
npx tsc --noEmit
cd desktop-app && npm run build && cd ..

# Full test suite:
npx vitest run --reporter=default 2>&1 | tail -5
# Expect: at minimum, no NEW failures vs 9552 baseline

# Drift check:
node scripts/v9-drift-check.mjs

# v8 STEP 3 reproducer suite (provider neutrality + persistence + JSON-RPC + Tauri bundle + wireGateway)
# (See docs/EXECUTION_PROMPT_2026_04_26_v8_TIGHT.md STEP 3 — not duplicated here)

# v9 NEW reproducer suite:

# SB-N4: AppShortcutsProvider single-source
test "$(grep -rn 'AppShortcutsProvider' ios/ | grep -v '//' | wc -l)" -eq 1 && echo "SB-N4 ok"

# SB-N5: AASA + NSUserActivityTypes + handler
test "$(curl -sI https://wotann.com/.well-known/apple-app-site-association | grep -ci 'application/json')" -eq 1 && echo "SB-N5 AASA ok"
python3 -c "import plistlib; p=plistlib.load(open('ios/WOTANN/Info.plist','rb')); assert p.get('NSUserActivityTypes'), 'missing'" && echo "SB-N5 plist ok"
test "$(grep -c 'onContinueUserActivity' ios/WOTANN/WOTANNApp.swift)" -ge 1 && echo "SB-N5 handler ok"

# SB-N6: BGTaskScheduler OR no 'processing' in UIBackgroundModes
python3 -c "
import plistlib
p = plistlib.load(open('ios/WOTANN/Info.plist','rb'))
ubm = p.get('UIBackgroundModes', [])
bg = p.get('BGTaskSchedulerPermittedIdentifiers', [])
if 'processing' in ubm:
    assert bg, 'BGTaskScheduler missing while processing claimed'
    print('SB-N6 Option A: implemented')
else:
    print('SB-N6 Option B: dropped processing mode')
"

# SB-N7: Tauri pubkey real
test -z "$(grep 'TODO-USER-ACTION' desktop-app/src-tauri/tauri.conf.json)" && echo "SB-N7 ok"

# SB-N8: signingIdentity
test "$(grep -c 'signingIdentity.*null' desktop-app/src-tauri/tauri.conf.json)" -eq 0 && echo "SB-N8 ok"

# SB-N9: sqlite-vec WAL
test "$(grep -c 'journal_mode' src/memory/sqlite-vec-backend.ts)" -ge 1 && echo "SB-N9 ok"

# SB-N10: notarization script
test -x scripts/release/notarize-macos.sh && echo "SB-N10 ok"

# Bonus end-to-end: build DMG and notarize (only if Apple Developer signing set up):
# cd desktop-app && npm run tauri build && cd ..
# scripts/release/notarize-macos.sh  # requires APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD env
```

If any verification fails, STOP and fix before proceeding.

---

## STEP 4 — COMMIT + PUSH (10 min)

```bash
git status --short
# Stage all v9 TIER 0 files:
git add -p src/core/runtime.ts src/providers/ollama-adapter.ts src/providers/model-router.ts \
          src/daemon/kairos-rpc.ts src/desktop/companion-server.ts ios/WOTANN/WOTANNApp.swift \
          src/index.ts src/utils/trusted-workspaces.ts \
          src/mcp/mcp-server.ts tests/mcp/mcp-server.test.ts \
          desktop-app/src-tauri/tauri.conf.json desktop-app/src-tauri/src/sidecar.rs \
          desktop-app/src-tauri/Entitlements.mac.plist \
          src/daemon/kairos.ts src/channels/integration.ts \
          ios/WOTANN/Models/ControlWidgetIntents.swift ios/WOTANNIntents/AskWOTANNIntent.swift \
          ios/WOTANNIntents/Info.plist ios/WOTANN/Info.plist ios/WOTANN/WOTANN.entitlements \
          ios/WOTANN/Services/BackgroundTaskCoordinator.swift \
          src/memory/sqlite-vec-backend.ts src/utils/sqlite-store-init.ts \
          scripts/release/notarize-macos.sh

git commit -m "$(cat <<'EOF'
fix(v9): close 21 SHIP-BLOCKERS — TIER 0 closure (v8 carryover + v9 new)

v8 closed 14 SHIP-BLOCKERS via 4 META-AUDITs (E/F/G/H). v9 verification
(4 parallel META-AUDITs I/J/K/L) confirmed all 14 valid AND surfaced 7 NEW
SHIP-BLOCKERS that nobody had checked before.

v8 carryover (14):
- SB-NEW-1: ESM require crash → use `join` (1 LOC)
- SB-NEW-2: Ollama qwen3.5 hardcode → discoverOllamaModels (~10 LOC)
- SB-NEW-3: runtime overrides bootstrapProvider → conditional override (~5 LOC)
- SB-NEW-4: 5 SQLite stores no persistPath → wire all 5 sites (5 LOC)
- SB-NEW-5: iOS LiveActivity restoreActivities never invoked → wire (1-3 LOC)
- SB-N1: `wotann trust` CLI not registered → add command (~10 LOC)
- SB-N2: JSON-RPC error codes spec violations → categorize (~30 LOC + tests)
- SB-N3: Tauri DMG no daemon → externalBin OR resources + sidecar.rs update
- NB-5: wireGateway orphan single-fix → wires 6 channel adapters (~5 LOC)
(SB-NEW-6/7/8/9/10/11 deferred to TIER 1)

v9 NEW iOS App Submission Readiness (3):
- SB-N4: AppShortcutsProvider DUPLICATE shadow bug — consolidate in main target
  (Ask/Rewrite/Summarize/Expand currently dead Siri phrases)
- SB-N5: Continuity/Universal Links/Spotlight FULLY THEATRICAL — wire
  onContinueUserActivity + NSUserActivityTypes plist + AASA JSON file deploy
  + drop ?mode=developer + CSSearchableItem indexing
- SB-N6: BGTaskScheduler entirely missing — implement (Option A: register +
  handlers + permitted IDs plist) OR drop `processing` from UIBackgroundModes
  (App Review guideline 2.5.4 fail without)

v9 NEW macOS Distribution Readiness (4):
- SB-N7: Tauri auto-updater pubkey TODO → run tauri-signer generate, paste
  PEM content (not file path per Tauri 2.x format requirement)
- SB-N8: signingIdentity null → set "Developer ID Application: ..." +
  Entitlements.mac.plist with Hardened Runtime (required for notarization)
- SB-N9: sqlite-vec-backend.ts writes without WAL → add pragma WAL +
  initSqliteStore helper for all 7 stores (data loss risk on crash mid-write)
- SB-N10: No notarization script → scripts/release/notarize-macos.sh wrapping
  xcrun notarytool submit + stapler staple (required since Mojave)

META-AUDIT-I empirically squashed v7-vs-v8 dead-defense contradiction:
BOTH partially wrong. Truth: ~1490 LOC truly dead (60% of v7's 2485 over-claim).
2 zombie instances (plugin-scanner + privacy-router constructed but methods
never invoked) introduce new "ZOMBIE-INSTANCE" pattern beyond grep-orphan.
Lib.ts IS genuine public API per package.json `"./lib": "./dist/lib.js"`.

META-AUDIT-L web-verified 12/13 META-AUDIT-G claims. G-6 PARTIALLY-WRONG:
rustls-webpki version + 4-vuln-count correct, but 3/4 CVE numbers misattributed
(CVE-2024-26308 is Apache Commons Compress, not webpki). Cite GHSA/RUSTSEC IDs
instead.

3 NEW META-PATTERNS named (v9):
- ZOMBIE-INSTANCE (constructed-but-never-invoked; pure-grep misses)
- FALSE-DECLARATION-IN-PLIST (Info.plist claims capability, no code backs it;
  Apple App Review fail)
- SHADOW-PROVIDER-DUPLICATE (Apple-OS singleton API declared twice; OS picks
  one silently, other becomes shadow code)
- DEPLOYMENT-DRIFT-FROM-CODE (codebase aspires, deployment artifacts don't
  match — AASA JSON, signing config, updater pubkey, notarization)

Test suite: 9552 passing baseline maintained.
Build green: TS + desktop-app + Tauri.
Verification: provider neutrality 4 providers, daemon stores persist as SQLite,
JSON-RPC malformed requests return correct codes, Tauri DMG includes daemon,
channel list includes 6 newly-wired adapters, AASA returns JSON not HTML,
NSUserActivityTypes set, BGTaskScheduler registered (or processing mode dropped),
Tauri pubkey real, signingIdentity set, sqlite-vec WAL on, notarize script ready.

Carryover SBs (TIER 1): SB-NEW-6/7/8/9/10/11.
META-AUDIT-J carryover (TIER 1): H-J1 share drain race, H-J2 IntentsSupported
plist 4 missing, H-J3 voice CLI subcommands.
META-AUDIT-K HIGH (TIER 1): H-K1 keytar→@napi-rs/keyring (4+ years archived),
H-K3 reject --api-key flag, H-K4 proactive OAuth rotation, H-K5 GDPR commands.
EOF
)"

git push origin HEAD
```

If push fails on hooks, FIX root cause (do not bypass with `--no-verify`).

---

## STEP 5 — TIER 1 BACKLOG (multi-day)

After TIER 0 closure:

1. **Cross-network Tailscale wave** (~1-2 days; v6/v7/v8 carryover; G-1 confirms 6 users / Unlimited devices)
2. **TUI v2 Phase 1+2 integration into App.tsx** (~5 days; Wave 6-NN+OO handed-off)
3. **iOS app-launch wiring batch 2**:
   - H-E14: `flushOnBackground` wire (now also requires SB-N6 BGTaskScheduler from TIER 0)
   - H-E15: OfflineQueueDLQ Settings surface (~30 LOC)
   - H-E16: watchOS DispatchView NavigationLink (1 LOC)
   - deepLink "approvals" PRODUCER (Wave 6-KK flagged; v6 carryover)
4. **SB-NEW-6 fallback chain model-preserve** (~20 LOC)
5. **SB-NEW-7 CANONICAL_FALLBACK fix** (~5 LOC)
6. **SB-NEW-8 cost-table coverage** azure/bedrock/sambanova/cerebras (~30 LOC)
7. **SB-NEW-10 cascading-fallback exit code** (~10 LOC)
8. **H-K1 keytar → @napi-rs/keyring** migration (~50 LOC + tests; archived 4+ years)
9. **H-K3 reject --api-key flag** (~5 LOC; secrets visible in `ps aux` is anti-pattern)
10. **H-K4 proactive OAuth token rotation** (kairos cron, ~30 LOC)
11. **H-K5 `wotann export` / `wotann delete` GDPR commands** (~60 LOC; S4-20 still TODO)
12. **H-K6 schedule-store + cron-store migrateLegacy stubs** (~40 LOC)
13. **H-K7 hook server rate limit** (~30 LOC; mirror api/server.ts pattern)
14. **H-K8 iOS OpenSourceLicensesView** (~80 LOC)
15. **H-K2 cargo audit cleanup** (Cargo.toml pin proc-macro-error2)
16. **H-J1 share-extension drain race + conversation routing fix**
17. **H-J2 IntentsSupported plist add Rewrite/Summarize/Expand**
18. **H-J3 `wotann voice ask`/`listen`/`speak` CLI subcommands** (~50 LOC)

## STEP 6 — TIER 2 THEATRICAL CLEANUP (~3 days)

19. **Per META-AUDIT-I empirical refinement, delete ~1490 LOC truly dead** (NOT v7's 2485 over-claim):
    - `src/security/plugin-scanner.ts` (318 LOC) — zombie OR wire `scanPlugin` into marketplace plugin loader
    - `src/security/privacy-router.ts` (471 LOC) — zombie OR wire `route` into channel adapters
    - `src/security/multi-encoding-decoder.ts` (351 LOC) — chain orphan; delete OR wire into prompt-engine
    - Dead exports inside `src/security/url-instruction-guard.ts` (sanitizeUrlForPrompt + 5 helpers ~200 LOC) — keep only `inspectUrl`
    - Dead exports inside `src/security/anti-distillation.ts` (6 watermark helpers ~150 LOC) — keep only `generateFakeTools`
    - 2 zombie instances + getters in `src/core/runtime.ts:1541, 1591` (~10 LOC)
20. **769 LOC v8-confirmed dead**:
    - `src/claude/channels/wotann-channel.ts` (343)
    - `src/claude/hardening/error-handler.ts` (183)
    - `src/marketplace/manifest.ts` (243)
    - `src/ui/components/Sparkline.tsx` (dead component)
21. **iOS theatrical cleanup**:
    - Delete `EditorLSPService.swift` (341 LOC duplicate of EditorLSPBridge per H-E17)
    - 4 ViewModel scaffolds decision (Cost/Dispatch/Settings/TaskMonitor; ~364 LOC per M-E20)
    - Decide CrossDeviceService — wire (now part of SB-N5 Continuity) OR delete env injection
    - NorseSoundCues 394 LOC (per M-E23)
22. **desktop-app cleanup**:
    - 7 desktop-app component orphans (2,291 LOC per M-E24)
    - 22 Tauri command orphans (per L-E25)

## STEP 7 — TIER 3 TEST COVERAGE (multi-day)

23. Cover `src/agents` (6.79%), `src/auth` (9.16%), `src/voice` (30.36%) — security/business-critical
24. Add tests for 3 untested-but-live: `loop-command.ts`, `self-improve.ts`, `config-migration.ts`
25. **NB-7**: regenerate `coverage/index.html` and commit fresh artifact summary
26. Add migration test fixtures (`test/migration-fixtures/`) with pre-V9 DB snapshots per META-AUDIT-K §5

## STEP 8 — TIER 4 POLISH (1 day)

27. SB-NEW-9: fix "142 skills" claim in `src/mcp/mcp-server.ts:60` + commit log
28. NB-4 / G-4: cleanup `src/claude/types.ts:10` SDK v0.5.x stale reference (current 0.2.119)
29. G-6 update CVE list to GHSA/RUSTSEC IDs (3 of 4 misattributed)
30. mkdir 0o700 in 4 non-owned files (carryover)
31. Document undici uppercase-env-ignored gotcha + Cloudflare $7/user pricing cliff (G-9, G-10) in `docs/`

## USER ACTIONS (parallel, no dev needed)
- Branch protection on main
- Apple signing secrets + NPM_TOKEN
- Tauri auto-updater pubkey: G-7 confirms must inline PEM CONTENT (NOT file path) — also part of SB-N7 fix
- AASA JSON file deploy to https://wotann.com/.well-known/apple-app-site-association (part of SB-N5)
- Apple Developer Program: CarPlay entitlement approval, APNs production env switch (currently `aps-environment=development`)

---

## QUALITY BARS (cumulative #1-21 — read these BEFORE coding)

#1: No vendor-biased `??` fallbacks — every default per-provider via PROVIDER_DEFAULTS
#2: Opt-in caps, not implicit limits
#3: Sonnet not Haiku for routine work; Opus for audits
#4: Never skip tasks — partial = honest stub > silent success
#5: Honest stubs over silent success (extends #4)
#6: Capability gating: advertise feature only when actually wired (Wave 5-DD pattern)
#7: Per-session state, not module-global
#8: HookResult.contextPrefix as injection channel
#9: Don't modify tests to make them pass; if test wrong, document why and fix in same commit
#10: Honest stub > silent success (CLI exit codes especially)
#11: Sibling-site scan: when fixing one usage, grep for parallel firing sites
#12: Singleton threading not parallel construction
#13: Environment-dependent TEST-GATE logic breaks production code path coverage
#14: Commit messages are CLAIMS that need runtime verification — grep for real implementation BEFORE asserting "wired/fixed/implemented"
#15: H-37b co-conspirator pattern — when fixing source bug, update tests in SAME commit if they encode the bug
#16: Persistence test-isolation — default `persistPath = ":memory:"` for production-only data
#17: Two-pass theatrical inventory — pass 1 grep, pass 2 trace-call from feature entry
#18: Convergent confirmation = highest confidence — when 2+ different audit methodologies surface the same finding, prioritize it
#19 (NEW v9): **Zombie-instance check** — `new X()` + getter + 0 method calls = dead-instantiated. Grep is necessary but NOT sufficient. Always trace from constructor → method-call site.
#20 (NEW v9): **Plist capability MUST have backing code** — every Info.plist key (UIBackgroundModes value, NSExtension activation rule, applinks entitlement, aps-environment) needs verifiable Swift code path. CI lint candidate.
#21 (NEW v9): **Deployment artifacts MUST be smoke-tested** — code claims (AASA support, signed DMG, notarization stapling, updater pubkey, telemetry endpoint) MUST be verified against actual distribution artifacts, not just dev environment. End-to-end deploy smoke test required for ship.

---

## EXECUTION DISCIPLINE

- **No more than 4 concurrent Opus 4.7 agents** (rate limit)
- **Every claim verified empirically** — no inference; QB#14 + #18 + #19
- **Honest stubs > silent success** — QB#5/#10
- **Sibling-site scan after every fix** — QB#11
- **Tests in SAME commit as source fix** — QB#15
- **Save progress to Engram with topic_key="wotann-v9-tier0-closure-2026-04-26"** after every TIER 0 fix
- **If a TIER 0 fix surfaces a NEW SHIP-BLOCKER**, document in `docs/AUDIT_2026_04_26_BRUTAL_v9.md` §1 and continue
- **AUTO MODE active**: do not ask for clarification on TIER 0 spec; v9 audit is the spec
- **At end of session: append session-summary to v9 audit + write Engram session_summary**

---

## SUCCESS CRITERIA (TIER 0 v9 done)

After STEP 4 commit pushed — all 21 SHIP-BLOCKERS closed:

**v8 carryover (13)**:
- [ ] `npx tsx src/index.ts run "test"` exits cleanly (SB-NEW-1)
- [ ] `WOTANN_DEFAULT_PROVIDER=ollama` produces `activeProvider: ollama` (SB-NEW-3)
- [ ] No `qwen3.5` literal in ollama-adapter.ts or model-router.ts (SB-NEW-2)
- [ ] All 5 SQLite store DB files exist after daemon startup (SB-NEW-4)
- [ ] `grep -rn "restoreActivities" ios/` shows caller in WOTANNApp.wireServices (SB-NEW-5)
- [ ] `npx tsx src/index.ts trust .` adds workspace to `~/.wotann/trusted-workspaces.json` (SB-N1)
- [ ] JSON-RPC method-not-found returns `-32601`, invalid-params returns `-32602`, app errors return `-32000..-32099` (SB-N2)
- [ ] `tests/mcp/mcp-server.test.ts` updated to assert correct codes (SB-N2 + QB#15)
- [ ] Tauri DMG bundle includes daemon artifact (SB-N3)
- [ ] `npx tsx src/index.ts channels list` includes 6+ new channel adapters (NB-5)

**v9 NEW iOS (3)**:
- [ ] `grep -rn "AppShortcutsProvider" ios/` returns exactly 1 (SB-N4 — single source)
- [ ] `curl -I https://wotann.com/.well-known/apple-app-site-association` returns Content-Type application/json (SB-N5 AASA)
- [ ] `python3 -c "import plistlib; print(plistlib.load(open('ios/WOTANN/Info.plist','rb')).get('NSUserActivityTypes'))"` shows array (SB-N5 plist)
- [ ] `grep -c "onContinueUserActivity" ios/WOTANN/WOTANNApp.swift` ≥ 1 (SB-N5 handler)
- [ ] EITHER `BGTaskSchedulerPermittedIdentifiers` plist key set + `BGTaskScheduler.shared.register` calls present, OR `processing` removed from UIBackgroundModes (SB-N6)

**v9 NEW macOS (4)**:
- [ ] No `TODO-USER-ACTION` in `desktop-app/src-tauri/tauri.conf.json` pubkey (SB-N7)
- [ ] `signingIdentity` is real string, NOT null (SB-N8)
- [ ] `Entitlements.mac.plist` exists with Hardened Runtime entitlements (SB-N8)
- [ ] `grep -c "journal_mode" src/memory/sqlite-vec-backend.ts` ≥ 1 (SB-N9)
- [ ] `src/utils/sqlite-store-init.ts` helper exists, used by all 7 stores (SB-N9)
- [ ] `scripts/release/notarize-macos.sh` exists and is executable (SB-N10)

**Universal**:
- [ ] Full vitest suite passes (no new failures vs 9552 baseline)
- [ ] Build green (TS + desktop-app + Tauri)

If ALL checkboxes pass: V9 GA is **shippable for App Store iOS distribution AND DMG macOS distribution**.

---

**END OF v9 PROMPT.** Generated 2026-04-26. Trust this v9 prompt over v8/v7. Read `docs/AUDIT_2026_04_26_BRUTAL_v9.md` IN FULL before STEP 1.
