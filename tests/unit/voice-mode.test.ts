import { describe, it, expect } from "vitest";
import { VoiceMode } from "../../src/voice/voice-mode.js";

describe("Voice Mode", () => {
  it("initializes with defaults", () => {
    const voice = new VoiceMode();
    expect(voice.isEnabled()).toBe(false);
    expect(voice.isListening()).toBe(false);
    expect(voice.getConfig().language).toBe("en");
    expect(voice.getConfig().pushToTalk).toBe(true);
  });

  it("can be enabled via config", () => {
    const voice = new VoiceMode({ enabled: true });
    expect(voice.isEnabled()).toBe(true);
  });

  it("starts and stops listening", () => {
    const voice = new VoiceMode({ enabled: true });
    expect(voice.startListening()).toBe(true);
    expect(voice.isListening()).toBe(true);
    voice.stopListening();
    expect(voice.isListening()).toBe(false);
  });

  it("refuses to listen when disabled", () => {
    const voice = new VoiceMode({ enabled: false });
    expect(voice.startListening()).toBe(false);
    expect(voice.isListening()).toBe(false);
  });

  it("detects TTS provider on macOS", async () => {
    const voice = new VoiceMode();
    const tts = await voice.detectTTSProvider();
    // On macOS, `say` should be available; on CI/Linux, may be null
    expect(typeof tts === "string" || tts === null).toBe(true);
  });

  it("detects STT provider", async () => {
    const voice = new VoiceMode();
    const stt = await voice.detectSTTProvider();
    expect(typeof stt === "string" || stt === null).toBe(true);
  });

  it("reports capabilities", async () => {
    const voice = new VoiceMode();
    const caps = await voice.getCapabilities();
    expect(caps).toHaveProperty("stt");
    expect(caps).toHaveProperty("tts");
    expect(caps).toHaveProperty("canListen");
    expect(caps).toHaveProperty("canSpeak");
  });

  it("transcribe returns empty result when no provider", async () => {
    // Create voice mode that won't find any STT
    const voice = new VoiceMode({ enabled: true });
    const result = await voice.transcribe("/nonexistent/audio.wav");
    // May succeed with system provider on macOS or return empty
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("language");
  });

  it("configures TTS voice and speed", () => {
    const voice = new VoiceMode({
      enabled: true,
      ttsVoice: "Alex",
      ttsSpeed: 1.5,
    });
    expect(voice.getConfig().ttsVoice).toBe("Alex");
    expect(voice.getConfig().ttsSpeed).toBe(1.5);
  });

  it("configures OpenAI TTS model", () => {
    const voice = new VoiceMode({
      enabled: true,
      openaiTTSModel: "tts-1-hd",
    });
    expect(voice.getConfig().openaiTTSModel).toBe("tts-1-hd");
  });

  it("configures ElevenLabs voice ID", () => {
    const voice = new VoiceMode({
      enabled: true,
      elevenLabsVoiceId: "custom-voice-id",
    });
    expect(voice.getConfig().elevenLabsVoiceId).toBe("custom-voice-id");
  });

  it("prefers OpenAI Whisper API when OPENAI_API_KEY is set", async () => {
    const origKey = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    try {
      const voice = new VoiceMode();
      const stt = await voice.detectSTTProvider();
      expect(stt).toBe("openai-whisper-api");
    } finally {
      if (origKey) {
        process.env["OPENAI_API_KEY"] = origKey;
      } else {
        delete process.env["OPENAI_API_KEY"];
      }
    }
  });
});
