/**
 * C16 — ACP protocol codec tests (ACP v1).
 *
 * Covers: JSON-RPC codec, version constants, shape helpers, and the
 * new v1 utilities (`flattenPromptText`, `negotiateProtocolVersion`).
 */

import { describe, it, expect } from "vitest";
import {
  ACP_METHODS,
  ACP_PROTOCOL_VERSION,
  ACP_PROTOCOL_VERSION_MAX,
  ACP_PROTOCOL_VERSION_MIN,
  decodeJsonRpc,
  encodeJsonRpc,
  flattenPromptText,
  isDecodedMessage,
  JSON_RPC_ERROR_CODES,
  makeError,
  makeNotification,
  makeRequest,
  makeResponse,
  negotiateProtocolVersion,
  type AcpContentBlock,
} from "../../src/acp/protocol.js";

describe("ACP_PROTOCOL_VERSION", () => {
  it("is an integer matching ACP v1 spec", () => {
    expect(Number.isInteger(ACP_PROTOCOL_VERSION)).toBe(true);
    expect(ACP_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("sits inside the declared uint16 range bounds", () => {
    expect(ACP_PROTOCOL_VERSION).toBeGreaterThanOrEqual(ACP_PROTOCOL_VERSION_MIN);
    expect(ACP_PROTOCOL_VERSION).toBeLessThanOrEqual(ACP_PROTOCOL_VERSION_MAX);
  });
});

describe("ACP_METHODS", () => {
  it("exposes the v1 core methods and WOTANN extensions", () => {
    expect(ACP_METHODS.Initialize).toBe("initialize");
    expect(ACP_METHODS.SessionNew).toBe("session/new");
    expect(ACP_METHODS.SessionPrompt).toBe("session/prompt");
    expect(ACP_METHODS.SessionCancel).toBe("session/cancel");
    expect(ACP_METHODS.SessionUpdate).toBe("session/update");
    expect(ACP_METHODS.ThreadFork).toBe("thread/fork");
  });
});

describe("decodeJsonRpc", () => {
  it("decodes a request", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: ACP_PROTOCOL_VERSION },
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

  it("decodes a session/update notification (no id)", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} });
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
    const r = makeError(1, -32602, "bad params", { field: "cwd" });
    expect(r.error?.code).toBe(-32602);
    expect(r.error?.data).toEqual({ field: "cwd" });
  });

  it("makeError omits data when undefined", () => {
    const r = makeError(1, -32602, "bad params");
    expect(r.error?.code).toBe(-32602);
    expect(r.error && "data" in r.error).toBe(false);
  });

  it("makeNotification omits id", () => {
    const n = makeNotification("session/update", { sessionId: "s1" });
    expect(n).toMatchObject({ jsonrpc: "2.0", method: "session/update" });
    expect("id" in n).toBe(false);
  });

  it("makeRequest includes id + method + params", () => {
    const r = makeRequest(7, "initialize", { protocolVersion: ACP_PROTOCOL_VERSION });
    expect(r.id).toBe(7);
    expect(r.method).toBe("initialize");
  });

  it("encodeJsonRpc -> decodeJsonRpc round-trips", () => {
    const original = makeRequest(9, "session/prompt", {
      sessionId: "s1",
      prompt: [{ type: "text", text: "hi" }],
    });
    const encoded = encodeJsonRpc(original);
    const decoded = decodeJsonRpc(encoded);
    if (!isDecodedMessage(decoded)) throw new Error("expected success");
    expect((decoded.message as { id: number }).id).toBe(9);
  });
});

describe("flattenPromptText", () => {
  it("concatenates text blocks in order", () => {
    const blocks: AcpContentBlock[] = [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ];
    expect(flattenPromptText(blocks)).toBe("Hello world");
  });

  it("substitutes placeholders for non-text blocks", () => {
    const blocks: AcpContentBlock[] = [
      { type: "text", text: "before " },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "text", text: " after" },
    ];
    expect(flattenPromptText(blocks)).toContain("[image:image/png]");
  });

  it("inlines resource text when available", () => {
    const blocks: AcpContentBlock[] = [
      {
        type: "resource",
        resource: { uri: "file:///a.md", mimeType: "text/markdown", text: "doc body" },
      },
    ];
    expect(flattenPromptText(blocks)).toBe("doc body");
  });

  it("falls back to resource URI when no inline text", () => {
    const blocks: AcpContentBlock[] = [
      {
        type: "resource",
        resource: { uri: "file:///a.bin", mimeType: "application/octet-stream" },
      },
    ];
    expect(flattenPromptText(blocks)).toBe("[resource:file:///a.bin]");
  });

  it("tags resource links", () => {
    const blocks: AcpContentBlock[] = [
      { type: "resource_link", uri: "https://example.com" },
    ];
    expect(flattenPromptText(blocks)).toBe("[link:https://example.com]");
  });
});

describe("negotiateProtocolVersion", () => {
  it("returns the client version when it equals LATEST", () => {
    expect(negotiateProtocolVersion(ACP_PROTOCOL_VERSION)).toBe(ACP_PROTOCOL_VERSION);
  });

  it("clamps down to LATEST when the client requests a higher version", () => {
    expect(negotiateProtocolVersion(ACP_PROTOCOL_VERSION + 10)).toBe(ACP_PROTOCOL_VERSION);
  });

  it("accepts older versions unchanged", () => {
    const older = Math.max(0, ACP_PROTOCOL_VERSION - 1);
    expect(negotiateProtocolVersion(older)).toBe(older);
  });

  it("falls back to LATEST for non-integer inputs", () => {
    expect(negotiateProtocolVersion("1.0" as unknown)).toBe(ACP_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(null as unknown)).toBe(ACP_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(1.5 as unknown)).toBe(ACP_PROTOCOL_VERSION);
  });

  it("falls back to LATEST for out-of-range inputs", () => {
    expect(negotiateProtocolVersion(-1)).toBe(ACP_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(ACP_PROTOCOL_VERSION_MAX + 1)).toBe(ACP_PROTOCOL_VERSION);
  });
});
