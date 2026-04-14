import Foundation
import os.log

/// Supabase Realtime Relay — enables iOS connectivity when not on same WiFi as desktop.
///
/// Architecture:
/// - ConnectionManager tries local WebSocket first (same WiFi)
/// - If local fails, SupabaseRelay connects via Supabase Realtime channel
/// - All traffic E2E encrypted with existing ECDH keys (Supabase sees only blobs)
/// - Auto-configured during QR pairing — user never sees Supabase
///
/// Implementation: Raw WebSocket to Supabase Realtime (Phoenix Channels protocol).
/// No Supabase SDK required — just JSON messages over wss://.
///
/// Free tier: 500MB database, 2GB bandwidth, unlimited real-time connections

// MARK: - Relay Configuration

struct RelayConfig: Codable {
    let supabaseUrl: String
    let supabaseAnonKey: String
    let channelId: String
    let devicePairId: String
}

// MARK: - Relay Message

struct RelayMessage: Codable {
    enum MessageType: String, Codable {
        case rpcRequest = "rpc-request"
        case rpcResponse = "rpc-response"
        case heartbeat
    }

    let type: MessageType
    let payload: String // E2E encrypted blob
    let timestamp: TimeInterval
    let sender: String // "desktop" or "ios"
}

// MARK: - Phoenix Channel Message (internal wire format)

private struct PhoenixMessage: Codable {
    let topic: String
    let event: String
    let payload: AnyCodablePayload
    let ref: String?
}

/// Minimal type-erased JSON payload for Phoenix messages.
private struct AnyCodablePayload: Codable {
    let value: [String: AnyCodableValue]

    init(_ dict: [String: AnyCodableValue]) {
        self.value = dict
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        value = try container.decode([String: AnyCodableValue].self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

/// Minimal recursive JSON value for encoding/decoding arbitrary payloads.
private enum AnyCodableValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AnyCodableValue])
    case array([AnyCodableValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) { self = .string(s); return }
        if let n = try? container.decode(Double.self) { self = .number(n); return }
        if let b = try? container.decode(Bool.self) { self = .bool(b); return }
        if let o = try? container.decode([String: AnyCodableValue].self) { self = .object(o); return }
        if let a = try? container.decode([AnyCodableValue].self) { self = .array(a); return }
        if container.decodeNil() { self = .null; return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .number(let n): try container.encode(n)
        case .bool(let b): try container.encode(b)
        case .object(let o): try container.encode(o)
        case .array(let a): try container.encode(a)
        case .null: try container.encodeNil()
        }
    }
}

// MARK: - Constants

private enum RelayConstants {
    static let heartbeatInterval: TimeInterval = 30
    static let reconnectBaseInterval: TimeInterval = 1
    static let reconnectMaxInterval: TimeInterval = 60
    static let connectTimeout: TimeInterval = 10
}

// MARK: - Supabase Relay Service

@MainActor
final class SupabaseRelay: NSObject, ObservableObject, URLSessionWebSocketDelegate {
    @Published var isConnected = false
    @Published var isConnecting = false
    @Published var lastError: String?

    private var config: RelayConfig?
    private var messageHandler: ((RelayMessage) -> Void)?
    private let keychain = KeychainManager()
    private static let log = OSLog(subsystem: "com.wotann.ios", category: "SupabaseRelay")

    // WebSocket state
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var heartbeatTimer: Timer?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var refCounter = 0
    private var joinRef: String?
    private var intentionalDisconnect = false
    private var listenTask: Task<Void, Never>?

    // MARK: - Configuration

    /// Load relay config from Keychain (stored during QR pairing).
    /// Uses the dedicated `.relayConfig` slot so it does not collide with
    /// ConnectionManager's `.pairingData` (which stores the PairedDevice).
    func loadConfig() -> Bool {
        guard let configString = keychain.read(.relayConfig),
              let data = configString.data(using: .utf8) else {
            return false
        }
        do {
            config = try JSONDecoder().decode(RelayConfig.self, from: data)
            return true
        } catch {
            lastError = "Failed to decode relay config: \(error.localizedDescription)"
            return false
        }
    }

