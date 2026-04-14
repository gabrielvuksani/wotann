import Foundation
@preconcurrency import CoreNFC
import Combine

// MARK: - NFCPairingError

/// Errors from NFC tag reading and writing operations.
enum NFCPairingError: LocalizedError {
    case nfcUnavailable
    case scanCancelled
    case invalidPayload(String)
    case readFailed(Error)
    case writeFailed(Error)
    case noRecordsFound
    case sessionInvalidated(String)

    var errorDescription: String? {
        switch self {
        case .nfcUnavailable:
            return "NFC is not available on this device"
        case .scanCancelled:
            return "NFC scan was cancelled"
        case .invalidPayload(let detail):
            return "Invalid pairing payload: \(detail)"
        case .readFailed(let error):
            return "Failed to read NFC tag: \(error.localizedDescription)"
        case .writeFailed(let error):
            return "Failed to write NFC tag: \(error.localizedDescription)"
        case .noRecordsFound:
            return "No NDEF records found on tag"
        case .sessionInvalidated(let reason):
            return "NFC session ended: \(reason)"
        }
    }
}

// MARK: - NFCPairingData

/// Parsed pairing data from an NFC tag's NDEF URI record.
struct NFCPairingData: Equatable {
    let host: String
    let publicKey: String
    let port: Int
    let deviceId: String?

    /// The wotann:// URL representation of this pairing data.
    var urlString: String {
        var components = URLComponents()
        components.scheme = "wotann"
        components.host = "pair"
        var items = [
            URLQueryItem(name: "host", value: host),
            URLQueryItem(name: "key", value: publicKey),
            URLQueryItem(name: "port", value: "\(port)"),
        ]
        if let deviceId {
            items.append(URLQueryItem(name: "deviceId", value: deviceId))
        }
        components.queryItems = items
        return components.url?.absoluteString ?? ""
    }
}

// MARK: - NFCPairingService

/// NFC tap-to-pair service for WOTANN.
///
/// Reads `wotann://pair?host=...&key=...` from NDEF URI records on NFC tags.
/// Hold phone near a MacBook with an NFC tag for instant pairing.
///
/// Usage:
/// 1. Call `startScanning()` to open the NFC reader sheet
/// 2. On successful read, `onPairingDataRead` fires with the parsed data
/// 3. The caller (typically ConnectionManager) completes the pairing handshake
///
/// Writing tags:
/// - Call `writePairingTag(host:publicKey:port:)` to write a WOTANN pairing
///   payload to a blank NFC tag
@MainActor
final class NFCPairingService: NSObject, ObservableObject {

    // MARK: Published State

    @Published var isScanning = false
    @Published var lastPairingData: NFCPairingData?
    @Published var error: NFCPairingError?
    @Published var tagWriteSuccess = false

    // MARK: Callbacks

    /// Called when valid pairing data is read from an NFC tag.
    var onPairingDataRead: ((NFCPairingData) -> Void)?

    // MARK: Private

    private var readerSession: NFCNDEFReaderSession?
    private var pendingWritePayload: NFCPairingData?

    // MARK: - NFC Availability

    /// Whether the device supports NFC NDEF reading.
    static var isAvailable: Bool {
        NFCNDEFReaderSession.readingAvailable
    }

    // MARK: - Scanning

    /// Open the NFC reader to scan for a WOTANN pairing tag.
    /// The system NFC sheet appears with "Hold your iPhone near a WOTANN tag."
    func startScanning() {
        guard Self.isAvailable else {
            error = .nfcUnavailable
            return
        }

        error = nil
        tagWriteSuccess = false
        pendingWritePayload = nil

        readerSession = NFCNDEFReaderSession(
            delegate: self,
            queue: nil,
            invalidateAfterFirstRead: true
        )
        readerSession?.alertMessage = "Hold your iPhone near a WOTANN tag to pair."
        readerSession?.begin()
        isScanning = true
    }

    /// Cancel any active NFC reader session.
    func cancelScanning() {
        readerSession?.invalidate()
        readerSession = nil
        isScanning = false
    }

    // MARK: - Writing

    /// Write a WOTANN pairing payload to an NFC tag.
    ///
    /// The tag will contain an NDEF URI record with:
    /// `wotann://pair?host=<host>&key=<publicKey>&port=<port>`
    ///
    /// - Parameters:
    ///   - host: The desktop's local IP or hostname.
    ///   - publicKey: Base64-encoded ECDH public key.
    ///   - port: The desktop's WebSocket port.
    ///   - deviceId: Optional desktop device identifier.
    func writePairingTag(
        host: String,
        publicKey: String,
        port: Int = 3849,
        deviceId: String? = nil
    ) {
        guard Self.isAvailable else {
            error = .nfcUnavailable
            return
        }

        error = nil
        tagWriteSuccess = false

        pendingWritePayload = NFCPairingData(
            host: host,
            publicKey: publicKey,
            port: port,
            deviceId: deviceId
        )

        // Open a write-capable session (do not invalidate after first read)
        readerSession = NFCNDEFReaderSession(
            delegate: self,
            queue: nil,
            invalidateAfterFirstRead: false
        )
        readerSession?.alertMessage = "Hold your iPhone near a blank NFC tag to write pairing data."
        readerSession?.begin()
        isScanning = true
    }

    // MARK: - Parsing

