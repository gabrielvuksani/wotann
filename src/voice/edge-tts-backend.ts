/**
 * Microsoft Edge TTS backend (E11).
 *
 * Edge-tts is Microsoft's cloud TTS used by Edge Read Aloud. Voice quality
 * is near-parity with ElevenLabs — notably the `en-US-AvaMultilingualNeural`
 * and `en-US-AriaNeural` voices — but it's free (no API key, no quota
 * tracking). Access is via an anonymous websocket, the same one Edge uses.
 *
 * We piggyback on the existing Python `edge-tts` CLI when installed
 * (`pip install edge-tts`) to avoid re-implementing the websocket handshake.
 * When the CLI is missing the backend reports unavailable and the cascade
 * falls through to system `say` or Piper.
 *
 * This is inserted between the built-in provider cascade (position 3) so
 * the priority becomes:
 *   1. Web Speech API
 *   2. macOS `say`
 *   3. Edge TTS (new)       ← here
 *   4. Piper
 *   5. ElevenLabs
 *   6. OpenAI TTS
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface EdgeTTSOptions {
  readonly voice?: string;
  readonly rate?: string; // e.g., "+0%", "-10%"
  readonly pitch?: string; // e.g., "+2Hz"
  readonly volume?: string; // e.g., "+0%"
  readonly outputPath?: string;
  readonly binary?: string;
}

/** Common high-quality voices. */
export const EDGE_VOICES = {
  ava: "en-US-AvaMultilingualNeural",
  aria: "en-US-AriaNeural",
  christopher: "en-US-ChristopherNeural",
  eric: "en-US-EricNeural",
  jenny: "en-US-JennyNeural",
  guy: "en-US-GuyNeural",
  emma: "en-US-EmmaMultilingualNeural",
  andrew: "en-US-AndrewMultilingualNeural",
  brian: "en-US-BrianMultilingualNeural",
} as const;

export function isEdgeTTSAvailable(binary = "edge-tts"): boolean {
  try {
    execFileSync(binary, ["--help"], { stdio: "pipe", timeout: 2000 });
    return true;
  } catch {
    // Also try the python -m invocation — works after `pip install edge-tts`
    // even when the CLI isn't on PATH.
    try {
      execFileSync("python3", ["-m", "edge_tts", "--help"], { stdio: "pipe", timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Synthesize `text` to an audio file using Edge TTS. Returns the output path
 * on success, null on failure. The default voice (Ava) is a high-quality
 * multilingual neural voice that works well for both code and prose.
 */
export async function edgeTTSSynthesize(
  text: string,
  options: EdgeTTSOptions = {},
): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;
  const voice = options.voice ?? EDGE_VOICES.ava;
  const rate = options.rate ?? "+0%";
  const pitch = options.pitch ?? "+0Hz";
  const volume = options.volume ?? "+0%";
  const outputPath = options.outputPath ?? join(tmpdir(), `wotann-tts-${Date.now()}.mp3`);

  const args = [
    "--voice",
    voice,
    "--rate",
    rate,
    "--pitch",
    pitch,
    "--volume",
    volume,
    "--text",
    text,
    "--write-media",
    outputPath,
  ];

  const tryRun = async (cmd: string, cmdArgs: readonly string[]): Promise<boolean> => {
    try {
      await run(cmd, [...cmdArgs], { timeout: 30_000 });
      return existsSync(outputPath);
    } catch {
      return false;
    }
  };

  // Prefer the edge-tts CLI if available
  const binary = options.binary ?? "edge-tts";
  if (await tryRun(binary, args)) return outputPath;

  // Fallback: python -m edge_tts
  if (await tryRun("python3", ["-m", "edge_tts", ...args])) return outputPath;

  return null;
}

/**
 * Play an mp3 file produced by `edgeTTSSynthesize`. Uses platform-appropriate
 * player — `afplay` on macOS, `ffplay` or `mpg123` on Linux, `powershell`
 * Start-Process on Windows.
 */
export async function playAudioFile(path: string): Promise<void> {
  if (!existsSync(path)) return;

  const commands: Array<[string, readonly string[]]> =
    process.platform === "darwin"
      ? [["afplay", [path]]]
      : process.platform === "win32"
        ? [
            ["powershell", ["-c", `(New-Object Media.SoundPlayer '${path}').PlaySync()`]],
            ["ffplay", ["-autoexit", "-nodisp", path]],
          ]
        : [
            ["ffplay", ["-autoexit", "-nodisp", path]],
            ["mpg123", ["-q", path]],
            ["mpv", ["--no-video", path]],
          ];

  for (const [cmd, args] of commands) {
    try {
      await run(cmd, [...args], { timeout: 60_000 });
      return;
    } catch {
      // try next
    }
  }
}

/**
 * List the voices available from Edge TTS. Returns the WOTANN-recommended
 * short-name set rather than the full 300+ inventory.
 */
export function listEdgeVoices(): readonly { id: string; name: string; locale: string }[] {
  return [
    { id: EDGE_VOICES.ava, name: "Ava (Multilingual)", locale: "en-US" },
    { id: EDGE_VOICES.andrew, name: "Andrew (Multilingual)", locale: "en-US" },
    { id: EDGE_VOICES.brian, name: "Brian (Multilingual)", locale: "en-US" },
    { id: EDGE_VOICES.emma, name: "Emma (Multilingual)", locale: "en-US" },
    { id: EDGE_VOICES.aria, name: "Aria", locale: "en-US" },
    { id: EDGE_VOICES.jenny, name: "Jenny", locale: "en-US" },
    { id: EDGE_VOICES.christopher, name: "Christopher", locale: "en-US" },
    { id: EDGE_VOICES.eric, name: "Eric", locale: "en-US" },
    { id: EDGE_VOICES.guy, name: "Guy", locale: "en-US" },
  ];
}
