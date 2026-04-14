import Foundation
import Combine
#if canImport(UIKit)
import UIKit
#endif

// MARK: - ConnectionManager

/// Manages the WebSocket connection lifecycle and pairing with the desktop WOTANN.
@MainActor
final class ConnectionManager: ObservableObject {
    @Published var isPaired = false
    @Published var isConnected = false
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var connectionMode: ConnectionMode = .offline
    @Published var pairedDevice: PairedDevice?
    @Published var reconnectCount = 0
    @Published var latencyMs: Double = 0
    @Published var forceOfflineMode = false
    @Published var connectionSecurity: ConnectionSecurity = .unknown
    @Published var encryptionWarning: String?

    enum ConnectionSecurity: String {
        case encrypted = "Encrypted (AES-256-GCM)"
        case unencrypted = "Unencrypted"
        case unknown = "Unknown"

        /// Whether the connection security state warrants a user-visible warning.
        var isInsecure: Bool { self == .unencrypted }
    }

    let rpcClient = RPCClient()
    let ecdhManager = ECDHManager()
    private let keychainManager = KeychainManager()
    private let bonjourDiscovery = BonjourDiscovery()
    private var cancellables = Set<AnyCancellable>()
    private var latencyTimer: Timer?
    private var consecutiveLatencyFailures = 0

    /// Whether outbound/inbound messages are being encrypted.
    /// Derives from the RPC client's ECDH state — single source of truth.
    var isEncrypted: Bool { rpcClient.isEncryptionActive }

    /// Supabase Realtime relay for remote connectivity.
    lazy var supabaseRelay = SupabaseRelay()

    enum ConnectionStatus: String {
        case disconnected  = "Disconnected"
        case connecting    = "Connecting..."
        case connected     = "Connected"
        case pairing       = "Pairing..."
        case reconnecting  = "Reconnecting..."
        case relay         = "Remote Bridge"
        case error         = "Error"
    }

    enum ConnectionMode: String {
        case local   = "Local"
        case relay   = "Remote"
        case offline = "Offline"
        case queued  = "Queued"
    }

    struct PairedDevice: Codable {
        let id: String
        let name: String
        let host: String
        let port: Int
        let pairedAt: Date
    }

    struct PairingInfo {
        let id: String
        let pin: String
        let host: String
        let port: Int
    }

