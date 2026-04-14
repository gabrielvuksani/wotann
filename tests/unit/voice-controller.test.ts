import { describe, expect, it, vi } from "vitest";
import { TUIVoiceController } from "../../src/ui/voice-controller.js";

describe("TUIVoiceController", () => {
  function createVoiceStub() {
    let listening = false;

    return {
      getCapabilities: vi.fn(async () => ({
        stt: "system" as const,
        tts: "system" as const,
        canListen: true,
        canSpeak: true,
      })),
      startListening: vi.fn(() => {
        listening = true;
        return true;
      }),
      stopListening: vi.fn(() => {
        listening = false;
      }),
      transcribe: vi.fn(async () => ({
        text: "hello from voice",
        confidence: 0.9,
        language: "en",
        duration: 1,
      })),
      speak: vi.fn(async () => true),
      isListening: vi.fn(() => listening),
    };
  }

  it("reports capabilities and enablement state", async () => {
    const voice = createVoiceStub();
    const controller = new TUIVoiceController({ voice });

    const disabledStatus = await controller.getStatus();
    expect(disabledStatus.enabled).toBe(false);
    expect(disabledStatus.canListen).toBe(true);

    controller.setEnabled(true);
    const enabledStatus = await controller.getStatus();
    expect(enabledStatus.enabled).toBe(true);
    expect(enabledStatus.tts).toBe("system");
  });

  it("captures a prompt only when voice mode is enabled", async () => {
    const voice = createVoiceStub();
    const controller = new TUIVoiceController({ voice });

    const disabledResult = await controller.capturePrompt();
    expect(disabledResult.transcript).toBe("");
    expect(disabledResult.message).toContain("disabled");

    controller.setEnabled(true);
    const result = await controller.capturePrompt();
    expect(result.transcript).toBe("hello from voice");
    expect(result.message).toContain("Voice captured");
    expect(voice.startListening).toHaveBeenCalledTimes(1);
    expect(voice.stopListening).toHaveBeenCalledTimes(1);
  });

  it("speaks assistant replies only when enabled and autospeak is on", async () => {
    const voice = createVoiceStub();
    const controller = new TUIVoiceController({ voice });

    expect(await controller.speakAssistantReply("hello")).toBe(false);

    controller.setEnabled(true);
    expect(await controller.speakAssistantReply("hello")).toBe(false);

    controller.toggleAutoSpeak();
    expect(await controller.speakAssistantReply("hello")).toBe(true);
    expect(voice.speak).toHaveBeenCalledWith({ text: "hello" });
  });

  it("supports explicit text playback without autospeak", async () => {
    const voice = createVoiceStub();
    const controller = new TUIVoiceController({ voice });

    controller.setEnabled(true);
    const spoken = await controller.speakText("manual playback");

    expect(spoken).toBe(true);
    expect(voice.speak).toHaveBeenCalledWith({ text: "manual playback" });
  });
});
