/**
 * ONNX cross-encoder — Phase 2 P1-M2 (OMEGA port) + V9 Wave 4-CC
 * real WordPiece tokenizer.
 *
 * Cross-encoders score (query, doc) PAIRS for relevance and are the
 * rerank standard after dense+sparse retrieval. OMEGA uses
 * `cross-encoder/ms-marco-MiniLM-L-6-v2` (Apache-2.0, ~90MB) via
 * onnxruntime-node. This module is the WOTANN port.
 *
 * Design notes:
 *
 *   1. ONNX runtime + model are OPTIONAL. The module surfaces two
 *      probe functions:
 *        - isOnnxRuntimeAvailable(): boolean — is the native runtime
 *          importable?
 *        - isMiniLmModelAvailable(path?): boolean — is the specific
 *          model file on disk?
 *      Callers (store.ts, temprSearch) use these to decide whether
 *      to wire the ONNX session or stay on M4's heuristic encoder.
 *
 *   2. Model files are LARGE (~90MB) and NEVER committed. A dedicated
 *      `scripts/download-minilm.mjs` (like the LongMemEval script)
 *      handles opt-in download into `.wotann/models/`. The companion
 *      `vocab.txt` (~226KB BERT WordPiece vocab) is downloaded by the
 *      same script and lives next to the model file.
 *
 *   3. Honest fallback: if the session throws during rerank, we fall
 *      back to the M4 heuristic encoder per-batch. The caller gets
 *      a result (never a crash) but `rerankerApplied: false` in the
 *      TEMPR result signals the graceful degradation.
 *
 *   4. Tokenization (V9 Wave 4-CC): MiniLM uses a 30522-token
 *      WordPiece vocab (BERT-base uncased). This module ships TWO
 *      tokenizers:
 *        - tokenizePair: SIMPLIFIED byte-level fallback. Produces
 *          a stable input shape but scores are not semantically
 *          equivalent to real WordPiece. Honest stub when vocab is
 *          unavailable.
 *        - WordPieceTokenizer + createWordPieceTokenizePair: real
 *          BERT-style tokenization (BasicTokenizer + greedy WordPiece
 *          subword). Loads vocab.txt lazily; per-instance state (no
 *          module globals) so multiple models can co-exist.
 *      Use `loadMiniLmTokenizer(vocabPath?)` to get a `PairTokenizer`
 *      that auto-falls-back to byte-level when vocab.txt is missing.
 *
 *   5. Injection: the `session` config accepts any object conforming
 *      to the OnnxSession interface. Tests use a mock; production
 *      uses onnxruntime-node's `InferenceSession`. The interface is
 *      intentionally NARROW so other runtimes (WebGL, ORT WebAssembly)
 *      can be swapped without touching callers.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import {
  createHeuristicCrossEncoder,
  type CrossEncoder,
  type CrossEncoderCandidate,
  type CrossEncoderHit,
} from "./cross-encoder.js";

// ── Types ──────────────────────────────────────────────

/**
 * Narrow interface over onnxruntime-node's InferenceSession. We only
 * need `run(feeds)` returning output tensors keyed by output name.
 * This lets tests mock the session without dragging in the native
 * runtime.
 */
export interface OnnxSession {
  readonly run: (feeds: Record<string, OnnxTensor>) => Promise<Record<string, OnnxTensor>>;
}

export interface OnnxTensor {
  readonly data: BigInt64Array | Float32Array | Int32Array;
  readonly dims?: readonly number[];
}

/**
 * Tokenized (query, doc) pair ready for ONNX input. Values mirror
 * MiniLM's 3-input schema: input_ids, attention_mask, token_type_ids.
 */
export interface TokenizedPair {
  readonly inputIds: BigInt64Array;
  readonly attentionMask: BigInt64Array;
  readonly tokenTypeIds: BigInt64Array;
}

/**
 * Custom tokenizer signature for callers that want real WordPiece.
 * Default tokenizer is deterministic but not semantically optimal.
 */
export type PairTokenizer = (query: string, doc: string, maxLen?: number) => TokenizedPair;

