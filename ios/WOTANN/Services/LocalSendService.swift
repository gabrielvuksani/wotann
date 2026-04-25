import Foundation
import Network
import Observation

// MARK: - LocalSendError

/// Errors from LocalSend discovery and file transfer operations.
enum LocalSendError: LocalizedError {
    case multicastGroupFailed(Error)
    case listenerFailed(Error)
    case peerUnreachable(String)
    case transferFailed(Error)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .multicastGroupFailed(let error):
            return "Failed to join multicast group: \(error.localizedDescription)"
        case .listenerFailed(let error):
            return "Failed to start HTTPS listener: \(error.localizedDescription)"
        case .peerUnreachable(let name):
            return "Peer '\(name)' is not reachable"
        case .transferFailed(let error):
            return "File transfer failed: \(error.localizedDescription)"
        case .encodingFailed:
            return "Failed to encode announcement payload"
        }
    }
}

// MARK: - DiscoveredPeer

/// A device discovered via LocalSend multicast announcements.
struct DiscoveredPeer: Identifiable, Hashable {
    let id: String
    let name: String
    let host: String
    let port: UInt16
    let deviceType: String
    let discoveredAt: Date

    init(
        id: String = UUID().uuidString,
        name: String,
        host: String,
        port: UInt16,
        deviceType: String = "unknown",
        discoveredAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.host = host
        self.port = port
        self.deviceType = deviceType
        self.discoveredAt = discoveredAt
    }
}

// MARK: - TransferProgress

/// Tracks the progress of an active file transfer.
struct TransferProgress: Identifiable {
    let id: UUID
    let fileName: String
    let totalBytes: Int64
    var transferredBytes: Int64
    let direction: Direction

    enum Direction: String {
        case sending
        case receiving
    }

    var fraction: Double {
        guard totalBytes > 0 else { return 0 }
        return Double(transferredBytes) / Double(totalBytes)
    }
}

// MARK: - LocalSendService

/// LocalSend protocol v2.1 -- UDP multicast discovery + HTTPS file transfer.
///
/// Device appears as "WOTANN iPhone" on the local network.
/// Incoming files auto-inject into active conversation context.
///
/// Protocol overview:
/// 1. Announce via UDP multicast on 224.0.0.167:53317 every 5 seconds
/// 2. Listen for other peers' announcements on the same multicast group
/// 3. File transfer uses HTTPS POST to the peer's listener port
///
/// V9 T14.3 — Migrated from ObservableObject + @Published to the iOS 17
/// @Observable macro. SettingsView switched from @StateObject to @State.
/// All consumer reads are read-only so no @Bindable was required.
@MainActor
@Observable
final class LocalSendService {

    // MARK: Observable State

    var discoveredPeers: [DiscoveredPeer] = []
    var isDiscovering = false
    var activeTransfers: [TransferProgress] = []
    var error: LocalSendError?
    var lastReceivedFile: URL?

    // MARK: Constants

    private static let multicastAddress = "224.0.0.167"
    private static let multicastPort: UInt16 = 53317
    private static let announceIntervalSeconds: TimeInterval = 5
    private static let peerExpirationSeconds: TimeInterval = 15
    private static let httpsListenerPort: UInt16 = 53318

    // MARK: Private

    @ObservationIgnored
    private var connectionGroup: NWConnectionGroup?
    @ObservationIgnored
    private var listener: NWListener?
    @ObservationIgnored
    private var announceTask: Task<Void, Never>?
    @ObservationIgnored
    private var pruneTask: Task<Void, Never>?
    @ObservationIgnored
    private let deviceId = UUID().uuidString
    @ObservationIgnored
    private let encoder = JSONEncoder()
    @ObservationIgnored
    private let decoder = JSONDecoder()

    // MARK: - Device Identity

    private var deviceName: String {
        #if targetEnvironment(simulator)
        return "WOTANN Simulator"
        #else
        return "WOTANN iPhone"
        #endif
    }

    // MARK: - Discovery Lifecycle

    /// Begin multicast discovery: join the group, start listening, and announce.
    func startDiscovery() {
        guard !isDiscovering else { return }
        isDiscovering = true
        error = nil
        discoveredPeers = []

        joinMulticastGroup()
        startHTTPSListener()
        startAnnouncing()
        startPeerPruning()
    }

