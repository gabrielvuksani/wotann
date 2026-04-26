/**
 * Plugin loader — V9 T14.1 port of Claude Code v2.1.91 plugin bin/executables.
 *
 * A plugin installed into `.wotann/plugins/<name>/` can declare `bin`
 * entries in its manifest (`plugin.json` or `manifest.json`). Each bin
 * entry becomes a runnable command the runtime can hand off to its
 * sandbox/spawn layer — this module does NOT execute anything. It only
 * discovers, validates, and normalizes the declarations into
 * `LoadedBin` records ready for downstream invocation.
 *
 * Design notes:
 *   - Manifest shape extends {@link ./manifest.ts PluginEntry} with an
 *     optional `bins` array. We do not mutate the canonical manifest
 *     file; this loader parses plugin-local descriptors.
 *   - All fs access is injectable for deterministic tests — production
 *     defaults to node:fs sync APIs.
 *   - Malformed plugins are captured in `skipped[]` with a reason; they
 *     never cause the whole load to fail. A genuine top-level failure
 *     (e.g. unreadable pluginsRoot) returns an ok:false result.
 *   - Path traversal, absolute paths, null bytes, bad names, and
 *     non-executable files are all rejected. When the exec bit is
 *     missing we still load the bin but emit a warning via `skipped[]`
 *     so the runtime can surface it.
 */

import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
} from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Raw bin declaration as it appears in a plugin's manifest. Mirrors the
 * canonical Claude Code v2.1.91 shape with WOTANN-specific extensions
 * (argv prefix, env, timeout).
 */
export interface PluginBinEntry {
  readonly name: string;
  readonly path: string;
  readonly description?: string;
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout_ms?: number;
}

/**
 * Result of successfully loading one plugin directory.
 */
export interface LoadedPlugin {
  readonly name: string;
  readonly root: string;
  readonly bins: readonly LoadedBin[];
  readonly manifestPath: string;
}

/**
 * Normalized bin ready for the runtime's spawn layer. The name may be
 * qualified (`<plugin>.<bin>`) when {@link LoadPluginsOptions.qualifyNames}
 * is true so plugins can't collide.
 */
export interface LoadedBin {
  readonly pluginName: string;
  readonly name: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly description?: string;
}

/**
 * Minimal filesystem surface the loader needs. Production defaults to
 * node:fs sync APIs; tests inject an in-memory stub.
 */
export interface PluginLoaderFs {
  readonly existsSync: (p: string) => boolean;
  readonly readFileSync: (p: string, enc: string) => string;
  readonly readdirSync: (p: string) => readonly string[];
  readonly statSync: (p: string) => { isDirectory: () => boolean; mode: number };
}

export interface LoadPluginsOptions {
  /** Root directory containing `<name>/` subdirs. Absolute preferred. */
  readonly pluginsRoot: string;
  /** Inject fs methods for testing. */
  readonly fs?: PluginLoaderFs;
  /** When true, bin name is `<plugin>.<bin>` so plugins can't collide. */
  readonly qualifyNames?: boolean;
}

export interface SkippedEntry {
  readonly dir: string;
  readonly reason: string;
}

export interface LoadPluginsResult {
  readonly ok: true;
  readonly plugins: readonly LoadedPlugin[];
  readonly skipped: readonly SkippedEntry[];
}

export interface LoadPluginsFailure {
  readonly ok: false;
  readonly error: string;
}

export type LoadPluginsOutcome = LoadPluginsResult | LoadPluginsFailure;

// ── Constants ──────────────────────────────────────────────────────────

/** Default timeout if the bin entry omits `timeout_ms`. */
export const DEFAULT_BIN_TIMEOUT_MS = 60_000;

/** Manifest filenames tried in order (first match wins). */
const MANIFEST_CANDIDATES: readonly string[] = ["plugin.json", "manifest.json"];

/** User-exec bit in POSIX mode. */
const USER_EXEC_BIT = 0o100;

/** Kebab-case name pattern shared by plugin and bin names. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Scan `pluginsRoot` for plugin directories and collect their bin
 * declarations. Never throws for per-plugin problems — those become
 * `skipped[]` entries. Only returns `ok:false` when the root itself
 * can't be read.
 */
export function loadPlugins(options: LoadPluginsOptions): LoadPluginsOutcome {
  const fs = options.fs ?? defaultFs();
  const root = options.pluginsRoot;
  const qualify = options.qualifyNames ?? false;

  if (!fs.existsSync(root)) {
    return { ok: true, plugins: [], skipped: [] };
  }

  let childNames: readonly string[];
  try {
    childNames = fs.readdirSync(root);
  } catch (err) {
    return {
      ok: false,
      error: `failed to read pluginsRoot: ${describeError(err)}`,
    };
  }

  const plugins: LoadedPlugin[] = [];
  const skipped: SkippedEntry[] = [];

  // Stable order keeps test assertions deterministic.
  const sortedChildren = [...childNames].sort();

  for (const child of sortedChildren) {
    const dir = joinPath(root, child);
    processPluginDir({ dir, name: child, fs, qualify, plugins, skipped });
  }

  return { ok: true, plugins, skipped };
}

