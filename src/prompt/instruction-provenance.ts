/**
 * Instruction provenance tracing (E8).
 *
 * Codex pattern: every line in the final system prompt gets tagged with the
 * file (or subsystem) that produced it. If the agent later behaves in a way
 * the user doesn't want, we can trace the offending instruction back to its
 * source instead of grepping the whole prompt engine.
 *
 * Runtime usage:
 *   const traced = traceInstructions(prompt, [
 *     { source: "AGENTS.md", lines: agentsLines },
 *     { source: "USER.md",  lines: userLines  },
 *     { source: "memory",   lines: memoryLines },
 *   ]);
 *   // traced.sourceMap: Map<lineNumber, source>
 *   // traced.trace(lineNumber) -> { source, originalLine }
 */

export interface InstructionSource {
  readonly source: string;
  readonly lines: readonly string[];
  readonly priority?: number;
}

export interface TracedPrompt {
  readonly text: string;
  readonly sourceMap: ReadonlyMap<number, string>;
  readonly sources: readonly InstructionSource[];
}

export interface ProvenanceHit {
  readonly lineNumber: number;
  readonly source: string;
  readonly originalLine: string;
}

/**
 * Compose an assembled prompt from sources and produce a line→source map.
 * Sources are concatenated in order, separated by a blank line. If a source
 * is empty it's skipped.
 */
export function traceInstructions(sources: readonly InstructionSource[]): TracedPrompt {
  const lines: string[] = [];
  const sourceMap = new Map<number, string>();

  for (const src of sources) {
    if (src.lines.length === 0) continue;
    // Blank line separator between sources so the model can also see the
    // boundary visually when it reads the prompt.
    if (lines.length > 0) {
      lines.push("");
    }
    for (const line of src.lines) {
      lines.push(line);
      sourceMap.set(lines.length, src.source);
    }
  }

  return {
    text: lines.join("\n"),
    sourceMap,
    sources,
  };
}

/** Look up the source for a 1-indexed line number. */
export function whichSource(traced: TracedPrompt, lineNumber: number): string | undefined {
  return traced.sourceMap.get(lineNumber);
}

/**
 * Search the prompt for a needle (substring match). Returns every matching
 * line with its source attribution so users can answer "who told the agent
 * to X?" from the CLI.
 */
export function findProvenance(traced: TracedPrompt, needle: string): readonly ProvenanceHit[] {
  const lines = traced.text.split("\n");
  const lower = needle.toLowerCase();
  const hits: ProvenanceHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.toLowerCase().includes(lower)) {
      const source = traced.sourceMap.get(i + 1) ?? "unknown";
      hits.push({ lineNumber: i + 1, source, originalLine: line });
    }
  }
  return hits;
}

/**
 * Render a summary of sources and their line ranges. Useful for the
 * `/debug prompt` diagnostic command.
 */
export function renderSourceSummary(traced: TracedPrompt): string {
  const out: string[] = [];
  const ranges = new Map<string, { first: number; last: number; count: number }>();

  for (const [line, source] of traced.sourceMap) {
    const existing = ranges.get(source);
    if (existing) {
      ranges.set(source, {
        first: Math.min(existing.first, line),
        last: Math.max(existing.last, line),
        count: existing.count + 1,
      });
    } else {
      ranges.set(source, { first: line, last: line, count: 1 });
    }
  }

  for (const [source, { first, last, count }] of ranges) {
    out.push(`- ${source}: lines ${first}-${last} (${count} lines)`);
  }

  return out.join("\n");
}
