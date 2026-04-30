import Foundation
import Combine
import CryptoKit

// MARK: - RPCClient

/// JSON-RPC client over WebSocket for communicating with the desktop WOTANN.
@MainActor
final class RPCClient: ObservableObject {
    @Published var isConnected = false

    private let webSocket = WebSocketClient()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var pendingRequests: [Int: CheckedContinuation<RPCResponse, Error>] = [:]
    private var subscriptions: [String: [(RPCEvent) -> Void]] = [:]
    private var nextId = 1

    /// Optional ECDH manager for encrypting/decrypting messages on the wire.
    private(set) var ecdhManager: ECDHManager?

    /// Session auth token (B1). Fetched via the `auth.handshake` RPC after a
    /// successful ECDH-encrypted pairing and persisted in the Keychain. When
    /// set, every outbound RPC request embeds it as `authToken` so the
    /// desktop's CompanionServer can validate the session.
    var authToken: String?

    init() {
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601

        webSocket.onMessage = { [weak self] data in
            Task { @MainActor [weak self] in
                self?.handleIncoming(data)
            }
        }

        webSocket.onStateChange = { [weak self] state in
            Task { @MainActor [weak self] in
                self?.isConnected = (state == .connected)
            }
        }
    }

    // MARK: Encryption

    /// Enable end-to-end encryption for all subsequent messages.
    /// The manager must have completed key exchange before calling this.
    func setEncryption(_ manager: ECDHManager) {
        ecdhManager = manager
    }

    /// Whether outbound/inbound messages are being encrypted.
    var isEncryptionActive: Bool {
        ecdhManager?.isKeyExchangeComplete ?? false
    }

    // MARK: Connection

    /// Establish the WebSocket bridge to the desktop daemon.
    ///
    /// `useTLS` defaults to `false` because the bridge runs over the local
    /// network (Bonjour-discovered IP, typically 192.168.x.x or fe80::/10).
    /// Provisioning a publicly-trusted certificate for an ephemeral LAN
    /// peer is impractical, so we instead rely on:
    ///   1. NSAllowsLocalNetworking in Info.plist (SB-18 fix) which is
    ///      Apple's documented escape hatch for ATS on the local network.
    ///   2. Application-layer end-to-end encryption via ECDHManager — every
    ///      RPC payload is wrapped in ChaCha20-Poly1305 once
    ///      `ecdhManager.isKeyExchangeComplete` is true (see sendOnce / handleIncoming).
    /// Callers MAY set `useTLS: true` when the desktop is reachable over a
    /// trusted FQDN (e.g. via a Tailscale exit node with a valid cert);
    /// in that case the WebSocket layer will validate the chain normally.
    func connect(host: String, port: Int, useTLS: Bool = false) {
        let scheme = useTLS ? "wss" : "ws"
        // Wrap IPv6 addresses in brackets for valid URL construction
        let safeHost = host.contains(":") ? "[\(host)]" : host
        guard let url = URL(string: "\(scheme)://\(safeHost):\(port)") else {
            print("[WOTANN RPC] Invalid WebSocket URL: \(scheme)://\(safeHost):\(port)")
            return
        }
        webSocket.connect(to: url)
    }

    func disconnect() {
        webSocket.disconnect()
        let pending = pendingRequests
        pendingRequests.removeAll()
        for (_, continuation) in pending {
            continuation.resume(throwing: RPCError(code: -1, message: "Disconnected"))
        }
    }

    // MARK: Send

    func send(_ method: String, params: [String: RPCValue]? = nil) async throws -> RPCResponse {
        // S4-14: refuse to dispatch if the device reports no usable network.
        // Exempt the ping method so latency polling can still attempt a
        // heartbeat if the OS is briefly uncertain about reachability (the
        // websocket layer will itself time out if the path is truly down).
        if method != "ping" {
            try ConnectivityMonitor.shared.assertConnected(label: method)
        }

        do {
            return try await sendOnce(method, params: params)
        } catch {
            // Retry once on transient failures after a 2-second delay
            if isTransientError(error) {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                return try await sendOnce(method, params: params)
            }
            throw error
        }
    }

    /// Determines whether an error is transient (network timeout, connection reset)
    /// and thus eligible for a single retry.
    private func isTransientError(_ error: Error) -> Bool {
        if error is WebSocketError {
            return true
        }
        let nsError = error as NSError
        let transientCodes: Set<Int> = [
            NSURLErrorTimedOut,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorNotConnectedToInternet,
            NSURLErrorCannotConnectToHost,
        ]
        return transientCodes.contains(nsError.code)
    }

    /// Per-method timeout overrides in seconds. Methods not listed use the default 30s.
    private static let methodTimeouts: [String: UInt64] = [
        "screen.capture": 10,
        "screen.input": 10,
        "screen.keyboard": 10,
    ]

    /// Default timeout in seconds for RPC calls.
    private static let defaultTimeout: UInt64 = 30

    private func sendOnce(_ method: String, params: [String: RPCValue]? = nil) async throws -> RPCResponse {
        let id = nextId
        nextId += 1

        // SECURITY (B1): attach authToken to every non-exempt request so the
        // desktop CompanionServer accepts it. Methods that run before the
        // handshake (pair, pair.local, security.keyExchange, ping, auth.handshake)
        // skip injection since they bootstrap the session.
        let exempt: Set<String> = ["pair", "pair.local", "security.keyExchange", "ping", "auth.handshake"]
        var augmentedParams = params ?? [:]
        if let token = authToken, !exempt.contains(method), augmentedParams["authToken"] == nil {
            augmentedParams["authToken"] = .string(token)
        }
        let finalParams: [String: RPCValue]? = augmentedParams.isEmpty ? params : augmentedParams

        let request = RPCRequest(method: method, params: finalParams, id: id)
        let jsonData = try encoder.encode(request)

        // Encrypt the payload when ECDH key exchange is complete.
        let data: Data
        if let ecdh = ecdhManager, ecdh.isKeyExchangeComplete {
            data = try ecdh.encrypt(jsonData)
        } else {
            data = jsonData
        }

        let timeoutSeconds = Self.methodTimeouts[method] ?? Self.defaultTimeout

        return try await withCheckedThrowingContinuation { continuation in
            pendingRequests[id] = continuation
            Task {
                do {
                    try await webSocket.send(data)
                } catch {
                    Task { @MainActor in
                        self.pendingRequests.removeValue(forKey: id)
                    }
                    continuation.resume(throwing: error)
                }
            }

            // Timeout after the per-method or default duration
            Task {
                try? await Task.sleep(nanoseconds: timeoutSeconds * 1_000_000_000)
                await MainActor.run {
                    if let cont = self.pendingRequests.removeValue(forKey: id) {
                        cont.resume(throwing: WebSocketError.timeout)
                    }
                }
            }
        }
    }