export interface OnnxCrossEncoderConfig {
  /**
   * ONNX inference session. When undefined, rerank() ALWAYS falls back
   * to the M4 heuristic encoder. Pass a real session (from
   * onnxruntime-node's InferenceSession.create()) for production.
   */
  readonly session?: OnnxSession;
  /** Override the input tokenizer. Default: tokenizePair. */
  readonly tokenize?: PairTokenizer;
  /** Max token sequence length. Default 128 (MiniLM's typical ceiling). */
  readonly maxLength?: number;
  /** Output tensor name on the ONNX graph. Default "logits". */
  readonly outputName?: string;
}

// ── Availability probes ───────────────────────────────

let ortProbeCache: boolean | null = null;

/**
 * Is onnxruntime-node loadable in this process? Cached. Does NOT
 * require a model file — only that the native runtime binary is
 * available. Callers still need to verify the model file separately.
 */
export function isOnnxRuntimeAvailable(): boolean {
  if (ortProbeCache !== null) return ortProbeCache;
  try {
    require("onnxruntime-node");
    ortProbeCache = true;
  } catch {
    ortProbeCache = false;
  }
  return ortProbeCache;
}

/**
 * Is a MiniLM ONNX model file present on disk? Defaults to looking at
 * `.wotann/models/ms-marco-MiniLM-L-6-v2.onnx` (set by the download
 * script). Callers can pass an explicit path.
 */
export function isMiniLmModelAvailable(path?: string): boolean {
  const p = path ?? defaultModelPath();
  try {
    if (!existsSync(p)) return false;
    const s = statSync(p);
    return s.isFile() && s.size > 1024; // sanity: reject 0-byte stubs
  } catch {
    return false;
  }
}

function defaultModelPath(): string {
  return `${process.cwd()}/.wotann/models/ms-marco-MiniLM-L-6-v2.onnx`;
}

/**
 * Default vocab path. Lives next to the model file so a single
 * `download-minilm.mjs` call provisions both. ~226KB plain text,
 * one token per line (BERT vocab.txt format).
 */
function defaultVocabPath(): string {
  return `${process.cwd()}/.wotann/models/ms-marco-MiniLM-L-6-v2.vocab.txt`;
}

/**
 * Is a BERT vocab.txt present on disk for MiniLM? Independent of the
 * .onnx model probe — the runtime can load the model without vocab
 * (it just shapes inputs poorly), and a vocab without a model is
 * still useful for offline tokenization tests.
 */
export function isMiniLmVocabAvailable(path?: string): boolean {
  const p = path ?? defaultVocabPath();
  try {
    if (!existsSync(p)) return false;
    const s = statSync(p);
    return s.isFile() && s.size > 1024; // sanity: vocab.txt is ~226KB
  } catch {
    return false;
  }
}

// ── WordPiece tokenizer (V9 Wave 4-CC) ────────────────

/**
 * BERT-style special tokens. Ids match the standard bert-base-uncased
 * vocab.txt layout:
 *   line 0: [PAD]   → id 0
 *   line 100: [UNK] → id 100
 *   line 101: [CLS] → id 101
 *   line 102: [SEP] → id 102
 *   line 103: [MASK]→ id 103
 * The byte-level fallback uses the same magic constants for
 * cross-tokenizer shape compatibility.
 */
const BERT_PAD = "[PAD]";
const BERT_UNK = "[UNK]";
const BERT_CLS = "[CLS]";
const BERT_SEP = "[SEP]";

/**
 * WordPiece tokenizer state. Per-instance (NOT module-global per
 * QB#7) so multiple vocabs can coexist (e.g., a MiniLM vocab AND
 * a fine-tuned reranker vocab in the same process).
 *
 * Construct via `loadWordPieceTokenizer(path)`. The class is exported
 * so callers can build a tokenizer from a vocab they already have in
 * memory (e.g., bundled, fetched, generated for tests).
 */
