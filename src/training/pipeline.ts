/**
 * Training Pipeline -- ML fine-tuning data extraction and configuration.
 *
 * From nanochat: full training for $100. Extracts Q&A pairs from session
 * recordings, scores quality, formats for training (Alpaca/ShareGPT/OpenAI),
 * and generates LoRA/QLoRA training configurations.
 *
 * Pipeline:
 * 1. Extract training pairs from session data
 * 2. Score quality of each pair (0-1)
 * 3. Format for target training framework
 * 4. Generate training config (LoRA/QLoRA)
 * 5. Deploy to Ollama
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────

export interface TrainingPair {
  readonly id: string;
  readonly input: string;
  readonly output: string;
  readonly quality: number;
  readonly source: string;
}

export type TrainingFormat = "alpaca" | "sharegpt" | "openai";

export type TrainingMethod = "lora" | "qlora" | "full";

export interface TrainingConfig {
  readonly model: string;
  readonly method: TrainingMethod;
  readonly rank: number;
  readonly alpha: number;
  readonly epochs: number;
  readonly batchSize: number;
  readonly learningRate: number;
  readonly warmupSteps: number;
  readonly maxSeqLength: number;
  readonly outputDir: string;
}

export interface AlpacaEntry {
  readonly instruction: string;
  readonly input: string;
  readonly output: string;
}

export interface ShareGPTEntry {
  readonly conversations: readonly {
    readonly from: "human" | "gpt";
    readonly value: string;
  }[];
}

export interface OpenAIEntry {
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant";
    readonly content: string;
  }[];
}

export interface PipelineStats {
  readonly totalExtracted: number;
  readonly totalFiltered: number;
  readonly averageQuality: number;
  readonly formatUsed: TrainingFormat;
}

// ── Quality Scoring ──────────────────────────────────────

const QUALITY_INDICATORS = {
  minOutputLength: 50,
  maxOutputLength: 4000,
  minInputLength: 10,
  codeBlockBonus: 0.15,
  structuredResponseBonus: 0.1,
  shortResponsePenalty: -0.2,
  veryLongPenalty: -0.1,
} as const;

function computeQualityScore(pair: {
  readonly input: string;
  readonly output: string;
}): number {
  let score = 0.5; // Base score

  // Length-based scoring
  const outLen = pair.output.length;
  if (outLen >= QUALITY_INDICATORS.minOutputLength && outLen <= QUALITY_INDICATORS.maxOutputLength) {
    score += 0.2;
  }
  if (outLen < QUALITY_INDICATORS.minOutputLength) {
    score += QUALITY_INDICATORS.shortResponsePenalty;
  }
  if (outLen > QUALITY_INDICATORS.maxOutputLength) {
    score += QUALITY_INDICATORS.veryLongPenalty;
  }

  // Input quality
  if (pair.input.length >= QUALITY_INDICATORS.minInputLength) {
    score += 0.1;
  }

  // Code block presence (structured output)
  if (pair.output.includes("```")) {
    score += QUALITY_INDICATORS.codeBlockBonus;
  }

  // Structured response (headers, bullet points)
  if (/^#+\s|^-\s|^\d+\.\s/m.test(pair.output)) {
    score += QUALITY_INDICATORS.structuredResponseBonus;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
}

// ── Format Converters ────────────────────────────────────

function toAlpaca(pairs: readonly TrainingPair[]): readonly AlpacaEntry[] {
  return pairs.map((pair) => ({
    instruction: pair.input,
    input: "",
    output: pair.output,
  }));
}

function toShareGPT(pairs: readonly TrainingPair[]): readonly ShareGPTEntry[] {
  return pairs.map((pair) => ({
    conversations: [
      { from: "human" as const, value: pair.input },
      { from: "gpt" as const, value: pair.output },
    ],
  }));
}

function toOpenAI(pairs: readonly TrainingPair[]): readonly OpenAIEntry[] {
  return pairs.map((pair) => ({
    messages: [
      { role: "system" as const, content: "You are a helpful AI coding assistant." },
      { role: "user" as const, content: pair.input },
      { role: "assistant" as const, content: pair.output },
    ],
  }));
}

// ── TrainingPipeline Class ───────────────────────────────

export class TrainingPipeline {
  private pairs: TrainingPair[] = [];
  private readonly defaultModel: string;

  constructor(defaultModel: string = "unsloth/llama-3-8b-bnb-4bit") {
    this.defaultModel = defaultModel;
  }

  /**
   * Extract training data from a session directory.
   * Reads session replay JSON files and converts prompt/response events
   * into training pairs.
   */
  extractTrainingData(sessionDir: string): readonly TrainingPair[] {
    if (!existsSync(sessionDir)) return [];

    const files = readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
    const extracted: TrainingPair[] = [];

    for (const file of files) {
      const filePath = join(sessionDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const session = JSON.parse(content) as {
          events?: readonly {
            type: string;
            data: Record<string, unknown>;
          }[];
        };

        if (!session.events || !Array.isArray(session.events)) continue;

        const events = session.events;
        for (let i = 0; i < events.length - 1; i++) {
          const current = events[i];
          const next = events[i + 1];
          if (
            current?.type === "prompt" &&
            next?.type === "response" &&
            typeof current.data["prompt"] === "string" &&
            typeof next.data["response"] === "string"
          ) {
            const input = current.data["prompt"] as string;
            const output = next.data["response"] as string;
            const quality = computeQualityScore({ input, output });

            extracted.push({
              id: randomUUID(),
              input,
              output,
              quality,
              source: file,
            });
          }
        }
      } catch {
        // Skip malformed files
        continue;
      }
    }

    this.pairs = [...this.pairs, ...extracted];
    return extracted;
  }

  /**
   * Score a training pair's quality (0-1).
   */
  qualityScore(pair: TrainingPair): number {
    return computeQualityScore(pair);
  }

  /**
   * Format training pairs for the specified training framework.
   */
  formatForTraining(
    pairs: readonly TrainingPair[],
    format: TrainingFormat,
  ): string {
    switch (format) {
      case "alpaca":
        return JSON.stringify(toAlpaca(pairs), null, 2);
      case "sharegpt":
        return JSON.stringify(toShareGPT(pairs), null, 2);
      case "openai":
        return JSON.stringify(toOpenAI(pairs), null, 2);
    }
  }

  /**
   * Generate a LoRA/QLoRA training configuration.
   */
  generateTrainingConfig(options: {
    readonly model?: string;
    readonly method?: TrainingMethod;
    readonly rank?: number;
    readonly alpha?: number;
    readonly epochs?: number;
    readonly batchSize?: number;
    readonly learningRate?: number;
    readonly maxSeqLength?: number;
    readonly outputDir?: string;
  } = {}): TrainingConfig {
    const method = options.method ?? "qlora";
    const rank = options.rank ?? 16;

    return {
      model: options.model ?? this.defaultModel,
      method,
      rank,
      alpha: options.alpha ?? rank * 2,
      epochs: options.epochs ?? 3,
      batchSize: options.batchSize ?? 4,
      learningRate: options.learningRate ?? 2e-4,
      warmupSteps: 10,
      maxSeqLength: options.maxSeqLength ?? 2048,
      outputDir: options.outputDir ?? "./training-output",
    };
  }

  /**
   * Generate an Unsloth-compatible training script as a string.
   */
  generateUnslothScript(config: TrainingConfig, dataPath: string): string {
    return [
      "# Auto-generated Unsloth training script",
      `# Model: ${config.model}`,
      `# Method: ${config.method} (rank=${config.rank}, alpha=${config.alpha})`,
      "",
      "from unsloth import FastLanguageModel",
      "from trl import SFTTrainer",
      "from transformers import TrainingArguments",
      "from datasets import load_dataset",
      "",
      `model, tokenizer = FastLanguageModel.from_pretrained("${config.model}", max_seq_length=${config.maxSeqLength})`,
      "",
      `model = FastLanguageModel.get_peft_model(model, r=${config.rank}, lora_alpha=${config.alpha})`,
      "",
      `dataset = load_dataset("json", data_files="${dataPath}")`,
      "",
      "trainer = SFTTrainer(",
      "    model=model,",
      "    tokenizer=tokenizer,",
      '    train_dataset=dataset["train"],',
      "    args=TrainingArguments(",
      `        per_device_train_batch_size=${config.batchSize},`,
      `        num_train_epochs=${config.epochs},`,
      `        learning_rate=${config.learningRate},`,
      `        warmup_steps=${config.warmupSteps},`,
      `        output_dir="${config.outputDir}",`,
      "    ),",
      ")",
      "",
      "trainer.train()",
      `model.save_pretrained("${config.outputDir}/final")`,
    ].join("\n");
  }

  /**
   * Generate the command to deploy a fine-tuned model to Ollama.
   */
  deployToOllama(modelPath: string, modelName: string): string {
    return [
      `# Deploy ${modelName} to Ollama`,
      `# 1. Create Modelfile`,
      `echo 'FROM ${modelPath}' > Modelfile`,
      `echo 'PARAMETER temperature 0.7' >> Modelfile`,
      `echo 'PARAMETER top_p 0.9' >> Modelfile`,
      `# 2. Create Ollama model`,
      `ollama create ${modelName} -f Modelfile`,
      `# 3. Verify`,
      `ollama list | grep ${modelName}`,
    ].join("\n");
  }

  /**
   * Get all collected training pairs.
   */
  getPairs(): readonly TrainingPair[] {
    return [...this.pairs];
  }

  /**
   * Get pairs filtered by minimum quality threshold.
   */
  getHighQualityPairs(minQuality: number = 0.7): readonly TrainingPair[] {
    return this.pairs.filter((p) => p.quality >= minQuality);
  }

  /**
   * Get pipeline statistics.
   */
  getStats(format: TrainingFormat = "alpaca"): PipelineStats {
    const highQuality = this.getHighQualityPairs();
    const totalQuality = this.pairs.reduce((sum, p) => sum + p.quality, 0);
    return {
      totalExtracted: this.pairs.length,
      totalFiltered: highQuality.length,
      averageQuality: this.pairs.length > 0 ? totalQuality / this.pairs.length : 0,
      formatUsed: format,
    };
  }

  /**
   * Clear all collected pairs.
   */
  clear(): void {
    this.pairs = [];
  }

  /**
   * Add a manually created training pair.
   */
  addPair(input: string, output: string, source: string = "manual"): TrainingPair {
    const quality = computeQualityScore({ input, output });
    const pair: TrainingPair = {
      id: randomUUID(),
      input,
      output,
      quality,
      source,
    };
    this.pairs = [...this.pairs, pair];
    return pair;
  }
}
