/**
 * CarPlay Dispatch — WOTANN Phase 3 P1-F13 (voice task-dispatch primitive).
 *
 * CarPlay is hands-free-only by regulation (Apple HIG + local traffic laws).
 * Every user action originates as speech: the iOS-side CarPlay scene runs
 * STT, the resulting transcript travels through WCSession/RPCClient to the
 * daemon, and the daemon must turn that transcript into a task.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 4, CarPlay voice
 * already reaches the daemon (`CarPlayService.swift:318-331` → sync.send /
 * quickAction). What's missing is a DISPATCH primitive: the daemon has no
 * endpoint that parses a transcript into an agent task and spawns a
 * ComputerSession from it. F13 adds that primitive.
 *
 * F13 parallels F12 (Watch dispatch) in shape — template registry, rate
 * limit ledger, auto-claim, typed errors — but layers a voice-intent
 * parser on top because CarPlay's input is unstructured speech, not a
 * picker + slot UI.
 *
 *   iOS-side          WOTANN daemon
 *   ────────────      ─────────────────────────────────────────
 *   STT transcript →  carplay.parseVoice  (preview, no dispatch)
 *                     carplay.dispatch    (parse + create session)
 *                     carplay.templates   (list available templates)
 *
 *
 * Design decisions, keyed to session quality bars:
 *
 *   QB #6 (honest failures) — typed errors for every failure mode:
 *     - ErrorRateLimit           — dispatches/hour exceeded for device
 *     - ErrorUnknownTemplate     — forced templateId doesn't exist
 *     - ErrorDeviceNotRegistered — optional device gating
 *     - Low-confidence voice matches do NOT throw; they return
 *       `{ needsConfirmation: true, topCandidates }` so the iOS UI can
 *       prompt "Did you mean X or Y?"
 *
 *   QB #7 (per-session state) — the registry instance owns the template
 *   registry, rate-limit ledger, and store reference. KairosRPCHandler
 *   threads a single instance through; tests construct their own.
 *
 *   QB #10 (sibling-site scan) — `grep -rn "carplay\|car.*play\|voice.*dispatch"
 *   src/daemon src/session src/voice` found only the fleet-view SurfaceType
 *   entry and an RPC comment. No overlapping primitive.
 *
 *   QB #11 (singleton threading) — per QB #11 we construct once on
 *   KairosRPCHandler, not in parallel with session store.
 *
 *   QB #12/13 (deterministic tests) — caller-supplied `now()` clock drives
 *   rate-limit windows so tests can advance virtual time.
 *
 *   QB #14 (claim verification) — RPC wiring in kairos-rpc.ts is covered
 *   by end-to-end tests in tests/session/carplay-dispatch.test.ts, not
 *   merely "exported a function and called it done."
 *
 * Non-goals for F13: iOS/CarPlay scene plumbing, AVSpeechSynthesizer
 * response fanout (Flow 4's TTS leg), channel fanout on voice-originated
 * queries (B4.2 in the design doc). F13 ships the server-side primitive;
 * mobile-side wiring happens in the CarPlay target (out of scope per
 * deny-list).
 */

import type { ComputerSessionStore, Session, TaskSpec } from "./computer-session-store.js";
import {
  parseVoiceIntent,
  type VoiceIntentMatch,
  type VoicePattern,
  type VoiceTemplateBinding,
} from "./voice-intent.js";

// ── Types ──────────────────────────────────────────────────

/**
 * A CarPlay-context template. Mirrors F12's DispatchTemplate but adds:
 *
 *   - `voicePatterns`: voice-intent rules the parser matches against the
 *     transcript. See voice-intent.ts for the kinds.
 *
 *   - `expandTask`: signature includes the RAW transcript so freeform
 *     templates (the "just forward this to an agent" case) can use it
 *     directly, and slot-based templates can fall back when a regex
 *     capture was partial.
 *
 * `defaults.mode` SHOULD be "focused" for car-context templates — the
 * driver can't watch a long autopilot run unfold. The registry doesn't
 * enforce this (authors may have good reasons), it just nudges via the
 * built-in defaults.
 */
export interface CarPlayTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly voicePatterns: readonly VoicePattern[];
  readonly defaults: Omit<TaskSpec, "task">;
  /**
   * Build the agent task string. Receives the raw transcript plus any
   * named-capture slots the parser extracted.
   */
  readonly expandTask: (context: {
    readonly transcript: string;
    readonly slots: Readonly<Record<string, string>>;
  }) => string;
}