export interface BuildBinInvocationOptions {
  readonly bin: LoadedBin;
  readonly userArgs?: readonly string[];
  readonly extraEnv?: Readonly<Record<string, string>>;
}

export interface BinInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

/**
 * Build a ready-to-spawn invocation struct. Pure — does NOT execute.
 *
 * Arg order: the bin's pre-prefix argv comes first, then user args
 * appended after. This matches npm's `bin` convention so arguments the
 * plugin author bakes in (e.g. `--safe-mode`) always run.
 *
 * Env precedence: extraEnv > bin.env. Later keys win on conflict.
 */
export function buildBinInvocation(options: BuildBinInvocationOptions): BinInvocation {
  const bin = options.bin;
  const userArgs = options.userArgs ?? [];
  const extraEnv = options.extraEnv ?? {};

  const args: string[] = [...bin.argv, ...userArgs];
  const env: Record<string, string> = { ...bin.env, ...extraEnv };

  return {
    command: bin.executable,
    args,
    env,
    timeoutMs: bin.timeoutMs,
  };
}

// ── Internal ───────────────────────────────────────────────────────────

interface ProcessArgs {
  readonly dir: string;
  readonly name: string;
  readonly fs: PluginLoaderFs;
  readonly qualify: boolean;
  readonly plugins: LoadedPlugin[];
  readonly skipped: SkippedEntry[];
}

function processPluginDir(args: ProcessArgs): void {
  const { dir, name, fs, qualify, plugins, skipped } = args;

  let stat: { isDirectory: () => boolean; mode: number };
  try {
    stat = fs.statSync(dir);
  } catch (err) {
    skipped.push({ dir, reason: `stat failed: ${describeError(err)}` });
    return;
  }
  if (!stat.isDirectory()) return;

  // Hidden / meta dirs are ignored silently — not a "skip warning".
  if (name.startsWith(".")) return;

  const manifestPath = findManifest(dir, fs);
  if (manifestPath === null) {
    skipped.push({
      dir,
      reason: `no manifest (expected ${MANIFEST_CANDIDATES.join(" or ")})`,
    });
    return;
  }

  const manifest = readManifest(manifestPath, fs);
  if (!manifest.ok) {
    skipped.push({ dir, reason: `invalid manifest: ${manifest.error}` });
    return;
  }

  const pluginName = extractPluginName(manifest.value, name);
  if (!NAME_PATTERN.test(pluginName)) {
    skipped.push({ dir, reason: `invalid plugin name '${pluginName}'` });
    return;
  }

  const rawBins = extractBinEntries(manifest.value);
  const bins: LoadedBin[] = [];

  for (const raw of rawBins) {
    const validated = validateBin({ raw, pluginDir: dir, fs });
    if (!validated.ok) {
      skipped.push({ dir, reason: `bin '${raw.name ?? "?"}': ${validated.error}` });
      continue;
    }
    if (validated.warning !== undefined) {
      skipped.push({ dir, reason: `bin '${raw.name}': ${validated.warning}` });
    }
    const loaded = toLoadedBin({
      pluginName,
      raw,
      executable: validated.executable,
      qualify,
    });
    bins.push(loaded);
  }

  plugins.push({
    name: pluginName,
    root: dir,
    bins,
    manifestPath,
  });
}

