import Foundation
import SwiftUI
import OSLog
#if canImport(UIKit)
import UIKit
#endif

// MARK: - DiagnosticSeverity

/// Severity levels mirror `OSLogType` so entries can also be sent to the
/// unified logging system without losing information.
public enum DiagnosticSeverity: String, Codable, Sendable {
    case debug
    case info
    case notice
    case warning
    case error
    case fault

    fileprivate var osLogType: OSLogType {
        switch self {
        case .debug:   return .debug
        case .info:    return .info
        case .notice:  return .default
        case .warning: return .default
        case .error:   return .error
        case .fault:   return .fault
        }
    }

    fileprivate var emojiMarker: String {
        switch self {
        case .debug:   return "D"
        case .info:    return "I"
        case .notice:  return "N"
        case .warning: return "W"
        case .error:   return "E"
        case .fault:   return "F"
        }
    }
}

// MARK: - DiagnosticEvent

/// A single structured diagnostic event. Codable so entries can be exported
/// as JSONL for machine parsing in addition to the pretty `.log` format.
public struct DiagnosticEvent: Codable, Sendable, Identifiable {
    public let id: UUID
    public let timestamp: Date
    public let subsystem: String
    public let feature: String
    public let severity: DiagnosticSeverity
    public let message: String
    public let metadata: [String: String]

    public init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        subsystem: String,
        feature: String,
        severity: DiagnosticSeverity,
        message: String,
        metadata: [String: String] = [:]
    ) {
        self.id = id
        self.timestamp = timestamp
        self.subsystem = subsystem
        self.feature = feature
        self.severity = severity
        self.message = message
        self.metadata = metadata
    }

    /// ISO 8601 timestamp formatter with millisecond precision.
    fileprivate static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Pretty single-line format for the `.log` file.
    /// Shape: `<iso-timestamp> [<severity>] <subsystem>/<feature>: <message> {k=v, ...}`
    public var formattedLine: String {
        let ts = Self.timestampFormatter.string(from: timestamp)
        let sev = severity.emojiMarker
        var base = "\(ts) [\(sev)] \(subsystem)/\(feature): \(message)"
        if !metadata.isEmpty {
            let sortedPairs = metadata
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\(Self.safeValue($0.value))" }
                .joined(separator: ", ")
            base += " {\(sortedPairs)}"
        }
        return base
    }

    /// Escape whitespace and control characters in metadata values so the log
    /// stays single-line and machine-parseable.
    private static func safeValue(_ raw: String) -> String {
        raw.replacingOccurrences(of: "\n", with: "\\n")
           .replacingOccurrences(of: "\r", with: "\\r")
           .replacingOccurrences(of: "\t", with: "\\t")
    }
}

// MARK: - DiagnosticLogger

/// Lightweight on-device logger used by the physical-device test flow.
///
/// Design goals:
/// - Persist every event to a single `.log` file in the app's Documents
///   directory so a failing device can be diagnosed post-hoc
/// - Mirror each event to `OSLog` under `subsystem = "com.wotann.ios"` so
///   Console.app filtering works for live sessions
/// - Provide a `share()` entry point for exposing the log via `UIActivityViewController`
/// - Non-blocking: file writes go through a serial background queue so the
///   caller thread (often main) is never stalled
///
/// Thread safety: all public methods are safe to call from any thread. Writes
/// are serialised on an internal queue; in-memory state is protected by a lock.
public final class DiagnosticLogger: @unchecked Sendable {

    // MARK: Singleton

    /// Shared instance. A singleton is appropriate here because the log file
    /// is process-wide and there should only ever be one writer per process.
    public static let shared = DiagnosticLogger()

    // MARK: - Public configuration

    /// The subsystem string used for Console.app filtering (matches the
    /// checklist documentation in `PhysicalDeviceTestChecklist.md`).
    public static let defaultSubsystem = "com.wotann.ios"

