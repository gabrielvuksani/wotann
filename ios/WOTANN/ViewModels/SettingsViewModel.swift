import Foundation
import Combine

// MARK: - SettingsViewModel

/// Manages all app settings.
@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var theme: AppTheme = .dark
    @Published var hapticFeedback = true
    @Published var biometricLock = false
    @Published var autoConnect = true
    @Published var notificationsEnabled = true
    @Published var notifyTaskComplete = true
    @Published var notifyErrors = true
    @Published var notifyBudgetAlerts = true
    @Published var notifyApprovalRequests = true
    @Published var voiceBackend: VoiceBackend = .onDevice
    @Published var cacheSize = "Calculating..."
    @Published var showUnpairConfirmation = false

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
