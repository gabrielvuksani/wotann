/**
 * Model-Universal Perception Adapter
 *
 * Adapts Computer Use perception output based on model capabilities:
 * - Frontier vision models (Claude, GPT, Gemini): raw screenshots + pixel coordinates
 * - Mid/small vision models (Gemma vision, Phi vision): Set-of-Mark screenshots + element indices
 * - Text-only models (Gemma 8B, Llama): accessibility tree text + element indices
 *
 * Every model gets the same action space. Only the perception format changes.
 */

import type { ScreenElement, Perception, ElementRef } from "./types.js";

// ── Types ───────────────────────────────────────────────

export type ModelCapabilityTier = "frontier-vision" | "small-vision" | "text-only";

export interface ModelCapabilities {
  readonly vision?: boolean;
  readonly contextWindow?: number;
}

export interface PerceptionOutput {
  /** For vision models: screenshot buffer */
  readonly screenshot?: Buffer;
  /** For SoM models: screenshot with numbered labels overlaid */
  readonly annotatedScreenshot?: Buffer;
  /** For text models: structured text description */
  readonly textDescription?: string;
  /** Element list (always provided) */
  readonly elements: readonly ScreenElement[];
  /** Maximum elements to include (budget by context window) */
  readonly maxElements: number;
  /** How the model should reference elements */
  readonly referenceMode: "coordinate" | "index" | "label";
}

// ── Element Budget Thresholds ───────────────────────────

const ELEMENT_BUDGET_TIERS: readonly { readonly minContext: number; readonly budget: number }[] = [
  { minContext: 128_000, budget: 200 },
  { minContext: 32_000, budget: 100 },
  { minContext: 16_000, budget: 50 },
  { minContext: 8_000, budget: 30 },
  { minContext: 0, budget: 15 },
];

// ── Frontier Model Identifiers ──────────────────────────

