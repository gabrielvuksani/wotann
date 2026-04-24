/**
 * V9 Tier 9 — `wotann build` CLI command tests.
 *
 * Coverage:
 *   - Plan-only default: no files written; variants + nextSteps returned.
 *   - emit=true without outDir: refused honestly (QB #6).
 *   - emit=true with outDir: writes the expected file set; emitted list
 *     matches what landed on disk.
 *   - force flag controls overwrite behavior.
 *   - variants=N produces N variant plans.
 *   - parseVariantsFlag handles all input shapes.
 *   - Empty spec is refused.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runBuildCommand,
  parseVariantsFlag,
} from "../../src/cli/commands/build.js";

let workRoot: string;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), "wotann-build-cli-"));
});

afterEach(() => {
  if (existsSync(workRoot)) rmSync(workRoot, { recursive: true, force: true });
});

describe("runBuildCommand: defaults", () => {
  it("plan-only returns variants without writing any files", async () => {
    const r = await runBuildCommand({
      spec: "build a Next.js app with auth",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants).toHaveLength(1);
    expect(r.emitted).toEqual([]);
    expect(r.nextSteps.length).toBeGreaterThan(0);
  });

  it("derives project name from the first word of the spec", async () => {
    const r = await runBuildCommand({ spec: "TodoApp full-stack saas" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants[0]?.projectName).toBe("todoapp");
  });

  it("honors explicit projectName", async () => {
    const r = await runBuildCommand({
      spec: "anything",
      projectName: "my-custom-name",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants[0]?.projectName).toBe("my-custom-name");
  });
});

describe("runBuildCommand: honest refusals (QB #6)", () => {
  it("refuses empty spec", async () => {
    const r = await runBuildCommand({ spec: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("spec required");
  });

  it("refuses whitespace spec", async () => {
    const r = await runBuildCommand({ spec: "   \n\t" });
    expect(r.ok).toBe(false);
  });

  it("refuses --emit without --out", async () => {
    const r = await runBuildCommand({
      spec: "build something",
      emit: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("requires --out");
  });
});

describe("runBuildCommand: emission", () => {
  it("writes the expected file set when emit=true with outDir", async () => {
    const outDir = join(workRoot, "project");
    const r = await runBuildCommand({
      spec: "build a Next.js dashboard app",
      projectName: "dashboard",
      outDir,
      emit: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // emitted list matches actual disk state.
    for (const abs of r.emitted) {
      expect(existsSync(abs)).toBe(true);
    }
    expect(existsSync(join(outDir, "package.json"))).toBe(true);
    expect(existsSync(join(outDir, "drizzle.config.ts"))).toBe(true);
    expect(existsSync(join(outDir, "src", "db", "schema.ts"))).toBe(true);
    expect(existsSync(join(outDir, "src", "auth", "config.ts"))).toBe(true);

    const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf-8"));
    expect(pkg.private).toBe(true);
  });

  it("refuses to overwrite without --force", async () => {
    const outDir = join(workRoot, "project");
    // Pre-seed one of the expected files.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "package.json"), "pre-existing\n");

    const r = await runBuildCommand({
      spec: "build next.js app",
      outDir,
      emit: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("refusing to overwrite");
    // Pre-existing content preserved.
    expect(readFileSync(join(outDir, "package.json"), "utf-8")).toBe(
      "pre-existing\n",
    );
  });

  it("overwrites when --force is passed", async () => {
    const outDir = join(workRoot, "project");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "package.json"), "pre-existing\n");

    const r = await runBuildCommand({
      spec: "build next.js app",
      outDir,
      emit: true,
      force: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.emitted.length).toBeGreaterThan(0);
    const final = readFileSync(join(outDir, "package.json"), "utf-8");
    expect(final).not.toBe("pre-existing\n");
  });
});

describe("runBuildCommand: variants", () => {
  it("produces N variant plans when variants=N", async () => {
    const r = await runBuildCommand({
      spec: "build a next.js app",
      variants: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variants).toHaveLength(3);
    // All variants share the same deterministic selection.
    expect(r.variants[0]?.scaffold.ok).toBe(true);
    expect(r.variants[1]?.scaffold.ok).toBe(true);
  });
});

describe("parseVariantsFlag", () => {
  it("handles numbers, strings, and undefined", () => {
    expect(parseVariantsFlag(undefined)).toBe(1);
    expect(parseVariantsFlag(3)).toBe(3);
    expect(parseVariantsFlag("5")).toBe(5);
    // Invalid / negative -> fallback to 1.
    expect(parseVariantsFlag("abc")).toBe(1);
    expect(parseVariantsFlag(0)).toBe(1);
    expect(parseVariantsFlag(-2)).toBe(1);
  });
});