export class WordPieceTokenizer {
  /** Token → id lookup. Built once at construction; never mutated. */
  private readonly vocab: ReadonlyMap<string, number>;
  /** Cached id for [UNK]. */
  private readonly unkId: number;
  /** Cached id for [CLS]. */
  private readonly clsId: number;
  /** Cached id for [SEP]. */
  private readonly sepId: number;
  /** Cached id for [PAD]. */
  private readonly padId: number;
  /**
   * BERT base uncased lowercases inputs (and strips accents). Some
   * vocabs (`bert-base-cased`) keep case. Default true matches MiniLM.
   */
  private readonly doLowerCase: boolean;
  /** Max characters per word — WordPiece splits long words to UNK. */
  private readonly maxWordCharsForUnk: number;

  constructor(
    vocab: ReadonlyMap<string, number>,
    options?: { readonly doLowerCase?: boolean; readonly maxWordCharsForUnk?: number },
  ) {
    if (vocab.size === 0) {
      throw new Error("WordPieceTokenizer: vocab is empty");
    }
    this.vocab = vocab;
    this.doLowerCase = options?.doLowerCase ?? true;
    this.maxWordCharsForUnk = options?.maxWordCharsForUnk ?? 100;
    // [UNK] is required. CLS/SEP/PAD fall back to numeric defaults
    // so a partial vocab still tokenizes (with degraded specials).
    const unk = vocab.get(BERT_UNK);
    if (unk === undefined) {
      throw new Error("WordPieceTokenizer: vocab missing [UNK] (corrupt or non-BERT vocab)");
    }
    this.unkId = unk;
    this.clsId = vocab.get(BERT_CLS) ?? 101;
    this.sepId = vocab.get(BERT_SEP) ?? 102;
    this.padId = vocab.get(BERT_PAD) ?? 0;
  }

  /** Special-token ids exposed for downstream pair builders. */
  readonly specials = (): { cls: number; sep: number; pad: number; unk: number } => ({
    cls: this.clsId,
    sep: this.sepId,
    pad: this.padId,
    unk: this.unkId,
  });

  /**
   * Tokenize a single string into vocab ids. Implements the standard
   * BERT pipeline: BasicTokenizer (clean → lowercase+strip-accents →
   * punctuation split) → WordPiece (greedy longest-match subword).
   */
  encode(text: string): number[] {
    const words = this.basicTokenize(text);
    const ids: number[] = [];
    for (const word of words) {
      this.wordPieceEncode(word, ids);
    }
    return ids;
  }

  /**
   * BasicTokenizer: whitespace + punctuation split, optional
   * lowercase + accent stripping. Returns the word stream.
   */
  private basicTokenize(text: string): string[] {
    const cleaned = cleanText(text);
    const lowered = this.doLowerCase ? stripAccents(cleaned.toLowerCase()) : cleaned;
    // Whitespace split, then per-token punctuation split.
    const words: string[] = [];
    for (const ws of lowered.split(/\s+/)) {
      if (ws.length === 0) continue;
      for (const piece of splitOnPunctuation(ws)) {
        if (piece.length > 0) words.push(piece);
      }
    }
    return words;
  }

  /**
   * Greedy longest-match WordPiece subword tokenization. For each
   * word, peel off the longest prefix that exists in the vocab,
   * then continue from the remainder with "##" prefix. If any piece
   * misses, the entire word becomes [UNK].
   */
  private wordPieceEncode(word: string, out: number[]): void {
    if (word.length > this.maxWordCharsForUnk) {
      out.push(this.unkId);
      return;
    }
    const subTokens: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let matchedId = -1;
      let matchedEnd = -1;
      while (end > start) {
        const sub = (start === 0 ? "" : "##") + word.slice(start, end);
        const id = this.vocab.get(sub);
        if (id !== undefined) {
          matchedId = id;
          matchedEnd = end;
          break;
        }
        end--;
      }
      if (matchedId === -1) {
        // Whole word fails → UNK (BERT behavior).
        out.push(this.unkId);
        return;
      }
      subTokens.push(matchedId);
      start = matchedEnd;
    }
    for (const t of subTokens) out.push(t);
  }
}

/**
 * Load a WordPiece tokenizer from a BERT vocab.txt file. Returns
 * undefined when the file is missing or malformed — caller should
 * fall back to the byte-level tokenizer (honest-stub principle, QB#6).
 *
 * vocab.txt format: one token per line, line index = token id.
 * Empty lines are PRESERVED as ids (BERT vocab has unused [unusedN]
 * slots; their ids must align with the model's embedding table).
 */