    init() {
        // Observe RPCClient connection state
        rpcClient.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] connected in
                guard let self else { return }
                if connected {
                    self.isConnected = true
                    self.connectionStatus = .connected
                    self.connectionMode = .local
                    self.consecutiveLatencyFailures = 0
                    self.startLatencyTracking()
                    // Re-establish ECDH encryption unconditionally on every (re)connect
                    if self.isPaired {
                        Task {
                            await self.negotiateEncryption()
                            // Sync config AFTER encryption is in place
                            await self.syncConfigFromDesktop()
                        }
                    } else {
                        // Not yet paired — only sync config (best-effort)
                        Task { await self.syncConfigFromDesktop() }
                    }
                } else if self.supabaseRelay.isConnected {
                    // Local dropped but relay is still up
                    self.isConnected = true
                    self.connectionStatus = .relay
                    self.connectionMode = .relay
                    self.stopLatencyTracking()
                } else if self.isPaired {
                    self.isConnected = false
                    self.connectionStatus = .reconnecting
                    self.connectionMode = .offline
                    self.reconnectCount += 1
                    self.stopLatencyTracking()
                    // Try relay as fallback
                    self.attemptRelayFallback()
                } else {
                    self.isConnected = false
                    self.connectionStatus = .disconnected
                    self.connectionMode = .offline
                    self.stopLatencyTracking()
                }
            }
            .store(in: &cancellables)

        // Observe Supabase relay connection state
        supabaseRelay.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] relayConnected in
                guard let self else { return }
                if relayConnected && !self.rpcClient.isConnected {
                    self.isConnected = true
                    self.connectionStatus = .relay
                    self.connectionMode = .relay
                } else if !relayConnected && !self.rpcClient.isConnected {
                    self.isConnected = false
                    self.connectionMode = .offline
                }
            }
            .store(in: &cancellables)

        // Restore pairing from keychain
        if let data = keychainManager.read(.pairingData),
           let deviceData = data.data(using: .utf8),
           let device = try? JSONDecoder().decode(PairedDevice.self, from: deviceData) {
            pairedDevice = device
            isPaired = true
            connect(host: device.host, port: device.port)
        }
    }

    // MARK: - Relay Fallback

    /// When local WebSocket fails, attempt connection via SupabaseRelay.
    private func attemptRelayFallback() {
        guard supabaseRelay.isConfigured, !supabaseRelay.isConnected, !supabaseRelay.isConnecting else { return }
        Task {
            let success = await supabaseRelay.connect()
            if success {
                connectionStatus = .relay
                connectionMode = .relay
                isConnected = true
            }
        }
    }

    // MARK: - Pairing

    /// Parse a QR code payload: wotann://pair?id=<id>&pin=<pin>&host=<host>&port=<port>
    func parsePairingQR(_ qrString: String) -> PairingInfo? {
        guard let url = URL(string: qrString),
              url.scheme == "wotann",
              url.host == "pair",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems else {
            return nil
        }

        let dict = Dictionary(uniqueKeysWithValues: items.compactMap { item -> (String, String)? in
            guard let value = item.value else { return nil }
            return (item.name, value)
        })

        guard let id = dict["id"],
              let pin = dict["pin"],
              let host = dict["host"],
              let portStr = dict["port"],
              let port = Int(portStr) else {
            return nil
        }

        return PairingInfo(id: id, pin: pin, host: host, port: port)
    }

    /// Complete pairing with the desktop.
    func pair(with info: PairingInfo) async throws {
        connectionStatus = .pairing
        let devicePairId = keychainManager.getDeviceId()

        rpcClient.connect(host: info.host, port: info.port)

        for _ in 0..<10 {
            if rpcClient.isConnected {
                break
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }

        guard rpcClient.isConnected else {
            connectionStatus = .error
            throw ConnectionError.timeout
        }

        // QR and deep-link pairing carry a one-time request ID in `info.id`.
        // Bonjour/manual flows register a direct local session instead.
        if info.pin != "000000" {
            let response = try await rpcClient.send("pair", params: [
                "requestId": .string(info.id),
                "pin": .string(info.pin),
                "deviceName": .string(deviceName),
                "deviceId": .string(devicePairId),
            ])

            guard response.error == nil else {
                connectionStatus = .error
                throw ConnectionError.pairingFailed
            }
        } else {
            let response = try await rpcClient.send("pair.local", params: [
                "deviceName": .string(deviceName),
                "deviceId": .string(devicePairId),
            ])

            guard response.error == nil else {
                connectionStatus = .error
                throw ConnectionError.pairingFailed
            }
        }

        // Await auth.handshake BEFORE negotiating encryption so the desktop's
        // session is fully provisioned. Without this, the subsequent ECDH RPC
        // may race with CompanionServer session setup and fail.
        do {
            _ = try await rpcClient.fetchSessionToken()
        } catch {
            // If the desktop doesn't implement auth.handshake yet, log and
            // continue — negotiateEncryption has its own retry logic.
            print("[WOTANN] auth.handshake failed (non-fatal, continuing): \(error.localizedDescription)")
        }

        // ECDH key exchange with exponential-backoff retry up to 30s
        await negotiateEncryption(deviceId: devicePairId)

        let device = PairedDevice(
            id: devicePairId,
            name: "Desktop",
            host: info.host,
            port: info.port,
            pairedAt: .now
        )

        // Persist
        if let data = try? JSONEncoder().encode(device),
           let string = String(data: data, encoding: .utf8) {
            try? keychainManager.save(string, for: .pairingData)
        }

        pairedDevice = device
        isPaired = true
        isConnected = true
        connectionStatus = .connected
        connectionMode = .local

        // Auto-configure Supabase relay for remote access
        supabaseRelay.autoConfigureOnPair(devicePairId: devicePairId)

        HapticService.shared.trigger(.pairingSuccess)
    }

    // MARK: - Connection

    func connect(host: String, port: Int) {
        connectionStatus = .connecting
        rpcClient.connect(host: host, port: port)
        // State updates happen via the rpcClient.$isConnected observer
    }

    func disconnect() {
        rpcClient.disconnect()
        supabaseRelay.disconnect()
        stopLatencyTracking()
        connectionStatus = .disconnected
        connectionMode = .offline
        connectionSecurity = .unknown
        encryptionWarning = nil
        consecutiveLatencyFailures = 0
    }

    /// Attempt to reconnect using saved pairing data.
    /// Tries local WebSocket first, then Supabase relay.
    func reconnect() async {
        guard let device = pairedDevice else { return }
        connectionStatus = .reconnecting

        // Try local WebSocket first
        connect(host: device.host, port: device.port)

        // Wait up to 5 seconds for local connection
        for _ in 0..<10 {
            try? await Task.sleep(nanoseconds: 500_000_000)
            if isConnected { return }
        }

        // If local failed, try Supabase relay
        if !isConnected {
            attemptRelayFallback()
        }
    }

    func unpair() {
        disconnect()
        keychainManager.delete(.pairingData)
        keychainManager.delete(.relayConfig)
        keychainManager.delete(.sessionToken)
        pairedDevice = nil
        isPaired = false
        reconnectCount = 0
        connectionSecurity = .unknown
        connectionMode = .offline
        ecdhManager.rotateKeys()
    }

    // MARK: - ECDH Encryption Negotiation

    /// Total wall-clock budget for ECDH negotiation before giving up.
    /// The desktop may still be finishing its own session setup on fresh connects,
    /// so we keep retrying with exponential backoff for up to this many seconds.
    private static let ecdhTotalBudgetSeconds: Double = 30

    /// Base delay between ECDH attempts (doubles each attempt, capped at budget).
    private static let ecdhBaseDelaySeconds: Double = 0.5

    /// Attempt ECDH key exchange with the desktop, retrying with exponential
    /// backoff until the 30-second budget is exhausted. Only after the full
    /// budget has elapsed without success do we mark the connection as
    /// unencrypted. Because desktops sometimes need a moment to finish their
    /// auth.handshake bookkeeping, short-circuiting after 3 attempts can flap
    /// the security state.
    /// - Parameter deviceId: Optional device ID for the exchange. Uses paired device ID if nil.
    private func negotiateEncryption(deviceId: String? = nil) async {
        let pairId = deviceId ?? pairedDevice?.id ?? keychainManager.getDeviceId()
        var lastError: Error?
        let deadline = Date().addingTimeInterval(Self.ecdhTotalBudgetSeconds)
        var attempt = 1

        while Date() < deadline {
            do {
                let localPublicKey = ecdhManager.publicKeyData
                let keyExchangeResponse = try await rpcClient.send("security.keyExchange", params: [
                    "publicKey": .string(localPublicKey.base64EncodedString()),
                    "deviceId": .string(pairId),
                ])

                if case .object(let obj) = keyExchangeResponse.result,
                   let peerKeyBase64 = obj["publicKey"]?.stringValue,
                   let peerKeyData = Data(base64Encoded: peerKeyBase64) {
                    try ecdhManager.completeKeyExchange(peerPublicKeyData: peerKeyData)
                    rpcClient.setEncryption(ecdhManager)
                    connectionSecurity = .encrypted
                    encryptionWarning = nil
                    return
                }
            } catch {
                lastError = error
                print("[WOTANN] ECDH attempt \(attempt) failed: \(error.localizedDescription)")
            }

            // Exponential backoff: 0.5s, 1s, 2s, 4s, 8s, capped at remaining budget
            let uncapped = Self.ecdhBaseDelaySeconds * pow(2.0, Double(attempt - 1))
            let remaining = deadline.timeIntervalSince(Date())
            guard remaining > 0 else { break }
            let delay = min(uncapped, remaining)
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            attempt += 1
        }

        // Budget exhausted — fall back to unencrypted with a warning
        connectionSecurity = .unencrypted
        encryptionWarning = "Encryption unavailable -- connection is not secured. Data is transmitted in plaintext."
        print("[WOTANN] ECDH key exchange failed after \(attempt) attempts over \(Int(Self.ecdhTotalBudgetSeconds))s: \(lastError?.localizedDescription ?? "unknown"). Connection is unencrypted.")
    }

    // MARK: - Config Auto-Sync

    /// Pull all config from the desktop and apply locally.
    /// Called automatically on every successful connection.
    /// This is the single source of truth — iOS never needs manual config entry
    /// for anything the desktop already has configured.
    func syncConfigFromDesktop() async {
        do {
            let response = try await rpcClient.send("config.sync")
            guard case .object(let config) = response.result else { return }

            // Apply Supabase relay credentials from desktop
            if case .object(let relay) = config["relay"] {
                if let url = relay["supabaseUrl"]?.stringValue,
                   let key = relay["supabaseAnonKey"]?.stringValue,
                   !url.isEmpty, !key.isEmpty {
                    let channelId = relay["channelId"]?.stringValue ?? "wotann-relay-\(keychainManager.getDeviceId().prefix(8))"
                    let pairId = relay["devicePairId"]?.stringValue ?? keychainManager.getDeviceId()
                    supabaseRelay.autoConfigureOnPair(
                        devicePairId: pairId,
                        supabaseUrl: url,
                        supabaseAnonKey: key
                    )
                    // Persist to UserDefaults so Settings shows the synced values
                    UserDefaults.standard.set(url, forKey: "supabaseUrl")
                    UserDefaults.standard.set(key, forKey: "supabaseKey")
                }
            }

            // Apply provider and model from desktop
            if let provider = config["provider"]?.stringValue, !provider.isEmpty {
                syncedProvider = provider
            }
            if let model = config["model"]?.stringValue, !model.isEmpty {
                syncedModel = model
            }

            // Store desktop hostname for UI
            if let host = config["hostname"]?.stringValue {
                syncedDesktopHostname = host
            }

            print("[WOTANN] Config synced from desktop: relay=\(supabaseRelay.isConfigured), provider=\(syncedProvider ?? "default")")
        } catch {
            // Config sync is best-effort — don't block connection
            print("[WOTANN] Config sync failed (non-fatal): \(error.localizedDescription)")
        }
    }

    /// Provider synced from desktop (nil = use local default).
    @Published var syncedProvider: String?
    /// Model synced from desktop (nil = use local default).
    @Published var syncedModel: String?
    /// Desktop hostname (for display in Settings).
    @Published var syncedDesktopHostname: String?

    // MARK: - Offline Queue Mode

    /// Called when a message is enqueued via OfflineQueueService.
    /// Transitions connectionMode to `.queued` so the UI reflects pending messages.
    func markQueued() {
        if !isConnected {
            connectionMode = .queued
        }
    }

    // MARK: - Bonjour Auto-Discovery

    /// Attempt to find the desktop via mDNS and connect automatically.
    func autoDiscover() {
        bonjourDiscovery.startDiscovery()

        // Observe discovered hosts
        bonjourDiscovery.$discoveredHosts
            .receive(on: DispatchQueue.main)
            .sink { [weak self] hosts in
                guard let self, !self.isConnected, let first = hosts.first else { return }
                self.connect(host: first.host, port: Int(first.port))
            }
            .store(in: &cancellables)
    }

    // MARK: - Latency Tracking

    private func startLatencyTracking() {
        stopLatencyTracking()
        latencyTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.measureLatency()
            }
        }
    }

    private func stopLatencyTracking() {
        latencyTimer?.invalidate()
        latencyTimer = nil
    }

    /// Threshold of consecutive latency-check failures before forcing a reconnect.
    private static let latencyFailureThreshold = 2

    private func measureLatency() async {
        let start = Date()
        do {
            _ = try await rpcClient.send("status")
            latencyMs = Date().timeIntervalSince(start) * 1000
            // Success resets the failure counter
            consecutiveLatencyFailures = 0
        } catch {
            latencyMs = -1
            consecutiveLatencyFailures += 1
            print("[WOTANN] Latency check failed (\(consecutiveLatencyFailures)/\(Self.latencyFailureThreshold)): \(error.localizedDescription)")
            // After N consecutive failures the engine state is stale — force a reconnect
            if consecutiveLatencyFailures >= Self.latencyFailureThreshold {
                print("[WOTANN] Latency failure threshold reached — forcing reconnect")
                consecutiveLatencyFailures = 0
                rpcClient.disconnect()
            }
        }
    }

    // MARK: - Helpers

    private var deviceName: String {
        #if targetEnvironment(simulator)
        return "iPhone Simulator"
        #elseif canImport(UIKit)
        return UIDevice.current.name
        #else
        return ProcessInfo.processInfo.hostName
        #endif
    }

    enum ConnectionError: LocalizedError {
        case notConnected
        case pairingFailed
        case timeout

        var errorDescription: String? {
            switch self {
            case .notConnected:  return "Not connected to desktop"
            case .pairingFailed: return "Pairing failed"
            case .timeout:       return "Connection timed out"
            }
        }
    }
}
