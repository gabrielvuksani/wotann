/**
 * C16 — ACP protocol codec tests.
 */

import { describe, it, expect } from "vitest";
import {
  decodeJsonRpc,
  encodeJsonRpc,
  isDecodedMessage,
  JSON_RPC_ERROR_CODES,
  makeError,
  makeNotification,
  makeRequest,
  makeResponse,
} from "../../src/acp/protocol.js";

describe("decodeJsonRpc", () => {
  it("decodes a request", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "0.2.0" },
    });
    const decoded = decodeJsonRpc(raw);
    expect(isDecodedMessage(decoded)).toBe(true);
    if (isDecodedMessage(decoded)) {
      expect(decoded.kind).toBe("request");
      expect((decoded.message as { method: string }).method).toBe("initialize");
    }
  });

  it("decodes a response", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const decoded = decodeJsonRpc(raw);
    if (isDecodedMessage(decoded)) {
      expect(decoded.kind).toBe("response");
    } else {
      throw new Error("expected decoded message, got error");
    }
  });

  it("decodes a notification (no id)", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", method: "prompt/partial", params: {} });
    const decoded = decodeJsonRpc(raw);
    if (isDecodedMessage(decoded)) {
      expect(decoded.kind).toBe("notification");
    } else {
      throw new Error("expected decoded message");
    }
  });

  it("returns ParseError on malformed JSON", () => {
    const decoded = decodeJsonRpc("{not json");
    if (isDecodedMessage(decoded)) throw new Error("expected error response");
    expect(decoded.error?.code).toBe(JSON_RPC_ERROR_CODES.ParseError);
  });

  it("returns InvalidRequest on missing jsonrpc field", () => {
    const decoded = decodeJsonRpc(JSON.stringify({ id: 1, method: "x" }));
    if (isDecodedMessage(decoded)) throw new Error("expected error response");
    expect(decoded.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidRequest);
  });

  it("returns InvalidRequest on neither result/error nor method", () => {
    const decoded = decodeJsonRpc(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
    if (isDecodedMessage(decoded)) throw new Error("expected error response");
    expect(decoded.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidRequest);
  });

  it("returns InvalidRequest when input is not an object", () => {
    const decoded = decodeJsonRpc(JSON.stringify("just a string"));
    if (isDecodedMessage(decoded)) throw new Error("expected error response");
    expect(decoded.error?.code).toBe(JSON_RPC_ERROR_CODES.InvalidRequest);
  });
});

describe("encode helpers", () => {
  it("makeResponse yields jsonrpc-2.0 shape", () => {
    const r = makeResponse(1, { ok: true });
    expect(r).toMatchObject({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("makeError attaches code + message + optional data", () => {
    const r = makeError(1, -32602, "bad params", { field: "rootUri" });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.data).toEqual({ field: "rootUri" });
  });

  it("makeNotification omits id", () => {
    const n = makeNotification("prompt/partial", { sessionId: "s1" });
    expect(n).toMatchObject({ jsonrpc: "2.0", method: "prompt/partial" });
    expect("id" in n).toBe(false);
  });

  it("makeRequest includes id + method + params", () => {
    const r = makeRequest(7, "initialize", { protocolVersion: "0.2.0" });
    expect(r.id).toBe(7);
    expect(r.method).toBe("initialize");
  });

  it("encodeJsonRpc → decodeJsonRpc round-trips", () => {
    const original = makeRequest(9, "session/prompt", { sessionId: "s1", text: "hi" });
    const encoded = encodeJsonRpc(original);
    const decoded = decodeJsonRpc(encoded);
    if (!isDecodedMessage(decoded)) throw new Error("expected success");
    expect((decoded.message as { id: number }).id).toBe(9);
  });
});
