import Foundation
import Combine

// MARK: - WebSocketClient

/// Low-level WebSocket client with auto-reconnect and heartbeat.
final class WebSocketClient: NSObject, @unchecked Sendable {

    // MARK: State

    enum State: Equatable {
        case disconnected
        case connecting
        case connected
        case reconnecting(attempt: Int)
    }

    private(set) var state: State = .disconnected
    private var url: URL?
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var heartbeatTimer: Timer?
    private var livenessTimer: Timer?
    private var reconnectTask: Task<Void, Never>?
    private var pongWatchdog: Task<Void, Never>?

    private let maxReconnectAttempts = 10
    private let baseReconnectDelay: TimeInterval = 1.0
    private let maxReconnectDelay: TimeInterval = 30.0
    private let heartbeatInterval: TimeInterval = 30.0
    private let pongTimeout: TimeInterval = 5.0
    private let livenessInterval: TimeInterval = 10.0
    private let livenessMaxIdle: TimeInterval = 45.0

    /// Timestamp of the most recent inbound message. Used by the liveness timer
    /// to detect stalled connections where the socket claims to be open but
    /// nothing is actually flowing.
    private(set) var lastSeenAt: Date = Date()

    // Callbacks
    var onStateChange: ((State) -> Void)?
    var onMessage: ((Data) -> Void)?
    var onError: ((Error) -> Void)?

    // MARK: Lifecycle

    func connect(to url: URL) {
        disconnect()

        self.url = url
        state = .connecting
        onStateChange?(.connecting)

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)

        task = session?.webSocketTask(with: url)
        task?.maximumMessageSize = 16 * 1024 * 1024  // 16MB — daemon responses can be large
        task?.resume()
        lastSeenAt = Date()
        startReceiving()
        startHeartbeat()
        startLivenessCheck()
        // State transitions to .connected via URLSessionWebSocketDelegate didOpenWithProtocol
    }

    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        pongWatchdog?.cancel()
        pongWatchdog = nil
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        livenessTimer?.invalidate()
        livenessTimer = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        state = .disconnected
        onStateChange?(.disconnected)
    }

    // MARK: Send

    func send(_ data: Data) async throws {
        guard let task, state == .connected else {
            throw WebSocketError.notConnected
        }
        try await task.send(.data(data))
    }

    func sendString(_ string: String) async throws {
        guard let task, state == .connected else {
            throw WebSocketError.notConnected
        }
        try await task.send(.string(string))
    }

    // MARK: Receive Loop

    private func startReceiving() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                // Any inbound payload proves the connection is alive
                self.lastSeenAt = Date()
                switch message {
                case .data(let data):
                    self.onMessage?(data)
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        self.onMessage?(data)
                    }
                @unknown default:
                    break
                }
                self.startReceiving()
            case .failure(let error):
                self.onError?(error)
                self.handleDisconnect(reason: "receive failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: Heartbeat

    private func startHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: heartbeatInterval, repeats: true) { [weak self] _ in
            self?.ping()
        }
    }

    private func ping() {
        // Track pong acknowledgement so a missing pong triggers a disconnect.
        var pongReceived = false
        task?.sendPing { [weak self] error in
            pongReceived = true
            guard let self else { return }
            if let error {
                self.onError?(error)
                self.handleDisconnect(reason: "ping error: \(error.localizedDescription)")
                return
            }
            // Pong-as-inbound also counts as liveness
            self.lastSeenAt = Date()
        }

        // Watchdog: if the pong callback hasn't fired within pongTimeout
        // seconds, force a disconnect so the reconnect loop takes over.
        pongWatchdog?.cancel()
        pongWatchdog = Task { [weak self, pongTimeout] in
            try? await Task.sleep(nanoseconds: UInt64(pongTimeout * 1_000_000_000))
            guard !Task.isCancelled else { return }
            guard let self = self else { return }
            if !pongReceived && self.state == .connected {
                self.handleDisconnect(reason: "pong timeout")
            }
        }
    }

    // MARK: Liveness

    /// Periodically verifies that the connection isn't silently stalled.
    /// If no inbound data has arrived in `livenessMaxIdle` seconds while we
    /// still claim to be connected, we force a reconnect.
    private func startLivenessCheck() {
        livenessTimer?.invalidate()
        livenessTimer = Timer.scheduledTimer(withTimeInterval: livenessInterval, repeats: true) { [weak self] _ in
            guard let self else { return }
            let idle = Date().timeIntervalSince(self.lastSeenAt)
            if idle > self.livenessMaxIdle && self.state == .connected {
                self.handleDisconnect(reason: "liveness timeout (\(Int(idle))s idle)")
            }
        }
    }

    // MARK: Reconnect

    private func handleDisconnect(reason: String = "") {
        guard state != .disconnected else { return }

        if !reason.isEmpty {
            print("[WOTANN WS] Disconnect: \(reason)")
        }

        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        livenessTimer?.invalidate()
        livenessTimer = nil
        pongWatchdog?.cancel()
        pongWatchdog = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self, let url = self.url else { return }

            for attempt in 1...self.maxReconnectAttempts {
                guard !Task.isCancelled else { return }

                self.state = .reconnecting(attempt: attempt)
                self.onStateChange?(.reconnecting(attempt: attempt))

                let uncapped = self.baseReconnectDelay * pow(2.0, Double(attempt - 1))
                let delay = min(uncapped, self.maxReconnectDelay)
                let jitter = Double.random(in: 0...0.5)
                try? await Task.sleep(nanoseconds: UInt64((delay + jitter) * 1_000_000_000))

                guard !Task.isCancelled else { return }

                let config = URLSessionConfiguration.default
                self.session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
                self.task = self.session?.webSocketTask(with: url)
                self.task?.maximumMessageSize = 16 * 1024 * 1024  // 16MB
                self.task?.resume()
                self.lastSeenAt = Date()
                self.startReceiving()
                self.startHeartbeat()
                self.startLivenessCheck()

                // Wait briefly for the delegate to confirm connection
                try? await Task.sleep(nanoseconds: 500_000_000)

                // If delegate set state to .connected, we are done
                if self.state == .connected {
                    return
                }

                // If still not connected after delegate callback window, continue retrying
                self.task?.cancel(with: .normalClosure, reason: nil)
                self.task = nil
                self.session?.invalidateAndCancel()
                self.session = nil
            }

            self.state = .disconnected
            self.onStateChange?(.disconnected)
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        state = .connected
        onStateChange?(.connected)
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) } ?? "close code \(closeCode.rawValue)"
        handleDisconnect(reason: "server closed: \(reasonText)")
    }
}

// MARK: - Errors

enum WebSocketError: LocalizedError {
    case notConnected
    case encodingFailed
    case decodingFailed
    case timeout

    var errorDescription: String? {
        switch self {
        case .notConnected:  return "Not connected to server"
        case .encodingFailed: return "Failed to encode message"
        case .decodingFailed: return "Failed to decode response"
        case .timeout:       return "Request timed out"
        }
    }
}
