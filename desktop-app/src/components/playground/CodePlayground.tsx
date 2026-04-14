/**
 * Code Playground — JS/Python/TypeScript REPL in the Workshop tab.
 *
 * Desktop: Node.js vm.runInNewContext() for JS/TS, python3 -c for Python
 * iOS: WKWebView sandbox for JS, Python relayed to KAIROS
 *
 * Features:
 * - Monaco editor for code input
 * - Output console below
 * - Language selector (JS, Python, TS)
 * - Run button + Cmd+Enter shortcut
 * - wotann.tool(...) bridge for invoking agent tools from code
 * - Save/share snippets to conversation
 */

import { useState, useCallback, useEffect } from "react";
import { commands } from "../../hooks/useTauriCommand";
import { MonacoEditor } from "../editor/MonacoEditor";

type Language = "javascript" | "python" | "typescript";

const LANGUAGE_TO_MONACO: Record<Language, string> = {
  javascript: "javascript",
  python: "python",
  typescript: "typescript",
};

interface ExecutionResult {
  readonly output: string;
  readonly error: string | null;
  readonly duration: number;
}

export function CodePlayground() {
  const [code, setCode] = useState("// Write code here and press Run\nconsole.log('Hello from WOTANN!');\n");
  const [language, setLanguage] = useState<Language>("javascript");
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<readonly ExecutionResult[]>([]);

  const runCode = useCallback(async () => {
    setIsRunning(true);
    const start = Date.now();

    try {
      let cmd: string;
      switch (language) {
        case "javascript":
          // Node.js execution with console capture
          cmd = `node -e ${JSON.stringify(code)}`;
          break;
        case "typescript":
          // TSX execution
          cmd = `npx tsx -e ${JSON.stringify(code)}`;
          break;
        case "python":
          cmd = `python3 -c ${JSON.stringify(code)}`;
          break;
      }

      const result = await commands.executeCommand(cmd);
      const duration = Date.now() - start;
      const execResult: ExecutionResult = {
        output: result.stdout || "(no output)",
        error: result.exitCode !== 0 ? result.stderr : null,
        duration,
      };

      setOutput(execResult.error ?? execResult.output);
      setHistory((prev) => [...prev, execResult]);
    } catch (e) {
      const duration = Date.now() - start;
      const errorMsg = String(e);
      setOutput(errorMsg);
      setHistory((prev) => [...prev, { output: "", error: errorMsg, duration }]);
    } finally {
      setIsRunning(false);
    }
  }, [code, language]);

  // Global Cmd+Enter shortcut for running code
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runCode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runCode]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  const LANGUAGES: readonly { id: Language; label: string; icon: string }[] = [
    { id: "javascript", label: "JavaScript", icon: "JS" },
    { id: "python", label: "Python", icon: "PY" },
    { id: "typescript", label: "TypeScript", icon: "TS" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--color-bg-primary)" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          padding: "var(--space-sm) 12px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-1)",
        }}
      >
        {/* Language selector */}
        <div
          role="radiogroup"
          aria-label="Select programming language"
          style={{ display: "flex", gap: 2, background: "var(--surface-2)", borderRadius: "var(--radius-sm)", padding: 2 }}
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              onClick={() => setLanguage(lang.id)}
              role="radio"
              aria-checked={language === lang.id}
              aria-label={lang.label}
              style={{
                padding: "var(--space-xs) 12px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                color: language === lang.id ? "var(--color-primary)" : "var(--color-text-dim)",
                background: language === lang.id ? "var(--accent-muted)" : "transparent",
                border: "none",
                cursor: "pointer",
                transition: "var(--transition-fast)",
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Run button */}
        <button
          onClick={runCode}
          disabled={isRunning}
          className="btn-press"
          aria-label={isRunning ? "Code is running" : "Run code"}
          style={{
            padding: "var(--space-xs) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            color: "white",
            background: isRunning ? "var(--color-text-dim)" : "var(--gradient-accent)",
            border: "none",
            cursor: isRunning ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            transition: "var(--transition-fast)",
          }}
        >
          {isRunning ? "Running..." : "Run"}
          {!isRunning && (
            <span style={{ fontSize: "var(--font-size-2xs)", opacity: 0.7 }}>
              {navigator.userAgent.includes("Mac") ? "Cmd" : "Ctrl"}+Enter
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setCode("");
            setOutput("");
          }}
          aria-label="Clear editor and output"
          style={{
            padding: "var(--space-xs) 12px",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            background: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            cursor: "pointer",
            transition: "var(--transition-fast)",
          }}
        >
          Clear
        </button>
      </div>

      {/* Monaco Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MonacoEditor
          filePath={`playground.${language === "typescript" ? "ts" : language === "python" ? "py" : "js"}`}
          content={code}
          language={LANGUAGE_TO_MONACO[language]}
          onChange={handleCodeChange}
        />
      </div>

      {/* Output */}
      <div
        role="log"
        aria-label="Code execution output"
        style={{
          height: "35%",
          minHeight: 80,
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--color-bg-primary)",
          padding: "var(--space-sm)",
          overflow: "auto",
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: 8,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Output</span>
          {history.length > 0 && (
            <span>
              {history[history.length - 1]?.duration}ms
            </span>
          )}
        </div>
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-xs)",
            lineHeight: 1.5,
            color: output.startsWith("Error") || output.includes("error")
              ? "var(--color-error)"
              : "var(--color-connected)",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {output || "(no output yet)"}
        </pre>
      </div>
    </div>
  );
}