    /// Parse pairing data from NDEF records.
    /// Looks for a URI record with scheme `wotann://pair`.
    ///
    /// - Parameter records: NDEF records from the scanned tag.
    /// - Returns: Parsed pairing data, or nil if no valid record found.
    func readPairingData(from records: [NFCNDEFPayload]) -> NFCPairingData? {
        for record in records {
            // Check for URI record type (TNF = well-known, type = "U")
            guard record.typeNameFormat == .nfcWellKnown ||
                  record.typeNameFormat == .absoluteURI else { continue }

            // Try to extract as a URL
            guard let url = record.wellKnownTypeURIPayload(),
                  url.scheme == "wotann",
                  url.host == "pair" else { continue }

            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let items = components.queryItems else { continue }

            let params = Dictionary(
                uniqueKeysWithValues: items.compactMap { item -> (String, String)? in
                    guard let value = item.value else { return nil }
                    return (item.name, value)
                }
            )

            guard let host = params["host"],
                  let publicKey = params["key"] else { continue }

            let port = Int(params["port"] ?? "3849") ?? 3849
            let deviceId = params["deviceId"]

            return NFCPairingData(
                host: host,
                publicKey: publicKey,
                port: port,
                deviceId: deviceId
            )
        }

        return nil
    }

    // MARK: - NDEF Message Construction

    /// Build an NDEF message containing the pairing URI.
    private func buildNDEFMessage(for pairingData: NFCPairingData) -> NFCNDEFMessage? {
        guard let url = URL(string: pairingData.urlString) else { return nil }

        guard let payload = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else { return nil }

        return NFCNDEFMessage(records: [payload])
    }
}

// MARK: - NFCNDEFReaderSessionDelegate

extension NFCPairingService: NFCNDEFReaderSessionDelegate {

    nonisolated func readerSession(
        _ session: NFCNDEFReaderSession,
        didDetectNDEFs messages: [NFCNDEFMessage]
    ) {
        Task { @MainActor in
            self.isScanning = false

            let allRecords = messages.flatMap { $0.records }

            guard let pairingData = readPairingData(from: allRecords) else {
                self.error = .noRecordsFound
                return
            }

            self.lastPairingData = pairingData
            self.onPairingDataRead?(pairingData)

            HapticService.shared.trigger(.pairingSuccess)
        }
    }

    nonisolated func readerSession(
        _ session: NFCNDEFReaderSession,
        didDetect tags: [any NFCNDEFTag]
    ) {
        Task { @MainActor in
            guard let tag = tags.first else {
                session.invalidate(errorMessage: "No tag detected.")
                self.isScanning = false
                return
            }

            do {
                try await session.connect(to: tag)
            } catch {
                session.invalidate(errorMessage: "Connection failed.")
                self.error = .readFailed(error)
                self.isScanning = false
                return
            }

            // Writing mode: write the pending payload to the tag
            if let writePayload = self.pendingWritePayload {
                await self.writeToTag(tag, pairingData: writePayload, session: session)
                return
            }

            // Reading mode: read NDEF content from the tag
            await self.readFromTag(tag, session: session)
        }
    }

    nonisolated func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {
        // Session is active; the system sheet is visible.
    }

    nonisolated func readerSession(
        _ session: NFCNDEFReaderSession,
        didInvalidateWithError error: any Error
    ) {
        Task { @MainActor in
            self.isScanning = false
            self.readerSession = nil

            let nfcError = error as NSError
            // Code 200 = user cancelled; do not surface as an error
            if nfcError.domain == "NFCError" && nfcError.code == 200 {
                self.error = .scanCancelled
            } else {
                self.error = .sessionInvalidated(error.localizedDescription)
            }
        }
    }

    // MARK: - Read / Write Helpers

    private func readFromTag(_ tag: any NFCNDEFTag, session: NFCNDEFReaderSession) async {
        do {
            let (status, _) = try await tag.queryNDEFStatus()
            guard status == .readOnly || status == .readWrite else {
                session.invalidate(errorMessage: "Tag is not NDEF formatted.")
                self.error = .noRecordsFound
                self.isScanning = false
                return
            }

            let message = try await tag.readNDEF()
            let pairingData = readPairingData(from: message.records)

            session.alertMessage = pairingData != nil ? "Pairing data found!" : "No pairing data on tag."
            session.invalidate()

            if let pairingData {
                self.lastPairingData = pairingData
                self.onPairingDataRead?(pairingData)
                HapticService.shared.trigger(.pairingSuccess)
            } else {
                self.error = .noRecordsFound
            }
        } catch {
            session.invalidate(errorMessage: "Read failed.")
            self.error = .readFailed(error)
        }

        self.isScanning = false
    }

    private func writeToTag(
        _ tag: any NFCNDEFTag,
        pairingData: NFCPairingData,
        session: NFCNDEFReaderSession
    ) async {
        do {
            let (status, _) = try await tag.queryNDEFStatus()
            guard status == .readWrite else {
                session.invalidate(errorMessage: "Tag is read-only.")
                self.error = .writeFailed(
                    NSError(domain: "NFCPairingService", code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "Tag is read-only"])
                )
                self.isScanning = false
                return
            }

            guard let message = buildNDEFMessage(for: pairingData) else {
                session.invalidate(errorMessage: "Failed to encode pairing data.")
                self.error = .invalidPayload("Could not build NDEF message")
                self.isScanning = false
                return
            }

            try await tag.writeNDEF(message)

            session.alertMessage = "Pairing tag written successfully!"
            session.invalidate()

            self.tagWriteSuccess = true
            self.pendingWritePayload = nil
            HapticService.shared.trigger(.taskComplete)
        } catch {
            session.invalidate(errorMessage: "Write failed.")
            self.error = .writeFailed(error)
        }

        self.isScanning = false
    }
}
