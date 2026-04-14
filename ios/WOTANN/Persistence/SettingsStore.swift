import SwiftUI

// MARK: - SettingsStore

/// @AppStorage wrapper providing typed access to all user settings.
/// Values are persisted in UserDefaults and survive app restarts.
final class SettingsStore: ObservableObject {
    static let shared = SettingsStore()

    // MARK: Appearance

    @AppStorage("colorScheme") var theme = "dark"
    @AppStorage("fontSize") var fontSize: Double = 15
    @AppStorage("codeFont") var codeFont = "SF Mono"
    @AppStorage("showProviderBadges") var showProviderBadges = true

    // MARK: Privacy & Security

    @AppStorage("biometricLockEnabled") var biometricLockEnabled = false
    @AppStorage("hapticFeedback") var hapticFeedback = true

    // MARK: Connection

    @AppStorage("autoConnectEnabled") var autoConnectEnabled = true
    @AppStorage("useTLS") var useTLS = false

    // MARK: Notifications

    @AppStorage("notificationsEnabled") var notificationsEnabled = true
    @AppStorage("notifyTaskComplete") var notifyTaskComplete = true
    @AppStorage("notifyErrors") var notifyErrors = true
    @AppStorage("notifyBudgetAlerts") var notifyBudgetAlerts = true
    @AppStorage("notifyApprovalRequests") var notifyApprovalRequests = true

    // MARK: Voice

    @AppStorage("voiceBackend") var voiceBackend = "on-device"

    // MARK: On-Device AI (opt-in)

    /// When enabled AND offline, WOTANN will attempt to run queries locally
    /// using a downloaded model (MLX) or Apple Foundation Models (iOS 26+).
    /// When disabled (default), offline queries are queued for desktop delivery.
    @AppStorage("enableOnDeviceInference") var enableOnDeviceInference = false

    // MARK: Budget

    @AppStorage("weeklyBudget") var weeklyBudget: Double = 50.0
    @AppStorage("budgetAlertThreshold") var budgetAlertThreshold: Double = 0.8

    private init() {}
}
