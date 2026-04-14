/**
 * Meeting Pipeline -- Orchestrates audio capture, transcription, coaching, and storage.
 *
 * Architecture:
 * Audio Source -> Transcription Engine -> Transcript Buffer -> AI Coach -> Overlay
 *                                      -> Meeting Store (SQLite)
 *
 * Audio capture is provided by the Rust backend (Core Audio Taps / ScreenCaptureKit).
 * This module handles everything after audio -> text conversion.
 */

import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";

export interface TranscriptSegment {
  readonly id: string;
  readonly speaker: "user" | "other" | "unknown";
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
  readonly timestamp: string; // ISO 8601
}

export interface MeetingState {
  readonly id: string;
  readonly status: "idle" | "listening" | "transcribing" | "coaching" | "ended";
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly platform: "zoom" | "teams" | "meet" | "slack" | "discord" | "facetime" | "unknown";
  readonly participants: readonly string[];
  readonly segmentCount: number;
  readonly durationMs: number;
}

export interface CoachingSuggestion {
  readonly type: "response" | "action-item" | "context" | "sentiment" | "summary";
  readonly content: string;
  readonly confidence: number;
  readonly timestamp: string;
}

export class MeetingPipeline extends EventEmitter {
  private state: MeetingState;
  private readonly transcriptBuffer: TranscriptSegment[] = [];
  private readonly coachingSuggestions: CoachingSuggestion[] = [];
  private transcriptionInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.state = {
      id: "",
      status: "idle",
      startedAt: null,
      endedAt: null,
      platform: "unknown",
      participants: [],
      segmentCount: 0,
      durationMs: 0,
    };
  }

  /**
   * Start a new meeting session.
   */
  start(platform: MeetingState["platform"] = "unknown"): MeetingState {
    const id = `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.state = {
      id,
      status: "listening",
      startedAt: new Date().toISOString(),
      endedAt: null,
      platform,
      participants: [],
      segmentCount: 0,
      durationMs: 0,
    };
    this.transcriptBuffer.length = 0;
    this.coachingSuggestions.length = 0;

    this.emit("meeting:started", this.state);
    return this.state;
  }

  /**
   * Add a transcript segment (called by the transcription engine).
   */
  addSegment(segment: Omit<TranscriptSegment, "id" | "timestamp">): TranscriptSegment {
    const full: TranscriptSegment = {
      ...segment,
      id: `seg-${this.transcriptBuffer.length}`,
      timestamp: new Date().toISOString(),
    };
    this.transcriptBuffer.push(full);
    this.state = {
      ...this.state,
      segmentCount: this.transcriptBuffer.length,
      status: "transcribing",
    };

    this.emit("transcript:segment", full);
    return full;
  }

  /**
   * Add a coaching suggestion (called by the AI coaching engine).
   */
  addSuggestion(suggestion: Omit<CoachingSuggestion, "timestamp">): CoachingSuggestion {
    const full: CoachingSuggestion = {
      ...suggestion,
      timestamp: new Date().toISOString(),
    };
    this.coachingSuggestions.push(full);
    this.emit("coaching:suggestion", full);
    return full;
  }

  /**
   * End the meeting session.
   */
  end(): MeetingState {
    if (this.transcriptionInterval) {
      clearInterval(this.transcriptionInterval);
      this.transcriptionInterval = null;
    }

    const startTime = this.state.startedAt ? new Date(this.state.startedAt).getTime() : Date.now();
    this.state = {
      ...this.state,
      status: "ended",
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    this.emit("meeting:ended", this.state);
    return this.state;
  }

  /**
   * Get the full transcript as text.
   */
  getTranscript(): string {
    return this.transcriptBuffer
      .map(s => `[${s.speaker}] ${s.text}`)
      .join("\n");
  }

  /**
   * Get the rolling context window (last N minutes) for AI coaching.
   */
  getRollingContext(windowMs: number = 120_000): readonly TranscriptSegment[] {
    const cutoff = Date.now() - windowMs;
    return this.transcriptBuffer.filter(s => new Date(s.timestamp).getTime() > cutoff);
  }

  /**
   * Get all coaching suggestions.
   */
  getSuggestions(): readonly CoachingSuggestion[] {
    return [...this.coachingSuggestions];
  }

  /**
   * Get meeting state.
   */
  getState(): MeetingState {
    return this.state;
  }

  /**
   * Get all segments.
   */
  getSegments(): readonly TranscriptSegment[] {
    return [...this.transcriptBuffer];
  }

  /**
   * Detect which meeting platform is running (heuristic based on running processes).
   * Uses execFileSync (not execSync) to prevent shell injection.
   */
  static detectPlatform(): MeetingState["platform"] {
    try {
      const ps = execFileSync("ps", ["-eo", "comm"], { timeout: 3000, encoding: "utf-8" });
      if (ps.includes("zoom.us")) return "zoom";
      if (ps.includes("Microsoft Teams")) return "teams";
      if (ps.includes("Google Chrome") && ps.includes("meet.google.com")) return "meet";
      if (ps.includes("Slack")) return "slack";
      if (ps.includes("Discord")) return "discord";
      if (ps.includes("FaceTime")) return "facetime";
    } catch { /* ignore -- platform detection is best-effort */ }
    return "unknown";
  }
}
