/**
 * Embedded Terminal — panel below editor for running commands.
 * In production, uses xterm.js for a real terminal emulator.
 * Executes real shell commands via the Tauri command bridge.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { executeCommand } from "../../store/engine";

interface TerminalLine {
  readonly id: string;
  readonly type: "input" | "output" | "error";
  readonly content: string;
  readonly timestamp: number;
}

const MAX_HISTORY = 50;

export function EditorTerminal() {
  const [lines, setLines] = useState<readonly TerminalLine[]>([
    { id: "1", type: "output", content: "WOTANN Terminal v0.1.0", timestamp: Date.now() },
    { id: "2", type: "output", content: "Type commands or ask the agent to run them.", timestamp: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [cwd, setCwd] = useState(".");
  const [commandHistory, setCommandHistory] = useState<readonly string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [lines]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isExecuting) return;

    const trimmed = input.trim();

    // Record command in history (immutable — new array)
    setCommandHistory((prev) => {
      const withNew = [...prev, trimmed];
      return withNew.length > MAX_HISTORY ? withNew.slice(withNew.length - MAX_HISTORY) : withNew;
    });
    setHistoryIndex(-1);

    const inputLine: TerminalLine = {
      id: `in-${Date.now()}`,
      type: "input",
      content: `${cwd} $ ${trimmed}`,
      timestamp: Date.now(),
    };

    // Handle clear locally
    if (trimmed === "clear") {
      setLines([]);
      setInput("");
      return;
    }

    // Handle cd command — update cwd state
    if (trimmed === "cd" || trimmed.startsWith("cd ")) {
      const target = trimmed === "cd" ? "~" : trimmed.slice(3).trim();
      setLines((prev) => [...prev, inputLine]);
      setInput("");

      // Resolve the new cwd by asking the shell
      setIsExecuting(true);
      try {
        const resolveCmd = cwd === "."
          ? `cd ${target} && pwd`
          : `cd ${cwd} && cd ${target} && pwd`;
        const result = await executeCommand(resolveCmd);
        if (result.exitCode === 0 && result.stdout.trim()) {
          setCwd(result.stdout.trim());
          setLines((prev) => [
            ...prev,
            { id: `out-${Date.now()}`, type: "output", content: result.stdout.trim(), timestamp: Date.now() },
          ]);
        } else {
          setLines((prev) => [
            ...prev,
            { id: `err-${Date.now()}`, type: "error", content: result.stderr || `cd: no such directory: ${target}`, timestamp: Date.now() },
          ]);
        }
      } catch {
        setLines((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, type: "error" as const, content: `cd: failed to change directory`, timestamp: Date.now() },
        ]);
      } finally {
        setIsExecuting(false);
      }
      return;
    }

    setLines((prev) => [...prev, inputLine]);
    setInput("");
    setIsExecuting(true);

    // Prepend cd to cwd so the command runs in the right directory
    const fullCmd = cwd === "." ? trimmed : `cd ${cwd} && ${trimmed}`;

    try {
      const result = await executeCommand(fullCmd);
      const outputLines: TerminalLine[] = [];

      if (result.stdout) {
        outputLines.push({
          id: `out-${Date.now()}`,
          type: "output",
          content: result.stdout,
          timestamp: Date.now(),
        });
      }
      if (result.stderr) {
        outputLines.push({
          id: `err-${Date.now()}`,
          type: "error",
          content: result.stderr,
          timestamp: Date.now(),
        });
      }
      if (outputLines.length === 0 && result.exitCode !== 0) {
        outputLines.push({
          id: `err-${Date.now()}`,
          type: "error",
          content: `Process exited with code ${result.exitCode}`,
          timestamp: Date.now(),
        });
      }

      setLines((prev) => [...prev, ...outputLines]);
    } catch {
      setLines((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: "error" as const,
          content: "Failed to execute command",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsExecuting(false);
    }
  }, [input, isExecuting, cwd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const newIndex = historyIndex === -1
        ? commandHistory.length - 1
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex]!);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]!);
      }
    }
  }, [commandHistory, historyIndex]);

  const handleClear = useCallback(() => {
    setLines([]);
  }, []);

  return (
    <div className="h-full flex flex-col font-mono text-xs" style={{ background: "var(--bg-base)" }} role="region" aria-label="Terminal">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-[10px]" style={{ color: "var(--color-text-muted)" }}>TERMINAL</span>
          <span style={{ color: "var(--color-text-muted)" }}>|</span>
          <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>bash</span>
          <span style={{ color: "var(--color-text-muted)" }}>|</span>
          <span className="text-[10px] truncate max-w-[200px]" style={{ color: "var(--color-text-dim)" }} title={cwd}>{cwd}</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleClear}
            className="px-1.5 py-0.5 text-[9px] terminal-btn-hover"
            style={{ color: "var(--color-text-muted)" }}
          >
            Clear
          </button>
          <button
            onClick={async () => {
              if (isExecuting) {
                setIsExecuting(false);
                // Attempt to kill any running child process via Tauri
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  // Kill the shell process group — send SIGTERM to process group
                  await invoke("execute_command", { cmd: "pkill -P $$ 2>/dev/null || true" });
                } catch {
                  // Not in Tauri or command failed — best effort
                }
                setLines((prev) => [
                  ...prev,
                  {
                    id: `cancel-${Date.now()}`,
                    type: "error" as const,
                    content: "Process terminated",
                    timestamp: Date.now(),
                  },
                ]);
              }
            }}
            disabled={!isExecuting}
            className="px-1.5 py-0.5 text-[9px] terminal-btn-hover"
            style={{ color: isExecuting ? "var(--color-error)" : "var(--color-text-muted)" }}
            aria-label="Kill running process"
          >
            Kill
          </button>
        </div>
      </div>

      {/* Output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5" role="log" aria-label="Terminal output" aria-live="polite">
        {lines.map((line) => (
          <div key={line.id} className="flex">
            {line.type === "input" ? (
              <>
                <span style={{ color: "var(--color-success)" }} className="mr-2">$</span>
                <span style={{ color: "var(--color-text-primary)" }}>{line.content}</span>
              </>
            ) : line.type === "error" ? (
              <span style={{ color: "var(--color-error)" }}>{line.content}</span>
            ) : (
              <span style={{ color: "var(--color-text-secondary)" }}>{line.content}</span>
            )}
          </div>
        ))}
        {isExecuting && (
          <div className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
            <span className="w-2 h-2 border rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-text-secondary)" }} />
            Running...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center border-t px-2 py-1" style={{ borderColor: "var(--border-subtle)" }}>
        <span style={{ color: "var(--color-text-dim)" }} className="mr-1 text-[10px] truncate max-w-[150px]">{cwd}</span>
        <span style={{ color: "var(--color-success)" }} className="mr-2">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none"
          style={{ color: "var(--color-text-primary)" }}
          placeholder="Type a command..."
          autoFocus
          disabled={isExecuting}
          aria-label="Terminal command input"
        />
      </form>
    </div>
  );
}
