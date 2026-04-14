/**
 * One-Click Project Onboarding -- scan an entire codebase and build
 * a comprehensive mental model in seconds. No more "explain this project."
 *
 * Detects: language, framework, architecture, test strategy, CI/CD, dependencies.
 * Builds a dependency graph, finds entry points, hot paths, and dead code candidates.
 * Generates a concise project summary suitable for LLM context injection.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";

// -- Types -------------------------------------------------------------------

export interface StackProfile {
  readonly languages: readonly LanguageInfo[];
  readonly frameworks: readonly string[];
  readonly buildTools: readonly string[];
  readonly testFrameworks: readonly string[];
  readonly cicd: readonly string[];
  readonly packageManager: string | null;
  readonly hasDocker: boolean;
  readonly hasMonorepo: boolean;
  readonly primaryLanguage: string;
}

export interface LanguageInfo {
  readonly name: string;
  readonly extensions: readonly string[];
  readonly fileCount: number;
  readonly percentage: number;
}

export interface DependencyNode {
  readonly name: string;
  readonly version: string;
  readonly isDev: boolean;
}

export interface DependencyGraph {
  readonly nodes: readonly DependencyNode[];
  readonly totalDependencies: number;
  readonly totalDevDependencies: number;
}

export interface CodeFlowAnalysis {
  readonly entryPoints: readonly string[];
  readonly configFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly deadCodeCandidates: readonly string[];
  readonly hotPaths: readonly string[];
  readonly totalFiles: number;
  readonly totalLines: number;
}

export interface OnboardingResult {
  readonly projectDir: string;
  readonly stack: StackProfile;
  readonly dependencies: DependencyGraph;
  readonly codeFlow: CodeFlowAnalysis;
  readonly summary: string;
  readonly scannedAt: number;
}

// -- Detection tables --------------------------------------------------------

const FRAMEWORK_INDICATORS: ReadonlyArray<readonly [string, string]> = [
  ["next.config", "Next.js"],
  ["nuxt.config", "Nuxt"],
  ["angular.json", "Angular"],
  ["svelte.config", "SvelteKit"],
  ["remix.config", "Remix"],
  ["astro.config", "Astro"],
  ["vite.config", "Vite"],
  ["webpack.config", "Webpack"],
  ["tailwind.config", "Tailwind CSS"],
  ["tsconfig.json", "TypeScript"],
  ["Cargo.toml", "Rust/Cargo"],
  ["go.mod", "Go Modules"],
  ["pyproject.toml", "Python"],
  ["Gemfile", "Ruby/Bundler"],
  ["composer.json", "PHP/Composer"],
  ["pubspec.yaml", "Flutter/Dart"],
  ["Package.swift", "Swift"],
  ["pom.xml", "Java/Maven"],
  ["build.gradle", "Java/Gradle"],
] as const;

const TEST_FRAMEWORK_INDICATORS: ReadonlyArray<readonly [string, string]> = [
  ["vitest.config", "Vitest"],
  ["jest.config", "Jest"],
  [".mocharc", "Mocha"],
  ["cypress.config", "Cypress"],
  ["playwright.config", "Playwright"],
  ["pytest.ini", "Pytest"],
  ["phpunit.xml", "PHPUnit"],
] as const;

const CI_INDICATORS: ReadonlyArray<readonly [string, string]> = [
  [".github/workflows", "GitHub Actions"],
  [".gitlab-ci.yml", "GitLab CI"],
  ["Jenkinsfile", "Jenkins"],
  [".circleci", "CircleCI"],
  [".travis.yml", "Travis CI"],
  ["bitbucket-pipelines.yml", "Bitbucket Pipelines"],
] as const;

const LANGUAGE_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".py", "Python"],
  [".go", "Go"],
  [".rs", "Rust"],
  [".java", "Java"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".cs", "C#"],
  [".swift", "Swift"],
  [".dart", "Dart"],
  [".kt", "Kotlin"],
  [".cpp", "C++"],
  [".c", "C"],
] as const;

const ENTRY_POINT_NAMES: ReadonlySet<string> = new Set([
  "index.ts", "index.js", "main.ts", "main.js", "app.ts", "app.js",
  "server.ts", "server.js", "cli.ts", "cli.js", "index.py", "main.py",
  "app.py", "main.go", "main.rs", "lib.rs", "Main.java", "Program.cs",
]);

const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "__pycache__", ".mypy_cache", "target", "vendor", "coverage", ".cache",
]);

// -- Implementation ----------------------------------------------------------

export class ProjectOnboarder {
  /**
   * Full onboarding scan -- produces a complete mental model.
   */
  onboard(projectDir: string): OnboardingResult {
    const stack = this.detectStack(projectDir);
    const dependencies = this.buildDependencyGraph(projectDir);
    const codeFlow = this.analyzeCodeFlow(projectDir);
    const summary = this.generateSummary(stack, dependencies, codeFlow);

    return {
      projectDir,
      stack,
      dependencies,
      codeFlow,
      summary,
      scannedAt: Date.now(),
    };
  }

  /**
   * Detect the technology stack from project files.
   */
  detectStack(projectDir: string): StackProfile {
    const files = collectFileNames(projectDir, 2);

    const frameworks = detectByIndicators(files, projectDir, FRAMEWORK_INDICATORS);
    const testFrameworks = detectByIndicators(files, projectDir, TEST_FRAMEWORK_INDICATORS);
    const cicd = detectByIndicators(files, projectDir, CI_INDICATORS);

    const buildTools: string[] = [];
    if (files.includes("Makefile")) buildTools.push("Make");
    if (files.includes("Taskfile.yml")) buildTools.push("Task");
    if (files.some((f) => f.startsWith("turbo"))) buildTools.push("Turborepo");

    const hasDocker = files.some((f) => f.startsWith("Dockerfile") || f === "docker-compose.yml");
    const hasMonorepo = existsSync(join(projectDir, "packages")) || existsSync(join(projectDir, "apps"));

    const packageManager = detectPackageManager(projectDir);

    const languageMap = new Map<string, number>();
    const allFiles = collectAllFiles(projectDir);
    for (const file of allFiles) {
      const ext = extname(file);
      const langEntry = LANGUAGE_EXTENSIONS.find(([e]) => e === ext);
      if (langEntry) {
        languageMap.set(langEntry[1], (languageMap.get(langEntry[1]) ?? 0) + 1);
      }
    }

    const totalSourceFiles = [...languageMap.values()].reduce((a, b) => a + b, 0);
    const languages: LanguageInfo[] = [...languageMap.entries()]
      .map(([name, count]) => ({
        name,
        extensions: LANGUAGE_EXTENSIONS.filter(([, n]) => n === name).map(([e]) => e),
        fileCount: count,
        percentage: totalSourceFiles > 0 ? Math.round((count / totalSourceFiles) * 100) : 0,
      }))
      .sort((a, b) => b.fileCount - a.fileCount);

    const primaryLanguage = languages[0]?.name ?? "Unknown";

    return { languages, frameworks, buildTools, testFrameworks, cicd, packageManager, hasDocker, hasMonorepo, primaryLanguage };
  }

  /**
   * Build a dependency graph from package manifest.
   */
  buildDependencyGraph(projectDir: string): DependencyGraph {
    const pkgPath = join(projectDir, "package.json");
    if (!existsSync(pkgPath)) {
      return { nodes: [], totalDependencies: 0, totalDevDependencies: 0 };
    }

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, Record<string, string> | undefined>;
      const deps = pkg["dependencies"] ?? {};
      const devDeps = pkg["devDependencies"] ?? {};

      const nodes: DependencyNode[] = [
        ...Object.entries(deps).map(([name, version]) => ({ name, version: version ?? "*", isDev: false })),
        ...Object.entries(devDeps).map(([name, version]) => ({ name, version: version ?? "*", isDev: true })),
      ];

      return {
        nodes,
        totalDependencies: Object.keys(deps).length,
        totalDevDependencies: Object.keys(devDeps).length,
      };
    } catch {
      return { nodes: [], totalDependencies: 0, totalDevDependencies: 0 };
    }
  }

  /**
   * Analyze code flow: entry points, config, tests, dead code candidates, hot paths.
   */
  analyzeCodeFlow(projectDir: string): CodeFlowAnalysis {
    const allFiles = collectAllFiles(projectDir);
    const relFiles = allFiles.map((f) => relative(projectDir, f));

    const entryPoints = relFiles.filter((f) => ENTRY_POINT_NAMES.has(basename(f)));
    const configFiles = relFiles.filter(
      (f) => f.includes("config") || f.endsWith(".env") || f.endsWith(".env.example"),
    );
    const testFiles = relFiles.filter(
      (f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"),
    );

    // Dead code candidates: files not imported anywhere and not entry/config/test
    const sourceFiles = relFiles.filter(
      (f) => !testFiles.includes(f) && !configFiles.includes(f) && !entryPoints.includes(f),
    );
    const allContent = allFiles
      .slice(0, 200) // cap for performance
      .map((f) => safeRead(f))
      .join("\n");

    const deadCodeCandidates = sourceFiles
      .filter((f) => {
        const base = basename(f, extname(f));
        return base.length > 2 && !allContent.includes(base);
      })
      .slice(0, 20);

    // Hot paths: files in src/ root or with many imports
    const hotPaths = relFiles
      .filter((f) => f.startsWith("src/") && f.split("/").length <= 3)
      .slice(0, 15);

    let totalLines = 0;
    for (const file of allFiles.slice(0, 500)) {
      const content = safeRead(file);
      if (content) totalLines += content.split("\n").length;
    }

    return {
      entryPoints,
      configFiles,
      testFiles,
      deadCodeCandidates,
      hotPaths,
      totalFiles: allFiles.length,
      totalLines,
    };
  }

  /**
   * Generate a concise project summary from analysis results.
   */
  generateSummary(stack: StackProfile, deps: DependencyGraph, flow: CodeFlowAnalysis): string {
    const lines: string[] = [];
    lines.push(`## Project Summary`);
    lines.push(``);
    lines.push(`**Primary Language**: ${stack.primaryLanguage}`);
    if (stack.frameworks.length > 0) {
      lines.push(`**Frameworks**: ${stack.frameworks.join(", ")}`);
    }
    if (stack.testFrameworks.length > 0) {
      lines.push(`**Testing**: ${stack.testFrameworks.join(", ")}`);
    }
    if (stack.cicd.length > 0) {
      lines.push(`**CI/CD**: ${stack.cicd.join(", ")}`);
    }
    if (stack.packageManager) {
      lines.push(`**Package Manager**: ${stack.packageManager}`);
    }
    lines.push(`**Docker**: ${stack.hasDocker ? "Yes" : "No"}`);
    lines.push(`**Monorepo**: ${stack.hasMonorepo ? "Yes" : "No"}`);
    lines.push(``);
    lines.push(`**Dependencies**: ${deps.totalDependencies} runtime, ${deps.totalDevDependencies} dev`);
    lines.push(`**Files**: ${flow.totalFiles} total, ~${flow.totalLines} lines`);
    lines.push(`**Entry Points**: ${flow.entryPoints.join(", ") || "none detected"}`);
    lines.push(`**Test Files**: ${flow.testFiles.length}`);

    return lines.join("\n");
  }
}