export function loadWordPieceTokenizer(
  vocabPath?: string,
  options?: { readonly doLowerCase?: boolean },
): WordPieceTokenizer | undefined {
  const p = vocabPath ?? defaultVocabPath();
  try {
    if (!existsSync(p)) return undefined;
    const raw = readFileSync(p, "utf8");
    // Split on \n only (BERT vocab is LF-terminated). Strip the
    // trailing empty line that comes from the final newline.
    const lines = raw.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length < 100) return undefined; // too small to be real vocab
    const vocab = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const tok = lines[i]!;
      // Last-write-wins on duplicates (matches HuggingFace behavior).
      vocab.set(tok, i);
    }
    return new WordPieceTokenizer(vocab, options);
  } catch {
    return undefined;
  }
}

// ── Tokenization helpers (BERT BasicTokenizer primitives) ──

/**
 * Clean the input: replace control chars and whitespace with a
 * single space. Mirrors the BERT BasicTokenizer._clean_text Python.
 */
function cleanText(text: string): string {
  // Drop NUL, BOM, replacement chars; collapse all whitespace to ' '.
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0 || code === 0xfffd || isControl(ch)) continue;
    if (isWhitespace(ch)) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

function isWhitespace(ch: string): boolean {
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return true;
  // Unicode category Zs (space separators).
  return /\s/.test(ch);
}

function isControl(ch: string): boolean {
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  const code = ch.codePointAt(0)!;
  // C0 controls + DEL + C1 controls.
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return true;
  return false;
}

function isPunctuation(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  // ASCII punctuation ranges (same as BERT _is_punctuation).
  if (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  ) {
    return true;
  }
  // Unicode P* categories — check via regex.
  return /[\p{P}\p{S}]/u.test(ch);
}

/**
 * Strip combining marks via Unicode NFD decomposition. Matches
 * BERT _run_strip_accents: NFD normalize, drop category Mn.
 */
function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}+/gu, "");
}

/**
 * Split a single word on punctuation boundaries: each punctuation
 * character becomes its own token, runs of non-punctuation stay
 * together.
 */
