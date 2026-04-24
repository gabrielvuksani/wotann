import Foundation

// MARK: - EditorLanguages
//
// Canonical language registry for the Runestone editor.
//
// Runestone ships a set of TreeSitter language "packs" that are registered
// by an identifier string. We keep the mapping from WOTANN-side language
// IDs to those identifiers in one place so:
//
// 1. `RunestoneEditorView` never has to know about file extensions.
// 2. `EditorService` can resolve a language purely from a file path or
//    mime-type, with a predictable plain-text fallback.
// 3. Unit tests can exhaustively assert that every supported extension
//    round-trips to the expected TreeSitter pack.
//
// NOTE: The `LanguagePack` type is intentionally a lightweight DTO. We do
// NOT import the actual `TreeSitterLanguage` bundles here — those are
// resolved lazily at runtime from Runestone's registry via
// `EditorService.loadLanguagePack(for:)`. This keeps the registry file
// zero-cost to import from the test target.

// MARK: - EditorLanguage

/// A single supported language entry in the registry.
struct EditorLanguage: Equatable, Hashable, Identifiable {
    /// Stable WOTANN-facing identifier (e.g. "typescript", "swift").
    let id: String
    /// Human-readable display name ("TypeScript", "Swift").
    let displayName: String
    /// Runestone TreeSitter pack identifier. Nil = plain-text fallback.
    let runestonePackId: String?
    /// File extensions that map to this language, lowercased, WITHOUT dots.
    let extensions: [String]
    /// Common filename stems (e.g. "Dockerfile", "Makefile") — matched when
    /// a file has no extension or we want a stronger signal than the ext.
    let filenames: [String]

    static let plainText = EditorLanguage(
        id: "plaintext",
        displayName: "Plain Text",
        runestonePackId: nil,
        extensions: [],
        filenames: []
    )
}

// MARK: - EditorLanguages registry

enum EditorLanguages {

    // MARK: All supported languages (36 entries)
    //
    // Ordered alphabetically for deterministic picker display. The Runestone
    // pack identifiers follow Runestone's own plugin naming convention; if
    // upstream ever changes them we update this one table.

