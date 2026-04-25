/**
 * Perception engine: the harness's eyes.
 *
 * Layer 3 of the 4-layer Computer Use architecture:
 *   Layer 1: API/CLI route table (direct commands)
 *   Layer 2: Accessibility tree (AXUIElement -> structured text)
 *   Layer 3: Screenshot -> OCR -> layout description (THIS FILE)
 *   Layer 4: Screenshot -> vision model (pass-through)
 *
 * Captures screen state via screenshot + a11y tree + OCR in parallel.
 * Converts visual state to structured text for text-only models.
 * The OCR pipeline uses a grid-based spatial analysis approach:
 *   ~100 tokens per element vs ~15K per raw screenshot.
 */

import { platform } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { Perception, ScreenElement, ActiveWindow, CUAction } from "./types.js";

const execFileAsync = promisify(execFile);

export type PlatformType = "darwin" | "linux" | "win32" | "unknown";

// ── V9 T14.1 — ROI zoom constants ────────────────────────
//
// When an OCR / a11y target has a bounding box smaller than this
// threshold (in screen pixels) the perception engine assumes the
// downstream model will struggle to click it accurately. We synthesise
// a zoom action that re-perceives a magnified region around the target,
// then map any coordinates the LLM returns back to original screen-space.
//
// 32×32 was chosen because it matches macOS's default "minimum tappable
// target" guideline (44pt @ 1x = 44px on a non-retina display, 22pt @ 2x
// = 44 logical pixels) — anything smaller is hard to click reliably even
// for vision models.

/** Pixels: any element whose bounding box is below this on either side
 *  triggers a single ROI-zoom recovery on the next perceive() cycle. */
const SMALL_TARGET_THRESHOLD_PX = 32;

/** Multiplier used to compute the ROI zoom region around a tiny target.
 *  We zoom into roughly 4x the target's size on each axis (or a sensible
 *  minimum) so the magnified frame contains useful surrounding context. */
const ZOOM_REGION_MULTIPLIER = 4;

/** Lower bound for the zoom region size, in screen pixels. Prevents the
 *  region from collapsing to a tiny crop when the target is itself only
 *  a few pixels wide. */
const MIN_ZOOM_REGION_SIZE_PX = 128;

/**
 * A text region extracted from a screenshot via OCR.
 * Includes the text content and its spatial position.
 */
export interface OCRTextRegion {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly confidence: number;
}

/**
 * A grid cell from the spatial analysis.
 * Each cell covers a section of the screenshot.
 */
export interface GridCell {
  readonly row: number;
  readonly col: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly regions: readonly OCRTextRegion[];
  readonly hasContent: boolean;
}

/**
 * Result of the screenshot-to-text OCR pipeline.
 * Contains both the raw regions and the structured text output.
 */
export interface OCRResult {
  readonly regions: readonly OCRTextRegion[];
  readonly grid: readonly GridCell[];
  readonly structuredText: string;
  readonly elementCount: number;
  readonly processingMs: number;
}

export function detectPlatform(): PlatformType {
  const p = platform();
  if (p === "darwin") return "darwin";
  if (p === "linux") return "linux";
  if (p === "win32") return "win32";
  return "unknown";
}

export class PerceptionEngine {
  private readonly platform: PlatformType;
  private readonly gridRows: number;
  private readonly gridCols: number;

  constructor(platformOverride?: PlatformType, gridSize?: { rows: number; cols: number }) {
    this.platform = platformOverride ?? detectPlatform();
    this.gridRows = gridSize?.rows ?? 10;
    this.gridCols = gridSize?.cols ?? 10;
  }

  async perceive(): Promise<Perception> {
    const [screenshot, a11yTree, activeWindow] = await Promise.all([
      this.captureScreenshot().catch(() => null),
      this.getAccessibilityTree().catch(() => null),
      this.getActiveWindow().catch(() => this.defaultActiveWindow()),
    ]);

    const elements = a11yTree
      ? this.extractElementsFromA11y(a11yTree)
      : this.generateFallbackElements();

    return {
      screenshot,
      a11yTree,
      elements,
      activeWindow,
      timestamp: Date.now(),
    };
  }

