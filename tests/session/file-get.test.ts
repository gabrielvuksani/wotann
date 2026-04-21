/**
 * Phase 3 P1-F7 — FileGetHandler + file.get RPC tests.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-F7, the
 * handler + RPC must:
 *
 *   - Serve arbitrary workspace files (vs F5's session-scoped creations).
 *   - Support HTTP-style range requests for iOS ShareLink progress bars.
 *   - Refuse path-traversal and symlink-escape attempts.
 *   - Refuse binary bytes on the wire unless asBase64:true.
 *   - Refuse full-file reads > 50MB so a phone cannot OOM the daemon.
 *
 * Store/handler-level tests cover the serve() method directly; RPC
 * tests exercise the `file.get` wiring via KairosRPCHandler.
 *
 * Uses a per-test tmp rootDir so tests run parallel-safe and clean CI
 * stays deterministic (QB #12 — no wall-clock or shared-fs coupling).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileGetHandler,
  ErrorFileNotFound,
  ErrorPathTraversal,
  ErrorSymlinkEscape,
  ErrorBinaryNotAsciiSafe,
  ErrorFileTooLarge,
  ErrorRangeUnsatisfiable,
  ErrorInvalidPath,
  inferContentType,
  isAsciiSafe,
  isTextContentType,
} from "../../src/session/file-get-handler.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";

// ── Helpers ────────────────────────────────────────────────

function makeTmpRoot(): string {
  // Resolve realpath on macOS, where /var -> /private/var — otherwise
  // symlink-escape checks rightly catch the tmp dir itself.
  return realpathSync(mkdtempSync(join(tmpdir(), "wotann-file-get-test-")));
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

async function rpc(
  handler: KairosRPCHandler,
  method: string,
  params: unknown,
): Promise<RPCResponse> {
  return (await handler.handleMessage(
    JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  )) as RPCResponse;
}

// ── Handler-level: content-type + sniffing helpers ─────────

describe("FileGetHandler — helpers", () => {
  it("inferContentType maps common extensions", () => {
    expect(inferContentType("foo.md")).toBe("text/markdown");
    expect(inferContentType("README.TXT")).toBe("text/plain");
    expect(inferContentType("a.json")).toBe("application/json");
    expect(inferContentType("img.png")).toBe("image/png");
    expect(inferContentType("doc.pdf")).toBe("application/pdf");
    expect(inferContentType("unknown.xyz")).toBe("application/octet-stream");
  });

  it("isTextContentType recognises text-like types", () => {
    expect(isTextContentType("text/markdown")).toBe(true);
    expect(isTextContentType("application/json")).toBe(true);
    expect(isTextContentType("application/javascript")).toBe(true);
    expect(isTextContentType("image/png")).toBe(false);
    expect(isTextContentType("application/pdf")).toBe(false);
    expect(isTextContentType("application/octet-stream")).toBe(false);
  });

  it("isAsciiSafe returns true for plain text", () => {
    expect(isAsciiSafe(Buffer.from("hello\nworld"))).toBe(true);
    expect(isAsciiSafe(Buffer.from(""))).toBe(true);
    expect(isAsciiSafe(Buffer.from("tabs\there"))).toBe(true);
  });

  it("isAsciiSafe returns false for NUL or binary-heavy buffers", () => {
    expect(isAsciiSafe(Buffer.from([0x00, 0x01, 0x02]))).toBe(false);
    // PNG signature
    expect(
      isAsciiSafe(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe(false);
  });
});

// ── Handler-level: full-file reads ─────────────────────────

describe("FileGetHandler — full-file get", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpRoot();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("full-file get returns content + sha256 + contentType", () => {
    writeFileSync(join(root, "note.md"), "# hello world");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({ requestedPath: "note.md" });
    expect(res.content).toBe("# hello world");
    expect(res.encoding).toBe("utf-8");
    expect(res.contentType).toBe("text/markdown");
    expect(res.total).toBe(13);
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.contentRange).toBeUndefined();
  });

  it("zero-byte file returns total=0, empty content", () => {
    writeFileSync(join(root, "empty.txt"), "");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({ requestedPath: "empty.txt" });
    expect(res.total).toBe(0);
    expect(res.content).toBe("");
    expect(res.contentType).toBe("text/plain");
  });

  it("file-not-found throws ErrorFileNotFound (not generic)", () => {
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "nope.md" })).toThrow(
      ErrorFileNotFound,
    );
  });

  it("empty path rejected via ErrorInvalidPath", () => {
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "" })).toThrow(ErrorInvalidPath);
  });

  it("NUL in path rejected via ErrorInvalidPath", () => {
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "a\0b.md" })).toThrow(
      ErrorInvalidPath,
    );
  });

  it("large file > maxBytesWithoutRange without range throws ErrorFileTooLarge", () => {
    writeFileSync(join(root, "big.txt"), "x".repeat(1000));
    const handler = new FileGetHandler({
      rootDir: root,
      maxBytesWithoutRange: 100,
    });
    expect(() => handler.serve({ requestedPath: "big.txt" })).toThrow(
      ErrorFileTooLarge,
    );
  });

  it("large file WITH range succeeds despite ceiling", () => {
    writeFileSync(join(root, "big.txt"), "x".repeat(1000));
    const handler = new FileGetHandler({
      rootDir: root,
      maxBytesWithoutRange: 100,
    });
    const res = handler.serve({
      requestedPath: "big.txt",
      range: { start: 0, end: 9 },
    });
    expect(res.content).toBe("xxxxxxxxxx");
    expect(res.total).toBe(1000);
    expect(res.contentRange).toBe("bytes 0-9/1000");
  });
});

// ── Handler-level: range requests ──────────────────────────

describe("FileGetHandler — range requests", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpRoot();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("range-get returns partial content + contentRange header", () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({
      requestedPath: "letters.txt",
      range: { start: 2, end: 5 },
    });
    expect(res.content).toBe("cdef");
    expect(res.total).toBe(10);
    expect(res.contentRange).toBe("bytes 2-5/10");
    // sha256 is over the RETURNED bytes, not the full file — so two
    // chunks hashed independently each verify themselves.
    const sha = res.sha256;
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("range without end defaults to EOF", () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({
      requestedPath: "letters.txt",
      range: { start: 7 },
    });
    expect(res.content).toBe("hij");
    expect(res.contentRange).toBe("bytes 7-9/10");
  });

  it("range end > total clamps to EOF (HTTP parity)", () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({
      requestedPath: "letters.txt",
      range: { start: 5, end: 9999 },
    });
    expect(res.content).toBe("fghij");
    expect(res.contentRange).toBe("bytes 5-9/10");
  });

  it("range start >= total throws ErrorRangeUnsatisfiable", () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    expect(() =>
      handler.serve({ requestedPath: "letters.txt", range: { start: 10 } }),
    ).toThrow(ErrorRangeUnsatisfiable);
  });

  it("range end < start throws ErrorRangeUnsatisfiable", () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    expect(() =>
      handler.serve({
        requestedPath: "letters.txt",
        range: { start: 5, end: 2 },
      }),
    ).toThrow(ErrorRangeUnsatisfiable);
  });

  it("range start negative throws ErrorRangeUnsatisfiable", () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    expect(() =>
      handler.serve({ requestedPath: "letters.txt", range: { start: -1 } }),
    ).toThrow(ErrorRangeUnsatisfiable);
  });

  it("range span > maxBytesPerRange throws ErrorRangeUnsatisfiable", () => {
    writeFileSync(join(root, "big.txt"), "x".repeat(1000));
    const handler = new FileGetHandler({
      rootDir: root,
      maxBytesWithoutRange: 10_000,
      maxBytesPerRange: 100,
    });
    expect(() =>
      handler.serve({
        requestedPath: "big.txt",
        range: { start: 0, end: 999 },
      }),
    ).toThrow(ErrorRangeUnsatisfiable);
  });

  it("two consecutive ranges reconstruct the full file", () => {
    writeFileSync(join(root, "split.txt"), "abcdefghij");
    const handler = new FileGetHandler({ rootDir: root });
    const part1 = handler.serve({
      requestedPath: "split.txt",
      range: { start: 0, end: 4 },
    });
    const part2 = handler.serve({
      requestedPath: "split.txt",
      range: { start: 5 },
    });
    expect(part1.content + part2.content).toBe("abcdefghij");
    expect(part1.total).toBe(10);
    expect(part2.total).toBe(10);
  });
});

// ── Handler-level: security guards ─────────────────────────

describe("FileGetHandler — security", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpRoot();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("path traversal via ../ rejected", () => {
    writeFileSync(join(root, "inside.md"), "ok");
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "../outside.md" })).toThrow(
      ErrorPathTraversal,
    );
  });

  it("absolute path outside workspace rejected", () => {
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "/etc/passwd" })).toThrow(
      ErrorPathTraversal,
    );
  });

  it("path that matches rootDir prefix but isn't inside rejected", () => {
    // Sibling dir whose name starts with rootDir's basename — e.g.
    // `/tmp/wotann-file-get-test-ABC-secret/x` vs
    // `/tmp/wotann-file-get-test-ABC/`. resolvePath would allow the
    // prefix match without our trailing-separator guard.
    const handler = new FileGetHandler({ rootDir: root });
    const siblingSecret = `${root}-secret`;
    expect(() =>
      handler.serve({ requestedPath: siblingSecret + "/foo" }),
    ).toThrow(ErrorPathTraversal);
  });

  it("symlink whose target lives OUTSIDE workspace rejected", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "wotann-outside-")));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret data");
      symlinkSync(join(outside, "secret.txt"), join(root, "evil-link"));
      const handler = new FileGetHandler({ rootDir: root });
      expect(() => handler.serve({ requestedPath: "evil-link" })).toThrow(
        ErrorSymlinkEscape,
      );
    } finally {
      cleanup(outside);
    }
  });

  it("symlink whose target stays inside workspace is allowed", () => {
    writeFileSync(join(root, "target.md"), "in-workspace");
    symlinkSync(join(root, "target.md"), join(root, "inner-link"));
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({ requestedPath: "inner-link" });
    expect(res.content).toBe("in-workspace");
  });

  it("degenerate workspace root ('/') rejected via ErrorInvalidPath", () => {
    const handler = new FileGetHandler({ rootDir: "/" });
    expect(() => handler.serve({ requestedPath: "etc/passwd" })).toThrow(
      ErrorInvalidPath,
    );
  });

  it("non-file entries (directories) return ErrorFileNotFound", () => {
    mkdirSync(join(root, "subdir"));
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "subdir" })).toThrow(
      ErrorFileNotFound,
    );
  });
});

// ── Handler-level: binary / encoding ───────────────────────

describe("FileGetHandler — binary encoding", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpRoot();
  });
  afterEach(() => {
    cleanup(root);
  });

  it("binary file without asBase64 throws ErrorBinaryNotAsciiSafe", () => {
    // PNG signature — clearly binary.
    writeFileSync(
      join(root, "pic.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const handler = new FileGetHandler({ rootDir: root });
    expect(() => handler.serve({ requestedPath: "pic.png" })).toThrow(
      ErrorBinaryNotAsciiSafe,
    );
  });

  it("binary file WITH asBase64:true returns base64 content", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(root, "pic.png"), bytes);
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({ requestedPath: "pic.png", asBase64: true });
    expect(res.encoding).toBe("base64");
    expect(res.contentType).toBe("image/png");
    expect(Buffer.from(res.content, "base64").equals(bytes)).toBe(true);
  });

  it("unknown-extension file with text content is served as UTF-8", () => {
    writeFileSync(join(root, "note.xyz"), "plain text\nonly\n");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({ requestedPath: "note.xyz" });
    // contentType starts as application/octet-stream from extension
    // but sniffing upgrades it to text/plain.
    expect(res.contentType).toBe("text/plain");
    expect(res.content).toBe("plain text\nonly\n");
  });

  it("text file with asBase64:true still works (caller choice)", () => {
    writeFileSync(join(root, "note.md"), "hello");
    const handler = new FileGetHandler({ rootDir: root });
    const res = handler.serve({ requestedPath: "note.md", asBase64: true });
    expect(res.encoding).toBe("base64");
    expect(Buffer.from(res.content, "base64").toString("utf-8")).toBe("hello");
  });
});

// ── RPC-level tests ────────────────────────────────────────

describe("file.get RPC — KairosRPCHandler wiring", () => {
  let root: string;
  let handler: KairosRPCHandler;
  beforeEach(() => {
    root = makeTmpRoot();
    handler = new KairosRPCHandler();
    // Override the working-dir accessor. setRuntime is the real pathway
    // but creating a full runtime in unit tests is overkill — we swap
    // the internal file-get handler via the test-visibility setter.
    handler.setFileGetHandlerForTest(
      new FileGetHandler({ rootDir: root }),
    );
  });
  afterEach(() => {
    cleanup(root);
  });

  it("file.get round-trip (utf8 default)", async () => {
    writeFileSync(join(root, "note.md"), "hello world");
    const res = await rpc(handler, "file.get", { path: "note.md" });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: string;
      encoding: string;
      contentType: string;
      total: number;
      sha256: string;
    };
    expect(result.content).toBe("hello world");
    expect(result.encoding).toBe("utf-8");
    expect(result.contentType).toBe("text/markdown");
    expect(result.total).toBe(11);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("file.get range round-trip returns contentRange", async () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const res = await rpc(handler, "file.get", {
      path: "letters.txt",
      range: { start: 2, end: 5 },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: string;
      contentRange: string;
      total: number;
    };
    expect(result.content).toBe("cdef");
    expect(result.contentRange).toBe("bytes 2-5/10");
    expect(result.total).toBe(10);
  });

  it("file.get with asBase64:true returns base64-encoded binary", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    writeFileSync(join(root, "pic.png"), bytes);
    const res = await rpc(handler, "file.get", {
      path: "pic.png",
      asBase64: true,
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { content: string; encoding: string };
    expect(result.encoding).toBe("base64");
    expect(Buffer.from(result.content, "base64").equals(bytes)).toBe(true);
  });

  it("file.get missing file surfaces ErrorFileNotFound as JSON-RPC error", async () => {
    const res = await rpc(handler, "file.get", { path: "nope.md" });
    expect(res.error).toBeDefined();
    expect(res.result).toBeUndefined();
  });

  it("file.get binary without asBase64 surfaces ErrorBinaryNotAsciiSafe", async () => {
    writeFileSync(
      join(root, "pic.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const res = await rpc(handler, "file.get", { path: "pic.png" });
    expect(res.error).toBeDefined();
    expect(res.result).toBeUndefined();
  });

  it("file.get path traversal surfaces ErrorPathTraversal", async () => {
    const res = await rpc(handler, "file.get", { path: "../secret" });
    expect(res.error).toBeDefined();
    expect(res.result).toBeUndefined();
  });

  it("file.get invalid range surfaces ErrorRangeUnsatisfiable", async () => {
    writeFileSync(join(root, "small.txt"), "abc");
    const res = await rpc(handler, "file.get", {
      path: "small.txt",
      range: { start: 10 },
    });
    expect(res.error).toBeDefined();
  });

  it("file.get with no file-get handler configured surfaces an error", async () => {
    const bare = new KairosRPCHandler();
    // No setFileGetHandlerForTest call — the default should be null
    // until setRuntime wires it, but an RPC handler serving no runtime
    // should still refuse cleanly rather than leak paths.
    const res = await rpc(bare, "file.get", { path: "foo.md" });
    expect(res.error).toBeDefined();
  });

  it("file.get with empty path surfaces an error", async () => {
    const res = await rpc(handler, "file.get", { path: "" });
    expect(res.error).toBeDefined();
  });

  it("file.get missing params surfaces an error", async () => {
    const res = await rpc(handler, "file.get", {});
    expect(res.error).toBeDefined();
  });

  it("file.get sha256 differs between two disjoint ranges", async () => {
    writeFileSync(join(root, "letters.txt"), "abcdefghij");
    const r1 = await rpc(handler, "file.get", {
      path: "letters.txt",
      range: { start: 0, end: 4 },
    });
    const r2 = await rpc(handler, "file.get", {
      path: "letters.txt",
      range: { start: 5 },
    });
    expect((r1.result as { sha256: string }).sha256).not.toBe(
      (r2.result as { sha256: string }).sha256,
    );
  });
});