    /// Save relay config to Keychain (called during QR pairing).
    /// Uses the dedicated `.relayConfig` slot so it does not collide with
    /// ConnectionManager's `.pairingData` (which stores the PairedDevice).
    func saveConfig(_ config: RelayConfig) {
        self.config = config
        if let data = try? JSONEncoder().encode(config) {
            if let jsonString = String(data: data, encoding: .utf8) {
                try? keychain.save(jsonString, for: .relayConfig)
            }
        }
    }

    /// Auto-configure during pairing — generate channel ID from device pair ID
    // Supabase relay credentials are configured during pairing or in Settings > Remote Relay.
    // No hardcoded defaults — relay is disabled until the user provides credentials.
    static let defaultSupabaseUrl = ""
    static let defaultSupabaseKey = ""

    /// Auto-configure during pairing with defaults.
    /// If no credentials have been set, relay remains disabled.
    /// - Returns: true if configuration was saved, false otherwise.
    @discardableResult
    func autoConfigureOnPair(devicePairId: String) -> Bool {
        return autoConfigureOnPair(
            devicePairId: devicePairId,
            supabaseUrl: Self.defaultSupabaseUrl,
            supabaseAnonKey: Self.defaultSupabaseKey
        )
    }

    /// Auto-configure during pairing with explicit credentials.
    /// Rejects (does not silently drop) empty URL or key so callers know
    /// the relay did not get configured and can surface an appropriate UI.
    /// - Returns: true if configuration was saved, false if creds were empty/invalid.
    @discardableResult
    func autoConfigureOnPair(devicePairId: String, supabaseUrl: String, supabaseAnonKey: String) -> Bool {
        let trimmedUrl = supabaseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedKey = supabaseAnonKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUrl.isEmpty, !trimmedKey.isEmpty else {
            os_log(
                "Supabase relay autoConfigureOnPair rejected: empty %{public}@",
                log: Self.log,
                type: .error,
                trimmedUrl.isEmpty && trimmedKey.isEmpty ? "url and key"
                    : (trimmedUrl.isEmpty ? "url" : "key")
            )
            lastError = "Supabase relay not configured — missing credentials"
            return false
        }

        let config = RelayConfig(
            supabaseUrl: trimmedUrl,
            supabaseAnonKey: trimmedKey,
            channelId: "wotann-relay-\(String(devicePairId.prefix(8)))",
            devicePairId: devicePairId
        )
        saveConfig(config)
        return true
    }

    // MARK: - Private Helpers

    private func nextRef() -> String {
        refCounter += 1
        return String(refCounter)
    }

    private var topic: String {
        "realtime:\(config?.channelId ?? "")"
    }

    /// Build the wss:// URL from the HTTPS Supabase project URL.
    private func buildWsUrl() -> URL? {
        guard let config = config else { return nil }
        let trimmed = config.supabaseUrl.hasSuffix("/")
            ? String(config.supabaseUrl.dropLast())
            : config.supabaseUrl
        let wsString = trimmed.replacingOccurrences(of: "https://", with: "wss://")
        let full = "\(wsString)/realtime/v1/websocket?apikey=\(config.supabaseAnonKey)&vsn=1.0.0"
        return URL(string: full)
    }

    /// Encode and send a Phoenix-protocol JSON message.
    private func wsSend(topic: String, event: String, payload: [String: AnyCodableValue], ref: String?) {
        guard let task = webSocketTask else { return }
        let msg = PhoenixMessage(
            topic: topic,
            event: event,
            payload: AnyCodablePayload(payload),
            ref: ref
        )
        guard let data = try? JSONEncoder().encode(msg),
              let jsonString = String(data: data, encoding: .utf8) else { return }
        task.send(.string(jsonString)) { error in
            if let error = error {
                print("Supabase relay send error: \(error.localizedDescription)")
            }
        }
    }