  // ── V9 T14.1 — ROI zoom recovery ───────────────────────
  //
  // When elements come back from a11y/OCR with target boxes smaller than
  // ~32x32 px in screen-space, downstream models — especially text-only
  // ones using coordinate clicks — frequently miss. The recovery flow:
  //
  //   1. perceive()                      — capture screen + classify.
  //   2. detectSmallTarget(perception)   — look for tiny clickable boxes.
  //   3. If any are found, build a `{type:"zoom", region:{x,y,w,h}}`
  //      action centred on the smallest one.
  //   4. Caller applies the zoom (cropping the screenshot to that
  //      region) and re-perceives the cropped image.
  //   5. Map coordinates back to original screen-space via
  //      `mapZoomedToScreen`.
  //
  // Cap: at most one zoom per perception cycle, enforced by
  // `perceiveWithZoom`, so a pathological screen full of tiny widgets
  // can't trigger an infinite chain of zooms.

  /**
   * Detect any element whose bounding box is too small for reliable
   * targeting and return the *smallest* such element. Returns null when
   * no small targets are found OR when all elements have zero-width
   * boxes (which means a11y didn't supply geometry — zooming wouldn't
   * help in that case).
   *
   * The heuristic only triggers for *interactive* element types
   * (buttons, links, inputs, checkboxes, selects, menus, tabs). Tiny
   * "text" or "image" elements aren't usually click targets so zooming
   * on them would waste a recovery cycle.
   */
  detectSmallTarget(perception: Perception): ScreenElement | null {
    let smallest: ScreenElement | null = null;
    let smallestArea = Number.POSITIVE_INFINITY;
    for (const el of perception.elements) {
      // Skip elements that don't have geometry — a11y on macOS often
      // omits dimensions. Zooming on a (0,0,0,0) box would produce
      // garbage so we'd rather report "no small targets" than guess.
      if (el.width <= 0 || el.height <= 0) continue;
      // Both axes need to be small for the heuristic to fire. Wide
      // toolbars with short height don't benefit from a zoom — and
      // zooming would just make them less informative.
      if (el.width >= SMALL_TARGET_THRESHOLD_PX) continue;
      if (el.height >= SMALL_TARGET_THRESHOLD_PX) continue;
      // Prefer interactive types — clicking a "static text" element
      // with a tiny box doesn't usually need zoom recovery.
      if (el.type === "image" || el.type === "text") continue;
      const area = el.width * el.height;
      if (area < smallestArea) {
        smallestArea = area;
        smallest = el;
      }
    }
    return smallest;
  }

  /**
   * Build a `{type:"zoom"}` CUAction centred on a target element. The
   * region is sized to roughly 4x the target with a sane minimum so the
   * magnified frame retains useful surrounding context. The region is
   * clamped to the active window's bounds so we never request a crop
   * outside the screen.
   */
  buildZoomAction(target: ScreenElement, screenBounds: ActiveWindow["bounds"]): CUAction {
    const regionWidth = Math.max(MIN_ZOOM_REGION_SIZE_PX, target.width * ZOOM_REGION_MULTIPLIER);
    const regionHeight = Math.max(MIN_ZOOM_REGION_SIZE_PX, target.height * ZOOM_REGION_MULTIPLIER);
    // Center the region on the target. Clamp so the region stays inside
    // the active window's bounds.
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;
    const rawX = Math.round(centerX - regionWidth / 2);
    const rawY = Math.round(centerY - regionHeight / 2);
    const x = Math.max(
      screenBounds.x,
      Math.min(rawX, screenBounds.x + screenBounds.width - regionWidth),
    );
    const y = Math.max(
      screenBounds.y,
      Math.min(rawY, screenBounds.y + screenBounds.height - regionHeight),
    );
    return {
      type: "zoom",
      region: {
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.round(regionWidth),
        height: Math.round(regionHeight),
      },
    };
  }

