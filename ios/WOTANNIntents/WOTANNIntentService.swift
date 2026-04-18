import Foundation
import Security

// MARK: - WOTANNIntentService

/// Shared service for Siri intents to communicate with the desktop WOTANN instance.
/// Connects via shared keychain pairing data to send real RPC calls.
@MainActor
final class WOTANNIntentService {
    static let shared = WOTANNIntentService()

    private let rpcClient = RPCClient()
    private let keychainService = "com.wotann.ios"

    private init() {}

    // MARK: - Connection

    /// Attempt to connect using pairing data stored in the shared keychain.
    /// Returns true if a connection was established.
    /// Retries every invocation so Siri intents can reconnect after transient failures.
    @MainActor
    private func ensureConnected() async -> Bool {
        if rpcClient.isConnected { return true }

        guard let pairingJson = readKeychain("pairing_data"),
              let data = pairingJson.data(using: .utf8),
              let pairing = try? JSONDecoder().decode(IntentPairedDevice.self, from: data) else {
            return false
        }

        rpcClient.connect(host: pairing.host, port: pairing.port)

        // Wait briefly for WebSocket handshake
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        guard rpcClient.isConnected else { return false }

        // Rehydrate the ECDH-derived key the main app saved when it
        // paired. Siri intent extensions have a tight deadline and
        // cannot run a fresh 30-second ECDH negotiation — but the main
        // app already did that and persisted the 32-byte symmetric key
        // to the shared keychain. Without this step, intent traffic
        // would travel in plaintext while the main app's traffic is
        // encrypted — a silent downgrade the user never asked for.
        if let secretBase64 = readKeychain("shared_secret"),
           let keyData = Data(base64Encoded: secretBase64) {
            let ecdh = ECDHManager()
            do {
                try ecdh.loadDerivedKey(keyData)
                rpcClient.setEncryption(ecdh)
            } catch {
                // Corrupted or wrong-length key — fall through to
                // unencrypted. RPCClient already logs this path.
            }
        }

        return true
    }

    private func readKeychain(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }

    // MARK: - Ask

    func sendPrompt(_ prompt: String, provider: String) async -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return "Please provide a prompt to send to WOTANN."
        }

        guard await ensureConnected() else {
            return "Not connected to WOTANN desktop. Open the WOTANN app and pair with your desktop first."
        }

        do {
            let response = try await rpcClient.send("chat.send", params: [
                "content": .string(trimmed),
                "provider": .string(provider),
            ])
            return response.result?.stringValue
                ?? "Prompt sent to WOTANN. Open the app to see the full response."
        } catch {
            return "Failed to reach WOTANN desktop: \(error.localizedDescription)"
        }
    }

    // MARK: - Enhance

    func enhancePrompt(_ prompt: String, style: String) async -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return "Please provide a prompt to enhance."
        }

        guard await ensureConnected() else {
            return "Not connected to WOTANN desktop. Open the WOTANN app and pair with your desktop first."
        }

        do {
            let response = try await rpcClient.send("enhance", params: [
                "prompt": .string(trimmed),
                "style": .string(style),
            ])
            return response.result?.stringValue ?? trimmed
        } catch {
            return "Enhancement unavailable: \(error.localizedDescription)"
        }
    }

    // MARK: - Cost

    func getCostSummary(period: String) async -> String {
        guard await ensureConnected() else {
            return "Not connected to WOTANN desktop. Open the WOTANN app and pair with your desktop first."
        }

        do {
            let response = try await rpcClient.send("cost.snapshot", params: [
                "period": .string(period),
            ])

            guard case .object(let obj) = response.result else {
                return "WOTANN cost data unavailable."
            }

            let today = obj["todayTotal"]?.doubleValue ?? 0
            let week = obj["weekTotal"]?.doubleValue ?? 0
            let month = obj["monthTotal"]?.doubleValue ?? 0
            let session = obj["sessionTotal"]?.doubleValue ?? 0
            let budget = obj["weeklyBudget"]?.doubleValue ?? 50.0
            let remaining = max(0, budget - week)

            switch period {
            case "today":
                return String(format: "Today's WOTANN usage: $%.2f.", today)
            case "week":
                return String(format: "This week's WOTANN usage: $%.2f. Budget remaining: $%.2f.", week, remaining)
            case "month":
                return String(format: "This month's WOTANN usage: $%.2f.", month)
            case "session":
                return String(format: "Current session cost: $%.2f.", session)
            default:
                return String(format: "Today: $%.2f | Week: $%.2f | Month: $%.2f", today, week, month)
            }
        } catch {
            return "Cost lookup failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - IntentPairedDevice

/// Minimal Codable struct mirroring ConnectionManager.PairedDevice for keychain reads.
private struct IntentPairedDevice: Codable {
    let id: String
    let name: String
    let host: String
    let port: Int
    let pairedAt: Date
}
