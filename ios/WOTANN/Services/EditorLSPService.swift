import Foundation
import Combine
import os.log

// MARK: - EditorLSPService
//
// V9 GA-12 (T13.3) — iOS Service that bridges the SwiftUI Editor to the
// desktop daemon's `lsp.*` JSON-RPC handlers. Sits one layer above
// `EditorLSPBridge` (which lives in Views/Editor/) so:
//
//   1. View-models that need LSP intelligence outside the Editor (e.g.,
//      InlineAIMenu's "explain this symbol") have a stable Service-layer
//      entrypoint and don't reach into Views internals.
//   2. Response-shape adaptation lives in ONE place — the daemon currently
//      returns `{ info }` for hover and `{ items, notes }` for completion;
//      future protocol bumps land here, not scattered across views.
//   3. The Service can be substituted in tests via dependency injection.
//
// Wire surface (matches daemon kairos-rpc.ts:4117-4243):
//   lsp.symbols     params: { name }                  -> { symbols, count }
//   lsp.outline     params: { uri | file }            -> { symbols, count }
//   lsp.refs        params: { uri, line, character }  -> { references, count }
//   lsp.hover       params: { uri, line, character }  -> { info: string }
//   lsp.completion  params: { uri | path, line,
//                             character | column }    -> { items, notes? }
//   lsp.definition  params: { uri | path, line,
//                             character | column }    -> { uri, line, column } | null
//   lsp.rename      params: { uri, line, character,
//                             newName }               -> { filesAffected, editsApplied }
//
// QUALITY BARS
// - #6 (honest stubs): every method returns nil/[] on failure rather than
//   silently absorbing the error. The caller surface (view-model) decides
//   what to render.
// - #7 (per-session state): NO singleton. Every Editor session constructs
//   its own EditorLSPService via `EditorLSPService(rpcClient:)`. A
//   misplaced shared instance would let two concurrent edits' debounced
//   requests cancel each other.
// - #11 (sibling-site scan): this Service and `EditorLSPBridge` are the
//   ONLY iOS sites that call `rpcClient.send("lsp.*")`. If a third site
//   appears, it MUST route through this Service.
// - #12 (NODE_ENV-independent test): tests instantiate via mock RPCClient;
//   no environment branching required.

@MainActor
final class EditorLSPService {

    // MARK: - Static config

    /// Per-call timeout in nanoseconds. Tighter than the daemon's symbol-
    /// op deadlines so a slow LSP layer doesn't block iOS's main thread.
    /// 800ms gives full LSP responses room while still being responsive.
    private static let timeoutNanos: UInt64 = 800_000_000

    // MARK: - Instance state

    private let rpcClient: RPCClient
    private let logger = Logger(subsystem: "com.wotann.ios", category: "EditorLSPService")

    /// In-flight tasks per call kind so a fresh fire supersedes the prior
    /// one. Per-instance (QB #7) — never module-global.
    private var hoverTask: Task<EditorLSPHoverResponse?, Never>?
    private var completionTask: Task<[LSPCompletionItem], Never>?
    private var definitionTask: Task<LSPLocation?, Never>?
    private var symbolsTask: Task<[EditorLSPSymbol], Never>?
    private var refsTask: Task<[LSPLocation], Never>?

    // MARK: - Init

