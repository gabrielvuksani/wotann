import SwiftUI
import WidgetKit

// MARK: - WOTANN Widget Bundle

/// Entry point for the WOTANN widget extension.
/// Registers all available home screen widgets, Control Center controls, and
/// Live Activities.
///
/// T7.1: `TaskProgressLiveActivity` now lives in this extension and is
/// registered here. `ActivityKit`'s `ActivityConfiguration` is a
/// `WidgetConfiguration`-family type, so SwiftUI lets us mix it alongside
/// `StaticConfiguration` widgets inside the same `WidgetBundle`. The
/// deployment target (iOS 18.0) is already past Live Activities' 16.2
/// minimum, so no runtime availability guard is required.
///
/// T7.4: Four Control Center controls are registered alongside the home
/// screen widgets. `ControlWidget` requires iOS 18, which matches our
/// deployment target, so they sit beside the home screen widgets without
/// availability wrappers.
@main
struct WOTANNWidgetBundle: WidgetBundle {
    var body: some Widget {
        CostWidget()
        AgentStatusWidget()

        #if canImport(ActivityKit)
        TaskProgressLiveActivity()
        #endif

        WOTANNAutopilotControl()
        WOTANNVoiceAskControl()
        WOTANNRelayControl()
        WOTANNCostControl()
    }
}
