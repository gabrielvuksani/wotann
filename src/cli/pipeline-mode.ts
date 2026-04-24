/**
 * Pipeline Mode — support `cat file.py | wotann "review this"`.
 *
 * Reads stdin, combines it with the user prompt, sends the combined
 * request through the runtime, and writes the response to stdout.
 * Designed for composability with Unix pipes and CI scripts.
 *
 * ⚠ Status: ORPHAN SCAFFOLD — kept for resurrection.
 * ─────────────────────────────────────────────────────────────────────
 * Fully-specced stdin reader + runner. Not yet wired into the CLI
 * entry (`src/index.ts`) — the detection + dispatch is missing.
 * To activate: check `isPipedInput()` in `src/index.ts` before the
 * interactive-TUI branch and dispatch to `runPipelineMode()`. No
 * consumers today — safe to delete if the feature is permanently
 * descoped.
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime error (model returned error or no output)
 *   2 — input error (no stdin or invalid options)
 */

// ── Types ────────────────────────────────────────────────

export interface PipelineOptions {
  readonly prompt: string;
  readonly format: "text" | "json" | "markdown";
  readonly provider?: string;
  readonly model?: string;
}

export interface PipelineResult {
  readonly exitCode: number;
  readonly output: string;
  readonly error?: string;
}

// ── Constants ────────────────────────────────────────────

const MAX_STDIN_BYTES = 10 * 1024 * 1024; // 10MB safety limit

// ── Stdin Reader ─────────────────────────────────────────

/**
 * Read all data from stdin. Returns empty string if stdin is a TTY
 * (interactive terminal — no piped input).
 */
export async function readStdin(): Promise<string> {
  // In a TTY context, there is no piped input
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    process.stdin.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_STDIN_BYTES) {
        process.stdin.destroy();
        reject(new Error(`Stdin exceeds ${MAX_STDIN_BYTES} byte limit`));
        return;
      }
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    process.stdin.on("error", (err) => {
      reject(err);
    });
  });
}

// ── Prompt Builder ───────────────────────────────────────

/**
 * Combine user prompt with stdin content into a single prompt string.
 * If stdin is empty, the prompt is used alone.
 */
export function buildPipelinePrompt(prompt: string, stdin: string): string {
  const trimmedStdin = stdin.trim();
  if (trimmedStdin.length === 0) {
    return prompt;
  }

  return [prompt, "", "--- stdin ---", trimmedStdin, "--- end stdin ---"].join("\n");
}

// ── Format Wrapper ───────────────────────────────────────

/**
 * Apply format instructions to the system prompt based on the output format.
 */
export function getFormatInstruction(format: PipelineOptions["format"]): string {
  switch (format) {
    case "json":
      return "Respond with valid JSON only. No markdown fences, no explanation outside the JSON object.";
    case "markdown":
      return "Respond in well-formatted Markdown.";
    case "text":
      return "Respond in plain text. No markdown formatting.";
  }
}

// ── Pipeline Runner ──────────────────────────────────────

/**
 * Run the pipeline: read stdin, combine with prompt, send to runtime, write to stdout.
 *
 * The `queryFn` parameter abstracts the runtime query so this function
 * can be tested without a full WotannRuntime instance.
 */
export async function runPipeline(
  options: PipelineOptions,
  queryFn: (
    prompt: string,
    systemPrompt: string,
    provider?: string,
    model?: string,
  ) => Promise<string>,
): Promise<PipelineResult> {
  // 1. Read stdin
  let stdin: string;
  try {
    stdin = await readStdin();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read stdin";
    return { exitCode: 2, output: "", error: message };
  }

  // 2. Combine prompt with stdin
  const combinedPrompt = buildPipelinePrompt(options.prompt, stdin);

  if (combinedPrompt.trim().length === 0) {
    return { exitCode: 2, output: "", error: "No prompt provided and stdin is empty" };
  }

  // 3. Build system prompt with format instruction
  const systemPrompt = getFormatInstruction(options.format);

  // 4. Send to runtime
  try {
    const response = await queryFn(combinedPrompt, systemPrompt, options.provider, options.model);

    if (response.trim().length === 0) {
      return { exitCode: 1, output: "", error: "Model returned empty response" };
    }

    // 5. Write to stdout
    process.stdout.write(response);

    // Add trailing newline if the response does not end with one
    if (!response.endsWith("\n")) {
      process.stdout.write("\n");
    }

    return { exitCode: 0, output: response };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return { exitCode: 1, output: "", error: message };
  }
}

/**
 * Check if the current process is receiving piped input.
 */
export function isPipedInput(): boolean {
  return !process.stdin.isTTY;
}