    // MARK: Subscriptions

    func subscribe(_ method: String, handler: @escaping (RPCEvent) -> Void) {
        subscriptions[method, default: []].append(handler)
    }

    private func stableUUID(from source: String) -> UUID {
        if let uuid = UUID(uuidString: source) {
            return uuid
        }

        let digest = Array(SHA256.hash(data: Data(source.utf8)).prefix(16))
        let uuid = uuid_t(
            digest[0], digest[1], digest[2], digest[3],
            digest[4], digest[5],
            (digest[6] & 0x0F) | 0x40,
            digest[7],
            (digest[8] & 0x3F) | 0x80,
            digest[9], digest[10], digest[11], digest[12], digest[13], digest[14], digest[15]
        )
        return UUID(uuid: uuid)
    }

    private func rpcDate(from value: RPCValue?) -> Date {
        guard let value else { return .now }

        if let iso = value.stringValue, let date = ISO8601DateFormatter().date(from: iso) {
            return date
        }

        if let seconds = value.intValue {
            let timestamp = seconds > 10_000_000_000 ? Double(seconds) / 1000.0 : Double(seconds)
            return Date(timeIntervalSince1970: timestamp)
        }

        if let seconds = value.doubleValue {
            let timestamp = seconds > 10_000_000_000 ? seconds / 1000.0 : seconds
            return Date(timeIntervalSince1970: timestamp)
        }

        return .now
    }

    private func rpcString(_ object: [String: RPCValue], _ keys: [String]) -> String? {
        for key in keys {
            if let value = object[key]?.stringValue, !value.isEmpty {
                return value
            }
        }
        return nil
    }

    private func rpcDouble(_ object: [String: RPCValue], _ keys: [String]) -> Double? {
        for key in keys {
            if let value = object[key]?.doubleValue {
                return value
            }
            if let value = object[key]?.intValue {
                return Double(value)
            }
        }
        return nil
    }

    private func rpcInt(_ object: [String: RPCValue], _ keys: [String]) -> Int? {
        for key in keys {
            if let value = object[key]?.intValue {
                return value
            }
            if let value = object[key]?.doubleValue {
                return Int(value)
            }
        }
        return nil
    }

    /// Coerce a value to Bool. Accepts true/false, 1/0, "true"/"false"
    /// (case-insensitive). Daemon JSON-RPC handlers occasionally serialize
    /// booleans as integers when round-tripping through the type-erased
    /// `params` map (especially after `JSON.parse` in the bridge layer),
    /// so the helper looks at multiple shapes before giving up.
    private func rpcBool(_ object: [String: RPCValue], _ keys: [String]) -> Bool? {
        for key in keys {
            switch object[key] {
            case .bool(let b): return b
            case .int(let i): return i != 0
            case .double(let d): return d != 0
            case .string(let s):
                let lower = s.lowercased()
                if lower == "true" { return true }
                if lower == "false" { return false }
                continue
            default:
                continue
            }
        }
        return nil
    }

    // MARK: Authentication

    /// Fetch the current session token from the desktop daemon via the
    /// auth.handshake RPC. Safe to call after the ECDH key exchange is
    /// complete because the payload is end-to-end encrypted on the wire.
    /// Returns the token and stores it on the client for future requests.
    @discardableResult
    func fetchSessionToken() async throws -> String {
        let response = try await send("auth.handshake")
        guard let token = response.result?.objectValue?["token"]?.stringValue else {
            throw RPCError(code: -32001, message: "auth.handshake returned no token")
        }
        self.authToken = token
        return token
    }

    // MARK: Convenience Methods

    func sendMessage(conversationId: UUID, prompt: String) async throws -> RPCResponse {
        try await send("chat.send", params: [
            "conversationId": .string(conversationId.uuidString),
            "content": .string(prompt),
        ])
    }

    func getConversations() async throws -> [Conversation] {
        let response = try await send("conversations.list")
        let values = response.result?.arrayValue
            ?? response.result?.objectValue?["conversations"]?.arrayValue
            ?? []

        return values.compactMap { value in
            guard let object = value.objectValue else { return nil }
            let rawId = rpcString(object, ["id", "conversationId", "sessionId"]) ?? UUID().uuidString
            let createdAt = rpcDate(from: object["createdAt"])
            let updatedAt = rpcDate(from: object["updatedAt"] ?? object["lastMessageAt"] ?? object["createdAt"])

            return Conversation(
                id: stableUUID(from: rawId),
                title: rpcString(object, ["title", "name"]) ?? "Conversation",
                messages: [],
                // Provider neutrality fix: pass through whatever the daemon
                // reported. Empty string + "auto" model are the codebase's
                // "not configured" sentinels — no anthropic bias.
                provider: rpcString(object, ["provider"]) ?? "",
                model: rpcString(object, ["model"]) ?? "auto",
                isIncognito: object["incognito"]?.boolValue ?? false,
                isStarred: object["pinned"]?.boolValue ?? false,
                isArchived: object["archived"]?.boolValue ?? false,
                cost: rpcDouble(object, ["cost", "totalCost"]) ?? 0,
                createdAt: createdAt,
                updatedAt: updatedAt
            )
        }
    }

