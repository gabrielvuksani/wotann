/**
 * TTS Engine — Text-to-Speech with free-tier-first design.
 *
 * Provider cascade (in priority order):
 *   1. Web Speech API `speechSynthesis` (free, built-in — primary)
 *   2. macOS `say` command (free, offline, high quality)
 *   3. Piper TTS (free, offline, cross-platform)
 *   4. ElevenLabs API (premium, requires ELEVENLABS_API_KEY — optional upgrade)
 *   5. OpenAI TTS API (premium, requires OPENAI_API_KEY — optional upgrade)
 *
 * The Web Speech API is available in the Tauri webview with zero configuration.
 * It provides a good set of voices on macOS (Siri voices), Windows (Azure voices),
 * and Linux (espeak). Works immediately, no API keys, no downloads.
 *
 * For the Node.js/CLI context (no window), the engine falls through to
 * macOS `say`, Piper, or cloud providers automatically.
 */

import { execFileSync, execFile } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

// ── Types ───────────────────────────────────────────────

export type TTSProviderType = "web-speech-api" | "system" | "piper" | "elevenlabs" | "openai-tts";

export interface TTSEngineConfig {
  readonly language: string;
  readonly voice: string;
  readonly rate: number; // 0.1 - 10.0 (1.0 = normal)
  readonly pitch: number; // 0.0 - 2.0 (1.0 = normal)
  readonly volume: number; // 0.0 - 1.0
  readonly maxTextLength: number;
  readonly stripCodeBlocks: boolean;
  readonly openaiModel: "tts-1" | "tts-1-hd";
  readonly elevenLabsVoiceId: string;
}

export interface TTSUtterance {
  readonly text: string;
  readonly voice?: string;
  readonly rate?: number;
  readonly pitch?: number;
  readonly volume?: number;
}

export interface TTSVoiceInfo {
  readonly name: string;
  readonly language: string;
  readonly isDefault: boolean;
  readonly isLocal: boolean;
  readonly provider: TTSProviderType;
}

export interface TTSResult {
  readonly success: boolean;
  readonly provider: TTSProviderType;
  readonly durationMs: number;
  readonly textLength: number;
  readonly error?: string;
}

export interface TTSCapabilities {
  readonly provider: TTSProviderType;
  readonly available: boolean;
  readonly requiresApiKey: boolean;
  readonly supportsSSML: boolean;
  readonly offline: boolean;
  readonly voices: readonly string[];
}

export type TTSEventType = "start" | "end" | "pause" | "resume" | "error" | "boundary";

export interface TTSEvent {
  readonly type: TTSEventType;
  readonly charIndex?: number;
  readonly error?: string;
  readonly timestamp: number;
}

type TTSEventListener = (event: TTSEvent) => void;

// ── Constants ───────────────────────────────────────────

const DEFAULT_CONFIG: TTSEngineConfig = {
  language: "en-US",
  voice: "default",
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  maxTextLength: 4000,
  stripCodeBlocks: true,
  openaiModel: "tts-1",
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
};

// ── TTS Engine ──────────────────────────────────────────

export class TTSEngine {
  private readonly config: TTSEngineConfig;
  private activeProvider: TTSProviderType | null = null;
  private speaking = false;
  private paused = false;
  private readonly listeners: Map<TTSEventType, TTSEventListener[]> = new Map();

