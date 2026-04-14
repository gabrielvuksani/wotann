import SwiftUI
import WidgetKit

// MARK: - WOTANN Widget Bundle

/// Entry point for the WOTANN widget extension.
/// Registers all available home screen widgets.
///
/// NOTE for team lead: To register TaskProgressLiveActivity here, add
/// `WOTANNLiveActivity` as a source in the WOTANNWidgets target in project.yml.
/// Live Activities are currently compiled only in the main WOTANN target.
@main
struct WOTANNWidgetBundle: WidgetBundle {
    var body: some Widget {
        CostWidget()
        AgentStatusWidget()
    }
}
