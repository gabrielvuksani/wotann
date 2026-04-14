import { VoiceMode, type STTProvider, type TTSProvider } from "../voice/voice-mode.js";

export interface VoiceStatusReport {
  readonly enabled: boolean;
  readonly pushToTalk: boolean;
  readonly language: string;
  readonly stt: STTProvider | null;
  readonly tts: TTSProvider | null;
  readonly canListen: boolean;
  readonly canSpeak: boolean;
}

export async function getVoiceStatusReport(): Promise<VoiceStatusReport> {
  const voice = new VoiceMode({ enabled: true });
  const capabilities = await voice.getCapabilities();

  return {
    enabled: voice.isEnabled(),
    pushToTalk: voice.getConfig().pushToTalk,
    language: voice.getConfig().language,
    stt: capabilities.stt,
    tts: capabilities.tts,
    canListen: capabilities.canListen,
    canSpeak: capabilities.canSpeak,
  };
}
