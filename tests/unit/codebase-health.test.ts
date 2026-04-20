import { describe, it, expect, afterEach } from "vitest";
import { analyzeCodebaseHealth } from "../../src/intelligence/codebase-health.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("analyzeCodebaseHealth", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a valid report for a healthy project", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));

    writeFileSync(
      join(tempDir, "index.ts"),
      "export function main() { return 42; }\n",
    );
    writeFileSync(
      join(tempDir, "index.test.ts"),
      'import { main } from "./index.js";\n',
    );

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(100);
    expect(report.todoCount).toBe(0);
    expect(report.avgFileSize).toBeGreaterThan(0);
  });

  it("detects TODO/FIXME markers", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));

    writeFileSync(
      join(tempDir, "app.ts"),
      "// TODO: fix this\n// FIXME: also this\nexport const x = 1;\n",
    );

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    expect(report.todoCount).toBe(2);
  });

  it("reports largest files", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));

    const bigContent = Array(100)
      .fill("export const x = 1;\n")
      .join("");
    writeFileSync(join(tempDir, "big.ts"), bigContent);
    writeFileSync(join(tempDir, "small.ts"), "export const y = 2;\n");

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    expect(report.largestFiles.length).toBeGreaterThan(0);
    expect(report.largestFiles[0]?.path).toBe("big.ts");
  });

  it("computes test coverage ratio", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));

    writeFileSync(join(tempDir, "auth.ts"), "export function login() {}\n");
    writeFileSync(join(tempDir, "utils.ts"), "export function format() {}\n");
    writeFileSync(
      join(tempDir, "auth.test.ts"),
      'import { login } from "./auth.js";\n',
    );

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    // 1 test file / 2 source files = 50%
    expect(report.testCoverage).toBe(50);
  });

  it("returns 0 health score for empty directory", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    expect(report.healthScore).toBe(0);
    expect(report.avgFileSize).toBe(0);
  });

  it("scans nested directories", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
    mkdirSync(join(tempDir, "src", "core"), { recursive: true });

    writeFileSync(
      join(tempDir, "src", "core", "types.ts"),
      "export type Foo = string;\n",
    );
    writeFileSync(
      join(tempDir, "src", "index.ts"),
      "export { Foo } from './core/types.js';\n",
    );

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    expect(report.avgFileSize).toBeGreaterThan(0);
    expect(report.largestFiles.length).toBe(2);
  });

  it("skips node_modules and dist directories", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));
    mkdirSync(join(tempDir, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(tempDir, "dist"), { recursive: true });

    writeFileSync(
      join(tempDir, "node_modules", "pkg", "index.ts"),
      "export const x = 1;\n",
    );
    writeFileSync(
      join(tempDir, "dist", "bundle.js"),
      "var x = 1;\n",
    );
    writeFileSync(join(tempDir, "app.ts"), "export const y = 2;\n");

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    // Should only count app.ts, not the node_modules/dist files
    expect(report.largestFiles.length).toBe(1);
    expect(report.largestFiles[0]?.path).toBe("app.ts");
  });

  it("handles non-existent directory gracefully", () => {
    const report = analyzeCodebaseHealth("/nonexistent/path/xyz", { skipExternalTools: true });
    expect(report.healthScore).toBe(0);
    expect(report.todoCount).toBe(0);
  });

  it("penalizes health score for many TODOs", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-health-"));

    const todosContent = Array(10)
      .fill("// TODO: fix\n")
      .join("") + "export const x = 1;\n";
    writeFileSync(join(tempDir, "messy.ts"), todosContent);
    writeFileSync(
      join(tempDir, "messy.test.ts"),
      'import { x } from "./messy.js";\n',
    );

    const report = analyzeCodebaseHealth(tempDir, { skipExternalTools: true });
    expect(report.todoCount).toBe(10);
    // Health score should be penalized (100 - 10 TODOs = 90)
    expect(report.healthScore).toBeLessThanOrEqual(90);
  });
});
