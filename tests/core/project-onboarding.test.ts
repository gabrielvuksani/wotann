import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProjectOnboarder } from "../../src/core/project-onboarding.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ProjectOnboarder", () => {
  let onboarder: ProjectOnboarder;
  let tempDir: string;

  beforeEach(() => {
    onboarder = new ProjectOnboarder();
    tempDir = mkdtempSync(join(tmpdir(), "wotann-onboard-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(tempDir, path);
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
    }
  }

  describe("detectStack", () => {
    it("detects TypeScript with Vite and Vitest", () => {
      setupProject({
        "tsconfig.json": "{}",
        "vite.config.ts": "export default {}",
        "vitest.config.ts": "export default {}",
        "package.json": "{}",
        "package-lock.json": "{}",
        "src/index.ts": "console.log('hi');",
      });

      const stack = onboarder.detectStack(tempDir);
      expect(stack.frameworks).toContain("TypeScript");
      expect(stack.frameworks).toContain("Vite");
      expect(stack.testFrameworks).toContain("Vitest");
      expect(stack.packageManager).toBe("npm");
    });

    it("detects Docker and monorepo", () => {
      setupProject({
        "Dockerfile": "FROM node:20",
        "packages/a/index.ts": "",
      });

      const stack = onboarder.detectStack(tempDir);
      expect(stack.hasDocker).toBe(true);
      expect(stack.hasMonorepo).toBe(true);
    });

    it("identifies primary language from file counts", () => {
      setupProject({
        "src/a.ts": "",
        "src/b.ts": "",
        "src/c.ts": "",
        "src/d.py": "",
      });

      const stack = onboarder.detectStack(tempDir);
      expect(stack.primaryLanguage).toBe("TypeScript");
      expect(stack.languages.length).toBeGreaterThanOrEqual(1);
    });

    it("returns Unknown for empty directories", () => {
      const stack = onboarder.detectStack(tempDir);
      expect(stack.primaryLanguage).toBe("Unknown");
    });
  });

  describe("buildDependencyGraph", () => {
    it("parses dependencies from package.json", () => {
      setupProject({
        "package.json": JSON.stringify({
          dependencies: { react: "^18.0.0", chalk: "^5.0.0" },
          devDependencies: { typescript: "^5.0.0" },
        }),
      });

      const graph = onboarder.buildDependencyGraph(tempDir);
      expect(graph.totalDependencies).toBe(2);
      expect(graph.totalDevDependencies).toBe(1);
      expect(graph.nodes).toHaveLength(3);
    });

    it("returns empty graph when no package.json exists", () => {
      const graph = onboarder.buildDependencyGraph(tempDir);
      expect(graph.totalDependencies).toBe(0);
      expect(graph.nodes).toHaveLength(0);
    });
  });

  describe("analyzeCodeFlow", () => {
    it("finds entry points and test files", () => {
      setupProject({
        "src/index.ts": "export {};",
        "src/app.ts": "export {};",
        "src/utils.ts": "export {};",
        "src/utils.test.ts": "test('x', () => {});",
      });

      const flow = onboarder.analyzeCodeFlow(tempDir);
      expect(flow.entryPoints.length).toBeGreaterThanOrEqual(1);
      expect(flow.testFiles.length).toBeGreaterThanOrEqual(1);
      expect(flow.totalFiles).toBeGreaterThanOrEqual(4);
    });

    it("reports config files", () => {
      setupProject({
        "tsconfig.json": "{}",
        ".env.example": "KEY=value",
        "src/config.ts": "export {};",
      });

      const flow = onboarder.analyzeCodeFlow(tempDir);
      expect(flow.configFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("generateSummary", () => {
    it("produces a readable markdown summary", () => {
      setupProject({
        "tsconfig.json": "{}",
        "vitest.config.ts": "export default {}",
        "package.json": JSON.stringify({
          dependencies: { react: "^18.0.0" },
          devDependencies: { typescript: "^5.0.0" },
        }),
        "package-lock.json": "{}",
        "src/index.ts": "export {};",
      });

      const stack = onboarder.detectStack(tempDir);
      const deps = onboarder.buildDependencyGraph(tempDir);
      const flow = onboarder.analyzeCodeFlow(tempDir);
      const summary = onboarder.generateSummary(stack, deps, flow);

      expect(summary).toContain("## Project Summary");
      expect(summary).toContain("Primary Language");
      expect(summary).toContain("Dependencies");
    });
  });

  describe("onboard (full pipeline)", () => {
    it("produces a complete OnboardingResult", () => {
      setupProject({
        "tsconfig.json": "{}",
        "package.json": JSON.stringify({
          dependencies: { express: "^4.0.0" },
          devDependencies: {},
        }),
        "src/index.ts": "export {};",
      });

      const result = onboarder.onboard(tempDir);
      expect(result.projectDir).toBe(tempDir);
      expect(result.stack.primaryLanguage).not.toBe("Unknown");
      expect(result.dependencies.totalDependencies).toBeGreaterThanOrEqual(1);
      expect(result.summary).toContain("## Project Summary");
      expect(result.scannedAt).toBeGreaterThan(0);
    });
  });
});