  /**
   * Map a coordinate from a zoomed image back to the original
   * screen-space. The zoomed image always covers `region.width` ×
   * `region.height` pixels of the screen — the LLM may emit normalized
   * coordinates (0..1) or pixel coordinates assuming the cropped
   * image's own dimensions. We accept either via the `mode` param.
   *
   * - `mode: "pixel"`      : `(x,y)` are pixel coords inside the cropped
   *                          image whose dimensions match the region.
   * - `mode: "normalized"` : `(x,y)` are 0..1 fractions of the cropped
   *                          image dimensions. Useful for vision models
   *                          that always emit normalized coords.
   */
  mapZoomedToScreen(
    point: { x: number; y: number },
    zoomAction: Extract<CUAction, { type: "zoom" }>,
    mode: "pixel" | "normalized" = "pixel",
  ): { x: number; y: number } {
    const { region } = zoomAction;
    const fx = mode === "normalized" ? point.x : point.x / region.width;
    const fy = mode === "normalized" ? point.y : point.y / region.height;
    return {
      x: Math.round(region.x + fx * region.width),
      y: Math.round(region.y + fy * region.height),
    };
  }

  /**
   * One-shot ROI zoom recovery. Performs `perceive()`, looks for a tiny
   * target, and if one is found returns:
   *
   *   - the original perception (so the caller still sees the full
   *     screen layout),
   *   - the zoom action to apply, plus the target element it was built
   *     for (callers may want to highlight or annotate the target).
   *
   * Capped at exactly one zoom per cycle. The caller decides whether to
   * actually act on the suggestion (e.g., by capturing the cropped
   * screenshot and re-running classification) — this method does not
   * recursively re-perceive, which prevents infinite loops on screens
   * with nested tiny widgets.
   *
   * Returns `{ perception, zoom: null }` when no small targets are
   * detected so callers can treat the result uniformly.
   */
  async perceiveWithZoom(): Promise<{
    readonly perception: Perception;
    readonly zoom: {
      readonly action: Extract<CUAction, { type: "zoom" }>;
      readonly target: ScreenElement;
    } | null;
  }> {
    const perception = await this.perceive();
    const target = this.detectSmallTarget(perception);
    if (!target) {
      return { perception, zoom: null };
    }
    const action = this.buildZoomAction(target, perception.activeWindow.bounds);
    if (action.type !== "zoom") {
      // Defensive — buildZoomAction always returns a zoom action, but
      // TS narrowing wants the explicit check before the destructure.
      return { perception, zoom: null };
    }
    return {
      perception,
      zoom: { action, target },
    };
  }

  /**
   * Convert perception to structured text for text-only models.
   * This is the key innovation — ANY model can control the computer.
   */
  toText(p: Perception): string {
    const lines = [`Active: ${p.activeWindow.name} (${p.activeWindow.app})`];
    for (const el of p.elements) {
      const state = el.focused ? " - FOCUSED" : el.disabled ? " - disabled" : "";
      const value = el.value ? ` [${el.value}]` : "";
      lines.push(`  [${el.index}] ${el.type} "${el.label}" at (${el.x},${el.y})${value}${state}`);
    }
    return lines.join("\n");
  }

  // ── Layer 3: Screenshot → OCR → Structured Text ────────

  /**
   * Convert a base64 PNG screenshot to a structured text description.
   * This is the Layer 3 pipeline: Screenshot → OCR → layout description.
   *
   * ~100 tokens per element vs ~15K tokens per raw screenshot.
   * Any text-only LLM can understand the output and issue actions.
   *
   * Pipeline:
   *   1. Decode base64 → write temp PNG
   *   2. Run OCR (tesseract or macOS Vision framework)
   *   3. Extract text regions with spatial positions
   *   4. Classify regions into UI element types
   *   5. Build grid-based spatial layout
   *   6. Generate indexed element list
   *   7. Return structured text prompt
   */
  async screenshotToText(screenshotBase64: string): Promise<string> {
    const result = await this.ocrFromBase64(screenshotBase64);
    return result.structuredText;
  }

