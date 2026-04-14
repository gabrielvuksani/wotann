import SwiftUI
import Foundation

// MARK: - Cross-Device Service

/// Handles Apple ecosystem cross-device features:
/// - Continuity Camera (iPhone as macOS camera)
/// - Apple Handoff (start on one device, continue on another)
/// - iCloud Key-Value sync for preferences
@MainActor
class CrossDeviceService: ObservableObject {
    @Published var handoffActivity: String?
    @Published var iCloudSyncEnabled = true
    @Published var lastSyncedAt: Date?

    /// KVS store — nil when iCloud is unavailable or the entitlement is missing.
    /// We never touch NSUbiquitousKeyValueStore.default unless we've confirmed
    /// the user has an iCloud account AND is signed in, which implies the
    /// entitlement chain is valid. The ubiquityIdentityToken check catches
    /// both "no iCloud account" and "unsigned/simulator" cases.
    private let _resolvedStore: NSUbiquitousKeyValueStore?

    private var iCloudStore: NSUbiquitousKeyValueStore? { _resolvedStore }

    init() {
        // Check for iCloud availability FIRST. If ubiquityIdentityToken is nil,
        // the device has no iCloud account (or the app isn't entitled). In that
        // case, skip KVS entirely — accessing .default would log "BUG IN CLIENT OF KVS".
        if FileManager.default.ubiquityIdentityToken != nil {
            _resolvedStore = NSUbiquitousKeyValueStore.default
        } else {
            _resolvedStore = nil
        }
        setupiCloudSync()
    }

    // MARK: - Apple Handoff

    /// Create a handoff activity for the current conversation.
    /// The desktop WOTANN app can pick this up via NSUserActivity.
    func startHandoff(conversationId: String, prompt: String) {
        let activity = NSUserActivity(activityType: "com.wotann.conversation")
        activity.title = "Continue in WOTANN"
        activity.userInfo = [
            "conversationId": conversationId,
            "prompt": prompt,
            "timestamp": Date().timeIntervalSince1970,
        ]
        activity.isEligibleForHandoff = true
        activity.isEligibleForSearch = true
        activity.isEligibleForPublicIndexing = false
        activity.becomeCurrent()
        handoffActivity = conversationId
    }

    /// Stop the current handoff activity.
    func stopHandoff() {
        handoffActivity = nil
    }

    // MARK: - iCloud Key-Value Sync

    /// Sync a preference to iCloud.
    func syncPreference(key: String, value: String) {
        guard iCloudSyncEnabled, let store = iCloudStore else { return }
        store.set(value, forKey: "wotann_\(key)")
        store.synchronize()
        lastSyncedAt = Date()
    }

    /// Read a synced preference from iCloud.
    func readPreference(key: String) -> String? {
        return iCloudStore?.string(forKey: "wotann_\(key)")
    }

    /// Sync theme preference across devices.
    func syncTheme(_ theme: String) {
        syncPreference(key: "theme", value: theme)
    }

    /// Sync provider preference across devices.
    func syncProvider(_ provider: String) {
        syncPreference(key: "provider", value: provider)
    }

    /// Get all synced keys.
    func getSyncedKeys() -> [String] {
        guard let store = iCloudStore else { return [] }
        return store.dictionaryRepresentation.keys
            .filter { $0.hasPrefix("wotann_") }
            .map { String($0.dropFirst(7)) }
    }

    // MARK: - Private

    private func setupiCloudSync() {
        guard let store = iCloudStore else { return }
        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: store,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.lastSyncedAt = Date()
            }
        }
        store.synchronize()
    }
}
