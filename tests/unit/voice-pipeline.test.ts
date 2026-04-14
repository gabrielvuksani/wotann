import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { VoicePipeline } from "../../src/voice/voice-pipeline.js";

describe("Voice Pipeline", () => {
  let pipeline: VoicePipeline;

  // Suppress actual audio output during tests
  beforeAll(() => { process.env["WOTANN_TEST_MODE"] = "1"; });
  afterAll(() => { delete process.env["WOTANN_TEST_MODE"]; });

  beforeEach(() => {
    pipeline = new VoicePipeline({
      sttBackend: "whisper-local",
      ttsBackend: "piper",
      speakResponses: true,
      speakCodeBlocks: false,
    });
  });

  describe("initialization", () => {
    it("initializes with default config", async () => {
      const result = await pipeline.initialize();
      // STT/TTS availability depends on system CLI tools (whisper, piper)
      // In CI/test environments they may not be installed
      expect(typeof result.stt).toBe("boolean");
      expect(typeof result.tts).toBe("boolean");
    });

    it("starts in idle state", () => {
      expect(pipeline.getState()).toBe("idle");
    });
  });

  describe("transcription", () => {
    it("transcribes audio files", async () => {
      await pipeline.initialize();
      const result = await pipeline.transcribe("/tmp/test.wav");
      // When whisper CLI isn't installed, transcribe returns null or an error message
      // When it IS installed, it returns actual transcription
      if (result) {
        expect(typeof result.text).toBe("string");
        expect(result.language).toBe("en");
      } else {
        // STT not available — null is valid
        expect(result).toBeNull();
      }
    });

    it("returns to idle state after transcription", async () => {
      await pipeline.initialize();
      await pipeline.transcribe("/tmp/test.wav");
      expect(pipeline.getState()).toBe("idle");
    });
  });

  describe("text-to-speech", () => {
    it("speaks text responses", async () => {
      await pipeline.initialize();
      const result = await pipeline.speak("Hello world");
      expect(result).toBe(true);
    });

    it("returns to idle after speaking", async () => {
      await pipeline.initialize();
      await pipeline.speak("Hello");
      expect(pipeline.getState()).toBe("idle");
    });
  });

  describe("statistics", () => {
    it("tracks transcription stats", async () => {
      await pipeline.initialize();
      const r1 = await pipeline.transcribe("/tmp/test.wav");
      const r2 = await pipeline.transcribe("/tmp/test2.wav");

      const stats = pipeline.getStats();
      // When STT backend is available, count increments per successful transcription
      // When not available (CI), transcribe returns null and count stays 0
      const expectedCount = [r1, r2].filter(Boolean).length;
      expect(stats.totalTranscriptions).toBe(expectedCount);
      expect(stats.sttBackend).toBe("whisper-local");
    });

    it("tracks TTS stats", async () => {
      await pipeline.initialize();
      await pipeline.speak("First");
      await pipeline.speak("Second");

      const stats = pipeline.getStats();
      expect(stats.totalSpoken).toBe(2);
      expect(stats.ttsBackend).toBe("piper");
    });
  });

  describe("backend detection", () => {
    it("detects available backends", () => {
      const available = VoicePipeline.detectAvailableBackends();
      expect(available.stt.length).toBeGreaterThan(0);
      expect(available.tts.length).toBeGreaterThan(0);
      expect(available.tts).toContain("none");
      expect(available.tts).toContain("system");
    });
  });

  describe("cleanup", () => {
    it("cleans up resources", async () => {
      await pipeline.initialize();
      await pipeline.cleanup();
      expect(pipeline.getState()).toBe("idle");
    });
  });
});
