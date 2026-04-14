/**
 * Live mic-based waveform SVG + sampling hook.
 * Used by AudioCapturePanel to visualize recording activity.
 */

import { useState, useEffect, useRef } from "react";

/**
 * Keeps a rolling window of RMS amplitude samples from the microphone.
 * Stops cleanly when `active` flips false. Pure visualization — the actual
 * recording is handled server-side by the Tauri subprocess.
 */
export function useMicSamples(active: boolean, sampleCount = 64): readonly number[] {
  const [samples, setSamples] = useState<readonly number[]>(() => Array(sampleCount).fill(0));
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current = null;
      streamRef.current = null;
      setSamples(Array(sampleCount).fill(0));
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const AudioContextCtor = window.AudioContext
          || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextCtor();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        const buffer = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = (buffer[i]! - 128) / 128;
            sum += v * v;
          }
          const rms = Math.min(1, Math.sqrt(sum / buffer.length) * 2.5);
          setSamples((prev) => {
            const next = prev.slice(1);
            return [...next, rms];
          });
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        /* Mic denied — waveform stays flat */
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current = null;
      streamRef.current = null;
    };
  }, [active, sampleCount]);

  return samples;
}

export function WaveformSVG({ samples, active }: { readonly samples: readonly number[]; readonly active: boolean }) {
  const width = 300;
  const height = 60;
  const mid = height / 2;
  const step = width / Math.max(samples.length - 1, 1);
  const path = samples
    .map((s, i) => {
      const x = i * step;
      const y = mid - s * (mid - 4);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const mirrorPath = samples
    .map((s, i) => {
      const x = i * step;
      const y = mid + s * (mid - 4);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
      aria-label="Audio waveform"
    >
      <line x1={0} x2={width} y1={mid} y2={mid} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      <path d={path} fill="none" stroke={active ? "#0A84FF" : "rgba(255,255,255,0.2)"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={mirrorPath} fill="none" stroke={active ? "#0A84FF" : "rgba(255,255,255,0.1)"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
