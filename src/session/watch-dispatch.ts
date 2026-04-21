/**
 * Watch Dispatch — WOTANN Phase 3 P1-F12 (Apple Watch new-task dispatch).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 3, the Watch
 * already has APPROVE primitives (F1 approval flow) but cannot DISPATCH a
 * new task. F12 adds the server-side plumbing so the Watch (via phone
 * pass-through) can spawn a fresh ComputerSession from a template.
 *
 * The Watch is a constrained surface — tiny screen, short voice input,
 * tight battery. Dispatch is therefore TEMPLATE-DRIVEN rather than
 * free-form:
 *
 *   template := { id, title, description, slotSchema, defaults }
 *
 * The Watch UI lists available templates, the user fills the (typically 0-2)
 * slots, and the daemon expands them into a `TaskSpec` that's handed to
 * `ComputerSessionStore.create`. Auto-claim binds the creating watch device
 * to the session so the runner sees immediate ownership (no extra round
 * trip from the tiny surface).
 *
 * Design decisions, keyed to session quality bars:
 *
 *   QB #6 (honest failures) — every failure path throws a TYPED error:
 *     - ErrorUnknownTemplate     — template id not registered
 *     - ErrorInvalidArgs         — slot schema mismatch (missing/extra/
 *                                  wrong type)
 *     - ErrorRateLimit           — dispatches/hour exceeded for this device
 *     - ErrorDeviceNotRegistered — (optional) dispatch from unknown device
 *
 *   QB #7 (per-session state) — dispatch state (rate-limit buckets,
 *   template registry) lives on the WatchDispatchRegistry instance.
 *   KairosRPCHandler threads a single instance through, never module-
 *   globals.
 *
 *   QB #10 (sibling-site scan) — `grep -rn "watch.*dispatch|watch.*task"
 *   src/daemon src/session` found nothing before this file. `grep -rn
 *   "watchos"` found the iOS Swift layer only; no overlapping primitive.
 *
 *   QB #11 (singleton threading) — instantiated once on KairosRPCHandler,
 *   the session store is passed in (not built in parallel).
 *
 *   QB #12/13 (no env-dependent tests) — a caller-supplied `now()` clock
 *   drives rate-limit windows; tests inject a deterministic clock.
 *
 *   QB #14 (claim verification) — this file defines the registry + validator
 *   only. RPC surfaces live in `kairos-rpc.ts` and are separately verified
 *   by runtime tests exercising the `watch.dispatch`/`watch.templates`
 *   handlers end-to-end.
 *
 * This module is a thin policy layer on top of F1 ComputerSessionStore.
 * iOS/watchOS plumbing (WCSession relay, QuickActionsView wiring) is
 * out-of-scope for F12; this file gives the mobile team an honest RPC
 * surface to wire against.
 */

import type { ComputerSessionStore, Session, TaskSpec } from "./computer-session-store.js";

// ── Types ──────────────────────────────────────────────────

/** A single input slot the Watch UI must populate before dispatch. */
export interface TemplateSlot {
  readonly name: string;
  readonly type: "string" | "number" | "boolean";
  readonly required: boolean;
  /** Optional human-readable hint for the Watch UI. */
  readonly prompt?: string;
  /**
   * Optional max length for string slots. Prevents abuse of the
   * constrained surface (a "short" voice input should not weaponize the
   * session store with a 1MB task).
   */
  readonly maxLength?: number;
}

/**
 * A pre-registered task shape the Watch can dispatch. `defaults` supplies
 * TaskSpec fields (mode, maxSteps, modelId) so the Watch user doesn't
 * pick them; `expandTask` takes the user-supplied slot values and builds
 * the TaskSpec.task string. Template authors typically use template
 * literals in `expandTask`.
 *
 * Immutable — registries are read-only after registration (QB: immutability).
 */
export interface DispatchTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly slots: readonly TemplateSlot[];
  readonly defaults: Omit<TaskSpec, "task">;
  readonly expandTask: (slots: Readonly<Record<string, unknown>>) => string;
}

export interface DispatchParams {
  readonly templateId: string;
  readonly slots: Readonly<Record<string, unknown>>;
  readonly deviceId: string;
}

export interface RateLimitConfig {
  /** Number of dispatches allowed per device inside the rolling window. */
  readonly maxPerWindow: number;
  /** Rolling window size in milliseconds. */
  readonly windowMs: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxPerWindow: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
};

