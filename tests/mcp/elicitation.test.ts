/**
 * V9 T14.1 — MCP Elicitation protocol tests.
 */

import { describe, expect, it } from "vitest";
import {
  buildAcceptResult,
  buildCancelResult,
  buildDeclineResult,
  buildElicitationRequest,
  createElicitationRegistry,
  parseElicitationRequest,
  parseElicitationResult,
  validateContentAgainstSchema,
  type ElicitationHandler,
  type ElicitationRequest,
  type ElicitationSchema,
} from "../../src/mcp/elicitation.js";

// ── Builders ──────────────────────────────────────────────────────────────

describe("buildElicitationRequest", () => {
  it("produces a well-formed request", () => {
    const req = buildElicitationRequest({
      message: "pick a color",
      requestedSchema: { type: "string" },
    });
    expect(req.method).toBe("elicitation/create");
    expect(req.params.message).toBe("pick a color");
  });

  it("rejects empty message", () => {
    expect(() =>
      buildElicitationRequest({ message: "", requestedSchema: {} }),
    ).toThrow(/message/);
    expect(() =>
      buildElicitationRequest({ message: "   ", requestedSchema: {} }),
    ).toThrow(/message/);
  });

  it("rejects non-object schema", () => {
    expect(() =>
      buildElicitationRequest({
        message: "x",
        requestedSchema: null as unknown as ElicitationSchema,
      }),
    ).toThrow(/requestedSchema/);
  });
});

describe("buildAcceptResult / buildDeclineResult / buildCancelResult", () => {
  it("accept carries content", () => {
    const r = buildAcceptResult({ foo: "bar" });
    expect(r.action).toBe("accept");
    expect(r.content).toEqual({ foo: "bar" });
  });

  it("decline / cancel have no content", () => {
    expect(buildDeclineResult().action).toBe("decline");
    expect(buildDeclineResult().content).toBeUndefined();
    expect(buildCancelResult().action).toBe("cancel");
    expect(buildCancelResult().content).toBeUndefined();
  });
});

// ── parseElicitationRequest ──────────────────────────────────────────────

describe("parseElicitationRequest", () => {
  it("parses a canonical request", () => {
    const parsed = parseElicitationRequest({
      method: "elicitation/create",
      params: {
        message: "hi",
        requestedSchema: { type: "object" },
      },
    });
    expect(parsed?.params.message).toBe("hi");
  });

  it("rejects non-object input", () => {
    expect(parseElicitationRequest(null)).toBeNull();
    expect(parseElicitationRequest("string")).toBeNull();
    expect(parseElicitationRequest([])).toBeNull();
  });

  it("rejects unknown methods", () => {
    expect(
      parseElicitationRequest({
        method: "foo/bar",
        params: { message: "x", requestedSchema: {} },
      }),
    ).toBeNull();
  });

  it("rejects missing message", () => {
    expect(
      parseElicitationRequest({
        method: "elicitation/create",
        params: { requestedSchema: {} },
      }),
    ).toBeNull();
  });

  it("rejects non-object requestedSchema", () => {
    expect(
      parseElicitationRequest({
        method: "elicitation/create",
        params: { message: "x", requestedSchema: "not-an-object" },
      }),
    ).toBeNull();
  });
});

// ── parseElicitationResult ───────────────────────────────────────────────

describe("parseElicitationResult", () => {
  it("parses accept with content", () => {
    const r = parseElicitationResult({ action: "accept", content: { a: 1 } });
    expect(r?.action).toBe("accept");
    expect(r?.content).toEqual({ a: 1 });
  });

  it("parses accept without content", () => {
    const r = parseElicitationResult({ action: "accept" });
    expect(r?.action).toBe("accept");
    expect(r?.content).toBeUndefined();
  });

  it("parses decline + cancel (no content)", () => {
    expect(parseElicitationResult({ action: "decline" })?.action).toBe("decline");
    expect(parseElicitationResult({ action: "cancel" })?.action).toBe("cancel");
  });

  it("rejects unknown actions", () => {
    expect(parseElicitationResult({ action: "ok" })).toBeNull();
    expect(parseElicitationResult({ action: 42 })).toBeNull();
  });

  it("rejects non-object content on accept", () => {
    expect(
      parseElicitationResult({ action: "accept", content: "not-an-object" }),
    ).toBeNull();
  });
});

