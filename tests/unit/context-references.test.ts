import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  parseReferences,
  resolveReferences,
  expandPromptWithReferences,
  getCompletions,
} from "../../src/ui/context-references.js";

// ── Helpers ──────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wotann-ctx-refs-"));
}

function initGitRepo(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "initial.txt"), "initial\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir, stdio: "ignore" });
}

// ── parseReferences ──────────────────────────────────────

describe("parseReferences", () => {
  it("extracts typed references from a prompt", () => {
    const input = "check @file:src/main.ts and @git:diff";
    const refs = parseReferences(input);
    expect(refs).toEqual(["file:src/main.ts", "git:diff"]);
  });

  it("extracts bare file paths starting with ./", () => {
    const refs = parseReferences("review @./src/utils.ts please");
    expect(refs).toEqual(["./src/utils.ts"]);
  });

  it("extracts bare file paths starting with /", () => {
    const refs = parseReferences("look at @/tmp/file.txt");
    expect(refs).toEqual(["/tmp/file.txt"]);
  });

  it("extracts @url references", () => {
    const refs = parseReferences("see @url:https://example.com/api");
    expect(refs).toEqual(["url:https://example.com/api"]);
  });

  it("extracts @memory references", () => {
    const refs = parseReferences("recall @memory:auth-patterns");
    expect(refs).toEqual(["memory:auth-patterns"]);
  });

  it("extracts @skill references", () => {
    const refs = parseReferences("use @skill:tdd-workflow");
    expect(refs).toEqual(["skill:tdd-workflow"]);
  });

  it("extracts bare @context", () => {
    const refs = parseReferences("show me @context");
    expect(refs).toEqual(["context"]);
  });

  it("extracts @context: with colon prefix", () => {
    const refs = parseReferences("show me @context:summary");
    expect(refs).toEqual(["context:summary"]);
  });

  it("deduplicates repeated references", () => {
    const refs = parseReferences("@file:a.ts and @file:a.ts again");
    expect(refs).toEqual(["file:a.ts"]);
  });

  it("returns empty array for no references", () => {
    expect(parseReferences("plain text with no refs")).toEqual([]);
  });

  it("handles multiple references of different types", () => {
    const input = "@file:a.ts @git:log @url:https://x.com @memory:auth @skill:tdd @context";
    const refs = parseReferences(input);
    expect(refs).toHaveLength(6);
    expect(refs).toContain("file:a.ts");
    expect(refs).toContain("git:log");
    expect(refs).toContain("url:https://x.com");
    expect(refs).toContain("memory:auth");
    expect(refs).toContain("skill:tdd");
    expect(refs).toContain("context");
  });

  it("handles references at start of input", () => {
    const refs = parseReferences("@file:main.ts review this");
    expect(refs).toEqual(["file:main.ts"]);
  });
});

// ── resolveReferences ────────────────────────────────────

