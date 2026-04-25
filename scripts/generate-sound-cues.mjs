#!/usr/bin/env node
/**
 * V9 §T14.4 — Norse sound-cue WAV generator.
 *
 * Generates the four bundled WAV cues that mirror the iOS-side
 * `NorseSoundCues.swift` programmatic synthesis. The iOS layer
 * already runs DSP at runtime; this script ships the equivalent
 * binaries to `assets/sounds/` so non-iOS surfaces (desktop,
 * automation, future Android) can drop the assets in directly.
 *
 * Cues:
 *   rune-tap.wav     ~30ms square @ 1.2kHz (action commit)
 *   well-hum.wav    ~150ms 110/165Hz pad (memory recall)
 *   wax-seal.wav   ~120ms 60Hz body + noise burst (approval signed)
 *   wood-knock.wav  ~80ms RBJ bandpass @ 800Hz (notification)
 *
 * Format: 44.1kHz, 16-bit signed PCM, mono. Matches iOS so the
 * cross-platform user hears the same timbre on every surface.
 *
 * Determinism: noise sources use SplitMix64 with the same seed
 * (0x57_4F_54_41_4E_4E_00_01) the Swift implementation uses, so
 * the resulting WAV is byte-for-byte stable across runs.
 *
 * Usage:
 *   node scripts/generate-sound-cues.mjs
 *   node scripts/generate-sound-cues.mjs --out-dir=path/to/sounds
 *   node scripts/generate-sound-cues.mjs --check-only
 *
 * Flags:
 *   --out-dir=PATH   Override destination (default: <repo>/assets/sounds)
 *   --check-only     Render in memory + validate; don't write to disk.
 *   -h, --help       Show this message.
 *
 * Exit codes:
 *   0 success, 1 invalid flag, 2 write failure, 3 validation failure.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, stdout, stderr, exit } from "node:process";

// ── Constants (match NorseSoundCues.swift) ─────────────

const SAMPLE_RATE = 44_100;
const BIT_DEPTH = 16;
const CHANNELS = 1;

/** SplitMix64 seed — same constant as `NorseSoundCues.noiseSeed`. */
const NOISE_SEED = 0x574f54414e4e0001n; // "WOTANN" + 1

/** Wax-seal uses the same seed as rune-tap; wood-knock derives. */
const WAX_SEAL_SEED = NOISE_SEED;
const WOOD_KNOCK_SEED = NOISE_SEED + 0x9e3779b97f4a7c15n;

// ── CLI parsing ───────────────────────────────────────

function parseArgs(args) {
  const opts = {
    outDir: null,
    checkOnly: false,
    help: false,
  };
  for (const arg of args) {
    if (arg === "--check-only") opts.checkOnly = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--out-dir=")) opts.outDir = arg.slice("--out-dir=".length);
    else {
      stderr.write(`Unknown flag: ${arg}\n`);
      exit(1);
    }
  }
  return opts;
}

const USAGE = `
Norse sound-cue WAV generator (V9 §T14.4)

Renders the four bundled cues to assets/sounds/ as 44.1kHz 16-bit
mono PCM WAV files. Synthesis matches ios/.../NorseSoundCues.swift.

USAGE:
  node scripts/generate-sound-cues.mjs [flags]

FLAGS:
  --out-dir=PATH    Override destination (default: <repo>/assets/sounds)
  --check-only      Validate in memory; don't write files
  -h, --help        Show this message
`.trimStart();

// ── SplitMix64 (matches NorseSoundCues.SplitMix64) ─────

/**
 * Same algorithm as the Swift `SplitMix64` struct. State updates use
 * 64-bit wrap-around; we use BigInt for the 64-bit math so JavaScript
 * doesn't lose precision (Number is safe to 2^53). The output is then
 * folded down to a Float-sized [-1, 1) sample.
 */
class SplitMix64 {
  constructor(seed) {
    this.state = BigInt.asUintN(64, BigInt(seed));
  }

