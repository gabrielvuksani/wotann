import Foundation
import AppIntents
import UIKit

// MARK: - Shared Control Widget Intents (V9 T7.4)
//
// These four `AppIntent` types must be visible in BOTH the
// `WOTANN` main-app target AND the `WOTANNWidgets` extension target.
// The widget extension instantiates them as the `action:` parameter
// of `ControlWidgetButton` / `ControlWidgetToggle`; the main app
// receives the deep-link handshake on scene activation by reading the
// shared `UserDefaults` keys these intents write.
//
// Splitting them out of `WOTANNWidgets/ControlWidgets.swift` is the
// V9 T7.4 dual-target requirement. With both targets compiling this
// file, AppIntent metadata is registered with the system from the
// main-app side (so AppShortcut + Spotlight surface the intent)
// while the widget extension can still dispatch them headlessly.
//
// Shared state: every intent here writes to the App Group
// `group.com.wotann.shared` so the main app can observe the change
// without an IPC round-trip to the extension.

private let sharedGroupID = "group.com.wotann.shared"

// MARK: - Set Autopilot Intent

/// Persists the new Autopilot state to App Group defaults. The main app
/// reads this on every scene activation to mirror it into `AppState`.
/// Implements `SetValueIntent` so iOS treats it as a toggle, with the
/// boolean payload threaded through the `value` parameter.
@available(iOS 18.0, *)
struct SetAutopilotIntent: SetValueIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Set Autopilot"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Enable or disable WOTANN Autopilot.",
        categoryName: "Autopilot"
    )

    @Parameter(title: "Autopilot")
    var value: Bool

    init() {}

    init(_ value: Bool) {
        self.value = value
    }

    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(value, forKey: "control.autopilot.isOn")
        return .result()
    }
}

// MARK: - Open Voice Ask Intent

/// Foregrounds the app into the voice-ask sheet. `openAppWhenRun = true`
/// keeps the flow: tap control → app launches → main-app deep-link
/// handler routes to the voice sheet by reading
/// `control.voice.requestedAt` on scene activation.
@available(iOS 18.0, *)
struct OpenVoiceAskIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Voice Ask"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Open WOTANN into the voice-ask sheet.",
        categoryName: "Chat"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    init() {}

    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.voice.requestedAt")
        return .result()
    }
}

// MARK: - Relay Clipboard Intent

/// Reads the system clipboard and writes it into the App Group so the
/// main app can route it to the paired desktop. Foregrounds the app
/// because relay dispatch lives in the main-app `ConnectionManager`
/// (which owns the ECDH-paired RPC channel — duplicating that into the
/// widget extension would force a second pairing flow).
@available(iOS 18.0, *)
struct RelayClipboardIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Relay Clipboard"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Relay the current clipboard contents to the paired WOTANN desktop.",
        categoryName: "Relay"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        let pasteboard = UIPasteboard.general
        let text = pasteboard.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        if text.isEmpty {
            defaults.removeObject(forKey: "control.relay.payload")
            defaults.set(Date().timeIntervalSince1970, forKey: "control.relay.requestedAt")
            return .result()
        }
        defaults.set(text, forKey: "control.relay.payload")
        defaults.set(Date().timeIntervalSince1970, forKey: "control.relay.requestedAt")
        return .result()
    }
}

// MARK: - Open Cost Dialog Intent

/// Foregrounds the app and routes to the cost breakdown sheet. The
/// main-app scene activation handler reads
/// `control.cost.requestedAt` and pushes the Cost view onto whatever
/// tab is active.
@available(iOS 18.0, *)
struct OpenCostDialogIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Open Today's Cost"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Open WOTANN to today's cost breakdown.",
        categoryName: "Cost"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.cost.requestedAt")
        return .result()
    }
}

// MARK: - Writing Tools / Ask deep-link Intents (SB-N4 main-app side)
//
// SB-N4 fix: iOS only honors a SINGLE `AppShortcutsProvider` per app target.
// The intent extension (WOTANNIntents) used to declare its own provider
// (AskWOTANNShortcuts) — iOS silently ignored it because the main app's
// WOTANNControlAppShortcuts wins. To surface the Ask/Rewrite/Summarize/Expand
// shortcuts to Siri + Spotlight + App Library, we declare deep-link intents
// here in the main target and add them to WOTANNControlAppShortcuts.
//
// Each deep-link intent foregrounds the app and writes a UserDefaults key
// in the App Group; the main-app scene-activation handler reads the key
// and navigates to the right view (mirrors the OpenCostDialogIntent pattern).
// The actual prompt/rewrite/summarize/expand logic still lives in the
// extension's intents (AskWOTANNIntent, RewriteWithWOTANNIntent, etc.) —
// THOSE are reachable via Apple Intelligence Writing Tools, App Intents API,
// and the IntentsSupported plist — they just aren't AppShortcut-discoverable
// any more (the extension's AppShortcutsProvider was dead anyway).