    /// Soft cap on the log file size. When the file exceeds this size on the
    /// next write, the file is rotated (renamed to `.log.old`) and a fresh
    /// file started. Keeps disk usage bounded on long-running devices.
    public static let maxFileSizeBytes: Int = 5 * 1024 * 1024 // 5 MB

    // MARK: - Private state

    private let fileManager = FileManager.default
    private let writeQueue = DispatchQueue(label: "com.wotann.ios.DiagnosticLogger.write", qos: .utility)
    private let stateLock = NSLock()
    private let osLog: OSLog

    /// In-memory ring of recent events for UI display. Capped to avoid
    /// unbounded growth; older events live only on disk.
    private var recentEventsStorage: [DiagnosticEvent] = []
    private let recentEventsMaxCount = 512

    /// Whether the logger has been enabled by the app. Defaults to ON but can
    /// be disabled from Settings to stop writing (useful if a user is worried
    /// about disk usage).
    private var isEnabledStorage: Bool = true

    // MARK: - Init

    /// Initialiser exposed for testing. Production code should use `.shared`.
    /// - Parameter subsystem: OSLog subsystem tag. Defaults to the constant
    ///   used by the production build.
    public init(subsystem: String = DiagnosticLogger.defaultSubsystem) {
        self.osLog = OSLog(subsystem: subsystem, category: "diagnostic")
        // Ensure the log directory exists. If this fails we simply keep
        // in-memory state — we do not crash, because the logger must be more
        // resilient than the app it is logging.
        _ = try? ensureLogDirectoryExists()
    }

    // MARK: - Public API

