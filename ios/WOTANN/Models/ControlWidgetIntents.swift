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

// MARK: - App Shortcuts (main-app side)

/// AppShortcut entries make the four control intents discoverable from
/// Spotlight + AppShortcuts UI without the user needing to add the
/// Control Widget. Each phrase is the natural-language trigger Siri
/// will accept.
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
    }
}