function splitOnPunctuation(word: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of word) {
    if (isPunctuation(ch)) {
      if (buf.length > 0) {
        out.push(buf);
        buf = "";
      }
      out.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

// ── Pair tokenizer built on a WordPiece tokenizer ──

/**
 * Build a `PairTokenizer` (the config slot type) backed by a real
 * WordPiece tokenizer. The output mirrors BERT's pair-input schema:
 *
 *   [CLS] query-tokens [SEP] doc-tokens [SEP] [PAD...]
 *
 * with token_type_ids 0 for the query side and 1 for the doc side
 * (same as the existing byte-level `tokenizePair`).
 *
 * Returned function is pure on the captured tokenizer — no shared
 * mutable state across calls.
 */
export function createWordPieceTokenizePair(tokenizer: WordPieceTokenizer): PairTokenizer {
  const { cls, sep, pad } = tokenizer.specials();
  return (query: string, doc: string, maxLen: number = 128): TokenizedPair => {
    const len = Math.max(8, Math.floor(maxLen));
    const halfBudget = Math.max(1, Math.floor((len - 3) / 2));
    const qIds = tokenizer.encode(query).slice(0, halfBudget);
    const dIds = tokenizer.encode(doc).slice(0, halfBudget);

    const inputIds = new BigInt64Array(len);
    const attentionMask = new BigInt64Array(len);
    const tokenTypeIds = new BigInt64Array(len);

    let pos = 0;
    inputIds[pos] = BigInt(cls);
    attentionMask[pos] = 1n;
    tokenTypeIds[pos] = 0n;
    pos++;

    for (const id of qIds) {
      if (pos >= len - 2) break;
      inputIds[pos] = BigInt(id);
      attentionMask[pos] = 1n;
      tokenTypeIds[pos] = 0n;
      pos++;
    }

    if (pos < len) {
      inputIds[pos] = BigInt(sep);
      attentionMask[pos] = 1n;
      tokenTypeIds[pos] = 0n;
      pos++;
    }

    for (const id of dIds) {
      if (pos >= len - 1) break;
      inputIds[pos] = BigInt(id);
      attentionMask[pos] = 1n;
      tokenTypeIds[pos] = 1n;
      pos++;
    }

    if (pos < len) {
      inputIds[pos] = BigInt(sep);
      attentionMask[pos] = 1n;
      tokenTypeIds[pos] = 1n;
      pos++;
    }

    for (; pos < len; pos++) {
      inputIds[pos] = BigInt(pad);
      attentionMask[pos] = 0n;
      tokenTypeIds[pos] = 0n;
    }

    return { inputIds, attentionMask, tokenTypeIds };
  };
}

/**
 * High-level loader: returns a `PairTokenizer` backed by real
 * WordPiece when vocab.txt is present, or `undefined` when missing.
 * Callers should fall back to `tokenizePair` (the byte-level stub)
 * on undefined per QB#6 honest-fallback.
 *
 * Example wiring in store.ts (T1.4 attach point):
 *   const pairTokenizer =
 *     loadMiniLmTokenizer(vocabPath) ?? tokenizePair;
 *   const enc = createOnnxCrossEncoder({ session, tokenize: pairTokenizer });
 */
export function loadMiniLmTokenizer(vocabPath?: string): PairTokenizer | undefined {
  const tok = loadWordPieceTokenizer(vocabPath);
  if (!tok) return undefined;
  return createWordPieceTokenizePair(tok);
}

// ── Simplified tokenizer (MVP byte-level fallback) ────

/**
 * Byte-level deterministic tokenizer for (query, doc) pairs. HONEST
 * STUB (QB#6): produces a stable input shape so the ONNX runtime can
 * process the pair, but the scores it produces are NOT semantically
 * equivalent to real WordPiece on MiniLM.
 *
 * Use the real path when vocab.txt is on disk:
 *   const tok = loadMiniLmTokenizer();              // PairTokenizer | undefined
 *   const enc = createOnnxCrossEncoder({
 *     session,
 *     tokenize: tok ?? tokenizePair,                // honest fallback
 *   });
 *
 * Schema mirrors BERT-family:
 *   [CLS] query-tokens [SEP] doc-tokens [SEP] [PAD...]
 *
 * Special token ids (matched to BERT-base-uncased so a real model
 * sees the right specials even on the stub path):
 *   CLS=101, SEP=102, PAD=0
 */
export function tokenizePair(query: string, doc: string, maxLen: number = 128): TokenizedPair {
  const len = Math.max(8, Math.floor(maxLen));
  const CLS = 101n;
  const SEP = 102n;
  const PAD = 0n;

  // Byte tokens: take up to len/2 - 2 from each side to fit + specials.
  const halfBudget = Math.max(1, Math.floor((len - 3) / 2));
  const qBytes = stringToTokens(query, halfBudget);
  const dBytes = stringToTokens(doc, halfBudget);

  const inputIds = new BigInt64Array(len);
  const attentionMask = new BigInt64Array(len);
  const tokenTypeIds = new BigInt64Array(len);

  let pos = 0;
  inputIds[pos] = CLS;
  attentionMask[pos] = 1n;
  tokenTypeIds[pos] = 0n;
  pos++;

  for (const t of qBytes) {
    if (pos >= len - 2) break;
    inputIds[pos] = t;
    attentionMask[pos] = 1n;
    tokenTypeIds[pos] = 0n;
    pos++;
  }

  if (pos < len) {
    inputIds[pos] = SEP;
    attentionMask[pos] = 1n;
    tokenTypeIds[pos] = 0n;
    pos++;
  }

  for (const t of dBytes) {
    if (pos >= len - 1) break;
    inputIds[pos] = t;
    attentionMask[pos] = 1n;
    tokenTypeIds[pos] = 1n;
    pos++;
  }

  if (pos < len) {
    inputIds[pos] = SEP;
    attentionMask[pos] = 1n;
    tokenTypeIds[pos] = 1n;
    pos++;
  }

  // Pad remaining with PAD, attention_mask=0.
  for (; pos < len; pos++) {
    inputIds[pos] = PAD;
    attentionMask[pos] = 0n;
    tokenTypeIds[pos] = 0n;
  }

  return { inputIds, attentionMask, tokenTypeIds };
}

function stringToTokens(s: string, maxTokens: number): bigint[] {
  const out: bigint[] = [];
  const buf = Buffer.from(s || "", "utf8");
  // Offset by 110 so we don't collide with CLS/SEP (101/102) or PAD (0).
  // This is a simplified scheme — real MiniLM uses WordPiece with ~30k
  // vocab. See module docstring for the upgrade path.
  for (let i = 0; i < buf.length && out.length < maxTokens; i++) {
    out.push(BigInt(buf[i]! + 110));
  }
  return out;
}

// ── Cross-encoder factory ─────────────────────────────

export function createOnnxCrossEncoder(config: OnnxCrossEncoderConfig): CrossEncoder {
  const tokenize = config.tokenize ?? tokenizePair;
  const maxLength = config.maxLength ?? 128;
  const outputName = config.outputName ?? "logits";

  // No session → permanently in heuristic mode. This is the honest
  // default when the environment lacks ONNX or the model is missing.
  if (!config.session) {
    return createHeuristicCrossEncoder();
  }

  const session = config.session;
  const heuristic = createHeuristicCrossEncoder();

  return {
    rerank: async (query, candidates) => {
      if (candidates.length === 0) return [];

      const scores: number[] = new Array(candidates.length).fill(0);
      let sessionFailed = false;

      // Score each pair independently. Could be batched for perf, but
      // MVP is one pair per run() for correctness.
      for (let i = 0; i < candidates.length; i++) {
        if (sessionFailed) break;
        const cand = candidates[i]!;
        try {
          const tok = tokenize(query, cand.content, maxLength);
          const feeds: Record<string, OnnxTensor> = {
            input_ids: { data: tok.inputIds, dims: [1, maxLength] },
            attention_mask: { data: tok.attentionMask, dims: [1, maxLength] },
            token_type_ids: { data: tok.tokenTypeIds, dims: [1, maxLength] },
          };
          const out = await session.run(feeds);
          const logits = out[outputName];
          if (!logits || !logits.data) {
            sessionFailed = true;
            break;
          }
          const arr = logits.data as Float32Array;
          const score = arr.length > 0 ? Number(arr[0]) : 0;
          scores[i] = Number.isFinite(score) ? score : 0;
        } catch {
          sessionFailed = true;
          break;
        }
      }

      if (sessionFailed) {
        // Honest fallback: whole-batch heuristic rerank. Consistent with
        // M4's createCrossEncoderFromFn behavior.
        return heuristic.rerank(query, candidates);
      }

      return buildHits(candidates, scores);
    },
  };
}

// ── Loader for real MiniLM session ────────────────────

/**
 * Load the ms-marco-MiniLM-L-6-v2 ONNX model into an
 * onnxruntime-node session. Returns undefined if the runtime or the
 * model file is missing. Callers SHOULD handle undefined by calling
 * `createOnnxCrossEncoder({})` (no session → heuristic fallback).
 *
 * This is an async loader — the caller awaits once at startup and
 * reuses the session across queries.
 */
export async function loadMiniLmSession(modelPath?: string): Promise<OnnxSession | undefined> {
  if (!isOnnxRuntimeAvailable()) return undefined;
  const p = modelPath ?? defaultModelPath();
  if (!isMiniLmModelAvailable(p)) return undefined;
  try {
    const ort = require("onnxruntime-node") as {
      InferenceSession: {
        create: (path: string) => Promise<OnnxSession>;
      };
    };
    const session = await ort.InferenceSession.create(p);
    return session;
  } catch {
    return undefined;
  }
}

// ── Helpers ───────────────────────────────────────────

function buildHits(
  cands: readonly CrossEncoderCandidate[],
  scores: readonly number[],
): readonly CrossEncoderHit[] {
  const hits: CrossEncoderHit[] = cands.map((c, i) => ({
    id: c.id,
    content: c.content,
    score: Number(scores[i] ?? 0),
  }));
  hits.sort((a, b) => b.score - a.score);
  return hits;
}