    /// Enable or disable persistence. When disabled, events are still mirrored
    /// to `OSLog` but NOT written to disk.
    public var isEnabled: Bool {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return isEnabledStorage
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            isEnabledStorage = newValue
        }
    }

    /// Snapshot of the recent events for UI rendering. Returns a copy so the
    /// caller cannot mutate internal state.
    public var recentEvents: [DiagnosticEvent] {
        stateLock.lock()
        defer { stateLock.unlock() }
        return recentEventsStorage
    }

    /// Absolute path to the current log file. Exposed so tests and Settings
    /// can inspect it without going through the share sheet.
    public var logFileURL: URL {
        logFileURLInternal
    }

    /// Record an event. Thread-safe. Non-blocking.
    /// - Parameters:
    ///   - feature: Short feature name used for filtering. Example: `pairing`,
    ///     `streaming-chat`, `memory-search`.
    ///   - severity: Log level. Defaults to `.info`.
    ///   - message: Human-readable description.
    ///   - metadata: Optional key/value pairs. Avoid putting secrets here —
    ///     the file is persisted to Documents which is accessible to the user
    ///     and any future iTunes-style backup.
    public func log(
        feature: String,
        severity: DiagnosticSeverity = .info,
        message: String,
        metadata: [String: String] = [:]
    ) {
        let event = DiagnosticEvent(
            subsystem: DiagnosticLogger.defaultSubsystem,
            feature: feature,
            severity: severity,
            message: message,
            metadata: metadata
        )
        record(event)
    }

    /// Convenience for recording an `Error` value. The error's localized
    /// description becomes the message; the domain/code are added to metadata
    /// when available.
    public func log(
        feature: String,
        error: Error,
        additionalMetadata: [String: String] = [:]
    ) {
        var metadata = additionalMetadata
        let nsError = error as NSError
        metadata["error_domain"] = nsError.domain
        metadata["error_code"] = String(nsError.code)
        log(
            feature: feature,
            severity: .error,
            message: error.localizedDescription,
            metadata: metadata
        )
    }

    /// Clear the on-disk log and in-memory ring.
    public func clear() {
        writeQueue.async { [weak self] in
            guard let self else { return }
            try? self.fileManager.removeItem(at: self.logFileURLInternal)
            let rotated = self.rotatedLogFileURLInternal
            try? self.fileManager.removeItem(at: rotated)
            self.stateLock.lock()
            self.recentEventsStorage.removeAll(keepingCapacity: true)
            self.stateLock.unlock()
        }
    }

    /// Read the full log file as a `String`. Returns `nil` if the file does
    /// not exist. Performs disk IO; call off the main thread for large logs.
    public func snapshotLogFile() -> String? {
        guard fileManager.fileExists(atPath: logFileURLInternal.path) else {
            return nil
        }
        return try? String(contentsOf: logFileURLInternal, encoding: .utf8)
    }

    #if canImport(UIKit)
    /// Present the system share sheet with the current log file attached.
    ///
    /// - Parameter presenter: A view controller to present from. If `nil`,
    ///   the method looks up the active key window's root view controller.
    /// - Returns: `true` if the share sheet was presented, `false` otherwise
    ///   (for example if the log file does not yet exist).
    @MainActor
    @discardableResult
    public func share(from presenter: UIViewController? = nil) -> Bool {
        // If the log file is not yet on disk, write a single heartbeat so the
        // share sheet has something real to attach. This makes the "share"
        // entry point honest — the user gets content rather than a silent
        // no-op — and if the write still fails we return `false`.
        if !fileManager.fileExists(atPath: logFileURLInternal.path) {
            log(
                feature: "diagnostic-logger",
                severity: .info,
                message: "share() requested on empty log; writing heartbeat"
            )
            flushSynchronously()
            if !fileManager.fileExists(atPath: logFileURLInternal.path) {
                return false
            }
        }

        let items: [Any] = [logFileURLInternal]
        let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // Narrow the activity list to the types that make sense for a log
        // file (AirDrop, Mail, Messages, Save to Files). Use only the
        // activity-type constants that remain supported across iOS 18 SDKs
        // to avoid deprecation warnings from SDK-specific symbols.
        activity.excludedActivityTypes = [
            .addToReadingList,
            .assignToContact,
            .postToFacebook,
            .postToTwitter,
            .postToWeibo,
            .postToVimeo,
            .postToFlickr,
            .postToTencentWeibo,
        ]

        let source = presenter ?? DiagnosticLogger.activeRootViewController()
        guard let source else { return false }
        // iPad popover anchoring — required to avoid a crash on iPad. Anchor
        // to the source view's centre.
        if let popover = activity.popoverPresentationController {
            popover.sourceView = source.view
            popover.sourceRect = CGRect(
                x: source.view.bounds.midX,
                y: source.view.bounds.midY,
                width: 0,
                height: 0
            )
            popover.permittedArrowDirections = []
        }
        source.present(activity, animated: true)
        return true
    }
    #endif

    /// Drain pending writes. Tests call this to avoid races. Production code
    /// rarely needs it because writes are fire-and-forget.
    public func flushSynchronously() {
        writeQueue.sync {}
    }

    // MARK: - Private

    /// Internal record + mirror. The event is:
    /// 1. Appended to the recent-events ring
    /// 2. Mirrored to OSLog (synchronously — this is cheap)
    /// 3. Scheduled for disk write on the writeQueue
    private func record(_ event: DiagnosticEvent) {
        stateLock.lock()
        recentEventsStorage.append(event)
        if recentEventsStorage.count > recentEventsMaxCount {
            let overflow = recentEventsStorage.count - recentEventsMaxCount
            recentEventsStorage.removeFirst(overflow)
        }
        let enabled = isEnabledStorage
        stateLock.unlock()

        // Mirror to OSLog. `os_log` is async-safe and cheap; we avoid the
        // string format-spec route by building the string ourselves and
        // passing it as `%{public}@`. For `.fault` severity we allow public
        // because the caller opted in.
        os_log("%{public}@", log: osLog, type: event.severity.osLogType, event.formattedLine)

        guard enabled else { return }

        // Off-thread disk write. Captures by value so the queue does not
        // retain the caller.
        let line = event.formattedLine + "\n"
        writeQueue.async { [weak self] in
            guard let self else { return }
            self.appendLine(line)
        }
    }

    private func appendLine(_ line: String) {
        do {
            try ensureLogDirectoryExists()
            rotateLogFileIfNeeded()

            let url = logFileURLInternal
            let data = Data(line.utf8)

            if fileManager.fileExists(atPath: url.path) {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: url, options: .atomic)
            }
        } catch {
            // Fall back to OSLog-only. We deliberately do NOT throw — the
            // logger must never crash the app.
            os_log(
                "DiagnosticLogger append failed: %{public}@",
                log: osLog,
                type: .error,
                error.localizedDescription
            )
        }
    }

    private func rotateLogFileIfNeeded() {
        let url = logFileURLInternal
        guard fileManager.fileExists(atPath: url.path) else { return }
        let attrs = try? fileManager.attributesOfItem(atPath: url.path)
        guard let size = attrs?[.size] as? NSNumber else { return }
        if size.intValue < DiagnosticLogger.maxFileSizeBytes { return }

        let rotatedURL = rotatedLogFileURLInternal
        try? fileManager.removeItem(at: rotatedURL)
        try? fileManager.moveItem(at: url, to: rotatedURL)
    }

    @discardableResult
    private func ensureLogDirectoryExists() throws -> URL {
        let dir = logDirectoryURL
        if !fileManager.fileExists(atPath: dir.path) {
            try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // MARK: - URLs

    private var logDirectoryURL: URL {
        // Documents/Diagnostics — visible to the user via the Files app if
        // UIFileSharingEnabled is set (we do not enable that by default).
        let documents = (try? fileManager.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return documents.appendingPathComponent("Diagnostics", isDirectory: true)
    }

    private var logFileURLInternal: URL {
        logDirectoryURL.appendingPathComponent("wotann-diagnostic.log", isDirectory: false)
    }

    private var rotatedLogFileURLInternal: URL {
        logDirectoryURL.appendingPathComponent("wotann-diagnostic.log.old", isDirectory: false)
    }

    // MARK: - Presenter lookup

    #if canImport(UIKit)
    /// Best-effort root view controller lookup for the share sheet. The app
    /// uses SwiftUI scenes; there is no single AppDelegate window to grab,
    /// so we walk the connected scenes.
    @MainActor
    private static func activeRootViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }

        for scene in scenes {
            if let key = scene.windows.first(where: { $0.isKeyWindow }),
               let root = key.rootViewController {
                var top = root
                while let presented = top.presentedViewController {
                    top = presented
                }
                return top
            }
        }
        return nil
    }
    #endif
}

