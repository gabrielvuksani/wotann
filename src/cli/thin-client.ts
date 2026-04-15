/**
 * Thin-client TUI mode (D12).
 *
 * The default `wotann` CLI loads the full WotannRuntime (~408 modules, a few
 * hundred MB of memory) because the TUI historically drove the agent
 * in-process. When a daemon is already running, we can do much better:
 * connect over IPC, send RPC calls, and render the streaming responses in a
 * tiny Ink TUI. Cold start drops from ~2-5s to ~150ms.
 *
 * Activation paths:
 *  - `wotann --thin` or the `WOTANN_THIN=1` env var
 *  - `wotann` auto-detects a running daemon and uses thin-client by default
 *    (fallback to full runtime if no daemon socket exists)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import type { Socket } from "node:net";

const IPC_SOCKET_PATH = join(homedir(), ".wotann", "kairos.sock");

export interface ThinClientOptions {
  readonly socketPath?: string;
  readonly timeoutMs?: number;
  readonly token?: string;
}

export interface ThinRPCCall {
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly id: string | number;
}

export interface ThinRPCResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

export interface ThinStreamEvent {
  readonly jsonrpc: "2.0";
  readonly method: "stream";
  readonly params: {
    readonly type: "text" | "thinking" | "tool_use" | "done" | "error";
    readonly content: string;
    readonly sessionId?: string;
    readonly provider?: string;
    readonly model?: string;
  };
}

/**
 * Probe for a running daemon without spinning up the full runtime.
 * Returns true when the IPC socket exists and accepts a connection.
 */
export async function detectDaemon(options: ThinClientOptions = {}): Promise<boolean> {
  const path = options.socketPath ?? IPC_SOCKET_PATH;
  if (!existsSync(path)) return false;
  return new Promise<boolean>((resolve) => {
    const sock = createConnection({ path });
    const done = (result: boolean): void => {
      sock.destroy();
      resolve(result);
    };
    sock.on("connect", () => done(true));
    sock.on("error", () => done(false));
    setTimeout(() => done(false), options.timeoutMs ?? 200);
  });
}

/**
 * Thin RPC client — talks JSON-RPC over the daemon unix socket. No runtime
 * is instantiated on the client side; every call is round-tripped.
 */
export class ThinRPCClient {
  private socket: Socket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<
    string | number,
    { resolve: (r: ThinRPCResponse) => void; reject: (err: Error) => void }
  >();
  private streamListeners = new Set<(ev: ThinStreamEvent) => void>();

  constructor(private readonly options: ThinClientOptions = {}) {}

  async connect(): Promise<void> {
    const path = this.options.socketPath ?? IPC_SOCKET_PATH;
    return new Promise((resolve, reject) => {
      const sock = createConnection({ path });
      sock.setEncoding("utf-8");
      sock.on("connect", () => {
        this.socket = sock;
        resolve();
      });
      sock.on("error", reject);
      sock.on("data", (chunk: string) => this.onData(chunk));
      sock.on("close", () => this.onClose());
      setTimeout(() => {
        if (!this.socket) reject(new Error("Thin-client IPC connect timeout"));
      }, this.options.timeoutMs ?? 3000);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    for (const { reject } of this.pending.values()) {
      reject(new Error("Disconnected"));
    }
    this.pending.clear();
    this.streamListeners.clear();
  }

  /**
   * Send a single JSON-RPC call and await the non-streaming response. For
   * streaming methods (chat.send, autonomous.run), use `call` alongside
   * `onStream`.
   */
  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.socket) throw new Error("Not connected");
    const id = this.nextId++;
    const frame: Record<string, unknown> = { jsonrpc: "2.0", method, params, id };
    if (this.options.token) {
      frame["_meta"] = { token: this.options.token };
    }
    const promise = new Promise<ThinRPCResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.write(JSON.stringify(frame) + "\n");
    const response = await promise;
    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }
    return response.result;
  }

  onStream(listener: (ev: ThinStreamEvent) => void): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let newlineIdx = this.buf.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.buf.slice(0, newlineIdx);
      this.buf = this.buf.slice(newlineIdx + 1);
      if (line.length > 0) this.processFrame(line);
      newlineIdx = this.buf.indexOf("\n");
    }
  }

  private processFrame(raw: string): void {
    try {
      const msg = JSON.parse(raw) as ThinRPCResponse | ThinStreamEvent;
      if ("method" in msg && msg.method === "stream") {
        for (const listener of this.streamListeners) listener(msg);
        return;
      }
      const response = msg as ThinRPCResponse;
      const pending = this.pending.get(response.id);
      if (pending) {
        pending.resolve(response);
        this.pending.delete(response.id);
      }
    } catch {
      // Malformed frame — ignore
    }
  }

  private onClose(): void {
    this.socket = null;
    for (const { reject } of this.pending.values()) {
      reject(new Error("Socket closed"));
    }
    this.pending.clear();
  }
}

