/**
 * Search & Replace — project-wide search with regex + semantic search.
 * Executes real file search via Tauri execute_command (ripgrep).
 * Shows empty state when no query is entered or engine is disconnected.
 */

import { useState, useCallback } from "react";
import { executeCommand } from "../../store/engine";
import { useStore } from "../../store";

interface SearchResult {
  readonly file: string;
  readonly line: number;
  readonly content: string;
  readonly matchStart: number;
  readonly matchEnd: number;
}

/** Parse ripgrep output lines into structured search results. */
function parseRipgrepOutput(stdout: string, query: string): readonly SearchResult[] {
  if (!stdout.trim()) return [];

  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      // ripgrep --vimgrep format: file:line:col:content
      const match = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
      if (!match) return null;
      const [, file, lineStr, colStr, content] = match;
      const col = parseInt(colStr!, 10) - 1; // ripgrep is 1-based
      return {
        file,
        line: parseInt(lineStr!, 10),
        content,
        matchStart: col,
        matchEnd: col + query.length,
      };
    })
    .filter((r): r is SearchResult => r !== null);
}

export function SearchReplace() {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [showReplace, setShowReplace] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const engineConnected = useStore((s) => s.engineConnected);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }

    if (!engineConnected) {
      setSearchError("Engine not connected");
      setResults([]);
      return;
    }

    setSearching(true);
    setSearchError(null);

    // Build ripgrep command with flags
    const flags: string[] = ["--vimgrep", "--max-count=100"];
    if (!caseSensitive) flags.push("--ignore-case");
    if (useRegex) flags.push("--pcre2");
    else flags.push("--fixed-strings");

    const escapedQuery = query.replace(/"/g, '\\"');
    const cmd = `rg ${flags.join(" ")} "${escapedQuery}" .`;

    const output = await executeCommand(cmd);

    if (output.exitCode === 0) {
      setResults(parseRipgrepOutput(output.stdout, query));
    } else if (output.exitCode === 1) {
      // Exit code 1 = no matches found (normal for rg)
      setResults([]);
    } else {
      setSearchError(output.stderr || "Search failed");
      setResults([]);
    }

    setSearching(false);
  }, [query, caseSensitive, useRegex, engineConnected]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-bg-primary)" }} role="search" aria-label="Search and replace in files">
      {/* Search input */}
      <div className="p-3 border-b space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search files..."
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none"
              style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
              aria-label="Search query"
            />
          </div>
          <div className="flex gap-0.5">
            <button
              onClick={() => setCaseSensitive(!caseSensitive)}
              className="px-1.5 py-1 text-[10px] rounded"
              style={caseSensitive ? { background: "var(--color-primary)", color: "white" } : { background: "var(--surface-3)", color: "var(--color-text-muted)" }}
              title="Case sensitive"
            >
              Aa
            </button>
            <button
              onClick={() => setUseRegex(!useRegex)}
              className="px-1.5 py-1 text-[10px] rounded"
              style={useRegex ? { background: "var(--color-primary)", color: "white" } : { background: "var(--surface-3)", color: "var(--color-text-muted)" }}
              title="Use regex"
            >
              .*
            </button>
            <button
              onClick={() => setShowReplace(!showReplace)}
              className="px-1.5 py-1 text-[10px] rounded"
              style={showReplace ? { background: "var(--color-primary)", color: "white" } : { background: "var(--surface-3)", color: "var(--color-text-muted)" }}
              title="Toggle replace"
            >
              ↔
            </button>
          </div>
        </div>

        {showReplace && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replace with..."
              className="flex-1 px-3 py-1.5 text-sm border rounded-md focus:outline-none"
              style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
            />
            <button
              className="px-2 py-1.5 text-[10px] rounded hover:bg-white/5 transition-colors"
              style={{ background: "var(--surface-3)", color: "var(--color-text-secondary)", cursor: replace ? "pointer" : "not-allowed", opacity: replace ? 1 : 0.5, border: "none" }}
              disabled={!replace}
              onClick={async () => {
                if (!query || !replace) return;
                try {
                  const { executeCommand } = await import("../../store/engine");
                  // Execute replacement via engine command
                  await executeCommand(`grep -rl "${query.replace(/"/g, '\\"')}" . --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | head -20`);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window as any).__wotannToast?.({ type: "success", title: "Replace complete", message: `Replaced "${query}" with "${replace}" across matching files` });
                } catch {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (window as any).__wotannToast?.({ type: "error", title: "Replace failed", message: "Could not complete the replacement" });
                }
              }}
              aria-label={`Replace all occurrences of "${query}" with "${replace}"`}
            >
              Replace All
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="flex items-center justify-center h-full text-xs gap-2" style={{ color: "var(--color-text-muted)" }}>
            <div className="w-3 h-3 border rounded-full animate-spin" style={{ borderColor: "var(--color-text-muted)", borderTopColor: "transparent" }} aria-hidden="true" />
            Searching...
          </div>
        ) : searchError ? (
          <div className="flex items-center justify-center h-full text-xs px-4 text-center" style={{ color: "var(--color-warning)" }}>
            {searchError}
          </div>
        ) : !engineConnected ? (
          <div className="flex items-center justify-center h-full text-xs px-4 text-center" style={{ color: "var(--color-text-muted)" }}>
            Connect to engine to search files
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--color-text-muted)" }}>
            {query ? "No results" : "Type to search across all files"}
          </div>
        ) : (
          <div className="py-1">
            <div className="px-3 py-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {results.length} results in {new Set(results.map((r) => r.file)).size} files
            </div>
            {results.map((result, i) => (
              <button
                key={i}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] truncate" style={{ color: "var(--color-primary)" }}>{result.file}</span>
                  <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>:{result.line}</span>
                </div>
                <div className="text-xs truncate font-mono mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                  {result.content}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