export interface RateLimitConfig {
  readonly maxPerWindow: number;
  readonly windowMs: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxPerWindow: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
};

export interface CarPlayDispatchRegistryOptions {
  readonly store: ComputerSessionStore;
  /** Predicate for optional device-registration gating. Accept-all by default. */
  readonly isDeviceRegistered?: (deviceId: string) => boolean;
  readonly rateLimit?: Partial<RateLimitConfig>;
  readonly now?: () => number;
  /** Initial templates. Callers can also use `register` later. */
  readonly templates?: readonly CarPlayTemplate[];
  /** Confidence threshold below which dispatch returns needsConfirmation. */
  readonly confidenceThreshold?: number;
}

// ── Errors (QB #6 — typed failures) ────────────────────────

export class ErrorUnknownTemplate extends Error {
  readonly code = "CARPLAY_UNKNOWN_TEMPLATE";
  readonly templateId: string;
  constructor(templateId: string) {
    super(`Unknown CarPlay template: ${templateId}`);
    this.name = "ErrorUnknownTemplate";
    this.templateId = templateId;
  }
}

export class ErrorRateLimit extends Error {
  readonly code = "CARPLAY_RATE_LIMIT";
  readonly deviceId: string;
  readonly retryAfterMs: number;
  constructor(deviceId: string, retryAfterMs: number) {
    super(
      `CarPlay dispatch rate-limit exceeded for device ${deviceId}; retry in ${retryAfterMs}ms`,
    );
    this.name = "ErrorRateLimit";
    this.deviceId = deviceId;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ErrorDeviceNotRegisteredForDispatch extends Error {
  readonly code = "CARPLAY_DEVICE_NOT_REGISTERED";
  readonly deviceId: string;
  constructor(deviceId: string) {
    super(`CarPlay dispatch device is not registered: ${deviceId}`);
    this.name = "ErrorDeviceNotRegisteredForDispatch";
    this.deviceId = deviceId;
  }
}

export class ErrorInvalidTranscript extends Error {
  readonly code = "CARPLAY_INVALID_TRANSCRIPT";
  constructor(reason: string) {
    super(`Invalid CarPlay transcript: ${reason}`);
    this.name = "ErrorInvalidTranscript";
  }
}

// ── Built-in templates (starter set) ───────────────────────

/**
 * Freeform template id. When the voice parser cannot match any template
 * above the confidence threshold AND the caller permits freeform, we fall
 * through to this template which simply forwards the transcript as the
 * agent task. Handy for "just do what I said" cases.
 *
 * The freeform template is always registered unless explicitly excluded;
 * the DEFAULT_TEMPLATES list includes it as the last entry.
 */
export const FREEFORM_TEMPLATE_ID = "carplay.freeform";

/**
 * Opinionated default templates for car context. Each has short
 * voice patterns, "focused" mode defaults, and modest maxSteps to respect
 * the driving context (short agent runs → short audible feedback).
 *
 * Pattern design: each template uses a regex with named captures so the
 * parser can extract slots in one pass. A keywords rule is added for
 * robustness when speech recognition mangles a word or two.
 */
export const DEFAULT_CARPLAY_TEMPLATES: readonly CarPlayTemplate[] = [
  {
    id: "navigate.address",
    title: "Navigate",
    description: "Start navigation to an address or place.",
    voicePatterns: [
      {
        kind: "regex",
        pattern: /\b(?:navigate|drive|take me|directions?)\s+to\s+(?<destination>.+)$/u,
        priority: 1.0,
      },
      { kind: "keywords", keywords: ["navigate"], priority: 0.5 },
    ],
    defaults: { mode: "focused", maxSteps: 4 },
    expandTask: ({ transcript, slots }) => {
      const dest = slots["destination"];
      return dest ? `Start navigation to ${dest}.` : `Start navigation as requested: ${transcript}`;
    },
  },
  {
    id: "remind.later",
    title: "Remind Me",
    description: "Create a reminder with optional when/what slots.",
    voicePatterns: [
      {
        kind: "regex",
        pattern: /\bremind\s+me\s+to\s+(?<what>.+?)(?:\s+at\s+(?<when>.+))?$/u,
        priority: 1.0,
      },
      { kind: "keywords", keywords: ["remind", "me"], priority: 0.6 },
    ],
    defaults: { mode: "focused", maxSteps: 3 },
    expandTask: ({ transcript, slots }) => {
      const what = slots["what"] ?? transcript;
      const when = slots["when"];
      return when ? `Create a reminder to ${what} at ${when}.` : `Create a reminder to ${what}.`;
    },
  },
  {
    id: "call.contact",
    title: "Call Contact",
    description: "Place a call to a known contact by name.",
    voicePatterns: [
      {
        kind: "regex",
        pattern: /\b(?:call|phone|dial)\s+(?<contact>.+?)(?:\s+now)?$/u,
        priority: 1.0,
      },
      { kind: "keywords", keywords: ["call"], priority: 0.4 },
    ],
    defaults: { mode: "focused", maxSteps: 3 },
    expandTask: ({ transcript, slots }) => {
      const contact = slots["contact"];
      return contact ? `Call contact: ${contact}.` : `Call as requested: ${transcript}`;
    },
  },
  {
    id: "summarize.last-email",
    title: "Summarize Email",
    description: "Read a summary of the most recent email(s).",
    voicePatterns: [
      {
        kind: "regex",
        pattern:
          /\b(?:summarize|summary of|what's in|read me)\s+(?:my\s+)?(?:last|latest|recent)\s+(?:email|emails|messages?|inbox)/u,
        priority: 1.0,
      },
      { kind: "keywords", keywords: ["summarize", "email"], priority: 0.6 },
    ],
    defaults: { mode: "focused", maxSteps: 6 },
    expandTask: () => "Summarize the most recent email(s) in 3 bullet points suitable for audio.",
  },
  {
    id: FREEFORM_TEMPLATE_ID,
    title: "Freeform",
    description: "Dispatch the spoken request as-is to a general agent.",
    // Keywords match any transcript but at a very low confidence so the
    // freeform template wins only as a fallback when nothing else matches
    // above threshold.
    voicePatterns: [{ kind: "keywords", keywords: [], priority: 0 }],
    defaults: { mode: "focused", maxSteps: 8 },
    expandTask: ({ transcript }) => transcript,
  },
];

// ── Result envelopes ───────────────────────────────────────

/**
 * Output of `parseVoice` without dispatch. Callers use this for a preview
 * flow: the iOS UI can say "I heard '...'; is this right?" before
 * actually committing to spawn a session.
 */
export interface CarPlayParseResult {
  readonly transcript: string;
  readonly normalizedTranscript: string;
  readonly match: VoiceIntentMatch["matched"];
  readonly topCandidates: VoiceIntentMatch["topCandidates"];
  readonly needsConfirmation: boolean;
}

/**
 * Output of `dispatch`. On a clean match (or allowed freeform fallback),
 * `session` is set. On a low-confidence match (and no freeform), `session`
 * is null and the caller must re-dispatch with a forced templateId after
 * the user disambiguates.
 */
export interface CarPlayDispatchResult {
  readonly session: Session | null;
  readonly match: VoiceIntentMatch["matched"];
  readonly topCandidates: VoiceIntentMatch["topCandidates"];
  readonly needsConfirmation: boolean;
  readonly usedFreeform: boolean;
}

export interface CarPlayDispatchParams {
  readonly transcript: string;
  readonly deviceId: string;
  /**
   * If set, force this template id — skips voice parsing and uses
   * provided `slots` (or an empty map). Used when the iOS UI has
   * confirmed an ambiguous parse via "Did you mean X?" buttons.
   */
  readonly forceTemplateId?: string;
  /**
   * Slot overrides. Primarily used alongside `forceTemplateId`; also
   * merged on top of parser-extracted slots when neither force is set.
   */
  readonly slots?: Readonly<Record<string, string>>;
  /**
   * If true (default), low-confidence parses fall through to the
   * freeform template. Set false to require a high-confidence match or
   * a confirmation round-trip.
   */
  readonly allowFreeform?: boolean;
}

export interface CarPlayParseParams {
  readonly transcript: string;
}

// ── Registry ───────────────────────────────────────────────

/**
 * Central CarPlay dispatch primitive. Owns the template registry, rate-
 * limit ledger, and reference to the F1 ComputerSessionStore. Threaded
 * once on KairosRPCHandler per QB #11.
 */
export class CarPlayDispatchRegistry {
  private readonly store: ComputerSessionStore;
  private readonly templates = new Map<string, CarPlayTemplate>();
  private readonly isDeviceRegistered: (deviceId: string) => boolean;
  private readonly rateLimit: RateLimitConfig;
  private readonly now: () => number;
  private readonly confidenceThreshold: number;
  // Rolling-window ledger keyed by deviceId.
  private readonly ledger = new Map<string, number[]>();

  constructor(opts: CarPlayDispatchRegistryOptions) {
    if (!opts?.store) {
      throw new Error("CarPlayDispatchRegistry requires a ComputerSessionStore");
    }
    this.store = opts.store;
    this.isDeviceRegistered = opts.isDeviceRegistered ?? (() => true);
    this.rateLimit = { ...DEFAULT_RATE_LIMIT, ...(opts.rateLimit ?? {}) };
    this.now = opts.now ?? Date.now;
    this.confidenceThreshold = opts.confidenceThreshold ?? 0.6;
    const seed = opts.templates ?? DEFAULT_CARPLAY_TEMPLATES;
    for (const t of seed) {
      this.register(t);
    }
  }

  // ── Template admin ─────────────────────────────────────

  register(template: CarPlayTemplate): void {
    if (!template?.id || template.id.trim() === "") {
      throw new Error("template.id required");
    }
    if (typeof template.expandTask !== "function") {
      throw new Error(`template ${template.id}: expandTask must be a function`);
    }
    this.templates.set(template.id, template);
  }

  unregister(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  list(policyFilter?: (template: CarPlayTemplate) => boolean): readonly CarPlayTemplate[] {
    const values = [...this.templates.values()];
    const filtered = policyFilter ? values.filter(policyFilter) : values;
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(templateId: string): CarPlayTemplate | null {
    return this.templates.get(templateId) ?? null;
  }

  has(templateId: string): boolean {
    return this.templates.has(templateId);
  }

  size(): number {
    return this.templates.size;
  }

  // ── Voice parsing ──────────────────────────────────────

  /**
   * Parse a transcript into a best-match template + slots WITHOUT
   * dispatching. Pure and side-effect free — use this for preview flows
   * where the iOS UI wants to show "here's what I'll do" before the user
   * confirms. Excludes the freeform template from matching so callers
   * see honest confidence scores; when the caller later calls dispatch()
   * they control the freeform fallback behavior via `allowFreeform`.
   */
  parseVoice(params: CarPlayParseParams): CarPlayParseResult {
    const transcript = params?.transcript ?? "";
    const bindings = this.buildBindings({ includeFreeform: false });
    const result = parseVoiceIntent(transcript, bindings, {
      confidenceThreshold: this.confidenceThreshold,
    });
    return {
      transcript,
      normalizedTranscript: result.normalizedTranscript,
      match: result.matched,
      topCandidates: result.topCandidates,
      needsConfirmation: result.matched === null,
    };
  }

  // ── Dispatch (parse + create + claim) ──────────────────

  /**
   * Parse + dispatch in one call. Order of checks:
   *
   *   1. Device registration (optional predicate)
   *   2. Transcript sanity (non-empty, length cap)
   *   3. Force-path: if `forceTemplateId` provided, look it up directly
   *      (bypasses parser) and use supplied slots.
   *   4. Parse-path: run the voice-intent parser. If confidence >= threshold
   *      use that template. Otherwise, if allowFreeform (default), fall
   *      through to the freeform template and surface the transcript as
   *      the task. If !allowFreeform, return session=null with needsConfirmation.
   *   5. Rate-limit window (records attempt AFTER success).
   *   6. Delegate to F1 store.create + store.claim.
   *
   * The rate-limit ledger records only SUCCESSFUL dispatches, matching
   * F12's ergonomics for constrained surfaces — a driver fighting with
   * speech recognition won't burn their quota.
   */
  dispatch(params: CarPlayDispatchParams): CarPlayDispatchResult {
    if (!params?.deviceId || params.deviceId.trim() === "") {
      throw new ErrorInvalidTranscript("deviceId required");
    }
    if (!this.isDeviceRegistered(params.deviceId)) {
      throw new ErrorDeviceNotRegisteredForDispatch(params.deviceId);
    }

    const allowFreeform = params.allowFreeform !== false;
    const transcript = (params.transcript ?? "").trim();

    // Force path bypasses parsing entirely.
    let template: CarPlayTemplate | null = null;
    let match: VoiceIntentMatch["matched"] = null;
    let topCandidates: VoiceIntentMatch["topCandidates"] = [];
    let extractedSlots: Record<string, string> = {};
    let usedFreeform = false;

    if (params.forceTemplateId) {
      const forced = this.templates.get(params.forceTemplateId);
      if (!forced) {
        throw new ErrorUnknownTemplate(params.forceTemplateId);
      }
      template = forced;
      match = {
        templateId: forced.id,
        confidence: 1.0,
        slots: { ...(params.slots ?? {}) },
      };
      extractedSlots = { ...(params.slots ?? {}) };
    } else {
      if (!transcript) {
        throw new ErrorInvalidTranscript("transcript required (or provide forceTemplateId)");
      }
      const bindings = this.buildBindings({ includeFreeform: false });
      const parse = parseVoiceIntent(transcript, bindings, {
        confidenceThreshold: this.confidenceThreshold,
      });
      match = parse.matched;
      topCandidates = parse.topCandidates;
      if (parse.matched) {
        template = this.templates.get(parse.matched.templateId) ?? null;
        extractedSlots = { ...parse.matched.slots, ...(params.slots ?? {}) };
      } else if (allowFreeform && this.templates.has(FREEFORM_TEMPLATE_ID)) {
        template = this.templates.get(FREEFORM_TEMPLATE_ID) ?? null;
        usedFreeform = true;
        extractedSlots = { ...(params.slots ?? {}) };
        match = {
          templateId: FREEFORM_TEMPLATE_ID,
          confidence: this.confidenceThreshold, // just-enough to dispatch
          slots: extractedSlots,
        };
      } else {
        // Low confidence + no freeform fallback → ask caller to confirm.
        return {
          session: null,
          match: null,
          topCandidates,
          needsConfirmation: true,
          usedFreeform: false,
        };
      }
    }

    if (!template) {
      // Defense in depth — should be unreachable.
      throw new ErrorUnknownTemplate(params.forceTemplateId ?? "(auto)");
    }

    // Rate-limit probe (dry-run) BEFORE creating the session so a
    // throttled caller doesn't leak a session row.
    const { allowed, retryAfterMs } = this.consumeRateLimit(params.deviceId, {
      dryRun: true,
    });
    if (!allowed) {
      throw new ErrorRateLimit(params.deviceId, retryAfterMs);
    }

    const expanded = template.expandTask({
      transcript,
      slots: extractedSlots,
    });

    const taskSpec: TaskSpec = {
      task: expanded,
      mode: template.defaults.mode,
      maxSteps: template.defaults.maxSteps,
      creationPath: template.defaults.creationPath,
      modelId: template.defaults.modelId,
    };

    const session = this.store.create({
      creatorDeviceId: params.deviceId,
      taskSpec,
    });
    const claimed = this.store.claim(session.id, params.deviceId);

    // Record successful dispatch.
    this.consumeRateLimit(params.deviceId, { dryRun: false });

    return {
      session: claimed,
      match,
      topCandidates,
      needsConfirmation: false,
      usedFreeform,
    };
  }

  // ── Rate-limit helpers ─────────────────────────────────

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
        this.ledger.set(deviceId, pruned);
      }
      return { allowed: false, retryAfterMs };
    }

    if (!opts.dryRun) {
      this.ledger.set(deviceId, [...pruned, now]);
    } else {
      this.ledger.set(deviceId, pruned);
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  // ── Helpers ────────────────────────────────────────────

  /**
   * Convert the registered template map into a list of voice-intent
   * bindings. The freeform template, if present, is optionally excluded
   * so it doesn't contaminate the confidence ranking — the freeform
   * fallback is applied explicitly by `dispatch` when the parser
   * otherwise returns matched=null.
   */
  private buildBindings(opts: {
    readonly includeFreeform: boolean;
  }): readonly VoiceTemplateBinding[] {
    const out: VoiceTemplateBinding[] = [];
    for (const [id, template] of this.templates.entries()) {
      if (!opts.includeFreeform && id === FREEFORM_TEMPLATE_ID) continue;
      out.push({
        templateId: id,
        patterns: template.voicePatterns,
      });
    }
    return out;
  }

  // ── Test/diagnostic hooks ──────────────────────────────

  /** Count of recent dispatches inside the current window for `deviceId`. */
  recentDispatchCount(deviceId: string): number {
    const now = this.now();
    const windowStart = now - this.rateLimit.windowMs;
    const existing = this.ledger.get(deviceId) ?? [];
    return existing.filter((t) => t > windowStart).length;
  }

  resetRateLimits(): void {
    this.ledger.clear();
  }
}
