/**
 * Meeting Coaching Engine -- Generates real-time suggestions from transcript context.
 *
 * Runs every 10 seconds during an active meeting:
 * 1. Takes the rolling 2-minute transcript window
 * 2. Sends to the LLM with coaching instructions
 * 3. Returns suggestions: responses, action items, context, sentiment
 */

import type { TranscriptSegment, CoachingSuggestion } from "./meeting-pipeline.js";

export interface CoachingTemplate {
  readonly name: string;
  readonly systemPrompt: string;
  readonly suggestedTypes: readonly CoachingSuggestion["type"][];
}

export const COACHING_TEMPLATES: Record<string, CoachingTemplate> = {
  standup: {
    name: "Daily Standup",
    systemPrompt: "You are coaching the user during a standup meeting. Focus on: blocker identification, time management (flag if someone talks >2 min), and follow-up questions for vague updates.",
    suggestedTypes: ["action-item", "context"],
  },
  oneOnOne: {
    name: "1:1 Meeting",
    systemPrompt: "You are coaching the user during a 1:1 meeting. Focus on: follow-up questions to ask, topics from previous meetings, empathetic responses, and career growth opportunities.",
    suggestedTypes: ["response", "context", "action-item"],
  },
  interview: {
    name: "Interview",
    systemPrompt: "You are coaching the user during a job interview. Focus on: suggested technical answers, behavioral question frameworks (STAR method), and questions to ask the interviewer.",
    suggestedTypes: ["response", "context"],
  },
  presentation: {
    name: "Presentation Q&A",
    systemPrompt: "You are coaching the user during a Q&A session after a presentation. Focus on: suggested answers to audience questions, key data points to reference, and ways to handle tough questions gracefully.",
    suggestedTypes: ["response", "context"],
  },
  retro: {
    name: "Sprint Retrospective",
    systemPrompt: "You are coaching the user during a retrospective. Focus on: categorizing items (went well / improve / action), ensuring balanced participation, and extracting concrete action items.",
    suggestedTypes: ["action-item", "summary"],
  },
  general: {
    name: "General Meeting",
    systemPrompt: "You are a meeting assistant. Provide: suggested responses when the user is asked a question, real-time action items as they're discussed, key context from previous work, and brief sentiment analysis.",
    suggestedTypes: ["response", "action-item", "context", "sentiment"],
  },
};

export class CoachingEngine {
  private template: CoachingTemplate = COACHING_TEMPLATES.general!;
  private lastAnalysisMs = 0;
  private readonly analysisIntervalMs = 10_000; // Every 10 seconds

  setTemplate(name: string): void {
    this.template = COACHING_TEMPLATES[name] ?? COACHING_TEMPLATES.general!;
  }

  /**
   * Check if enough time has passed for a new analysis.
   */
  shouldAnalyze(): boolean {
    return Date.now() - this.lastAnalysisMs >= this.analysisIntervalMs;
  }

  /**
   * Build the coaching prompt from the rolling transcript.
   */
  buildCoachingPrompt(segments: readonly TranscriptSegment[], userContext?: string): string {
    this.lastAnalysisMs = Date.now();

    const transcript = segments
      .map(s => `[${s.speaker === "user" ? "You" : "Them"}]: ${s.text}`)
      .join("\n");

    return [
      this.template.systemPrompt,
      "",
      userContext ? `Context from your previous work:\n${userContext}\n` : "",
      "Recent conversation (last 2 minutes):",
      transcript,
      "",
      `Provide 1-3 coaching suggestions. Types to focus on: ${this.template.suggestedTypes.join(", ")}.`,
      "Format each as: [TYPE] suggestion text",
      "Be concise -- the user is in a live meeting and needs to read quickly.",
    ].filter(Boolean).join("\n");
  }

  /**
   * Parse coaching response from LLM into structured suggestions.
   */
  parseSuggestions(response: string): readonly Omit<CoachingSuggestion, "timestamp">[] {
    const suggestions: Omit<CoachingSuggestion, "timestamp">[] = [];
    const lines = response.split("\n").filter(l => l.trim().length > 0);

    for (const line of lines) {
      const match = line.match(/^\[(\w[\w-]*)\]\s*(.+)/);
      if (match) {
        const typeRaw = match[1]!.toLowerCase().replace(/-/g, "_");
        const validTypes: readonly string[] = ["response", "action_item", "action-item", "context", "sentiment", "summary"];
        const type = validTypes.includes(typeRaw)
          ? (typeRaw.replace("_", "-") as CoachingSuggestion["type"])
          : "context";
        suggestions.push({
          type,
          content: match[2]!.trim(),
          confidence: 0.7,
        });
      }
    }

    return suggestions;
  }

  getTemplate(): CoachingTemplate {
    return this.template;
  }
}
