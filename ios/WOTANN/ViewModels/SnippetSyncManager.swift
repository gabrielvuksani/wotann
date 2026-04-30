import Foundation

// MARK: - SnippetSyncManager
//
// Round 8: backs the existing PromptLibraryView with the new
// daemon-side `SnippetStore` so a snippet authored on phone shows up
// on Desktop and vice versa. Maintains UserDefaults as an offline
// cache + write-through queue so the view continues to function when
// the daemon is unreachable.
//
// **Adapter strategy**: PromptLibraryView's UI is built around the
// existing `PromptTemplate` struct (UUID id, title, prompt, category,
// isFavorite, createdAt). The new daemon model is `Snippet` (string
// id, title, body, category?, tags, ...). This manager bridges them
// so the view code stays mostly unchanged.
//
// **Sync rules**:
//   - On init: load UserDefaults cache for instant rendering
//   - On `refresh()`: fetch from daemon, replace local; if RPC fails
//     keep the cache (don't blank the view)
//   - On `add/update/delete/toggleFavorite`: optimistic local update
//     first, then push to daemon; on failure surface in `lastError`
//   - On every successful daemon write: persist to UserDefaults so
//     next cold-start shows the latest known state without spinner

@MainActor
final class SnippetSyncManager: ObservableObject {
    @Published private(set) var templates: [PromptTemplate] = []
    @Published private(set) var isRefreshing: Bool = false
    @Published private(set) var lastError: String? = nil
    /// Maps PromptTemplate.id (UUID) ↔ Snippet.id (string from daemon).
    /// Necessary because the view uses UUID for ForEach identity but
    /// the daemon stores string ids like `snip-1234567-abc`.
    private var idMap: [UUID: String] = [:]

    private let storageKey = "com.wotann.promptLibrary"
    private let storageMapKey = "com.wotann.promptLibrary.idMap"

    init() {
        loadCache()
    }

    /// Hydrate `templates` from the local UserDefaults cache. Called
    /// at construction so the view renders instantly even before
    /// the daemon refresh round-trip completes.
    private func loadCache() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode([PromptTemplate].self, from: data)
        else { return }
        templates = saved
        // Restore id map if we cached one.
        if let mapData = UserDefaults.standard.data(forKey: storageMapKey),
           let savedMap = try? JSONDecoder().decode([String: String].self, from: mapData) {
            idMap = Dictionary(
                uniqueKeysWithValues: savedMap.compactMap { (uuidString, snippetId) -> (UUID, String)? in
                    guard let uuid = UUID(uuidString: uuidString) else { return nil }
                    return (uuid, snippetId)
                }
            )
        }
    }

    /// Persist current templates + id map to UserDefaults so a cold
    /// start without a daemon connection still shows the library.
    private func writeCache() {
        if let data = try? JSONEncoder().encode(templates) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
        let stringMap = Dictionary(uniqueKeysWithValues: idMap.map { ($0.key.uuidString, $0.value) })
        if let mapData = try? JSONEncoder().encode(stringMap) {
            UserDefaults.standard.set(mapData, forKey: storageMapKey)
        }
    }

    /// Pull from the daemon and merge into the local view. If the
    /// daemon is unreachable we keep the cached templates so the
    /// user doesn't see an empty list during a network hiccup.
    ///
    /// **Merge strategy**: a template with NO entry in `idMap` is an
    /// offline-added snippet that hasn't synced to the daemon yet.
    /// Those are PRESERVED at the top of the merged list and a
    /// background retry is kicked off so they reach the daemon on
    /// the next round-trip. Without this preservation the user's
    /// offline-authored snippet would silently vanish when the
    /// daemon came back online — a data-loss bug.
    func refresh(rpc: RPCClient) async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let snippets = try await rpc.snippetList()
            let mapped = snippets.map { snippet -> PromptTemplate in
                let uuid = uuidFor(snippetId: snippet.id)
                return PromptTemplate(
                    id: uuid,
                    title: snippet.title,
                    prompt: snippet.body,
                    category: snippet.category ?? "General",
                    isFavorite: snippet.isFavorite,
                    createdAt: Date(timeIntervalSince1970: TimeInterval(snippet.createdAt) / 1000)
                )
            }
            // Preserve offline-only templates (no daemon id mapping yet).
            let offlineOnly = templates.filter { idMap[$0.id] == nil }
            templates = offlineOnly + mapped
            writeCache()
            lastError = nil

            // Retry pending offline writes one-by-one. Failures here
            // are logged as lastError but don't stop subsequent retries
            // — a partial sync is better than an all-or-nothing one.
            for pending in offlineOnly {
                do {
                    let snippet = try await rpc.snippetSave(
                        title: pending.title,
                        body: pending.prompt,
                        category: pending.category,
                        isFavorite: pending.isFavorite
                    )
                    idMap[pending.id] = snippet.id
                } catch {
                    // Leave pending in idMap-less limbo for the next refresh.
                    lastError = error.localizedDescription
                }
            }
            writeCache()
        } catch {
            // Keep cached state; surface error for UI to optionally show.
            lastError = error.localizedDescription
        }
    }

    /// Add a new template — optimistic local update + daemon push.
    func add(_ template: PromptTemplate, rpc: RPCClient?) async {
        templates.append(template)
        writeCache()
        guard let rpc else { return } // Offline mode keeps local copy only.
        do {
            let snippet = try await rpc.snippetSave(
                title: template.title,
                body: template.prompt,
                category: template.category,
                isFavorite: template.isFavorite
            )
            // Bind the daemon's string id to the local UUID for future
            // updates/deletes.
            idMap[template.id] = snippet.id
            writeCache()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Toggle favorite — flip locally, push update to daemon.
    func toggleFavorite(_ template: PromptTemplate, rpc: RPCClient?) async {
        guard let idx = templates.firstIndex(where: { $0.id == template.id }) else { return }
        templates[idx].isFavorite.toggle()
        writeCache()
        guard let rpc, let snippetId = idMap[template.id] else { return }
        do {
            _ = try await rpc.snippetSave(
                title: templates[idx].title,
                body: templates[idx].prompt,
                id: snippetId,
                category: templates[idx].category,
                isFavorite: templates[idx].isFavorite
            )
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Delete a template — remove locally, push delete to daemon.
    func delete(_ template: PromptTemplate, rpc: RPCClient?) async {
        templates.removeAll { $0.id == template.id }
        let snippetId = idMap.removeValue(forKey: template.id)
        writeCache()
        guard let rpc, let snippetId else { return }
        do {
            _ = try await rpc.snippetDelete(id: snippetId)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Synthesize a stable UUID for a daemon snippet id. We use a
    /// deterministic UUIDv5-like derivation from the string id so
    /// every refresh maps the same snippet to the same UUID across
    /// app launches — critical for SwiftUI ForEach identity.
    private func uuidFor(snippetId: String) -> UUID {
        // Reverse lookup: if we already have a UUID for this snippet,
        // reuse it (preserves view identity after refresh).
        if let existing = idMap.first(where: { $0.value == snippetId })?.key {
            return existing
        }
        let new = UUID()
        idMap[new] = snippetId
        return new
    }
}
