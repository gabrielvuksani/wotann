/**
 * Hardware capability detector — V9 Tier 6 T6.1.
 *
 * Powers the onboarding wizard's "tier" display so WOTANN can recommend
 * a provider strategy that matches what the machine can actually run:
 *   cloud-only → the device is too constrained for ANY local model
 *                → recommend subscriptions or free-tier cloud APIs.
 *   low        → small local models (≤3B params) feasible; one 7B-Q4
 *                model in RAM if no IDE is open.
 *   medium     → 7B-13B models at Q4-Q6; comfortable Q4 8B streaming.
 *   high       → 13B-27B models at Q4; 7B models streaming at high
 *                throughput.
 *   extreme    → 27B+ models at Q6 or 70B at Q4; multiple concurrent
 *                inference jobs feasible.
 *
 * This module has ZERO external dependencies — it reads `node:os`
 * primitives (cpus, totalmem, platform) and a best-effort
 * `darwin`/`linux` accelerator probe via `execFile`. The goal is a
 * quick decision for the onboarding wizard, not a perfect
 * benchmark — deep GPU profiling belongs in a later tier if needed.
 *
 * WOTANN quality bars:
 *  - QB #6 honest failures: every probe wraps try/catch and returns a
 *    neutral "unknown" when it can't answer. No fabricated GPU info.
 *  - QB #7 per-call state: no module-level caches; results are cheap
 *    to recompute and the user's hardware could change across boots
 *    (external GPU plugged in, RAM stick swapped). Callers that need
 *    memoization own it.
 *  - QB #13 env guard: pass-through `HardwareEnv` snapshot instead of
 *    reading `process.*` directly — tests inject a stub.
 */

import { execFileSync } from "node:child_process";
import { cpus, platform, totalmem } from "node:os";

// ── Types ─────────────────────────────────────────────────────────────────

export type HardwareTier = "cloud-only" | "low" | "medium" | "high" | "extreme";

export type HardwarePlatform = "darwin" | "linux" | "win32" | "other";

export interface HardwareAccelerator {
  /** "apple-silicon" for M1/M2/M3/M4, "nvidia" when we detect CUDA, etc. */
  readonly kind: "apple-silicon" | "nvidia" | "amd" | "intel-arc" | "cpu-only";
  /** Short human-readable label (`"M3 Pro"`, `"RTX 4090"`, `"CPU only"`). */
  readonly label: string;
  /**
   * Approximate VRAM in GB when known. For Apple Silicon this is the
   * unified-memory total since the GPU and CPU share the RAM pool.
   * `null` when the probe couldn't confirm a number.
   */
  readonly vramGb: number | null;
}

export interface HardwareProfile {
  readonly tier: HardwareTier;
  readonly platform: HardwarePlatform;
  /** Logical cores including hyperthreading. */
  readonly cpuCount: number;
  /** CPU model string as reported by `node:os` (best-effort). */
  readonly cpuModel: string;
  /** System RAM in GB, rounded to one decimal. */
  readonly ramGb: number;
  readonly accelerator: HardwareAccelerator;
  /**
   * Reasoning the tier decision followed — human-readable. Exposed so
   * the onboarding wizard can show "We picked HIGH because you have
   * 36 GB RAM + M3 Pro" rather than a mystery label.
   */
  readonly tierReason: string;
}

/**
 * Environment snapshot. Callers pass `currentEnv()` in production;
 * tests pass a fixture so detection is deterministic.
 */
export interface HardwareEnv {
  readonly cpus: ReturnType<typeof cpus>;
  readonly totalmem: number;
  readonly platform: NodeJS.Platform;
  readonly execFile: (cmd: string, args: readonly string[]) => string | null;
}

/**
 * Real-system env — what a production runtime sees. Uses a short
 * timeout on execFile so a hung system utility can't block
 * onboarding.
 */
export function currentEnv(): HardwareEnv {
  return {
    cpus: cpus(),
    totalmem: totalmem(),
    platform: platform(),
    execFile: (cmd, args) => {
      try {
        return execFileSync(cmd, [...args], {
          stdio: "pipe",
          timeout: 2_000,
          encoding: "utf-8",
        });
      } catch {
        return null;
      }
    },
  };
}

// ── Tier classification ───────────────────────────────────────────────────

/**
 * Map (ramGb, accelerator, cpuCount) → tier. The thresholds come from
 * empirical "what can I run?" data points for Llama/Qwen/Mistral GGUF
 * ports at Q4-Q6. The extreme tier matches what a Mac Studio / 4090
 * workstation can stream comfortably.
 *
 * Rationale for "cloud-only":
 *  - <4 GB RAM total OR <2 cores → not enough headroom for OS + model
 *    concurrent. Even 1B quantized models fight the kernel for RAM.
 */
