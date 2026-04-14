/**
 * Encoding Detection & Conversion — inspired by lightpanda 0.2.8.
 *
 * Detects non-UTF-8 HTML/text content and converts to UTF-8.
 * Critical for robust web scraping where pages serve content
 * in legacy encodings (Shift_JIS, GB2312, ISO-8859-1, etc.).
 *
 * Uses iconv-lite when available, falls back to TextDecoder API.
 */

// ── Types ────────────────────────────────────────────────

export interface EncodingResult {
  readonly text: string;
  readonly detectedEncoding: string;
  readonly wasConverted: boolean;
}

// ── Common Encoding Patterns ─────────────────────────────

const ENCODING_PATTERNS: readonly { readonly pattern: RegExp; readonly encoding: string }[] = [
  { pattern: /charset\s*=\s*["']?utf-8/i, encoding: "utf-8" },
  { pattern: /charset\s*=\s*["']?shift[_-]?jis/i, encoding: "shift_jis" },
  { pattern: /charset\s*=\s*["']?euc-jp/i, encoding: "euc-jp" },
  { pattern: /charset\s*=\s*["']?iso-2022-jp/i, encoding: "iso-2022-jp" },
  { pattern: /charset\s*=\s*["']?gb2312/i, encoding: "gb2312" },
  { pattern: /charset\s*=\s*["']?gbk/i, encoding: "gbk" },
  { pattern: /charset\s*=\s*["']?gb18030/i, encoding: "gb18030" },
  { pattern: /charset\s*=\s*["']?big5/i, encoding: "big5" },
  { pattern: /charset\s*=\s*["']?euc-kr/i, encoding: "euc-kr" },
  { pattern: /charset\s*=\s*["']?iso-8859-1/i, encoding: "iso-8859-1" },
  { pattern: /charset\s*=\s*["']?iso-8859-15/i, encoding: "iso-8859-15" },
  { pattern: /charset\s*=\s*["']?windows-1252/i, encoding: "windows-1252" },
  { pattern: /charset\s*=\s*["']?windows-1251/i, encoding: "windows-1251" },
  { pattern: /charset\s*=\s*["']?koi8-r/i, encoding: "koi8-r" },
  { pattern: /charset\s*=\s*["']?latin1/i, encoding: "iso-8859-1" },
];

// ── Functions ────────────────────────────────────────────

/**
 * Detect encoding from HTML content or HTTP headers.
 * Checks meta charset tags and Content-Type headers.
 */
export function detectEncoding(content: Buffer, contentType?: string): string {
  // Check Content-Type header first
  if (contentType) {
    for (const { pattern, encoding } of ENCODING_PATTERNS) {
      if (pattern.test(contentType)) return encoding;
    }
  }

  // Check first 1KB of content for meta charset
  const head = content.subarray(0, 1024).toString("ascii");
  for (const { pattern, encoding } of ENCODING_PATTERNS) {
    if (pattern.test(head)) return encoding;
  }

  // BOM detection
  if (content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF) return "utf-8";
  if (content[0] === 0xFF && content[1] === 0xFE) return "utf-16le";
  if (content[0] === 0xFE && content[1] === 0xFF) return "utf-16be";

  // Heuristic: check for non-UTF-8 byte sequences
  if (isValidUTF8(content)) return "utf-8";

  // Default fallback
  return "iso-8859-1";
}

/**
 * Convert content to UTF-8 from detected or specified encoding.
 * Uses TextDecoder API (available in Node.js 12+).
 */
export function convertToUTF8(content: Buffer, encoding?: string, contentType?: string): EncodingResult {
  const detected = encoding ?? detectEncoding(content, contentType);

  if (detected === "utf-8") {
    return {
      text: content.toString("utf-8"),
      detectedEncoding: "utf-8",
      wasConverted: false,
    };
  }

  // Map common encoding names to TextDecoder labels
  const decoderLabel = ENCODING_MAP[detected.toLowerCase()] ?? detected;

  try {
    const decoder = new TextDecoder(decoderLabel, { fatal: false });
    const text = decoder.decode(content);
    return {
      text,
      detectedEncoding: detected,
      wasConverted: true,
    };
  } catch {
    // TextDecoder doesn't support this encoding — fall back to lossy UTF-8
    return {
      text: content.toString("utf-8"),
      detectedEncoding: detected,
      wasConverted: false,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────

const ENCODING_MAP: Readonly<Record<string, string>> = {
  "shift_jis": "shift-jis",
  "shift-jis": "shift-jis",
  "euc-jp": "euc-jp",
  "iso-2022-jp": "iso-2022-jp",
  "gb2312": "gb2312",
  "gbk": "gbk",
  "gb18030": "gb18030",
  "big5": "big5",
  "euc-kr": "euc-kr",
  "iso-8859-1": "iso-8859-1",
  "iso-8859-15": "iso-8859-15",
  "windows-1252": "windows-1252",
  "windows-1251": "windows-1251",
  "koi8-r": "koi8-r",
  "latin1": "iso-8859-1",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
};

/**
 * Check if a buffer contains valid UTF-8 data.
 * Returns false if invalid byte sequences are found.
 */
function isValidUTF8(buf: Buffer): boolean {
  let i = 0;
  while (i < buf.length) {
    const byte = buf[i]!;
    let seqLen: number;

    if (byte <= 0x7F) { seqLen = 1; }
    else if ((byte & 0xE0) === 0xC0) { seqLen = 2; }
    else if ((byte & 0xF0) === 0xE0) { seqLen = 3; }
    else if ((byte & 0xF8) === 0xF0) { seqLen = 4; }
    else { return false; }

    if (i + seqLen > buf.length) return false;

    for (let j = 1; j < seqLen; j++) {
      if ((buf[i + j]! & 0xC0) !== 0x80) return false;
    }

    i += seqLen;
  }
  return true;
}
