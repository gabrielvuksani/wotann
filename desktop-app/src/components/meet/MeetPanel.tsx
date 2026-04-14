/**
 * Meet Panel — collaboration overlay for real-time sessions.
 * Slides in as a right overlay (320px) showing participants, voice controls,
 * and shared context. Activates via Cmd+Shift+M or "Enter Meet Mode".
 *
 * Use cases: pair programming, collaborative debugging, code review sessions.
 */

import { useState, useCallback } from "react";
import { useStore } from "../../store";
import { AudioCapturePanel } from "./AudioCapturePanel";

type MeetTab = "participants" | "audio";

export function MeetPanel({ onClose }: { readonly onClose: () => void }) {
  const pairedDevices = useStore((s) => s.pairedDevices);
  const remoteSessions = useStore((s) => s.remoteSessions);
  const engineConnected = useStore((s) => s.engineConnected);
  const addNotification = useStore((s) => s.addNotification);
  const [isTalking, setIsTalking] = useState(false);
  const [tab, setTab] = useState<MeetTab>("participants");

  const handlePushToTalk = useCallback(() => {
    if (!engineConnected) {
      addNotification({ type: "error", title: "Voice unavailable", message: "Connect to the engine first to use voice." });
      return;
    }
    // Use Web Speech API for voice input during meet sessions
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      addNotification({ type: "error", title: "Voice not supported", message: "Your browser does not support speech recognition." });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SpeechRecognitionCtor() as any;
    recognition.continuous = false;
    recognition.interimResults = false;
    setIsTalking(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        addNotification({ type: "agent", title: "Voice message sent", message: transcript.slice(0, 100) });
      }
      setIsTalking(false);
    };
    recognition.onerror = () => { setIsTalking(false); };
    recognition.onend = () => { setIsTalking(false); };
    recognition.start();
  }, [engineConnected, addNotification]);

  const connectedDevices = pairedDevices.filter((d) => d.connected);
  const activeSessions = remoteSessions.filter((s) => s.status === "active");
  const totalParticipants = connectedDevices.length + activeSessions.length;

  return (
    <div
      className="flex flex-col h-full animate-slideInRight"
      style={{
        width: 320,
        background: "var(--color-bg-primary)",
        borderLeft: "1px solid var(--border-subtle)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{
          height: 44,
          padding: "0 16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="5" cy="6" r="2.5" stroke="var(--accent)" strokeWidth="1.5" />
            <circle cx="11" cy="6" r="2.5" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M1 13c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M9 13c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Meet
          </span>
          {totalParticipants > 0 && (
            <span
              style={{
                fontSize: "var(--font-size-2xs)",
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: "var(--radius-lg)",
                background: "var(--accent-muted)",
                color: "var(--accent)",
              }}
            >
              {totalParticipants}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="header-icon-btn"
          style={{ width: 24, height: 24 }}
          aria-label="Close Meet panel"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Tab switcher */}
      <div
        className="flex shrink-0"
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          padding: "0 8px",
          gap: 4,
        }}
        role="tablist"
        aria-label="Meet sections"
      >
        {([
          { id: "participants" as const, label: "People" },
          { id: "audio" as const, label: "Audio" },
        ]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 10px",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${active ? "#0A84FF" : "transparent"}`,
                color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "audio" ? (
        <div className="flex-1 overflow-y-auto">
          <AudioCapturePanel />
        </div>
      ) : (
      /* Participants */
      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
        <h3
          style={{
            fontSize: "var(--font-size-2xs)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--color-text-dim)",
            marginBottom: 12,
          }}
        >
          Participants
        </h3>

        {/* Self — always present */}
        <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--accent-muted)",
              color: "var(--accent)",
              fontSize: "var(--font-size-xs)",
              fontWeight: 700,
            }}
          >
            G
          </div>
          <div>
            <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>You (Desktop)</p>
            <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>Host</p>
          </div>
          <span
            className="ml-auto rounded-full"
            style={{ width: 6, height: 6, background: "var(--green)" }}
            aria-label="Connected"
          />
        </div>

        {/* Connected devices */}
        {connectedDevices.map((device) => (
          <div key={device.id} className="flex items-center gap-3" style={{ marginBottom: 12 }}>
            <div
              className="flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--bg-surface)",
                boxShadow: "var(--shadow-ring)",
                border: "none",
                color: "var(--color-text-muted)",
                fontSize: "var(--font-size-xs)",
                fontWeight: 700,
              }}
            >
              {device.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{device.name}</p>
              <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>{device.platform}</p>
            </div>
            <span
              className="ml-auto rounded-full"
              style={{ width: 6, height: 6, background: "var(--green)" }}
            />
          </div>
        ))}

        {/* Empty state */}
        {totalParticipants === 0 && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", marginBottom: 8 }}>
              No devices connected
            </p>
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-dim)" }}>
              Pair a device via Settings &gt; Linked Devices to collaborate
            </p>
          </div>
        )}

        {/* Voice Controls */}
        <div style={{ marginTop: 24 }}>
          <h3
            style={{
              fontSize: "var(--font-size-2xs)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--color-text-dim)",
              marginBottom: 12,
            }}
          >
            Voice
          </h3>
          <div className="flex items-center gap-2">
            <button
              className="btn-press flex items-center justify-center"
              onClick={handlePushToTalk}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: isTalking ? "var(--color-error-muted)" : "var(--bg-surface)",
                boxShadow: isTalking ? "0 0 0 2px var(--color-error)" : "var(--shadow-ring)",
                border: "none",
                cursor: "pointer",
                color: isTalking ? "var(--color-error)" : "var(--color-text-muted)",
                transition: "all 200ms ease",
              }}
              aria-label={isTalking ? "Recording... click to stop" : "Push to talk (Cmd+Shift+V)"}
              title={isTalking ? "Recording..." : "Push to talk"}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="6" y="2" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 9a6 6 0 0012 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M9 15v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div>
              <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>Push to Talk</p>
              <p style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-dim)" }}>Cmd+Shift+V</p>
            </div>
          </div>
        </div>

        {/* Shared Context */}
        <div style={{ marginTop: 24 }}>
          <h3
            style={{
              fontSize: "var(--font-size-2xs)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--color-text-dim)",
              marginBottom: 12,
            }}
          >
            Shared Context
          </h3>
          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
            {engineConnected
              ? "Active conversation is visible to all participants"
              : "Connect to engine to share context"}
          </p>
        </div>
      </div>
      )}
    </div>
  );
}
