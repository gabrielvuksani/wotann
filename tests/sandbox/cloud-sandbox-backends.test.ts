/**
 * Tests for V9 T12.16 cloud-sandbox backends (Modal + Fly.io).
 */

import { describe, it, expect, vi } from "vitest";
import { createModalSandbox } from "../../src/sandbox/modal-backend.js";
import { createFlyIoSandbox } from "../../src/sandbox/flyio-backend.js";

function makeFetcher(opts: {
  status: number;
  body: unknown;
  bodyText?: string;
}): typeof fetch {
  return vi.fn(async () => ({
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    text: async () => opts.bodyText ?? JSON.stringify(opts.body),
    json: async () => opts.body,
  })) as unknown as typeof fetch;
}

describe("createModalSandbox", () => {
  it("rejects missing apiKey", () => {
    expect(() =>
      // @ts-expect-error — invalid config
      createModalSandbox({}),
    ).toThrow(/apiKey/);
  });

  it("returns ok result on 200 + exit 0", async () => {
    const fetcher = makeFetcher({
      status: 200,
      body: { stdout: "hello\n", stderr: "", exit_code: 0, duration_ms: 1234 },
    });
    const sb = createModalSandbox({ apiKey: "test", fetcher });
    const r = await sb.run({ image: "alpine:3", command: "echo hello" });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("hello\n");
    expect(r.exitCode).toBe(0);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("returns failure on 4xx", async () => {
    const fetcher = makeFetcher({ status: 401, body: {}, bodyText: "unauthorized" });
    const sb = createModalSandbox({ apiKey: "bad", fetcher });
    const r = await sb.run({ image: "alpine:3", command: "ls" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("modal-http-401");
  });

  it("rejects empty image", async () => {
    const fetcher = makeFetcher({ status: 200, body: {} });
    const sb = createModalSandbox({ apiKey: "k", fetcher });
    // @ts-expect-error — invalid input
    const r = await sb.run({ image: "", command: "ls" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("image required");
  });

  it("probe returns true on 200", async () => {
    const fetcher = makeFetcher({ status: 200, body: { ok: true } });
    const sb = createModalSandbox({ apiKey: "k", fetcher });
    expect(await sb.probe()).toBe(true);
  });

  it("probe returns false when fetcher throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const sb = createModalSandbox({ apiKey: "k", fetcher });
    expect(await sb.probe()).toBe(false);
  });
});

describe("createFlyIoSandbox", () => {
  it("rejects missing apiKey", () => {
    expect(() =>
      // @ts-expect-error — invalid
      createFlyIoSandbox({ providerOpts: { app: "x" } }),
    ).toThrow(/apiKey/);
  });

  it("rejects missing app", () => {
    expect(() =>
      createFlyIoSandbox({ apiKey: "tok", providerOpts: {} }),
    ).toThrow(/app required/);
  });

  it("returns ok on stopped machine with exit 0", async () => {
    const fetcher = makeFetcher({
      status: 200,
      body: { stdout: "done\n", stderr: "", exit_code: 0, state: "stopped" },
    });
    const sb = createFlyIoSandbox({
      apiKey: "tok",
      providerOpts: { app: "test-app" },
      fetcher,
    });
    const r = await sb.run({ image: "alpine:3", command: "echo done" });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("done\n");
  });

  it("returns failure on 5xx", async () => {
    const fetcher = makeFetcher({ status: 500, body: {}, bodyText: "internal" });
    const sb = createFlyIoSandbox({
      apiKey: "tok",
      providerOpts: { app: "test-app" },
      fetcher,
    });
    const r = await sb.run({ image: "alpine:3", command: "ls" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("flyio-http-500");
  });

  it("rejects empty command", async () => {
    const fetcher = makeFetcher({ status: 200, body: {} });
    const sb = createFlyIoSandbox({
      apiKey: "tok",
      providerOpts: { app: "test-app" },
      fetcher,
    });
    // @ts-expect-error — invalid
    const r = await sb.run({ image: "alpine:3", command: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("command required");
  });

  it("probe returns false on network error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("dns fail");
    }) as unknown as typeof fetch;
    const sb = createFlyIoSandbox({
      apiKey: "tok",
      providerOpts: { app: "test-app" },
      fetcher,
    });
    expect(await sb.probe()).toBe(false);
  });
});
