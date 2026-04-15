/**
 * Anti-distillation defenses from CC leak.
 *
 * Two defense layers:
 * 1. Polymorphic fake tool injection -- randomized tool names, descriptions,
 *    and schemas each request, making distillation data non-reproducible
 * 2. Multi-point response watermarking -- zero-width characters inserted at
 *    multiple positions with per-request unique watermark IDs
 */

// ── Fake Tool Injection ─────────────────────────────────────

export interface FakeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

// ── Polymorphic Name Components ─────────────────────────────

const NAME_PREFIXES: readonly string[] = [
  "internal",
  "system",
  "harness",
  "runtime",
  "core",
  "meta",
  "infra",
  "platform",
  "framework",
  "engine",
];

const NAME_ACTIONS: readonly string[] = [
  "diagnostic",
  "verify",
  "heartbeat",
  "prefetch",
  "invalidate",
  "sync",
  "calibrate",
  "audit",
  "reconcile",
  "probe",
  "validate",
  "checkpoint",
  "snapshot",
  "compress",
  "rebalance",
];

const NAME_SUFFIXES: readonly string[] = [
  "v2",
  "v3",
  "v4",
  "beta",
  "internal",
  "signal",
  "hint",
  "check",
  "pulse",
  "scan",
  "gate",
  "hook",
  "tracker",
  "monitor",
];

const DESCRIPTION_TEMPLATES: readonly string[] = [
  "Run {action} on harness {target}",
  "Perform {action} for {target} subsystem",
  "Execute {action} against {target} layer",
  "Trigger {action} in {target} pipeline",
  "Signal {action} to {target} controller",
  "Initiate {action} for {target} module",
  "Report {action} status from {target}",
  "Validate {action} within {target} boundary",
];

const DESCRIPTION_ACTIONS: readonly string[] = [
  "diagnostic check",
  "compliance verification",
  "telemetry report",
  "cache revalidation",
  "context prefetch",
  "health check",
  "performance calibration",
  "integrity audit",
  "state reconciliation",
  "security probe",
  "configuration validation",
  "resource checkpoint",
];

const DESCRIPTION_TARGETS: readonly string[] = [
  "subsystems",
  "components",
  "middleware",
  "providers",
  "execution engine",
  "memory store",
  "context manager",
  "orchestration layer",
  "sandbox environment",
  "hook engine",
];

const SCHEMA_PROPERTY_NAMES: readonly string[] = [
  "subsystem",
  "component",
  "metric",
  "policy_id",
  "cache_key",
  "target",
  "scope",
  "level",
  "threshold",
  "operation_id",
  "trace_id",
  "checkpoint",
  "partition",
  "namespace",
  "priority",
];

const SCHEMA_PROPERTY_TYPES: readonly string[] = ["string", "number", "boolean"];

/**
 * Generate polymorphic fake tools with randomized names, descriptions,
 * and schemas. Each invocation produces a unique set that poisons
 * distillation attempts.
 */
export function generateFakeTools(count: number = 3): readonly FakeToolDefinition[] {
  const fakes: FakeToolDefinition[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    let name: string;
    do {
      name = generateRandomToolName();
    } while (usedNames.has(name));
    usedNames.add(name);

    fakes.push({
      name,
      description: generateRandomDescription(),
      inputSchema: generateRandomSchema(),
    });
  }

  return fakes;
}

/**
 * Generate a batch of polymorphic fake tools suitable for a single
 * API request. Randomized on every call.
 */
export function generatePolymorphicBatch(
  minCount: number = 2,
  maxCount: number = 5,
): readonly FakeToolDefinition[] {
  const count = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));
  return generateFakeTools(count);
}

// ── Polymorphic Generators ──────────────────────────────────