// ── validateContentAgainstSchema ─────────────────────────────────────────

describe("validateContentAgainstSchema", () => {
  it("ok:true when required fields all present + types match", () => {
    const schema: ElicitationSchema = {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    };
    const result = validateContentAgainstSchema(schema, { name: "Gabriel" });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("ok:false when required field missing", () => {
    const schema: ElicitationSchema = {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    };
    const result = validateContentAgainstSchema(schema, {});
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('"name"');
  });

  it("ok:false when type mismatches", () => {
    const schema: ElicitationSchema = {
      properties: { age: { type: "number" } },
    };
    const result = validateContentAgainstSchema(schema, { age: "thirty" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("expected number");
  });

  it("accepts integer as number", () => {
    const schema: ElicitationSchema = {
      properties: { age: { type: "integer" } },
    };
    const result = validateContentAgainstSchema(schema, { age: 30 });
    expect(result.ok).toBe(true);
  });

  it("rejects NaN as number (finite check)", () => {
    const schema: ElicitationSchema = {
      properties: { age: { type: "number" } },
    };
    const result = validateContentAgainstSchema(schema, { age: NaN });
    expect(result.ok).toBe(false);
  });

  it("boolean/array/object/null types supported", () => {
    const schema: ElicitationSchema = {
      properties: {
        b: { type: "boolean" },
        a: { type: "array" },
        o: { type: "object" },
        n: { type: "null" },
      },
    };
    const result = validateContentAgainstSchema(schema, {
      b: true,
      a: [],
      o: {},
      n: null,
    });
    expect(result.ok).toBe(true);
  });

  it("unknown type passes through (lenient — full validator is the caller's job)", () => {
    const schema: ElicitationSchema = {
      properties: { weird: { type: "some-future-kind" } },
    };
    const result = validateContentAgainstSchema(schema, { weird: { any: "thing" } });
    expect(result.ok).toBe(true);
  });
});

// ── createElicitationRegistry ────────────────────────────────────────────

describe("createElicitationRegistry", () => {
  const request: ElicitationRequest = {
    method: "elicitation/create",
    params: { message: "hi", requestedSchema: { type: "object" } },
  };

  it("starts empty (no handler)", async () => {
    const reg = createElicitationRegistry();
    expect(reg.count()).toBe(0);
    const result = await reg.handle(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-handler");
  });

  it("registered handler is invoked", async () => {
    const reg = createElicitationRegistry();
    const handler: ElicitationHandler = async () =>
      buildAcceptResult({ picked: "blue" });
    reg.register(handler);
    expect(reg.count()).toBe(1);
    const result = await reg.handle(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.action).toBe("accept");
      expect(result.result.content).toEqual({ picked: "blue" });
    }
  });

  it("register returns a dispose function", async () => {
    const reg = createElicitationRegistry();
    const dispose = reg.register(async () => buildAcceptResult({}));
    expect(reg.count()).toBe(1);
    dispose();
    expect(reg.count()).toBe(0);
  });

  it("dispose is a no-op after another register replaces the handler", async () => {
    const reg = createElicitationRegistry();
    const disposeA = reg.register(async () => buildAcceptResult({ a: true }));
    reg.register(async () => buildAcceptResult({ b: true })); // replaces
    disposeA(); // stale dispose — should NOT clear the new handler
    expect(reg.count()).toBe(1);
    const result = await reg.handle(request);
    if (result.ok) {
      expect(result.result.content).toEqual({ b: true });
    } else {
      throw new Error("expected ok=true");
    }
  });

  it("handler throw surfaces as handler-threw (never propagates)", async () => {
    const reg = createElicitationRegistry();
    reg.register(async () => {
      throw new Error("boom");
    });
    const result = await reg.handle(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("handler-threw");
      expect(result.error).toContain("boom");
    }
  });

  it("two independent registries don't share state", async () => {
    const a = createElicitationRegistry();
    const b = createElicitationRegistry();
    a.register(async () => buildAcceptResult({ from: "a" }));
    const resultB = await b.handle(request);
    expect(resultB.ok).toBe(false);
  });
});
