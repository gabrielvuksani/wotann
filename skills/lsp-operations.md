# LSP-Aware Semantic Operations

Use when: refactoring code, renaming symbols, finding references, understanding type hierarchies,
or performing any operation that benefits from language server protocol awareness.

## Capabilities
- Go-to-definition across import boundaries
- Find all references (callers, implementers)
- Rename symbol with automatic import updates
- Extract function/variable/type refactoring
- Inline function/variable refactoring
- Organize imports
- Auto-fix diagnostics
- Signature help and parameter hints

## Protocol
1. Start the LSP server for the target language (TypeScript: tsserver, Python: pylance, Rust: rust-analyzer)
2. Open the target file to trigger indexing
3. Use textDocument/references to find ALL callers before modifying any signature
4. Use textDocument/rename for multi-file renames
5. Use textDocument/codeAction for automated refactorings
6. After changes, run textDocument/diagnostic to verify no new errors

## Supported Languages
- TypeScript/JavaScript (tsserver)
- Python (pylance/pyright)
- Rust (rust-analyzer)
- Go (gopls)
- Java (jdtls)
- C# (OmniSharp)

## Anti-Patterns
- Never rename via find-and-replace — use LSP rename
- Never assume all references were found without running a search
- Never modify a public API without checking all callers first
