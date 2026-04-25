import Foundation
import os.log

// MARK: - EditorLSPBridge
//
// Debounced RPC adapter that translates editor cursor events into LSP calls
// on the desktop daemon. Manages cancellation so each new keystroke
// supersedes the previous in-flight request — crucial for ghost-text
// completion to feel snappy.
//
// Wire surface (assumed RPC methods on the desktop):
//   lsp.hover       params: { path, line, column }
//   lsp.completion  params: { path, line, column, prefix? }
//   lsp.definition  params: { path, line, column }
//
// Returns honest stubs on failure: nil / empty array, never silently
// swallowed. The view-model's `errorMessage` is the user-facing surface;
// the bridge itself only logs (LSP isn't critical-path UX).
//
// Quality bar:
// - Per-instance state — never module-global. Each editor session owns
//   its own bridge so cancellation can't bleed across sessions.
// - 500ms timeout — LSP shouldn't block typing; if the desktop is slow we
//   fall through to no completion rather than stall.

@MainActor
final class EditorLSPBridge {

    // MARK: - Static config

    /// Per-call timeout in nanoseconds. LSP responses that take longer are
    /// dropped (we'll fire a fresh request on the next cursor event anyway).
    private static let timeoutNanos: UInt64 = 500_000_000   // 500ms

    /// Debounce window between cursor events and the actual LSP fire. Keeps
    /// the daemon from being hammered while typing fast.
    private static let debounceNanos: UInt64 = 120_000_000  // 120ms

    // MARK: - Instance state

    private let rpcClient: RPCClient
    private let logger = Logger(subsystem: "com.wotann.ios", category: "EditorLSPBridge")

    /// In-flight task per request kind so a fresh fire cancels the prior one.
    private var hoverTask: Task<String?, Never>?
    private var completionTask: Task<[LSPCompletionItem], Never>?
    private var definitionTask: Task<LSPLocation?, Never>?

    // MARK: - Init

