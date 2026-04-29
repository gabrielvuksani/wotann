/**
 * Content-aware loop detector. Sliding-window hash of (tool_name,
 * salient_args). Two trigger modes:
 *   1. Exact-signature repetition: 3 reps -> warn, 5 reps -> force stop.
 *   2. Per-tool frequency: 30/window -> warn, 50/window -> force stop.
 *
 * Bucketing: read_file with overlapping ranges hashes to same bucket
 * (line offsets rounded to 200-line buckets). Other tools use a stable
 * subset of args (path/url/key) ignoring noisy fields (timestamps,
 * cursor positions, etc.).
 *
 * The "exact-signature" verdict beats the "per-tool frequency" verdict
 * when both fire on the same observation — a tight repetition is more
 * actionable than a generic "too much of one tool" signal.
 *
 * Inspired by bytedance/deer-flow:
 *   backend/packages/harness/deerflow/agents/middlewares/loop_detection_middleware.py
 *
 * Created per-session (QB#7) — never hold module-global state.
 */

export interface LoopDetectorConfig {
  /** Most-recent N tool calls retained for both checks. */
  readonly windowSize: number;
  /** Exact-signature repetitions in window that trigger warn. */
  readonly repeatWarnThreshold: number;
  /** Exact-signature repetitions in window that trigger stop. */
  readonly repeatStopThreshold: number;
  /** Per-tool frequency in window that triggers warn. */
  readonly perToolWarnThreshold: number;
  /** Per-tool frequency in window that triggers stop. */
  readonly perToolStopThreshold: number;
  /** Bucket size (lines) used when hashing read_file ranges. */
  readonly readFileLineBucket: number;
}

export const DEFAULT_LOOP_DETECTOR: LoopDetectorConfig = {
  windowSize: 50,
  repeatWarnThreshold: 3,
  repeatStopThreshold: 5,
  perToolWarnThreshold: 30,
  perToolStopThreshold: 50,
  readFileLineBucket: 200,
};

export type LoopVerdict =
  | { type: "ok" }
  | {
      type: "warn";
      reason: string;
      details: { signature: string; reps: number };
    }
  | {
      type: "stop";
      reason: string;
      details: { signature: string; reps: number };
    };

export interface LoopDetector {
  observe(call: { name: string; args: unknown }): LoopVerdict;
  reset(): void;
}

// ── Salient-args extraction ──────────────────────────────────

const READ_TOOLS = new Set(["read_file", "read", "Read", "view_file", "view"]);

const EDIT_TOOLS = new Set([
  "edit_file",
  "edit",
  "Edit",
  "write_file",
  "write",
  "Write",
  "MultiEdit",
  "create_file",
  "str_replace",
]);

const BASH_TOOLS = new Set(["bash", "Bash", "execute", "shell", "run"]);

const FETCH_TOOLS = new Set([
  "web_fetch",
  "WebFetch",
  "browser_navigate",
  "navigate",
  "browser_goto",
]);

const GREP_TOOLS = new Set(["grep", "Grep", "search", "search_for_pattern", "ripgrep"]);

const MAX_DEFAULT_SIG_LEN = 200;

/** Normalize a URL — strip query/hash, drop trailing slashes. */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    // Not a URL — strip query string heuristically.
    const q = raw.indexOf("?");
    const h = raw.indexOf("#");
    let cut = raw.length;
    if (q >= 0) cut = Math.min(cut, q);
    if (h >= 0) cut = Math.min(cut, h);
    return raw.slice(0, cut).replace(/\/+$/, "");
  }
}

