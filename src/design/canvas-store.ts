/**
 * CanvasStore — JSON persistence for Canvases under `.wotann/canvases/`.
 *
 * Per Cursor 3's canvases side-panel, stored artifacts need to survive session
 * boundaries. We write one `<id>.json` per canvas, stable key order so diffs
 * read well. The store is *per instance* — callers thread it through rather
 * than relying on a module global (QB #7).
 *
 * Concurrency semantics (optimistic)
 * ----------------------------------
 * - `save(canvas)` checks the persisted version matches `canvas.version - 1`
 *   before writing. The orchestrator bumps version on every `apply`, so when
 *   it saves the on-disk version is always one behind the in-memory one.
 *   If the caller passes a stale Canvas (persisted version has already moved
 *   on from another session), we raise `CanvasConflictError` with an
 *   explicit diff. We never silently overwrite.
 * - First-save semantics: if the canvas file doesn't exist yet and the
 *   incoming canvas's version is 1, we accept. Any other initial version
 *   indicates the caller bypassed create(); we reject.
 * - `create(name)` generates a fresh id and calls save() as v1.
 *
 * Honesty bar (#12): the save error path shows *what* changed (the
 * persisted version + the provided version) so callers can merge by hand.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createCanvas,
  parseCanvas,
  serializeCanvas,
  type Canvas,
  type DesignSystemRef,
} from "./canvas.js";

// ── Errors ───────────────────────────────────────────────────────────────

export class CanvasConflictError extends Error {
  readonly code = "CANVAS_CONFLICT";
  readonly canvasId: string;
  readonly persistedVersion: number;
  readonly providedVersion: number;
  constructor(canvasId: string, persistedVersion: number, providedVersion: number) {
    super(
      `canvas ${canvasId} version conflict: persisted=${persistedVersion} provided=${providedVersion}`,
    );
    this.name = "CanvasConflictError";
    this.canvasId = canvasId;
    this.persistedVersion = persistedVersion;
    this.providedVersion = providedVersion;
  }
}

export class CanvasNotFoundError extends Error {
  readonly code = "CANVAS_NOT_FOUND";
  readonly canvasId: string;
  constructor(canvasId: string) {
    super(`canvas ${canvasId} not found`);
    this.name = "CanvasNotFoundError";
    this.canvasId = canvasId;
  }
}

// ── Config ───────────────────────────────────────────────────────────────

export interface CanvasStoreConfig {
  /** Directory to persist canvases. Default: `.wotann/canvases/` under cwd. */
  readonly rootDir?: string;
  /** Id generator. Default: crypto.randomUUID. Test injection hook. */
  readonly generateId?: () => string;
  /** Clock. Default: `Date.now`. Test injection hook. */
  readonly now?: () => number;
}

export interface CanvasStoreEntry {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly updatedAt: number;
  readonly path: string;
}

// ── Store ────────────────────────────────────────────────────────────────

export class CanvasStore {
  private readonly rootDir: string;
  private readonly generateId: () => string;
  private readonly now: () => number;

  constructor(config: CanvasStoreConfig = {}) {
    this.rootDir = config.rootDir ?? join(process.cwd(), ".wotann", "canvases");
    this.generateId = config.generateId ?? (() => randomUUID());
    this.now = config.now ?? (() => Date.now());
  }

  /** Absolute path to the directory. Exposed for inspection + tests. */
  directory(): string {
    return this.rootDir;
  }

  /** Create a fresh canvas with a generated id and persist it as v1. */
  create(name: string, tokens?: DesignSystemRef): Canvas {
    const id = this.generateId();
    const ts = this.now();
    const canvas = createCanvas({
      id,
      name,
      createdAt: ts,
      ...(tokens !== undefined ? { tokens } : {}),
    });
    this.writeFile(canvas);
    return canvas;
  }

  /** Load a canvas by id. Throws CanvasNotFoundError if missing. */
  load(id: string): Canvas {
    const path = this.pathFor(id);
    if (!existsSync(path)) {
      throw new CanvasNotFoundError(id);
    }
    const raw = readFileSync(path, "utf8");
    return parseCanvas(raw);
  }

  /**
   * Save a canvas with optimistic concurrency. Returns the persisted copy.
   *
   * Semantics:
   *  - File missing + canvas.version === 1 → accepted (first save of a newly
   *    created canvas that hasn't yet been written — should not happen in
   *    practice since `create()` writes immediately, but safe).
   *  - File present + persistedVersion === canvas.version - 1 → accepted.
   *  - Anything else → CanvasConflictError.
   */
  save(canvas: Canvas): Canvas {
    const path = this.pathFor(canvas.id);
    if (existsSync(path)) {
      const existing = parseCanvas(readFileSync(path, "utf8"));
      if (existing.version !== canvas.version - 1) {
        throw new CanvasConflictError(canvas.id, existing.version, canvas.version);
      }
    } else if (canvas.version !== 1) {
      // A canvas that claims to be past v1 but has no persisted history is a
      // stale copy or a bug. Loudly refuse rather than overwrite.
      throw new CanvasConflictError(canvas.id, 0, canvas.version);
    }
    this.writeFile(canvas);
    return canvas;
  }

  /** List every canvas currently on disk, sorted by updatedAt descending. */
  list(): readonly CanvasStoreEntry[] {
    if (!existsSync(this.rootDir)) return [];
    let entries: readonly CanvasStoreEntry[];
    try {
      const files = readdirSync(this.rootDir);
      entries = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const path = join(this.rootDir, f);
          try {
            const parsed = parseCanvas(readFileSync(path, "utf8"));
            return {
              id: parsed.id,
              name: parsed.name,
              version: parsed.version,
              updatedAt: parsed.updatedAt,
              path,
            };
          } catch {
            // Malformed canvas files are skipped, not fatal. We'd rather
            // show the caller the healthy ones than fail the whole list.
            return null;
          }
        })
        .filter((e): e is CanvasStoreEntry => e !== null);
    } catch {
      return [];
    }
    return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Delete a canvas. Returns true if it existed, false otherwise. */
  delete(id: string): boolean {
    const path = this.pathFor(id);
    if (!existsSync(path)) return false;
    try {
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Whether a canvas with this id is persisted. */
  exists(id: string): boolean {
    return existsSync(this.pathFor(id));
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private pathFor(id: string): string {
    if (!id || /[/\\]/.test(id)) {
      // Disallow path separators defensively — avoid canvas-id traversal.
      throw new Error(`invalid canvas id: ${id}`);
    }
    return join(this.rootDir, `${id}.json`);
  }

  private writeFile(canvas: Canvas): void {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }
    writeFileSync(this.pathFor(canvas.id), serializeCanvas(canvas), "utf8");
  }
}
