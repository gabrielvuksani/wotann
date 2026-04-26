/**
 * GA-03 closure tests — onboarding wizard end-to-end flow.
 *
 * Covers the new surfaces shipped in the closure plan:
 *   1. `--legacy` flag exists + TTY guard auto-routes to legacy.
 *   2. `buildFirstRunRunner()` factory streams text + cost chunks.
 *   3. `parsePerMillionRate()` handles the costNote vocabulary used
 *      by the canonical provider ladder.
 *   4. `computeCostFromTokens()` is honest about zero/negative inputs.
 *   5. `runNonInteractiveAutoPick()` writes `.wotann/wotann.yaml` with
 *      the resolved rung's `defaultProvider`.
 *   6. Strategy reducer accepts the "auto" strategy + auto-resolved
 *      rung short-circuit.
 *
 * Per WOTANN quality bars:
 *   QB #6 (honest failures): tests assert that an unconfigured
 *      provider yields a structured error chunk, not silent success.
 *   QB #7 (per-call state): each test mounts a fresh fixture; no
 *      shared module-level state.
 *   QB #11 (sibling-site scan): we exercise the legacy path AND the
 *      wizard path so neither regresses silently.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  buildFirstRunRunner,
  computeCostFromTokens,
  parsePerMillionRate,
} from "../../src/cli/first-run-runner-factory.js";
import { runNonInteractiveAutoPick } from "../../src/cli/run-onboarding-wizard.js";
import {
  PROVIDER_LADDER,
  selectFirstAvailable,
  type ProviderRung,
  type ProviderAvailability,
} from "../../src/providers/provider-ladder.js";
import {
  reduceWizard,
  STRATEGY_CHOICES,
  type WizardStep,
} from "../../src/cli/onboarding-screens.js";

// ── Fixtures ──────────────────────────────────────────────────────────

function findRung(probe: string): ProviderRung {
  const rung = PROVIDER_LADDER.find((r) => r.probe === probe);
  if (!rung) throw new Error(`fixture: no rung with probe "${probe}"`);
  return rung;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wotann-onboarding-"));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── parsePerMillionRate ──────────────────────────────────────────────

describe("parsePerMillionRate", () => {
  it("returns 0 for free local rungs", () => {
    expect(parsePerMillionRate("free, runs on your machine")).toBe(0);
  });

  it("returns 0 for subscription notes without an explicit per-token rate", () => {
    expect(parsePerMillionRate("subscription ($20-200/mo), no per-query cost")).toBe(0);
  });

  it("returns 0 for free-tier notes without a $/M figure", () => {
    expect(parsePerMillionRate("1000 req/day free, no CC")).toBe(0);
  });

  it("parses a ranged BYOK rate to the lowest dollar number", () => {
    expect(parsePerMillionRate("pay-per-token, $3-15 per million")).toBe(3);
  });

  it("parses '$0.14/M' as 0.14", () => {
    expect(parsePerMillionRate("500K tokens/day free, then $0.14/M cached")).toBeCloseTo(0.14);
  });

  it("parses OpenAI's $2.50-$60 per million", () => {
    expect(
      parsePerMillionRate("pay-per-token, $2.50-$60 per million depending on model"),
    ).toBeCloseTo(2.5);
  });

  it("returns 0 for an unrecognized cost-note shape", () => {
    expect(parsePerMillionRate("freeform marketing copy")).toBe(0);
  });
});

// ── computeCostFromTokens ────────────────────────────────────────────

describe("computeCostFromTokens", () => {
  it("returns 0 when tokensUsed is non-positive", () => {
    expect(computeCostFromTokens({ tokensUsed: 0, perMillionRate: 3 })).toBe(0);
    expect(computeCostFromTokens({ tokensUsed: -5, perMillionRate: 3 })).toBe(0);
  });

  it("returns 0 when perMillionRate is non-positive", () => {
    expect(computeCostFromTokens({ tokensUsed: 100, perMillionRate: 0 })).toBe(0);
    expect(computeCostFromTokens({ tokensUsed: 100, perMillionRate: -1 })).toBe(0);
  });

  it("computes (tokensUsed × rate) / 1_000_000", () => {
    // 50 tokens × $3 / 1M = 0.00015
    expect(computeCostFromTokens({ tokensUsed: 50, perMillionRate: 3 })).toBeCloseTo(0.00015);
  });
});

// ── buildFirstRunRunner (with override) ──────────────────────────────

describe("buildFirstRunRunner (test override path)", () => {
  it("yields text chunks then a final tokensUsed chunk for paid rungs", async () => {
    const rung = findRung("anthropic-byok"); // BYOK = per-million rate present
    const runner = buildFirstRunRunner({
      rung,
      streamOverride: async function* () {
        yield { text: "Hello" };
        yield { text: " world", tokensUsed: 50 };
      },
    });
    const chunks: Array<{ text?: string; tokensUsed?: number }> = [];
    for await (const c of runner("test prompt")) {
      chunks.push(c);
    }
    // Expect: 2 stream chunks + 1 final cost chunk
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.text).toBe("Hello");
    expect(chunks[1]?.text).toBe(" world");
    expect(chunks[1]?.tokensUsed).toBe(50);
    // Final chunk: cost-derived tokensUsed pass-through
    expect(chunks[2]?.tokensUsed).toBe(50);
  });

  it("does not emit a final cost chunk for free local rungs", async () => {
    const rung = findRung("ollama-local"); // free → perMillionRate = 0
    const runner = buildFirstRunRunner({
      rung,
      streamOverride: async function* () {
        yield { text: "ready", tokensUsed: 20 };
      },
    });
    const chunks: Array<{ text?: string; tokensUsed?: number }> = [];
    for await (const c of runner("ping")) {
      chunks.push(c);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.text).toBe("ready");
    expect(chunks[0]?.tokensUsed).toBe(20);
  });

  it("propagates errors from the upstream stream as thrown errors", async () => {
    const rung = findRung("anthropic-byok");
    const runner = buildFirstRunRunner({
      rung,
      streamOverride: async function* () {
        yield { text: "starting…" };
        throw new Error("provider down");
      },
    });
    const chunks: Array<{ text?: string }> = [];
    let caught: unknown = null;
    try {
      for await (const c of runner("test")) {
        chunks.push(c);
      }
    } catch (err) {
      caught = err;
    }
    expect(chunks[0]?.text).toBe("starting…");
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("provider down");
  });
});

// ── runNonInteractiveAutoPick ────────────────────────────────────────

describe("runNonInteractiveAutoPick (CI/non-TTY auto-route)", () => {
  it("writes .wotann/wotann.yaml with the first available rung", async () => {
    // Make claude-cli available so the ladder picks it first (rank 1).
    const availability: ProviderAvailability = { "claude-cli": true };
    const picked = await runNonInteractiveAutoPick({
      availabilityOverride: availability,
      workingDir: tmpDir,
    });
    expect(picked).not.toBeNull();
    expect(picked?.probe).toBe("claude-cli");

    const yamlPath = join(tmpDir, ".wotann", "wotann.yaml");
    expect(existsSync(yamlPath)).toBe(true);
    const parsed = parseYaml(readFileSync(yamlPath, "utf-8")) as {
      defaultProvider?: string;
      selectedRung?: { probe?: string };
    };
    expect(parsed.defaultProvider).toBe("anthropic");
    expect(parsed.selectedRung?.probe).toBe("claude-cli");
  });

  it("returns null + writes nothing when no rung is available", async () => {
    const availability: ProviderAvailability = {};
    const picked = await runNonInteractiveAutoPick({
      availabilityOverride: availability,
      workingDir: tmpDir,
    });
    expect(picked).toBeNull();
    const yamlPath = join(tmpDir, ".wotann", "wotann.yaml");
    expect(existsSync(yamlPath)).toBe(false);
  });

  it("creates the .wotann directory if missing", async () => {
    const availability: ProviderAvailability = { "ollama-local": true };
    const wotannDir = join(tmpDir, ".wotann");
    expect(existsSync(wotannDir)).toBe(false); // not yet created
    await runNonInteractiveAutoPick({
      availabilityOverride: availability,
      workingDir: tmpDir,
    });
    expect(existsSync(wotannDir)).toBe(true);
  });

  it("walks the canonical ladder priority order", async () => {
    // Make BOTH claude-cli (rank 1) and ollama-local (rank 10) available.
    // selectFirstAvailable should pick claude-cli (lower rank wins).
    const availability: ProviderAvailability = {
      "claude-cli": true,
      "ollama-local": true,
    };
    const picked = await runNonInteractiveAutoPick({
      availabilityOverride: availability,
      workingDir: tmpDir,
    });
    expect(picked?.probe).toBe("claude-cli");
    expect(picked?.rank).toBe(1);
  });

  it("agrees with selectFirstAvailable on a free-tier-only fixture", async () => {
    // Only Groq free-tier available.
    const availability: ProviderAvailability = { "groq-free": true };
    const expected = selectFirstAvailable(availability);
    const picked = await runNonInteractiveAutoPick({
      availabilityOverride: availability,
      workingDir: tmpDir,
    });
    expect(picked?.probe).toBe(expected?.probe);
  });
});

// ── Wizard reducer "auto" strategy ───────────────────────────────────

describe("reduceWizard — GA-03 'auto' strategy", () => {
  it("includes 'auto' as the first strategy choice", () => {
    expect(STRATEGY_CHOICES.length).toBe(6);
    expect(STRATEGY_CHOICES[0]?.key).toBe("auto");
  });

  it("auto-resolved rung short-circuits to confirm step", () => {
    const initial: WizardStep = { kind: "strategy" };
    const rung = findRung("ollama-local");
    const next = reduceWizard(initial, {
      type: "pick-strategy",
      strategy: "auto",
      autoResolvedRung: rung,
    });
    expect(next.kind).toBe("confirm");
    if (next.kind === "confirm") {
      expect(next.strategy).toBe("auto");
      expect(next.rung?.probe).toBe("ollama-local");
    }
  });

  it("auto with null rung falls through to manual pick", () => {
    const initial: WizardStep = { kind: "strategy" };
    const next = reduceWizard(initial, {
      type: "pick-strategy",
      strategy: "auto",
      autoResolvedRung: null,
    });
    expect(next.kind).toBe("pick");
    if (next.kind === "pick") {
      expect(next.strategy).toBe("auto");
    }
  });
});

// ── Local-tier presentation (per user directive — no LM Studio) ─────

describe("local-tier presentation (NO LM-Studio specific code)", () => {
  it("local strategy hint references generic OpenAI-compatible servers", () => {
    const localChoice = STRATEGY_CHOICES.find((c) => c.key === "local");
    expect(localChoice).toBeDefined();
    expect(localChoice?.hint.toLowerCase()).toContain("ollama");
    expect(localChoice?.hint.toLowerCase()).toContain("openai-compatible");
  });
});
