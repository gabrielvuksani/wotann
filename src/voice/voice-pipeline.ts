/**
 * Voice Pipeline — full duplex voice interaction for WOTANN.
 *
 * Provides push-to-talk, continuous listening, and voice response.
 * Free-tier-first: Web Speech API is the primary backend (zero API keys).
 * Upgrades: Whisper (local/cloud), WhisperKit (Apple Silicon),
 * ElevenLabs TTS, OpenAI TTS, Piper TTS (offline).
 *
 * Architecture:
 * 1. Audio capture → STT backend → text
 * 2. Text → WOTANN agent loop → response text
 * 3. Response text → TTS backend → audio playback
 *
 * Provider cascade (STT): Web Speech API → system → whisper-local → whisper-cloud → deepgram
 * Provider cascade (TTS): Web Speech API → system → piper → elevenlabs → openai-tts
 */

import { execFileSync } from "node:child_process";
import { STTDetector } from "./stt-detector.js";
import { TTSEngine } from "./tts-engine.js";
import type { STTTranscription } from "./stt-detector.js";
import type { TTSResult } from "./tts-engine.js";

// ── Types ───────────────────────────────────────────────

export type STTBackend = "web-speech-api" | "whisper-local" | "whisper-cloud" | "whisperkit" | "deepgram" | "system";
export type TTSBackend = "web-speech-api" | "elevenlabs" | "openai-tts" | "piper" | "system" | "none";
export type VoiceState = "idle" | "listening" | "processing" | "speaking" | "error";

export interface VoiceConfig {
  readonly sttBackend: STTBackend;
  readonly ttsBackend: TTSBackend;
  readonly language: string;
  readonly pushToTalk: boolean;
  readonly continuous: boolean;
  readonly silenceTimeoutMs: number;
  readonly maxRecordingMs: number;
  readonly speakResponses: boolean;
  readonly speakCodeBlocks: boolean;
  readonly voiceId: string;
  readonly sttModelSize: "tiny" | "base" | "small" | "medium" | "large";
  readonly ttsRate: number;
  readonly ttsPitch: number;
  readonly ttsVolume: number;
}

export interface TranscriptionResult {
  readonly text: string;
  readonly language: string;
  readonly confidence: number;
  readonly durationMs: number;
  readonly segments: readonly TranscriptionSegment[];
}

export interface TranscriptionSegment {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
}

export interface VoicePipelineStats {
  readonly state: VoiceState;
  readonly totalTranscriptions: number;
  readonly totalSpoken: number;
  readonly avgTranscriptionLatencyMs: number;
  readonly avgTTSLatencyMs: number;
  readonly sttBackend: STTBackend;
  readonly ttsBackend: TTSBackend;
}

// ── Utility ────────────────────────────────────────────

