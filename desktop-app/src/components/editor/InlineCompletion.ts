/**
 * InlineCompletion — factory for a Monaco `InlineCompletionsProvider`.
 *
 * Emits Cursor-style ghost-text suggestions as the user types. Monaco handles
 * rendering (grey preview text) and `Tab` acceptance natively; our provider
 * just supplies the text.
 *
 * Flow:
 *   1. Monaco calls `provideInlineCompletions(model, position, context, token)`
 *      with every edit.
 *   2. We skip explicit (user-triggered) invocations — ghost text is for
 *      implicit typing only, matching Cursor's UX.
 *   3. We extract a 200-char prefix / 100-char suffix window around the
 *      cursor, delegate to `CompletionStream.request()`, and wrap the
 *      resulting string into a Monaco `InlineCompletions` response.
 *   4. Errors and empty / whitespace-only suggestions resolve to `{items: []}`
 *      so the UI falls back gracefully when the daemon lacks the RPC handler.
 */
import type { editor, languages, Position, CancellationToken } from "monaco-editor";
import { CompletionStream } from "./CompletionStream";

// ── Window sizes ─────────────────────────────────────────────────
/** Characters of prefix (before cursor) sent to the completion engine. */
const PREFIX_WINDOW = 200;
/** Characters of suffix (after cursor) sent to the completion engine. */
const SUFFIX_WINDOW = 100;

// Monaco exposes InlineCompletionTriggerKind as an enum. Importing the
// runtime enum would pull in the full monaco bundle here; the numeric value
// for `Automatic` is 0 in the public API and we only compare against it.
const TRIGGER_AUTOMATIC = 0;

/**
 * Build a Monaco inline-completion provider bound to the current editor's
 * active model. The `getModel` callback returns the live model each call so
 * tab switches reuse the same provider without stale references.
 */
export function createInlineProvider(
  getModel: () => editor.ITextModel | null,
): languages.InlineCompletionsProvider {
  // One stream per provider registration — its debounce, cache, and abort
  // state are shared across all provideInlineCompletions() calls.
  const stream = new CompletionStream();

  const provider: languages.InlineCompletionsProvider = {
    async provideInlineCompletions(
      model: editor.ITextModel,
      position: Position,
      context: languages.InlineCompletionContext,
      token: CancellationToken,
    ): Promise<languages.InlineCompletions | undefined> {
      // Only respond to implicit (typing) triggers — skip explicit shortcuts.
      if (context.triggerKind !== TRIGGER_AUTOMATIC) {
        return { items: [] };
      }

      // Guard: the editor may be mid-unmount.
      const activeModel = getModel();
      if (activeModel !== null && activeModel !== model) {
        // A different model is live — skip to avoid cross-buffer noise.
        return { items: [] };
      }

      if (token.isCancellationRequested) {
        stream.abort();
        return { items: [] };
      }

      // Compute absolute character offset of the cursor so we can slice a
      // stable window regardless of line boundaries. Monaco is 1-indexed.
      const cursorOffset = model.getOffsetAt(position);
      const fullText = model.getValue();

      const prefixStart = Math.max(0, cursorOffset - PREFIX_WINDOW);
      const suffixEnd = Math.min(fullText.length, cursorOffset + SUFFIX_WINDOW);

      const prefix = fullText.slice(prefixStart, cursorOffset);
      const suffix = fullText.slice(cursorOffset, suffixEnd);
      const language = model.getLanguageId();

      let suggestion: string;
      try {
        suggestion = await stream.request(prefix, suffix, language);
      } catch {
        return { items: [] };
      }

      // Bail on cancellation (cursor moved while we were waiting).
      if (token.isCancellationRequested) {
        return { items: [] };
      }

      // Reject empty and whitespace-only suggestions — they would render as
      // invisible ghost text and steal the Tab keystroke for no benefit.
      if (suggestion.length === 0 || suggestion.trim().length === 0) {
        return { items: [] };
      }

      return {
        items: [
          {
            insertText: suggestion,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          },
        ],
      };
    },

    // Monaco legacy API (`freeInlineCompletions`) and current API
    // (`disposeInlineCompletions`) both funnel here — no per-item resources
    // are retained so this is a no-op. Both method names are wired so this
    // provider works across Monaco versions.
    freeInlineCompletions(): void {
      // no-op — we hold no per-completion resources.
    },
    disposeInlineCompletions(): void {
      // no-op — alias of freeInlineCompletions for newer Monaco versions.
    },
  } as languages.InlineCompletionsProvider & {
    readonly freeInlineCompletions: () => void;
  };

  return provider;
}