    func getAgents() async throws -> [AgentTask] {
        let response = try await send("agents.list")
        let values = response.result?.arrayValue
            ?? response.result?.objectValue?["agents"]?.arrayValue
            ?? []

        return values.compactMap { value in
            guard let object = value.objectValue else { return nil }
            let rawId = rpcString(object, ["id", "taskId"]) ?? UUID().uuidString
            let rawProgress = rpcDouble(object, ["progress"]) ?? 0
            let normalizedProgress = rawProgress > 1 ? rawProgress / 100.0 : rawProgress
            let statusString = rpcString(object, ["status"]) ?? "queued"
            let status: TaskState
            switch statusString {
            case "running", "in-progress":
                status = .running
            case "completed", "complete", "done":
                status = .completed
            case "failed", "error":
                status = .failed
            case "cancelled", "canceled":
                status = .cancelled
            case "paused", "idle":
                status = .paused
            default:
                status = .queued
            }

            return AgentTask(
                id: stableUUID(from: rawId),
                title: rpcString(object, ["title", "task", "name"]) ?? "Task",
                status: status,
                progress: normalizedProgress,
                // Provider neutrality fix: pass through daemon-reported provider.
                provider: rpcString(object, ["provider"]) ?? "",
                model: rpcString(object, ["model"]) ?? "auto",
                cost: rpcDouble(object, ["cost"]) ?? 0,
                startedAt: rpcDate(from: object["startedAt"] ?? object["createdAt"]),
                completedAt: status.isActive ? nil : rpcDate(from: object["completedAt"] ?? object["updatedAt"]),
                logs: []
            )
        }
    }

    func getCost() async throws -> CostSnapshot {
        let response = try await send("cost.snapshot")
        let object = response.result?.objectValue ?? [:]
        let sessionTotal = rpcDouble(object, ["sessionTotal", "sessionCost"]) ?? 0
        let todayTotal = rpcDouble(object, ["todayTotal", "dailyCost", "todayCost"]) ?? sessionTotal
        let weekTotal = rpcDouble(object, ["weekTotal", "weeklyCost", "weekCost"]) ?? todayTotal
        let weeklyBudget = rpcDouble(object, ["weeklyBudget", "budget"]) ?? 50.0

        // Parse per-provider cost breakdown
        let providerArray = object["byProvider"]?.arrayValue
            ?? object["providers"]?.arrayValue
            ?? object["costByProvider"]?.arrayValue
            ?? []
        let byProvider: [ProviderCost] = providerArray.compactMap { item in
            guard let obj = item.objectValue else { return nil }
            let name = rpcString(obj, ["name", "provider"]) ?? "unknown"
            let amount = rpcDouble(obj, ["amount", "cost", "total"]) ?? 0
            let requests = obj["requestCount"]?.intValue
                ?? obj["requests"]?.intValue
                ?? Int(obj["requestCount"]?.doubleValue ?? 0)
            return ProviderCost(name: name, amount: amount, requestCount: requests)
        }

        // Parse per-day cost breakdown
        let dayArray = object["byDay"]?.arrayValue
            ?? object["daily"]?.arrayValue
            ?? object["costByDay"]?.arrayValue
            ?? []
        let byDay: [DayCost] = dayArray.compactMap { item in
            guard let obj = item.objectValue else { return nil }
            let date = rpcString(obj, ["date", "day"]) ?? ""
            let amount = rpcDouble(obj, ["amount", "cost", "total"]) ?? 0
            guard !date.isEmpty else { return nil }
            return DayCost(date: date, amount: amount)
        }

        return CostSnapshot(
            todayTotal: todayTotal,
            weekTotal: weekTotal,
            monthTotal: rpcDouble(object, ["monthTotal", "monthlyCost"]) ?? weekTotal,
            sessionTotal: sessionTotal,
            weeklyBudget: weeklyBudget,
            byProvider: byProvider,
            byDay: byDay,
            updatedAt: rpcDate(from: object["updatedAt"])
        )
    }

    func enhancePrompt(_ prompt: String, style: String = "detailed") async throws -> String {
        let response = try await send("enhance", params: [
            "prompt": .string(prompt),
            "style": .string(style),
        ])
        return response.result?.stringValue ?? prompt
    }

    func searchMemory(_ query: String) async throws -> [MemoryResult] {
        let response = try await send("memory.search", params: [
            "query": .string(query),
        ])
        let values = response.result?.arrayValue ?? []
        return values.compactMap { value in
            guard let object = value.objectValue else { return nil }
            let rawId = rpcString(object, ["id"]) ?? UUID().uuidString
            return MemoryResult(
                id: stableUUID(from: rawId),
                content: rpcString(object, ["content", "snippet", "title"]) ?? "",
                type: rpcString(object, ["type"]) ?? "memory",
                relevance: rpcDouble(object, ["relevance", "score"]) ?? 0,
                timestamp: rpcDate(from: object["timestamp"] ?? object["savedAt"] ?? object["createdAt"])
            )
        }
    }

    func dispatchTask(_ request: DispatchRequest) async throws -> AgentTask {
        // Provider neutrality fix: only include provider/model in params when
        // the caller explicitly set them. Daemon resolves from session default
        // when omitted (no anthropic / claude-opus-4-6 hardcode).
        var params: [String: RPCValue] = [
            "prompt": .string(request.prompt),
        ]
        if let provider = request.provider, !provider.isEmpty {
            params["provider"] = .string(provider)
        }
        if let model = request.model, !model.isEmpty {
            params["model"] = .string(model)
        }
        let response = try await send("task.dispatch", params: params)
        guard let object = response.result?.objectValue else {
            throw RPCError(code: -1, message: "No result from task dispatch")
        }
        let rawId = rpcString(object, ["id", "taskId"]) ?? UUID().uuidString
        let statusString = rpcString(object, ["status"]) ?? "queued"
        let status: TaskState = statusString == "running" ? .running : .queued
        return AgentTask(
            id: stableUUID(from: rawId),
            title: rpcString(object, ["title", "task", "name"]) ?? request.prompt,
            status: status,
            progress: 0,
            provider: request.provider ?? "",
            model: request.model ?? "auto",
            cost: 0,
            startedAt: .now,
            completedAt: nil,
            logs: []
        )
    }

    func approveAction(taskId: UUID) async throws {
        _ = try await send("task.approve", params: [
            "taskId": .string(taskId.uuidString),
        ])
    }