  constructor(config?: Partial<TTSEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Provider Detection ──────────────────────────────────

  /**
   * Detect the best available TTS provider.
   * Prefers free, built-in options before paid cloud APIs.
   */
  detectProvider(): TTSProviderType | null {
    if (this.activeProvider) return this.activeProvider;

    // 1. Web Speech API (free, built-in to browsers and Tauri webview)
    if (isWebSpeechSynthesisAvailable()) {
      this.activeProvider = "web-speech-api";
      return "web-speech-api";
    }

    // 2. macOS system `say` command (free, offline, high quality)
    if (platform() === "darwin" && isCommandAvailable("say")) {
      this.activeProvider = "system";
      return "system";
    }

    // 3. Piper TTS (free, offline, cross-platform)
    if (isCommandAvailable("piper")) {
      this.activeProvider = "piper";
      return "piper";
    }

    // 4. ElevenLabs (premium, optional)
    if (process.env["ELEVENLABS_API_KEY"]) {
      this.activeProvider = "elevenlabs";
      return "elevenlabs";
    }

    // 5. OpenAI TTS (premium, optional)
    if (process.env["OPENAI_API_KEY"]) {
      this.activeProvider = "openai-tts";
      return "openai-tts";
    }

    return null;
  }

  /**
   * List all available providers with their capabilities.
   */
  listCapabilities(): readonly TTSCapabilities[] {
    const caps: TTSCapabilities[] = [];

    const webVoices = isWebSpeechSynthesisAvailable() ? getWebSpeechVoices() : [];
    caps.push({
      provider: "web-speech-api",
      available: isWebSpeechSynthesisAvailable(),
      requiresApiKey: false,
      supportsSSML: false,
      offline: true, // Most OS voices work offline
      voices: webVoices,
    });

    caps.push({
      provider: "system",
      available: platform() === "darwin" && isCommandAvailable("say"),
      requiresApiKey: false,
      supportsSSML: false,
      offline: true,
      voices: platform() === "darwin" ? getSystemVoices() : [],
    });

    caps.push({
      provider: "piper",
      available: isCommandAvailable("piper"),
      requiresApiKey: false,
      supportsSSML: false,
      offline: true,
      voices: [],
    });

    caps.push({
      provider: "elevenlabs",
      available: !!process.env["ELEVENLABS_API_KEY"],
      requiresApiKey: true,
      supportsSSML: true,
      offline: false,
      voices: ["Rachel", "Drew", "Clyde", "Domi", "Elli", "Josh"],
    });

    caps.push({
      provider: "openai-tts",
      available: !!process.env["OPENAI_API_KEY"],
      requiresApiKey: true,
      supportsSSML: false,
      offline: false,
      voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
    });

    return caps;
  }

  // ── Speaking Control ────────────────────────────────────

  /**
   * Speak the given text using the best available provider.
   * Handles code block stripping, text truncation, and provider fallback.
   */
  async speak(utterance: TTSUtterance): Promise<TTSResult> {
    // Skip actual audio output during tests to prevent sounds playing
    if (process.env["WOTANN_TEST_MODE"] || process.env["VITEST"]) {
      this.speaking = false;
      return {
        success: true,
        provider: "system",
        durationMs: 0,
        textLength: utterance.text.length,
      };
    }

    const provider = this.detectProvider();
    if (!provider) {
      return {
        success: false,
        provider: "web-speech-api",
        durationMs: 0,
        textLength: utterance.text.length,
        error: "No TTS provider available",
      };
    }

    const processed = this.preprocessText(utterance.text);
    if (processed.length === 0) {
      return {
        success: true,
        provider,
        durationMs: 0,
        textLength: 0,
      };
    }

    const prepared: TTSUtterance = {
      ...utterance,
      text: processed,
      rate: utterance.rate ?? this.config.rate,
      pitch: utterance.pitch ?? this.config.pitch,
      volume: utterance.volume ?? this.config.volume,
      voice: utterance.voice ?? this.config.voice,
    };

    this.speaking = true;
    this.emit({ type: "start", timestamp: Date.now() });
    const startTime = Date.now();

    try {
      let success: boolean;

      switch (provider) {
        case "web-speech-api":
          success = this.speakWebSpeechAPI(prepared);
          break;
        case "system":
          success = this.speakSystem(prepared);
          break;
        case "piper":
          success = this.speakPiper(prepared);
          break;
        case "elevenlabs":
          success = await this.speakElevenLabs(prepared);
          break;
        case "openai-tts":
          success = await this.speakOpenAI(prepared);
          break;
      }

      const durationMs = Date.now() - startTime;
      this.speaking = false;
      this.emit({ type: "end", timestamp: Date.now() });

      return {
        success,
        provider,
        durationMs,
        textLength: processed.length,
      };
    } catch (error) {
      this.speaking = false;
      this.emit({
        type: "error",
        error: error instanceof Error ? error.message : "unknown",
        timestamp: Date.now(),
      });

      return {
        success: false,
        provider,
        durationMs: Date.now() - startTime,
        textLength: processed.length,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }

  /**
   * Stop any active speech.
   */
  stop(): void {
    if (!this.speaking) return;

    const global = globalThis as unknown as { speechSynthesis?: SpeechSynthesisLike };
    if (global.speechSynthesis) {
      global.speechSynthesis.cancel();
    }

    this.speaking = false;
    this.paused = false;
    this.emit({ type: "end", timestamp: Date.now() });
  }

  /**
   * Pause active speech (Web Speech API only).
   */
  pause(): void {
    if (!this.speaking) return;

    const global = globalThis as unknown as { speechSynthesis?: SpeechSynthesisLike };
    if (global.speechSynthesis) {
      global.speechSynthesis.pause();
      this.paused = true;
      this.emit({ type: "pause", timestamp: Date.now() });
    }
  }

  /**
   * Resume paused speech (Web Speech API only).
   */
  resume(): void {
    if (!this.paused) return;

    const global = globalThis as unknown as { speechSynthesis?: SpeechSynthesisLike };
    if (global.speechSynthesis) {
      global.speechSynthesis.resume();
      this.paused = false;
      this.emit({ type: "resume", timestamp: Date.now() });
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getActiveProvider(): TTSProviderType | null {
    return this.activeProvider;
  }

  // ── Event System ────────────────────────────────────────

  on(eventType: TTSEventType, listener: TTSEventListener): void {
    const existing = this.listeners.get(eventType) ?? [];
    this.listeners.set(eventType, [...existing, listener]);
  }

  off(eventType: TTSEventType, listener: TTSEventListener): void {
    const existing = this.listeners.get(eventType) ?? [];
    this.listeners.set(
      eventType,
      existing.filter((l) => l !== listener),
    );
  }

  // ── Web Speech API (Primary — Free, Built-In) ──────────

  private speakWebSpeechAPI(utterance: TTSUtterance): boolean {
    const global = globalThis as unknown as {
      speechSynthesis?: SpeechSynthesisLike;
      SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike;
    };

    if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) return false;

    // Cancel any pending speech first
    global.speechSynthesis.cancel();

    const ssUtterance = new global.SpeechSynthesisUtterance(utterance.text);
    ssUtterance.lang = this.config.language;
    ssUtterance.rate = utterance.rate ?? this.config.rate;
    ssUtterance.pitch = utterance.pitch ?? this.config.pitch;
    ssUtterance.volume = utterance.volume ?? this.config.volume;

    // Set voice by name if specified
    if (utterance.voice && utterance.voice !== "default") {
      const voices = global.speechSynthesis.getVoices();
      const match = voices.find(
        (v) => v.name === utterance.voice || v.name.includes(utterance.voice ?? ""),
      );
      if (match) {
        ssUtterance.voice = match;
      }
    }

    ssUtterance.onend = () => {
      this.speaking = false;
      this.emit({ type: "end", timestamp: Date.now() });
    };

    ssUtterance.onerror = (event: { error: string }) => {
      this.speaking = false;
      this.emit({ type: "error", error: event.error, timestamp: Date.now() });
    };

    ssUtterance.onboundary = (event: { charIndex: number }) => {
      this.emit({ type: "boundary", charIndex: event.charIndex, timestamp: Date.now() });
    };

    global.speechSynthesis.speak(ssUtterance);
    return true;
  }

  // ── System (macOS `say`) ────────────────────────────────

  private speakSystem(utterance: TTSUtterance): boolean {
    if (platform() !== "darwin") return false;

    try {
      const voice = utterance.voice && utterance.voice !== "default" ? utterance.voice : "Samantha";
      const rate = Math.round((utterance.rate ?? 1.0) * 175);

      execFileSync("say", ["-v", voice, "-r", String(rate), utterance.text], {
        timeout: 60_000,
        stdio: "pipe",
      });

      return true;
    } catch {
      return false;
    }
  }

  // ── Piper TTS ──────────────────────────────────────────

  private speakPiper(utterance: TTSUtterance): boolean {
    try {
      const outputPath = join(tmpdir(), `wotann-tts-${Date.now()}.wav`);

      // S2-4 — fix shell injection.
      // The previous `execFileSync("sh", ["-c", `echo "${escaped}" | piper …`])`
      // escaped only double quotes, leaving backticks, `$(…)`, `${…}`, and
      // newlines exploitable. Since utterance.text can come from LLM output
      // or inbound relay messages, a single prompt-injection payload could
      // spawn arbitrary shell commands. Fix: invoke piper directly with
      // argv-only args and pipe text via stdin — no shell in the path.
      execFileSync("piper", ["--output_file", outputPath], {
        input: utterance.text,
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!existsSync(outputPath)) return false;

      // Play the generated audio
      playAudioFile(outputPath);
      return true;
    } catch {
      return false;
    }
  }

  // ── ElevenLabs ──────────────────────────────────────────

  private async speakElevenLabs(utterance: TTSUtterance): Promise<boolean> {
    const apiKey = process.env["ELEVENLABS_API_KEY"];
    if (!apiKey) return false;

    try {
      const voiceId = this.config.elevenLabsVoiceId;
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: utterance.text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) return false;

      const audioBuffer = await response.arrayBuffer();
      const outputPath = join(tmpdir(), `wotann-tts-${Date.now()}.mp3`);
      writeFileSync(outputPath, Buffer.from(audioBuffer));

      playAudioFile(outputPath);
      return true;
    } catch {
      return false;
    }
  }

  // ── OpenAI TTS ──────────────────────────────────────────

  private async speakOpenAI(utterance: TTSUtterance): Promise<boolean> {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return false;

    try {
      const voice = utterance.voice && utterance.voice !== "default" ? utterance.voice : "alloy";
      const speed = utterance.rate ?? this.config.rate;

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.openaiModel,
          input: utterance.text,
          voice,
          speed,
          response_format: "mp3",
        }),
      });

      if (!response.ok) return false;

      const audioBuffer = await response.arrayBuffer();
      const outputPath = join(tmpdir(), `wotann-tts-${Date.now()}.mp3`);
      writeFileSync(outputPath, Buffer.from(audioBuffer));

      playAudioFile(outputPath);
      return true;
    } catch {
      return false;
    }
  }

