/**
 * Codebase Health Analyzer — compute a health score for any project directory.
 *
 * Measures: file sizes, markers (TODO/FIXME), circular dependency signals,
 * dead code indicators, test coverage indicators, and overall health.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";

// ── Types ─────────────────────────────────────────────────

export interface FileMetric {
  readonly path: string;
  readonly lineCount: number;
  readonly sizeBytes: number;
}

export interface CodebaseHealthReport {
  readonly testCoverage: number;
  readonly typeErrors: number;
  readonly lintWarnings: number;
  readonly todoCount: number;
  readonly avgFileSize: number;
  readonly largestFiles: readonly FileMetric[];
  readonly deadCode: readonly string[];
  readonly circularDeps: readonly string[];
  readonly healthScore: number;
}

// ── Constants ─────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java",
]);

const TEST_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /_test\.[tj]sx?$/,
  /test_.*\.[tj]sx?$/,
];

const MAX_HEALTHY_FILE_LINES = 400;
const MAX_ALLOWED_FILE_LINES = 800;
const TOP_LARGEST_COUNT = 10;

// ── Analysis ──────────────────────────────────────────────

/**
 * Analyze a project directory and produce a health report.
 * The health score is 0-100: higher is healthier.
 */
export function analyzeCodebaseHealth(
  projectDir: string,
): CodebaseHealthReport {
  const sourceFiles = collectSourceFiles(projectDir, 5);
  const testFiles = sourceFiles.filter((f) =>
    TEST_PATTERNS.some((p) => p.test(f.path)),
  );
  const nonTestFiles = sourceFiles.filter(
    (f) => !TEST_PATTERNS.some((p) => p.test(f.path)),
  );

  // Test coverage (ratio of test files to source files)
  const testCoverage =
    nonTestFiles.length > 0
      ? Math.min(1, testFiles.length / nonTestFiles.length)
      : 0;

  // Count markers (TODO/FIXME)
  const todoCount = countTodos(projectDir, sourceFiles);

  // Find largest files
  const sortedBySize = [...sourceFiles].sort(
    (a, b) => b.lineCount - a.lineCount,
  );
  const largestFiles = sortedBySize.slice(0, TOP_LARGEST_COUNT);

  // Average file size
  const avgFileSize =
    sourceFiles.length > 0
      ? sourceFiles.reduce((sum, f) => sum + f.lineCount, 0) /
        sourceFiles.length
      : 0;

  // Dead code indicators (unused exports heuristic)
  const deadCode = detectDeadCodeSignals(projectDir, sourceFiles);

  // Circular dependency signals
  const circularDeps = detectCircularDepSignals(projectDir, sourceFiles);

  // Compute health score
  const healthScore = computeHealthScore({
    testCoverage,
    todoCount,
    avgFileSize,
    largestFileLines: largestFiles[0]?.lineCount ?? 0,
    deadCodeCount: deadCode.length,
    circularDepCount: circularDeps.length,
    fileCount: sourceFiles.length,
  });

  return {
    testCoverage: Math.round(testCoverage * 100),
    typeErrors: countTypeErrors(projectDir),
    lintWarnings: countLintWarnings(projectDir),
    todoCount,
    avgFileSize: Math.round(avgFileSize),
    largestFiles,
    deadCode,
    circularDeps,
    healthScore,
  };
}

// ── Collection ────────────────────────────────────────────

function collectSourceFiles(
  dir: string,
  maxDepth: number,
  depth: number = 0,
  prefix: string = "",
): FileMetric[] {
  if (depth > maxDepth) return [];

  const files: FileMetric[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relativePath = prefix
        ? `${prefix}/${entry.name}`
        : entry.name;

      if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        try {
          const stat = statSync(fullPath);
          const content = readFileSync(fullPath, "utf-8");
          const lineCount = content.split("\n").length;
          files.push({
            path: relativePath,
            lineCount,
            sizeBytes: stat.size,
          });
        } catch {
          // Skip unreadable files
        }
      } else if (entry.isDirectory()) {
        files.push(
          ...collectSourceFiles(fullPath, maxDepth, depth + 1, relativePath),
        );
      }
    }
  } catch {
    // Ignore permission errors
  }

  return files;
}

// ── Detectors ─────────────────────────────────────────────

function countTodos(
  projectDir: string,
  files: readonly FileMetric[],
): number {
  let count = 0;
  const pattern = /\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/g;

  for (const file of files) {
    try {
      const content = readFileSync(join(projectDir, file.path), "utf-8");
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    } catch {
      // Skip unreadable files
    }
  }

  return count;
}

