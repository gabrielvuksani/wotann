/**
 * Image Generation Router — selects the best image generation provider
 * for a given prompt and available provider set.
 *
 * Routes photorealistic prompts to DALL-E/Flux, artistic prompts to
 * Midjourney/Stable Diffusion, and icon/diagram prompts to SVG fallback.
 * When no external provider is available, generates a descriptive SVG
 * placeholder.
 */

// ── Public Types ──────────────────────────────────────

export interface RouteResult {
  readonly provider: string;
  readonly model: string;
  readonly reason: string;
}

export interface ProviderCapability {
  readonly provider: string;
  readonly model: string;
  readonly strengths: ReadonlySet<PromptCategory>;
  readonly priority: number;
}

export type PromptCategory =
  | "photorealistic"
  | "artistic"
  | "icon"
  | "diagram"
  | "text-heavy"
  | "abstract"
  | "general";

// ── Constants ─────────────────────────────────────────

const PHOTOREALISTIC_KEYWORDS = [
  "photo",
  "realistic",
  "photograph",
  "portrait",
  "landscape",
  "headshot",
  "product shot",
  "real",
  "natural",
  "cinematic",
];

const ARTISTIC_KEYWORDS = [
  "painting",
  "watercolor",
  "oil",
  "sketch",
  "cartoon",
  "anime",
  "illustration",
  "stylized",
  "impressionist",
  "surreal",
  "abstract art",
  "digital art",
  "concept art",
];

const ICON_KEYWORDS = [
  "icon",
  "logo",
  "badge",
  "symbol",
  "favicon",
  "flat",
  "minimal",
  "monochrome",
  "vector",
];

const DIAGRAM_KEYWORDS = [
  "diagram",
  "flowchart",
  "chart",
  "graph",
  "wireframe",
  "architecture",
  "uml",
  "sequence",
  "schematic",
  "layout",
];

const TEXT_HEAVY_KEYWORDS = [
  "text",
  "typography",
  "lettering",
  "quote",
  "banner",
  "sign",
  "poster",
  "headline",
  "title card",
];

/**
 * Known provider capabilities and preferred models.
 */
const PROVIDER_CATALOG: readonly ProviderCapability[] = [
  {
    provider: "openai",
    model: "dall-e-3",
    strengths: new Set(["photorealistic", "general", "text-heavy"]),
    priority: 1,
  },
  {
    provider: "stability",
    model: "stable-diffusion-xl",
    strengths: new Set(["artistic", "abstract", "general"]),
    priority: 2,
  },
  {
    provider: "replicate",
    model: "flux-1.1-pro",
    strengths: new Set(["photorealistic", "artistic", "general"]),
    priority: 3,
  },
  {
    provider: "midjourney",
    model: "v6",
    strengths: new Set(["artistic", "abstract", "photorealistic"]),
    priority: 4,
  },
  // The Anthropic "claude-image" entry was fictional — Anthropic does not
  // ship an image-generation model. Listing one here meant any image
  // request would prefer a non-existent vendor endpoint and bias routing
  // back to Anthropic. Removed entirely; the SVG fallback below covers
  // the diagram/icon/text-heavy strengths the entry claimed.
];

// ── SVG Generation Constants ──────────────────────────

const SVG_WIDTH = 512;
const SVG_HEIGHT = 512;
const SVG_BG_COLOR = "#1a1a2e";
const SVG_ACCENT = "#e94560";
const SVG_TEXT_COLOR = "#eee";

// ── ImageGenRouter ────────────────────────────────────

export class ImageGenRouter {
  private readonly customProviders: ProviderCapability[] = [];

  /**
   * Register an additional provider with its capabilities.
   */
  registerProvider(capability: ProviderCapability): void {
    this.customProviders.push(capability);
  }

  /**
   * Route a prompt to the best available provider.
   * Falls back to SVG generation if no provider matches.
   */
  route(prompt: string, availableProviders: readonly string[]): RouteResult {
    const category = classifyPrompt(prompt);
    const available = new Set(availableProviders);

    // Merge built-in + custom providers
    const allProviders = [...PROVIDER_CATALOG, ...this.customProviders];

    // Filter to available providers, then score by category match + priority
    const candidates = allProviders
      .filter((p) => available.has(p.provider))
      .map((p) => ({
        ...p,
        score: computeScore(p, category),
      }))
      .sort((a, b) => b.score - a.score || a.priority - b.priority);

    const best = candidates[0];
    if (best) {
      return {
        provider: best.provider,
        model: best.model,
        reason: `Best match for "${category}" prompt (score: ${best.score})`,
      };
    }

    // No external provider available — use SVG fallback
    return {
      provider: "svg-fallback",
      model: "inline-svg",
      reason: "No image generation provider available; using SVG placeholder",
    };
  }