describe("resolveReferences", () => {
  describe("file resolution", () => {
    it("resolves existing files to their content", async () => {
      const dir = makeTempDir();
      try {
        writeFileSync(join(dir, "hello.txt"), "hello world\n");
        const resolved = await resolveReferences(["file:hello.txt"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.type).toBe("file");
        expect(resolved[0]!.content).toBe("hello world\n");
        expect(resolved[0]!.tokenEstimate).toBeGreaterThan(0);
        expect(resolved[0]!.error).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns error for missing files", async () => {
      const dir = makeTempDir();
      try {
        const resolved = await resolveReferences(["file:nonexistent.ts"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.error).toContain("File not found");
        expect(resolved[0]!.content).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("resolves bare paths starting with ./", async () => {
      const dir = makeTempDir();
      try {
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "app.ts"), "const app = 1;\n");
        const resolved = await resolveReferences(["./src/app.ts"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.type).toBe("file");
        expect(resolved[0]!.content).toBe("const app = 1;\n");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("url resolution", () => {
    it("fetches real URL content and extracts title", async () => {
      const resolved = await resolveReferences(["url:https://example.com"], "/tmp");

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.type).toBe("url");
      expect(resolved[0]!.content).toContain("https://example.com");
      // Real fetch returns the page title and HTML content
      expect(resolved[0]!.content).toContain("Example Domain");
      expect(resolved[0]!.error).toBeUndefined();
    });
  });

  describe("git resolution", () => {
    it("resolves @git:diff in a git repo", async () => {
      const dir = makeTempDir();
      try {
        initGitRepo(dir);
        writeFileSync(join(dir, "initial.txt"), "modified\n");

        const resolved = await resolveReferences(["git:diff"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.type).toBe("git");
        expect(resolved[0]!.content).toContain("modified");
        expect(resolved[0]!.error).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("resolves @git:log in a git repo", async () => {
      const dir = makeTempDir();
      try {
        initGitRepo(dir);

        const resolved = await resolveReferences(["git:log"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.type).toBe("git");
        expect(resolved[0]!.content).toContain("initial commit");
        expect(resolved[0]!.error).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns error for unknown git subcommands", async () => {
      const resolved = await resolveReferences(["git:unknown"], "/tmp");

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.error).toContain("Unknown git subcommand");
    });

    it("returns error when git fails (not a repo)", async () => {
      const dir = makeTempDir();
      try {
        const resolved = await resolveReferences(["git:log"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.error).toContain("failed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("memory resolution", () => {
    it("returns unavailable message when no searchMemory function provided", async () => {
      const resolved = await resolveReferences(["memory:auth-patterns"], "/tmp");

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.type).toBe("memory");
      expect(resolved[0]!.content).toContain("Memory search unavailable");
      expect(resolved[0]!.error).toContain("No runtime searchMemory");
    });

    it("returns real results when searchMemory function is provided", async () => {
      const mockSearch = (query: string) => [
        { id: "mem-1", score: 0.95, text: `Result for ${query}`, type: "memory" },
      ];
      const resolved = await resolveReferences(["memory:auth-patterns"], "/tmp", mockSearch);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.type).toBe("memory");
      expect(resolved[0]!.content).toContain("Memory search results");
      expect(resolved[0]!.content).toContain("auth-patterns");
      expect(resolved[0]!.content).toContain("Result for auth-patterns");
      expect(resolved[0]!.error).toBeUndefined();
    });

    it("returns no-results message when search returns empty", async () => {
      const mockSearch = () => [] as readonly { id: string; score: number; text: string; type: string }[];
      const resolved = await resolveReferences(["memory:unknown-topic"], "/tmp", mockSearch);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.type).toBe("memory");
      expect(resolved[0]!.content).toContain("no results");
    });
  });

  describe("skill resolution", () => {
    it("resolves a skill from the skills/ directory", async () => {
      const dir = makeTempDir();
      try {
        mkdirSync(join(dir, "skills", "tdd"), { recursive: true });
        writeFileSync(join(dir, "skills", "tdd", "SKILL.md"), "# TDD Skill\nRed-green-refactor\n");

        const resolved = await resolveReferences(["skill:tdd"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.type).toBe("skill");
        expect(resolved[0]!.content).toContain("TDD Skill");
        expect(resolved[0]!.error).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns error for missing skills", async () => {
      const dir = makeTempDir();
      try {
        const resolved = await resolveReferences(["skill:nonexistent"], dir);

        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.error).toContain("Skill not found");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("context resolution", () => {
    it("returns a stub placeholder for @context", async () => {
      const resolved = await resolveReferences(["context"], "/tmp");

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.type).toBe("context");
      expect(resolved[0]!.content).toContain("context window summary");
    });
  });

  describe("multiple references", () => {
    it("resolves multiple references of different types", async () => {
      const dir = makeTempDir();
      try {
        writeFileSync(join(dir, "readme.md"), "# Hello\n");

        const resolved = await resolveReferences(
          ["file:readme.md", "url:https://example.com", "context"],
          dir,
        );

        expect(resolved).toHaveLength(3);
        expect(resolved[0]!.type).toBe("file");
        expect(resolved[1]!.type).toBe("url");
        expect(resolved[2]!.type).toBe("context");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// ── expandPromptWithReferences ───────────────────────────

describe("expandPromptWithReferences", () => {
  it("returns input unchanged when no references resolved", () => {
    const result = expandPromptWithReferences("hello world", []);
    expect(result).toBe("hello world");
  });

  it("appends resolved content as labeled blocks", () => {
    const resolved: readonly import("../../src/ui/context-references.js").ResolvedReference[] = [
      {
        type: "file",
        reference: "file:main.ts",
        content: "const x = 1;",
        tokenEstimate: 4,
      },
    ];

    const result = expandPromptWithReferences("review this", resolved);
    expect(result).toContain("review this");
    expect(result).toContain("@file:main.ts");
    expect(result).toContain("~4 tokens");
    expect(result).toContain("const x = 1;");
  });

  it("shows error messages for failed resolutions", () => {
    const resolved: readonly import("../../src/ui/context-references.js").ResolvedReference[] = [
      {
        type: "file",
        reference: "file:missing.ts",
        content: "",
        tokenEstimate: 0,
        error: "File not found: missing.ts",
      },
    ];

    const result = expandPromptWithReferences("check @file:missing.ts", resolved);
    expect(result).toContain("Error resolving @file:missing.ts");
    expect(result).toContain("File not found");
  });

  it("appends multiple blocks in order", () => {
    const resolved: readonly import("../../src/ui/context-references.js").ResolvedReference[] = [
      { type: "file", reference: "file:a.ts", content: "aaa", tokenEstimate: 1 },
      { type: "file", reference: "file:b.ts", content: "bbb", tokenEstimate: 1 },
    ];

    const result = expandPromptWithReferences("both files", resolved);
    const aIndex = result.indexOf("@file:a.ts");
    const bIndex = result.indexOf("@file:b.ts");
    expect(aIndex).toBeLessThan(bIndex);
  });
});

// ── getCompletions ───────────────────────────────────────

describe("getCompletions", () => {
  it("returns empty for input not starting with @", () => {
    expect(getCompletions("hello", "/tmp")).toEqual([]);
  });

  it("returns all reference types for bare @", () => {
    const completions = getCompletions("@", "/tmp");
    expect(completions).toContain("@file:");
    expect(completions).toContain("@url:");
    expect(completions).toContain("@git:");
    expect(completions).toContain("@memory:");
    expect(completions).toContain("@skill:");
    expect(completions).toContain("@context:");
    expect(completions).toHaveLength(6);
  });

  it("filters type names for partial type", () => {
    const completions = getCompletions("@fi", "/tmp");
    expect(completions).toEqual(["@file:"]);
  });

  it("shows git subcommands for @git:", () => {
    const completions = getCompletions("@git:", "/tmp");
    expect(completions).toContain("@git:diff");
    expect(completions).toContain("@git:log");
    expect(completions).toContain("@git:status");
    expect(completions).toContain("@git:branch");
  });

  it("filters git subcommands by partial input", () => {
    const completions = getCompletions("@git:d", "/tmp");
    expect(completions).toEqual(["@git:diff"]);
  });

  it("lists files for @file: prefix", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, "alpha.ts"), "");
      writeFileSync(join(dir, "beta.ts"), "");
      mkdirSync(join(dir, "src"));

      const completions = getCompletions("@file:", dir);
      expect(completions).toContain("@file:alpha.ts");
      expect(completions).toContain("@file:beta.ts");
      expect(completions).toContain("@file:src/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists files in subdirectory for @file:src/", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "main.ts"), "");
      writeFileSync(join(dir, "src", "utils.ts"), "");

      const completions = getCompletions("@file:src/", dir);
      expect(completions).toContain("@file:src/main.ts");
      expect(completions).toContain("@file:src/utils.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists skills for @skill: prefix", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "skills", "tdd"), { recursive: true });
      mkdirSync(join(dir, "skills", "debug"), { recursive: true });

      const completions = getCompletions("@skill:", dir);
      expect(completions).toContain("@skill:debug");
      expect(completions).toContain("@skill:tdd");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters skills by partial name", () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, "skills", "tdd"), { recursive: true });
      mkdirSync(join(dir, "skills", "debug"), { recursive: true });

      const completions = getCompletions("@skill:t", dir);
      expect(completions).toEqual(["@skill:tdd"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for @memory: (requires runtime context)", () => {
    expect(getCompletions("@memory:", "/tmp")).toEqual([]);
  });

  it("returns empty for @url: (not practical to complete)", () => {
    expect(getCompletions("@url:", "/tmp")).toEqual([]);
  });
});