  /** Returns a uniform UInt64 (BigInt). */
  nextUInt64() {
    this.state = BigInt.asUintN(64, this.state + 0x9e3779b97f4a7c15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return z ^ (z >> 31n);
  }

  /**
   * Uniform sample in [-1, 1). Matches the Swift `nextUnit()`:
   *   raw = Float(nextUInt64() >> 40) / Float(1 << 24)  // [0, 1)
   *   return raw * 2 - 1
   */
  nextUnit() {
    const top24 = Number(this.nextUInt64() >> 40n); // 0..(2^24 - 1)
    const raw = top24 / (1 << 24); // [0, 1)
    return raw * 2 - 1;
  }
}

// ── WAV writer ─────────────────────────────────────────

/**
 * Encode a Float32Array of [-1, 1] samples to a 16-bit PCM WAV
 * Buffer. Header layout follows the canonical RIFF spec — see
 * http://soundfile.sapp.org/doc/WaveFormat/.
 *
 * Returns a Node Buffer ready to write.
 */
function encodeWav(floatSamples) {
  const dataBytes = floatSamples.length * 2; // 16-bit PCM mono
  const buffer = Buffer.alloc(44 + dataBytes);

  // RIFF header
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");

  // fmt chunk
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // chunk size = 16 (PCM)
  buffer.writeUInt16LE(1, 20); // audio format = 1 (PCM)
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE((SAMPLE_RATE * CHANNELS * BIT_DEPTH) / 8, 28); // byte rate
  buffer.writeUInt16LE((CHANNELS * BIT_DEPTH) / 8, 32); // block align
  buffer.writeUInt16LE(BIT_DEPTH, 34);

  // data chunk
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < floatSamples.length; i += 1) {
    // Clamp to [-1, 1) then scale to signed 16-bit. We use 32767
    // so 1.0 maps to the highest legal positive sample; -1.0 maps
    // to -32768. The clamp prevents wrap-around from arithmetic.
    let s = floatSamples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    const pcm = Math.round(s * 32767);
    buffer.writeInt16LE(pcm, offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Read back a WAV header to verify it parses + the duration matches
 * what we expect. Honest stub: returns { ok, reason } so the caller
 * can fail loudly without throwing.
 */
function validateWavHeader(buffer, expectedSamples) {
  if (buffer.length < 44) {
    return { ok: false, reason: `header too short (${buffer.length} bytes)` };
  }
  const riff = buffer.toString("ascii", 0, 4);
  if (riff !== "RIFF") return { ok: false, reason: `RIFF magic missing (got "${riff}")` };
  const wave = buffer.toString("ascii", 8, 12);
  if (wave !== "WAVE") return { ok: false, reason: `WAVE magic missing (got "${wave}")` };
  const fmt = buffer.toString("ascii", 12, 16);
  if (fmt !== "fmt ") return { ok: false, reason: `fmt magic missing (got "${fmt}")` };
  const audioFormat = buffer.readUInt16LE(20);
  if (audioFormat !== 1) return { ok: false, reason: `audioFormat ${audioFormat} != 1 (PCM)` };
  const channels = buffer.readUInt16LE(22);
  if (channels !== CHANNELS) return { ok: false, reason: `channels ${channels} != ${CHANNELS}` };
  const sampleRate = buffer.readUInt32LE(24);
  if (sampleRate !== SAMPLE_RATE) {
    return { ok: false, reason: `sampleRate ${sampleRate} != ${SAMPLE_RATE}` };
  }
  const bps = buffer.readUInt16LE(34);
  if (bps !== BIT_DEPTH) return { ok: false, reason: `bitsPerSample ${bps} != ${BIT_DEPTH}` };
  const data = buffer.toString("ascii", 36, 40);
  if (data !== "data") return { ok: false, reason: `data magic missing (got "${data}")` };
  const dataBytes = buffer.readUInt32LE(40);
  const observedSamples = dataBytes / 2;
  if (observedSamples !== expectedSamples) {
    return {
      ok: false,
      reason: `data length ${observedSamples} samples != expected ${expectedSamples}`,
    };
  }
  return { ok: true, reason: "" };
}

// ── Synthesis: rune-tap (matches renderRuneTap()) ──────

/**
 * 30ms total. 5ms attack, 25ms release. Square wave via sign(sin).
 * Gain 0.30, frequency 1.2kHz.
 */
function synthRuneTap() {
  const durationSeconds = 0.03;
  const frequency = 1_200;
  const totalSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const attackSamples = Math.floor(SAMPLE_RATE * 0.005);
  const releaseSamples = Math.max(totalSamples - attackSamples, 1);

  const out = new Float32Array(totalSamples);
  const twoPi = 2 * Math.PI;
  const phaseStep = twoPi * frequency * (1 / SAMPLE_RATE);
  let phase = 0;

  for (let i = 0; i < totalSamples; i += 1) {
    let envelope;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else {
      const releaseIdx = i - attackSamples;
      envelope = Math.max(0, 1 - releaseIdx / releaseSamples);
    }
    const s = Math.sin(phase) >= 0 ? 1.0 : -1.0;
    out[i] = s * envelope * 0.3;
    phase += phaseStep;
    if (phase >= twoPi) phase -= twoPi;
  }
  return out;
}

// ── Synthesis: well-hum (matches renderWellHum()) ──────

/**
 * 150ms total. 30ms attack / 80ms sustain / 40ms release. Two
 * sines (110Hz weight 0.55 + 165Hz weight 0.45). Gain 0.32.
 */
function synthWellHum() {
  const durationSeconds = 0.15;
  const f1 = 110; // A2
  const f2 = 165; // perfect fifth above
  const totalSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const attackSamples = Math.floor(SAMPLE_RATE * 0.03);
  const releaseSamples = Math.floor(SAMPLE_RATE * 0.04);
  const sustainSamples = Math.max(totalSamples - attackSamples - releaseSamples, 1);

  const out = new Float32Array(totalSamples);
  const twoPi = 2 * Math.PI;
  const invSample = 1 / SAMPLE_RATE;
  const step1 = twoPi * f1 * invSample;
  const step2 = twoPi * f2 * invSample;
  let p1 = 0;
  let p2 = 0;

  for (let i = 0; i < totalSamples; i += 1) {
    let envelope;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else if (i >= attackSamples + sustainSamples) {
      const releaseIdx = i - (attackSamples + sustainSamples);
      envelope = Math.max(0, 1 - releaseIdx / releaseSamples);
    } else {
      envelope = 1;
    }
    const s = Math.sin(p1) * 0.55 + Math.sin(p2) * 0.45;
    out[i] = s * envelope * 0.32;
    p1 += step1;
    p2 += step2;
    if (p1 >= twoPi) p1 -= twoPi;
    if (p2 >= twoPi) p2 -= twoPi;
  }
  return out;
}

// ── Synthesis: wax-seal (matches renderWaxSeal()) ──────

/**
 * 120ms total. 2ms attack, body envelope = exp(-3·t) over the
 * release window. 18ms head noise burst. Body sine 60Hz at gain
 * 0.55; noise gain 0.25.
 */
function synthWaxSeal() {
  const durationSeconds = 0.12;
  const bodyFreq = 60;
  const totalSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const attackSamples = Math.floor(SAMPLE_RATE * 0.002);
  const noiseSamples = Math.floor(SAMPLE_RATE * 0.018);
  const releaseSamples = Math.max(totalSamples - attackSamples, 1);

  const out = new Float32Array(totalSamples);
  const twoPi = 2 * Math.PI;
  const phaseStep = twoPi * bodyFreq * (1 / SAMPLE_RATE);
  let phase = 0;
  const rng = new SplitMix64(WAX_SEAL_SEED);

  for (let i = 0; i < totalSamples; i += 1) {
    let bodyEnv;
    if (i < attackSamples) {
      bodyEnv = i / attackSamples;
    } else {
      const releaseIdx = i - attackSamples;
      const t = releaseIdx / releaseSamples;
      bodyEnv = Math.exp(-3.0 * t);
    }

    let noiseEnv;
    if (i < noiseSamples) {
      noiseEnv = 1 - i / noiseSamples;
    } else {
      noiseEnv = 0;
    }

    const body = Math.sin(phase) * bodyEnv * 0.55;
    const noise = rng.nextUnit() * noiseEnv * 0.25;
    out[i] = body + noise;

    phase += phaseStep;
    if (phase >= twoPi) phase -= twoPi;
  }
  return out;
}

// ── Synthesis: wood-knock (matches renderWoodKnock()) ──

/**
 * 80ms total. 2ms attack, exp(-5·t) decay. RBJ bandpass biquad
 * centred at 800Hz, Q≈4. Output multiplied by 4 to compensate the
 * bandpass attenuation.
 */
function synthWoodKnock() {
  const durationSeconds = 0.08;
  const totalSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const attackSamples = Math.floor(SAMPLE_RATE * 0.002);
  const releaseSamples = Math.max(totalSamples - attackSamples, 1);

  // Same biquad coefficients as NorseSoundCues.swift.
  const b0 = 0.0271;
  const b1 = 0.0;
  const b2 = -0.0271;
  const a1 = -1.9407;
  const a2 = 0.9457;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  const out = new Float32Array(totalSamples);
  const rng = new SplitMix64(WOOD_KNOCK_SEED);

  for (let i = 0; i < totalSamples; i += 1) {
    let envelope;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else {
      const releaseIdx = i - attackSamples;
      const t = releaseIdx / releaseSamples;
      envelope = Math.exp(-5.0 * t);
    }
    const noise = rng.nextUnit();
    const y = b0 * noise + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = noise;
    y2 = y1;
    y1 = y;

    out[i] = y * envelope * 4.0;
  }
  return out;
}

// ── Cue catalogue ──────────────────────────────────────

/**
 * Each cue: a {file, durationSec, render} triple. The file name is
 * the human-readable kebab-case label.
 */
const CUES = [
  { file: "rune-tap.wav", durationSec: 0.03, render: synthRuneTap },
  { file: "well-hum.wav", durationSec: 0.15, render: synthWellHum },
  { file: "wax-seal.wav", durationSec: 0.12, render: synthWaxSeal },
  { file: "wood-knock.wav", durationSec: 0.08, render: synthWoodKnock },
];

// ── Main ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "assets", "sounds");

async function main() {
  const args = argv.slice(2);
  const opts = parseArgs(args);
  if (opts.help) {
    stdout.write(USAGE);
    exit(0);
  }

  const outDir = opts.outDir ? resolve(opts.outDir) : DEFAULT_OUT_DIR;

  stdout.write(
    `\n[generate-sound-cues] V9 §T14.4 — rendering ${CUES.length} cues\n` +
      `[generate-sound-cues] outDir=${outDir}\n` +
      `[generate-sound-cues] checkOnly=${opts.checkOnly}\n\n`,
  );

  if (!opts.checkOnly) {
    try {
      await mkdir(outDir, { recursive: true });
    } catch (err) {
      stderr.write(
        `[generate-sound-cues] mkdir failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    }
  }

  const summary = [];
  let allOk = true;
  for (const cue of CUES) {
    const samples = cue.render();
    const expectedSamples = Math.floor(SAMPLE_RATE * cue.durationSec);
    if (samples.length !== expectedSamples) {
      stderr.write(
        `[generate-sound-cues] ${cue.file}: render returned ${samples.length} samples, ` +
          `expected ${expectedSamples}\n`,
      );
      allOk = false;
      continue;
    }

    const wav = encodeWav(samples);
    const validation = validateWavHeader(wav, expectedSamples);
    if (!validation.ok) {
      stderr.write(`[generate-sound-cues] ${cue.file}: header invalid — ${validation.reason}\n`);
      allOk = false;
      continue;
    }

    if (!opts.checkOnly) {
      const target = join(outDir, cue.file);
      try {
        await writeFile(target, wav);
      } catch (err) {
        stderr.write(
          `[generate-sound-cues] ${cue.file}: write failed — ${err instanceof Error ? err.message : String(err)}\n`,
        );
        allOk = false;
        continue;
      }
    }

    summary.push({
      file: cue.file,
      bytes: wav.length,
      durationMs: Math.round(cue.durationSec * 1000),
      samples: samples.length,
    });
    stdout.write(
      `[generate-sound-cues] ${cue.file}: ${wav.length} bytes ` +
        `(${samples.length} samples, ${Math.round(cue.durationSec * 1000)} ms)\n`,
    );
  }

  if (!allOk) {
    stderr.write(`\n[generate-sound-cues] one or more cues failed.\n`);
    exit(3);
  }

  stdout.write(
    `\n[generate-sound-cues] OK — ${summary.length} cue${summary.length === 1 ? "" : "s"} ` +
      `${opts.checkOnly ? "validated (in-memory)" : `written to ${outDir}`}\n`,
  );
  exit(0);
}

main().catch((err) => {
  stderr.write(
    `\n[generate-sound-cues] FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  exit(3);
});