    static let all: [EditorLanguage] = [
        EditorLanguage(id: "bash",       displayName: "Bash",         runestonePackId: "tree-sitter-bash",       extensions: ["sh", "bash", "zsh"],        filenames: [".bashrc", ".zshrc"]),
        EditorLanguage(id: "c",          displayName: "C",            runestonePackId: "tree-sitter-c",          extensions: ["c", "h"],                   filenames: []),
        EditorLanguage(id: "cpp",        displayName: "C++",          runestonePackId: "tree-sitter-cpp",        extensions: ["cpp", "cc", "cxx", "hpp", "hh"], filenames: []),
        EditorLanguage(id: "csharp",     displayName: "C#",           runestonePackId: "tree-sitter-c-sharp",    extensions: ["cs"],                       filenames: []),
        EditorLanguage(id: "css",        displayName: "CSS",          runestonePackId: "tree-sitter-css",        extensions: ["css"],                      filenames: []),
        EditorLanguage(id: "dart",       displayName: "Dart",         runestonePackId: "tree-sitter-dart",       extensions: ["dart"],                     filenames: []),
        EditorLanguage(id: "dockerfile", displayName: "Dockerfile",   runestonePackId: "tree-sitter-dockerfile", extensions: [],                           filenames: ["Dockerfile", "Containerfile"]),
        EditorLanguage(id: "elixir",     displayName: "Elixir",       runestonePackId: "tree-sitter-elixir",     extensions: ["ex", "exs"],                filenames: []),
        EditorLanguage(id: "go",         displayName: "Go",           runestonePackId: "tree-sitter-go",         extensions: ["go"],                       filenames: []),
        EditorLanguage(id: "graphql",    displayName: "GraphQL",      runestonePackId: "tree-sitter-graphql",    extensions: ["graphql", "gql"],           filenames: []),
        EditorLanguage(id: "haskell",    displayName: "Haskell",      runestonePackId: "tree-sitter-haskell",    extensions: ["hs"],                       filenames: []),
        EditorLanguage(id: "html",       displayName: "HTML",         runestonePackId: "tree-sitter-html",       extensions: ["html", "htm", "xhtml"],     filenames: []),
        EditorLanguage(id: "java",       displayName: "Java",         runestonePackId: "tree-sitter-java",       extensions: ["java"],                     filenames: []),
        EditorLanguage(id: "javascript", displayName: "JavaScript",   runestonePackId: "tree-sitter-javascript", extensions: ["js", "mjs", "cjs", "jsx"],  filenames: []),
        EditorLanguage(id: "json",       displayName: "JSON",         runestonePackId: "tree-sitter-json",       extensions: ["json", "jsonc"],            filenames: [".eslintrc", ".prettierrc"]),
        EditorLanguage(id: "julia",      displayName: "Julia",        runestonePackId: "tree-sitter-julia",      extensions: ["jl"],                       filenames: []),
        EditorLanguage(id: "kotlin",     displayName: "Kotlin",       runestonePackId: "tree-sitter-kotlin",     extensions: ["kt", "kts"],                filenames: []),
        EditorLanguage(id: "lua",        displayName: "Lua",          runestonePackId: "tree-sitter-lua",        extensions: ["lua"],                      filenames: []),
        EditorLanguage(id: "makefile",   displayName: "Makefile",     runestonePackId: "tree-sitter-make",       extensions: ["mk"],                       filenames: ["Makefile", "makefile", "GNUmakefile"]),
        EditorLanguage(id: "markdown",   displayName: "Markdown",     runestonePackId: "tree-sitter-markdown",   extensions: ["md", "markdown", "mdx"],    filenames: []),
        EditorLanguage(id: "objc",       displayName: "Objective-C",  runestonePackId: "tree-sitter-objc",       extensions: ["m", "mm"],                  filenames: []),
        EditorLanguage(id: "ocaml",      displayName: "OCaml",        runestonePackId: "tree-sitter-ocaml",      extensions: ["ml", "mli"],                filenames: []),
        EditorLanguage(id: "perl",       displayName: "Perl",         runestonePackId: "tree-sitter-perl",       extensions: ["pl", "pm"],                 filenames: []),
        EditorLanguage(id: "php",        displayName: "PHP",          runestonePackId: "tree-sitter-php",        extensions: ["php"],                      filenames: []),
        EditorLanguage(id: "python",     displayName: "Python",       runestonePackId: "tree-sitter-python",     extensions: ["py", "pyi", "pyw"],         filenames: []),
        EditorLanguage(id: "r",          displayName: "R",            runestonePackId: "tree-sitter-r",          extensions: ["r", "R"],                   filenames: []),
        EditorLanguage(id: "ruby",       displayName: "Ruby",         runestonePackId: "tree-sitter-ruby",       extensions: ["rb"],                       filenames: ["Gemfile", "Rakefile"]),
        EditorLanguage(id: "rust",       displayName: "Rust",         runestonePackId: "tree-sitter-rust",       extensions: ["rs"],                       filenames: []),
        EditorLanguage(id: "scala",      displayName: "Scala",        runestonePackId: "tree-sitter-scala",      extensions: ["scala", "sc"],              filenames: []),
        EditorLanguage(id: "sql",        displayName: "SQL",          runestonePackId: "tree-sitter-sql",        extensions: ["sql"],                      filenames: []),
        EditorLanguage(id: "swift",      displayName: "Swift",        runestonePackId: "tree-sitter-swift",      extensions: ["swift"],                    filenames: []),
        EditorLanguage(id: "toml",       displayName: "TOML",         runestonePackId: "tree-sitter-toml",       extensions: ["toml"],                     filenames: ["Cargo.toml", "pyproject.toml"]),
        EditorLanguage(id: "typescript", displayName: "TypeScript",   runestonePackId: "tree-sitter-typescript", extensions: ["ts", "tsx"],                filenames: []),
        EditorLanguage(id: "vue",        displayName: "Vue",          runestonePackId: "tree-sitter-vue",        extensions: ["vue"],                      filenames: []),
        EditorLanguage(id: "xml",        displayName: "XML",          runestonePackId: "tree-sitter-xml",        extensions: ["xml", "plist"],             filenames: []),
        EditorLanguage(id: "yaml",       displayName: "YAML",         runestonePackId: "tree-sitter-yaml",       extensions: ["yaml", "yml"],              filenames: []),
    ]

    // MARK: Lookup indexes (built lazily, cached per process)
    //
    // These are idiomatic `static let` closures so the Swift runtime
    // guarantees one-time thread-safe initialisation.

    private static let byExtension: [String: EditorLanguage] = {
        var map: [String: EditorLanguage] = [:]
        for lang in all {
            for ext in lang.extensions {
                map[ext.lowercased()] = lang
            }
        }
        return map
    }()

    private static let byFilename: [String: EditorLanguage] = {
        var map: [String: EditorLanguage] = [:]
        for lang in all {
            for name in lang.filenames {
                map[name] = lang
            }
        }
        return map
    }()

    private static let byId: [String: EditorLanguage] = {
        Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })
    }()

    // MARK: Public resolvers

    /// Resolve a language from a file path. Falls back to `plainText` when
    /// neither the extension nor the filename matches a known language.
    ///
    /// Matching order:
    /// 1. Exact filename (e.g. "Dockerfile")
    /// 2. Extension (lowercased, after the last dot)
    /// 3. `plainText`
    static func resolve(path: String) -> EditorLanguage {
        let lastComponent = (path as NSString).lastPathComponent
        if let hit = byFilename[lastComponent] {
            return hit
        }
        let ext = (lastComponent as NSString).pathExtension
        if !ext.isEmpty, let hit = byExtension[ext.lowercased()] {
            return hit
        }
        return .plainText
    }

    /// Resolve by WOTANN language id (e.g. "typescript"). Returns nil when
    /// the id is unknown — callers typically fall back to `.plainText`.
    static func resolve(id: String) -> EditorLanguage? {
        byId[id]
    }

    /// Returns every supported language id. Used by the language picker.
    static var supportedIds: [String] { all.map(\.id) }
}
