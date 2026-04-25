/**
 * Daemon transport — public barrel.
 *
 * Re-exports the WebSocket replay primitives so callers can import a
 * single path:
 *
 *   import { createReplayRegistry, ReplayBuffer } from "../transport/index.js";
 *
 * The registry layer ({@link createReplayRegistry}) is the canonical
 * wiring point — emit sites call `registry.append(sessionId, payload)`
 * on every outgoing frame, reconnect logic calls
 * `registry.getReplayBuffer(sessionId).since(lastSeq)` to drain missed
 * frames.
 */

export {
  DEFAULT_CAPACITY,
  ReplayBuffer,
  type ReplayBufferOptions,
  type ReplayOk,
  type ReplayResult,
  type ReplayStale,
  type WsEvent,
} from "./replay-buffer.js";

export {
  createReplayRegistry,
  type AppendErrorReason,
  type AppendFail,
  type AppendOk,
  type AppendResult,
  type DeregisterFn,
  type RegisterOptions,
  type ReplayRegistry,
  type ReplayRegistryOptions,
} from "./replay-registry.js";
