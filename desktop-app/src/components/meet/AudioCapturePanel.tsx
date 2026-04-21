/**
 * Audio Capture Panel — D6.
 * Records system / meeting audio via existing Tauri commands
 * (`start_meeting_recording`, `stop_meeting_recording`, `detect_meeting`).
 *
 * Also shows a live SVG waveform sampled from the mic, a lightweight
 * "recent meetings" picker, and a transcription placeholder that calls
 * back into the daemon's Whisper pipeline via the JSON-RPC bridge.
 *
 * Mounted as a tab inside MeetPanel.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { commands } from "../../hooks/useTauriCommand";
import { useMicSamples, WaveformSVG } from "./AudioWaveform";
import { color } from "../../design/tokens.generated";

interface RecentMeeting {
  readonly id: string;
  readonly path: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly app: string | null;
  readonly transcript?: string;
}

const STORAGE_KEY = "wotann-recent-meetings";
const OUTPUT_DIR = "~/.wotann/meetings";

function loadRecent(): readonly RecentMeeting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentMeeting[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: readonly RecentMeeting[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-50)));
  } catch { /* ignore */ }
}

/** Ask the daemon to transcribe via its Whisper pipeline. */
async function runTranscribe(path: string): Promise<string> {
  const response = await commands.sendMessage(
    JSON.stringify({ jsonrpc: "2.0", method: "voice.transcribe", params: { path }, id: Date.now() }),
  );
  if (!response) throw new Error("No response from engine");
  const parsed = JSON.parse(response) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) throw new Error(parsed.error.message ?? "Transcription failed");
  const result = parsed.result;
  if (typeof result === "string") return result;
  if (result && typeof (result as { transcript?: unknown }).transcript === "string") {
    return (result as { transcript: string }).transcript;
  }
  return JSON.stringify(result);
}

// ── Sub-components ────────────────────────────────────