const FRONTIER_VISION_MODELS: readonly string[] = [
  "claude-opus",
  "claude-sonnet",
  "gpt-5",
  "gpt-4",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

// ── Interactive Element Types (higher priority in pruning) ──

const INTERACTIVE_TYPES: ReadonlySet<string> = new Set([
  "button", "input", "link", "select", "checkbox",
]);

// ── Scoring Constants ───────────────────────────────────

const SCORE_FOCUSED = 100;
const SCORE_INTERACTIVE = 50;
const SCORE_ENABLED = 20;
const SCORE_HAS_LABEL = 10;

// ── Screen Region Thresholds ────────────────────────────

const REGION_TOP_Y = 200;
const REGION_BOTTOM_Y = 600;
const REGION_LEFT_X = 400;
const REGION_RIGHT_X = 800;

// ── Adapter ─────────────────────────────────────────────

export class PerceptionAdapter {
  /**
   * Classify a model into a capability tier based on its known capabilities.
   */
  classifyModel(modelId: string, capabilities: ModelCapabilities): ModelCapabilityTier {
    if (capabilities.vision && isFrontierVisionModel(modelId)) {
      return "frontier-vision";
    }

    if (capabilities.vision) {
      return "small-vision";
    }

    return "text-only";
  }

  /**
   * Determine max elements based on context window size.
   * Larger context windows can handle more elements without crowding the prompt.
   */
  getElementBudget(contextWindow: number): number {
    const tier = ELEMENT_BUDGET_TIERS.find(t => contextWindow >= t.minContext);
    return tier?.budget ?? 15;
  }

  /**
   * Adapt perception output for the target model.
   * This is the main entry point: given raw perception and a model tier,
   * produce the right format for that model class.
   */
  adapt(
    perception: Perception,
    tier: ModelCapabilityTier,
    contextWindow: number = 200_000,
  ): PerceptionOutput {
    const maxElements = this.getElementBudget(contextWindow);
    const elements = pruneElements(perception.elements, maxElements);

    switch (tier) {
      case "frontier-vision":
        return adaptForFrontierVision(perception, elements, maxElements);

      case "small-vision":
        return adaptForSmallVision(perception, elements, maxElements);

      case "text-only":
        return adaptForTextOnly(perception, elements, maxElements);
    }
  }

  /**
   * Resolve a model-agnostic ElementRef to screen coordinates.
   * Works regardless of how the model referenced the element (coordinate, index, label, role).
   */
  resolveElementRef(
    ref: ElementRef,
    elements: readonly ScreenElement[],
  ): { readonly x: number; readonly y: number } | null {
    switch (ref.by) {
      case "coordinate":
        return { x: ref.x, y: ref.y };

      case "index":
        return centerOf(elements[ref.index]);

      case "label":
        return centerOf(
          elements.find(e => e.label.toLowerCase().includes(ref.text.toLowerCase())),
        );

      case "role": {
        const matches = elements.filter(e => e.type === ref.role);
        return centerOf(matches[ref.nth ?? 0]);
      }
    }
  }
}

// ── Tier-Specific Adapters ──────────────────────────────

function adaptForFrontierVision(
  perception: Perception,
  elements: readonly ScreenElement[],
  maxElements: number,
): PerceptionOutput {
  return {
    screenshot: perception.screenshot ?? undefined,
    elements,
    maxElements,
    referenceMode: "coordinate",
  };
}

function adaptForSmallVision(
  perception: Perception,
  elements: readonly ScreenElement[],
  maxElements: number,
): PerceptionOutput {
  return {
    annotatedScreenshot: generateSetOfMark(perception.screenshot),
    elements,
    maxElements,
    referenceMode: "index",
    textDescription: generateElementIndex(elements),
  };
}

function adaptForTextOnly(
  perception: Perception,
  elements: readonly ScreenElement[],
  maxElements: number,
): PerceptionOutput {
  return {
    textDescription: generateDetailedTextDescription(perception, elements),
    elements,
    maxElements,
    referenceMode: "index",
  };
}

// ── Element Pruning ─────────────────────────────────────

/**
 * Prune elements to fit within budget, prioritizing:
 * 1. Focused elements
 * 2. Interactive elements (buttons, inputs, links)
 * 3. Enabled (non-disabled) elements
 * 4. Elements with non-empty labels
 */
function pruneElements(
  elements: readonly ScreenElement[],
  maxElements: number,
): readonly ScreenElement[] {
  if (elements.length <= maxElements) return elements;

  const scored = elements.map(el => ({
    element: el,
    score: scoreElement(el),
  }));

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return sorted.slice(0, maxElements).map(s => s.element);
}

function scoreElement(el: ScreenElement): number {
  return (
    (el.focused ? SCORE_FOCUSED : 0) +
    (INTERACTIVE_TYPES.has(el.type) ? SCORE_INTERACTIVE : 0) +
    (!el.disabled ? SCORE_ENABLED : 0) +
    (el.label.length > 0 ? SCORE_HAS_LABEL : 0)
  );
}

// ── Set-of-Mark Generation ──────────────────────────────

/**
 * Generate Set-of-Mark annotation data.
 *
 * A full SoM implementation overlays numbered labels on the screenshot
 * using an image manipulation library (sharp/canvas). For now, returns
 * the raw screenshot; the accompanying text index from generateElementIndex
 * serves as the "mark" reference for models.
 *
 * TODO: Integrate sharp or node-canvas for pixel-level label overlays.
 */
function generateSetOfMark(screenshot: Buffer | null): Buffer | undefined {
  return screenshot ?? undefined;
}

// ── Text Generation ─────────────────────────────────────

/**
 * Generate a numbered element index for SoM/text-only models.
 * Each line maps an index number to an element's type, label, and state.
 */
function generateElementIndex(elements: readonly ScreenElement[]): string {
  return elements
    .map((el, i) => formatIndexedElement(el, i))
    .join("\n");
}

function formatIndexedElement(el: ScreenElement, index: number): string {
  const focused = el.focused ? " (FOCUSED)" : "";
  const disabled = el.disabled ? " (disabled)" : "";
  const value = el.value ? ` value="${el.value}"` : "";
  return `[${index}] ${el.type} "${el.label}"${focused}${disabled}${value}`;
}

/**
 * Generate a detailed text description for text-only models.
 * Includes spatial layout information so the model can reason about
 * where elements are on screen (top/middle/bottom, left/center/right).
 */
function generateDetailedTextDescription(
  perception: Perception,
  elements: readonly ScreenElement[],
): string {
  const lines: string[] = [
    `Active window: "${perception.activeWindow.name}" (${perception.activeWindow.app})`,
    `Screen elements (${elements.length}):`,
    "",
  ];

  // Sort by spatial position: top-to-bottom, then left-to-right
  const sorted = [...elements].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const [i, el] of sorted.entries()) {
    lines.push(formatSpatialElement(el, i));
  }

  return lines.join("\n");
}

function formatSpatialElement(el: ScreenElement, index: number): string {
  const position = el.y < REGION_TOP_Y ? "top" : el.y > REGION_BOTTOM_Y ? "bottom" : "middle";
  const side = el.x < REGION_LEFT_X ? "left" : el.x > REGION_RIGHT_X ? "right" : "center";
  const focused = el.focused ? " *FOCUSED" : "";
  const disabled = el.disabled ? " -disabled" : "";
  const value = el.value ? ` = "${el.value}"` : "";

  return `  [${index}] ${el.type} "${el.label}" at ${position}-${side}${focused}${disabled}${value}`;
}

// ── Utilities ───────────────────────────────────────────

function isFrontierVisionModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return FRONTIER_VISION_MODELS.some(f => lower.includes(f));
}

function centerOf(
  el: ScreenElement | undefined,
): { readonly x: number; readonly y: number } | null {
  if (!el) return null;
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}