// MARK: - SwiftUI helper view

#if canImport(UIKit)
/// Debug-only debug menu row exposing the diagnostic actions. Drop this into
/// a Settings list under a `#if DEBUG` guard if desired.
///
/// The production code path that links to this lives in
/// `Views/Settings/DiagnosticDumpRow.swift` (added separately).
public struct DiagnosticDumpMenu: View {
    private let logger: DiagnosticLogger

    public init(logger: DiagnosticLogger = .shared) {
        self.logger = logger
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                _ = logger.share()
            } label: {
                Label("Share Diagnostic Log", systemImage: "square.and.arrow.up")
            }
            Button(role: .destructive) {
                logger.clear()
            } label: {
                Label("Clear Diagnostic Log", systemImage: "trash")
            }
        }
    }
}
#endif

// MARK: - Global convenience

/// Convenience free function so call sites do not need to know about the
/// shared instance. Kept narrow in name (`wtnDiagLog`) to avoid colliding
/// with `Logger` from OSLog or any project-level `log` helper.
@inlinable
public func wtnDiagLog(
    feature: String,
    severity: DiagnosticSeverity = .info,
    message: String,
    metadata: [String: String] = [:]
) {
    DiagnosticLogger.shared.log(
        feature: feature,
        severity: severity,
        message: message,
        metadata: metadata
    )
}