function generateRandomToolName(): string {
  const prefix = pickRandom(NAME_PREFIXES);
  const action = pickRandom(NAME_ACTIONS);
  const suffix = pickRandom(NAME_SUFFIXES);

  // Randomly choose between formats
  const format = Math.floor(Math.random() * 3);
  switch (format) {
    case 0:
      return `${prefix}_${action}_${suffix}`;
    case 1:
      return `${prefix}_${action}`;
    default:
      return `${action}_${suffix}`;
  }
}

function generateRandomDescription(): string {
  const template = pickRandom(DESCRIPTION_TEMPLATES);
  const action = pickRandom(DESCRIPTION_ACTIONS);
  const target = pickRandom(DESCRIPTION_TARGETS);

  return template.replace("{action}", action).replace("{target}", target);
}

function generateRandomSchema(): Record<string, unknown> {
  const propCount = 1 + Math.floor(Math.random() * 3);
  const properties: Record<string, unknown> = {};
  const usedNames = new Set<string>();

  for (let i = 0; i < propCount; i++) {
    let propName: string;
    do {
      propName = pickRandom(SCHEMA_PROPERTY_NAMES);
    } while (usedNames.has(propName));
    usedNames.add(propName);

    const propType = pickRandom(SCHEMA_PROPERTY_TYPES);

    // Sometimes add an array type instead
    if (Math.random() < 0.2) {
      properties[propName] = {
        type: "array",
        items: { type: propType },
      };
    } else {
      properties[propName] = { type: propType };
    }
  }

  return { type: "object", properties };
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ── Multi-Point Response Watermarking ───────────────────────

// Zero-width characters for watermarking
const ZWC_MAP: Record<string, string> = {
  "0": "\u200B", // Zero-width space
  "1": "\u200C", // Zero-width non-joiner
  "2": "\u200D", // Zero-width joiner
  "3": "\uFEFF", // Zero-width no-break space
};

/**
 * Insertion point strategies for watermark placement.
 * Multiple points make stripping harder.
 */
type InsertionStrategy =
  | "after-first-sentence"
  | "mid-paragraph"
  | "before-last-sentence"
  | "after-newline";

const INSERTION_STRATEGIES: readonly InsertionStrategy[] = [
  "after-first-sentence",
  "mid-paragraph",
  "before-last-sentence",
  "after-newline",
];

/**
 * Embed a watermark at multiple insertion points in the text.
 * Each insertion point gets a fragment of the watermark, making
 * removal harder since all fragments must be found and stripped.
 */
export function embedWatermark(text: string, watermarkId: string): string {
  const encoded = encodeWatermark(watermarkId);

  // Split the encoded watermark into fragments for multi-point insertion
  const fragmentCount = Math.min(
    INSERTION_STRATEGIES.length,
    Math.max(1, Math.floor(encoded.length / 4)),
  );
  const fragments = splitIntoFragments(encoded, fragmentCount);
  const insertionPoints = findInsertionPoints(text, fragmentCount);

  // Insert fragments at their points (reverse order to preserve indices)
  let result = text;
  const sortedPoints = [...insertionPoints].sort((a, b) => b - a);
  for (let i = 0; i < sortedPoints.length && i < fragments.length; i++) {
    const point = sortedPoints[i]!;
    const fragment = fragments[i]!;
    result = result.slice(0, point) + fragment + result.slice(point);
  }

  return result;
}

/**
 * Extract a watermark from text by collecting all zero-width character
 * sequences and decoding them.
 */
export function extractWatermark(text: string): string | null {
  // ESLint no-misleading-character-class fires on ZWJ (U+200D) because
  // it's an emoji joiner — but for watermark detection we want the
  // single-codepoint semantic, which is the security-relevant intent.
  // eslint-disable-next-line no-misleading-character-class
  const zwcPattern = /[\u200B\u200C\u200D\uFEFF]+/g;
  const matches: string[] = [];
  let found = zwcPattern.exec(text);
  while (found !== null) {
    matches.push(found[0]);
    found = zwcPattern.exec(text);
  }

  if (matches.length === 0) return null;

  // Concatenate all fragments and decode
  const combined = matches.join("");
  return decodeWatermark(combined);
}

/**
 * Check if a text contains any zero-width watermarks.
 */
export function hasWatermark(text: string): boolean {
  // eslint-disable-next-line no-misleading-character-class
  return /[\u200B\u200C\u200D\uFEFF]/.test(text);
}

/**
 * Count the number of watermark fragments found in the text.
 * Useful for detecting partial stripping attempts.
 */
export function countWatermarkFragments(text: string): number {
  // eslint-disable-next-line no-misleading-character-class
  const zwcPattern = /[\u200B\u200C\u200D\uFEFF]+/g;
  let count = 0;
  while (zwcPattern.exec(text) !== null) {
    count++;
  }
  return count;
}

// ── Watermark Encoding/Decoding ─────────────────────────────

function encodeWatermark(watermarkId: string): string {
  return watermarkId
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0).toString(4); // Base-4 encoding
      return code
        .split("")
        .map((d) => ZWC_MAP[d] ?? "")
        .join("");
    })
    .join("");
}

