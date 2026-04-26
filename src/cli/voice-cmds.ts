/**
 * voice-cmds.ts — H-J3 fix: implementations for `wotann voice ask/listen/speak`.
 *
 * Honest fallback model (QB#6, QB#10):
 *   - speak: prefer macOS `say`, fallback to espeak (Linux), error otherwise.
 *   - listen: minimal scaffold that points the user at the iOS surface where
 *     full STT pipelines are wired (VibeVoice + Whisper). Desktop STT
 *     wiring is part of TIER 1 voice-pipeline work.
 *   - ask: chains speak(prompt) → runtime query → speak(response).
 *
 * Each function is async + isolated so the CLI can swap the implementation
 * for richer backends (whisper.cpp via execFileNoThrow, MLX-based TTS, etc.)
 * without touching the command-level glue in src/index.ts.
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

/**
 * TTS speak via the platform's native voice synthesizer. macOS uses `say`,
 * Linux falls back to `espeak`. Throws when no backend is on PATH.
 */
export async function runTtsSpeak(text: string): Promise<void> {
  const platform = process.platform;
  if (platform === "darwin") {
    const result = await execFileNoThrow("say", [text]);
    if (result.exitCode !== 0) {
      throw new Error(`say exited ${result.exitCode}: ${result.stderr.trim()}`);
    }
    return;
  }
  if (platform === "linux") {
    const result = await execFileNoThrow("espeak", [text]);
    if (result.exitCode !== 0) {
      throw new Error(
        `espeak exited ${result.exitCode}: ${result.stderr.trim()}. Install via apt-get install espeak.`,
      );
    }
    return;
  }
  throw new Error(`platform ${platform} has no built-in TTS — install a third-party engine`);
}

/**
 * STT listen — minimal scaffold. Records audio for `seconds` and returns
 * the transcript. The full STT pipeline lives in src/voice/voice-pipeline.ts
 * and src/voice/vibevoice-backend.ts; this CLI surface routes through them
 * once wired. Returns empty string when no transcript captured.
 *
 * Honest stub (QB#10): the CLI surfaces a clear "not yet wired" message
 * directing users to the iOS Voice card or a third-party CLI tool until
 * the desktop STT pipeline lands in TIER 1.
 */
export async function runSttListen(_seconds: number): Promise<string> {
  // Desktop STT is gated on the voice-pipeline wiring pass. For now we
  // exit with an honest error so callers don't think silent recording is
  // happening. The iOS app's Voice card has a wired STT pipeline today.
  throw new Error(
    "wotann voice listen is not yet wired on desktop — use the iOS Voice card or pipe transcripts in via stdin (TIER 1 wave).",
  );
}

/**
 * Voice ask — chain TTS + runtime query + TTS. The runtime query path
 * defers to the existing `wotann run` codepath via dynamic import to keep
 * this module dependency-light.
 */
export async function runVoiceAsk(prompt: string): Promise<void> {
  await runTtsSpeak(`Asking: ${prompt}`);
  const { createRuntime } = await import("../core/runtime.js");
  const { runRuntimeQuery } = await import("./runtime-query.js");
  const runtime = await createRuntime(process.cwd());
  let response = "";
  try {
    await runRuntimeQuery(
      runtime,
      { prompt },
      {
        onText: (chunk) => {
          response += chunk.content;
        },
        onError: (chunk) => {
          process.stderr.write(`${chunk.content}\n`);
        },
      },
    );
  } finally {
    runtime.close();
  }
  if (response.trim()) {
    process.stdout.write(`${response}\n`);
    await runTtsSpeak(response);
  }
}