function RecordControl({
  isRecording,
  audioAvailable,
  detectedApp,
  elapsed,
  samples,
  onToggle,
}: {
  readonly isRecording: boolean;
  readonly audioAvailable: boolean;
  readonly detectedApp: string | null;
  readonly elapsed: number;
  readonly samples: readonly number[];
  readonly onToggle: () => void;
}) {
  const seconds = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div
      style={{
        background: color("surface"),
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            Audio Capture
          </h3>
          <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: "2px 0 0" }}>
            {detectedApp ? `Detected: ${detectedApp}` : "No meeting app detected"}
            {!audioAvailable && " · Audio capture unavailable"}
          </p>
        </div>
        <div
          style={{
            fontSize: 22,
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            color: isRecording ? color("error") : "var(--color-text-dim)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {mm}:{ss}
        </div>
      </div>
      <div style={{ background: color("background"), borderRadius: 8, padding: 8, marginBottom: 10 }}>
        <WaveformSVG samples={samples} active={isRecording} />
      </div>
      <button
        onClick={onToggle}
        disabled={!audioAvailable}
        className="btn-press"
        style={{
          width: "100%",
          minHeight: 44,
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          border: "none",
          background: !audioAvailable ? color("surface") : isRecording ? "rgba(255,69,58,0.15)" : color("accent"),
          color: !audioAvailable ? "var(--color-text-dim)" : isRecording ? color("error") : color("text"),
          cursor: !audioAvailable ? "not-allowed" : "pointer",
        }}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </button>
    </div>
  );
}

function RecentList({
  items,
  selectedId,
  onSelect,
}: {
  readonly items: readonly RecentMeeting[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div
      style={{
        background: color("surface"),
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-dim)", marginBottom: 8 }}>
        Recent Meetings ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
        {items.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-dim)", fontStyle: "italic" }}>No recordings yet.</p>
        ) : (
          items.slice().reverse().map((m) => {
            const active = m.id === selectedId;
            return (
              <button
                key={m.id}
                onClick={() => onSelect(m.id)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${active ? color("accent") : "rgba(255,255,255,0.05)"}`,
                  background: active ? "rgba(10,132,255,0.1)" : color("background"),
                  color: "var(--color-text-primary)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                aria-pressed={active}
              >
                <div style={{ fontWeight: 500 }}>
                  {new Date(m.startedAt).toLocaleString()} · {Math.round(m.durationMs / 1000)}s
                </div>
                {m.app && (
                  <div style={{ fontSize: 10, color: "var(--color-text-dim)", marginTop: 2 }}>{m.app}</div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TranscriptView({
  meeting,
  transcribing,
  onTranscribe,
}: {
  readonly meeting: RecentMeeting;
  readonly transcribing: boolean;
  readonly onTranscribe: () => void;
}) {
  return (
    <div
      style={{
        background: color("surface"),
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-dim)" }}>
          Transcript
        </div>
        <button
          onClick={onTranscribe}
          disabled={transcribing}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid rgba(10,132,255,0.3)",
            background: "rgba(10,132,255,0.1)",
            color: color("accent"),
            cursor: transcribing ? "wait" : "pointer",
            opacity: transcribing ? 0.6 : 1,
          }}
          aria-label="Transcribe via Whisper"
        >
          {transcribing ? "Transcribing..." : meeting.transcript ? "Re-transcribe" : "Transcribe"}
        </button>
      </div>
      <div
        style={{
          fontSize: 12,
          color: meeting.transcript ? "var(--color-text-primary)" : "var(--color-text-dim)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {meeting.transcript ?? "No transcript yet. Click Transcribe to run Whisper on this recording."}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────

export function AudioCapturePanel() {
  const [isRecording, setIsRecording] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [detectedApp, setDetectedApp] = useState<string | null>(null);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const [recent, setRecent] = useState<readonly RecentMeeting[]>(() => loadRecent());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const samples = useMicSamples(isRecording);

  useEffect(() => {
    (async () => {
      try {
        const ok = await invoke<boolean>("check_audio_capture", {});
        setAudioAvailable(ok);
      } catch {
        setAudioAvailable(false);
      }
      try {
        const app = await invoke<string | null>("detect_meeting", {});
        setDetectedApp(app ?? null);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!isRecording || startedAt === null) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => window.clearInterval(timer);
  }, [isRecording, startedAt]);

  const toggleRecording = useCallback(async () => {
    setError(null);
    if (!isRecording) {
      try {
        const outPath = await invoke<string>("start_meeting_recording", { outputDir: OUTPUT_DIR });
        setPath(outPath);
        setStartedAt(Date.now());
        setElapsed(0);
        setIsRecording(true);
      } catch (err) {
        setError(String(err ?? "Could not start recording"));
      }
      return;
    }
    try {
      const ok = await invoke<boolean>("stop_meeting_recording", {});
      setIsRecording(false);
      if (ok && path && startedAt !== null) {
        const meeting: RecentMeeting = {
          id: `meet-${startedAt}`,
          path,
          startedAt,
          durationMs: Date.now() - startedAt,
          app: detectedApp,
        };
        setRecent((prev) => {
          const next = [...prev, meeting];
          saveRecent(next);
          return next;
        });
        setSelectedId(meeting.id);
      }
      setPath(null);
      setStartedAt(null);
      setElapsed(0);
    } catch (err) {
      setError(String(err ?? "Could not stop recording"));
    }
  }, [isRecording, path, startedAt, detectedApp]);

  const transcribe = useCallback(async (meeting: RecentMeeting) => {
    setTranscribing(true);
    setError(null);
    try {
      const text = await runTranscribe(meeting.path);
      setRecent((prev) => {
        const next = prev.map((m) => (m.id === meeting.id ? { ...m, transcript: text } : m));
        saveRecent(next);
        return next;
      });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setTranscribing(false);
    }
  }, []);

  const selected = recent.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex flex-col" style={{ padding: 16, gap: 16 }}>
      <RecordControl
        isRecording={isRecording}
        audioAvailable={audioAvailable}
        detectedApp={detectedApp}
        elapsed={elapsed}
        samples={samples}
        onToggle={toggleRecording}
      />
      {error && (
        <p role="alert" style={{ fontSize: 12, color: color("error"), margin: 0 }}>{error}</p>
      )}
      <RecentList items={recent} selectedId={selectedId} onSelect={setSelectedId} />
      {selected && (
        <TranscriptView meeting={selected} transcribing={transcribing} onTranscribe={() => transcribe(selected)} />
      )}
    </div>
  );
}