function detectDeadCodeSignals(
  projectDir: string,
  files: readonly FileMetric[],
): readonly string[] {
  // Heuristic: find exported symbols that are never imported elsewhere
  const exportMap = new Map<string, string>(); // symbol -> file
  const importedSymbols = new Set<string>();

  for (const file of files) {
    try {
      const content = readFileSync(join(projectDir, file.path), "utf-8");

      // Collect exports
      const exportPattern =
        /export\s+(?:default\s+)?(?:function|class|const|let|type|interface)\s+(\w+)/g;
      let match = exportPattern.exec(content);
      while (match !== null) {
        if (match[1]) {
          exportMap.set(match[1], file.path);
        }
        match = exportPattern.exec(content);
      }

      // Collect imports
      const importPattern = /import\s+\{([^}]+)\}/g;
      let importMatch = importPattern.exec(content);
      while (importMatch !== null) {
        const symbols = (importMatch[1] ?? "")
          .split(",")
          .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "");
        for (const sym of symbols) {
          if (sym) importedSymbols.add(sym);
        }
        importMatch = importPattern.exec(content);
      }
    } catch {
      // Skip unreadable files
    }
  }

  const dead: string[] = [];
  for (const [symbol, file] of exportMap) {
    if (!importedSymbols.has(symbol)) {
      dead.push(`${symbol} (${file})`);
    }
  }

  // Limit to avoid noise — only report top signals
  return dead.slice(0, 20);
}

function detectCircularDepSignals(
  projectDir: string,
  files: readonly FileMetric[],
): readonly string[] {
  // Build a simplified import graph and detect cycles
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    try {
      const content = readFileSync(join(projectDir, file.path), "utf-8");
      const importPattern = /from\s+['"]\.\.?\/([\w/.-]+)['"]/g;
      const deps = new Set<string>();

      let match = importPattern.exec(content);
      while (match !== null) {
        if (match[1]) deps.add(match[1]);
        match = importPattern.exec(content);
      }

      graph.set(file.path, deps);
    } catch {
      // Skip unreadable files
    }
  }

  // Simple cycle detection using DFS
  const cycles: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: readonly string[]): void {
    if (inStack.has(node)) {
      cycles.push(`Cycle: ${[...path, node].join(" -> ")}`);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const deps = graph.get(node);
    if (deps) {
      for (const dep of deps) {
        if (graph.has(dep)) {
          dfs(dep, [...path, node]);
        }
      }
    }

    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node, []);
    if (cycles.length >= 5) break; // Limit to avoid noise
  }

  return cycles;
}

// ── Scoring ───────────────────────────────────────────────

interface ScoreInputs {
  readonly testCoverage: number;
  readonly todoCount: number;
  readonly avgFileSize: number;
  readonly largestFileLines: number;
  readonly deadCodeCount: number;
  readonly circularDepCount: number;
  readonly fileCount: number;
}

function computeHealthScore(inputs: ScoreInputs): number {
  let score = 100;

  // Test coverage: -30 max penalty
  score -= Math.round((1 - inputs.testCoverage) * 30);

  // Markers: -1 per marker, max -15
  score -= Math.min(15, inputs.todoCount);

  // Average file size: penalty for large files
  if (inputs.avgFileSize > MAX_ALLOWED_FILE_LINES) {
    score -= 15;
  } else if (inputs.avgFileSize > MAX_HEALTHY_FILE_LINES) {
    score -= 8;
  }

  // Largest file: penalty if over 800 lines
  if (inputs.largestFileLines > MAX_ALLOWED_FILE_LINES) {
    score -= 10;
  }

  // Dead code: -1 per signal, max -10
  score -= Math.min(10, inputs.deadCodeCount);

  // Circular deps: -5 per cycle, max -15
  score -= Math.min(15, inputs.circularDepCount * 5);

  // No files at all is unhealthy
  if (inputs.fileCount === 0) {
    score = 0;
  }

  return Math.max(0, Math.min(100, score));
}

// ── Type Error / Lint Warning Counting ──────────────────

/**
 * Run `tsc --noEmit` and count errors. Returns 0 if tsc not available.
 */
function countTypeErrors(projectDir: string): number {
  try {
    execFileSync("npx", ["tsc", "--noEmit"], {
      cwd: projectDir,
      timeout: 30000,
      stdio: "pipe",
    });
    return 0; // Clean compile
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? "";
    const stdout = (err as { stdout?: Buffer })?.stdout?.toString() ?? "";
    const output = stderr + stdout;
    // Count "error TS" occurrences
    const matches = output.match(/error TS\d+/g);
    return matches?.length ?? 0;
  }
}

/**
 * Count lint warnings by scanning for common lint tool output patterns.
 * Tries npx eslint or biome check, returns 0 if neither available.
 */
function countLintWarnings(projectDir: string): number {
  // Try biome first (faster)
  try {
    const result = execFileSync("npx", ["biome", "check", "--max-diagnostics=100", "."], {
      cwd: projectDir,
      timeout: 30000,
      stdio: "pipe",
    });
    const output = result.toString();
    const matches = output.match(/warning/gi);
    return matches?.length ?? 0;
  } catch {
    // biome not available or returned errors
  }

  // Fall back to eslint
  try {
    execFileSync("npx", ["eslint", ".", "--format=compact", "--max-warnings=100"], {
      cwd: projectDir,
      timeout: 30000,
      stdio: "pipe",
    });
    return 0;
  } catch (err: unknown) {
    const output = (err as { stdout?: Buffer })?.stdout?.toString() ?? "";
    const matches = output.match(/warning/gi);
    return matches?.length ?? 0;
  }
}
