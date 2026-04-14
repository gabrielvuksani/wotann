/**
 * CompletionStream — manages streaming completion RPC requests to the WOTANN
 * engine for Cursor-style ghost-text tab completion in Monaco.
 *
 * Responsibilities:
 *   - Debounce incoming requests (300ms) so rapid typing collapses into one RPC
 *   - Cancel prior in-flight requests when a new one starts (AbortController)
 *   - Cache the last 20 (prefix, suffix, language) tuples to avoid re-asking
 *   - Provide an abort() method the caller invokes on cursor-position change
 *
 * The underlying RPC is `completion.suggest`, dispatched via
 * `commands.sendMessage({method, params})`. If the daemon does not yet
 * implement the handler, errors are swallowed and an empty string is returned
 * so the UI falls back to showing no suggestion.
 */
import { commands } from "../../hooks/useTauriCommand";

// ── Constants ────────────────────────────────────────────────────
/** Debounce interval before dispatching a completion request. */
const DEBOUNCE_MS = 300;
/** Maximum number of cached suggestions to retain (LRU eviction). */
const CACHE_MAX_ENTRIES = 20;
/** Token budget for the completion — kept small so suggestions are snappy. */
const MAX_TOKENS = 80;

/** Shape of the RPC response — defensively narrowed, nothing else assumed. */
interface CompletionRpcResult {
  readonly suggestion?: string;
  readonly text?: string;
  readonly completion?: string;
}

/**
 * Deterministic, collision-resistant hash for cache keys.
 * Uses the djb2 variant — small footprint, good distribution for source text.
 */
function hashKey(prefix: string, suffix: string, language: string): string {
  const input = `${language}\u0001${prefix}\u0002${suffix}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Extract a suggestion string from whatever shape the RPC returned.
 * Accepts `{suggestion}`, `{text}`, `{completion}`, or a bare string.
 */
function extractSuggestion(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as CompletionRpcResult;
    if (typeof r.suggestion === "string") return r.suggestion;
    if (typeof r.text === "string") return r.text;
    if (typeof r.completion === "string") return r.completion;
  }
  return "";
}

/**
 * CompletionStream — one instance per provider registration. Instance methods
 * maintain private debounce/abort/cache state so providers created for
 * different language groups do not contend.
 */
export class CompletionStream {
  // Debounce timer handle — cleared whenever a newer request arrives.
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Abort controller for the currently-pending request, so we can cancel it.
  private currentAbort: AbortController | null = null;
  // LRU cache: insertion-ordered Map of hash -> suggestion.
  private readonly cache = new Map<string, string>();

  /**
   * Request a completion for the given (prefix, suffix, language) tuple.
   * Returns the suggested text, or "" when the request is cancelled, cached
   * empty, errors out, or the daemon has no handler for the RPC yet.
   *
   * Contract:
   *   - Calling request() while a prior request is pending cancels the prior
   *     one — its promise resolves to "".
   *   - Results are cached for the same (prefix, suffix, language) tuple.
   *   - Callers must treat "" as "no suggestion available."
   */
  async request(
    prefix: string,
    suffix: string,
    language: string,
  ): Promise<string> {
    // Cache hit short-circuits debouncing + RPC entirely.
    const key = hashKey(prefix, suffix, language);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Refresh LRU ordering on hit.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    // Cancel any in-flight request — new input supersedes old.
    this.abort();

    // Create a fresh abort controller for this request.
    const controller = new AbortController();
    this.currentAbort = controller;

    return new Promise<string>((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;

        // Abort may have fired during the debounce window.
        if (controller.signal.aborted) {
          resolve("");
          return;
        }

        try {
          const payload = JSON.stringify({
            method: "completion.suggest",
            params: {
              prefix,
              suffix,
              language,
              maxTokens: MAX_TOKENS,
            },
          });

          // sendMessage is a typed invoke wrapper — it returns string.
          const raw = await commands.sendMessage(payload);

          if (controller.signal.aborted) {
            resolve("");
            return;
          }

          // The daemon may return a JSON envelope OR a bare string.
          let parsed: unknown = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Not JSON — treat the raw response as the suggestion text.
          }

          const suggestion = extractSuggestion(parsed);

          // Store successful result in the LRU cache.
          this.setCache(key, suggestion);
          resolve(suggestion);
        } catch {
          // Daemon handler may not exist yet — callers expect "" in that case.
          resolve("");
        } finally {
          // Clear abort controller only if it still refers to this request.
          if (this.currentAbort === controller) {
            this.currentAbort = null;
          }
        }
      }, DEBOUNCE_MS);
    });
  }

  /**
   * Abort the pending request (if any). Idempotent. Callers invoke this on
   * cursor-position change, editor disposal, or whenever they want to cancel.
   */
  abort(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.currentAbort !== null) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
  }

  /** LRU insert — evicts the oldest entry when the cache is full. */
  private setCache(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Evict the oldest entry (first key in insertion order).
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, value);
  }
}