/**
 * Launch the thin TUI — Ink-based text UI that streams chat responses and
 * renders status via RPC calls only. Import dynamically so unit tests don't
 * pull in React.
 */
export async function runThinTUI(options: ThinClientOptions = {}): Promise<void> {
  const [{ default: React }, { render, Box, Text, useApp, useInput }, { default: TextInput }] =
    await Promise.all([
      import("react"),
      import("ink"),
      import("ink-text-input" as unknown as string).catch(() => ({ default: null })),
    ]);
  type InputComponent = React.ComponentType<{
    value: string;
    onChange: (v: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
  }>;
  const Input = (TextInput as InputComponent | null) ?? null;

  const client = new ThinRPCClient(options);
  await client.connect();

  const ThinApp = (): React.ReactElement => {
    const [messages, setMessages] = React.useState<Array<{ role: "user" | "agent"; text: string }>>(
      [],
    );
    const [input, setInput] = React.useState("");
    const [streaming, setStreaming] = React.useState(false);
    const [buffer, setBuffer] = React.useState("");
    const app = useApp();

    React.useEffect(() => {
      return client.onStream((ev) => {
        if (ev.params.type === "text") {
          setBuffer((b) => b + ev.params.content);
        } else if (ev.params.type === "done") {
          setBuffer((b) => {
            setMessages((m) => [...m, { role: "agent", text: b }]);
            return "";
          });
          setStreaming(false);
        } else if (ev.params.type === "error") {
          setBuffer("");
          setStreaming(false);
          setMessages((m) => [...m, { role: "agent", text: `[error] ${ev.params.content}` }]);
        }
      });
    }, []);

    useInput((_input, key) => {
      if (key.ctrl && _input === "c") {
        client.disconnect();
        app.exit();
      }
    });

    const submit = React.useCallback(async (): Promise<void> => {
      if (streaming || input.trim().length === 0) return;
      const prompt = input.trim();
      setMessages((m) => [...m, { role: "user", text: prompt }]);
      setInput("");
      setStreaming(true);
      try {
        await client.call("chat.send", { prompt, stream: true });
      } catch (err) {
        setMessages((m) => [...m, { role: "agent", text: `[rpc error] ${String(err)}` }]);
        setStreaming(false);
      }
    }, [input, streaming]);

    if (!Input) {
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(
          Text,
          { color: "red" },
          "ink-text-input is not installed — install it or use `wotann` full mode.",
        ),
      );
    }

    return React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(
        Text,
        { bold: true, color: "cyan" },
        "WOTANN thin client — Ctrl+C to exit",
      ),
      ...messages.map((m, i) =>
        React.createElement(
          Box,
          { key: i, marginTop: 1 },
          React.createElement(
            Text,
            { color: m.role === "user" ? "green" : "white" },
            `${m.role === "user" ? "› " : "  "}${m.text}`,
          ),
        ),
      ),
      streaming &&
        buffer.length > 0 &&
        React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, { color: "white" }, `  ${buffer}▌`),
        ),
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: "cyan" }, "› "),
        React.createElement(Input, {
          value: input,
          onChange: setInput,
          onSubmit: submit,
          placeholder: "Ask anything (daemon responds)",
        }),
      ),
    );
  };

  render(React.createElement(ThinApp));
}

/**
 * Top-level entry — detect daemon, fall back to full runtime if needed.
 * Called from src/index.ts when --thin is passed or daemon auto-detected.
 */
export async function launchOrFallback(options: ThinClientOptions = {}): Promise<boolean> {
  const daemonRunning = await detectDaemon(options);
  if (!daemonRunning) return false;
  try {
    await runThinTUI(options);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[thin-client] fell back to full runtime:", err);
    return false;
  }
}