  /**
   * Full OCR pipeline with detailed results.
   * Returns regions, grid analysis, and structured text.
   */
  async ocrFromBase64(screenshotBase64: string): Promise<OCRResult> {
    const startTime = Date.now();

    // 1. Decode base64 and write to temp file
    const { writeFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir: getTmpDir } = await import("node:os");
    const tmpPath = join(getTmpDir(), `wotann-ocr-${Date.now()}.png`);

    try {
      const imageBuffer = Buffer.from(screenshotBase64, "base64");
      await writeFile(tmpPath, imageBuffer);

      // 2. Extract text regions via OCR
      const regions = await this.extractTextRegions(tmpPath);

      // 3. Get image dimensions for grid layout
      const dimensions = await this.getImageDimensions(tmpPath);

      // 4. Build spatial grid
      const grid = this.buildGrid(regions, dimensions.width, dimensions.height);

      // 5. Classify regions into UI elements
      const elements = this.classifyRegions(regions);

      // 6. Generate structured text
      const structuredText = this.buildStructuredText(elements, grid, dimensions);

      return {
        regions,
        grid,
        structuredText,
        elementCount: elements.length,
        processingMs: Date.now() - startTime,
      };
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  /**
   * Extract text regions from an image file using OCR.
   * Tries tesseract first, then macOS Vision framework, then basic fallback.
   */
  private async extractTextRegions(imagePath: string): Promise<readonly OCRTextRegion[]> {
    // Try tesseract (cross-platform, widely available)
    const tesseractRegions = await this.ocrWithTesseract(imagePath);
    if (tesseractRegions.length > 0) return tesseractRegions;

    // Try macOS Vision framework via osascript
    if (this.platform === "darwin") {
      const visionRegions = await this.ocrWithMacOSVision(imagePath);
      if (visionRegions.length > 0) return visionRegions;
    }

    // Fallback: no OCR available
    return [
      {
        text: "[No OCR engine available — install tesseract: brew install tesseract]",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        confidence: 0,
      },
    ];
  }

  /**
   * OCR using tesseract CLI.
   * Outputs TSV format with bounding boxes for each word.
   */
  private async ocrWithTesseract(imagePath: string): Promise<readonly OCRTextRegion[]> {
    if (!isCommandAvailable("tesseract")) return [];

    try {
      const { stdout } = await execFileAsync(
        "tesseract",
        [imagePath, "stdout", "--psm", "3", "-c", "tessedit_create_tsv=1", "tsv"],
        { timeout: 30_000 },
      );

      return parseTesseractTSV(stdout);
    } catch {
      // Try simpler mode if TSV fails
      try {
        const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout"], {
          timeout: 30_000,
        });

        // Without TSV, we only get text without positions
        const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
        return lines.map((line, i) => ({
          text: line.trim(),
          x: 0,
          y: i * 20, // Approximate vertical position
          width: line.length * 8,
          height: 18,
          confidence: 0.7,
        }));
      } catch {
        return [];
      }
    }
  }

