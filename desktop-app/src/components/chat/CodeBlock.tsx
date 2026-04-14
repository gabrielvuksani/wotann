/**
 * Syntax-highlighted code block with copy button, language badge, and line numbers toggle.
 * Uses regex-based highlighting for common syntax tokens (keywords, strings, comments, numbers).
 */

import { useState, useCallback, useMemo } from "react";

interface CodeBlockProps {
  readonly code: string;
  readonly language: string;
}

/** Token types for syntax highlighting */
type TokenType = "keyword" | "string" | "comment" | "number" | "function" | "operator" | "plain";

interface Token {
  readonly type: TokenType;
  readonly value: string;
}

/** CSS color for each token type — uses CSS variables for theme awareness */
const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: "var(--color-primary)",
  string: "var(--color-success)",
  comment: "var(--color-text-dim)",
  number: "var(--color-warning)",
  function: "var(--color-context-file)",
  operator: "var(--color-text-muted)",
  plain: "var(--color-text-secondary)",
};

/** Keywords by language family */
const KEYWORD_SETS: Record<string, ReadonlySet<string>> = {
  js: new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
    "switch", "case", "break", "continue", "new", "this", "class", "extends", "import",
    "export", "from", "default", "async", "await", "try", "catch", "finally", "throw",
    "typeof", "instanceof", "in", "of", "true", "false", "null", "undefined", "void",
    "yield", "static", "super", "interface", "type", "enum", "readonly", "as", "implements",
  ]),
  python: new Set([
    "def", "class", "return", "if", "elif", "else", "for", "while", "import", "from",
    "as", "try", "except", "finally", "raise", "with", "yield", "lambda", "pass", "break",
    "continue", "and", "or", "not", "in", "is", "True", "False", "None", "async", "await",
    "global", "nonlocal", "del", "assert",
  ]),
  rust: new Set([
    "fn", "let", "mut", "const", "struct", "enum", "impl", "trait", "pub", "use", "mod",
    "self", "super", "crate", "if", "else", "match", "for", "while", "loop", "return",
    "break", "continue", "async", "await", "move", "ref", "where", "type", "as", "in",
    "true", "false", "unsafe", "extern", "dyn", "static",
  ]),
  go: new Set([
    "func", "var", "const", "type", "struct", "interface", "package", "import", "return",
    "if", "else", "for", "range", "switch", "case", "default", "break", "continue", "go",
    "defer", "chan", "select", "map", "true", "false", "nil", "make", "new", "append",
  ]),
};

function getKeywords(language: string): ReadonlySet<string> {
  const lang = language.toLowerCase();
  if (lang === "typescript" || lang === "typescriptreact" || lang === "tsx" || lang === "jsx") return KEYWORD_SETS["js"]!;
  if (lang === "javascript" || lang === "js" || lang === "ts") return KEYWORD_SETS["js"]!;
  if (lang === "python" || lang === "py") return KEYWORD_SETS["python"]!;
  if (lang === "rust" || lang === "rs") return KEYWORD_SETS["rust"]!;
  if (lang === "go" || lang === "golang") return KEYWORD_SETS["go"]!;
  // Default to JS-like keywords as a reasonable fallback
  return KEYWORD_SETS["js"]!;
}

/** Tokenize a single line of code into highlighted segments */
function tokenizeLine(line: string, keywords: ReadonlySet<string>): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Single-line comment: // or #
    if ((line[i] === "/" && line[i + 1] === "/") || (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]!)))) {
      tokens.push({ type: "comment", value: line.slice(i) });
      break;
    }

    // String: single or double quotes, backticks
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i]!;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j++; // skip escaped chars
        j++;
      }
      tokens.push({ type: "string", value: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Number: integers and floats
    if (/\d/.test(line[i]!) && (i === 0 || /[\s(,=+\-*/<>[\]{}:;!&|^~%]/.test(line[i - 1]!))) {
      let j = i;
      while (j < line.length && /[\d._xXbBoOeE]/.test(line[j]!)) j++;
      tokens.push({ type: "number", value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Operators
    if (/[=+\-*/<>!&|^~%?:]/.test(line[i]!)) {
      let j = i;
      while (j < line.length && /[=+\-*/<>!&|^~%?:]/.test(line[j]!)) j++;
      tokens.push({ type: "operator", value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Word: keyword or identifier
    if (/[a-zA-Z_$]/.test(line[i]!)) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j]!)) j++;
      const word = line.slice(i, j);

      // Check if it's a function call (followed by parenthesis)
      const restTrimmed = line.slice(j).trimStart();
      if (restTrimmed.startsWith("(") && !keywords.has(word)) {
        tokens.push({ type: "function", value: word });
      } else if (keywords.has(word)) {
        tokens.push({ type: "keyword", value: word });
      } else {
        tokens.push({ type: "plain", value: word });
      }
      i = j;
      continue;
    }

    // Anything else (whitespace, punctuation) — plain
    tokens.push({ type: "plain", value: line[i]! });
    i++;
  }

  return tokens;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied
    }
  }, [code]);

  const keywords = useMemo(() => getKeywords(language), [language]);
  const lines = useMemo(() => code.split("\n"), [code]);
  const tokenizedLines = useMemo(
    () => lines.map((line) => tokenizeLine(line, keywords)),
    [lines, keywords],
  );

  return (
    <div className="group relative my-3 overflow-hidden animate-fadeIn" style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "#1C1C1E" }}>
      {/* Header with language badge and copy button */}
      <div className="flex items-center justify-between px-4 py-1.5" style={{ background: "#2C2C2E", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-muted)" }} aria-label={`Language: ${language || "text"}`}>
          {language || "text"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors"
            aria-label={showLineNumbers ? "Hide line numbers" : "Show line numbers"}
            aria-pressed={showLineNumbers}
            style={{ color: showLineNumbers ? "var(--color-primary)" : "var(--color-text-muted)", background: showLineNumbers ? "var(--accent-muted)" : "transparent" }}
          >
            #
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors"
            style={{ fontSize: 12, color: "var(--color-text-muted)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            aria-label={copied ? "Copied to clipboard" : "Copy code to clipboard"}
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M13.5 4.5l-7 7L3 8" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ color: "var(--color-success)" }}>Copied</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3 11V3a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code content with syntax highlighting */}
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed" role="code" tabIndex={0}>
        <code className="font-mono">
          {tokenizedLines.map((tokens, lineIdx) => (
            <div key={lineIdx} className="flex">
              {showLineNumbers && (
                <span className="select-none w-8 text-right pr-3 shrink-0" style={{ color: "var(--color-text-muted)" }} aria-hidden="true">
                  {lineIdx + 1}
                </span>
              )}
              <span>
                {tokens.map((token, tokenIdx) => (
                  <span key={tokenIdx} style={token.type !== "plain" ? { color: TOKEN_COLORS[token.type] } : { color: TOKEN_COLORS.plain }}>
                    {token.value}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
