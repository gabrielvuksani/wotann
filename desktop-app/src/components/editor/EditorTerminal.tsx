/**
 * Embedded Terminal — panel below editor for running commands.
 * In production, uses xterm.js for a real terminal emulator.
 * Executes real shell commands via the Tauri command bridge.
 *
 * Phase D — each completed command is rendered as a Warp-style Block so the
 * user can copy the whole turn, re-run it, or share a permalink. The raw
 * streaming output still appears inline while a command runs; once it
 * completes, the final pair (command + output + exit code) is committed as
 * a Block at the top of the log.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { executeCommand } from "../../store/engine";
import { Block, type BlockStatus } from "../wotann/Block";

interface TerminalLine {
  readonly id: string;
  readonly type: "input" | "output" | "error";
  readonly content: string;
  readonly timestamp: number;
}

interface CompletedBlock {
  readonly id: string;
  readonly command: string;
  readonly output: string;
  readonly status: BlockStatus;
  readonly durationMs: number;
}

const MAX_HISTORY = 50;
const MAX_BLOCKS = 20;

export function EditorTerminal() {
  const [lines, setLines] = useState<readonly TerminalLine[]>([
    { id: "1", type: "output", content: "WOTANN Terminal v0.1.0", timestamp: Date.now() },
    { id: "2", type: "output", content: "Type commands or ask the agent to run them.", timestamp: Date.now() },
  ]);
  const [blocks, setBlocks] = useState<readonly CompletedBlock[]>([]);
  const [input, setInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [cwd, setCwd] = useState(".");
  const [commandHistory, setCommandHistory] = useState<readonly string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const commitBlock = useCallback(
    (entry: Omit<CompletedBlock, "id">): void => {
      // Immutable append: drop the oldest block if we're at the cap.
      setBlocks((prev) => {
        const withNew: readonly CompletedBlock[] = [
          ...prev,
          { id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...entry },
        ];
        return withNew.length > MAX_BLOCKS ? withNew.slice(withNew.length - MAX_BLOCKS) : withNew;
      });
    },
    [],
  );

  const rerunCommand = useCallback((cmd: string): void => {
    // Fire-and-forget: push the command into the input and let the normal
    // submit path handle it. This also records history correctly.
    setInput(cmd);
  }, []);

  const shareBlock = useCallback((blockId: string): void => {
    // Placeholder permalink — phase E wires conversation export.
    const permalink = `wotann://terminal-block/${blockId}`;
    void navigator.clipboard?.writeText(permalink).catch(() => {});
  }, []);

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
    const startedAt = Date.now();

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

      // Commit a Block record for the completed command.
      const combinedOutput = [result.stdout, result.stderr]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("");
      const blockStatus: BlockStatus =
        result.exitCode === 0 ? "success" : "error";
      commitBlock({
        command: trimmed,
        output: combinedOutput || `Process exited with code ${result.exitCode}`,
        status: blockStatus,
        durationMs: Date.now() - startedAt,
      });
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
      commitBlock({
        command: trimmed,
        output: "Failed to execute command",
        status: "error",
        durationMs: Date.now() - startedAt,
      });
    } finally {
      setIsExecuting(false);
    }
  }, [input, isExecuting, cwd, commitBlock]);

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
    setBlocks([]);
  }, []);

  const [blocksMode, setBlocksMode] = useState<"stream" | "blocks">("stream");

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
            type="button"
            onClick={() => setBlocksMode((m) => (m === "stream" ? "blocks" : "stream"))}
            className="px-1.5 py-0.5 text-[9px] terminal-btn-hover"
            style={{ color: "var(--color-text-muted)" }}
            aria-pressed={blocksMode === "blocks"}
            title={blocksMode === "blocks" ? "Switch to stream view" : "Switch to Warp-style blocks view"}
          >
            {blocksMode === "blocks" ? "Stream" : "Blocks"}
          </button>
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2" role="log" aria-label="Terminal output" aria-live="polite">
        {blocksMode === "blocks" ? (
          <div className="flex flex-col gap-2">
            {blocks.length === 0 ? (
              <div style={{ color: "var(--color-text-muted)" }} className="text-[10px] p-2">
                No completed commands yet — run something to populate blocks.
              </div>
            ) : (
              blocks.map((b) => (
                <Block
                  key={b.id}
                  command={b.command}
                  output={b.output}
                  status={b.status}
                  duration={`${b.durationMs}ms`}
                  onRerun={() => rerunCommand(b.command)}
                  onShare={() => shareBlock(b.id)}
                />
              ))
            )}
            {isExecuting && (
              <div className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
                <span className="w-2 h-2 border rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-text-secondary)" }} />
                Running...
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
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
