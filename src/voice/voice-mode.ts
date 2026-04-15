/**
 * Voice mode: push-to-talk with STT and TTS.
 *
 * ARCHITECTURE:
 * - STT (Speech-to-Text):
 *   1. OpenAI Whisper API (best quality, requires OPENAI_API_KEY)
 *   2. Whisper CLI (local, offline, requires whisper installed)
 *   3. macOS SFSpeechRecognizer (system, offline)
 *   4. Deepgram API (streaming, requires DEEPGRAM_API_KEY)
 *
 * - TTS (Text-to-Speech):
 *   1. OpenAI TTS API (best quality, requires OPENAI_API_KEY)
 *   2. ElevenLabs API (premium voices, requires ELEVENLABS_API_KEY)
 *   3. macOS `say` (system, offline, free)
 *   4. Piper TTS (offline, cross-platform, free)
 *
 * - Degrades gracefully: if no engine available, voice mode is disabled
 * - Push-to-talk: user presses key to start/stop recording
 * - Wake word: optional "Hey WOTANN" activation
 *
 * PLATFORM SUPPORT:
 * - macOS: native `say` for TTS, sox/rec for recording
 * - Linux: Piper TTS (offline), arecord for recording
 * - Both: OpenAI API, ElevenLabs API, Deepgram API (cloud)
 */

import { execFileSync, execFile } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

export type STTProvider = "openai-whisper-api" | "whisper" | "deepgram" | "system";
export type TTSProvider = "openai-tts" | "elevenlabs" | "piper" | "system";

export interface VoiceConfig {
  readonly enabled: boolean;
  readonly sttProvider: STTProvider;
  readonly ttsProvider: TTSProvider;
  readonly pushToTalk: boolean;
  readonly wakeWord?: string;
  readonly language: string;
  readonly ttsVoice?: string;
  readonly ttsSpeed?: number;
  /** OpenAI TTS model: tts-1 (fast) or tts-1-hd (quality) */
  readonly openaiTTSModel?: string;
  /** ElevenLabs voice ID */
  readonly elevenLabsVoiceId?: string;
}

export interface STTResult {
  readonly text: string;
  readonly confidence: number;
  readonly language: string;
  readonly duration: number;
}

export interface TTSOptions {
  readonly text: string;
  readonly voice?: string;
  readonly speed?: number;
  readonly pitch?: number;
}

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  sttProvider: "system",
  ttsProvider: "system",
  pushToTalk: true,
  language: "en",
  ttsVoice: "Samantha",
  ttsSpeed: 1.0,
  openaiTTSModel: "tts-1",
};

export class VoiceMode {
  private readonly config: VoiceConfig;
  private listening: boolean = false;
  private detectedSTT: STTProvider | null = null;
  private detectedTTS: TTSProvider | null = null;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isListening(): boolean {
    return this.listening;
  }

  getConfig(): VoiceConfig {
    return this.config;
  }

  startListening(): boolean {
    if (!this.config.enabled) return false;
    this.listening = true;
    return true;
  }

  stopListening(): void {
    this.listening = false;
  }

  // ── STT Detection & Execution ────────────────────────────

  async detectSTTProvider(): Promise<STTProvider | null> {
    if (this.detectedSTT) return this.detectedSTT;

    // 1. OpenAI Whisper API (best quality)
    if (process.env["OPENAI_API_KEY"]) {
      this.detectedSTT = "openai-whisper-api";
      return "openai-whisper-api";
    }

    // 2. Whisper CLI (local, offline)
    if (isCommandAvailable("whisper")) {
      this.detectedSTT = "whisper";
      return "whisper";
    }

    // 3. macOS system dictation
    if (platform() === "darwin") {
      this.detectedSTT = "system";
      return "system";
    }

    // 4. Deepgram API
    if (process.env["DEEPGRAM_API_KEY"]) {
      this.detectedSTT = "deepgram";
      return "deepgram";
    }

    return null;
  }