    func rejectAction(taskId: UUID) async throws {
        _ = try await send("task.reject", params: [
            "taskId": .string(taskId.uuidString),
        ])
    }

    func cancelTask(taskId: UUID) async throws {
        _ = try await send("task.cancel", params: [
            "taskId": .string(taskId.uuidString),
        ])
    }

    // MARK: Provider Management

    /// Fetches the unified provider snapshot from the desktop's ProviderService.
    /// Returns the raw `providers.snapshot` payload with `providers`, `active`,
    /// and `lastRefreshedAt` so callers can decode with a typed shape.
    func getProvidersSnapshot(force: Bool = false) async throws -> [String: RPCValue] {
        let response = try await send("providers.snapshot", params: [
            "force": .bool(force),
        ])
        return response.result?.objectValue ?? [:]
    }

    /// Back-compat shim — older callers invoked `getProviders()` expecting a
    /// dictionary they could feed to `AppState.decodeProviders`. The new path
    /// normalises the snapshot shape into `{ "providers": [...] }` so the
    /// decoder continues to work unchanged.
    func getProviders() async throws -> [String: RPCValue] {
        let snapshot = try await getProvidersSnapshot()
        return snapshot
    }

    func switchProvider(_ provider: String, model: String) async throws {
        _ = try await send("providers.switch", params: [
            "provider": .string(provider),
            "model": .string(model),
        ])
    }

    /// Save an API key / OAuth token for a provider. Mirrors the desktop
    /// ProviderService.saveCredential surface so both platforms use the
    /// same provisioning path.
    func saveProviderCredential(
        providerId: String,
        method: String,
        token: String,
        label: String? = nil,
        expiresAt: Int? = nil
    ) async throws {
        var params: [String: RPCValue] = [
            "providerId": .string(providerId),
            "method": .string(method),
            "token": .string(token),
        ]
        if let label = label { params["label"] = .string(label) }
        if let expiresAt = expiresAt { params["expiresAt"] = .int(expiresAt) }
        _ = try await send("providers.saveCredential", params: params)
    }

    /// Remove the stored credential for a provider.
    func deleteProviderCredential(providerId: String) async throws {
        _ = try await send("providers.deleteCredential", params: [
            "providerId": .string(providerId),
        ])
    }

    /// Validate the active credential by attempting a model-list fetch.
    func testProviderCredential(providerId: String) async throws -> [String: RPCValue] {
        let response = try await send("providers.test", params: [
            "providerId": .string(providerId),
        ])
        return response.result?.objectValue ?? [:]
    }

    /// Force the desktop to rediscover every provider.
    func refreshProviders() async throws {
        _ = try await send("providers.refresh")
    }

    // MARK: Agent Lifecycle

    func killAgent(id: String) async throws {
        _ = try await send("agents.kill", params: [
            "id": .string(id),
        ])
    }

    // MARK: Cost Details

    func getCostDetails() async throws -> [String: RPCValue] {
        let response = try await send("cost.details")
        return response.result?.objectValue ?? [:]
    }

    // MARK: Skills

    func getSkills() async throws -> [String: RPCValue] {
        let response = try await send("skills.list")
        let object = response.result?.objectValue ?? [:]
        if let skills = object["skills"]?.arrayValue {
            return Dictionary(
                uniqueKeysWithValues: skills.compactMap { value -> (String, RPCValue)? in
                    guard let skill = value.objectValue,
                          let name = skill["name"]?.stringValue else {
                        return nil
                    }
                    return (name, skill["description"] ?? .bool(true))
                }
            )
        }
        return object
    }

    // MARK: Mode

    func setMode(_ mode: String) async throws {
        _ = try await send("mode.set", params: [
            "mode": .string(mode),
        ])
    }

    // MARK: Context

    func getContextInfo() async throws -> [String: RPCValue] {
        let response = try await send("context.info")
        return response.result?.objectValue ?? [:]
    }

    // MARK: Doctor

    func runDoctor() async throws -> [String: RPCValue] {
        let response = try await send("doctor")
        return response.result?.objectValue ?? [:]
    }

    // MARK: Deep Research

    func research(topic: String) async throws -> String {
        let response = try await send("research", params: [
            "topic": .string(topic),
        ])
        return response.result?.stringValue ?? ""
    }

    // MARK: Autonomous Execution

    func runAutonomous(prompt: String) async throws -> String {
        let response = try await send("autonomous.run", params: [
            "prompt": .string(prompt),
        ])
        return response.result?.stringValue ?? ""
    }

    // MARK: Arena

    func runArena(prompt: String, models: [String]) async throws -> [String: RPCValue] {
        let modelValues = models.map { RPCValue.string($0) }
        let response = try await send("arena.run", params: [
            "prompt": .string(prompt),
            "models": .array(modelValues),
        ])
        return response.result?.objectValue ?? [:]
    }

    // MARK: Dream

    func triggerDream() async throws {
        _ = try await send("dream")
    }

    // MARK: Config

    func getConfig(key: String? = nil) async throws -> [String: RPCValue] {
        var params: [String: RPCValue] = [:]
        if let key { params["key"] = .string(key) }
        let response = try await send("config.get", params: params)
        return response.result?.objectValue ?? [:]
    }

    func setConfig(key: String, value: String) async throws {
        _ = try await send("config.set", params: [
            "key": .string(key),
            "value": .string(value),
        ])
    }

    // MARK: Channels

