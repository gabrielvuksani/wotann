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
//   1. `WOTANNAutopilotControl`    — toggle (bound to `SetAutopilotIntent`)
//   2. `WOTANNVoiceAskControl`     — button, foregrounds app into voice sheet
//   3. `WOTANNRelayControl`        — button, relays clipboard to paired desktop
//   4. `WOTANNCostControl`         — button, surfaces today's cost dialog
//
// The four `AppIntent` types these controls invoke
// (`SetAutopilotIntent` / `OpenVoiceAskIntent` / `RelayClipboardIntent` /
// `OpenCostDialogIntent`) live at
// `ios/WOTANN/Models/ControlWidgetIntents.swift` and are compiled into BOTH
// the main `WOTANN` target AND this `WOTANNWidgets` extension target — that
// is the V9 T7.4 dual-target requirement (the main app registers the
// AppIntent metadata so Spotlight + AppShortcuts surface them; the widget
// extension dispatches them when a control is tapped).
//
// Shared state lives in the App Group `group.com.wotann.shared` used
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

// `SetAutopilotIntent` lives in `ios/WOTANN/Models/ControlWidgetIntents.swift`
// (compiled into BOTH targets per V9 T7.4 dual-target requirement). The
// widget extension instantiates it as the action for
// `WOTANNAutopilotControl.ControlWidgetToggle`; the main app sees the
// updated `control.autopilot.isOn` defaults key on scene activation.

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

// `OpenVoiceAskIntent` lives in `ios/WOTANN/Models/ControlWidgetIntents.swift`
// (dual-target, V9 T7.4).

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

// `RelayClipboardIntent` lives in `ios/WOTANN/Models/ControlWidgetIntents.swift`
// (dual-target, V9 T7.4).

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

// `OpenCostDialogIntent` lives in `ios/WOTANN/Models/ControlWidgetIntents.swift`
// (dual-target, V9 T7.4).

@available(iOS 18.0, *)
private enum _T74_TargetMembershipMarker {
    /// Compile-time tripwire — referenced from a no-op static so the file
    /// fails to compile if the dual-target file is missing. Do not remove.
    static let _intent_types_present: [Any.Type] = [
        SetAutopilotIntent.self,
        OpenVoiceAskIntent.self,
        RelayClipboardIntent.self,
        OpenCostDialogIntent.self,
    ]
}
