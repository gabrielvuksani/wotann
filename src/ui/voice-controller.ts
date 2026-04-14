import { VoiceMode } from "../voice/voice-mode.js";

export interface VoiceControllerDependencies {
  readonly voice?: Pick<VoiceMode, "getCapabilities" | "startListening" | "stopListening" | "transcribe" | "speak" | "isListening">;
}

export interface VoiceCaptureResult {
  readonly transcript: string;
  readonly message: string;
}

export interface VoiceStatusSnapshot {
  readonly enabled: boolean;
  readonly autoSpeak: boolean;
  readonly listening: boolean;
  readonly stt: string | null;
  readonly tts: string | null;
  readonly canListen: boolean;
  readonly canSpeak: boolean;
}

export class TUIVoiceController {
  private readonly voice: Pick<VoiceMode, "getCapabilities" | "startListening" | "stopListening" | "transcribe" | "speak" | "isListening">;
  private enabled = false;
  private autoSpeak = false;

  constructor(dependencies: VoiceControllerDependencies = {}) {
    this.voice = dependencies.voice ?? new VoiceMode({ enabled: true });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.voice.isListening()) {
      this.voice.stopListening();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggleAutoSpeak(): boolean {
    this.autoSpeak = !this.autoSpeak;
    return this.autoSpeak;
  }

  isAutoSpeakEnabled(): boolean {
    return this.autoSpeak;
  }

  async getStatus(): Promise<VoiceStatusSnapshot> {
    const capabilities = await this.voice.getCapabilities();
    return {
      enabled: this.enabled,
      autoSpeak: this.autoSpeak,
      listening: this.voice.isListening(),
      stt: capabilities.stt,
      tts: capabilities.tts,
      canListen: capabilities.canListen,
      canSpeak: capabilities.canSpeak,
    };
  }

  async capturePrompt(): Promise<VoiceCaptureResult> {
    if (!this.enabled) {
      return { transcript: "", message: "Voice mode is disabled. Run `/voice on` first." };
    }

    if (!this.voice.startListening()) {
      return { transcript: "", message: "Voice capture could not start with the current configuration." };
    }

    try {
      const result = await this.voice.transcribe();
      const transcript = result.text.trim();
      if (!transcript) {
        return { transcript: "", message: "No speech detected." };
      }
      return {
        transcript,
        message: `Voice captured: ${transcript.slice(0, 120)}`,
      };
    } finally {
      this.voice.stopListening();
    }
  }

  async speakAssistantReply(text: string): Promise<boolean> {
    if (!this.enabled || !this.autoSpeak || !text.trim()) {
      return false;
    }
    return this.voice.speak({ text });
  }

  async speakText(text: string): Promise<boolean> {
    if (!this.enabled || !text.trim()) {
      return false;
    }
    return this.voice.speak({ text });
  }
}