    func getChannelStatus() async throws -> [[String: RPCValue]] {
        let response = try await send("channels.status")
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    // MARK: Memory Verification

    func verifyMemory() async throws -> [String: RPCValue] {
        let response = try await send("memory.verify")
        return response.result?.objectValue ?? [:]
    }

    // MARK: Workspaces

    func getWorkspaces() async throws -> [[String: RPCValue]] {
        let response = try await send("workspaces.list")
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    // MARK: Audit

    func getAuditTrail(limit: Int = 20) async throws -> [[String: RPCValue]] {
        let response = try await send("audit.query", params: [
            "limit": .double(Double(limit)),
        ])
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    // MARK: Automations

    func getAutomations() async throws -> [[String: RPCValue]] {
        let response = try await send("automations.list")
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    func createAutomation(name: String, trigger: String, command: String) async throws -> [String: RPCValue] {
        let response = try await send("automations.create", params: [
            "name": .string(name),
            "trigger": .string(trigger),
            "command": .string(command),
        ])
        return response.result?.objectValue ?? [:]
    }

    func deleteAutomation(id: String) async throws {
        _ = try await send("automations.delete", params: ["id": .string(id)])
    }

    // MARK: Status & Diagnostics

    func getStatus() async throws -> [String: RPCValue] {
        let response = try await send("status")
        return response.result?.objectValue ?? [:]
    }

    func getPlugins() async throws -> [[String: RPCValue]] {
        let response = try await send("plugins.list")
        let wrapper = response.result?.objectValue ?? [:]
        return (wrapper["plugins"]?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    func getConnectors() async throws -> [[String: RPCValue]] {
        let response = try await send("connectors.list")
        let wrapper = response.result?.objectValue ?? [:]
        return (wrapper["connectors"]?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    func predictCost(prompt: String, model: String? = nil) async throws -> [[String: RPCValue]] {
        var params: [String: RPCValue] = ["prompt": .string(prompt)]
        if let model { params["model"] = .string(model) }
        let response = try await send("cost.predict", params: params)
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    func getCostArbitrage() async throws -> [[String: RPCValue]] {
        let response = try await send("cost.arbitrage")
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    // MARK: Voice & Workers

    func getVoiceStatus() async throws -> [String: RPCValue] {
        let response = try await send("voice.status")
        return response.result?.objectValue ?? [:]
    }

    func getWorkerStatus() async throws -> [String: RPCValue] {
        let response = try await send("workers.status")
        return response.result?.objectValue ?? [:]
    }

    func getProofs() async throws -> [[String: RPCValue]] {
        let response = try await send("proofs.list")
        return (response.result?.arrayValue ?? []).compactMap { $0.objectValue }
    }

    // MARK: Workflow DAG

    func listWorkflows() async throws -> [String: RPCValue] {
        let response = try await send("workflow.list")
        return response.result?.objectValue ?? [:]
    }

    func startWorkflow(name: String, input: String) async throws -> [String: RPCValue] {
        let response = try await send("workflow.start", params: [
            "name": .string(name),
            "input": .string(input),
        ])
        return response.result?.objectValue ?? [:]
    }

    func getWorkflowStatus(id: String) async throws -> [String: RPCValue] {
        let response = try await send("workflow.status", params: [
            "id": .string(id),
        ])
        return response.result?.objectValue ?? [:]
    }

    // MARK: Intelligence Surface

    func getFlowInsights() async throws -> [String: RPCValue] {
        let response = try await send("flow.insights")
        return response.result?.objectValue ?? [:]
    }

    func getHealthReport() async throws -> [String: RPCValue] {
        let response = try await send("health.report")
        return response.result?.objectValue ?? [:]
    }

    func listDecisions(query: String? = nil) async throws -> [String: RPCValue] {
        var params: [String: RPCValue] = [:]
        if let query { params["query"] = .string(query) }
        let response = try await send("decisions.list", params: params.isEmpty ? nil : params)
        return response.result?.objectValue ?? [:]
    }

    func getSpecDivergence() async throws -> [String: RPCValue] {
        let response = try await send("spec.divergence")
        return response.result?.objectValue ?? [:]
    }

    func getPWRStatus() async throws -> [String: RPCValue] {
        let response = try await send("pwr.status")
        return response.result?.objectValue ?? [:]
    }

    func getAmbientStatus() async throws -> [String: RPCValue] {
        let response = try await send("ambient.status")
        return response.result?.objectValue ?? [:]
    }

    func getIdleStatus() async throws -> [String: RPCValue] {
        let response = try await send("idle.status")
        return response.result?.objectValue ?? [:]
    }

    func getCrossDeviceContext() async throws -> [String: RPCValue] {
        let response = try await send("crossdevice.context")
        return response.result?.objectValue ?? [:]
    }

    func listTriggers() async throws -> [String: RPCValue] {
        let response = try await send("triggers.list")
        return response.result?.objectValue ?? [:]
    }

    func searchFiles(query: String) async throws -> [String: RPCValue] {
        let response = try await send("files.search", params: [
            "query": .string(query),
        ])
        return response.result?.objectValue ?? [:]
    }

    // MARK: Desktop Tools

    func runPrecommit() async throws -> [String: RPCValue] {
        let response = try await send("precommit")
        return response.result?.objectValue ?? [:]
    }

    func runArchitect(query: String) async throws -> [String: RPCValue] {
        let response = try await send("architect", params: [
            "query": .string(query),
        ])
        return response.result?.objectValue ?? [:]
    }

    func runCouncil(query: String, providers: [String]) async throws -> [String: RPCValue] {
        let providerValues = providers.map { RPCValue.string($0) }
        let response = try await send("council", params: [
            "query": .string(query),
            "providers": .array(providerValues),
        ])
        return response.result?.objectValue ?? [:]
    }

    // MARK: Blocks (letta-style core memory)

    func listBlocks() async throws -> [BlockSummary] {
        let response = try await send("blocks.list", params: [:])
        let values = response.result?.arrayValue ?? []
        return values.compactMap { value in
            guard let obj = value.objectValue else { return nil }
            return BlockSummary(
                kind: rpcString(obj, ["kind"]) ?? "",
                bytes: Int(rpcDouble(obj, ["bytes"]) ?? 0),
                limit: Int(rpcDouble(obj, ["limit"]) ?? 0),
                truncated: obj["truncated"]?.boolValue ?? false,
                updatedAt: rpcString(obj, ["updatedAt"]) ?? ""
            )
        }
    }

    func getBlock(kind: String) async throws -> MemoryBlock? {
        let response = try await send("blocks.get", params: ["kind": .string(kind)])
        guard let obj = response.result?.objectValue else { return nil }
        if obj["error"] != nil { return nil }
        return MemoryBlock(
            kind: rpcString(obj, ["kind"]) ?? kind,
            content: rpcString(obj, ["content"]) ?? "",
            updatedAt: rpcString(obj, ["updatedAt"]) ?? "",
            truncatedAt: rpcString(obj, ["truncatedAt"])
        )
    }

    func setBlock(kind: String, content: String) async throws -> MemoryBlock {
        let response = try await send("blocks.set", params: [
            "kind": .string(kind),
            "content": .string(content),
        ])
        guard let obj = response.result?.objectValue else {
            throw RPCError(code: -32603, message: "blocks.set returned non-object")
        }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        return MemoryBlock(
            kind: rpcString(obj, ["kind"]) ?? kind,
            content: rpcString(obj, ["content"]) ?? "",
            updatedAt: rpcString(obj, ["updatedAt"]) ?? "",
            truncatedAt: rpcString(obj, ["truncatedAt"])
        )
    }

    /// Append text to a block (preserves existing content with a newline
    /// separator). Mirrors `blocks.append` on the daemon and `appendBlock`
    /// on Desktop/CLI. Audit caught the missing iOS wrapper —
    /// see Engram `wotann-rpc-shape-audit-2026-04-29`.
    func appendBlock(kind: String, content: String) async throws -> MemoryBlock {
        let response = try await send("blocks.append", params: [
            "kind": .string(kind),
            "content": .string(content),
        ])
        guard let obj = response.result?.objectValue else {
            throw RPCError(code: -32603, message: "blocks.append returned non-object")
        }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        return MemoryBlock(
            kind: rpcString(obj, ["kind"]) ?? kind,
            content: rpcString(obj, ["content"]) ?? "",
            updatedAt: rpcString(obj, ["updatedAt"]) ?? "",
            truncatedAt: rpcString(obj, ["truncatedAt"])
        )
    }

    func clearBlock(kind: String) async throws -> Bool {
        let response = try await send("blocks.clear", params: ["kind": .string(kind)])
        guard let obj = response.result?.objectValue else { return false }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        return obj["removed"]?.boolValue ?? false
    }

    /// Render the active block-memory composition into the assembled
    /// system-prompt string. Calls `blocks.render` on the daemon. Used
    /// by the Memory panel to show users the actual prompt their next
    /// turn will see — closes the gap where `blocks.render` was
    /// daemon-only and Memory panel had no preview surface.
    func renderBlocks() async throws -> String {
        let response = try await send("blocks.render", params: [:])
        guard let obj = response.result?.objectValue else { return "" }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        return rpcString(obj, ["content"]) ?? ""
    }

    func listBlockKinds() async throws -> [BlockKindInfo] {
        let response = try await send("blocks.kinds", params: [:])
        let values = response.result?.arrayValue ?? []
        return values.compactMap { value in
            guard let obj = value.objectValue else { return nil }
            return BlockKindInfo(
                kind: rpcString(obj, ["kind"]) ?? "",
                limit: Int(rpcDouble(obj, ["limit"]) ?? 0)
            )
        }
    }

    // MARK: Operations (Inspect / Attest / Policy / Canary)

    func inspectPath(_ path: String, declared: String? = nil) async throws -> [String: RPCValue] {
        var params: [String: RPCValue] = ["path": .string(path)]
        if let declared { params["declared"] = .string(declared) }
        let response = try await send("inspect.path", params: params)
        return response.result?.objectValue ?? [:]
    }

    /// Generate (or load existing) audit-attestation key. Returns a typed
    /// `AttestKeyResult` so the iOS UI can distinguish a freshly-minted
    /// key from one that already existed — previously the
    /// `[String: RPCValue]` return silently dropped the `existed` flag,
    /// leaving the user unable to tell whether they had just rotated
    /// their identity or merely re-loaded the stored key.
    func attestGenkey(_ id: String = "default") async throws -> AttestKeyResult {
        let response = try await send("attest.genkey", params: ["id": .string(id)])
        let obj = response.result?.objectValue ?? [:]
        if let err = rpcString(obj, ["error"]) {
            throw RPCError(code: -32000, message: err)
        }
        return AttestKeyResult(
            id: rpcString(obj, ["id"]) ?? id,
            publicPem: rpcString(obj, ["publicPem"]) ?? "",
            existed: rpcBool(obj, ["existed"]) ?? false
        )
    }

    /// Legacy untyped variant for callers that still need the raw
    /// dictionary (e.g. SwiftUI previews that use placeholder keys).
    /// Prefer `attestGenkey` above.
    func attestGenkeyRaw(_ id: String = "default") async throws -> [String: RPCValue] {
        let response = try await send("attest.genkey", params: ["id": .string(id)])
        return response.result?.objectValue ?? [:]
    }

    func attestSign(_ record: [String: RPCValue], id: String = "default") async throws -> [String: RPCValue] {
        let response = try await send("attest.sign", params: [
            "record": .object(record),
            "id": .string(id),
        ])
        return response.result?.objectValue ?? [:]
    }

    func attestVerify(_ envelope: [String: RPCValue]) async throws -> [String: RPCValue] {
        let response = try await send("attest.verify", params: ["envelope": .object(envelope)])
        return response.result?.objectValue ?? [:]
    }

    func policyEvaluate(policy: String, principal: String, action: String, resource: String) async throws -> [String: RPCValue] {
        let response = try await send("policy.eval", params: [
            "policy": .string(policy),
            "principal": .string(principal),
            "action": .string(action),
            "resource": .string(resource),
        ])
        return response.result?.objectValue ?? [:]
    }

    func canaryCaptureBaseline(probeUrl: String, samples: Int = 5) async throws -> [String: RPCValue] {
        let response = try await send("canary.captureBaseline", params: [
            "probeUrl": .string(probeUrl),
            "samples": .int(samples),
        ])
        return response.result?.objectValue ?? [:]
    }

    // MARK: Teams

    /// List team templates with full per-agent typing. Previously the
    /// agents were collapsed to `[String]` (`agentNames`), losing the
    /// `type` field — so the iOS team-picker couldn't show "1 lead +
    /// 2 reviewers + 1 verifier" without a follow-up `showTemplate`
    /// round-trip per template. Carrying typed `TeamAgent` objects
    /// fixes that and matches the daemon's actual return shape at
    /// `src/daemon/kairos-rpc.ts:8606-8612`.
    func teamsListTemplates() async throws -> [TeamTemplateSummary] {
        let response = try await send("teams.listTemplates", params: [:])
        let values = response.result?.arrayValue ?? []
        return values.compactMap { value in
            guard let obj = value.objectValue else { return nil }
            let leader = parseAgent(obj["leader"]?.objectValue ?? [:])
            let agentArr = obj["agents"]?.arrayValue ?? []
            return TeamTemplateSummary(
                name: rpcString(obj, ["name"]) ?? "",
                description: rpcString(obj, ["description"]) ?? "",
                source: rpcString(obj, ["source"]) ?? "built-in",
                leader: leader,
                agents: agentArr.compactMap { v in
                    guard let o = v.objectValue else { return nil }
                    return parseAgent(o)
                }
            )
        }
    }

    /// Show a rendered template — returns the typed `RenderedTeamTemplate`
    /// instead of `[String: RPCValue]`. Carrying `invokeArgs`, `backend`,
    /// `source`, `path`, and per-agent `model` lets the iOS UI render
    /// the team-spawn confirmation sheet with full fidelity (e.g.
    /// "Will run with backend=tmux via wotann --json") without having
    /// to grovel through an untyped dictionary.
    func teamsShowTemplate(
        name: String,
        goal: String,
        teamName: String? = nil
    ) async throws -> RenderedTeamTemplate {
        var params: [String: RPCValue] = ["name": .string(name), "goal": .string(goal)]
        if let teamName { params["teamName"] = .string(teamName) }
        let response = try await send("teams.showTemplate", params: params)
        let obj = response.result?.objectValue ?? [:]
        if let err = rpcString(obj, ["error"]) {
            throw RPCError(code: -32000, message: err)
        }
        let leader = parseAgent(obj["leader"]?.objectValue ?? [:])
        let agentArr = obj["agents"]?.arrayValue ?? []
        let invokeArgsRaw = obj["invokeArgs"]?.arrayValue ?? []
        return RenderedTeamTemplate(
            name: rpcString(obj, ["name"]) ?? name,
            description: rpcString(obj, ["description"]) ?? "",
            invokeArgs: invokeArgsRaw.compactMap { $0.stringValue },
            backend: rpcString(obj, ["backend"]) ?? "wotann",
            source: rpcString(obj, ["source"]) ?? "built-in",
            path: rpcString(obj, ["path"]),
            leader: leader,
            agents: agentArr.compactMap { v in
                guard let o = v.objectValue else { return nil }
                return parseAgent(o)
            }
        )
    }

    /// Helper: parse a JSON-RPC object into a typed `TeamAgent`.
    /// Centralized so `teamsListTemplates`/`teamsShowTemplate` stay in
    /// sync — adding a field here lights it up everywhere.
    private func parseAgent(_ obj: [String: RPCValue]) -> TeamAgent {
        TeamAgent(
            name: rpcString(obj, ["name"]) ?? "",
            type: rpcString(obj, ["type"]) ?? "agent",
            task: rpcString(obj, ["task"]),
            model: rpcString(obj, ["model"])
        )
    }

    func teamsSend(team: String, to: String, body: String, from: String = "ios") async throws -> [String: RPCValue] {
        let response = try await send("teams.send", params: [
            "team": .string(team),
            "from": .string(from),
            "to": .string(to),
            "body": .string(body),
        ])
        return response.result?.objectValue ?? [:]
    }

    func teamsReceive(team: String, agent: String, max: Int = 10) async throws -> [InboxMessage] {
        let response = try await send("teams.receive", params: [
            "team": .string(team),
            "agent": .string(agent),
            "max": .int(max),
        ])
        let values = response.result?.arrayValue ?? []
        return values.compactMap { value in
            guard let obj = value.objectValue else { return nil }
            return InboxMessage(
                id: rpcString(obj, ["id"]) ?? UUID().uuidString,
                from: rpcString(obj, ["from"]) ?? "",
                to: rpcString(obj, ["to"]) ?? "",
                body: rpcString(obj, ["body"]) ?? "",
                enqueuedAt: rpcString(obj, ["enqueuedAt"]) ?? ""
            )
        }
    }

    func teamsBoard(team: String, agents: [String]) async throws -> [TeamBoardEntry] {
        let response = try await send("teams.board", params: [
            "team": .string(team),
            "agents": .array(agents.map { .string($0) }),
        ])
        let values = response.result?.arrayValue ?? []
        return values.compactMap { value in
            guard let obj = value.objectValue else { return nil }
            return TeamBoardEntry(
                agent: rpcString(obj, ["agent"]) ?? "",
                pending: Int(rpcDouble(obj, ["pending"]) ?? 0),
                consumed: Int(rpcDouble(obj, ["consumed"]) ?? 0),
                done: Int(rpcDouble(obj, ["done"]) ?? 0)
            )
        }
    }

    // MARK: Snippets (Round 8 cross-surface prompt library)
    //
    // Wraps the daemon's snippet.* RPC handlers. Replaces the iOS-only
    // UserDefaults snippet store in `PromptLibraryView` so a snippet
    // written on phone shows up on desktop and vice versa.

    /// List snippets, optionally filtered. Returns favorites-first,
    /// then most-recently-used desc.
    func snippetList(
        category: String? = nil,
        favOnly: Bool = false,
        query: String? = nil
    ) async throws -> [Snippet] {
        var params: [String: RPCValue] = [:]
        if let category { params["category"] = .string(category) }
        if favOnly { params["favOnly"] = .bool(true) }
        if let query, !query.isEmpty { params["query"] = .string(query) }
        let response = try await send("snippet.list", params: params)
        guard let obj = response.result?.objectValue else { return [] }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        let arr = obj["snippets"]?.arrayValue ?? []
        return arr.compactMap { v in
            guard let snipObj = v.objectValue else { return nil }
            return parseSnippet(snipObj)
        }
    }

    /// Save (insert or update) a snippet. If `id` is omitted a new
    /// snippet is created; passing an existing id updates in place.
    func snippetSave(
        title: String,
        body: String,
        id: String? = nil,
        category: String? = nil,
        tags: [String] = [],
        isFavorite: Bool = false
    ) async throws -> Snippet {
        var params: [String: RPCValue] = [
            "title": .string(title),
            "body": .string(body),
            "tags": .array(tags.map { .string($0) }),
            "isFavorite": .bool(isFavorite),
        ]
        if let id { params["id"] = .string(id) }
        if let category { params["category"] = .string(category) }
        let response = try await send("snippet.save", params: params)
        guard let obj = response.result?.objectValue else {
            throw RPCError(code: -32603, message: "snippet.save returned non-object")
        }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        guard let snippetObj = obj["snippet"]?.objectValue else {
            throw RPCError(code: -32603, message: "snippet.save missing snippet field")
        }
        guard let snippet = parseSnippet(snippetObj) else {
            throw RPCError(code: -32603, message: "snippet.save returned malformed snippet")
        }
        return snippet
    }

    /// Hard-delete a snippet by id.
    @discardableResult
    func snippetDelete(id: String) async throws -> Bool {
        let response = try await send("snippet.delete", params: ["id": .string(id)])
        guard let obj = response.result?.objectValue else { return false }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        return rpcBool(obj, ["ok"]) ?? false
    }

    /// Render a snippet with `{{var}}` substitution AND record the use
    /// (bumps useCount + lastUsedAt). Returns the rendered prompt
    /// plus the names of variables the caller didn't supply, so the
    /// UI can warn about partial renders.
    func snippetUse(
        id: String,
        vars: [String: String] = [:]
    ) async throws -> (rendered: String, missingVars: [String], snippet: Snippet) {
        let varsValue: RPCValue = .object(
            Dictionary(uniqueKeysWithValues: vars.map { ($0.key, RPCValue.string($0.value)) })
        )
        let response = try await send("snippet.use", params: ["id": .string(id), "vars": varsValue])
        guard let obj = response.result?.objectValue else {
            throw RPCError(code: -32603, message: "snippet.use returned non-object")
        }
        if let err = rpcString(obj, ["error"]) { throw RPCError(code: -32000, message: err) }
        let rendered = rpcString(obj, ["rendered"]) ?? ""
        let missingArr = obj["missingVars"]?.arrayValue ?? []
        let missingVars = missingArr.compactMap { $0.stringValue }
        let snippetObj = obj["snippet"]?.objectValue ?? [:]
        guard let snippet = parseSnippet(snippetObj) else {
            throw RPCError(code: -32603, message: "snippet.use missing snippet field")
        }
        return (rendered, missingVars, snippet)
    }

    /// Look up a single snippet by id.
    func snippetGet(id: String) async throws -> Snippet? {
        let response = try await send("snippet.get", params: ["id": .string(id)])
        guard let obj = response.result?.objectValue else { return nil }
        if let err = rpcString(obj, ["error"]) {
            // Distinguish "not found" (return nil) from real errors (throw)
            if err.contains("not found") { return nil }
            throw RPCError(code: -32000, message: err)
        }
        guard let snippetObj = obj["snippet"]?.objectValue else { return nil }
        return parseSnippet(snippetObj)
    }

    /// Helper: parse a JSON-RPC object into a typed Snippet. Returns
    /// nil if the required fields are missing or malformed.
    private func parseSnippet(_ obj: [String: RPCValue]) -> Snippet? {
        guard let id = rpcString(obj, ["id"]),
              let title = rpcString(obj, ["title"]) ?? Optional("")
        else { return nil }
        let body = rpcString(obj, ["body"]) ?? ""
        let tagsArr = obj["tags"]?.arrayValue ?? []
        let tags = tagsArr.compactMap { $0.stringValue }
        let varsArr = obj["variables"]?.arrayValue ?? []
        let variables = varsArr.compactMap { $0.stringValue }
        return Snippet(
            id: id,
            title: title,
            body: body,
            category: rpcString(obj, ["category"]),
            tags: tags,
            isFavorite: rpcBool(obj, ["isFavorite"]) ?? false,
            useCount: Int(rpcDouble(obj, ["useCount"]) ?? 0),
            lastUsedAt: rpcDouble(obj, ["lastUsedAt"]).map { Int64($0) },
            createdAt: Int64(rpcDouble(obj, ["createdAt"]) ?? 0),
            updatedAt: Int64(rpcDouble(obj, ["updatedAt"]) ?? 0),
            variables: variables
        )
    }

    // MARK: Incoming Handler

    private func handleIncoming(_ data: Data) {
        // Decrypt the payload when ECDH key exchange is complete.
        let plainData: Data
        if let ecdh = ecdhManager, ecdh.isKeyExchangeComplete {
            do {
                plainData = try ecdh.decrypt(data)
            } catch {
                // Decryption failed -- try treating the data as unencrypted
                // (e.g. server may send some control messages in plaintext).
                plainData = data
            }
        } else {
            plainData = data
        }

        // Try as response (has id)
        if let response = try? decoder.decode(RPCResponse.self, from: plainData),
           let id = response.id,
           let continuation = pendingRequests.removeValue(forKey: id) {
            if let error = response.error {
                continuation.resume(throwing: error)
            } else {
                continuation.resume(returning: response)
            }
            return
        }

        // Try as event (no id, has method)
        if let event = try? decoder.decode(RPCEvent.self, from: plainData) {
            let handlers = subscriptions[event.method] ?? []
            for handler in handlers {
                handler(event)
            }

            if event.method == "stream",
               let object = event.params?.objectValue,
               let eventType = object["type"]?.stringValue {
                let alias = RPCEvent(jsonrpc: event.jsonrpc, method: "stream.\(eventType)", params: .object(object))
                for handler in subscriptions[alias.method] ?? [] {
                    handler(alias)
                }
            }
        }
    }
}

// MARK: - RPCError + Swift Error

extension RPCError: @unchecked Sendable, LocalizedError {
    var errorDescription: String? { message }
}
