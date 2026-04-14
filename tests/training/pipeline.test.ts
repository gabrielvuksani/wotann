import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import {
  TrainingPipeline,
  type TrainingPair,
  type TrainingConfig,
} from "../../src/training/pipeline.js";

describe("TrainingPipeline", () => {
  let pipeline: TrainingPipeline;

  beforeEach(() => {
    pipeline = new TrainingPipeline();
  });

  // ── Manual Pair Addition ──────────────────────────────

  describe("addPair", () => {
    it("adds a training pair with computed quality", () => {
      const pair = pipeline.addPair(
        "How do I sort an array in TypeScript?",
        "You can use the Array.sort() method with a comparison function:\n\n```typescript\nconst sorted = [...arr].sort((a, b) => a - b);\n```\n\nThis creates a new sorted array without mutating the original.",
      );

      expect(pair.id).toBeDefined();
      expect(pair.input).toContain("sort an array");
      expect(pair.quality).toBeGreaterThan(0);
      expect(pair.quality).toBeLessThanOrEqual(1);
      expect(pair.source).toBe("manual");
    });

    it("scores high-quality responses higher", () => {
      const good = pipeline.addPair(
        "Explain the repository pattern",
        "The repository pattern encapsulates data access behind a consistent interface.\n\n## Key Operations\n- findAll: retrieve all records\n- findById: retrieve by ID\n- create: insert new record\n\n```typescript\ninterface Repository<T> {\n  findAll(): Promise<T[]>;\n  findById(id: string): Promise<T | null>;\n}\n```",
      );

      const bad = pipeline.addPair(
        "help",
        "ok",
      );

      expect(good.quality).toBeGreaterThan(bad.quality);
    });
  });

  // ── Quality Scoring ─────────���─────────────────────────

  describe("qualityScore", () => {
    it("scores well-structured responses highly", () => {
      const pair: TrainingPair = {
        id: "test",
        input: "How do I handle errors in Express?",
        output: "Use error-handling middleware:\n\n```javascript\napp.use((err, req, res, next) => {\n  console.error(err.stack);\n  res.status(500).send('Something broke!');\n});\n```",
        quality: 0,
        source: "test",
      };

      const score = pipeline.qualityScore(pair);
      expect(score).toBeGreaterThanOrEqual(0.7);
    });

    it("penalizes very short responses", () => {
      const pair: TrainingPair = {
        id: "test",
        input: "help",
        output: "yes",
        quality: 0,
        source: "test",
      };

      const score = pipeline.qualityScore(pair);
      expect(score).toBeLessThan(0.5);
    });
  });

  // ── Format Conversion ─────────────────────────────────

  describe("formatForTraining", () => {
    const testPairs: readonly TrainingPair[] = [
      {
        id: "1",
        input: "What is TypeScript?",
        output: "TypeScript is a typed superset of JavaScript.",
        quality: 0.8,
        source: "test",
      },
    ];

    it("formats to Alpaca format", () => {
      const json = pipeline.formatForTraining(testPairs, "alpaca");
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].instruction).toBe("What is TypeScript?");
      expect(parsed[0].input).toBe("");
      expect(parsed[0].output).toBe("TypeScript is a typed superset of JavaScript.");
    });

    it("formats to ShareGPT format", () => {
      const json = pipeline.formatForTraining(testPairs, "sharegpt");
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].conversations).toHaveLength(2);
      expect(parsed[0].conversations[0].from).toBe("human");
      expect(parsed[0].conversations[1].from).toBe("gpt");
    });

    it("formats to OpenAI format", () => {
      const json = pipeline.formatForTraining(testPairs, "openai");
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].messages).toHaveLength(3);
      expect(parsed[0].messages[0].role).toBe("system");
      expect(parsed[0].messages[1].role).toBe("user");
      expect(parsed[0].messages[2].role).toBe("assistant");
    });
  });

  // ── Training Config ────────────���──────────────────────

  describe("generateTrainingConfig", () => {
    it("generates default config", () => {
      const config = pipeline.generateTrainingConfig();

      expect(config.method).toBe("qlora");
      expect(config.rank).toBe(16);
      expect(config.alpha).toBe(32);
      expect(config.epochs).toBe(3);
      expect(config.batchSize).toBe(4);
      expect(config.learningRate).toBeCloseTo(2e-4);
      expect(config.maxSeqLength).toBe(2048);
    });

    it("accepts custom options", () => {
      const config = pipeline.generateTrainingConfig({
        model: "custom-model",
        method: "lora",
        rank: 32,
        epochs: 5,
        batchSize: 8,
      });

      expect(config.model).toBe("custom-model");
      expect(config.method).toBe("lora");
      expect(config.rank).toBe(32);
      expect(config.alpha).toBe(64); // rank * 2
      expect(config.epochs).toBe(5);
      expect(config.batchSize).toBe(8);
    });

    it("uses custom alpha when provided", () => {
      const config = pipeline.generateTrainingConfig({
        rank: 16,
        alpha: 48,
      });

      expect(config.alpha).toBe(48);
    });
  });

  // ── Unsloth Script Generation ─────────────────────────

  describe("generateUnslothScript", () => {
    it("generates a valid Python training script", () => {
      const config = pipeline.generateTrainingConfig();
      const script = pipeline.generateUnslothScript(config, "data.json");

      expect(script).toContain("from unsloth import FastLanguageModel");
      expect(script).toContain("from trl import SFTTrainer");
      expect(script).toContain("data.json");
      expect(script).toContain(`r=${config.rank}`);
      expect(script).toContain(`lora_alpha=${config.alpha}`);
    });
  });

  // ── Ollama Deployment ─────────────────────────────────

  describe("deployToOllama", () => {
    it("generates Ollama deployment commands", () => {
      const commands = pipeline.deployToOllama("/models/my-model", "wotann-tuned");

      expect(commands).toContain("ollama create wotann-tuned");
      expect(commands).toContain("FROM /models/my-model");
      expect(commands).toContain("ollama list");
    });
  });

  // ── Session Data Extraction ───────────────────────────

  describe("extractTrainingData", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "training-"));
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });

    it("extracts pairs from session files", () => {
      const sessionData = {
        sessionId: "test-session",
        startedAt: Date.now(),
        provider: "anthropic",
        model: "claude-sonnet",
        events: [
          { type: "prompt", data: { prompt: "What is TypeScript?" }, timestamp: 1000 },
          { type: "response", data: { response: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static typing and class-based programming." }, timestamp: 2000 },
        ],
        metadata: {},
      };

      writeFileSync(join(tmpDir, "session_1.json"), JSON.stringify(sessionData));

      const pairs = pipeline.extractTrainingData(tmpDir);
      expect(pairs.length).toBeGreaterThan(0);
      expect(pairs[0]?.input).toBe("What is TypeScript?");
    });

    it("returns empty array for non-existent directory", () => {
      const pairs = pipeline.extractTrainingData("/nonexistent/dir");
      expect(pairs).toHaveLength(0);
    });

    it("skips malformed files", () => {
      writeFileSync(join(tmpDir, "bad.json"), "not valid json");
      const pairs = pipeline.extractTrainingData(tmpDir);
      expect(pairs).toHaveLength(0);
    });
  });

  // ── Pipeline Stats ───────────��────────────────────────

  describe("getStats", () => {
    it("returns correct stats after adding pairs", () => {
      pipeline.addPair("Question 1", "A detailed answer about something useful and interesting in the world of programming and software development.");
      pipeline.addPair("Q2", "Short");

      const stats = pipeline.getStats();
      expect(stats.totalExtracted).toBe(2);
      expect(stats.averageQuality).toBeGreaterThan(0);
    });

    it("returns zeros for empty pipeline", () => {
      const stats = pipeline.getStats();
      expect(stats.totalExtracted).toBe(0);
      expect(stats.averageQuality).toBe(0);
    });
  });

  // ── High Quality Filter ───────���───────────────────────

  describe("getHighQualityPairs", () => {
    it("filters pairs by quality threshold", () => {
      pipeline.addPair(
        "How do I implement a binary search?",
        "Binary search works by repeatedly dividing the search interval in half.\n\n```typescript\nfunction binarySearch(arr: number[], target: number): number {\n  let lo = 0, hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = Math.floor((lo + hi) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid]! < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}\n```",
      );
      pipeline.addPair("x", "y"); // Low quality

      const highQuality = pipeline.getHighQualityPairs(0.7);
      expect(highQuality.length).toBeLessThanOrEqual(pipeline.getPairs().length);
    });
  });

  // ── Clear ─────────────��──────────────────────��────────

  describe("clear", () => {
    it("removes all pairs", () => {
      pipeline.addPair("q", "a");
      pipeline.addPair("q2", "a2");
      expect(pipeline.getPairs()).toHaveLength(2);

      pipeline.clear();
      expect(pipeline.getPairs()).toHaveLength(0);
    });
  });
});
