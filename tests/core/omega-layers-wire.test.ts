/**
 * Wire-invocation tests for Tier-D1 OMEGA 3-layer memory facade.
 *
 * Before this wire, `createOmegaLayers()` was library-only — no caller
 * in the runtime actually constructed the facade. The summary-first
 * retrieval mode commented about needing `ctx.summaries` built from
 * `createOmegaLayers(store)` but nothing wired it up.
 *
 * These tests prove the gated getter `WotannRuntime.getOmegaLayers()`:
 *   - returns null when the gate is off (config + env both disabled)
 *   - returns null when the gate is on but memoryStore is absent
 *     (the facade is a view over the store; can't exist without one)
 *   - returns an OmegaLayers instance with layer1/layer2/layer3 when
 *     both gate and store are present, and memoization keeps the
 *     instance stable across calls
 *
 * The layer-level semantics (append/query/compress) are tested in
 * tests/memory/omega-layers.test.ts. These tests only prove the wire.
 */

import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WotannRuntime } from "../../src/core/runtime.js";

describe("Tier-D1 OMEGA wire", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-omega-wire-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });
    // Neutralize any ambient env so individual tests control the gate
    // explicitly — otherwise a stale WOTANN_OMEGA_LAYERS=1 in the
    // shell leaks into "off" expectations.
    vi.stubEnv("WOTANN_OMEGA_LAYERS", "");
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns non-null when config omitted (V9 T2.3 default-ON semantic)", () => {
    // V9 T2.3 flipped OMEGA from opt-in (`=== true || env === "1"`) to
    // opt-out (`!== false && env !== "0"`). Previously this test
    // asserted null — now the default is ON unless explicitly disabled.
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: true,
      hookProfile: "standard",
      // enableOmegaLayers omitted → default-ON per V9 T2.3
    });
    expect(runtime.getOmegaLayers()).not.toBeNull();
    runtime.close();
  });

  it("returns null when env=0 explicitly disables the gate", () => {
    vi.stubEnv("WOTANN_OMEGA_LAYERS", "0");
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: true,
      hookProfile: "standard",
    });
    expect(runtime.getOmegaLayers()).toBeNull();
    runtime.close();
  });

  it("returns null when memoryStore is absent (even if gate is on)", () => {
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: false, // → memoryStore === null
      hookProfile: "standard",
      enableOmegaLayers: true,
    });
    expect(runtime.getOmegaLayers()).toBeNull();
    runtime.close();
  });

  it("constructs an OmegaLayers instance when gate + store present", () => {
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: true,
      hookProfile: "standard",
      enableOmegaLayers: true,
    });
    const layers = runtime.getOmegaLayers();
    expect(layers).not.toBeNull();
    if (!layers) return;
    // Facade exposes three layers — proves createOmegaLayers ran and
    // the L3 DDL is in place (the factory throws if the table name is
    // invalid or the store lacks a db handle).
    expect(layers.layer1).toBeDefined();
    expect(layers.layer2).toBeDefined();
    expect(layers.layer3).toBeDefined();
    runtime.close();
  });

  it("memoizes the facade across getter calls", () => {
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: true,
      hookProfile: "standard",
      enableOmegaLayers: true,
    });
    const a = runtime.getOmegaLayers();
    const b = runtime.getOmegaLayers();
    expect(a).not.toBeNull();
    expect(a).toBe(b); // Same reference — not reconstructed every call.
    runtime.close();
  });

  it("env variable WOTANN_OMEGA_LAYERS=1 enables the gate", () => {
    vi.stubEnv("WOTANN_OMEGA_LAYERS", "1");
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: true,
      hookProfile: "standard",
      // Config flag undefined → env fallback applies
    });
    expect(runtime.getOmegaLayers()).not.toBeNull();
    runtime.close();
  });

  it("config.enableOmegaLayers=false overrides env even when env is on", () => {
    vi.stubEnv("WOTANN_OMEGA_LAYERS", "1");
    const runtime = new WotannRuntime({
      workingDir: tempDir,
      enableMemory: true,
      hookProfile: "standard",
      enableOmegaLayers: false, // explicit off wins
    });
    expect(runtime.getOmegaLayers()).toBeNull();
    runtime.close();
  });
});
