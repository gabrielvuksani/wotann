/**
 * Meeting runtime composer — Phase 14.
 *
 * Wires the meet/ trilogy (meeting-pipeline, meeting-store, coaching-
 * engine) into a single runtime object. Previously these three modules
 * were implemented but never composed — kairos-rpc.ts had a
 * getMeetingStore callback with no implementation.
 *
 * MeetingRuntime:
 *   - wraps MeetingPipeline (the EventEmitter state machine)
 *   - persists every state transition + transcript segment to MeetingStore
 *   - asks CoachingEngine for suggestions on a configurable cadence
 *     and attaches them to the pipeline
 *
 * Caller (typically KairosDaemon.start()) creates one MeetingRuntime
 * per daemon, exposes its methods via RPC, and keeps it alive for the
 * session. Shutdown closes the SQLite connection cleanly.
 */

import {
  MeetingPipeline,
  type MeetingState,
  type TranscriptSegment,
  type CoachingSuggestion,
} from "./meeting-pipeline.js";
import { MeetingStore } from "./meeting-store.js";
import { CoachingEngine } from "./coaching-engine.js";
import type { CoachingTemplate } from "./coaching-engine.js";

// ── Types ──────────────────────────────────────────────

export interface MeetingRuntimeOptions {
  /** Path to the SQLite database. Default ~/.wotann/meetings.db. */
  readonly dbPath?: string;
  /** Coaching cadence in ms (default 10_000, matches the V4 plan). */
  readonly coachingCadenceMs?: number;
  /** Which template to use for coaching ("standup", "1:1", etc). */
  readonly coachingTemplateName?: string;
  /**
   * LLM query used by the coaching engine. If omitted, coaching is
   * disabled (transcripts still capture + persist).
   */
  readonly llmQuery?: (prompt: string) => Promise<string>;
}

export interface AddSegmentInput {
  readonly speaker: "user" | "other" | "unknown";
  readonly text: string;
  readonly startMs?: number;
  readonly endMs?: number;
  readonly confidence?: number;
}

// ── Runtime ────────────────────────────────────────────

export class MeetingRuntime {
  private readonly pipeline: MeetingPipeline;
  private readonly store: MeetingStore;
  private readonly coachingEngine: CoachingEngine | null;
  private readonly coachingCadenceMs: number;
  private coachingTimer: NodeJS.Timeout | null = null;
  private currentMeeting: MeetingState | null = null;

  constructor(options: MeetingRuntimeOptions = {}) {
    const home = process.env["HOME"] ?? process.cwd();
    const dbPath = options.dbPath ?? `${home}/.wotann/meetings.db`;
    this.pipeline = new MeetingPipeline();
    this.store = new MeetingStore(dbPath);
    this.coachingCadenceMs = options.coachingCadenceMs ?? 10_000;
    if (options.llmQuery !== undefined) {
      const engine = new CoachingEngine();
      engine.setTemplate(options.coachingTemplateName ?? "general");
      this.coachingEngine = engine;
      // Store the query callback on the engine as a non-typed field —
      // callers of CoachingEngine invoke it through our runCoachingCycle.
      (engine as unknown as { __query?: typeof options.llmQuery }).__query = options.llmQuery;
    } else {
      this.coachingEngine = null;
    }

    // Persist every new segment automatically
    this.pipeline.on("segment", (segment: TranscriptSegment) => {
      if (this.currentMeeting) {
        this.store.saveSegment(this.currentMeeting.id, segment);
      }
    });

    // Persist suggestions when added
    this.pipeline.on("suggestion", (_suggestion: CoachingSuggestion) => {
      // suggestions are attached to pipeline state only — MeetingStore
      // schema doesn't currently persist suggestions; could extend in a
      // future schema migration. Logged here for telemetry.
    });
  }

  /** Start recording a meeting. */
  startMeeting(platform: MeetingState["platform"] = "unknown"): MeetingState {
    this.currentMeeting = this.pipeline.start(platform);
    this.store.saveMeeting(this.currentMeeting);
    if (this.coachingEngine) this.scheduleCoaching();
    return this.currentMeeting;
  }