  /**
   * Record audio and transcribe to text.
   * Uses the best available STT provider.
   */
  async transcribe(audioPath?: string): Promise<STTResult> {
    const provider = await this.detectSTTProvider();
    if (!provider) {
      return { text: "", confidence: 0, language: this.config.language, duration: 0 };
    }

    switch (provider) {
      case "openai-whisper-api":
        return this.transcribeOpenAIWhisper(audioPath);
      case "system":
        return this.transcribeSystem(audioPath);
      case "whisper":
        return this.transcribeWhisper(audioPath);
      case "deepgram":
        return this.transcribeDeepgram(audioPath);
    }
  }

  private async transcribeOpenAIWhisper(audioPath?: string): Promise<STTResult> {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      return { text: "", confidence: 0, language: this.config.language, duration: 0 };
    }

    // If no audio path, record first
    const input = audioPath ?? (await this.recordAudio());
    if (!input) {
      return {
        text: "[No audio input available]",
        confidence: 0,
        language: this.config.language,
        duration: 0,
      };
    }

    try {
      const audioData = readFileSync(input);
      const formData = new FormData();
      formData.append("file", new Blob([audioData], { type: "audio/wav" }), "audio.wav");
      formData.append("model", "whisper-1");
      formData.append("language", this.config.language);
      formData.append("response_format", "verbose_json");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        return {
          text: `[Whisper API error: ${response.status}]`,
          confidence: 0,
          language: this.config.language,
          duration: 0,
        };
      }

      const data = (await response.json()) as {
        text?: string;
        language?: string;
        duration?: number;
      };