    init(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    // MARK: - Cancellation

    /// Cancel every in-flight LSP request. Editor view-models call this
    /// on text mutation so stale results don't replace fresh user input.
    func cancelAll() {
        hoverTask?.cancel()
        completionTask?.cancel()
        definitionTask?.cancel()
        symbolsTask?.cancel()
        refsTask?.cancel()
        hoverTask = nil
        completionTask = nil
        definitionTask = nil
        symbolsTask = nil
        refsTask = nil
    }

    // MARK: - Hover

    /// Fetch hover content. Daemon returns `{ info: string }` (a flat
    /// markdown body); legacy callers expect `{ contents: string }`.
    /// We accept BOTH shapes so the same Service works against current
    /// and any future daemon version.
    ///
    /// Returns `nil` on timeout/error/empty (QB #6 — honest stub).
    func hover(uri: String, line: Int, character: Int) async -> EditorLSPHoverResponse? {
        hoverTask?.cancel()
        let task = Task<EditorLSPHoverResponse?, Never> { [weak self] in
            guard let self else { return nil }
            if Task.isCancelled { return nil }
            do {
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.hover", params: [
                        "uri":       .string(uri),
                        "line":      .int(line),
                        "character": .int(character),
                    ])
                }
                guard let result = response.result else { return nil }
                let object = result.objectValue ?? [:]
                // Daemon returns `{ info }`; older / future shape may use
                // `{ contents }`. Accept either; fall through to plain
                // string when the response is itself a bare string.
                let body = object["info"]?.stringValue
                    ?? object["contents"]?.stringValue
                    ?? result.stringValue
                guard let body, !body.isEmpty else { return nil }
                return EditorLSPHoverResponse(markdown: body)
            } catch {
                self.logger.debug("lsp.hover failed: \(error.localizedDescription, privacy: .public)")
                return nil
            }
        }
        hoverTask = task
        return await task.value
    }

    // MARK: - Completion

    /// Fetch completion items. Daemon currently returns `{ items: [], notes }`
    /// (honest stub — completion isn't wired in the LSP layer yet, see
    /// kairos-rpc.ts:4177-4191). When `items` is empty AND `notes` is
    /// present, the iOS Editor branches on `items.isEmpty` and shows no
    /// popover (per QB #6).
    ///
    /// Returns `[]` on timeout/error.
    func completion(
        uri: String,
        line: Int,
        character: Int,
        prefix: String? = nil,
    ) async -> [LSPCompletionItem] {
        completionTask?.cancel()
        let task = Task<[LSPCompletionItem], Never> { [weak self] in
            guard let self else { return [] }
            if Task.isCancelled { return [] }
            do {
                var params: [String: RPCValue] = [
                    "uri":       .string(uri),
                    "line":      .int(line),
                    "character": .int(character),
                ]
                if let prefix, !prefix.isEmpty {
                    params["prefix"] = .string(prefix)
                }
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.completion", params: params)
                }
                let object = response.result?.objectValue ?? [:]
                let raw = object["items"]?.arrayValue
                    ?? response.result?.arrayValue
                    ?? []
                return raw.compactMap { value -> LSPCompletionItem? in
                    guard let obj = value.objectValue else { return nil }
                    return LSPCompletionItem(
                        label: obj["label"]?.stringValue ?? "",
                        kind:  obj["kind"]?.stringValue ?? "text",
                        detail: obj["detail"]?.stringValue,
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

    /// "Go to definition" — returns the location of the symbol at the
    /// cursor. Daemon returns `{ uri, line, column }` or `null` when no
    /// definition is found (honest stub). Returns `nil` on either case.
    func definition(uri: String, line: Int, character: Int) async -> LSPLocation? {
        definitionTask?.cancel()
        let task = Task<LSPLocation?, Never> { [weak self] in
            guard let self else { return nil }
            if Task.isCancelled { return nil }
            do {
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.definition", params: [
                        "uri":       .string(uri),
                        "line":      .int(line),
                        "character": .int(character),
                    ])
                }
                guard let object = response.result?.objectValue,
                      let uri = object["uri"]?.stringValue,
                      let line = object["line"]?.intValue
                else {
                    return nil
                }
                let column = object["column"]?.intValue ?? 0
                return LSPLocation(uri: uri, line: line, column: column)
            } catch {
                self.logger.debug("lsp.definition failed: \(error.localizedDescription, privacy: .public)")
                return nil
            }
        }
        definitionTask = task
        return await task.value
    }

    // MARK: - Symbols

    /// Workspace symbol search by name. Returns `[]` on timeout/error.
    /// Daemon returns `{ symbols, count }`; we project just the symbols.
    func symbols(name: String) async -> [EditorLSPSymbol] {
        symbolsTask?.cancel()
        let task = Task<[EditorLSPSymbol], Never> { [weak self] in
            guard let self else { return [] }
            if Task.isCancelled { return [] }
            do {
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.symbols", params: [
                        "name": .string(name),
                    ])
                }
                let raw = response.result?.objectValue?["symbols"]?.arrayValue ?? []
                return raw.compactMap { Self.parseSymbol($0) }
            } catch {
                self.logger.debug("lsp.symbols failed: \(error.localizedDescription, privacy: .public)")
                return []
            }
        }
        symbolsTask = task
        return await task.value
    }

    // MARK: - References

    /// Find references to a symbol at position. Returns `[]` on
    /// timeout/error.
    func references(uri: String, line: Int, character: Int) async -> [LSPLocation] {
        refsTask?.cancel()
        let task = Task<[LSPLocation], Never> { [weak self] in
            guard let self else { return [] }
            if Task.isCancelled { return [] }
            do {
                let response = try await self.withTimeout(Self.timeoutNanos) {
                    try await self.rpcClient.send("lsp.refs", params: [
                        "uri":       .string(uri),
                        "line":      .int(line),
                        "character": .int(character),
                    ])
                }
                let raw = response.result?.objectValue?["references"]?.arrayValue ?? []
                return raw.compactMap { value -> LSPLocation? in
                    guard let obj = value.objectValue,
                          let uri = obj["uri"]?.stringValue
                    else { return nil }
                    // Daemon `references` carry an LSP `range` { start: { line, character } }
                    let range = obj["range"]?.objectValue
                    let start = range?["start"]?.objectValue
                    let line = start?["line"]?.intValue ?? 0
                    let char = start?["character"]?.intValue ?? 0
                    return LSPLocation(uri: uri, line: line, column: char)
                }
            } catch {
                self.logger.debug("lsp.refs failed: \(error.localizedDescription, privacy: .public)")
                return []
            }
        }
        refsTask = task
        return await task.value
    }

    // MARK: - Helpers

    private static func parseSymbol(_ value: RPCValue) -> EditorLSPSymbol? {
        guard let obj = value.objectValue else { return nil }
        return EditorLSPSymbol(
            name: obj["name"]?.stringValue ?? "",
            kind: obj["kind"]?.stringValue ?? "",
            uri:  obj["uri"]?.stringValue ?? obj["file"]?.stringValue ?? "",
            line: obj["line"]?.intValue ?? 0,
        )
    }

    /// Race a body against a timeout. Identical pattern to
    /// `EditorLSPBridge.withTimeout` so the two implementations stay
    /// behavioral siblings.
    @MainActor
    private func withTimeout<T>(
        _ nanos: UInt64,
        body: @escaping @MainActor () async throws -> T,
    ) async throws -> T {
        let bodyTask = Task<T, Error> { @MainActor in
            try await body()
        }
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
            throw LSPError.timeout
        } catch {
            timeoutTask.cancel()
            throw error
        }
    }
}

// MARK: - Service value types

/// Hover response — markdown body the iOS HoverCard renders. Boxed in a
/// struct (rather than a bare String) so we can grow the response shape
/// later without breaking call sites (e.g., adding kind, range).
struct EditorLSPHoverResponse: Equatable, Hashable {
    let markdown: String
}

/// Workspace symbol — name + kind + location. Mirrors the daemon
/// `lsp.symbols` response shape.
struct EditorLSPSymbol: Equatable, Hashable, Identifiable {
    let name: String
    let kind: String
    let uri:  String
    let line: Int

    var id: String { "\(uri)#\(line)#\(name)" }
}