function readArg(args: Record<string, unknown> | undefined, ...keys: readonly string[]): unknown {
  if (!args) return undefined;
  for (const key of keys) {
    if (key in args) return args[key];
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Stable JSON.stringify with sorted keys at every level. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Build a stable signature for a tool call. Per-tool rules:
 *
 *   - read_file/read: path + line-start bucketed to readFileLineBucket
 *   - edit_file/edit/write_file/write: path only (different content,
 *     same path = potential loop)
 *   - bash/execute: trimmed full command string
 *   - web_fetch/browser_navigate: url, query string stripped
 *   - grep/search: pattern + path
 *   - default: stable JSON.stringify of args (sorted keys), capped at
 *     MAX_DEFAULT_SIG_LEN chars
 */
export function extractSignature(
  name: string,
  args: unknown,
  bucket: number = DEFAULT_LOOP_DETECTOR.readFileLineBucket,
): string {
  const a =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : undefined;

  if (READ_TOOLS.has(name)) {
    const path = asString(readArg(a, "path", "file", "file_path", "filename")) ?? "";
    const start = asNumber(readArg(a, "lineStart", "line_start", "offset", "start", "line")) ?? 0;
    const safeBucket = bucket > 0 ? bucket : 1;
    const bucketed = Math.floor(start / safeBucket) * safeBucket;
    return `${name}|${path}|${bucketed}`;
  }

  if (EDIT_TOOLS.has(name)) {
    const path = asString(readArg(a, "path", "file", "file_path", "filename")) ?? "";
    return `${name}|${path}`;
  }

  if (BASH_TOOLS.has(name)) {
    const cmd = asString(readArg(a, "command", "cmd", "script", "code")) ?? "";
    return `${name}|${cmd.trim()}`;
  }

  if (FETCH_TOOLS.has(name)) {
    const url = asString(readArg(a, "url", "uri", "href")) ?? "";
    return `${name}|${normalizeUrl(url)}`;
  }

  if (GREP_TOOLS.has(name)) {
    const pattern = asString(readArg(a, "pattern", "query", "regex", "search")) ?? "";
    const path = asString(readArg(a, "path", "directory", "cwd", "root")) ?? "";
    return `${name}|${pattern}|${path}`;
  }

  // Default fallback — stable, capped.
  const json = stableStringify(args ?? {});
  const capped = json.length > MAX_DEFAULT_SIG_LEN ? json.slice(0, MAX_DEFAULT_SIG_LEN) : json;
  return `${name}|${capped}`;
}

// ── Detector ─────────────────────────────────────────────────

/**
 * Construct a fresh LoopDetector. Holds per-session state in closure
 * variables — never module-global. Each call to makeLoopDetector() is
 * an independent instance suitable for a single Coordinator / runtime
 * lifecycle.
 */
export function makeLoopDetector(config?: Partial<LoopDetectorConfig>): LoopDetector {
  const cfg: LoopDetectorConfig = {
    ...DEFAULT_LOOP_DETECTOR,
    ...(config ?? {}),
  };

  // Sliding window of recent signatures, oldest first.
  let window: string[] = [];
  // Window of tool names in lockstep with `window`, for per-tool counts.
  let toolWindow: string[] = [];

  function reset(): void {
    window = [];
    toolWindow = [];
  }

  function observe(call: { name: string; args: unknown }): LoopVerdict {
    const sig = extractSignature(call.name, call.args, cfg.readFileLineBucket);

    // Append, then enforce window size.
    window.push(sig);
    toolWindow.push(call.name);
    while (window.length > cfg.windowSize) {
      window.shift();
      toolWindow.shift();
    }

    // Count this signature within the current window.
    let sigCount = 0;
    for (const s of window) if (s === sig) sigCount++;

    // Count this tool name within the current window.
    let toolCount = 0;
    for (const t of toolWindow) if (t === call.name) toolCount++;

    // Exact-signature checks first (more actionable).
    if (sigCount >= cfg.repeatStopThreshold) {
      return {
        type: "stop",
        reason: `Repeated tool call detected: ${sig} (${sigCount} reps in last ${window.length}). Forced stop — agent must take a different action or finalize.`,
        details: { signature: sig, reps: sigCount },
      };
    }
    if (sigCount >= cfg.repeatWarnThreshold) {
      return {
        type: "warn",
        reason: `Possible loop on ${sig} (${sigCount} reps in last ${window.length}). Consider a different approach.`,
        details: { signature: sig, reps: sigCount },
      };
    }

    // Per-tool frequency checks.
    if (toolCount >= cfg.perToolStopThreshold) {
      return {
        type: "stop",
        reason: `Tool ${call.name} called ${toolCount} times in last ${window.length} — exceeds frequency cap. Forced stop.`,
        details: { signature: sig, reps: toolCount },
      };
    }
    if (toolCount >= cfg.perToolWarnThreshold) {
      return {
        type: "warn",
        reason: `High frequency: ${call.name} called ${toolCount} times in last ${window.length}. Consider a different approach.`,
        details: { signature: sig, reps: toolCount },
      };
    }

    return { type: "ok" };
  }

  return { observe, reset };
}
