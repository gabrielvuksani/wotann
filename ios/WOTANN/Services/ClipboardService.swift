import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - ClipboardService

/// Monitors clipboard changes and bridges content between phone and desktop.
///
/// Pasteboard access can fail with PBErrorDomain on devices where the app
/// hasn't been granted pasteboard access. The service handles this by
/// catching errors silently rather than crashing or spamming logs.
@MainActor
class ClipboardService: ObservableObject {
    @Published var lastClipboardContent: String = ""
    @Published var hasNewContent = false

    private var checkTimer: Timer?
    private var lastChangeCount = 0
    /// Consecutive errors — if we hit 3, stop monitoring to avoid log spam.
    private var consecutiveErrors = 0

    /// Start monitoring clipboard for changes.
    func startMonitoring() {
        #if canImport(UIKit)
        lastChangeCount = UIPasteboard.general.changeCount
        consecutiveErrors = 0
        checkTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkForChanges()
            }
        }
        #endif
    }

    /// Stop monitoring.
    func stopMonitoring() {
        checkTimer?.invalidate()
        checkTimer = nil
    }

    /// Get current clipboard content.
    func getContent() -> String {
        #if canImport(UIKit)
        return UIPasteboard.general.string ?? ""
        #else
        return ""
        #endif
    }

    /// Set clipboard content (e.g., from agent output).
    func setContent(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        lastChangeCount = UIPasteboard.general.changeCount
        #endif
    }

    /// Send clipboard content to desktop session via RPC.
    func sendToDesktop(using rpcClient: RPCClient) async {
        let content = getContent()
        guard !content.isEmpty else { return }
        _ = try? await rpcClient.send("clipboard.inject", params: [
            "content": .string(content),
        ])
    }

    // MARK: - Private

    private func checkForChanges() {
        #if canImport(UIKit)
        // If we've had 3+ consecutive errors, stop checking to avoid log spam.
        // The pasteboard will become available when the user next copies something
        // and the system shows the paste permission prompt.
        guard consecutiveErrors < 3 else {
            stopMonitoring()
            return
        }

        let currentCount = UIPasteboard.general.changeCount
        if currentCount != lastChangeCount {
            lastChangeCount = currentCount
            // Reading .string can trigger PBErrorDomain if not authorized.
            // The error is logged by the system but we can't catch it — just
            // accept that the string may be nil.
            lastClipboardContent = UIPasteboard.general.string ?? ""
            hasNewContent = !lastClipboardContent.isEmpty
            consecutiveErrors = 0
        }
        #endif
    }
}
