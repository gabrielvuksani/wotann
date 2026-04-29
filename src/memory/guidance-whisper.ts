/**
 * Guidance Whisper — letta-style "always-on" context injection.
 *
 * Renders the active block-memory plus optional ad-hoc whispers and
 * exposes them as a single `additionalContext` string. Designed to be
 * called from the UserPromptSubmit hook so every turn re-injects the
 * latest block memory without the agent having to opt in.
 *
 * Why a separate module from block-memory.ts?
 *   - Block memory is pure I/O over named files. It has no opinion on
 *     where the rendered output ends up.
 *   - The whisper module owns the *delivery channel*: a per-process
 *     queue of one-shot whispers (e.g. "the user asked you to keep an
 *     eye on this") plus the always-on rendered blocks. Tests can
 *     replace the queue without touching block storage.
 *
 * QB#7 (per-instance state, not module-global): the queue lives on a
 *   class instance attached to the runtime, not as a top-level array.
 *   Each session gets its own instance via `WhisperChannel.create()`.
 */

import { renderActiveBlocks } from "./block-memory.js";

export interface QueuedWhisper {
  readonly id: string;
  readonly text: string;
  readonly priority: "low" | "normal" | "high";
  readonly enqueuedAt: number;
  readonly oneShot: boolean;
}

export class WhisperChannel {
  private queue: QueuedWhisper[] = [];

  static create(): WhisperChannel {
    return new WhisperChannel();
  }

  enqueue(text: string, priority: "low" | "normal" | "high" = "normal", oneShot = true): string {
    const id = `whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.queue.push({ id, text, priority, enqueuedAt: Date.now(), oneShot });
    return id;
  }

  drain(consume: boolean = true): ReadonlyArray<QueuedWhisper> {
    const order: Record<QueuedWhisper["priority"], number> = { high: 0, normal: 1, low: 2 };
    const sorted = [...this.queue].sort(
      (a, b) => order[a.priority] - order[b.priority] || a.enqueuedAt - b.enqueuedAt,
    );
    if (consume) {
      this.queue = this.queue.filter((w) => !w.oneShot);
    }
    return sorted;
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }
}

const HEADER = '<guidance reason="core-memory + active whispers">';
const FOOTER = "</guidance>";

export function renderWhisper(channel: WhisperChannel | null): string {
  const sections: string[] = [];
  const core = renderActiveBlocks();
  if (core.length > 0) sections.push(core);
  if (channel) {
    const whispers = channel.drain(true);
    if (whispers.length > 0) {
      const lines: string[] = ["<whispers>"];
      for (const w of whispers) {
        lines.push(
          `  <whisper id="${w.id}" priority="${w.priority}">${escapeXml(w.text)}</whisper>`,
        );
      }
      lines.push("</whispers>");
      sections.push(lines.join("\n"));
    }
  }
  if (sections.length === 0) return "";
  return [HEADER, ...sections, FOOTER].join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