function findManifest(dir: string, fs: PluginLoaderFs): string | null {
  for (const candidate of MANIFEST_CANDIDATES) {
    const p = joinPath(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

interface ReadOk {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}
interface ReadErr {
  readonly ok: false;
  readonly error: string;
}

function readManifest(path: string, fs: PluginLoaderFs): ReadOk | ReadErr {
  let raw: string;
  try {
    raw = fs.readFileSync(path, "utf-8");
  } catch (err) {
    return { ok: false, error: `read failed: ${describeError(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${describeError(err)}` };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "manifest root is not a JSON object" };
  }

  return { ok: true, value: parsed };
}

function extractPluginName(manifest: Record<string, unknown>, fallback: string): string {
  const raw = manifest["name"];
  if (typeof raw === "string" && raw.length > 0) return raw;
  return fallback;
}

function extractBinEntries(manifest: Record<string, unknown>): readonly RawBinEntry[] {
  const raw = manifest["bins"];
  if (!Array.isArray(raw)) return [];

  const out: RawBinEntry[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    out.push(entry as unknown as RawBinEntry);
  }
  return out;
}

interface RawBinEntry {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly description?: unknown;
  readonly argv?: unknown;
  readonly env?: unknown;
  readonly timeout_ms?: unknown;
}

interface ValidatedBin {
  readonly ok: true;
  readonly executable: string;
  readonly warning?: string;
}
interface InvalidBin {
  readonly ok: false;
  readonly error: string;
}

interface ValidateArgs {
  readonly raw: RawBinEntry;
  readonly pluginDir: string;
  readonly fs: PluginLoaderFs;
}

function validateBin(args: ValidateArgs): ValidatedBin | InvalidBin {
  const { raw, pluginDir, fs } = args;

  if (typeof raw.name !== "string" || raw.name.length === 0) {
    return { ok: false, error: "missing name" };
  }
  if (!NAME_PATTERN.test(raw.name)) {
    return {
      ok: false,
      error: `invalid name '${raw.name}' (must match ${NAME_PATTERN.source})`,
    };
  }

  if (typeof raw.path !== "string" || raw.path.length === 0) {
    return { ok: false, error: "missing path" };
  }

  const pathCheck = validateRelativePath(raw.path, pluginDir);
  if (!pathCheck.ok) return pathCheck;

  const executable = pathCheck.absolute;

  if (!fs.existsSync(executable)) {
    return { ok: false, error: `executable not found at ${executable}` };
  }

  // Optional argv/env/timeout are validated in toLoadedBin where
  // normalization happens; here we only verify they are the right
  // shape if present.
  if (raw.argv !== undefined && !isStringArray(raw.argv)) {
    return { ok: false, error: "argv must be string[]" };
  }
  if (raw.env !== undefined && !isStringStringRecord(raw.env)) {
    return { ok: false, error: "env must be Record<string,string>" };
  }
  if (
    raw.timeout_ms !== undefined &&
    (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms <= 0)
  ) {
    return { ok: false, error: "timeout_ms must be a positive finite number" };
  }

  // Best-effort exec-bit check. Warn, don't reject — some filesystems
  // (tmpfs, fake stubs) don't model POSIX mode faithfully.
  let stat: { isDirectory: () => boolean; mode: number };
  try {
    stat = fs.statSync(executable);
  } catch (err) {
    return { ok: false, error: `stat failed: ${describeError(err)}` };
  }
  if (stat.isDirectory()) {
    return { ok: false, error: "path points to a directory, not a file" };
  }

  const hasExecBit = (stat.mode & USER_EXEC_BIT) !== 0;
  if (!hasExecBit) {
    return {
      ok: true,
      executable,
      warning: `executable at ${executable} lacks user-exec bit`,
    };
  }

  return { ok: true, executable };
}

interface PathOk {
  readonly ok: true;
  readonly absolute: string;
}

function validateRelativePath(rawPath: string, pluginDir: string): PathOk | InvalidBin {
  if (rawPath.includes("\0")) {
    return { ok: false, error: "path contains null byte" };
  }
  if (isAbsolute(rawPath)) {
    return { ok: false, error: "path must be relative to plugin dir" };
  }

  // Reject explicit parent traversal anywhere in the path segments.
  const segments = rawPath.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "..") {
      return { ok: false, error: "path traverses outside plugin dir ('..')" };
    }
  }

  const absolute = resolve(pluginDir, rawPath);
  const pluginDirResolved = resolve(pluginDir);

  // Double-check with resolved paths — catches tricks like `./a/../../b`.
  const withSep = pluginDirResolved.endsWith(sep) ? pluginDirResolved : pluginDirResolved + sep;
  if (absolute !== pluginDirResolved && !absolute.startsWith(withSep)) {
    return { ok: false, error: "path traverses outside plugin dir" };
  }

  return { ok: true, absolute };
}

interface ToLoadedArgs {
  readonly pluginName: string;
  readonly raw: RawBinEntry;
  readonly executable: string;
  readonly qualify: boolean;
}

function toLoadedBin(args: ToLoadedArgs): LoadedBin {
  const { pluginName, raw, executable, qualify } = args;

  // Narrowed by validateBin — safe casts here.
  const bareName = raw.name as string;
  const argv = Array.isArray(raw.argv) ? [...(raw.argv as string[])] : [];
  const env = isStringStringRecord(raw.env) ? { ...raw.env } : {};
  const timeoutMs = typeof raw.timeout_ms === "number" ? raw.timeout_ms : DEFAULT_BIN_TIMEOUT_MS;
  const description = typeof raw.description === "string" ? raw.description : undefined;

  const name = qualify ? `${pluginName}.${bareName}` : bareName;

  return {
    pluginName,
    name,
    executable,
    argv,
    env,
    timeoutMs,
    description,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function defaultFs(): PluginLoaderFs {
  return {
    existsSync: (p) => nodeExistsSync(p),
    readFileSync: (p, enc) => nodeReadFileSync(p, enc as BufferEncoding),
    readdirSync: (p) => nodeReaddirSync(p),
    statSync: (p) => {
      const s = nodeStatSync(p);
      return {
        isDirectory: () => s.isDirectory(),
        mode: s.mode,
      };
    },
  };
}

function joinPath(a: string, b: string): string {
  if (a.endsWith("/") || a.endsWith("\\")) return a + b;
  return `${a}/${b}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isStringStringRecord(v: unknown): v is Record<string, string> {
  if (!isPlainObject(v)) return false;
  for (const key of Object.keys(v)) {
    if (typeof v[key] !== "string") return false;
  }
  return true;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
