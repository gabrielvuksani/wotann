/**
 * ACP stdio runtime wrapper (C16 runtime).
 *
 * Frames newline-delimited JSON-RPC messages on a duplex stream
 * (stdin/stdout by default) and feeds them to an AcpServer. Mirrors
 * the LSP-style framing most editors already speak, so hosts like
 * Zed and Goose can invoke `wotann acp --stdio` and drop straight
 * into a chat session.
 *
 * Intentionally minimal — no Content-Length framing, one message per
 * line. Matches `agentclientprotocol.com` v0.x reference servers.
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { AcpServer, type AcpHandlers, type AcpServerInfo } from "./server.js";
import { ACP_PROTOCOL_VERSION } from "./protocol.js";

export interface AcpStdioOptions {
  readonly handlers: AcpHandlers;
  readonly serverInfo?: AcpServerInfo;
  readonly input?: Readable;
  readonly output?: Writable;
  readonly onError?: (err: unknown, rawFrame: string | undefined) => void;
}

export interface AcpStdioHandle {
  readonly server: AcpServer;
  stop(): Promise<void>;
}

/**
 * Start an ACP stdio server. Each newline-terminated input line is
 * decoded and dispatched; each response/notification is emitted as
 * its own newline-terminated line.
 *
 * Returns a handle with a `stop()` that closes the readline loop
 * cleanly. Callers may also simply let the process exit once stdin
 * closes — the handle's `Promise` resolves at that point.
 */
export function startAcpStdio(options: AcpStdioOptions): AcpStdioHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const serverInfo = options.serverInfo ?? { name: "wotann", version: "0.5.0" };

  let rl: ReadlineInterface | undefined;
  let closed = false;

  const write = (frame: string): void => {
    if (closed) return;
    try {
      output.write(frame);
      output.write("\n");
    } catch (err) {
      options.onError?.(err, frame);
    }
  };

  const server = new AcpServer({
    handlers: options.handlers,
    serverInfo,
    emit: write,
  });

  // Announce protocol version banner on a stderr-like channel via the
  // `emit` path isn't appropriate — notifications are reserved for
  // protocol messages. We surface only real ACP frames here. Hosts
  // should call `initialize` as their first request.
  void ACP_PROTOCOL_VERSION;

  rl = createInterface({ input, crlfDelay: Infinity });

  // Serialise request processing so order matches input order — a
  // second message cannot start its handler until the first has
  // resolved. Without this, `initialize` racing with `session/create`
  // + `session/prompt` causes ServerNotInitialized errors on the
  // later frames even though they arrived in the correct order.
  let queue: Promise<unknown> = Promise.resolve();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    queue = queue.then(async () => {
      try {
        const response = await server.handleFrame(trimmed);
        if (response) write(JSON.stringify(response));
      } catch (err) {
        options.onError?.(err, trimmed);
      }
    });
  });

  const closed$ = new Promise<void>((resolve) => {
    rl!.once("close", () => {
      closed = true;
      resolve();
    });
  });

  return {
    server,
    async stop() {
      if (closed) return;
      closed = true;
      rl?.close();
      await closed$;
    },
  };
}

/**
 * Minimal reference handlers — lets callers stand up an ACP server
 * with the spec-required methods even before WotannRuntime is wired.
 * Returns canned responses that satisfy the contract but never stream
 * partials. Intended as a smoke-test / reference implementation.
 */
export function referenceHandlers(): AcpHandlers {
  let counter = 0;
  return {
    async initialize(params) {
      return {
        protocolVersion: params.protocolVersion || ACP_PROTOCOL_VERSION,
        capabilities: { tools: false, prompts: true, sampling: false },
        serverInfo: { name: "wotann-reference", version: "0.0.0" },
      };
    },
    async sessionCreate() {
      counter++;
      return { sessionId: `ref-session-${counter}` };
    },
    async sessionPrompt(params, onPartial, onComplete) {
      onPartial({
        sessionId: params.sessionId,
        kind: "text",
        content: "reference handler reply",
      });
      onComplete({ sessionId: params.sessionId, finishReason: "stop" });
    },
    async sessionCancel() {
      /* noop */
    },
  };
}