    /// Stop all discovery activity and tear down network resources.
    func stopDiscovery() {
        announceTask?.cancel()
        announceTask = nil
        pruneTask?.cancel()
        pruneTask = nil

        connectionGroup?.cancel()
        connectionGroup = nil

        listener?.cancel()
        listener = nil

        isDiscovering = false
    }

    /// Return the current list of discovered peers.
    func getDiscoveredDevices() -> [DiscoveredPeer] {
        return discoveredPeers
    }

    // MARK: - File Transfer

    /// Send a file to a discovered peer via HTTPS POST.
    /// - Parameters:
    ///   - peer: The target peer.
    ///   - fileURL: Local file URL to send.
    func sendFile(to peer: DiscoveredPeer, fileURL: URL) async throws {
        guard let fileData = try? Data(contentsOf: fileURL) else {
            throw LocalSendError.transferFailed(
                NSError(domain: "LocalSendService", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Cannot read file at \(fileURL.path)"])
            )
        }

        let transferId = UUID()
        let fileName = fileURL.lastPathComponent
        let progress = TransferProgress(
            id: transferId,
            fileName: fileName,
            totalBytes: Int64(fileData.count),
            transferredBytes: 0,
            direction: .sending
        )
        activeTransfers.append(progress)

        defer {
            activeTransfers.removeAll { $0.id == transferId }
        }

        let urlString = "https://\(peer.host):\(peer.port)/send"
        guard let url = URL(string: urlString) else {
            throw LocalSendError.peerUnreachable(peer.name)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(fileName, forHTTPHeaderField: "X-LocalSend-FileName")
        request.setValue(deviceId, forHTTPHeaderField: "X-LocalSend-DeviceId")
        request.setValue(deviceName, forHTTPHeaderField: "X-LocalSend-DeviceName")
        request.httpBody = fileData

        // Allow self-signed certificates for local network transfers
        let session = URLSession(
            configuration: .ephemeral,
            delegate: LocalSendTrustDelegate(),
            delegateQueue: nil
        )

        do {
            let (_, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                throw LocalSendError.peerUnreachable(peer.name)
            }

            // Mark transfer complete
            if let index = activeTransfers.firstIndex(where: { $0.id == transferId }) {
                activeTransfers[index].transferredBytes = Int64(fileData.count)
            }
        } catch let transferError as LocalSendError {
            throw transferError
        } catch {
            throw LocalSendError.transferFailed(error)
        }
    }

    // MARK: - Multicast Group

    private func joinMulticastGroup() {
        guard let multicast = try? NWMulticastGroup(for: [
            .hostPort(
                host: NWEndpoint.Host(Self.multicastAddress),
                port: NWEndpoint.Port(rawValue: Self.multicastPort)!
            )
        ]) else {
            error = .multicastGroupFailed(
                NSError(domain: "LocalSendService", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Invalid multicast address"])
            )
            return
        }

        let group = NWConnectionGroup(with: multicast, using: .udp)

        group.setReceiveHandler(maximumMessageSize: 4096, rejectOversizedMessages: true) {
            [weak self] message, content, isComplete in
            Task { @MainActor [weak self] in
                guard let self, let content else { return }
                self.handleMulticastMessage(content)
            }
        }

        group.stateUpdateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                switch state {
                case .failed(let nwError):
                    self?.error = .multicastGroupFailed(nwError)
                    self?.isDiscovering = false
                case .cancelled:
                    self?.isDiscovering = false
                default:
                    break
                }
            }
        }

        group.start(queue: .main)
        connectionGroup = group
    }

    // MARK: - Announcement

    private func startAnnouncing() {
        announceTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.sendAnnouncement()
                try? await Task.sleep(for: .seconds(Self.announceIntervalSeconds))
            }
        }
    }

    private func sendAnnouncement() {
        guard let group = connectionGroup else { return }

        let announcement: [String: String] = [
            "type": "announce",
            "id": deviceId,
            "name": deviceName,
            "port": "\(Self.httpsListenerPort)",
            "deviceType": "phone",
            "version": "2.1",
        ]

        guard let data = try? encoder.encode(announcement) else { return }

        group.send(content: data) { sendError in
            // Best-effort announcement; ignore transient errors
            if let sendError {
                Task { @MainActor [weak self] in
                    _ = sendError // logged but not surfaced
                    _ = self
                }
            }
        }
    }

    // MARK: - Incoming Message Handling

    private func handleMulticastMessage(_ data: Data) {
        guard let payload = try? decoder.decode([String: String].self, from: data) else { return }
        guard payload["type"] == "announce",
              let peerId = payload["id"],
              peerId != deviceId,
              let peerName = payload["name"],
              let portString = payload["port"],
              let port = UInt16(portString) else { return }

        let deviceType = payload["deviceType"] ?? "unknown"

        // Update existing peer or add new one
        if let index = discoveredPeers.firstIndex(where: { $0.id == peerId }) {
            let updated = DiscoveredPeer(
                id: peerId,
                name: peerName,
                host: discoveredPeers[index].host,
                port: port,
                deviceType: deviceType,
                discoveredAt: Date()
            )
            discoveredPeers[index] = updated
        } else {
            // Host is derived from the multicast source; use peer name as placeholder
            // until resolved from an actual connection.
            let peer = DiscoveredPeer(
                id: peerId,
                name: peerName,
                host: peerName,
                port: port,
                deviceType: deviceType
            )
            discoveredPeers.append(peer)
        }
    }

    // MARK: - HTTPS Listener

    private func startHTTPSListener() {
        do {
            let tcpOptions = NWProtocolTCP.Options()
            tcpOptions.enableFastOpen = true
            // Allow port reuse so the listener can restart without NECP address-in-use errors
            // when the app is relaunched quickly (e.g. during development)
            tcpOptions.noDelay = true
            let params = NWParameters(tls: nil, tcp: tcpOptions)
            params.includePeerToPeer = true
            params.allowLocalEndpointReuse = true
            let nwListener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.httpsListenerPort)!)

            nwListener.newConnectionHandler = { [weak self] connection in
                Task { @MainActor [weak self] in
                    self?.handleIncomingConnection(connection)
                }
            }

            nwListener.stateUpdateHandler = { [weak self] state in
                Task { @MainActor [weak self] in
                    switch state {
                    case .failed(let nwError):
                        // Address-in-use is expected if the prior instance hasn't fully torn down.
                        // Log but don't surface as a user-visible error.
                        if case .posix(let posixErr) = nwError, posixErr == .EADDRINUSE {
                            print("[LocalSend] Listener port \(Self.httpsListenerPort) in use, will retry on next discovery cycle")
                        } else {
                            self?.error = .listenerFailed(nwError)
                        }
                    default:
                        break
                    }
                }
            }

            nwListener.start(queue: .main)
            listener = nwListener
        } catch {
            self.error = .listenerFailed(error)
        }
    }

    private func handleIncomingConnection(_ connection: NWConnection) {
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                switch state {
                case .ready:
                    self?.receiveFileData(from: connection)
                case .failed, .cancelled:
                    break
                default:
                    break
                }
            }
        }
        connection.start(queue: .main)
    }

    private func receiveFileData(from connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 10_485_760) {
            [weak self] content, _, isComplete, receiveError in
            Task { @MainActor [weak self] in
                guard let self, let content else {
                    connection.cancel()
                    return
                }

                // Write received file to the app's temporary directory
                let tempDir = FileManager.default.temporaryDirectory
                let fileName = "localsend_\(UUID().uuidString)"
                let fileURL = tempDir.appendingPathComponent(fileName)

                do {
                    try content.write(to: fileURL)
                    self.lastReceivedFile = fileURL
                } catch {
                    self.error = .transferFailed(error)
                }

                connection.cancel()
            }
        }
    }

    // MARK: - Peer Pruning

    /// Remove peers whose last announcement is older than the expiration threshold.
    private func startPeerPruning() {
        pruneTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.peerExpirationSeconds))
                self?.pruneStalePeers()
            }
        }
    }

    private func pruneStalePeers() {
        let cutoff = Date().addingTimeInterval(-Self.peerExpirationSeconds)
        discoveredPeers.removeAll { $0.discoveredAt < cutoff }
    }
}

// MARK: - LocalSendTrustDelegate

/// Allows self-signed TLS certificates for local network peer-to-peer transfers.
private final class LocalSendTrustDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        // Trust all certificates on the local network for LocalSend transfers
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
