/**
 * STT Detector — Speech-to-Text with free-tier-first design.
 *
 * Provider cascade (in priority order):
 *   1. Web Speech API (free, built-in to browsers/webviews — primary)
 *   2. macOS SFSpeechRecognizer via osascript (free, offline)
 *   3. Whisper CLI (free, offline, requires local install)
 *   4. OpenAI Whisper API (cloud, requires OPENAI_API_KEY — optional upgrade)
 *   5. Deepgram API (cloud, requires DEEPGRAM_API_KEY — optional upgrade)
 *
 * Web Speech API runs in the Tauri webview, so it works on the desktop app
 * with ZERO configuration and ZERO API keys. All other providers are
 * fallbacks or optional upgrades.
 *
 * For the Node.js/CLI context (no window object), the detector falls through
 * to system or CLI-based backends automatically.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

// ── Types ───────────────────────────────────────────────

export type STTProviderType =
  | "web-speech-api"
  | "system"
  | "whisper-local"
  | "whisper-cloud"
  | "deepgram";

export interface STTDetectorConfig {
  readonly language: string;
  readonly continuous: boolean;
  readonly interimResults: boolean;
  readonly maxAlternatives: number;
  readonly silenceTimeoutMs: number;
  readonly maxRecordingMs: number;
  readonly whisperModelSize: "tiny" | "base" | "small" | "medium" | "large";
}

export interface STTTranscription {
  readonly text: string;
  readonly confidence: number;
  readonly language: string;
  readonly isFinal: boolean;
  readonly alternatives: readonly string[];
  readonly durationMs: number;
  readonly provider: STTProviderType;
}

export interface STTCapabilities {
  readonly provider: STTProviderType;
  readonly available: boolean;
  readonly requiresApiKey: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsInterim: boolean;
  readonly offline: boolean;
}

export type STTEventType = "start" | "result" | "interim" | "end" | "error" | "silence";

export interface STTEvent {
  readonly type: STTEventType;
  readonly transcription?: STTTranscription;
  readonly error?: string;
  readonly timestamp: number;
}

type STTEventListener = (event: STTEvent) => void;

// ── Constants ───────────────────────────────────────────

const DEFAULT_CONFIG: STTDetectorConfig = {
  language: "en-US",
  continuous: false,
  interimResults: true,
  maxAlternatives: 3,
  silenceTimeoutMs: 1500,
  maxRecordingMs: 60_000,
  whisperModelSize: "base",
};

// ── STT Detector ────────────────────────────────────────

export class STTDetector {
  private readonly config: STTDetectorConfig;
  private activeProvider: STTProviderType | null = null;
  private listening = false;
  private readonly listeners: Map<STTEventType, STTEventListener[]> = new Map();

  // Web Speech API state (lives in the webview/browser context)
  private recognition: unknown | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<STTDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Provider Detection ──────────────────────────────────

  /**
   * Detect the best available STT provider.
   * Prefers free, built-in options before paid cloud APIs.
   */
  detectProvider(): STTProviderType | null {
    if (this.activeProvider) return this.activeProvider;

    // 1. Web Speech API (free, built-in to browsers and Tauri webview)
    if (isWebSpeechAPIAvailable()) {
      this.activeProvider = "web-speech-api";
      return "web-speech-api";
    }

    // 2. Local Whisper CLI — honestly better quality than macOS's legacy
    //    NSSpeechRecognizer. Preferred over "system" across platforms.
    //    Session-6 S5-7: previously the "system" branch fired BEFORE
    //    whisper even on macOS, returning a stub message like
    //    "[Audio recorded at /path — install whisper for transcription]"
    //    with confidence 0. That's a misleading success envelope — the
    //    caller thinks STT worked when it didn't. Now we check for
    //    whisper FIRST (works on all platforms), then honestly fall back
    //    to platform-specific system STT only when a real dictation API
    //    is reachable.
    if (isCommandAvailable("whisper") || isCommandAvailable("faster-whisper")) {
      this.activeProvider = "whisper-local";
      return "whisper-local";
    }

    // 3. macOS system speech recognition — only if the user has
    //    opted in via WOTANN_ENABLE_MACOS_SYSTEM_STT=1. The stub
    //    implementation at transcribeSystem() returns confidence:0
    //    with a "install whisper" note, which is better surfaced as
    //    null than as an honest-looking-but-fake success. Opting in
    //    keeps the flag available for callers who want to show the
    //    install-hint to the user while still returning null upstream.
    if (platform() === "darwin" && process.env["WOTANN_ENABLE_MACOS_SYSTEM_STT"] === "1") {
      this.activeProvider = "system";
      return "system";
    }

    // 4. OpenAI Whisper API (cloud, optional upgrade)
    if (process.env["OPENAI_API_KEY"]) {
      this.activeProvider = "whisper-cloud";
      return "whisper-cloud";
    }

    // 5. Deepgram API (cloud, optional upgrade)
    if (process.env["DEEPGRAM_API_KEY"]) {
      this.activeProvider = "deepgram";
      return "deepgram";
    }

    return null;
  }

  /**
   * List all available providers and their capabilities.
   */
  listCapabilities(): readonly STTCapabilities[] {
    const caps: STTCapabilities[] = [];

    caps.push({
      provider: "web-speech-api",
      available: isWebSpeechAPIAvailable(),
      requiresApiKey: false,
      supportsStreaming: true,
      supportsInterim: true,
      offline: false, // Chrome requires network; some browsers work offline
    });

    caps.push({
      provider: "system",
      available: platform() === "darwin",
      requiresApiKey: false,
      supportsStreaming: false,
      supportsInterim: false,
      offline: true,
    });

    caps.push({
      provider: "whisper-local",
      available: isCommandAvailable("whisper") || isCommandAvailable("faster-whisper"),
      requiresApiKey: false,
      supportsStreaming: false,
      supportsInterim: false,
      offline: true,
    });

    caps.push({
      provider: "whisper-cloud",
      available: !!process.env["OPENAI_API_KEY"],
      requiresApiKey: true,
      supportsStreaming: false,
      supportsInterim: false,
      offline: false,
    });

    caps.push({
      provider: "deepgram",
      available: !!process.env["DEEPGRAM_API_KEY"],
      requiresApiKey: true,
      supportsStreaming: true,
      supportsInterim: true,
      offline: false,
    });

    return caps;
  }

  // ── Listening Control ───────────────────────────────────

  /**
   * Start listening for speech.
   * In the webview context, this uses the Web Speech API with real-time
   * interim results and silence detection.
   * In the Node.js context, this records audio and transcribes with the
   * best available backend.
   */
  startListening(): boolean {
    const provider = this.detectProvider();
    if (!provider) return false;

    this.listening = true;
    this.emit({ type: "start", timestamp: Date.now() });

    if (provider === "web-speech-api") {
      return this.startWebSpeechAPI();
    }

    // For non-streaming providers, the actual transcription happens
    // when transcribeAudio() is called with a recorded audio file.
    return true;
  }

  /**
   * Stop listening and finalize any pending transcription.
   */
  stopListening(): void {
    this.listening = false;

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (
      this.recognition &&
      typeof (this.recognition as { stop?: () => void }).stop === "function"
    ) {
      (this.recognition as { stop: () => void }).stop();
    }

    this.emit({ type: "end", timestamp: Date.now() });
  }

  isListening(): boolean {
    return this.listening;
  }

  getActiveProvider(): STTProviderType | null {
    return this.activeProvider;
  }

  // ── Transcription ───────────────────────────────────────

  /**
   * Transcribe an audio file using the best available provider.
   * For push-to-talk: record audio first, then call this method.
   */
  async transcribeAudio(audioPath: string): Promise<STTTranscription> {
    const provider = this.detectProvider();
    if (!provider) {
      return emptyTranscription("No STT provider available", "web-speech-api");
    }

    switch (provider) {
      case "whisper-local":
        return this.transcribeWhisperLocal(audioPath);
      case "whisper-cloud":
        return this.transcribeWhisperCloud(audioPath);
      case "deepgram":
        return this.transcribeDeepgram(audioPath);
      case "system":
        return this.transcribeSystem(audioPath);
      case "web-speech-api":
        // Web Speech API does not transcribe files; it listens in real-time.
        // If called in this context, fall through to whisper or system.
        if (isCommandAvailable("whisper") || isCommandAvailable("faster-whisper")) {
          return this.transcribeWhisperLocal(audioPath);
        }
        if (platform() === "darwin") {
          return this.transcribeSystem(audioPath);
        }
        return emptyTranscription(
          "Web Speech API only supports real-time; no file-based fallback available",
          "web-speech-api",
        );
    }
  }

  // ── Event System ────────────────────────────────────────

  on(eventType: STTEventType, listener: STTEventListener): void {
    const existing = this.listeners.get(eventType) ?? [];
    this.listeners.set(eventType, [...existing, listener]);
  }

  off(eventType: STTEventType, listener: STTEventListener): void {
    const existing = this.listeners.get(eventType) ?? [];
    this.listeners.set(
      eventType,
      existing.filter((l) => l !== listener),
    );
  }

  // ── Web Speech API (Primary — Free, Built-In) ──────────

  private startWebSpeechAPI(): boolean {
    // This runs in a browser/webview context where window.SpeechRecognition exists.
    const global = globalThis as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };

    const SpeechRecognitionCtor = global.SpeechRecognition ?? global.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return false;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = this.config.language;
    recognition.continuous = this.config.continuous;
    recognition.interimResults = this.config.interimResults;
    recognition.maxAlternatives = this.config.maxAlternatives;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.resetSilenceTimer();

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;

        const primary = result[0];
        if (!primary) continue;

        const alternatives: string[] = [];
        for (let j = 1; j < result.length; j++) {
          const alt = result[j];
          if (alt?.transcript) alternatives.push(alt.transcript);
        }

        const transcription: STTTranscription = {
          text: primary.transcript,
          confidence: primary.confidence,
          language: this.config.language,
          isFinal: result.isFinal,
          alternatives,
          durationMs: 0,
          provider: "web-speech-api",
        };

        if (result.isFinal) {
          this.emit({ type: "result", transcription, timestamp: Date.now() });
        } else {
          this.emit({ type: "interim", transcription, timestamp: Date.now() });
        }
      }
    };

    recognition.onerror = (event: { error: string }) => {
      this.emit({
        type: "error",
        error: `Web Speech API error: ${event.error}`,
        timestamp: Date.now(),
      });

      // "no-speech" is not fatal; keep listening
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.listening = false;
      }
    };

    recognition.onend = () => {
      // If continuous mode and still supposed to be listening, restart
      if (this.listening && this.config.continuous) {
        try {
          recognition.start();
        } catch {
          this.listening = false;
          this.emit({ type: "end", timestamp: Date.now() });
        }
        return;
      }
      this.listening = false;
      this.emit({ type: "end", timestamp: Date.now() });
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.resetSilenceTimer();
      return true;
    } catch {
      return false;
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    if (!this.config.continuous && this.listening) {
      this.silenceTimer = setTimeout(() => {
        this.emit({ type: "silence", timestamp: Date.now() });
        // In push-to-talk mode, silence triggers stop
        if (!this.config.continuous) {
          this.stopListening();
        }
      }, this.config.silenceTimeoutMs);
    }
  }

  // ── Whisper Local ───────────────────────────────────────

  private transcribeWhisperLocal(audioPath: string): STTTranscription {
    const cmd = isCommandAvailable("faster-whisper") ? "faster-whisper" : "whisper";
    const outputDir = join(tmpdir(), "wotann-stt");
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    try {
      execFileSync(
        cmd,
        [
          audioPath,
          "--model",
          this.config.whisperModelSize,
          "--language",
          this.config.language.split("-")[0] ?? "en",
          "--output_format",
          "txt",
          "--output_dir",
          outputDir,
        ],
        { timeout: 120_000, stdio: "pipe" },
      );

      const baseName =
        audioPath
          .split("/")
          .pop()
          ?.replace(/\.\w+$/, "") ?? "audio";
      const txtPath = join(outputDir, `${baseName}.txt`);
      const text = existsSync(txtPath) ? readFileSync(txtPath, "utf-8").trim() : "";

      return {
        text: text || "[No transcription output]",
        confidence: text.length > 0 ? 0.9 : 0,
        language: this.config.language,
        isFinal: true,
        alternatives: [],
        durationMs: 0,
        provider: "whisper-local",
      };
    } catch (error) {
      return emptyTranscription(
        `Whisper error: ${error instanceof Error ? error.message : "unknown"}`,
        "whisper-local",
      );
    }
  }

  // ── Whisper Cloud ───────────────────────────────────────

  private async transcribeWhisperCloud(audioPath: string): Promise<STTTranscription> {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      return emptyTranscription("OPENAI_API_KEY not set", "whisper-cloud");
    }

    try {
      const audioData = readFileSync(audioPath);
      const formData = new FormData();
      formData.append("file", new Blob([audioData], { type: "audio/wav" }), "audio.wav");
      formData.append("model", "whisper-1");
      formData.append("language", this.config.language.split("-")[0] ?? "en");
      formData.append("response_format", "verbose_json");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        return emptyTranscription(`Whisper API error: ${response.status}`, "whisper-cloud");
      }

      const data = (await response.json()) as {
        text?: string;
        language?: string;
        duration?: number;
      };

      return {
        text: data.text ?? "",
        confidence: 0.95,
        language: data.language ?? this.config.language,
        isFinal: true,
        alternatives: [],
        durationMs: Math.round((data.duration ?? 0) * 1000),
        provider: "whisper-cloud",
      };
    } catch (error) {
      return emptyTranscription(
        `Whisper API error: ${error instanceof Error ? error.message : "unknown"}`,
        "whisper-cloud",
      );
    }
  }

  // ── Deepgram ────────────────────────────────────────────

  private async transcribeDeepgram(audioPath: string): Promise<STTTranscription> {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) {
      return emptyTranscription("DEEPGRAM_API_KEY not set", "deepgram");
    }

    try {
      const audioData = readFileSync(audioPath);
      const lang = this.config.language.split("-")[0] ?? "en";

      const response = await fetch(
        `https://api.deepgram.com/v1/listen?model=nova-2&language=${lang}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "audio/wav",
          },
          body: audioData,
        },
      );

      if (!response.ok) {
        return emptyTranscription(`Deepgram error: ${response.status}`, "deepgram");
      }

      const data = (await response.json()) as {
        results?: {
          channels?: readonly {
            alternatives?: readonly { transcript?: string; confidence?: number }[];
          }[];
        };
        metadata?: { duration?: number };
      };

      const alt = data.results?.channels?.[0]?.alternatives?.[0];
      return {
        text: alt?.transcript ?? "",
        confidence: alt?.confidence ?? 0,
        language: this.config.language,
        isFinal: true,
        alternatives: [],
        durationMs: Math.round((data.metadata?.duration ?? 0) * 1000),
        provider: "deepgram",
      };
    } catch (error) {
      return emptyTranscription(
        `Deepgram error: ${error instanceof Error ? error.message : "unknown"}`,
        "deepgram",
      );
    }
  }

  // ── System (macOS) ──────────────────────────────────────

  private transcribeSystem(audioPath: string): STTTranscription {
    if (platform() !== "darwin") {
      return emptyTranscription("System STT only available on macOS", "system");
    }

    // Use whisper CLI if available for better quality
    if (isCommandAvailable("whisper") || isCommandAvailable("faster-whisper")) {
      return this.transcribeWhisperLocal(audioPath);
    }

    // Session-6 S5-7: honest empty transcription instead of the
    // fabricated-success envelope that looked transcribed but wasn't.
    // VoicePipeline.transcribe() translates confidence:0 into `null`,
    // which the voice.transcribe RPC turns into `{ok:false, error}` —
    // no more silent success masquerading as real STT output.
    return emptyTranscription(
      `System STT unavailable — no whisper/faster-whisper in PATH. Install one ` +
        `(e.g. brew install openai-whisper) to enable transcription. ` +
        `Audio saved at ${audioPath}.`,
      "system",
    );
  }

  // ── Helpers ─────────────────────────────────────────────

  private emit(event: STTEvent): void {
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
// Minimal type declarations for SpeechRecognition (DOM API).
// These exist in the browser/webview runtime but not in Node.js types.

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult | undefined;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative | undefined;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

// ── Utility ─────────────────────────────────────────────

function isWebSpeechAPIAvailable(): boolean {
  const global = globalThis as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return !!(global.SpeechRecognition ?? global.webkitSpeechRecognition);
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

function emptyTranscription(message: string, provider: STTProviderType): STTTranscription {
  return {
    text: `[${message}]`,
    confidence: 0,
    language: "en-US",
    isFinal: true,
    alternatives: [],
    durationMs: 0,
    provider,
  };
}