  /**
   * Generate a fallback SVG placeholder when no image provider is available.
   * Creates a visually descriptive placeholder that conveys the prompt intent.
   */
  generateFallbackSVG(prompt: string): string {
    const category = classifyPrompt(prompt);
    const truncatedPrompt = prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;

    const shape = categoryShape(category);
    const accentColor = categoryColor(category);

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">`,
      `  <rect width="100%" height="100%" fill="${SVG_BG_COLOR}"/>`,
      // Decorative background pattern
      `  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">`,
      `    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${accentColor}" stroke-width="0.5" opacity="0.15"/>`,
      `  </pattern>`,
      `  <rect width="100%" height="100%" fill="url(#grid)"/>`,
      // Central shape
      shape,
      // Category label
      `  <text x="${SVG_WIDTH / 2}" y="${SVG_HEIGHT / 2 + 80}" text-anchor="middle" fill="${accentColor}" font-size="14" font-family="sans-serif" font-weight="bold">${escapeXml(category.toUpperCase())}</text>`,
      // Prompt text (wrapped)
      ...wrapSvgText(truncatedPrompt, SVG_WIDTH / 2, SVG_HEIGHT / 2 + 110, 60),
      // Watermark
      `  <text x="${SVG_WIDTH - 10}" y="${SVG_HEIGHT - 10}" text-anchor="end" fill="${SVG_TEXT_COLOR}" font-size="9" font-family="sans-serif" opacity="0.4">WOTANN Image Placeholder</text>`,
      `</svg>`,
    ].join("\n");
  }
}

// ── Prompt Classification ─────────────────────────────

function classifyPrompt(prompt: string): PromptCategory {
  const lower = prompt.toLowerCase();

  const scores: Record<PromptCategory, number> = {
    photorealistic: matchScore(lower, PHOTOREALISTIC_KEYWORDS),
    artistic: matchScore(lower, ARTISTIC_KEYWORDS),
    icon: matchScore(lower, ICON_KEYWORDS),
    diagram: matchScore(lower, DIAGRAM_KEYWORDS),
    "text-heavy": matchScore(lower, TEXT_HEAVY_KEYWORDS),
    abstract: lower.includes("abstract") ? 2 : 0,
    general: 1, // Baseline
  };

  let bestCategory: PromptCategory = "general";
  let bestScore = 0;

  for (const [category, score] of Object.entries(scores) as [PromptCategory, number][]) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

function matchScore(text: string, keywords: readonly string[]): number {
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) score++;
  }
  return score;
}

// ── Scoring ───────────────────────────────────────────

function computeScore(provider: ProviderCapability, category: PromptCategory): number {
  let score = 0;

  if (provider.strengths.has(category)) {
    score += 10;
  }
  if (provider.strengths.has("general")) {
    score += 3;
  }

  // Prefer lower priority numbers (higher quality)
  score += Math.max(0, 6 - provider.priority);

  return score;
}

// ── SVG Helpers ───────────────────────────────────────

function categoryShape(category: PromptCategory): string {
  const cx = SVG_WIDTH / 2;
  const cy = SVG_HEIGHT / 2 - 20;

  switch (category) {
    case "photorealistic":
      return `<circle cx="${cx}" cy="${cy}" r="60" fill="none" stroke="${SVG_ACCENT}" stroke-width="2"/>`;
    case "artistic":
      return `<polygon points="${cx},${cy - 60} ${cx + 52},${cy + 30} ${cx - 52},${cy + 30}" fill="none" stroke="#e9a845" stroke-width="2"/>`;
    case "icon":
      return `<rect x="${cx - 40}" y="${cy - 40}" width="80" height="80" rx="12" fill="none" stroke="#45e9a8" stroke-width="2"/>`;
    case "diagram":
      return `<rect x="${cx - 50}" y="${cy - 30}" width="100" height="60" fill="none" stroke="#4590e9" stroke-width="2" stroke-dasharray="8,4"/>`;
    case "text-heavy":
      return [
        `<line x1="${cx - 40}" y1="${cy - 20}" x2="${cx + 40}" y2="${cy - 20}" stroke="${SVG_TEXT_COLOR}" stroke-width="2"/>`,
        `<line x1="${cx - 40}" y1="${cy}" x2="${cx + 30}" y2="${cy}" stroke="${SVG_TEXT_COLOR}" stroke-width="2" opacity="0.6"/>`,
        `<line x1="${cx - 40}" y1="${cy + 20}" x2="${cx + 20}" y2="${cy + 20}" stroke="${SVG_TEXT_COLOR}" stroke-width="2" opacity="0.3"/>`,
      ].join("\n");
    default:
      return `<circle cx="${cx}" cy="${cy}" r="50" fill="none" stroke="${SVG_ACCENT}" stroke-width="1.5" stroke-dasharray="4,4"/>`;
  }
}

function categoryColor(category: PromptCategory): string {
  switch (category) {
    case "photorealistic":
      return SVG_ACCENT;
    case "artistic":
      return "#e9a845";
    case "icon":
      return "#45e9a8";
    case "diagram":
      return "#4590e9";
    case "text-heavy":
      return SVG_TEXT_COLOR;
    default:
      return SVG_ACCENT;
  }
}

function wrapSvgText(text: string, x: number, startY: number, maxCharsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.map(
    (line, i) =>
      `  <text x="${x}" y="${startY + i * 18}" text-anchor="middle" fill="${SVG_TEXT_COLOR}" font-size="12" font-family="sans-serif" opacity="0.7">${escapeXml(line)}</text>`,
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