export interface WatchDispatchRegistryOptions {
  readonly store: ComputerSessionStore;
  /** Predicate for optional device-registration gating. Defaults to accept-all. */
  readonly isDeviceRegistered?: (deviceId: string) => boolean;
  readonly rateLimit?: Partial<RateLimitConfig>;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
  /** Initial templates. Callers can also use `register` later. */
  readonly templates?: readonly DispatchTemplate[];
}

// ── Errors (QB #6 — typed failures) ────────────────────────

export class ErrorUnknownTemplate extends Error {
  readonly code = "WATCH_UNKNOWN_TEMPLATE";
  readonly templateId: string;
  constructor(templateId: string) {
    super(`Unknown dispatch template: ${templateId}`);
    this.name = "ErrorUnknownTemplate";
    this.templateId = templateId;
  }
}

export class ErrorInvalidArgs extends Error {
  readonly code = "WATCH_INVALID_ARGS";
  readonly templateId: string;
  readonly reason: string;
  constructor(templateId: string, reason: string) {
    super(`Invalid dispatch args for template ${templateId}: ${reason}`);
    this.name = "ErrorInvalidArgs";
    this.templateId = templateId;
    this.reason = reason;
  }
}

export class ErrorRateLimit extends Error {
  readonly code = "WATCH_RATE_LIMIT";
  readonly deviceId: string;
  readonly retryAfterMs: number;
  constructor(deviceId: string, retryAfterMs: number) {
    super(`Watch dispatch rate-limit exceeded for device ${deviceId}; retry in ${retryAfterMs}ms`);
    this.name = "ErrorRateLimit";
    this.deviceId = deviceId;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ErrorDeviceNotRegisteredForDispatch extends Error {
  readonly code = "WATCH_DEVICE_NOT_REGISTERED";
  readonly deviceId: string;
  constructor(deviceId: string) {
    super(`Watch dispatch device is not registered: ${deviceId}`);
    this.name = "ErrorDeviceNotRegisteredForDispatch";
    this.deviceId = deviceId;
  }
}

// ── Built-in templates (starter set) ───────────────────────

/**
 * Opinionated default templates appropriate to a watch surface: each has
 * ≤ 1 required slot, each produces a short, focused TaskSpec.task.
 * Consumers that don't want these can instantiate the registry with an
 * explicit empty `templates: []` list and call `register` with their own
 * set.
 */
export const DEFAULT_TEMPLATES: readonly DispatchTemplate[] = [
  {
    id: "summarize.url",
    title: "Summarize URL",
    description: "Fetch a URL and produce a three-bullet summary.",
    slots: [
      {
        name: "url",
        type: "string",
        required: true,
        prompt: "Paste or dictate URL",
        maxLength: 2048,
      },
    ],
    defaults: { mode: "focused", maxSteps: 10 },
    expandTask: (s) => `Summarize the page at ${String(s["url"])} in three bullets.`,
  },
  {
    id: "note.capture",
    title: "Capture Note",
    description: "File a short note into the daily notes surface.",
    slots: [
      {
        name: "text",
        type: "string",
        required: true,
        prompt: "Dictate note",
        maxLength: 1024,
      },
    ],
    defaults: { mode: "focused", maxSteps: 4 },
    expandTask: (s) => `Capture the following note: ${String(s["text"])}`,
  },
  {
    id: "contact.message",
    title: "Message Contact",
    description: "Compose and queue a message to a known contact.",
    slots: [
      {
        name: "contact",
        type: "string",
        required: true,
        prompt: "Contact name",
        maxLength: 128,
      },
      {
        name: "body",
        type: "string",
        required: true,
        prompt: "Message body",
        maxLength: 512,
      },
    ],
    defaults: { mode: "focused", maxSteps: 6 },
    expandTask: (s) => `Draft and queue a message to ${String(s["contact"])}: ${String(s["body"])}`,
  },
  {
    id: "build.project",
    title: "Build Project",
    description: "Run the project's declared build command and report back.",
    slots: [],
    defaults: { mode: "autopilot", maxSteps: 30 },
    expandTask: () => "Run the project's declared build command and report results.",
  },
];

// ── Registry ───────────────────────────────────────────────

/**
 * Central Watch dispatch primitive. Threaded once on the RPC handler; owns
 * the template registry, rate-limit ledger, and F1 store reference. The
 * registry is append-only per-instance; tests that want a clean slate
 * construct a new instance.
 */
export class WatchDispatchRegistry {
  private readonly store: ComputerSessionStore;
  private readonly templates = new Map<string, DispatchTemplate>();
  private readonly isDeviceRegistered: (deviceId: string) => boolean;
  private readonly rateLimit: RateLimitConfig;
  private readonly now: () => number;
  // Rolling-window ledger. One FIFO timestamps array per device. A more
  // sophisticated algorithm (token bucket, sliding log) would be overkill
  // at the expected call rate — a watch user can only physically tap so
  // fast, and the max window is ~20 dispatches.
  private readonly ledger = new Map<string, number[]>();

  constructor(opts: WatchDispatchRegistryOptions) {
    if (!opts?.store) {
      throw new Error("WatchDispatchRegistry requires a ComputerSessionStore");
    }
    this.store = opts.store;
    this.isDeviceRegistered = opts.isDeviceRegistered ?? (() => true);
    this.rateLimit = { ...DEFAULT_RATE_LIMIT, ...(opts.rateLimit ?? {}) };
    this.now = opts.now ?? Date.now;
    const seed = opts.templates ?? DEFAULT_TEMPLATES;
    for (const t of seed) {
      this.register(t);
    }
  }

  // ── Template admin ─────────────────────────────────────

  /** Register (or replace) a template. Idempotent on id. */
  register(template: DispatchTemplate): void {
    if (!template?.id || template.id.trim() === "") {
      throw new Error("template.id required");
    }
    if (typeof template.expandTask !== "function") {
      throw new Error(`template ${template.id}: expandTask must be a function`);
    }
    // Validate slot names are unique — otherwise the last-wins rule in the
    // validator is too subtle for template authors.
    const seen = new Set<string>();
    for (const slot of template.slots) {
      if (seen.has(slot.name)) {
        throw new Error(`template ${template.id}: duplicate slot name "${slot.name}"`);
      }
      seen.add(slot.name);
    }
    this.templates.set(template.id, template);
  }

  /** Unregister a template by id. */
  unregister(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  /**
   * List templates. Returns a fresh array sorted by id so callers get a
   * stable, deterministic order for rendering on tiny Watch surfaces.
   *
   * A `policyFilter` predicate can be provided so the RPC layer can
   * filter by user/workspace policy (e.g. disable "build.project" when
   * the user doesn't have a configured build command). Filtering at read
   * time (instead of at registration time) keeps the registry a simple
   * source of truth and the policy a decoupled read-side concern.
   */
  list(policyFilter?: (template: DispatchTemplate) => boolean): readonly DispatchTemplate[] {
    const values = [...this.templates.values()];
    const filtered = policyFilter ? values.filter(policyFilter) : values;
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Fetch a template by id (null if unknown). */
  get(templateId: string): DispatchTemplate | null {
    return this.templates.get(templateId) ?? null;
  }

  /** Whether a template id is currently registered. */
  has(templateId: string): boolean {
    return this.templates.has(templateId);
  }

  /** Registered template count. */
  size(): number {
    return this.templates.size;
  }

  // ── Dispatch (the main primitive) ──────────────────────

  /**
   * Dispatch a new ComputerSession from the watch.
   *
   * Order of checks:
   *   1. Device registration (optional predicate)
   *   2. Template existence
   *   3. Slot schema validation (missing required, extra, wrong type)
   *   4. Rate-limit window (records attempt AFTER success)
   *   5. Delegate to F1 store.create + store.claim (auto-claim)
   *
   * The rate-limit window records only SUCCESSFUL dispatches — a caller
   * who hammers with invalid slots cannot burn their quota; this is
   * pro-recovery ergonomics for the constrained surface.
   */
  dispatch(params: DispatchParams): Session {
    if (!params?.deviceId || params.deviceId.trim() === "") {
      throw new ErrorInvalidArgs(params?.templateId ?? "", "deviceId required");
    }
    if (!params.templateId || params.templateId.trim() === "") {
      throw new ErrorUnknownTemplate(params.templateId ?? "");
    }

    if (!this.isDeviceRegistered(params.deviceId)) {
      throw new ErrorDeviceNotRegisteredForDispatch(params.deviceId);
    }

    const template = this.templates.get(params.templateId);
    if (!template) {
      throw new ErrorUnknownTemplate(params.templateId);
    }

    // Slot validation raises ErrorInvalidArgs with a precise reason.
    this.validateSlots(template, params.slots ?? {});

    // Rate limit check — probe BEFORE creating the session so a throttled
    // caller doesn't leak session rows.
    const { allowed, retryAfterMs } = this.consumeRateLimit(params.deviceId, {
      dryRun: true,
    });
    if (!allowed) {
      throw new ErrorRateLimit(params.deviceId, retryAfterMs);
    }

    const task = template.expandTask(params.slots ?? {});
    const taskSpec: TaskSpec = {
      task,
      mode: template.defaults.mode,
      maxSteps: template.defaults.maxSteps,
      creationPath: template.defaults.creationPath,
      modelId: template.defaults.modelId,
    };

    // Create, then atomically claim to the creating watch device. The
    // store's claim is idempotent for same-device, so a retry after a
    // transient claim failure does not duplicate.
    const session = this.store.create({
      creatorDeviceId: params.deviceId,
      taskSpec,
    });
    const claimed = this.store.claim(session.id, params.deviceId);

    // Only record on success. Strictly, we should use the CAS semantics of
    // the store's create to avoid a row leak on a scheduler thrash — but
    // create is a synchronous map.set and cannot fail post-argument
    // validation, so this is safe.
    this.consumeRateLimit(params.deviceId, { dryRun: false });

    return claimed;
  }

  // ── Rate-limit helpers ─────────────────────────────────

  /**
   * Probe / record against the rolling window. Evicts timestamps outside
   * `windowMs` of `now` before evaluating, so the ledger stays bounded.
   * With `dryRun: true` the call is read-only; with `dryRun: false` it
   * appends the current timestamp on a successful probe.
   *
   * Returns `{ allowed, retryAfterMs }`. When `!allowed`, `retryAfterMs`
   * is the number of ms until the earliest in-window timestamp rolls off.
   */
  private consumeRateLimit(
    deviceId: string,
    opts: { readonly dryRun: boolean },
  ): { readonly allowed: boolean; readonly retryAfterMs: number } {
    const now = this.now();
    const windowStart = now - this.rateLimit.windowMs;
    const existing = this.ledger.get(deviceId) ?? [];
    const pruned = existing.filter((t) => t > windowStart);

    if (pruned.length >= this.rateLimit.maxPerWindow) {
      const earliest = pruned[0] ?? now;
      const retryAfterMs = Math.max(0, earliest + this.rateLimit.windowMs - now);
      if (!opts.dryRun) {
        // Still write back the pruned ledger so we don't keep old entries
        // around forever when rate-limited callers back off.
        this.ledger.set(deviceId, pruned);
      }
      return { allowed: false, retryAfterMs };
    }

    if (!opts.dryRun) {
      this.ledger.set(deviceId, [...pruned, now]);
    } else {
      // Pruning is cheap and improves future probes for the same device.
      this.ledger.set(deviceId, pruned);
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  // ── Slot validation ────────────────────────────────────

  private validateSlots(
    template: DispatchTemplate,
    slots: Readonly<Record<string, unknown>>,
  ): void {
    const known = new Set(template.slots.map((s) => s.name));

    // Reject extra slots — prevents accidental passthrough of untrusted
    // keys into the TaskSpec via expandTask.
    for (const key of Object.keys(slots)) {
      if (!known.has(key)) {
        throw new ErrorInvalidArgs(template.id, `unexpected slot "${key}"`);
      }
    }

    // Enforce presence + type for each declared slot.
    for (const decl of template.slots) {
      const has = Object.prototype.hasOwnProperty.call(slots, decl.name);
      const value = (slots as Record<string, unknown>)[decl.name];

      if (!has || value === undefined || value === null) {
        if (decl.required) {
          throw new ErrorInvalidArgs(template.id, `missing required slot "${decl.name}"`);
        }
        continue;
      }

      const actual = typeof value;
      if (actual !== decl.type) {
        throw new ErrorInvalidArgs(
          template.id,
          `slot "${decl.name}" expected ${decl.type}, got ${actual}`,
        );
      }

      if (decl.type === "string" && typeof decl.maxLength === "number") {
        const len = (value as string).length;
        if (len > decl.maxLength) {
          throw new ErrorInvalidArgs(
            template.id,
            `slot "${decl.name}" exceeds max length ${decl.maxLength}`,
          );
        }
      }
    }
  }

  // ── Test/diagnostic hooks (kept minimal) ───────────────

  /**
   * Count of recent dispatches inside the current window for `deviceId`.
   * Exposed for tests + diagnostics; do NOT treat as a public contract.
   */
  recentDispatchCount(deviceId: string): number {
    const now = this.now();
    const windowStart = now - this.rateLimit.windowMs;
    const existing = this.ledger.get(deviceId) ?? [];
    return existing.filter((t) => t > windowStart).length;
  }

  /** Clear the rate-limit ledger. Test helper. */
  resetRateLimits(): void {
    this.ledger.clear();
  }
}