  /**
   * OCR using macOS Vision framework via osascript.
   * Uses VNRecognizeTextRequest which is built into macOS 10.15+.
   */
  private async ocrWithMacOSVision(imagePath: string): Promise<readonly OCRTextRegion[]> {
    try {
      // AppleScript that uses the Vision framework for OCR
      const script = `
use framework "Vision"
use framework "AppKit"
use scripting additions

set imagePath to POSIX file "${imagePath}"
set imageURL to current application's NSURL's fileURLWithPath:(POSIX path of imagePath)
set requestHandler to current application's VNImageRequestHandler's alloc()'s initWithURL:imageURL options:(current application's NSDictionary's dictionary())

set textRequest to current application's VNRecognizeTextRequest's alloc()'s init()
textRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)

requestHandler's performRequests:{textRequest} |error|:(missing value)
set results to textRequest's results()

set output to ""
repeat with observation in results
  set recognizedText to (observation's topCandidates:1)'s firstObject()'s |string|() as text
  set bbox to observation's boundingBox()
  set bboxX to (current application's NSMidX(bbox)) as real
  set bboxY to (current application's NSMidY(bbox)) as real
  set bboxW to (current application's NSWidth(bbox)) as real
  set bboxH to (current application's NSHeight(bbox)) as real
  set conf to (observation's confidence()) as real
  set output to output & recognizedText & "\\t" & bboxX & "\\t" & bboxY & "\\t" & bboxW & "\\t" & bboxH & "\\t" & conf & "\\n"
end repeat
return output`;

      const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 15_000 });

