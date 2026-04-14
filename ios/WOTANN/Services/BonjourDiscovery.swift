import Foundation
import Network

// MARK: - BonjourDiscovery

/// Discovers WOTANN desktop instances on the local network via Bonjour/mDNS.
/// Zero-config: phone finds desktop automatically on same WiFi.
@MainActor
class BonjourDiscovery: ObservableObject {
    @Published var discoveredHosts: [DiscoveredHost] = []
    @Published var isSearching = false

    private var browser: NWBrowser?
    private var resolveConnections: [UUID: NWConnection] = [:]

    struct DiscoveredHost: Identifiable, Hashable {
        let id: UUID
        let name: String
        let host: String
        let port: UInt16
        let discoveredAt: Date

        init(id: UUID = UUID(), name: String, host: String, port: UInt16, discoveredAt: Date = Date()) {
            self.id = id
            self.name = name
            self.host = host
            self.port = port
            self.discoveredAt = discoveredAt
        }
    }

    /// Start browsing for WOTANN services on the local network.
    func startDiscovery() {
        isSearching = true
        discoveredHosts = []
        cancelAllResolves()

        // Browse for WOTANN's Bonjour service type
        let params = NWParameters()
        params.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: "_wotann._tcp", domain: nil), using: params)

        browser?.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                guard let self else { return }
                for result in results {
                    self.resolveEndpoint(result.endpoint)
                }
            }
        }

        browser?.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                switch state {
                case .ready:
                    break // Browsing
                case .failed, .cancelled:
                    self?.isSearching = false
                default:
                    break
                }
            }
        }

        browser?.start(queue: .main)

        // Auto-stop after 10 seconds
        Task {
            try? await Task.sleep(for: .seconds(10))
            await MainActor.run {
                self.stopDiscovery()
            }
        }
    }

    /// Resolve a Bonjour service endpoint to an actual IP address and port
    /// by creating a temporary NWConnection and inspecting its resolved path.
    private func resolveEndpoint(_ endpoint: NWEndpoint) {
        guard case .service(let name, _, _, _) = endpoint else { return }

        // Skip if we already resolved this service name
        if discoveredHosts.contains(where: { $0.name == name }) { return }

        let resolveId = UUID()
        let connection = NWConnection(to: endpoint, using: .tcp)

        resolveConnections[resolveId] = connection

        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    // Extract the resolved IP and port from the connection path
                    if let resolvedEndpoint = connection.currentPath?.remoteEndpoint,
                       case .hostPort(let host, let port) = resolvedEndpoint {
                        let hostString: String
                        switch host {
                        case .ipv4(let addr):
                            hostString = "\(addr)"
                        case .ipv6(let addr):
                            // Prefer IPv4 — skip link-local IPv6 addresses (fe80::)
                            let v6str = "\(addr)"
                            if v6str.hasPrefix("fe80") || v6str.hasPrefix("::1") {
                                // Try to use localhost instead of link-local IPv6
                                hostString = "127.0.0.1"
                            } else {
                                hostString = v6str
                            }
                        case .name(let hostname, _):
                            hostString = hostname
                        @unknown default:
                            hostString = "\(host)"
                        }

                        let resolved = DiscoveredHost(
                            name: name,
                            host: hostString,
                            port: port.rawValue,
                            discoveredAt: Date()
                        )

                        // Append only if not already present
                        if !self.discoveredHosts.contains(where: { $0.name == name }) {
                            self.discoveredHosts.append(resolved)
                        }
                    }

                    // Clean up the resolve connection
                    connection.cancel()
                    self.resolveConnections.removeValue(forKey: resolveId)

                case .failed, .cancelled:
                    self.resolveConnections.removeValue(forKey: resolveId)

                default:
                    break
                }
            }
        }

        connection.start(queue: .main)
    }

    /// Stop browsing.
    func stopDiscovery() {
        browser?.cancel()
        browser = nil
        cancelAllResolves()
        isSearching = false
    }

    /// Cancel all in-flight resolve connections.
    private func cancelAllResolves() {
        for (_, connection) in resolveConnections {
            connection.cancel()
        }
        resolveConnections.removeAll()
    }

    /// Connect to a discovered host.
    func connect(to host: DiscoveredHost) -> (String, UInt16) {
        return (host.host, host.port)
    }
}