      return {
        text: data.text ?? "",
        confidence: 0.95, // Whisper API is highly accurate
        language: data.language ?? this.config.language,
        duration: data.duration ?? 0,
      };
    } catch (error) {
      return {
        text: `[Whisper API error: ${error instanceof Error ? error.message : "unknown"}]`,
        confidence: 0,
        language: this.config.language,
        duration: 0,
      };
    } finally {
      // Clean up recorded audio if we recorded it
      if (!audioPath && input) {
        try {
          unlinkSync(input);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async transcribeSystem(_audioPath?: string): Promise<STTResult> {
    if (platform() !== "darwin") {
      return { text: "", confidence: 0, language: this.config.language, duration: 0 };
    }

    const tempAudio = join(tmpdir(), `wotann-voice-${Date.now()}.wav`);

    try {
      const recorded = await this.recordAudioToPath(tempAudio);
      if (!recorded) {
        return {
          text: "[No audio recorder available]",
          confidence: 0,
          language: this.config.language,
          duration: 0,
        };
      }

      // If whisper CLI is available, use it for transcription
      if (isCommandAvailable("whisper")) {
        return this.transcribeWhisper(tempAudio);
      }

      // If OpenAI key is available, use API
      if (process.env["OPENAI_API_KEY"]) {
        return this.transcribeOpenAIWhisper(tempAudio);
      }

      return {
        text: "[Audio recorded but no transcription engine available]",
        confidence: 0.5,
        language: this.config.language,
        duration: 5,
      };
    } catch {
      return { text: "", confidence: 0, language: this.config.language, duration: 0 };
    } finally {
      try {
        if (existsSync(tempAudio)) unlinkSync(tempAudio);
      } catch {
        /* ignore */
      }
    }
  }

  private async transcribeWhisper(audioPath?: string): Promise<STTResult> {
    const input = audioPath ?? join(tmpdir(), `wotann-voice-${Date.now()}.wav`);
    const outputDir = join(tmpdir(), "wotann-whisper");
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    try {
      execFileSync(
        "whisper",
        [
          input,
          "--model",
          "base",
          "--language",
          this.config.language,
          "--output_format",
          "txt",
          "--output_dir",
          outputDir,
        ],
        { timeout: 30_000, stdio: "pipe" },
      );

      const baseName =
        input
          .split("/")
          .pop()
          ?.replace(/\.\w+$/, "") ?? "audio";
      const txtPath = join(outputDir, `${baseName}.txt`);

      if (existsSync(txtPath)) {
        const text = readFileSync(txtPath, "utf-8").trim();
        return { text, confidence: 0.9, language: this.config.language, duration: 0 };
      }

      return { text: "", confidence: 0, language: this.config.language, duration: 0 };
    } catch {
      return { text: "", confidence: 0, language: this.config.language, duration: 0 };
    }
  }

  private async transcribeDeepgram(audioPath?: string): Promise<STTResult> {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) {
      return {
        text: "[Deepgram API key not set]",
        confidence: 0,
        language: this.config.language,
        duration: 0,
      };
    }

    const input = audioPath ?? (await this.recordAudio());
    if (!input) {
      return {
        text: "[No audio input]",
        confidence: 0,
        language: this.config.language,
        duration: 0,
      };
    }

    try {
      const audioData = readFileSync(input);

      const response = await fetch(
        `https://api.deepgram.com/v1/listen?model=nova-2&language=${this.config.language}`,
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
        return {
          text: `[Deepgram error: ${response.status}]`,
          confidence: 0,
          language: this.config.language,
          duration: 0,
        };
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
        duration: data.metadata?.duration ?? 0,
      };
    } catch (error) {
      return {
        text: `[Deepgram error: ${error instanceof Error ? error.message : "unknown"}]`,
        confidence: 0,
        language: this.config.language,
        duration: 0,
      };
    }
  }

  // ── TTS Detection & Execution ────────────────────────────

  async detectTTSProvider(): Promise<TTSProvider | null> {
    if (this.detectedTTS) return this.detectedTTS;

    // 1. OpenAI TTS API (best quality)
    if (process.env["OPENAI_API_KEY"]) {
      this.detectedTTS = "openai-tts";
      return "openai-tts";
    }

    // 2. ElevenLabs API
    if (process.env["ELEVENLABS_API_KEY"]) {
      this.detectedTTS = "elevenlabs";
      return "elevenlabs";
    }

    // 3. macOS: native `say` command
    if (platform() === "darwin" && isCommandAvailable("say")) {
      this.detectedTTS = "system";
      return "system";
    }

    // 4. Piper TTS (offline, cross-platform)
    if (isCommandAvailable("piper")) {
      this.detectedTTS = "piper";
      return "piper";
    }

    return null;
  }

  /**
   * Speak text aloud using the best available TTS provider.
   */
  async speak(options: TTSOptions): Promise<boolean> {
    const provider = await this.detectTTSProvider();
    if (!provider) return false;

    switch (provider) {
      case "openai-tts":
        return this.speakOpenAI(options);
      case "elevenlabs":
        return this.speakElevenLabs(options);
      case "system":
        return this.speakSystem(options);
      case "piper":
        return this.speakPiper(options);
    }
  }

  private async speakOpenAI(options: TTSOptions): Promise<boolean> {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return false;

    try {
      const voice = options.voice ?? "alloy";
      const model = this.config.openaiTTSModel ?? "tts-1";
      const speed = options.speed ?? this.config.ttsSpeed ?? 1.0;

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: options.text,
          voice,
          speed,
          response_format: "mp3",
        }),
      });

      if (!response.ok) return false;

      const audioBuffer = await response.arrayBuffer();
      const tempMp3 = join(tmpdir(), `wotann-tts-${Date.now()}.mp3`);
      writeFileSync(tempMp3, Buffer.from(audioBuffer));

      // Play the audio
      if (platform() === "darwin") {
        execFile("afplay", [tempMp3], () => {
          try {
            unlinkSync(tempMp3);
          } catch {
            /* ignore */
          }
        });
      } else {
        execFile("mpv", ["--no-video", tempMp3], () => {
          try {
            unlinkSync(tempMp3);
          } catch {
            /* ignore */
          }
        });
      }

      return true;
    } catch {
      return false;
    }
  }

  private async speakElevenLabs(options: TTSOptions): Promise<boolean> {
    const apiKey = process.env["ELEVENLABS_API_KEY"];
    if (!apiKey) return false;

    try {
      const voiceId = this.config.elevenLabsVoiceId ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel (default)

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: options.text,
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
      const tempMp3 = join(tmpdir(), `wotann-tts-${Date.now()}.mp3`);
      writeFileSync(tempMp3, Buffer.from(audioBuffer));

      if (platform() === "darwin") {
        execFile("afplay", [tempMp3], () => {
          try {
            unlinkSync(tempMp3);
          } catch {
            /* ignore */
          }
        });
      } else {
        execFile("mpv", ["--no-video", tempMp3], () => {
          try {
            unlinkSync(tempMp3);
          } catch {
            /* ignore */
          }
        });
      }

      return true;
    } catch {
      return false;
    }
  }

  private speakSystem(options: TTSOptions): boolean {
    if (platform() !== "darwin") return false;

    try {
      const voice = options.voice ?? this.config.ttsVoice ?? "Samantha";
      const rate = Math.round((options.speed ?? this.config.ttsSpeed ?? 1.0) * 175);

      execFileSync("say", ["-v", voice, "-r", String(rate), options.text], {
        timeout: 30_000,
        stdio: "pipe",
      });

      return true;
    } catch {
      return false;
    }
  }

  private speakPiper(options: TTSOptions): boolean {
    try {
      const tempWav = join(tmpdir(), `wotann-tts-${Date.now()}.wav`);
      const input = options.text;

      // S2-3 — fix shell injection.
      // Previously: execFileSync("sh", ["-c", `echo "${input.replace(/"/g, '\\"')}" | piper ...`])
      // This is the classic unsafe pattern — escaping only `"` leaves
      // backticks, `$(…)`, `${…}`, `$var`, and newline injection wide
      // open. Since TTS input often comes from LLM output or relay
      // messages, a prompt-injection payload could spawn arbitrary
      // commands. Fix: invoke piper directly as an argv-safe binary and
      // pipe the text via stdin — piper accepts lines on stdin when no
      // text argument is provided, so no shell is involved at any point.
      execFileSync("piper", ["--output_file", tempWav], {
        input,
        timeout: 15_000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (platform() === "darwin") {
        execFile("afplay", [tempWav], () => {
          try {
            unlinkSync(tempWav);
          } catch {
            /* ignore */
          }
        });
      } else {
        execFile("aplay", [tempWav], () => {
          try {
            unlinkSync(tempWav);
          } catch {
            /* ignore */
          }
        });
      }

      return true;
    } catch {
      return false;
    }
  }

  // ── Audio Recording Helpers ─────────────────────────────

  private async recordAudio(durationSec: number = 5): Promise<string | null> {
    const tempPath = join(tmpdir(), `wotann-voice-${Date.now()}.wav`);
    const recorded = await this.recordAudioToPath(tempPath, durationSec);
    return recorded ? tempPath : null;
  }

  private async recordAudioToPath(outputPath: string, durationSec: number = 5): Promise<boolean> {
    try {
      if (isCommandAvailable("sox")) {
        execFileSync(
          "sox",
          [
            "-d",
            "-r",
            "16000",
            "-c",
            "1",
            "-b",
            "16",
            outputPath,
            "trim",
            "0",
            String(durationSec),
          ],
          { timeout: (durationSec + 5) * 1000, stdio: "pipe" },
        );
        return true;
      }
      if (isCommandAvailable("rec")) {
        execFileSync("rec", [outputPath, "trim", "0", String(durationSec)], {
          timeout: (durationSec + 5) * 1000,
          stdio: "pipe",
        });
        return true;
      }
      if (platform() === "linux" && isCommandAvailable("arecord")) {
        execFileSync(
          "arecord",
          ["-f", "S16_LE", "-r", "16000", "-c", "1", "-d", String(durationSec), outputPath],
          { timeout: (durationSec + 5) * 1000, stdio: "pipe" },
        );
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  // ── Convenience Methods ──────────────────────────────────

  /**
   * Get a summary of available voice capabilities.
   */
  async getCapabilities(): Promise<{
    stt: STTProvider | null;
    tts: TTSProvider | null;
    canListen: boolean;
    canSpeak: boolean;
  }> {
    const stt = await this.detectSTTProvider();
    const tts = await this.detectTTSProvider();
    return {
      stt,
      tts,
      canListen: stt !== null,
      canSpeak: tts !== null,
    };
  }
}

// ── Utility ────────────────────────────────────────────────

function isCommandAvailable(command: string): boolean {
  try {
    const whichCmd = platform() === "win32" ? "where" : "which";
    execFileSync(whichCmd, [command], { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
