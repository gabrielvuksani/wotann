/**
 * Monaco Editor wrapper — VS Code's editor engine with WOTANN dark theme.
 * Supports 100+ languages, multi-cursor, code folding, minimap.
 */

import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useRef, useState } from "react";
import { useStore } from "../../store";
import { enhancePrompt } from "../../store/engine";
import { InlineSuggestions } from "./InlineSuggestions";

// ── FIM Constants ──────────────────────────────────────────
/** Number of lines before/after cursor to include in the FIM context window. */
const FIM_CONTEXT_LINES = 50;
/** Debounce delay (ms) before sending a completion request. */
const FIM_DEBOUNCE_MS = 300;

// Language detection from file extension
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
  py: "python", rs: "rust", go: "go", java: "java", cs: "csharp",
  rb: "ruby", php: "php", swift: "swift", kt: "kotlin",
  html: "html", css: "css", scss: "scss", json: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
  sql: "sql", sh: "shell", bash: "shell", zsh: "shell",
  dockerfile: "dockerfile", xml: "xml", graphql: "graphql",
};

export function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

interface MonacoEditorProps {
  readonly filePath: string;
  readonly content: string;
  readonly language?: string;
  readonly onChange?: (value: string) => void;
  readonly readOnly?: boolean;
}

export function MonacoEditor({ filePath, content, language, onChange, readOnly }: MonacoEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const fontSize = useStore((s) => s.settings.fontSize);
  const [suggestionVisible, setSuggestionVisible] = useState(false);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Build WOTANN dark theme dynamically from CSS variables
    const style = getComputedStyle(document.documentElement);
    const cssVar = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    // Monaco theme colors need hex — strip the # for token foreground rules
    const stripHash = (c: string): string => c.replace(/^#/, "");

    const bgBase = cssVar("--bg-base", "#08080c");
    const textPrimary = cssVar("--color-text-primary", "#e2e8f0");
    const surfaceHighlight = cssVar("--surface-1", "#18181b");
    const accentRaw = cssVar("--color-primary", "#0A84FF");
    const accentDim = cssVar("--color-primary-dim", "#0066CC");
    const borderSubtle = cssVar("--border-muted", "#27272a");
    const borderDefault = cssVar("--border-default", "#3f3f46");
    const textMuted = cssVar("--color-text-muted", "#a1a1aa");
    const textDim = cssVar("--color-text-dim", "#6b7280");
    const tokenKeyword = cssVar("--token-keyword", "#c084fc");
    const tokenString = cssVar("--token-string", "#34d399");
    const tokenNumber = cssVar("--token-number", "#f59e0b");
    const tokenType = cssVar("--token-type", "#60a5fa");
    const tokenFunction = cssVar("--token-function", "#5AC8FA");
    const tokenOperator = cssVar("--token-operator", "#94a3b8");

    monaco.editor.defineTheme("wotann-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: stripHash(textDim), fontStyle: "italic" },
        { token: "keyword", foreground: stripHash(tokenKeyword) },
        { token: "string", foreground: stripHash(tokenString) },
        { token: "number", foreground: stripHash(tokenNumber) },
        { token: "type", foreground: stripHash(tokenType) },
        { token: "function", foreground: stripHash(tokenFunction) },
        { token: "variable", foreground: stripHash(textPrimary) },
        { token: "operator", foreground: stripHash(tokenOperator) },
      ],
      colors: {
        "editor.background": bgBase,
        "editor.foreground": textPrimary,
        "editor.lineHighlightBackground": surfaceHighlight,
        "editor.selectionBackground": `${accentDim}40`,
        "editor.inactiveSelectionBackground": `${accentDim}20`,
        "editorCursor.foreground": accentRaw,
        "editorLineNumber.foreground": borderDefault,
        "editorLineNumber.activeForeground": textMuted,
        "editorIndentGuide.background": borderSubtle,
        "editorIndentGuide.activeBackground": borderDefault,
        "editorGutter.background": bgBase,
        "editor.findMatchBackground": `${accentDim}30`,
        "editor.findMatchHighlightBackground": `${accentDim}15`,
        "scrollbarSlider.background": `${borderSubtle}80`,
        "scrollbarSlider.hoverBackground": borderDefault,
        "minimap.background": bgBase,
      },
    });
    monaco.editor.setTheme("wotann-dark");

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const content = editor.getValue();
      import("@tauri-apps/api/core").then(({ invoke }) => {
        if ((window as any).__TAURI_INTERNALS__) invoke("write_file", { path: filePath, content }).catch(console.error);
      });
    });

    // ── FIM InlineCompletionsProvider ────────────────────────
    // Sends prefix + suffix context (50 lines each) to the engine for
    // fill-in-middle completions. The engine routes to the fastest
    // available model: Gemini Flash -> local Gemma -> Haiku.
    let fimDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const providerDisposable = monaco.languages.registerInlineCompletionsProvider(
      { pattern: "**" },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
          // Cancel any pending debounce
          if (fimDebounceTimer) {
            clearTimeout(fimDebounceTimer);
            fimDebounceTimer = null;
          }

          // Require at least some content on the current line
          const currentLineContent = model.getLineContent(position.lineNumber);
          if (currentLineContent.trim().length < 2) {
            return { items: [] };
          }

          // Build FIM context via a debounced promise
          const completionText = await new Promise<string | null>((resolve) => {
            fimDebounceTimer = setTimeout(async () => {
              if (token.isCancellationRequested) {
                resolve(null);
                return;
              }

              try {
                // Extract prefix: current line up to cursor + preceding lines
                const totalLines = model.getLineCount();
                const prefixStartLine = Math.max(1, position.lineNumber - FIM_CONTEXT_LINES);
                const prefixLines: string[] = [];
                for (let i = prefixStartLine; i < position.lineNumber; i++) {
                  prefixLines.push(model.getLineContent(i));
                }
                // Add the current line up to the cursor column
                const lineUpToCursor = currentLineContent.substring(0, position.column - 1);
                prefixLines.push(lineUpToCursor);
                const prefix = prefixLines.join("\n");

                // Extract suffix: rest of current line + following lines
                const suffixEndLine = Math.min(totalLines, position.lineNumber + FIM_CONTEXT_LINES);
                const suffixLines: string[] = [];
                // Rest of the current line after cursor
                const lineAfterCursor = currentLineContent.substring(position.column - 1);
                if (lineAfterCursor.length > 0) {
                  suffixLines.push(lineAfterCursor);
                }
                for (let i = position.lineNumber + 1; i <= suffixEndLine; i++) {
                  suffixLines.push(model.getLineContent(i));
                }
                const suffix = suffixLines.join("\n");

                const lang = model.getLanguageId();

                // Build FIM prompt — the engine parses this structured format
                // and routes to the fastest available model.
                const fimPrompt = [
                  `<fim_request>`,
                  `<language>${lang}</language>`,
                  `<file>${filePath}</file>`,
                  `<prefix>${prefix}</prefix>`,
                  `<suffix>${suffix}</suffix>`,
                  `</fim_request>`,
                  `Return ONLY the code to insert at the cursor. No explanation, no markdown fences.`,
                ].join("\n");

                const result = await enhancePrompt(fimPrompt, "completion");

                if (token.isCancellationRequested) {
                  resolve(null);
                  return;
                }

                resolve(result?.enhanced ?? null);
              } catch {
                resolve(null);
              }
            }, FIM_DEBOUNCE_MS);
          });

          if (!completionText || token.isCancellationRequested) {
            setSuggestionVisible(false);
            return { items: [] };
          }

          // Signal the hint overlay that a suggestion is active
          setSuggestionVisible(true);

          return {
            items: [{
              insertText: completionText,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            }],
          };
        },
        freeInlineCompletions: () => {
          // Called when Monaco discards completions (user typed past them, etc.)
          setSuggestionVisible(false);
        },
      },
    );

    // Track when inline suggestions are accepted or dismissed
    // so the hint overlay hides promptly.
    editor.onDidChangeCursorPosition(() => {
      // When cursor moves (typing, clicking), hide hint overlay.
      // The provider will re-show it if a new suggestion arrives.
      setSuggestionVisible(false);
    });

    // Register Cmd+Right to accept the next word of the inline suggestion.
    // Monaco has a built-in action for this.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow,
      () => {
        editor.trigger("keyboard", "editor.action.inlineSuggest.acceptNextWord", {});
      },
    );

    // Dispose the provider when the editor unmounts
    editor.onDidDispose(() => {
      providerDisposable.dispose();
      if (fimDebounceTimer) clearTimeout(fimDebounceTimer);
    });
  }, [filePath]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) onChange?.(value);
    },
    [onChange],
  );

  const effectiveLanguage = language ?? getLanguageFromPath(filePath);

  return (
    <div className="relative h-full">
      <Editor
        height="100%"
        language={effectiveLanguage}
        value={content}
        theme="wotann-dark"
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: fontSize ?? 14,
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
          fontLigatures: true,
          minimap: { enabled: true, size: "proportional" },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          cursorBlinking: "smooth",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          renderLineHighlight: "all",
          readOnly: readOnly ?? false,
          wordWrap: "off",
          tabSize: 2,
          formatOnPaste: true,
          autoClosingBrackets: "always",
          autoClosingQuotes: "always",
          suggest: { showWords: false },
          inlineSuggest: { enabled: true },
          padding: { top: 12 },
        }}
      />
      {!readOnly && <InlineSuggestions visible={suggestionVisible} />}
    </div>
  );
}