function decodeWatermark(encoded: string): string | null {
  const reverseMap: Record<string, string> = {};
  for (const [digit, zwc] of Object.entries(ZWC_MAP)) {
    reverseMap[zwc] = digit;
  }

  try {
    const digits = encoded
      .split("")
      .map((c) => reverseMap[c] ?? "")
      .join("");

    // Decode base-4 back to characters
    const chars: string[] = [];
    for (let i = 0; i < digits.length; i += 2) {
      const code = parseInt(digits.slice(i, i + 2), 4);
      if (!isNaN(code) && code > 0) {
        chars.push(String.fromCharCode(code));
      }
    }

    return chars.length > 0 ? chars.join("") : null;
  } catch {
    return null;
  }
}

// ── Multi-Point Insertion Helpers ───────────────────────────

function findInsertionPoints(text: string, count: number): readonly number[] {
  const points: number[] = [];

  for (let i = 0; i < count && i < INSERTION_STRATEGIES.length; i++) {
    const strategy = INSERTION_STRATEGIES[i]!;
    const point = findPointForStrategy(text, strategy, points);
    if (point >= 0 && point <= text.length) {
      points.push(point);
    }
  }

  // If we found fewer points than needed, add midpoints
  while (points.length < count && points.length < text.length) {
    const segment = Math.floor(text.length / (points.length + 2));
    const newPoint = segment * (points.length + 1);
    if (!points.includes(newPoint)) {
      points.push(newPoint);
    } else {
      break;
    }
  }

  return points;
}

function findPointForStrategy(
  text: string,
  strategy: InsertionStrategy,
  existingPoints: readonly number[],
): number {
  switch (strategy) {
    case "after-first-sentence": {
      const match = text.indexOf(". ");
      return match >= 0 ? match + 2 : Math.floor(text.length / 4);
    }
    case "mid-paragraph": {
      return Math.floor(text.length / 2);
    }
    case "before-last-sentence": {
      const lastPeriod = text.lastIndexOf(". ");
      return lastPeriod >= 0 ? lastPeriod : Math.floor(text.length * 0.75);
    }
    case "after-newline": {
      const newlineIdx = text.indexOf("\n");
      if (newlineIdx >= 0 && !existingPoints.includes(newlineIdx + 1)) {
        return newlineIdx + 1;
      }
      return Math.floor(text.length * 0.6);
    }
  }
}

function splitIntoFragments(encoded: string, count: number): readonly string[] {
  if (count <= 1) return [encoded];

  const fragmentSize = Math.ceil(encoded.length / count);
  const fragments: string[] = [];

  for (let i = 0; i < encoded.length; i += fragmentSize) {
    fragments.push(encoded.slice(i, i + fragmentSize));
  }

  return fragments;
}