    init(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    // MARK: - Cancellation

    /// Cancel every in-flight LSP request. Called from the editor on text
    /// change so stale results don't replace fresh user input.
    func cancelAll() {
        hoverTask?.cancel()
        completionTask?.cancel()
        definitionTask?.cancel()
        hoverTask = nil
        completionTask = nil
        definitionTask = nil
    }

    // MARK: - Hover

    /// Fetch hover content (markdown). Returns nil on timeout or RPC error.
    func hover(path: String, line: Int, column: Int) async -> String? {
        hoverTask?.cancel()
        let task = Task<String?, Never> { [weak self] in
            guard let self else { return nil }
            try? await Task.sleep(nanoseconds: Self.debounceNanos)
            if Task.isCancelled { return nil }
            do {
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.hover", params: [
                        "path":   .string(path),
                        "line":   .int(line),
                        "column": .int(column),
                    ])
                }
                let object = response.result?.objectValue ?? [:]
                let contents = object["contents"]?.stringValue
                    ?? response.result?.stringValue
                return contents
            } catch {
                self.logger.debug("lsp.hover failed: \(error.localizedDescription, privacy: .public)")
                return nil
            }
        }
        hoverTask = task
        return await task.value
    }

    // MARK: - Completion

    /// Fetch completion items. Returns an empty array on timeout/error.
    func completion(path: String, line: Int, column: Int, prefix: String?) async -> [LSPCompletionItem] {
        completionTask?.cancel()
        let task = Task<[LSPCompletionItem], Never> { [weak self] in
            guard let self else { return [] }
            try? await Task.sleep(nanoseconds: Self.debounceNanos)
            if Task.isCancelled { return [] }
            do {
                var params: [String: RPCValue] = [
                    "path":   .string(path),
                    "line":   .int(line),
                    "column": .int(column),
                ]
                if let prefix = prefix {
                    params["prefix"] = .string(prefix)
                }
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.completion", params: params)
                }
                let itemsRaw = response.result?.objectValue?["items"]?.arrayValue
                    ?? response.result?.arrayValue
                    ?? []
                return itemsRaw.compactMap { value -> LSPCompletionItem? in
                    guard let obj = value.objectValue else { return nil }
                    return LSPCompletionItem(
                        label:  obj["label"]?.stringValue ?? "",
                        kind:   obj["kind"]?.stringValue ?? "text",
                        detail: obj["detail"]?.stringValue
                    )
                }
            } catch {
                self.logger.debug("lsp.completion failed: \(error.localizedDescription, privacy: .public)")
                return []
            }
        }
        completionTask = task
        return await task.value
    }

    // MARK: - Definition

    /// Fetch the location of the symbol at the cursor. Returns nil on
    /// timeout/error or when no definition is found.
    func definition(path: String, line: Int, column: Int) async -> LSPLocation? {
        definitionTask?.cancel()
        let task = Task<LSPLocation?, Never> { [weak self] in
            guard let self else { return nil }
            // Definition is user-initiated (cmd+click) so we skip the typing
            // debounce — fire immediately.
            if Task.isCancelled { return nil }
            do {
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.definition", params: [
                        "path":   .string(path),
                        "line":   .int(line),
                        "column": .int(column),
                    ])
                }
                guard let obj = response.result?.objectValue,
                      let uri = obj["uri"]?.stringValue,
                      let line = obj["line"]?.intValue else {
                    return nil
                }
                let column = obj["column"]?.intValue ?? 0
                return LSPLocation(uri: uri, line: line, column: column)
            } catch {
                self.logger.debug("lsp.definition failed: \(error.localizedDescription, privacy: .public)")
                return nil
            }
        }
        definitionTask = task
        return await task.value
    }

    // MARK: - Helpers

    /// Race a body against a timeout. Returns the body's value if it
    /// finishes first, otherwise throws `LSPError.timeout` and the
    /// body's task is cancelled (which propagates into RPCClient.send).
    ///
    /// Implementation note: We spawn the body in a `Task` (inheriting
    /// MainActor isolation, since `EditorLSPBridge` is MainActor-bound)
    /// and watch a timeout side-channel. First to finish wins; the
    /// other is cancelled cooperatively. We avoid `withThrowingTaskGroup`
    /// here because Swift 6's Sendable inference flags the MainActor
    /// state crossing as a hazard.
    @MainActor
    private func withTimeout<T>(
        _ nanos: UInt64,
        body: @escaping @MainActor () async throws -> T
    ) async throws -> T {
        // Body Task — inherits MainActor; rpcClient.send is callable here.
        let bodyTask = Task<T, Error> { @MainActor in
            try await body()
        }

        // Timeout watcher — detached so it can fire while body is mid-flight.
        let timeoutTask = Task<Void, Error> {
            try await Task.sleep(nanoseconds: nanos)
            bodyTask.cancel()
            throw LSPError.timeout
        }

        do {
            let value = try await bodyTask.value
            timeoutTask.cancel()
            return value
        } catch is CancellationError {
            // Body cancellation = timeout fired first.
            throw LSPError.timeout
        } catch {
            timeoutTask.cancel()
            throw error
        }
    }
}

// MARK: - LSP value types

/// One completion entry rendered in the ghost-text list.
struct LSPCompletionItem: Equatable, Hashable, Identifiable {
    /// What the user types/sees.
    let label: String
    /// Coarse symbol kind (variable, function, class, etc.) — string for
    /// transport simplicity; renderer maps to SF Symbols.
    let kind: String
    /// Optional one-line description (signature, type, etc.).
    let detail: String?

    var id: String { "\(label)|\(kind)" }
}

/// A canonical (path, line, column) triple — used for "go to definition".
struct LSPLocation: Equatable, Hashable {
    let uri: String
    let line: Int
    let column: Int
}

// MARK: - Errors

enum LSPError: Error, LocalizedError {
    case timeout
    case noResult

    var errorDescription: String? {
        switch self {
        case .timeout:  return "LSP request timed out"
        case .noResult: return "LSP returned no result"
        }
    }
}
