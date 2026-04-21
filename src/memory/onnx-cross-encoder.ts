/**
 * ONNX cross-encoder — Phase 2 P1-M2 (OMEGA port).
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
 *      handles opt-in download into `.wotann/models/`.
 *
 *   3. Honest fallback: if the session throws during rerank, we fall
 *      back to the M4 heuristic encoder per-batch. The caller gets
 *      a result (never a crash) but `rerankerApplied: false` in the
 *      TEMPR result signals the graceful degradation.
 *
 *   4. Tokenization: MiniLM uses a 30522-token WordPiece vocab. Full
 *      WordPiece requires a vocab file (~200KB). For the MVP port we
 *      ship a SIMPLIFIED byte-level tokenizer that produces a stable
 *      (if not semantically optimal) input shape. Real MiniLM quality
 *      requires the proper vocab — callers can inject their own
 *      `tokenize` function via the config (see OnnxCrossEncoderConfig).
 *
 *   5. Injection: the `session` config accepts any object conforming
 *      to the OnnxSession interface. Tests use a mock; production
 *      uses onnxruntime-node's `InferenceSession`. The interface is
 *      intentionally NARROW so other runtimes (WebGL, ORT WebAssembly)
 *      can be swapped without touching callers.
 */

import { existsSync, statSync } from "node:fs";
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

// ── Simplified tokenizer (MVP) ────────────────────────

/**
 * Byte-level deterministic tokenizer for (query, doc) pairs. This
 * produces a stable input shape so the ONNX runtime can process the
 * pair, but the scores it produces are NOT semantically equivalent to
 * real WordPiece on MiniLM. For production, pass a proper WordPiece
 * tokenizer via `config.tokenize`.
 *
 * Schema mirrors BERT-family:
 *   [CLS] query-tokens [SEP] doc-tokens [SEP] [PAD...]
 *
 * Special token ids (arbitrary, stable):
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
