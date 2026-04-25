import Foundation
import Observation

// MARK: - SettingsViewModel
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. Every stored property is automatically tracked, so
// the `@Published` wrappers are dropped. SwiftUI views invalidate per-property
// instead of per-publish, eliminating fan-out across the entire view tree on
// any single field change.
//
// Consumer migration (when this VM gets wired into Settings):
//   - `@StateObject private var vm = SettingsViewModel(connectionManager: ...)`
//       → `@State private var vm = SettingsViewModel(connectionManager: ...)`
//   - `@ObservedObject var vm: SettingsViewModel`
//       → `var vm: SettingsViewModel` (read-only) or
//         `@Bindable var vm: SettingsViewModel` (for two-way bindings such
//         as `Toggle(isOn: $vm.hapticFeedback)`).

/// Manages all app settings.
@MainActor
@Observable
final class SettingsViewModel {
    var theme: AppTheme = .dark
    var hapticFeedback = true
    var biometricLock = false
    var autoConnect = true
    var notificationsEnabled = true
    var notifyTaskComplete = true
    var notifyErrors = true
    var notifyBudgetAlerts = true
    var notifyApprovalRequests = true
    var voiceBackend: VoiceBackend = .onDevice
    var cacheSize = "Calculating..."
    var showUnpairConfirmation = false

    @ObservationIgnored
    private let connectionManager: ConnectionManager

    init(connectionManager: ConnectionManager) {
        self.connectionManager = connectionManager
        loadSettings()
    }

    enum AppTheme: String, CaseIterable {
        case dark   = "Dark"
        case light  = "Light"
        case system = "System"
    }

    enum VoiceBackend: String, CaseIterable {
        case onDevice = "On-Device (Private)"
        case whisper  = "Whisper (Cloud)"
        case deepgram = "Deepgram (Cloud)"
    }

    var isConnected: Bool { connectionManager.isConnected }
    var connectionStatusText: String { connectionManager.connectionStatus.rawValue }
    var pairedDevice: ConnectionManager.PairedDevice? { connectionManager.pairedDevice }

    // MARK: - Actions

    func unpair() {
        connectionManager.unpair()
    }

    func clearCache() {
        ConversationStore.shared.clearAll()
        cacheSize = "0 B"
    }

    func calculateCacheSize() {
        let bytes = ConversationStore.shared.approximateSize()
        cacheSize = ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private func loadSettings() {
        let defaults = UserDefaults.standard
        hapticFeedback = defaults.bool(forKey: "hapticFeedback")
        biometricLock = defaults.bool(forKey: "biometricLock")
        autoConnect = defaults.bool(forKey: "autoConnect")
        notificationsEnabled = defaults.bool(forKey: "notificationsEnabled")

        if hapticFeedback == false && !defaults.dictionaryRepresentation().keys.contains("hapticFeedback") {
            hapticFeedback = true
        }
        if !defaults.dictionaryRepresentation().keys.contains("autoConnect") {
            autoConnect = true
        }
        if !defaults.dictionaryRepresentation().keys.contains("notificationsEnabled") {
            notificationsEnabled = true
        }

        calculateCacheSize()
    }

    func saveSettings() {
        let defaults = UserDefaults.standard
        defaults.set(hapticFeedback, forKey: "hapticFeedback")
        defaults.set(biometricLock, forKey: "biometricLock")
        defaults.set(autoConnect, forKey: "autoConnect")
        defaults.set(notificationsEnabled, forKey: "notificationsEnabled")
    }
}
