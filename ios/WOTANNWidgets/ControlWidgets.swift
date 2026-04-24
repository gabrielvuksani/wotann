import SwiftUI
import WidgetKit
import AppIntents
#if canImport(UIKit)
import UIKit
#endif

// MARK: - WOTANN Control Widgets (T7.4)
//
// iOS 18 introduces `ControlWidget` — small Control Center / Lock Screen /
// Action Button tiles that run an `AppIntent` when tapped or toggled. This
// file registers four controls, all thin wrappers over app intents that
// live alongside the existing `WOTANNIntents` extension pattern:
//
//   1. `WOTANNAutopilotControl`    — toggle (bound to `ToggleAutopilotIntent`)
//   2. `WOTANNVoiceAskControl`     — button, foregrounds app into voice sheet
//   3. `WOTANNRelayControl`        — button, relays clipboard to paired desktop
//   4. `WOTANNCostControl`         — button, surfaces today's cost dialog
//
// The intents below ship in the widget extension so Control Center can
// invoke them without waking the main app. `openAppWhenRun = true` is only
// set on the voice-ask + cost-dialog intents because they need the iOS app
// foregrounded to present a view; the autopilot toggle + clipboard relay
// run headless via the shared `WOTANNIntentService` path.
//
// Shared state lives in the same app group (`group.com.wotann.shared`) used
// by `CostWidget` / `AgentStatusWidget`, so the main app can write fresh
// snapshots and Control Center can read them without an IPC hop.

private let sharedGroupID = "group.com.wotann.shared"

// MARK: - Autopilot Control

/// Toggle that flips WOTANN Autopilot on/off from Control Center.
///
/// `ControlWidgetToggle` binds to a boolean value — the system reads the
/// current state from the intent's `value` accessor and writes the new
/// state by invoking `SetValueIntent.perform`. We persist the boolean into
/// the shared UserDefaults suite so the main app observes the change on
/// next read (and the `AppState` mirror updates when the scene becomes
/// active).
@available(iOS 18.0, *)
struct WOTANNAutopilotControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.wotann.control.autopilot") {
            ControlWidgetToggle(
                "Autopilot",
                isOn: WOTANNAutopilotValueProvider.isAutopilotOn(),
                action: SetAutopilotIntent()
            ) { isOn in
                Label(
                    isOn ? "Autopilot On" : "Autopilot Off",
                    systemImage: isOn ? "airplane.circle.fill" : "airplane.circle"
                )
            }
        }
        .displayName("WOTANN Autopilot")
        .description("Run WOTANN agents until the task completes.")
    }
}

@available(iOS 18.0, *)
enum WOTANNAutopilotValueProvider {
    static let key = "control.autopilot.isOn"

    static func isAutopilotOn() -> Bool {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        return defaults.bool(forKey: key)
    }

    static func set(_ value: Bool) {
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(value, forKey: key)
    }
}

/// Writes the new Autopilot state to the shared defaults. The main app
/// reads this key on every `AppState` sync. Kept as a plain `AppIntent`
/// rather than `AudioPlaybackIntent` / `LiveActivityIntent` because
/// toggling autopilot is neither audio nor a live activity operation.
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
        WOTANNAutopilotValueProvider.set(value)
        return .result()
    }
}

// MARK: - Voice Ask Control

/// Foregrounds the app into the voice-ask sheet. `openAppWhenRun = true`
/// on the intent keeps the flow: tap control → app launches → main-app
/// deep-link handler routes to the voice sheet.
@available(iOS 18.0, *)
struct WOTANNVoiceAskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.wotann.control.voice") {
            ControlWidgetButton(action: OpenVoiceAskIntent()) {
                Label("Voice Ask", systemImage: "mic.circle.fill")
            }
        }
        .displayName("Voice Ask")
        .description("Open WOTANN and start voice input.")
    }
}

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
        // The main app observes the shared-defaults key on scene activation
        // and routes into the voice sheet. `openAppWhenRun` above handles
        // the foregrounding handshake.
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.voice.requestedAt")
        return .result()
    }
}

// MARK: - Relay Control

/// Reads the system clipboard and relays it to the paired desktop as a new
/// prompt. Uses the shared `WOTANNIntentService` RPC path the existing
/// `AskWOTANNIntent` uses. Runs headless — no app foregrounding — so the
/// user can relay fast.
@available(iOS 18.0, *)
struct WOTANNRelayControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.wotann.control.relay") {
            ControlWidgetButton(action: RelayClipboardIntent()) {
                Label("Relay", systemImage: "arrow.up.forward.app.fill")
            }
        }
        .displayName("Relay to Desktop")
        .description("Relay the clipboard to the paired WOTANN desktop.")
    }
}

@available(iOS 18.0, *)
struct RelayClipboardIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Relay Clipboard"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Relay the current clipboard contents to the paired WOTANN desktop.",
        categoryName: "Relay"
    )
    // Foreground the app so `RelayCoordinator` (main app) can pick up the
    // clipboard payload and dispatch it over the already-paired ECDH
    // channel owned by the main-app `ConnectionManager`. Running headless
    // from the widget extension would require duplicating the RPC client,
    // keychain pairing, and ECDH key rehydration — which we deliberately
    // avoid per the V9 "main app owns the connection" rule.
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

// MARK: - Cost Control

/// Reports today's cost as a dialog. Foregrounds the app so the cost sheet
/// can render with the full breakdown; Control Center only has room for
/// short status strings.
@available(iOS 18.0, *)
struct WOTANNCostControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.wotann.control.cost") {
            ControlWidgetButton(action: OpenCostDialogIntent()) {
                Label("Today's Cost", systemImage: "dollarsign.circle.fill")
            }
        }
        .displayName("WOTANN Cost")
        .description("Show today's WOTANN spending.")
    }
}

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
        // The main app reads `control.cost.requestedAt` on scene
        // activation and navigates to the Cost tab.
        let defaults = UserDefaults(suiteName: sharedGroupID) ?? .standard
        defaults.set(Date().timeIntervalSince1970, forKey: "control.cost.requestedAt")
        return .result()
    }
}
