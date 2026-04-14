/**
 * Microphone button for push-to-talk voice input.
 * Uses Web Speech API in the browser, or routes through KAIROS STT when engine is connected.
 * Pulsing red indicator when recording.
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface VoiceButtonProps {
  readonly onTranscript?: (text: string) => void;
}

export function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Check engine voice status on mount
  useEffect(() => {
    (async () => {
      try {
        const { getVoiceStatus } = await import("../../store/engine");
        const status = await getVoiceStatus();
        if (status?.sttEngine) {
          setVoiceAvailable(`STT: ${status.sttEngine}`);
        }
      } catch { /* engine not available — fallback to Web Speech API */ }
    })();
  }, []);

  const handleToggle = useCallback(() => {
    if (isListening) {
      // Stop listening
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // Start listening — use Web Speech API
    const SpeechRecognitionAPI =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      onTranscript?.("[Voice input requires a browser with Speech Recognition support]");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        onTranscript?.(transcript);
      }
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, onTranscript]);

  return (
    <button
      onClick={handleToggle}
      className="relative shrink-0 flex items-center justify-center rounded-md transition-all"
      style={{
        width: 32,
        height: 32,
        minWidth: 32,
        minHeight: 32,
        background: isListening ? "var(--color-error-muted)" : "transparent",
        border: "none",
        color: isListening ? "var(--color-error)" : "var(--color-text-muted)",
        cursor: "pointer",
        boxShadow: isListening ? "0 0 12px rgba(255, 69, 58, 0.25)" : "none",
        transition: "color 150ms ease, background 150ms ease, box-shadow 150ms ease",
      }}
      onMouseEnter={(e) => { if (!isListening) e.currentTarget.style.color = "var(--color-text-secondary)"; }}
      onMouseLeave={(e) => { if (!isListening) e.currentTarget.style.color = "var(--color-text-muted)"; }}
      aria-label={isListening ? "Stop voice recording" : "Start voice input"}
      aria-pressed={isListening}
      title={isListening ? "Stop listening" : "Voice input (push to talk)"}
    >
      {/* Pulsing ring when recording */}
      {isListening && (
        <span
          className="absolute -inset-0.5 rounded-md border-2 animate-pulse"
          style={{ borderColor: "var(--color-error)" }}
          aria-hidden="true"
        />
      )}
      {/* Pulsing red dot when recording */}
      {isListening && (
        <span
          className="absolute animate-pulse"
          style={{
            top: 2,
            right: 2,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--color-error)",
          }}
          aria-hidden="true"
        />
      )}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1a2 2 0 012 2v4a2 2 0 11-4 0V3a2 2 0 012-2z"
          fill={isListening ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M4 7a4 4 0 008 0M8 13v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// Type augmentation for Web Speech API
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}