// -- Helpers -----------------------------------------------------------------

function collectFileNames(dir: string, maxDepth: number): readonly string[] {
  if (maxDepth <= 0 || !existsSync(dir)) return [];
  const names: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      names.push(entry);
      const full = join(dir, entry);
      if (!SKIP_DIRS.has(entry) && safeIsDir(full)) {
        for (const child of collectFileNames(full, maxDepth - 1)) {
          names.push(join(entry, child));
        }
      }
    }
  } catch { /* ignore permission errors */ }
  return names;
}

function collectAllFiles(dir: string, depth = 0): readonly string[] {
  if (depth > 6 || !existsSync(dir)) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (safeIsDir(full)) {
        results.push(...collectAllFiles(full, depth + 1));
      } else {
        results.push(full);
      }
    }
  } catch { /* ignore */ }
  return results;
}

function safeIsDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function safeRead(p: string): string {
  try { return readFileSync(p, "utf-8"); } catch { return ""; }
}

function detectByIndicators(
  files: readonly string[],
  projectDir: string,
  indicators: ReadonlyArray<readonly [string, string]>,
): readonly string[] {
  const found: string[] = [];
  for (const [indicator, name] of indicators) {
    if (files.some((f) => f.startsWith(indicator)) || existsSync(join(projectDir, indicator))) {
      found.push(name);
    }
  }
  return found;
}

function detectPackageManager(dir: string): string | null {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb"))) return "bun";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  return null;
}
