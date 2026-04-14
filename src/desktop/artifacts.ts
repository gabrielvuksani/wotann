/**
 * Artifacts System — rich artifact extraction, versioning, and management.
 *
 * Artifacts are structured content blocks extracted from assistant responses:
 * code blocks, diagrams (Mermaid), charts, diffs, HTML, SVG, etc.
 *
 * Features:
 * - Automatic extraction from markdown responses
 * - Version history for each artifact (immutable append)
 * - Pin/unpin for quick access
 * - Export to files
 * - Side-by-side diff view for code changes
 */

// ── Types ──────────────────────────────────────────────

export type ArtifactType =
  | "code"
  | "document"
  | "diagram"
  | "chart"
  | "table"
  | "image"
  | "diff"
  | "proof-bundle"
  | "html"
  | "svg"
  | "mermaid"
  | "canvas";

export interface Artifact {
  readonly id: string;
  readonly type: ArtifactType;
  readonly title: string;
  readonly content: string;
  readonly language?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
}

export interface ArtifactVersion {
  readonly version: number;
  readonly content: string;
  readonly createdAt: string;
}

export interface ArtifactHistory {
  readonly artifactId: string;
  readonly versions: readonly ArtifactVersion[];
}

export interface ExtractedArtifact {
  readonly type: ArtifactType;
  readonly title: string;
  readonly content: string;
  readonly language?: string;
}

// ── ID Generation ──────────────────────────────────────

let artifactIdCounter = 0;

export function generateArtifactId(): string {
  artifactIdCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `art_${timestamp}_${random}_${artifactIdCounter}`;
}

// ── Artifact Factory ───────────────────────────────────

export function createArtifact(extracted: ExtractedArtifact): Artifact {
  const now = new Date().toISOString();
  return {
    id: generateArtifactId(),
    type: extracted.type,
    title: extracted.title,
    content: extracted.content,
    language: extracted.language,
    version: 1,
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };
}

// ── Immutable Operations ───────────────────────────────

export function updateArtifactContent(artifact: Artifact, content: string): Artifact {
  return {
    ...artifact,
    content,
    version: artifact.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function pinArtifact(artifact: Artifact, pinned: boolean): Artifact {
  return { ...artifact, pinned, updatedAt: new Date().toISOString() };
}

export function renameArtifact(artifact: Artifact, title: string): Artifact {
  return { ...artifact, title, updatedAt: new Date().toISOString() };
}

// ── Extraction ─────────────────────────────────────────

/**
 * Language-to-ArtifactType mapping for code blocks.
 */
const LANGUAGE_TYPE_MAP: Readonly<Record<string, ArtifactType>> = {
  mermaid: "mermaid",
  svg: "svg",
  html: "html",
  diff: "diff",
  patch: "diff",
};

/**
 * Detect artifact type from a code block language identifier.
 */
export function detectArtifactType(language: string): ArtifactType {
  const lower = language.toLowerCase();
  return LANGUAGE_TYPE_MAP[lower] ?? "code";
}

/**
 * Generate a title for a code artifact based on language and content.
 */
function generateCodeTitle(language: string, content: string): string {
  // Try to find a filename comment at the top
  const filenameMatch = content.match(/^(?:\/\/|#|<!--)\s*(\S+\.\w+)/);
  if (filenameMatch?.[1] !== undefined) return filenameMatch[1];

  // Try to find a function/class/component name
  const fnMatch = content.match(/(?:function|class|const|export\s+(?:default\s+)?(?:function|class))\s+(\w+)/);
  if (fnMatch?.[1] !== undefined) return fnMatch[1];

  return `${language || "code"} snippet`;
}

/**
 * Extract artifacts from a markdown response.
 * Finds fenced code blocks and other structured content.
 */
export function extractArtifacts(content: string): readonly ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  // Extract fenced code blocks: ```language\n...\n```
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let codeMatch: RegExpExecArray | null;

  while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
    const language = codeMatch[1] ?? "";
    const blockContent = codeMatch[2] ?? "";

    if (blockContent.trim().length === 0) continue;

    const type = detectArtifactType(language);
    const title = type === "code"
      ? generateCodeTitle(language, blockContent)
      : `${type} artifact`;

    artifacts.push({
      type,
      title,
      content: blockContent.trim(),
      language: language || undefined,
    });
  }

  // Extract tables (markdown tables with | separators)
  const tableRegex = /(\|.+\|\n\|[-\s|:]+\|\n(?:\|.+\|\n?)+)/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(content)) !== null) {
    const tableContent = tableMatch[1] ?? "";
    if (tableContent.trim().length > 0) {
      artifacts.push({
        type: "table",
        title: "Table",
        content: tableContent.trim(),
      });
    }
  }

  return artifacts;
}

// ── Version History ────────────────────────────────────

/**
 * Add a version to an artifact history.
 * Returns a new history object (immutable).
 */
export function addVersion(
  history: ArtifactHistory,
  content: string,
): ArtifactHistory {
  const newVersion: ArtifactVersion = {
    version: history.versions.length + 1,
    content,
    createdAt: new Date().toISOString(),
  };
  return {
    ...history,
    versions: [...history.versions, newVersion],
  };
}

/**
 * Create a new artifact history from an artifact.
 */
export function createHistory(artifact: Artifact): ArtifactHistory {
  return {
    artifactId: artifact.id,
    versions: [{
      version: 1,
      content: artifact.content,
      createdAt: artifact.createdAt,
    }],
  };
}

/**
 * Get a specific version from history.
 */
export function getVersion(
  history: ArtifactHistory,
  version: number,
): ArtifactVersion | undefined {
  return history.versions.find((v) => v.version === version);
}

// ── Diff Utilities ─────────────────────────────────────

export interface DiffLine {
  readonly type: "added" | "removed" | "unchanged";
  readonly content: string;
  readonly lineNumber: number;
}

/**
 * Simple line-based diff between two strings.
 * For display in the side-by-side diff viewer.
 */
export function computeLineDiff(
  oldContent: string,
  newContent: string,
): readonly DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: DiffLine[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  let lineNum = 1;

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      result.push({ type: "unchanged", content: oldLine ?? "", lineNumber: lineNum });
    } else {
      if (oldLine !== undefined) {
        result.push({ type: "removed", content: oldLine, lineNumber: lineNum });
      }
      if (newLine !== undefined) {
        result.push({ type: "added", content: newLine, lineNumber: lineNum });
      }
    }
    lineNum++;
  }

  return result;
}