      const regions: OCRTextRegion[] = [];
      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);

      for (const line of lines) {
        const parts = line.split("\t");
        const text = parts[0]?.trim();
        if (!text || text.length === 0) continue;

        // Vision framework returns normalized coordinates (0-1)
        // Convert to approximate pixel values assuming 1920x1080
        const normX = parseFloat(parts[1] ?? "0");
        const normY = parseFloat(parts[2] ?? "0");
        const normW = parseFloat(parts[3] ?? "0");
        const normH = parseFloat(parts[4] ?? "0");
        const conf = parseFloat(parts[5] ?? "0");

        regions.push({
          text,
          x: Math.round(normX * 1920),
          y: Math.round((1 - normY) * 1080), // Vision uses bottom-left origin
          width: Math.round(normW * 1920),
          height: Math.round(normH * 1080),
          confidence: conf,
        });
      }

      return regions;
    } catch {
      return [];
    }
  }

  /**
   * Get image dimensions using sips (macOS) or identify (ImageMagick).
   */
  private async getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
    const defaultDims = { width: 1920, height: 1080 };

    if (this.platform === "darwin") {
      try {
        const { stdout } = await execFileAsync(
          "sips",
          ["-g", "pixelWidth", "-g", "pixelHeight", imagePath],
          { timeout: 5000 },
        );

        const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
        const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);
        if (widthMatch?.[1] && heightMatch?.[1]) {
          return {
            width: parseInt(widthMatch[1], 10),
            height: parseInt(heightMatch[1], 10),
          };
        }
      } catch {
        // fall through
      }
    }

    if (isCommandAvailable("identify")) {
      try {
        const { stdout } = await execFileAsync("identify", ["-format", "%w %h", imagePath], {
          timeout: 5000,
        });

        const parts = stdout.trim().split(/\s+/);
        const w = parseInt(parts[0] ?? "0", 10);
        const h = parseInt(parts[1] ?? "0", 10);
        if (w > 0 && h > 0) return { width: w, height: h };
      } catch {
        // fall through
      }
    }

    return defaultDims;
  }

  /**
   * Build a grid-based spatial analysis of text regions.
   * Divides the screen into a grid and assigns regions to cells.
   */
  private buildGrid(
    regions: readonly OCRTextRegion[],
    screenWidth: number,
    screenHeight: number,
  ): readonly GridCell[] {
    const cellWidth = Math.floor(screenWidth / this.gridCols);
    const cellHeight = Math.floor(screenHeight / this.gridRows);
    const cells: GridCell[] = [];

    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        const cellX = col * cellWidth;
        const cellY = row * cellHeight;

        // Find regions that overlap this cell
        const cellRegions = regions.filter((r) => {
          const regionRight = r.x + r.width;
          const regionBottom = r.y + r.height;
          const cellRight = cellX + cellWidth;
          const cellBottom = cellY + cellHeight;

          return r.x < cellRight && regionRight > cellX && r.y < cellBottom && regionBottom > cellY;
        });

        cells.push({
          row,
          col,
          x: cellX,
          y: cellY,
          width: cellWidth,
          height: cellHeight,
          regions: cellRegions,
          hasContent: cellRegions.length > 0,
        });
      }
    }

    return cells;
  }

  /**
   * Classify OCR text regions into likely UI element types.
   * Uses heuristics based on text content and spatial patterns.
   */
  private classifyRegions(regions: readonly OCRTextRegion[]): readonly ClassifiedElement[] {
    return regions
      .filter((r) => r.text.trim().length > 0 && r.confidence > 0.3)
      .map((region, index) => {
        const text = region.text.trim();
        const elementType = classifyTextAsUIElement(text, region);

        return {
          index,
          type: elementType,
          label: text,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          confidence: region.confidence,
        };
      });
  }

  /**
   * Build the final structured text description from classified elements
   * and the spatial grid. This text is what gets sent to the LLM.
   */
  private buildStructuredText(
    elements: readonly ClassifiedElement[],
    grid: readonly GridCell[],
    dimensions: { width: number; height: number },
  ): string {
    const lines: string[] = [];

    lines.push(`Screen: ${dimensions.width}x${dimensions.height}`);
    lines.push(`Elements found: ${elements.length}`);
    lines.push("");

    // Element list with indices (the LLM references these to issue click actions)
    lines.push("--- UI Elements ---");
    for (const el of elements) {
      const typeTag = el.type !== "text" ? ` (${el.type})` : "";
      lines.push(`  [${el.index}] "${el.label}"${typeTag} at (${el.x},${el.y})`);
    }

    // Spatial grid summary (shows where content is on screen)
    lines.push("");
    lines.push("--- Spatial Layout ---");

    for (let row = 0; row < this.gridRows; row++) {
      const rowCells = grid.filter((c) => c.row === row);
      const cellDescriptions: string[] = [];

      for (const cell of rowCells) {
        if (cell.hasContent) {
          const texts = cell.regions
            .map((r) => r.text.trim())
            .filter((t) => t.length > 0)
            .slice(0, 3); // Limit to 3 per cell
          cellDescriptions.push(texts.join(", "));
        }
      }

      if (cellDescriptions.length > 0) {
        const yRange = `${row * Math.floor(dimensions.height / this.gridRows)}-${(row + 1) * Math.floor(dimensions.height / this.gridRows)}`;
        lines.push(`  Row ${row} (y:${yRange}): ${cellDescriptions.join(" | ")}`);
      }
    }

    return lines.join("\n");
  }

  private async captureScreenshot(): Promise<Buffer | null> {
    switch (this.platform) {
      case "darwin": {
        const tmpPath = `/tmp/wotann-screenshot-${Date.now()}.png`;
        await execFileAsync("screencapture", ["-x", "-t", "png", tmpPath]);
        const { readFile, unlink } = await import("node:fs/promises");
        const data = await readFile(tmpPath);
        await unlink(tmpPath).catch(() => {});
        return data;
      }
      case "linux": {
        const tmpPath = `/tmp/wotann-screenshot-${Date.now()}.png`;
        try {
          await execFileAsync("maim", [tmpPath]);
        } catch {
          await execFileAsync("scrot", [tmpPath]);
        }
        const { readFile, unlink } = await import("node:fs/promises");
        const data = await readFile(tmpPath);
        await unlink(tmpPath).catch(() => {});
        return data;
      }
      default:
        return null;
    }
  }

  private async getAccessibilityTree(): Promise<unknown | null> {
    switch (this.platform) {
      case "darwin": {
        try {
          const { stdout } = await execFileAsync("osascript", [
            "-e",
            'tell application "System Events" to get properties of every UI element of front window of first application process whose frontmost is true',
          ]);
          return stdout;
        } catch {
          return null;
        }
      }
      case "linux": {
        try {
          const { stdout } = await execFileAsync("gdbus", [
            "call",
            "--session",
            "--dest",
            "org.a11y.Bus",
            "--object-path",
            "/org/a11y/bus",
            "--method",
            "org.a11y.Bus.GetAddress",
          ]);
          return stdout;
        } catch {
          return null;
        }
      }
      default:
        return null;
    }
  }

  private async getActiveWindow(): Promise<ActiveWindow> {
    switch (this.platform) {
      case "darwin": {
        try {
          const { stdout } = await execFileAsync("osascript", [
            "-e",
            'tell application "System Events" to get name of first application process whose frontmost is true',
          ]);
          return {
            name: stdout.trim(),
            app: stdout.trim(),
            pid: 0,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          };
        } catch {
          return this.defaultActiveWindow();
        }
      }
      case "linux": {
        try {
          const { stdout } = await execFileAsync("xdotool", ["getactivewindow", "getwindowname"]);
          return {
            name: stdout.trim(),
            app: stdout.trim(),
            pid: 0,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          };
        } catch {
          return this.defaultActiveWindow();
        }
      }
      default:
        return this.defaultActiveWindow();
    }
  }

  private defaultActiveWindow(): ActiveWindow {
    return {
      name: "Unknown",
      app: "Unknown",
      pid: 0,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    };
  }

  private extractElementsFromA11y(tree: unknown): readonly ScreenElement[] {
    if (typeof tree !== "string" || tree.trim().length === 0) return [];

    const elements: ScreenElement[] = [];
    // macOS osascript returns comma-separated element descriptions
    // Format: "button \"OK\" of window \"Settings\", text field \"Search\" of window \"Settings\""
    const parts = String(tree).split(/,\s*/);
    let index = 0;

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;

      // Extract element type from AppleScript UI element naming
      const typeMatch = trimmed.match(
        /^(button|text field|static text|checkbox|radio button|pop up button|menu item|link|image|tab group|scroll area|text area|combo box|slider)/i,
      );
      const labelMatch = trimmed.match(/"([^"]+)"/);

      if (typeMatch) {
        const rawType = typeMatch[1]!.toLowerCase();
        const elementType = this.mapA11yType(rawType);
        elements.push({
          index,
          type: elementType,
          label: labelMatch?.[1] ?? trimmed.slice(0, 50),
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          focused: trimmed.includes("focused"),
          disabled: trimmed.includes("dimmed"),
        });
        index++;
      }
    }

    return elements;
  }

  private mapA11yType(rawType: string): ScreenElement["type"] {
    const mapping: Record<string, ScreenElement["type"]> = {
      button: "button",
      "text field": "input",
      "text area": "input",
      "static text": "text",
      checkbox: "checkbox",
      "radio button": "checkbox",
      "pop up button": "select",
      "combo box": "select",
      "menu item": "menu",
      link: "link",
      image: "image",
      "tab group": "tab",
      "scroll area": "text",
      slider: "input",
    };
    return mapping[rawType] ?? "text";
  }

  private generateFallbackElements(): readonly ScreenElement[] {
    return [];
  }
}