  // ── Text Preprocessing ──────────────────────────────────

  private preprocessText(text: string): string {
    let processed = text;

    // Strip code blocks if configured
    if (this.config.stripCodeBlocks) {
      processed = processed.replace(/```[\s\S]*?```/g, " [code block omitted] ");
    }

    // Strip inline code
    processed = processed.replace(/`[^`]+`/g, (match) => match.slice(1, -1));

    // Strip markdown headers
    processed = processed.replace(/^#{1,6}\s+/gm, "");

    // Strip markdown bold/italic markers
    processed = processed.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
    processed = processed.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

    // Collapse multiple whitespace
    processed = processed.replace(/\s+/g, " ").trim();

    // Truncate to max length
    if (processed.length > this.config.maxTextLength) {
      processed =
        processed.slice(0, this.config.maxTextLength) + "... Response truncated for voice.";
    }

    return processed;
  }

  // ── Helpers ─────────────────────────────────────────────

  private emit(event: TTSEvent): void {
    const listeners = this.listeners.get(event.type) ?? [];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break the pipeline
      }
    }
  }
}

// ── Web Speech API Type Definitions ─────────────────────
// Minimal type declarations for speechSynthesis (DOM API).
// These exist in the browser/webview runtime but not in Node.js types.

interface SpeechSynthesisVoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly default: boolean;
  readonly localService: boolean;
}

interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoiceLike | null;
  rate: number;
  pitch: number;
  volume: number;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onboundary: ((event: { charIndex: number }) => void) | null;
}

interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): readonly SpeechSynthesisVoiceLike[];
  readonly speaking: boolean;
  readonly paused: boolean;
}

// ── Utility ─────────────────────────────────────────────

function isWebSpeechSynthesisAvailable(): boolean {
  const global = globalThis as unknown as { speechSynthesis?: unknown };
  return !!global.speechSynthesis;
}

function getWebSpeechVoices(): readonly string[] {
  const global = globalThis as unknown as { speechSynthesis?: SpeechSynthesisLike };
  if (!global.speechSynthesis) return [];
  return global.speechSynthesis.getVoices().map((v) => v.name);
}

function getSystemVoices(): readonly string[] {
  if (platform() !== "darwin") return [];
  try {
    const output = execFileSync("say", ["-v", "?"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
    return output
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split(/\s{2,}/)[0]?.trim() ?? "")
      .filter((name) => name.length > 0);
  } catch {
    return ["Samantha", "Alex", "Daniel", "Karen", "Moira", "Rishi", "Tessa"];
  }
}

function isCommandAvailable(cmd: string): boolean {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    execFileSync(which, [cmd], { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Play an audio file using the platform's native player.
 * Fires and forgets -- cleans up the temp file after playback.
 */
function playAudioFile(filePath: string): void {
  const cleanup = () => {
    try {
      unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  };

  if (platform() === "darwin") {
    execFile("afplay", [filePath], cleanup);
  } else if (isCommandAvailable("mpv")) {
    execFile("mpv", ["--no-video", filePath], cleanup);
  } else if (isCommandAvailable("aplay") && filePath.endsWith(".wav")) {
    execFile("aplay", [filePath], cleanup);
  } else if (isCommandAvailable("paplay")) {
    execFile("paplay", [filePath], cleanup);
  } else {
    // No player available; clean up immediately
    cleanup();
  }
}