    /// Send a phx_join to subscribe to the channel.
    private func sendJoin() {
        joinRef = nextRef()
        let broadcastConfig: [String: AnyCodableValue] = ["self": .bool(false)]
        let configPayload: [String: AnyCodableValue] = ["broadcast": .object(broadcastConfig)]
        wsSend(
            topic: topic,
            event: "phx_join",
            payload: ["config": .object(configPayload)],
            ref: joinRef
        )
    }

    /// Start the heartbeat timer (30s interval).
    private func startHeartbeat() {
        stopHeartbeat()
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: RelayConstants.heartbeatInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.wsSend(topic: "phoenix", event: "heartbeat", payload: [:], ref: "heartbeat")
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    /// Start the receive-message loop using URLSessionWebSocketTask.
    private func startListening() {
        listenTask?.cancel()
        listenTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self = self, let task = self.webSocketTask else { break }
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        await self.handleMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            await self.handleMessage(text)
                        }
                    @unknown default:
                        break
                    }
                } catch {
                    // Receive failed — socket closed or errored
                    if !Task.isCancelled {
                        await self.handleDisconnect()
                    }
                    break
                }
            }
        }
    }

    /// Parse and dispatch an incoming Phoenix message.
    private func handleMessage(_ raw: String) async {
        guard let data = raw.data(using: .utf8) else { return }

        // Decode as a generic JSON dictionary for flexible parsing
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let event = json["event"] as? String

        // Join acknowledgement
        if event == "phx_reply", let ref = json["ref"] as? String, ref == joinRef {
            if let payload = json["payload"] as? [String: Any],
               let status = payload["status"] as? String, status == "ok" {
                isConnected = true
                isConnecting = false
                reconnectAttempt = 0
                print("Supabase relay connected: channel \(config?.channelId ?? "unknown")")
            } else {
                print("Supabase relay join rejected: \(json)")
                lastError = "Channel join rejected"
            }
            return
        }

        // Incoming broadcast from desktop
        if event == "broadcast" {
            guard let outerPayload = json["payload"] as? [String: Any],
                  let broadcastEvent = outerPayload["event"] as? String,
                  broadcastEvent == "relay",
                  let innerPayload = outerPayload["payload"] as? [String: Any] else { return }

            // Decode the inner RelayMessage
            guard let innerData = try? JSONSerialization.data(withJSONObject: innerPayload),
                  let relayMsg = try? JSONDecoder().decode(RelayMessage.self, from: innerData) else { return }

            messageHandler?(relayMsg)
            return
        }

        // System errors — trigger reconnect
        if event == "phx_error" || event == "phx_close" {
            await handleDisconnect()
        }
    }

    /// Schedule a reconnection with exponential backoff.
    private func scheduleReconnect() {
        guard !intentionalDisconnect else { return }
        guard reconnectTask == nil else { return }

        let delay = min(
            RelayConstants.reconnectBaseInterval * pow(2.0, Double(reconnectAttempt)),
            RelayConstants.reconnectMaxInterval
        )
        reconnectAttempt += 1

        print("Supabase relay reconnecting in \(delay)s (attempt \(reconnectAttempt))")
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, let self = self else { return }
            await MainActor.run {
                self.reconnectTask = nil
            }
            let _ = await self.connect()
        }
    }

    /// Clean up after an unexpected disconnect.
    private func handleDisconnect() async {
        isConnected = false
        isConnecting = false
        stopHeartbeat()
        listenTask?.cancel()
        listenTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        scheduleReconnect()
    }

    // MARK: - Public API

    /// Connect to the Supabase Realtime channel via raw WebSocket.
    /// Uses the Phoenix Channels protocol — no Supabase SDK required.
    func connect() async -> Bool {
        guard let config = config, !config.supabaseUrl.isEmpty, !config.supabaseAnonKey.isEmpty else {
            print("[WOTANN] Supabase relay disabled — no credentials configured.")
            lastError = "Supabase relay not configured"
            return false
        }

        guard let url = buildWsUrl() else {
            lastError = "Invalid Supabase URL"
            return false
        }

        // Tear down existing connection
        listenTask?.cancel()
        listenTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        stopHeartbeat()
        intentionalDisconnect = false

        isConnecting = true

        // Create a URLSession with delegate for WebSocket lifecycle
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        urlSession = session
        let task = session.webSocketTask(with: url)
        webSocketTask = task
        task.resume()

        // Send join and start heartbeat immediately — the WebSocket task
        // buffers sends until the connection is established
        sendJoin()
        startHeartbeat()
        startListening()

        // Wait up to 10s for join confirmation
        let connected = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            Task {
                let deadline = Date().addingTimeInterval(RelayConstants.connectTimeout)
                while Date() < deadline {
                    try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                    if await MainActor.run(body: { self.isConnected }) {
                        continuation.resume(returning: true)
                        return
                    }
                }
                continuation.resume(returning: false)
            }
        }

        if !connected {
            await MainActor.run {
                isConnecting = false
                if !isConnected {
                    lastError = "Connection timed out"
                    scheduleReconnect()
                }
            }
        }

        return connected
    }

    /// Send an encrypted RPC request through the relay via Phoenix broadcast.
    func send(encryptedPayload: String) async {
        guard isConnected, config != nil else { return }

        let message = RelayMessage(
            type: .rpcRequest,
            payload: encryptedPayload,
            timestamp: Date().timeIntervalSince1970,
            sender: "ios"
        )

        // Encode the RelayMessage to a JSON dictionary for the broadcast payload
        guard let msgData = try? JSONEncoder().encode(message),
              let msgDict = try? JSONSerialization.jsonObject(with: msgData) as? [String: Any] else { return }

        // Convert [String: Any] to [String: AnyCodableValue] for our encoder
        func toAnyCodable(_ value: Any) -> AnyCodableValue {
            if let s = value as? String { return .string(s) }
            if let n = value as? NSNumber {
                // Distinguish bool from number
                if CFBooleanGetTypeID() == CFGetTypeID(n) {
                    return .bool(n.boolValue)
                }
                return .number(n.doubleValue)
            }
            if let dict = value as? [String: Any] {
                return .object(dict.mapValues { toAnyCodable($0) })
            }
            if let arr = value as? [Any] {
                return .array(arr.map { toAnyCodable($0) })
            }
            return .null
        }

        let codablePayload = msgDict.mapValues { toAnyCodable($0) }

        wsSend(
            topic: topic,
            event: "broadcast",
            payload: [
                "type": .string("broadcast"),
                "event": .string("relay"),
                "payload": .object(codablePayload),
            ],
            ref: nextRef()
        )
    }

    /// Register callback for incoming desktop messages
    func onMessage(_ handler: @escaping (RelayMessage) -> Void) {
        self.messageHandler = handler
    }

    /// Disconnect from the relay and cancel all timers/tasks.
    func disconnect() {
        intentionalDisconnect = true
        isConnected = false
        isConnecting = false
        messageHandler = nil

        stopHeartbeat()
        listenTask?.cancel()
        listenTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil

        print("Supabase relay disconnected")
    }

    /// Check if relay is configured (has Supabase credentials)
    var isConfigured: Bool {
        guard let config = config else { return false }
        return !config.supabaseUrl.isEmpty && !config.supabaseAnonKey.isEmpty
    }

    // MARK: - URLSessionWebSocketDelegate

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        // Connection opened — join is already sent via sendJoin()
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor [weak self] in
            guard let self = self, !self.intentionalDisconnect else { return }
            await self.handleDisconnect()
        }
    }
}