function classifyTier(
  ramGb: number,
  accelerator: HardwareAccelerator,
  cpuCount: number,
): { tier: HardwareTier; reason: string } {
  if (ramGb < 4 || cpuCount < 2) {
    return {
      tier: "cloud-only",
      reason: `${ramGb} GB RAM and ${cpuCount} cores is too tight for any local model — cloud providers recommended.`,
    };
  }

  // Apple Silicon: unified memory means RAM doubles as VRAM, so the
  // effective budget is higher than a same-RAM x86+discrete-GPU setup.
  const effectiveGb =
    accelerator.kind === "apple-silicon" && accelerator.vramGb !== null
      ? Math.max(ramGb, accelerator.vramGb)
      : ramGb + (accelerator.vramGb ?? 0) * 0.75;

  if (effectiveGb >= 48) {
    return {
      tier: "extreme",
      reason: `${ramGb} GB RAM + ${accelerator.label}: can run 27B+ at Q6 or 70B at Q4.`,
    };
  }
  if (effectiveGb >= 24) {
    return {
      tier: "high",
      reason: `${ramGb} GB RAM + ${accelerator.label}: can run 13-27B at Q4 comfortably.`,
    };
  }
  if (effectiveGb >= 12) {
    return {
      tier: "medium",
      reason: `${ramGb} GB RAM + ${accelerator.label}: 7-13B at Q4-Q6 feasible.`,
    };
  }
  return {
    tier: "low",
    reason: `${ramGb} GB RAM + ${accelerator.label}: small models (≤3B) recommended.`,
  };
}

// ── Accelerator probes ────────────────────────────────────────────────────

function probeAccelerator(env: HardwareEnv): HardwareAccelerator {
  const cpuModel = env.cpus[0]?.model ?? "unknown CPU";

  if (env.platform === "darwin") {
    // Apple Silicon: `sysctl -n machdep.cpu.brand_string` returns
    // "Apple M3 Pro" / "Apple M2 Max" etc. Unified memory means the
    // GPU pool is the same as totalmem — report that as vram.
    const brand = env.execFile("sysctl", ["-n", "machdep.cpu.brand_string"])?.trim() ?? "";
    if (brand.startsWith("Apple M")) {
      const label = brand.replace(/^Apple /, "");
      return {
        kind: "apple-silicon",
        label,
        vramGb: Math.round((env.totalmem / 1_073_741_824) * 10) / 10,
      };
    }
    // Intel Mac — no discrete GPU worth probing cheaply, fall through
    // to CPU-only.
    return { kind: "cpu-only", label: `${cpuModel} (Intel Mac)`, vramGb: null };
  }

  if (env.platform === "linux") {
    // `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`
    // returns a number in MB. When the tool isn't installed or errors,
    // fall through to CPU-only. Per QB #6, never invent VRAM data.
    const vramMb = env.execFile("nvidia-smi", [
      "--query-gpu=memory.total",
      "--format=csv,noheader,nounits",
    ]);
    if (vramMb !== null) {
      const first = vramMb.trim().split(/\r?\n/)[0] ?? "";
      const asNumber = Number(first);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        const name =
          env.execFile("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"])?.trim() ??
          "NVIDIA GPU";
        return {
          kind: "nvidia",
          label: name.split(/\r?\n/)[0] ?? "NVIDIA GPU",
          vramGb: Math.round((asNumber / 1024) * 10) / 10,
        };
      }
    }
    // rocm-smi probe for AMD could go here — skipped for now to keep
    // the detector under the V9 T6.1 220-LOC budget.
    return { kind: "cpu-only", label: cpuModel, vramGb: null };
  }

  // Windows + other platforms: CPU-only for now. A win32 NVML probe
  // would need additional platform branches; T6.1 explicitly targets
  // the onboarding floor.
  return { kind: "cpu-only", label: cpuModel, vramGb: null };
}

// ── Public API ────────────────────────────────────────────────────────────

export function mapPlatform(p: NodeJS.Platform): HardwarePlatform {
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

/**
 * Build a `HardwareProfile` from the provided env snapshot. Separating
 * env from detection keeps the function pure for testability — tests
 * pass a fixture and assert the tier mapping without touching the
 * real system.
 */
export function detectHardware(env: HardwareEnv = currentEnv()): HardwareProfile {
  const cpuCount = env.cpus.length;
  const cpuModel = env.cpus[0]?.model ?? "unknown CPU";
  const ramGb = Math.round((env.totalmem / 1_073_741_824) * 10) / 10;
  const accelerator = probeAccelerator(env);
  const { tier, reason } = classifyTier(ramGb, accelerator, cpuCount);

  return {
    tier,
    platform: mapPlatform(env.platform),
    cpuCount,
    cpuModel,
    ramGb,
    accelerator,
    tierReason: reason,
  };
}