// ── Internal Types ──────────────────────────────────────

interface ClassifiedElement {
  readonly index: number;
  readonly type: "button" | "input" | "link" | "menu" | "tab" | "text" | "heading" | "label";
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly confidence: number;
}

// ── Classification Heuristics ───────────────────────────

/**
 * Classify a text region as a likely UI element type.
 * Uses pattern matching on the text content and spatial properties.
 */
function classifyTextAsUIElement(text: string, region: OCRTextRegion): ClassifiedElement["type"] {
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Short text that looks like a button label
  const buttonPatterns = [
    "ok",
    "cancel",
    "submit",
    "save",
    "close",
    "open",
    "delete",
    "apply",
    "done",
    "next",
    "back",
    "yes",
    "no",
    "confirm",
    "sign in",
    "log in",
    "sign up",
    "log out",
    "continue",
    "download",
    "upload",
    "install",
    "update",
    "send",
  ];
  if (wordCount <= 3 && buttonPatterns.some((p) => lower === p || lower.startsWith(p))) {
    return "button";
  }

  // Looks like a link (contains URL-like patterns)
  if (lower.includes("http") || lower.includes("www.") || lower.includes(".com")) {
    return "link";
  }

  // Looks like a menu item (short, title-cased)
  const menuPatterns = [
    "file",
    "edit",
    "view",
    "window",
    "help",
    "tools",
    "preferences",
    "settings",
  ];
  if (wordCount <= 2 && menuPatterns.includes(lower)) {
    return "menu";
  }

  // Looks like a tab
  if (region.height < 40 && wordCount <= 3 && region.y < 100) {
    return "tab";
  }

  // Looks like a heading (larger text near top, or all-caps)
  if (text === text.toUpperCase() && text.length > 3 && wordCount <= 5) {
    return "heading";
  }

  // Looks like an input field placeholder
  const inputPatterns = ["search", "type here", "enter", "email", "password", "username", "name"];
  if (wordCount <= 4 && inputPatterns.some((p) => lower.includes(p))) {
    return "input";
  }

  // Short single-word items are likely labels
  if (wordCount === 1 && text.length < 20) {
    return "label";
  }

  return "text";
}

