/**
 * PDF Upload Pipeline — extract structured content from PDF documents.
 *
 * Enables PDF documents as conversation context by extracting text,
 * document outline, and metadata. Inspired by the deer-flow approach
 * to document ingestion.
 *
 * EXTRACTION STRATEGY:
 * 1. Primary: `pdftotext` CLI (poppler-utils) for high-fidelity text extraction
 * 2. Fallback: `pdfinfo` for metadata, raw file read for basic text
 *
 * OUTPUT:
 * Structured content with text, outline (chapter/section headers),
 * page count, and metadata — truncated to a configurable max character limit.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

// ── Types ──────────────────────────────────────────────────

export interface PDFContent {
  readonly text: string;
  readonly outline: readonly string[];
  readonly pageCount: number;
  readonly metadata: PDFMetadata;
}

export interface PDFMetadata {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly creator: string;
  readonly producer: string;
  readonly creationDate: string;
  readonly fileSizeBytes: number;
  readonly truncated: boolean;
}

export interface PDFProcessorOptions {
  readonly maxChars: number;
}

// ── Constants ──────────────────────────────────────────────

const DEFAULT_MAX_CHARS = 50_000;
const CLI_TIMEOUT = 30_000;

// ── Availability ───────────────────────────────────────────

function isPdftotextAvailable(): boolean {
  try {
    execFileSync("which", ["pdftotext"], { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isPdfinfoAvailable(): boolean {
  try {
    execFileSync("which", ["pdfinfo"], { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Text Extraction ────────────────────────────────────────

function extractTextWithPdftotext(filePath: string): string {
  try {
    // pdftotext outputs to stdout when "-" is used as the output file
    const output = execFileSync("pdftotext", ["-layout", filePath, "-"], {
      stdio: "pipe",
      timeout: CLI_TIMEOUT,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return output;
  } catch {
    return "";
  }
}

function extractTextFallback(filePath: string): string {
  try {
    // Read raw bytes and extract printable text sequences
    const buffer = readFileSync(filePath);
    const raw = buffer.toString("utf-8", 0, Math.min(buffer.length, 2 * 1024 * 1024));

    // Extract text between stream/endstream markers (PDF text objects)
    const textChunks: string[] = [];
    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(raw)) !== null) {
      const chunk = match[1];
      if (chunk) {
        // Keep only printable ASCII and common whitespace
        const printable = chunk.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").trim();
        if (printable.length > 10) {
          textChunks.push(printable);
        }
      }
    }

    return textChunks.join("\n\n");
  } catch {
    return "";
  }
}

// ── Metadata Extraction ────────────────────────────────────

function extractMetadata(filePath: string): Omit<PDFMetadata, "fileSizeBytes" | "truncated"> {
  const empty = { title: "", author: "", subject: "", creator: "", producer: "", creationDate: "" };

  if (!isPdfinfoAvailable()) return empty;

  try {
    const output = execFileSync("pdfinfo", [filePath], {
      stdio: "pipe",
      timeout: CLI_TIMEOUT,
      encoding: "utf-8",
    });

    const fields: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        fields[key] = value;
      }
    }

    return {
      title: fields["title"] ?? "",
      author: fields["author"] ?? "",
      subject: fields["subject"] ?? "",
      creator: fields["creator"] ?? "",
      producer: fields["producer"] ?? "",
      creationDate: fields["creationdate"] ?? "",
    };
  } catch {
    return empty;
  }
}

// ── Page Count ─────────────────────────────────────────────

function extractPageCount(filePath: string): number {
  if (!isPdfinfoAvailable()) {
    // Fallback: count /Type /Page occurrences in raw PDF
    try {
      const raw = readFileSync(filePath, "utf-8");
      const matches = raw.match(/\/Type\s*\/Page[^s]/g);
      return matches ? matches.length : 0;
    } catch {
      return 0;
    }
  }

  try {
    const output = execFileSync("pdfinfo", [filePath], {
      stdio: "pipe",
      timeout: CLI_TIMEOUT,
      encoding: "utf-8",
    });

    for (const line of output.split("\n")) {
      if (line.toLowerCase().startsWith("pages:")) {
        const count = parseInt(line.split(":")[1]?.trim() ?? "0", 10);
        return Number.isFinite(count) ? count : 0;
      }
    }
  } catch {
    // Fall through
  }

  return 0;
}

// ── Outline Extraction ─────────────────────────────────────

function extractOutline(text: string): readonly string[] {
  const lines = text.split("\n");
  const headers: string[] = [];

  // Heuristic: lines that look like section headers
  // - All-caps lines (likely chapter titles)
  // - Lines matching common patterns like "Chapter N", "Section N.N", numbered headings
  const headerPatterns = [
    /^(?:chapter|section|part)\s+\d/i,
    /^\d+(?:\.\d+)*\s+[A-Z]/,           // "1.2 Some Heading"
    /^[IVXLCDM]+\.\s+/,                  // Roman numeral headings
    /^[A-Z][A-Z\s]{4,}$/,                // ALL CAPS lines (min 5 chars)
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 200) continue;

    for (const pattern of headerPatterns) {
      if (pattern.test(trimmed)) {
        headers.push(trimmed);
        break;
      }
    }
  }

  return headers;
}

// ── Main Processor ─────────────────────────────────────────

/**
 * Process a PDF file and return structured content.
 *
 * Extracts text (via pdftotext or fallback), document outline,
 * page count, and metadata. Text is truncated to maxChars (default 50K).
 *
 * @param filePath - Absolute path to the PDF file
 * @param options - Processing options (maxChars)
 * @returns Structured PDF content
 * @throws Error if the file does not exist or is not readable
 */
export function processPDF(
  filePath: string,
  options: Partial<PDFProcessorOptions> = {},
): PDFContent {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  if (!existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  // Extract text — prefer pdftotext, fall back to raw extraction
  let rawText = isPdftotextAvailable()
    ? extractTextWithPdftotext(filePath)
    : extractTextFallback(filePath);

  // If pdftotext returned empty, try fallback too
  if (!rawText.trim() && isPdftotextAvailable()) {
    rawText = extractTextFallback(filePath);
  }

  // Truncate if needed
  const truncated = rawText.length > maxChars;
  const text = truncated ? rawText.slice(0, maxChars) : rawText;

  // Extract structure and metadata
  const outline = extractOutline(rawText);
  const pageCount = extractPageCount(filePath);
  const metaFields = extractMetadata(filePath);

  const metadata: PDFMetadata = {
    ...metaFields,
    fileSizeBytes: stats.size,
    truncated,
  };

  return { text, outline, pageCount, metadata };
}