  /** Add a transcript segment. */
  addSegment(input: AddSegmentInput): TranscriptSegment {
    if (!this.currentMeeting) {
      throw new Error("MeetingRuntime: no active meeting — call startMeeting first");
    }
    return this.pipeline.addSegment({
      speaker: input.speaker,
      text: input.text,
      startMs: input.startMs ?? 0,
      endMs: input.endMs ?? 0,
      confidence: input.confidence ?? 1,
    });
  }

  /** End the meeting, write final state, stop coaching loop. */
  endMeeting(): MeetingState | null {
    if (!this.currentMeeting) return null;
    this.stopCoaching();
    const final = this.pipeline.end();
    this.store.saveMeeting(final);
    this.currentMeeting = null;
    return final;
  }

  /** Save an action item captured during the meeting. */
  addActionItem(content: string, assignee?: string, dueDate?: string): void {
    if (!this.currentMeeting) {
      throw new Error("MeetingRuntime: no active meeting");
    }
    this.store.saveActionItem(this.currentMeeting.id, content, assignee, dueDate);
  }

  /** Read the current transcript as a single string. */
  getTranscript(): string {
    return this.pipeline.getTranscript();
  }

  /** Read coaching suggestions attached to the pipeline. */
  getSuggestions(): readonly CoachingSuggestion[] {
    return this.pipeline.getSuggestions();
  }

  /** Expose the store for RPC callers (getMeetingStore() callback). */
  getStore(): MeetingStore {
    return this.store;
  }

  /**
   * RPC adapter — returns a meeting with its transcript joined as a single
   * string, or undefined if the meeting is unknown. Shape matches the
   * `getMeetingStore` ext() callback consumed by `kairos-rpc.ts:meet.summarize`.
   * Exposed on the runtime (not the raw store) so the store stays a thin
   * persistence layer.
   */
  getMeeting(id: string): { readonly transcript: string } | undefined {
    const segments = this.store.getTranscript(id);
    if (segments.length === 0) return undefined;
    const transcript = segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
    return { transcript };
  }

  /** Current meeting state, or null if none active. */
  getCurrent(): MeetingState | null {
    return this.currentMeeting;
  }

  /** Graceful shutdown — closes SQLite + clears timer. */
  close(): void {
    this.stopCoaching();
    this.store.close();
  }

  // ── Coaching loop ─────────────────────────────────────

  private scheduleCoaching(): void {
    if (!this.coachingEngine) return;
    this.stopCoaching();
    this.coachingTimer = setInterval(() => {
      this.runCoachingCycle().catch(() => {
        // Swallow coaching errors — don't crash the pipeline
      });
    }, this.coachingCadenceMs);
  }

  private stopCoaching(): void {
    if (this.coachingTimer) {
      clearInterval(this.coachingTimer);
      this.coachingTimer = null;
    }
  }

  private async runCoachingCycle(): Promise<void> {
    if (!this.coachingEngine || !this.currentMeeting) return;
    const recent = this.pipeline.getRollingContext(120_000);
    if (recent.length === 0) return;
    if (!this.coachingEngine.shouldAnalyze()) return;

    const query = (
      this.coachingEngine as unknown as { __query?: (prompt: string) => Promise<string> }
    ).__query;
    if (!query) return;

    const transcript = recent.map((s) => `${s.speaker}: ${s.text}`).join("\n");
    const prompt = `Recent conversation:\n${transcript}\n\nProvide one short, actionable coaching suggestion (1-2 sentences).`;

    try {
      const raw = await query(prompt);
      const content = raw.trim();
      if (!content) return;
      this.pipeline.addSuggestion({
        type: "response",
        content,
        confidence: 0.7,
      });
    } catch {
      // Don't crash the pipeline on LLM errors
    }
  }
}

// ── Factory ───────────────────────────────────────────

/**
 * Convenience: build a MeetingRuntime with sensible defaults. Safe to
 * call multiple times (each returns an independent runtime).
 */
export function createMeetingRuntime(options: MeetingRuntimeOptions = {}): MeetingRuntime {
  return new MeetingRuntime(options);
}

/** Available coaching templates (re-exported for RPC discovery). */
export { COACHING_TEMPLATES } from "./coaching-engine.js";
export type { CoachingTemplate };