// ── Tesseract TSV Parser ────────────────────────────────

/**
 * Parse tesseract TSV output into OCR text regions.
 * TSV columns: level, page_num, block_num, par_num, line_num, word_num,
 *              left, top, width, height, conf, text
 */
function parseTesseractTSV(tsv: string): readonly OCRTextRegion[] {
  const lines = tsv.split("\n");
  const regions: OCRTextRegion[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;

    const cols = line.split("\t");
    const text = cols[11]?.trim();
    if (!text || text.length === 0) continue;

    const conf = parseInt(cols[10] ?? "0", 10);
    if (conf < 0) continue; // tesseract uses -1 for non-text blocks

    regions.push({
      text,
      x: parseInt(cols[6] ?? "0", 10),
      y: parseInt(cols[7] ?? "0", 10),
      width: parseInt(cols[8] ?? "0", 10),
      height: parseInt(cols[9] ?? "0", 10),
      confidence: conf / 100,
    });
  }

  // Merge adjacent words on the same line into phrases
  return mergeAdjacentRegions(regions);
}

/**
 * Merge adjacent OCR regions that are on the same line into phrases.
 * This turns individual word detections into more meaningful text blocks.
 */
function mergeAdjacentRegions(regions: readonly OCRTextRegion[]): readonly OCRTextRegion[] {
  if (regions.length === 0) return [];

  // Sort by Y position, then X position
  const sorted = [...regions].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 10) return yDiff; // Different line
    return a.x - b.x; // Same line, sort by X
  });

  const merged: OCRTextRegion[] = [];
  let current: OCRTextRegion | null = null;

  for (const region of sorted) {
    if (!current) {
      current = region;
      continue;
    }

    // Check if this region is on the same line and close to the previous one
    const sameLineThreshold = Math.max(current.height, region.height) * 0.5;
    const sameLine = Math.abs(region.y - current.y) < sameLineThreshold;
    const horizontalGap = region.x - (current.x + current.width);
    const closeEnough = horizontalGap < current.height * 2; // Gap less than 2x line height

    if (sameLine && closeEnough) {
      // Merge: extend current region
      const newRight = Math.max(current.x + current.width, region.x + region.width);
      const newBottom = Math.max(current.y + current.height, region.y + region.height);
      const newTop = Math.min(current.y, region.y);
      const newLeft = Math.min(current.x, region.x);

      current = {
        text: `${current.text} ${region.text}`,
        x: newLeft,
        y: newTop,
        width: newRight - newLeft,
        height: newBottom - newTop,
        confidence: (current.confidence + region.confidence) / 2,
      };
    } else {
      merged.push(current);
      current = region;
    }
  }

  if (current) merged.push(current);
  return merged;
}

// ── Utility ─────────────────────────────────────────────

function isCommandAvailable(cmd: string): boolean {
  try {
    execFileSync(platform() === "win32" ? "where" : "which", [cmd], {
      stdio: "pipe",
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}