function isCliAvailable(cmd: string): boolean {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    execFileSync(which, [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── STT Backend Abstraction ─────────────────────────────

interface STTProvider {
  readonly name: STTBackend;
  initialize(): Promise<boolean>;
  transcribe(audioPath: string): Promise<TranscriptionResult>;
  isAvailable(): boolean;
  cleanup(): Promise<void>;
}

function createWhisperLocalProvider(modelSize: string): STTProvider {
  let available = false;
  let detected = false;

  return {
    name: "whisper-local",
    async initialize(): Promise<boolean> {
      available = isCliAvailable("whisper") || isCliAvailable("faster-whisper");
      detected = true;
      return available;
    },
    async transcribe(audioPath: string): Promise<TranscriptionResult> {
      const cmd = isCliAvailable("faster-whisper") ? "faster-whisper" : "whisper";
      const { execFileSync } = await import("node:child_process");
      const { existsSync, readFileSync, mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const outputDir = join(tmpdir(), "wotann-whisper");
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

      try {
        execFileSync(cmd, [
          audioPath,
          "--model", modelSize,
          "--output_format", "txt",
          "--output_dir", outputDir,
        ], { timeout: 120_000, stdio: "pipe" });

        const baseName = audioPath.split("/").pop()?.replace(/\.\w+$/, "") ?? "audio";
        const txtPath = join(outputDir, `${baseName}.txt`);
        const text = existsSync(txtPath) ? readFileSync(txtPath, "utf-8").trim() : "";

        return {
          text: text || `[No transcription output from ${cmd}]`,
          language: "en",
          confidence: text.length > 0 ? 0.9 : 0,
          durationMs: 0,
          segments: [],
        };
      } catch {
        return { text: `[${cmd} failed for ${audioPath}]`, language: "en", confidence: 0, durationMs: 0, segments: [] };
      }
    },
    isAvailable(): boolean {
      if (!detected) {
        available = isCliAvailable("whisper") || isCliAvailable("faster-whisper");
        detected = true;
      }
      return available;
    },
    async cleanup(): Promise<void> { /* no-op */ },
  };
}

function createWhisperKitProvider(): STTProvider {
  return {
    name: "whisperkit",
    async initialize(): Promise<boolean> {
      return process.platform === "darwin" && isCliAvailable("whisperkit-cli");
    },
    async transcribe(audioPath: string): Promise<TranscriptionResult> {
      if (process.platform !== "darwin") {
        return { text: "[WhisperKit requires macOS with Apple Silicon]", language: "en", confidence: 0, durationMs: 0, segments: [] };
      }
      try {
        const { execFileSync } = await import("node:child_process");
        const output = execFileSync("whisperkit-cli", ["transcribe", "--audio-path", audioPath, "--model", "openai_whisper-base"], {
          encoding: "utf-8", timeout: 60_000, stdio: "pipe",
        }).trim();
        return { text: output || "[No output from WhisperKit]", language: "en", confidence: 0.95, durationMs: 0, segments: [] };
      } catch {
        // Fallback: WhisperKit not installed, try system whisper
        return { text: `[WhisperKit unavailable — install via brew install whisperkit-cli]`, language: "en", confidence: 0, durationMs: 0, segments: [] };
      }
    },
    isAvailable(): boolean {
      return process.platform === "darwin" && isCliAvailable("whisperkit-cli");
    },
    async cleanup(): Promise<void> { /* no-op */ },
  };
}

function createWhisperCloudProvider(): STTProvider {
  return {
    name: "whisper-cloud",
    async initialize(): Promise<boolean> {
      return !!process.env["OPENAI_API_KEY"];
    },
    async transcribe(audioPath: string): Promise<TranscriptionResult> {
      const apiKey = process.env["OPENAI_API_KEY"];
      if (!apiKey) {
        return { text: "[OPENAI_API_KEY not set]", language: "en", confidence: 0, durationMs: 0, segments: [] };
      }
      try {
        const { readFileSync } = await import("node:fs");
        const audioData = readFileSync(audioPath);
        const formData = new FormData();
        formData.append("file", new Blob([audioData], { type: "audio/wav" }), "audio.wav");
        formData.append("model", "whisper-1");
        formData.append("response_format", "verbose_json");

        const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}` },
          body: formData,
        });

        if (!response.ok) {
          return { text: `[Whisper API error: ${response.status}]`, language: "en", confidence: 0, durationMs: 0, segments: [] };
        }

        const data = (await response.json()) as { text?: string; language?: string; duration?: number };
        return {
          text: data.text ?? "",
          language: data.language ?? "en",
          confidence: 0.95,
          durationMs: Math.round((data.duration ?? 0) * 1000),
          segments: [],
        };
      } catch (error) {
        return { text: `[Whisper API error: ${error instanceof Error ? error.message : "unknown"}]`, language: "en", confidence: 0, durationMs: 0, segments: [] };
      }
    },
    isAvailable(): boolean {
      return !!process.env["OPENAI_API_KEY"];
    },
    async cleanup(): Promise<void> { /* no-op */ },
  };
}

// ── TTS Backend Abstraction ─────────────────────────────

interface TTSProvider {
  readonly name: TTSBackend;
  initialize(): Promise<boolean>;
  speak(text: string, voiceId: string): Promise<{ audioPath: string; durationMs: number }>;
  isAvailable(): boolean;
  cleanup(): Promise<void>;
}

function createPiperTTSProvider(): TTSProvider {
  return {
    name: "piper",
    async initialize(): Promise<boolean> {
      return isCliAvailable("piper");
    },
    async speak(text: string, _voiceId: string): Promise<{ audioPath: string; durationMs: number }> {
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const { existsSync } = await import("node:fs");
      const outputPath = join(tmpdir(), `wotann-piper-${Date.now()}.wav`);
      try {
        const { execFileSync } = await import("node:child_process");
        execFileSync("piper", ["--output_file", outputPath], {
          input: text,
          timeout: 30_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { audioPath: existsSync(outputPath) ? outputPath : "", durationMs: text.length * 60 };
      } catch {
        return { audioPath: "", durationMs: 0 };
      }
    },
    isAvailable(): boolean { return isCliAvailable("piper"); },
    async cleanup(): Promise<void> { /* no-op */ },
  };
}

function createElevenLabsTTSProvider(): TTSProvider {
  return {
    name: "elevenlabs",
    async initialize(): Promise<boolean> {
      return !!process.env["ELEVENLABS_API_KEY"];
    },
    async speak(text: string, voiceId: string): Promise<{ audioPath: string; durationMs: number }> {
      const apiKey = process.env["ELEVENLABS_API_KEY"];
      if (!apiKey) return { audioPath: "", durationMs: 0 };
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const { writeFileSync } = await import("node:fs");
      const outputPath = join(tmpdir(), `wotann-elevenlabs-${Date.now()}.mp3`);
      try {
        const effectiveVoiceId = voiceId || "21m00Tcm4TlvDq8ikWAM"; // Rachel default
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${effectiveVoiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_monolingual_v1",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        });
        if (!response.ok) return { audioPath: "", durationMs: 0 };
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(outputPath, buffer);
        return { audioPath: outputPath, durationMs: text.length * 50 };
      } catch {
        return { audioPath: "", durationMs: 0 };
      }
    },
    isAvailable(): boolean {
      return !!process.env["ELEVENLABS_API_KEY"];
    },
    async cleanup(): Promise<void> { /* no-op */ },
  };
}

// ── Voice Pipeline ──────────────────────────────────────

export class VoicePipeline {
  private state: VoiceState = "idle";
  private readonly config: VoiceConfig;
  private legacySttProvider: STTProvider | null = null;
  private legacyTtsProvider: TTSProvider | null = null;
  private transcriptionCount = 0;
  private spokenCount = 0;
  private totalSTTLatency = 0;
  private totalTTSLatency = 0;

  // New unified STT/TTS modules (Web Speech API primary)
  private readonly sttDetector: STTDetector;
  private readonly ttsEngine: TTSEngine;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = {
      sttBackend: "web-speech-api",
      ttsBackend: "web-speech-api",
      language: "en",
      pushToTalk: true,
      continuous: false,
      silenceTimeoutMs: 1500,
      maxRecordingMs: 60_000,
      speakResponses: true,
      speakCodeBlocks: false,
      voiceId: "default",
      sttModelSize: "base",
      ttsRate: 1.0,
      ttsPitch: 1.0,
      ttsVolume: 1.0,
      ...config,
    };

    this.sttDetector = new STTDetector({
      language: this.config.language,
      continuous: this.config.continuous,
      interimResults: true,
      silenceTimeoutMs: this.config.silenceTimeoutMs,
      maxRecordingMs: this.config.maxRecordingMs,
      whisperModelSize: this.config.sttModelSize,
    });

    this.ttsEngine = new TTSEngine({
      language: this.config.language,
      voice: this.config.voiceId,
      rate: this.config.ttsRate,
      pitch: this.config.ttsPitch,
      volume: this.config.ttsVolume,
      stripCodeBlocks: !this.config.speakCodeBlocks,
    });
  }

  /**
   * Initialize voice backends.
   * Tries the new unified modules first (Web Speech API primary),
   * then falls back to legacy CLI-based providers.
   */
  async initialize(): Promise<{ stt: boolean; tts: boolean }> {
    // Try new unified STT/TTS (Web Speech API first)
    const sttProvider = this.sttDetector.detectProvider();
    const ttsProvider = this.ttsEngine.detectProvider();

    if (sttProvider && ttsProvider) {
      return { stt: true, tts: true };
    }

    // Fall back to legacy providers for any missing capability
    let sttReady = !!sttProvider;
    let ttsReady = !!ttsProvider;

    if (!sttReady) {
      this.legacySttProvider = this.createLegacySTTProvider();
      sttReady = await this.legacySttProvider.initialize();
    }

    if (!ttsReady) {
      this.legacyTtsProvider = this.createLegacyTTSProvider();
      ttsReady = await this.legacyTtsProvider.initialize();
    }

    return { stt: sttReady, tts: ttsReady };
  }

  /**
   * Get the current voice state.
   */
  getState(): VoiceState {
    return this.state;
  }

  /**
   * Start real-time listening (push-to-talk activation).
   * Uses Web Speech API when available for streaming interim results.
   */
  startListening(): boolean {
    const started = this.sttDetector.startListening();
    if (started) {
      this.state = "listening";
    }
    return started;
  }

  /**
   * Stop listening and finalize transcription.
   */
  stopListening(): void {
    this.sttDetector.stopListening();
    this.state = "idle";
  }

  /**
   * Register a callback for real-time transcription events.
   * Works with Web Speech API's streaming interim results.
   */
  onTranscription(
    callback: (text: string, isFinal: boolean, confidence: number) => void,
  ): void {
    this.sttDetector.on("result", (event) => {
      if (event.transcription) {
        callback(event.transcription.text, true, event.transcription.confidence);
      }
    });

    this.sttDetector.on("interim", (event) => {
      if (event.transcription) {
        callback(event.transcription.text, false, event.transcription.confidence);
      }
    });
  }

  /**
   * Transcribe an audio file to text.
   * Uses the unified STT detector (prefers Web Speech API fallback chain).
   */
  async transcribe(audioPath: string): Promise<TranscriptionResult | null> {
    this.state = "processing";
    const start = Date.now();

    try {
      // Try new unified STT first
      const sttResult: STTTranscription = await this.sttDetector.transcribeAudio(audioPath);

      if (sttResult.confidence > 0) {
        const latency = Date.now() - start;
        this.transcriptionCount++;
        this.totalSTTLatency += latency;
        this.state = "idle";

        return {
          text: sttResult.text,
          language: sttResult.language,
          confidence: sttResult.confidence,
          durationMs: latency,
          segments: [],
        };
      }

      // Fall back to legacy provider
      if (this.legacySttProvider) {
        const result = await this.legacySttProvider.transcribe(audioPath);
        const latency = Date.now() - start;
        this.transcriptionCount++;
        this.totalSTTLatency += latency;
        this.state = "idle";
        return { ...result, durationMs: latency };
      }

      this.state = "idle";
      return null;
    } catch {
      this.state = "error";
      return null;
    }
  }

  /**
   * Speak a text response.
   * Uses the unified TTS engine (prefers Web Speech API).
   */
  async speak(text: string): Promise<boolean> {
    if (!this.config.speakResponses) return false;

    this.state = "speaking";
    const start = Date.now();

    try {
      // Try new unified TTS first
      const ttsResult: TTSResult = await this.ttsEngine.speak({ text });

      if (ttsResult.success) {
        const latency = Date.now() - start;
        this.spokenCount++;
        this.totalTTSLatency += latency;
        this.state = "idle";
        return true;
      }

      // Fall back to legacy provider
      if (this.legacyTtsProvider) {
        await this.legacyTtsProvider.speak(text, this.config.voiceId);
        const latency = Date.now() - start;
        this.spokenCount++;
        this.totalTTSLatency += latency;
        this.state = "idle";
        return true;
      }

      this.state = "idle";
      return false;
    } catch {
      this.state = "error";
      return false;
    }
  }

  /**
   * Stop any active speech playback.
   */
  stopSpeaking(): void {
    this.ttsEngine.stop();
    this.state = "idle";
  }

  /**
   * Get the STT Detector instance for direct access.
   */
  getSTTDetector(): STTDetector {
    return this.sttDetector;
  }

  /**
   * Get the TTS Engine instance for direct access.
   */
  getTTSEngine(): TTSEngine {
    return this.ttsEngine;
  }

  /**
   * Get pipeline statistics.
   */
  getStats(): VoicePipelineStats {
    return {
      state: this.state,
      totalTranscriptions: this.transcriptionCount,
      totalSpoken: this.spokenCount,
      avgTranscriptionLatencyMs: this.transcriptionCount > 0
        ? Math.round(this.totalSTTLatency / this.transcriptionCount)
        : 0,
      avgTTSLatencyMs: this.spokenCount > 0
        ? Math.round(this.totalTTSLatency / this.spokenCount)
        : 0,
      sttBackend: this.config.sttBackend,
      ttsBackend: this.config.ttsBackend,
    };
  }

  /**
   * Detect which STT/TTS backends are available on this system.
   * Includes Web Speech API as the primary free option.
   */
  static detectAvailableBackends(): {
    stt: readonly STTBackend[];
    tts: readonly TTSBackend[];
  } {
    const stt: STTBackend[] = [];
    const tts: TTSBackend[] = [];

    // Web Speech API: free, built-in (primary for desktop app)
    const detector = new STTDetector();
    const engine = new TTSEngine();

    const sttCaps = detector.listCapabilities();
    const ttsCaps = engine.listCapabilities();

    for (const cap of sttCaps) {
      if (cap.available) {
        stt.push(cap.provider as STTBackend);
      }
    }

    for (const cap of ttsCaps) {
      if (cap.available) {
        tts.push(cap.provider as STTBackend as TTSBackend);
      }
    }

    // Always include these as options
    if (!stt.includes("system")) stt.push("system");
    if (!tts.includes("system")) tts.push("system");
    tts.push("none");

    // WhisperKit: macOS only
    if (process.platform === "darwin" && !stt.includes("whisperkit" as STTBackend)) {
      stt.push("whisperkit");
    }

    return { stt, tts };
  }

  /**
   * Clean up resources.
   */
  async cleanup(): Promise<void> {
    this.sttDetector.stopListening();
    this.ttsEngine.stop();
    await this.legacySttProvider?.cleanup();
    await this.legacyTtsProvider?.cleanup();
    this.state = "idle";
  }

  // ── Legacy Provider Factories (backwards compatibility) ─

  private createLegacySTTProvider(): STTProvider {
    switch (this.config.sttBackend) {
      case "whisperkit":
        return createWhisperKitProvider();
      case "whisper-cloud":
        return createWhisperCloudProvider();
      case "whisper-local":
        return createWhisperLocalProvider(this.config.sttModelSize);
      default:
        return createWhisperLocalProvider(this.config.sttModelSize);
    }
  }

  private createLegacyTTSProvider(): TTSProvider {
    switch (this.config.ttsBackend) {
      case "elevenlabs":
        return createElevenLabsTTSProvider();
      case "piper":
        return createPiperTTSProvider();
      default:
        return createPiperTTSProvider();
    }
  }
}