// Audit-finding GAP 3 fix: every Writing Tools intent now accepts the
// user's selected text as a @Parameter and stashes it into the shared
// app group's UserDefaults under "control.<action>.payload". WOTANNApp's
// onContinueUserActivity / scenePhase handler reads these and the
// MainShell renders the matching Composer with the payload pre-filled.
// Previously the intent only set a timestamp — the user's selection
// was discarded, making "Writing Tools" theatre.

@available(iOS 18.0, *)
struct AskWOTANNFromShortcutIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Ask WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Send the selected text to WOTANN as the start of a question.",
        categoryName: "Chat"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    @Parameter(title: "Selected Text", default: "")
    var selectedText: String

    init() {}
    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.ask.requestedAt")
        defaults.set(selectedText, forKey: "control.ask.payload")
        return .result()
    }
}

@available(iOS 18.0, *)
struct RewriteWithWOTANNFromShortcutIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Rewrite with WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Rewrite the selected text using WOTANN's chosen model.",
        categoryName: "Writing Tools"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    @Parameter(title: "Selected Text", default: "")
    var selectedText: String

    init() {}
    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.rewrite.requestedAt")
        defaults.set(selectedText, forKey: "control.rewrite.payload")
        return .result()
    }
}

@available(iOS 18.0, *)
struct SummarizeWithWOTANNFromShortcutIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Summarize with WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Summarize the selected text using WOTANN's chosen model.",
        categoryName: "Writing Tools"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    @Parameter(title: "Selected Text", default: "")
    var selectedText: String

    init() {}
    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.summarize.requestedAt")
        defaults.set(selectedText, forKey: "control.summarize.payload")
        return .result()
    }
}

@available(iOS 18.0, *)
struct ExpandWithWOTANNFromShortcutIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Expand with WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Expand the selected text using WOTANN's chosen model.",
        categoryName: "Writing Tools"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = true

    @Parameter(title: "Selected Text", default: "")
    var selectedText: String

    init() {}
    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.expand.requestedAt")
        defaults.set(selectedText, forKey: "control.expand.payload")
        return .result()
    }
}

// MARK: - App Shortcuts (main-app side — SINGLE source per iOS rule)

/// SB-N4 fix: this is the ONE AND ONLY AppShortcutsProvider for the WOTANN
/// app. iOS rejects multiple providers per target — the extension's
/// previous AskWOTANNShortcuts was silently ignored. All user-facing
/// Siri/Spotlight shortcuts MUST be declared here.
@available(iOS 18.0, *)
struct WOTANNControlAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenVoiceAskIntent(),
            phrases: [
                "Voice ask \(.applicationName)",
                "Ask \(.applicationName) by voice",
            ],
            shortTitle: "Voice Ask",
            systemImageName: "mic.circle.fill"
        )
        AppShortcut(
            intent: RelayClipboardIntent(),
            phrases: [
                "Relay clipboard with \(.applicationName)",
                "Send to \(.applicationName) desktop",
            ],
            shortTitle: "Relay",
            systemImageName: "arrow.up.forward.app.fill"
        )
        AppShortcut(
            intent: OpenCostDialogIntent(),
            phrases: [
                "Show \(.applicationName) cost",
                "How much have I spent in \(.applicationName)",
            ],
            shortTitle: "Cost",
            systemImageName: "dollarsign.circle.fill"
        )
        AppShortcut(
            intent: AskWOTANNFromShortcutIntent(),
            phrases: [
                "Ask \(.applicationName) a question",
                "Send a message to \(.applicationName)",
                "Query \(.applicationName)",
            ],
            shortTitle: "Ask WOTANN",
            systemImageName: "w.circle.fill"
        )
        AppShortcut(
            intent: RewriteWithWOTANNFromShortcutIntent(),
            phrases: [
                "Rewrite with \(.applicationName)",
                "Have \(.applicationName) rewrite this",
            ],
            shortTitle: "Rewrite with WOTANN",
            systemImageName: "pencil.and.outline"
        )
        AppShortcut(
            intent: SummarizeWithWOTANNFromShortcutIntent(),
            phrases: [
                "Summarize with \(.applicationName)",
                "Have \(.applicationName) summarize this",
            ],
            shortTitle: "Summarize with WOTANN",
            systemImageName: "text.redaction"
        )
        AppShortcut(
            intent: ExpandWithWOTANNFromShortcutIntent(),
            phrases: [
                "Expand with \(.applicationName)",
                "Have \(.applicationName) expand this",
            ],
            shortTitle: "Expand with WOTANN",
            systemImageName: "text.append"
        )
    }
}
