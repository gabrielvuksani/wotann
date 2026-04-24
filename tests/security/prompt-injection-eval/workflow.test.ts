/**
 * V9 T10.5 - CI gate shape tests.
 *
 * Exercises the YAML shape of `.github/workflows/agentic-browser-security.yml`
 * and verifies the baseline-capture script exists and exports the expected
 * public API. Prevents silent drift in either file.
 *
 * These tests do NOT run the full eval; `harness.test.ts` covers that.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const WORKFLOW_PATH = join(
  REPO_ROOT,
  ".github",
  "workflows",
  "agentic-browser-security.yml",
);
const CAPTURE_SCRIPT_PATH = join(
  REPO_ROOT,
  "scripts",
  "capture-prompt-injection-baseline.mjs",
);

// ---- workflow YAML shape -----------------------------------------------

describe("agentic-browser-security.yml - shape", () => {
  it("file exists", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  const raw = readFileSync(WORKFLOW_PATH, "utf-8");
  const parsed = YAML.parse(raw) as Record<string, unknown>;

  it("parses as valid YAML", () => {
    expect(parsed).toBeTruthy();
    expect(typeof parsed).toBe("object");
  });

  it("has a workflow name", () => {
    expect(typeof parsed["name"]).toBe("string");
    expect((parsed["name"] as string).length).toBeGreaterThan(0);
  });

  it("has all 3 required triggers (pull_request, push, workflow_dispatch)", () => {
    // YAML parsers treat the bare `on` key specially (can resolve to `true`)
    // depending on version; check both possible key names.
    const on = (parsed["on"] ?? parsed[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
    expect(on).toBeTruthy();
    expect("pull_request" in (on ?? {})).toBe(true);
    expect("push" in (on ?? {})).toBe(true);
    expect("workflow_dispatch" in (on ?? {})).toBe(true);
  });

  it("pull_request trigger has the required path filters", () => {
    const on = (parsed["on"] ?? parsed[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
    const pr = on?.["pull_request"] as { paths?: string[] } | undefined;
    expect(Array.isArray(pr?.paths)).toBe(true);
    const paths = pr?.paths ?? [];
    const required = [
      "src/browser/**",
      "src/security/prompt-injection-*.ts",
      "src/security/hidden-text-detector.ts",
      "src/security/url-instruction-guard.ts",
      "src/middleware/trifecta-guard.ts",
      "scripts/run-prompt-injection-eval.mjs",
      "tests/security/prompt-injection-eval/**",
      ".github/workflows/agentic-browser-security.yml",
    ];
    for (const r of required) {
      expect(paths).toContain(r);
    }
  });

  it("has concurrency with cancel-in-progress gated on PR events", () => {
    const conc = parsed["concurrency"] as Record<string, unknown> | undefined;
    expect(conc).toBeTruthy();
    expect(typeof conc?.["group"]).toBe("string");
    expect(conc?.["cancel-in-progress"]).toBeDefined();
  });

  it("declares least-privilege permissions (contents:read, pull-requests:write)", () => {
    const perms = parsed["permissions"] as Record<string, string> | undefined;
    expect(perms).toBeTruthy();
    expect(perms?.["contents"]).toBe("read");
    expect(perms?.["pull-requests"]).toBe("write");
  });

  it("has a single 'eval' job with timeout-minutes <= 20", () => {
    const jobs = parsed["jobs"] as Record<string, unknown>;
    expect(jobs).toBeTruthy();
    expect("eval" in jobs).toBe(true);
    const job = jobs["eval"] as Record<string, unknown>;
    expect(typeof job["timeout-minutes"]).toBe("number");
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(20);
    expect(job["runs-on"]).toBe("ubuntu-latest");
  });

  it("eval job has the expected step sequence", () => {
    const jobs = parsed["jobs"] as Record<string, unknown>;
    const job = jobs["eval"] as { steps?: Record<string, unknown>[] };
    const steps = job.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(6);
    // First step checks out the repo
    expect(steps[0]?.["uses"]).toMatch(/^actions\/checkout@v\d+$/);
    // A Node setup is present
    const hasNodeSetup = steps.some((s) =>
      String(s["uses"] ?? "").startsWith("actions/setup-node@"),
    );
    expect(hasNodeSetup).toBe(true);
    // Artifact upload step exists
    const hasUpload = steps.some((s) =>
      String(s["uses"] ?? "").startsWith("actions/upload-artifact@"),
    );
    expect(hasUpload).toBe(true);
    // github-script comment step exists
    const hasGhScript = steps.some((s) =>
      String(s["uses"] ?? "").startsWith("actions/github-script@"),
    );
    expect(hasGhScript).toBe(true);
  });

  it("strict-mode eval is invoked via WOTANN_EVAL_STRICT env var (not shell-interpolated)", () => {
    // Pattern guard: the raw YAML must set WOTANN_EVAL_STRICT in an `env:`
    // block, never inline `${{ ... }}` in a run: expression.
    expect(raw).toMatch(/WOTANN_EVAL_STRICT:\s*"1"/);
    // Ensure no untrusted github.event.* string interpolation reaches a run: block.
    // (The only allowed github.event reference is `github.event_name` in an `if:`.)
    const forbidden =
      /\$\{\{\s*github\.event\.(issue|pull_request|comment|review|commits|head_commit|pages)/;
    expect(forbidden.test(raw)).toBe(false);
  });

  it("uploads eval-report.json with 30-day retention", () => {
    const jobs = parsed["jobs"] as Record<string, unknown>;
    const job = jobs["eval"] as { steps?: Record<string, unknown>[] };
    const upload = (job.steps ?? []).find((s) =>
      String(s["uses"] ?? "").startsWith("actions/upload-artifact@"),
    );
    expect(upload).toBeTruthy();
    const withBlock = upload?.["with"] as Record<string, unknown> | undefined;
    expect(withBlock?.["path"]).toBe("eval-report.json");
    // retention-days may be parsed as number by YAML
    expect(Number(withBlock?.["retention-days"])).toBe(30);
  });
});

// ---- capture-prompt-injection-baseline.mjs -----------------------------

describe("capture-prompt-injection-baseline.mjs - shape", () => {
  it("file exists", () => {
    expect(existsSync(CAPTURE_SCRIPT_PATH)).toBe(true);
  });

  it("exports parseArgs and toBaseline", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      parseArgs?: unknown;
      toBaseline?: unknown;
    };
    expect(typeof mod.parseArgs).toBe("function");
    expect(typeof mod.toBaseline).toBe("function");
  });

  it("parseArgs returns default output path when given no args", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      parseArgs: (argv: string[]) => { outPath: string; help: boolean };
    };
    const result = mod.parseArgs([]);
    expect(typeof result.outPath).toBe("string");
    expect(result.outPath.endsWith("baseline.json")).toBe(true);
    expect(result.help).toBe(false);
  });

  it("parseArgs respects --out", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      parseArgs: (argv: string[]) => { outPath: string; help: boolean };
    };
    const result = mod.parseArgs(["--out", "/tmp/x.json"]);
    expect(result.outPath).toBe("/tmp/x.json");
  });

  it("parseArgs recognizes --help", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      parseArgs: (argv: string[]) => { outPath: string; help: boolean };
    };
    expect(mod.parseArgs(["--help"]).help).toBe(true);
    expect(mod.parseArgs(["-h"]).help).toBe(true);
  });

  it("parseArgs throws on unknown args", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      parseArgs: (argv: string[]) => { outPath: string; help: boolean };
    };
    expect(() => mod.parseArgs(["--bogus"])).toThrow();
  });

  it("parseArgs throws when --out has no value", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      parseArgs: (argv: string[]) => { outPath: string; help: boolean };
    };
    expect(() => mod.parseArgs(["--out"])).toThrow();
  });

  it("toBaseline produces the compact baseline shape", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      toBaseline: (report: unknown) => {
        capturedAt: string;
        attackSuccessRate: number;
        threshold: number;
        total: number;
        results: { id: string; blocked: boolean }[];
      };
    };
    const report = {
      total: 2,
      passed: 2,
      failed: 0,
      missedAttacks: 0,
      attackSuccessRate: 0,
      threshold: 0.02,
      regressions: [],
      perCase: [
        { id: "a", passed: true, blocked: true, missedAttack: false, hits: [] },
        { id: "b", passed: true, blocked: false, missedAttack: false, hits: [] },
      ],
    };
    const baseline = mod.toBaseline(report);
    expect(baseline.total).toBe(2);
    expect(baseline.attackSuccessRate).toBe(0);
    expect(baseline.threshold).toBe(0.02);
    expect(baseline.results).toEqual([
      { id: "a", blocked: true },
      { id: "b", blocked: false },
    ]);
    // ISO 8601 timestamp
    expect(baseline.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("toBaseline rejects a report missing perCase", async () => {
    const mod = (await import(CAPTURE_SCRIPT_PATH)) as {
      toBaseline: (report: unknown) => unknown;
    };
    expect(() => mod.toBaseline({ total: 0 })).toThrow(/perCase/);
  });
});
