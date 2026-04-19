/**
 * ACP stdio runtime wrapper (C16 runtime, upgraded to ACP v1).
 *
 * Frames newline-delimited JSON-RPC messages on a duplex stream
 * (stdin/stdout by default) and feeds them to an AcpServer. Mirrors
 * the LSP-style framing most editors already speak, so hosts like
 * Zed, Gemini CLI and Goose can invoke `wotann acp --stdio` and drop
 * straight into a session.
 *
 * Intentionally minimal — no Content-Length framing, one message per
 * line. Matches `agentclientprotocol.com` v1 reference servers.
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { AcpServer, type AcpHandlers, type AcpServerInfo } from "./server.js";
import {
  ACP_PROTOCOL_VERSION,
  type AcpAgentCapabilities,
  type AcpContentBlock,
  type AcpClientProvidedMcp,
  type AcpInitializeParams,
  type AcpInitializeResult,
} from "./protocol.js";

export interface AcpStdioOptions {
  readonly handlers: AcpHandlers;
  readonly serverInfo?: AcpServerInfo;
  readonly input?: Readable;
  readonly output?: Writable;
  readonly onError?: (err: unknown, rawFrame: string | undefined) => void;
  /**
   * Zed 0.3 parity — zero-config MCP inheritance. Called once per
   * initialize with the `clientProvidedMcp` payload (if present). Wire
   * this to your runtime's MCP registry so WOTANN inherits the client
   * editor's MCP servers automatically at handshake time.
   *
   * The callback is awaited BEFORE the initialize response is returned
   * to the client, so the MCP servers are registered before the host
   * issues session/new. Errors thrown from the callback propagate as
   * JSON-RPC InternalError via the dispatcher.
   */
  readonly onClientProvidedMcp?: (mcp: AcpClientProvidedMcp) => void | Promise<void>;
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

  // Wrap the handler's `initialize` so clientProvidedMcp is forwarded to
  // the registration callback before the response goes back to the client.
  // The host relies on the agent having the MCP servers registered BEFORE
  // it issues session/new, so ordering matters: await the callback first,
  // then call the real handler.
  const wrappedHandlers: AcpHandlers = options.onClientProvidedMcp
    ? wrapHandlersWithMcpInheritance(options.handlers, options.onClientProvidedMcp)
    : options.handlers;

  const server = new AcpServer({
    handlers: wrappedHandlers,
    serverInfo,
    emit: write,
  });

  // ACP v1 does not define a hello-banner; hosts drive the handshake
  // by sending `initialize` first. We only emit real protocol frames
  // from the stdio wrapper — `ACP_PROTOCOL_VERSION` is kept visible
  // for callers that want to log it outside the protocol channel.
  void ACP_PROTOCOL_VERSION;

  rl = createInterface({ input, crlfDelay: Infinity });

  // Serialise request processing so order matches input order — a
  // second message cannot start its handler until the first has
  // resolved. Without this, `initialize` racing with `session/new`
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
 * Wrap an AcpHandlers so its `initialize` invokes `onClientProvidedMcp`
 * when the client advertises MCP servers on the handshake. The callback
 * is awaited before the wrapped handler runs so the registration is in
 * place by the time any subsequent session/new arrives.
 *
 * Immutable — returns a new handlers object, never mutates the original.
 */
function wrapHandlersWithMcpInheritance(
  handlers: AcpHandlers,
  onClientProvidedMcp: (mcp: AcpClientProvidedMcp) => void | Promise<void>,
): AcpHandlers {
  return {
    ...handlers,
    async initialize(params: AcpInitializeParams): Promise<AcpInitializeResult> {
      if (params.clientProvidedMcp && Array.isArray(params.clientProvidedMcp.servers)) {
        await onClientProvidedMcp(params.clientProvidedMcp);
      }
      return handlers.initialize(params);
    },
  };
}

/**
 * Minimal reference handlers — lets callers stand up an ACP server
 * with the spec-required methods even before WotannRuntime is wired.
 * Returns canned responses that satisfy the contract but never stream
 * real content. Intended as a smoke-test / reference implementation
 * for Zed, Gemini CLI, Goose hosting sanity checks.
 */
export function referenceHandlers(): AcpHandlers {
  let counter = 0;
  const REFERENCE_CAPABILITIES: AcpAgentCapabilities = {
    loadSession: false,
    promptCapabilities: {
      image: false,
      audio: false,
      embeddedContext: false,
    },
    mcpCapabilities: {
      stdio: true,
      http: false,
      sse: false,
    },
    _meta: {
      // Signal to WOTANN-aware hosts that thread/fork etc. are available.
      "wotann/thread-ops": true,
    },
  };

  return {
    async initialize(params) {
      return {
        // Echo the negotiated version — the dispatcher re-runs the
        // negotiation so handlers can stay naive.
        protocolVersion: params.protocolVersion || ACP_PROTOCOL_VERSION,
        agentCapabilities: REFERENCE_CAPABILITIES,
        agentInfo: { name: "wotann-reference", version: "0.0.0" },
        authMethods: [],
      };
    },
    async sessionNew() {
      counter++;
      return { sessionId: `ref-session-${counter}` };
    },
    async sessionPrompt(params, onUpdate) {
      const block: AcpContentBlock = {
        type: "text",
        text: "reference handler reply",
      };
      onUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: block,
        },
      });
      return { stopReason: "end_turn" };
    },
    async sessionCancel() {
      /* noop */
    },
  };
}
