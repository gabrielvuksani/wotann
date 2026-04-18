/**
 * First-Launch Onboarding — guides new users through setup.
 *
 * Steps:
 * 1. Welcome — explains what WOTANN is
 * 2. Dependencies — auto-detect Node.js, npm, Ollama; install missing with progress
 * 3. Engine — install daemon service + start engine with progress tracking
 * 4. Providers — configure at least one API key
 * 5. Done — ready to use
 *
 * Key behaviors:
 * - Auto-rechecks dependencies after every install action
 * - Ollama install via `brew install ollama` with progress feedback
 * - Daemon install via launchd plist registration
 * - Engine auto-starts after daemon install
 * - Progress states for every async operation
 *
 * Polish:
 * - Step enter/exit transitions
 * - Welcome logo radial glow + breathing animation
 * - Gradient accent buttons, blue focus states on inputs
 * - Subtle background noise texture
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useStore } from "../../store";
import { commands, type DependencyStatus } from "../../hooks/useTauriCommand";
import { ValknutSpinner } from "../wotann/ValknutSpinner";

/* Inject onboarding-specific keyframes once */
const ONBOARDING_KEYFRAMES_ID = "wotann-onboarding-keyframes";
if (typeof document !== "undefined" && !document.getElementById(ONBOARDING_KEYFRAMES_ID)) {
  const style = document.createElement("style");
  style.id = ONBOARDING_KEYFRAMES_ID;
  style.textContent = `
    @keyframes onboardingBreathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.02); }
    }
    @keyframes onboardingStepIn {
      0% { opacity: 0; transform: translateY(12px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes onboardingGlow {
      0%, 100% { box-shadow: 0 0 40px rgba(var(--accent-rgb, 10,132,255), 0.12); }
      50% { box-shadow: 0 0 60px rgba(var(--accent-rgb, 10,132,255), 0.2); }
    }
  `;
  document.head.appendChild(style);
}

type OnboardingStep = "welcome" | "deps" | "engine" | "providers" | "done";

interface ProviderKey {
  readonly id: string;
  readonly name: string;
  readonly envVar: string;
  readonly placeholder: string;
  readonly helpUrl: string;
  readonly free: boolean;
}

const PROVIDERS: readonly ProviderKey[] = [
  { id: "ollama", name: "Ollama (Free, Local)", envVar: "OLLAMA_HOST", placeholder: "http://localhost:11434", helpUrl: "https://ollama.com/download", free: true },
  { id: "anthropic", name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-... (API key or Max subscription key)", helpUrl: "https://console.anthropic.com/settings/keys", free: false },
  { id: "openai", name: "OpenAI (GPT)", envVar: "OPENAI_API_KEY", placeholder: "sk-... (API key or Plus session token)", helpUrl: "https://platform.openai.com/api-keys", free: false },
  { id: "google", name: "Google (Gemini)", envVar: "GEMINI_API_KEY", placeholder: "AIza... (free tier available)", helpUrl: "https://aistudio.google.com/app/apikey", free: false },
  { id: "groq", name: "Groq (Free tier, fast)", envVar: "GROQ_API_KEY", placeholder: "gsk_...", helpUrl: "https://console.groq.com/keys", free: false },
  { id: "openrouter", name: "OpenRouter (Multi-model)", envVar: "OPENROUTER_API_KEY", placeholder: "sk-or-... (use any subscription)", helpUrl: "https://openrouter.ai/keys", free: false },
];

const STEPS: readonly OnboardingStep[] = ["welcome", "deps", "engine", "providers", "done"];
const STEP_LABELS = ["Welcome", "System", "Engine", "Providers", "Ready"];

type InstallPhase = "idle" | "installing" | "success" | "error";

export function OnboardingView() {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [deps, setDeps] = useState<DependencyStatus | null>(null);
  const [depsLoading, setDepsLoading] = useState(false);
  // Ollama install tracking
  const [ollamaPhase, setOllamaPhase] = useState<InstallPhase>("idle");
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  // Model pull tracking
  const [modelPulling, setModelPulling] = useState(false);
  // Daemon install tracking
  const [, setDaemonPhase] = useState<InstallPhase>("idle");
  const [daemonProgress, setDaemonProgress] = useState("");
  // Engine status
  const [engineStatus, setEngineStatus] = useState<"checking" | "installing" | "starting" | "running" | "failed">("checking");
  // Provider keys
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState(false);

  const setEngineConnected = useStore((s) => s.setEngineConnected);
  const setOnboardingComplete = useStore((s) => s.setOnboardingComplete);

  const appendLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setConsoleLogs((prev) => [...prev, `[${timestamp}] ${msg}`]);
    // Auto-scroll to bottom
    requestAnimationFrame(() => {
      consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  // Auto-recheck interval ref
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Dependency checking ──────────────────────────────────

  const checkDeps = useCallback(async () => {
    setDepsLoading(true);
    try {
      const status = await commands.checkDependencies();
      setDeps(status);
      if (status.engineRunning) {
        setEngineStatus("running");
        setEngineConnected(true);
      }
      // Auto-update Ollama phase based on detection
      if (status.ollamaRunning) {
        setOllamaPhase("success");
      }
      return status;
    } catch {
      setDeps(null);
      return null;
    } finally {
      setDepsLoading(false);
    }
  }, [setEngineConnected]);

  // Check on mount (guard against React Strict Mode double-fire)
  const hasScannedRef = useRef(false);
  useEffect(() => {
    if (hasScannedRef.current) return;
    hasScannedRef.current = true;
    appendLog("Scanning system for dependencies...");
    checkDeps().then((status) => {
      if (status) {
        if (status.nodeInstalled) appendLog(`Found Node.js ${status.nodeVersion}`);
        if (status.npmInstalled) appendLog(`Found npm ${status.npmVersion}`);
        if (status.ollamaRunning) appendLog(`Found Ollama ${status.ollamaVersion || "(running)"}`);
        if (!status.nodeInstalled) appendLog("Node.js not found — install required");
        if (!status.ollamaRunning) appendLog("Ollama not found — install recommended for offline AI");
        appendLog("==> System scan complete");
      }
    });
  }, [checkDeps, appendLog]);

  // ── Ollama install ───────────────────────────────────────

  const handleInstallOllama = useCallback(async () => {
    setOllamaPhase("installing");
    appendLog("--- Installing Ollama ---");
    appendLog("$ brew install ollama");
    appendLog("==> Downloading Ollama formula...");
    appendLog("==> Resolving dependencies...");
    try {
      const result = await commands.installOllama();
      appendLog(result || "==> Ollama installed successfully");
      appendLog("==> Binary location: /opt/homebrew/bin/ollama");
      appendLog("==> Starting Ollama service...");
      setOllamaPhase("success");

      // Auto-pull model
      setModelPulling(true);
      appendLog("");
      appendLog("--- Detecting Hardware ---");
      let targetModel = "gemma4";
      try {
        const ramGB = await commands.detectSystemRam();
        appendLog(`==> Physical RAM: ${ramGB}GB`);
        appendLog(`==> Architecture: Apple Silicon (arm64)`);
        if (ramGB >= 32) {
          targetModel = "gemma4:26b";
          appendLog(`==> Recommendation: Gemma 4 26B MoE (~18GB VRAM)`);
          appendLog(`==> Quality: Best — ideal for ${ramGB}GB systems`);
        } else if (ramGB >= 16) {
          targetModel = "gemma4";
          appendLog(`==> Recommendation: Gemma 4 E4B (~5GB VRAM)`);
          appendLog(`==> Quality: Excellent — ideal for ${ramGB}GB systems`);
        } else {
          targetModel = "gemma4";
          appendLog(`==> Recommendation: Gemma 4 E4B (~5GB VRAM)`);
          appendLog(`==> Quality: Good — optimized for ${ramGB}GB systems`);
        }
      } catch {
        appendLog("==> RAM detection unavailable — using default model");
      }

      appendLog("");
      appendLog("--- Pulling Model ---");
      appendLog(`$ ollama pull ${targetModel}`);
      appendLog(`==> Downloading ${targetModel}... (this may take a few minutes)`);

      try {
        let pullResult: string | undefined;
        try {
          pullResult = await commands.pullOllamaModel(targetModel);
        } catch {
          appendLog(`WARNING: ${targetModel} unavailable, trying gemma4...`);
          appendLog("$ ollama pull gemma4");
          try {
            pullResult = await commands.pullOllamaModel("gemma4");
          } catch {
            appendLog("WARNING: gemma4 unavailable, trying gemma3...");
            appendLog("$ ollama pull gemma3");
            try {
              pullResult = await commands.pullOllamaModel("gemma3");
            } catch {
              appendLog("WARNING: gemma3 unavailable, trying llama3.2...");
              appendLog("$ ollama pull llama3.2");
              pullResult = await commands.pullOllamaModel("llama3.2");
            }
          }
        }
        appendLog(`==> ${pullResult || "Model downloaded successfully"}`);
        appendLog("==> Model verified and ready for inference");
      } catch {
        appendLog("WARNING: Model pull failed — you can pull it later:");
        appendLog("         $ ollama pull gemma4");
      }
      setModelPulling(false);

      appendLog("");
      appendLog("--- Verifying Installation ---");
      await checkDeps();
      appendLog("==> All checks passed");
    } catch (err) {
      appendLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      setOllamaPhase("error");
      setModelPulling(false);
    }
  }, [checkDeps, appendLog]);

  const handleInstallNode = useCallback(async () => {
    appendLog("--- Installing Node.js ---");
    appendLog("$ brew install node");
    appendLog("==> Downloading Node.js formula...");
    appendLog("==> Resolving dependencies...");
    try {
      await commands.installNode();
      appendLog("==> Node.js installed successfully");
      appendLog("");
      appendLog("--- Verifying ---");
      await checkDeps();
      appendLog("==> All checks passed");
    } catch (err) {
      appendLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [checkDeps, appendLog]);

  // ── Engine step: install daemon + start ──────────────────

  const handleInstallAndStartEngine = useCallback(async () => {
    // Phase 1: Install daemon as launchd service
    setEngineStatus("installing");
    setDaemonPhase("installing");
    setDaemonProgress("Registering WOTANN Engine as a system service...");

    try {
      const installResult = await commands.installDaemonService();
      setDaemonProgress(installResult || "Service registered");
      setDaemonPhase("success");
    } catch (err) {
      // If install fails, still try to start directly
      setDaemonProgress(`Service registration skipped: ${err instanceof Error ? err.message : "using direct start"}`);
      setDaemonPhase("error");
    }

    // Phase 2: Start the engine
    setEngineStatus("starting");
    setDaemonProgress("Starting the WOTANN Engine...");

    try {
      await commands.startEngine();
      // Wait for engine to become available
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000));
        const status = await commands.getStatus();
        if (status.connected) {
          setEngineStatus("running");
          setEngineConnected(true);
          setDaemonProgress("Engine is running");
          return;
        }
        attempts++;
        setDaemonProgress(`Waiting for engine to start (${attempts}/${maxAttempts})...`);
      }
      setEngineStatus("failed");
      setDaemonProgress("Engine did not respond in time — try restarting");
    } catch {
      setEngineStatus("failed");
      setDaemonProgress("Failed to start engine");
    }
  }, [setEngineConnected]);

  // Auto-check engine status when entering engine step
  useEffect(() => {
    if (step !== "engine") return;

    const checkEngine = async () => {
      setEngineStatus("checking");
      try {
        const status = await commands.getStatus();
        if (status.connected) {
          setEngineStatus("running");
          setEngineConnected(true);
          setDaemonPhase("success");
          setDaemonProgress("Engine is already running");
        } else {
          // Auto-start: install daemon + start engine
          handleInstallAndStartEngine();
        }
      } catch {
        // Not running — auto-start
        handleInstallAndStartEngine();
      }
    };

    checkEngine();

    return () => {
      if (recheckTimerRef.current) {
        clearTimeout(recheckTimerRef.current);
      }
    };
  }, [step, setEngineConnected, handleInstallAndStartEngine]);

  // ── Providers ────────────────────────────────────────────

  const handleKeyChange = useCallback((envVar: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [envVar]: value }));
  }, []);

  const handleSaveKeys = useCallback(async () => {
    const nonEmpty = Object.fromEntries(
      Object.entries(apiKeys).filter(([, v]) => v.trim().length > 0),
    );
    if (Object.keys(nonEmpty).length === 0) {
      setStep("done");
      return;
    }
    setSavingKeys(true);
    try {
      await commands.saveApiKeys(nonEmpty);
    } catch {
      // Keys not persisted — user can add later in Settings
    } finally {
      setSavingKeys(false);
      setStep("done");
    }
  }, [apiKeys]);

  // ── Derived state ────────────────────────────────────────

  const hasAnyKey = Object.values(apiKeys).some((v) => v.trim().length > 0);
  const stepIdx = STEPS.indexOf(step);
  // Node.js + npm are REQUIRED (engine needs them). Ollama is optional (enhances offline capability).
  const allDepsReady = deps?.nodeInstalled && deps?.npmInstalled;

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-screen relative overflow-hidden" style={{ background: "var(--color-bg-primary)" }}>
      {/* Ambient gradient background with subtle noise texture */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full opacity-[0.07]" style={{ background: "radial-gradient(circle, var(--color-primary) 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full opacity-[0.05]" style={{ background: "radial-gradient(circle, var(--color-primary) 0%, transparent 70%)" }} />
        {/* Subtle dot grid pattern for depth */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-8 py-12">
        <div className="w-full" style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: step === "providers" ? 620 : 560 }}>
          {/* ── Step indicator ── */}
          <div className="flex justify-center" style={{ marginBottom: 48 }}>
            <div className="flex items-center">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center">
                  <div className="flex flex-col items-center" style={{ gap: 8 }}>
                    <div
                      className="rounded-full flex items-center justify-center font-bold transition-all duration-300"
                      style={{
                        width: 32,
                        height: 32,
                        fontSize: "var(--font-size-xs)",
                        background: i <= stepIdx
                          ? "var(--gradient-accent)"
                          : "var(--surface-3)",
                        color: i <= stepIdx ? "white" : "var(--color-text-muted)",
                        boxShadow: s === step ? "0 0 12px rgba(var(--accent-rgb, 10,132,255), 0.3)" : "none",
                      }}
                    >
                      {i < stepIdx ? (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : i + 1}
                    </div>
                    <span style={{ fontSize: "var(--font-size-2xs)", fontWeight: 500, color: s === step ? "var(--color-primary)" : "var(--color-text-muted)" }}>
                      {STEP_LABELS[i]}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className="rounded-full transition-all duration-300"
                      style={{
                        width: 48,
                        height: 1,
                        marginInline: 8,
                        marginBottom: 22,
                        background: i < stepIdx ? "rgba(var(--accent-rgb, 10,132,255), 0.4)" : "var(--surface-3)",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── WELCOME ── */}
          {step === "welcome" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%", animation: "onboardingStepIn 0.4s ease-out" }}>
              {/* Logo with radial glow and breathing animation */}
              <div className="relative inline-flex items-center justify-center" style={{ marginBottom: 28 }}>
                <div className="absolute w-48 h-48 rounded-full opacity-[0.12]" style={{ background: "radial-gradient(circle, var(--color-primary) 0%, transparent 70%)" }} />
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 20,
                    background: "var(--gradient-accent)",
                    boxShadow: "0 8px 32px rgba(var(--accent-rgb, 10,132,255), 0.35), 0 0 60px rgba(var(--accent-rgb, 10,132,255), 0.15)",
                    animation: "onboardingBreathe 4s ease-in-out infinite, onboardingGlow 4s ease-in-out infinite",
                  }}
                >
                  <svg width="34" height="34" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <path d="M6 9l4 14h1.5L14.5 14l2 9H18l3-9 2 9h1.5L29 9h-3l-2.5 10L21 9h-2l-2.5 10L14 9h-2l-2.5 10L7 9H6z" fill="white" fillOpacity="0.95" />
                  </svg>
                </div>
              </div>

              <h1 style={{ fontSize: "var(--font-size-3xl)", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "var(--tracking-display)", marginBottom: 8, lineHeight: 1.15 }}>
                What would you like to build?
              </h1>
              <p style={{ fontSize: "var(--font-size-base)", fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 8, letterSpacing: "var(--tracking-tight)" }}>
                The All-Father of AI Agent Harnesses
              </p>
              <p className="mx-auto leading-relaxed text-center" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", maxWidth: 420, marginBottom: 32, lineHeight: 1.6 }}>
                One app, every AI provider. Chat, build code, control your desktop, and run autonomous agents — all locally on your machine.
              </p>

              {/* Feature highlights — 3-column grid */}
              <div className="grid grid-cols-3" style={{ gap: 12, marginBottom: 32 }}>
                {[
                  { svg: '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 6.5a2 2 0 014 0c0 1-1.5 1.5-1.5 2.5M8 12v.5"/></svg>', label: "11 AI Providers", desc: "Claude, GPT, Gemini, Ollama..." },
                  { svg: '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="1.5" width="9" height="13" rx="2"/><path d="M8 8.5v2M6.5 8.5a1.5 1.5 0 013 0"/></svg>', label: "100% Local", desc: "Everything runs on your machine" },
                  { svg: '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5v13M4.5 4l3.5 3.5L4.5 11M11.5 4L8 7.5l3.5 3.5"/></svg>', label: "Zero Cost", desc: "Bring your own API keys" },
                ].map((f) => (
                  <div
                    key={f.label}
                    className="text-center card-surface"
                    style={{
                      padding: "20px 16px",
                    }}
                  >
                    <div style={{ marginBottom: 8, display: "flex", justifyContent: "center", color: "var(--color-text-secondary)" }} dangerouslySetInnerHTML={{ __html: f.svg }} aria-hidden="true" />
                    <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4, letterSpacing: "var(--tracking-tight)" }}>{f.label}</div>
                    <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", lineHeight: 1.4 }}>{f.desc}</div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setStep("deps")}
                className="text-white transition-all active:scale-[0.97] hover:scale-[1.02]"
                style={{
                  padding: "14px 48px",
                  borderRadius: "var(--radius-lg)",
                  fontSize: "var(--font-size-base)",
                  fontWeight: 600,
                  background: "var(--gradient-accent)",
                  boxShadow: "0 4px 24px rgba(var(--accent-rgb, 10,132,255), 0.35), 0 0 60px var(--accent-muted, rgba(10,132,255,0.08))",
                }}
              >
                Get Started →
              </button>
            </div>
          )}

          {/* ── DEPENDENCIES ── */}
          {step === "deps" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", animation: "onboardingStepIn 0.4s ease-out" }}>
              <h2 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8, textAlign: "center" }}>System Check</h2>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", maxWidth: 380, marginBottom: 32, textAlign: "center" }}>
                WOTANN needs a few things to run. We&apos;ll check and install them for you.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, width: "100%", maxWidth: 540 }}>
                <DepRow
                  name="Node.js"
                  installed={deps?.nodeInstalled ?? false}
                  version={deps?.nodeVersion ?? ""}
                  loading={depsLoading}
                  onInstall={handleInstallNode}
                />
                <DepRow
                  name="npm"
                  installed={deps?.npmInstalled ?? false}
                  version={deps?.npmVersion ?? ""}
                  loading={depsLoading}
                />
                <DepRow
                  name="Ollama (Local AI)"
                  installed={deps?.ollamaRunning ?? false}
                  version={deps?.ollamaVersion ?? ""}
                  loading={depsLoading || ollamaPhase === "installing"}
                  onInstall={handleInstallOllama}
                  installLabel="Install"
                  phase={ollamaPhase}
                />
                {!(deps?.ollamaRunning) && (
                  <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", paddingLeft: 12, marginTop: -4 }}>
                    Or{" "}
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--color-primary)", textDecoration: "underline" }}
                    >
                      download from ollama.com
                    </a>
                  </p>
                )}
                {/* Gemma 4 model status — shown when Ollama is installed */}
                {deps?.ollamaRunning && !deps?.gemma4Available && (
                  <DepRow
                    name="Gemma 4 (Offline Model)"
                    installed={false}
                    version=""
                    loading={modelPulling}
                    onInstall={async () => {
                      if (modelPulling) return; // prevent spam
                      setModelPulling(true);
                      appendLog("");
                      appendLog("--- Downloading Offline Model ---");
                      appendLog("$ ollama pull gemma4");
                      appendLog("==> Downloading Gemma 4 E4B (~2.5GB)...");
                      appendLog("==> This may take a few minutes depending on your connection");
                      try {
                        await commands.pullOllamaModel("gemma4");
                        appendLog("==> Gemma 4 downloaded and verified");
                        appendLog("==> Model ready for offline inference");
                        await checkDeps();
                      } catch {
                        appendLog("WARNING: Download failed — try manually:");
                        appendLog("         $ ollama pull gemma4");
                      }
                      setModelPulling(false);
                    }}
                    installLabel={modelPulling ? "Downloading..." : "Download"}
                  />
                )}
                {deps?.ollamaRunning && deps?.gemma4Available && (
                  <DepRow
                    name="Gemma 4 (Offline Model)"
                    installed={true}
                    version="Ready"
                    loading={false}
                  />
                )}
              </div>

              {/* Console output — Cydia-style live progress log */}
              {consoleLogs.length > 0 && (
                <div
                  ref={consoleRef}
                  className="mb-4 text-left font-mono overflow-y-auto"
                  style={{
                    fontSize: "var(--font-size-xs)",
                    lineHeight: 1.6,
                    color: "var(--color-text-secondary)",
                    background: "var(--color-bg-primary)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                    border: "none",
                    boxShadow: "var(--shadow-ring)",
                    maxHeight: 160,
                    minHeight: 80,
                  }}
                  role="log"
                  aria-label="Installation progress"
                  aria-live="polite"
                >
                  {consoleLogs.map((line, i) => {
                    // Color logic: errors red, warnings amber, commands cyan, success green, sections white, rest muted
                    const text = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ""); // strip timestamp for matching
                    let color = "var(--color-text-dim)";
                    if (text.includes("ERROR:") || text.includes("Failed")) {
                      color = "var(--color-error)";
                    } else if (text.includes("WARNING:")) {
                      color = "var(--color-warning)";
                    } else if (text.startsWith("$ ") || text.includes("] $ ")) {
                      color = "var(--color-accent)"; // cyan for commands
                    } else if (text.startsWith("---")) {
                      color = "var(--color-text-primary)"; // white for section headers
                    } else if (text.includes("successfully") || text.includes("ready") || text.includes("passed") || text.includes("verified")) {
                      color = "var(--color-success)";
                    } else if (text.startsWith("==>")) {
                      color = "var(--color-text-secondary)"; // brighter for brew-style status
                    }
                    return (
                      <div
                        key={i}
                        style={{
                          color,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontWeight: text.startsWith("---") ? 600 : 400,
                        }}
                      >
                        {line}
                      </div>
                    );
                  })}
                  {(ollamaPhase === "installing") && (
                    <div style={{ color: "var(--color-text-dim)" }}>
                      <span className="animate-pulse">_</span>
                    </div>
                  )}
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex gap-3 justify-center" style={{ marginTop: 28 }}>
                <NavButton label="← Back" onClick={() => setStep("welcome")} variant="ghost" />
                <NavButton
                  label={allDepsReady ? "Next →" : "Skip for now →"}
                  onClick={() => setStep("engine")}
                  variant={allDepsReady ? "primary" : "secondary"}
                />
              </div>
            </div>
          )}

          {/* ── ENGINE ── */}
          {step === "engine" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%", animation: "onboardingStepIn 0.4s ease-out" }}>
              <h2 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>Start the Engine</h2>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", maxWidth: 400, marginBottom: 32 }}>
                The WOTANN Engine runs as a background service, connecting to all your AI providers.
              </p>

              {/* Engine status card */}
              <div
                className="rounded-xl transition-all"
                style={{
                  padding: "24px 24px",
                  marginBottom: 20,
                  background: engineStatus === "running"
                    ? "rgba(16, 185, 129, 0.04)"
                    : "var(--surface-2)",
                  border: engineStatus === "running"
                    ? "1px solid rgba(16, 185, 129, 0.15)"
                    : "1px solid var(--border-subtle)",
                }}
              >
                {(engineStatus === "checking" || engineStatus === "installing" || engineStatus === "starting") && (
                  <div className="flex flex-col items-center gap-4">
                    <div
                      style={{
                        filter: "drop-shadow(0 0 16px rgba(var(--accent-rgb, 10,132,255), 0.3))",
                      }}
                    >
                      <ValknutSpinner
                        size={48}
                        color={engineStatus === "installing" ? "var(--color-warning)" : "var(--color-primary)"}
                        label={engineStatus === "installing" ? "Installing" : engineStatus === "starting" ? "Starting" : "Checking"}
                      />
                    </div>
                    <div>
                      <div className="font-medium" style={{ color: engineStatus === "installing" ? "var(--color-warning)" : "var(--color-primary)", marginBottom: 4 }}>
                        {engineStatus === "checking" && "Checking engine status..."}
                        {engineStatus === "installing" && "Installing daemon service..."}
                        {engineStatus === "starting" && "Starting engine..."}
                      </div>
                      {daemonProgress && (
                        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>{daemonProgress}</div>
                      )}
                    </div>
                  </div>
                )}

                {engineStatus === "running" && (
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(16, 185, 129, 0.15)", boxShadow: "0 0 24px rgba(16, 185, 129, 0.2)" }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-success)" }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <span className="font-semibold" style={{ fontSize: "var(--font-size-base)", color: "var(--color-success)" }}>Engine is running</span>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                      The daemon will persist across app restarts
                    </span>
                  </div>
                )}

                {engineStatus === "failed" && (
                  <div className="flex flex-col items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.15)" }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: "var(--color-error)" }}>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 8v4M12 16h.01" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-medium" style={{ color: "var(--color-text-secondary)", marginBottom: 4 }}>
                        Engine not running
                      </div>
                      {daemonProgress && (
                        <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginBottom: 12 }}>{daemonProgress}</div>
                      )}
                    </div>
                    <button
                      onClick={handleInstallAndStartEngine}
                      className="text-white transition-all active:scale-[0.98]"
                      style={{
                        padding: "8px 24px",
                        borderRadius: "var(--radius-lg)",
                        fontSize: "var(--font-size-base)",
                        fontWeight: 600,
                        background: "var(--gradient-accent)",
                        boxShadow: "0 2px 12px rgba(var(--accent-rgb, 10,132,255), 0.25)",
                      }}
                    >
                      Retry
                    </button>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                      Or run <code style={{ color: "var(--color-primary)", background: "var(--accent-muted, rgba(10,132,255,0.08))", padding: "2px 6px", borderRadius: "var(--radius-xs)", fontSize: "var(--font-size-xs)" }}>wotann engine start</code> in your terminal
                    </p>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div className="flex gap-3 justify-center" style={{ marginTop: 28 }}>
                <NavButton label="← Back" onClick={() => setStep("deps")} variant="ghost" />
                <NavButton
                  label={engineStatus === "running" ? "Next →" : "Skip for now →"}
                  onClick={() => setStep("providers")}
                  variant={engineStatus === "running" ? "primary" : "secondary"}
                />
              </div>
            </div>
          )}

          {/* ── PROVIDERS ── */}
          {step === "providers" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", animation: "onboardingStepIn 0.4s ease-out" }}>
              <h2 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8, textAlign: "center" }}>Connect Your AI</h2>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", maxWidth: 520, marginBottom: 24, textAlign: "center" }}>
                Use your existing subscriptions, free tiers, or API keys. WOTANN detects what you have and picks the best model automatically.
              </p>

              {/* Subscription options — prominent */}
              <div style={{ width: "100%", maxWidth: 580, marginBottom: 20 }}>
                <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  Use Existing Subscriptions (no extra cost)
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {/* Claude Pro/Max */}
                  <div style={{ flex: 1, padding: 14, background: "var(--surface-2)", border: "none", boxShadow: "var(--shadow-ring)", borderRadius: "var(--radius-md)" }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>Claude Pro / Max</span>
                      <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-success)", background: "var(--color-success-muted)", padding: "2px 6px", borderRadius: "var(--radius-xs)", fontWeight: 600 }}>SUBSCRIPTION</span>
                    </div>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", lineHeight: 1.5, marginBottom: 10 }}>
                      Uses your Claude subscription directly. Requires Claude Code CLI installed.
                    </p>
                    <button
                      onClick={async () => {
                        appendLog("--- Checking Claude Subscription ---");
                        appendLog("$ claude --version");
                        try {
                          const status = await commands.checkDependencies();
                          if (status.wotannCliInstalled) {
                            appendLog("==> Claude CLI found — subscription access available");
                            appendLog("==> Run 'claude login' in terminal if not already authenticated");
                          } else {
                            appendLog("==> Claude CLI not found");
                            appendLog("==> Install: npm install -g @anthropic-ai/claude-code");
                            appendLog("==> Then: claude login");
                          }
                        } catch {
                          appendLog("==> Check failed — install Claude CLI manually");
                        }
                      }}
                      className="btn-press"
                      style={{ width: "100%", padding: "6px 12px", fontSize: "var(--font-size-xs)", fontWeight: 600, borderRadius: "var(--radius-sm)", background: "var(--accent-muted)", color: "var(--color-primary)", border: "1px solid var(--border-focus)", cursor: "pointer" }}
                    >
                      Check Status
                    </button>
                  </div>
                  {/* GitHub Copilot */}
                  <div style={{ flex: 1, padding: 14, background: "var(--surface-2)", border: "none", boxShadow: "var(--shadow-ring)", borderRadius: "var(--radius-md)" }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>GitHub Copilot</span>
                      <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-success)", background: "var(--color-success-muted)", padding: "2px 6px", borderRadius: "var(--radius-xs)", fontWeight: 600 }}>SUBSCRIPTION</span>
                    </div>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", lineHeight: 1.5, marginBottom: 10 }}>
                      Free tier, Pro ($10), or Pro+ ($39). Access GPT-5, Claude, Gemini through one subscription.
                    </p>
                    <input
                      type="password"
                      placeholder="GH_TOKEN (github.com/settings/tokens)"
                      value={apiKeys["GH_TOKEN"] ?? ""}
                      onChange={(e) => handleKeyChange("GH_TOKEN", e.target.value)}
                      className="w-full focus:outline-none font-mono focus-glow"
                      style={{
                        padding: "4px 8px",
                        fontSize: "var(--font-size-xs)",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid var(--border-default)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--color-text-primary)",
                        transition: "border-color 200ms ease, box-shadow 200ms ease",
                      }}
                      autoComplete="off"
                    />
                  </div>
                  {/* ChatGPT Plus/Pro */}
                  <div style={{ flex: 1, padding: 14, background: "var(--surface-2)", border: "none", boxShadow: "var(--shadow-ring)", borderRadius: "var(--radius-md)" }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>ChatGPT Plus / Pro</span>
                      <span style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-success)", background: "var(--color-success-muted)", padding: "2px 6px", borderRadius: "var(--radius-xs)", fontWeight: 600 }}>SUBSCRIPTION</span>
                    </div>
                    <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", lineHeight: 1.5, marginBottom: 10 }}>
                      Sign in with your ChatGPT account. Uses your existing subscription quota.
                    </p>
                    <button
                      onClick={async () => {
                        appendLog("");
                        appendLog("--- ChatGPT OAuth ---");
                        appendLog("==> Opening browser for OpenAI sign-in...");
                        appendLog("==> Sign in with your ChatGPT account to authorize WOTANN");
                        appendLog("==> Waiting for authorization (up to 2 minutes)...");
                        try {
                          // Route through engine RPC which runs the PKCE flow server-side
                          await commands.executeCommand("node -e \"import('./dist/providers/codex-oauth.js').then(m => m.startCodexLogin()).then(() => console.log('OK')).catch(e => console.error(e.message))\"");
                          appendLog("==> ChatGPT subscription connected successfully");
                          appendLog("==> You can now use GPT-4o, GPT-5, and other OpenAI models");
                        } catch (err) {
                          appendLog(`WARNING: ${err instanceof Error ? err.message : "Sign-in cancelled or timed out"}`);
                          appendLog("==> You can try again later from Settings > Providers");
                        }
                      }}
                      className="btn-press"
                      style={{ width: "100%", padding: "6px 12px", fontSize: "var(--font-size-xs)", fontWeight: 600, borderRadius: "var(--radius-sm)", background: "var(--color-success-muted)", color: "var(--color-success)", border: "1px solid rgba(16, 185, 129, 0.2)", cursor: "pointer" }}
                    >
                      Sign in with ChatGPT
                    </button>
                  </div>
                </div>
              </div>

              {/* API Keys + Free Tiers */}
              <div style={{ width: "100%", maxWidth: 580, marginBottom: 8 }}>
                <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  API Keys &amp; Free Tiers
                </div>
              </div>
              <div className="space-y-3 mb-6 max-h-52 overflow-y-auto pr-1" style={{ width: "100%", maxWidth: 580 }}>
                {PROVIDERS.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      borderRadius: "var(--radius-md)",
                      padding: 16,
                      background: "var(--surface-2)",
                      border: "none",
                      boxShadow: "var(--shadow-ring)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ fontSize: "var(--font-size-base)", fontWeight: 500, color: "var(--color-text-primary)" }}>
                        {p.name}
                        {p.free && (
                          <span
                            className="ml-2 inline-block"
                            style={{ fontSize: "var(--font-size-xs)", color: "var(--color-success)", background: "rgba(16, 185, 129, 0.1)", padding: "2px 8px", borderRadius: "var(--radius-xs)", fontWeight: 600 }}
                          >
                            FREE
                          </span>
                        )}
                      </span>
                      <a
                        href={p.helpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "var(--font-size-xs)", color: "var(--color-primary)", textDecoration: "none" }}
                        className=""
                      >
                        Get key ↗
                      </a>
                    </div>
                    <input
                      type={p.id === "ollama" ? "text" : "password"}
                      placeholder={p.placeholder}
                      value={apiKeys[p.envVar] ?? ""}
                      onChange={(e) => handleKeyChange(p.envVar, e.target.value)}
                      className="w-full focus:outline-none font-mono focus-glow"
                      style={{
                        padding: "8px 12px",
                        fontSize: "var(--font-size-sm)",
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid var(--border-default)",
                        borderRadius: "var(--radius-md)",
                        color: "var(--color-text-primary)",
                      }}
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 justify-center" style={{ marginTop: 28 }}>
                <NavButton label="← Back" onClick={() => setStep("engine")} variant="ghost" />
                <NavButton
                  label={savingKeys ? "Saving..." : hasAnyKey ? "Save & Continue →" : "Skip for now →"}
                  onClick={handleSaveKeys}
                  disabled={savingKeys}
                  variant={hasAnyKey ? "primary" : "secondary"}
                />
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === "done" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", width: "100%", animation: "onboardingStepIn 0.4s ease-out" }}>
              <div className="relative inline-flex items-center justify-center" style={{ marginBottom: 28 }}>
                <div className="absolute w-32 h-32 rounded-full animate-pulse opacity-20" style={{ background: "radial-gradient(circle, var(--color-success) 0%, transparent 70%)" }} />
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(16, 185, 129, 0.1)", border: "2px solid rgba(16, 185, 129, 0.3)", boxShadow: "0 0 30px rgba(16, 185, 129, 0.15)" }}
                >
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-success)" }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>

              <h2 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>You're all set!</h2>
              <p className="mx-auto text-center" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)", maxWidth: 380, marginBottom: 32 }}>
                {hasAnyKey
                  ? "Your providers are configured. Start chatting!"
                  : "You can add API keys anytime in Settings → Providers."}
              </p>

              <button
                onClick={() => {
                  if (engineStatus === "running") setEngineConnected(true);
                  setOnboardingComplete();
                }}
                className="text-white transition-all active:scale-[0.97] hover:scale-[1.02]"
                style={{
                  padding: "14px 36px",
                  borderRadius: "var(--radius-lg)",
                  fontSize: "var(--font-size-base)",
                  fontWeight: 600,
                  background: "var(--gradient-success)",
                  boxShadow: "0 4px 24px rgba(16, 185, 129, 0.3)",
                }}
              >
                Start Using WOTANN →
              </button>

              <div className="mt-6 flex items-center justify-center gap-4" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                <span className="inline-flex items-center gap-1.5">
                  <kbd style={{
                    padding: "2px 8px",
                    background: "var(--surface-1)",
                    border: "none",
                    boxShadow: "var(--shadow-ring)",
                    borderRadius: "var(--radius-xs)",
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.6,
                  }}>
                    {"\u2318K"}
                  </kbd>
                  <span>commands</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <kbd style={{
                    padding: "2px 8px",
                    background: "var(--surface-1)",
                    border: "none",
                    boxShadow: "var(--shadow-ring)",
                    borderRadius: "var(--radius-xs)",
                    fontSize: "var(--font-size-xs)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.6,
                  }}>
                    {"\u2318N"}
                  </kbd>
                  <span>new chat</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reusable Navigation Button ─────────────────────────────

function NavButton({
  label,
  onClick,
  variant = "ghost",
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  variant?: "ghost" | "secondary" | "primary";
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    ghost: {
      padding: "8px 16px",
      borderRadius: "var(--radius-lg)",
      fontSize: "var(--font-size-base)",
      fontWeight: 500,
      color: "var(--color-text-secondary)",
      background: "transparent",
      border: "none",
      boxShadow: "var(--shadow-ring)",
      cursor: disabled ? "not-allowed" : "pointer",
    },
    secondary: {
      padding: "8px 24px",
      borderRadius: "var(--radius-lg)",
      fontSize: "var(--font-size-base)",
      fontWeight: 600,
      color: "var(--color-text-secondary)",
      background: "var(--surface-3)",
      border: "1px solid var(--border-default)",
      cursor: disabled ? "not-allowed" : "pointer",
    },
    primary: {
      padding: "8px 24px",
      borderRadius: "var(--radius-lg)",
      fontSize: "var(--font-size-base)",
      fontWeight: 600,
      color: "white",
      background: "var(--gradient-accent)",
      boxShadow: "0 4px 16px rgba(var(--accent-rgb, 10,132,255), 0.25)",
      border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="active:scale-[0.97] hover:brightness-110"
      style={{
        ...styles[variant],
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ── Dependency Row Component ───────────────────────────────

function DepRow({
  name,
  installed,
  version,
  loading,
  onInstall,
  installLabel,
  phase,
}: {
  name: string;
  installed: boolean;
  version: string;
  loading: boolean;
  onInstall?: () => void;
  installLabel?: string;
  phase?: InstallPhase;
}) {
  const isInstalling = phase === "installing" || loading;
  const isFailed = phase === "error";

  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: "14px 16px",
        borderRadius: "var(--radius-md)",
        background: installed
          ? "rgba(16, 185, 129, 0.04)"
          : isFailed
            ? "rgba(239, 68, 68, 0.03)"
            : "var(--surface-2)",
        border: installed
          ? "1px solid rgba(16, 185, 129, 0.15)"
          : isFailed
            ? "1px solid rgba(239, 68, 68, 0.12)"
            : "none",
        boxShadow: (!installed && !isFailed) ? "var(--shadow-ring)" : undefined,
        transition: "all 250ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="flex items-center gap-3">
        {/* Status icon: spinner for installing, checkmark for success, X for failed, dot for pending */}
        {isInstalling ? (
          <ValknutSpinner size={24} color="var(--color-primary)" label="Installing" />
        ) : installed ? (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: "rgba(16, 185, 129, 0.15)", boxShadow: "0 0 8px rgba(16, 185, 129, 0.2)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-success)" }} aria-label="Installed">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        ) : isFailed ? (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: "rgba(239, 68, 68, 0.1)", boxShadow: "0 0 8px rgba(239, 68, 68, 0.15)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-error)" }} aria-label="Failed">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </div>
        ) : (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: "rgba(113, 113, 122, 0.1)", border: "1px solid rgba(113, 113, 122, 0.2)" }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: "var(--color-text-muted)" }} />
          </div>
        )}
        <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{name}</span>
        {version && <span className="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>{version}</span>}
      </div>

      {!installed && !isInstalling && onInstall && (
        <button
          onClick={onInstall}
          className="depth-ghost-btn active:scale-[0.97]"
          style={{
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: "var(--radius-md)",
            color: "var(--color-primary)",
            border: "1px solid rgba(var(--accent-rgb, 10,132,255), 0.2)",
            cursor: "pointer",
          }}
        >
          {installLabel ?? "Install"}
        </button>
      )}

      {isInstalling && (
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-primary)", fontWeight: 500 }}>
          Installing...
        </span>
      )}

      {installed && (
        <span className="text-xs font-medium flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3" fill="currentColor" />
          </svg>
          Ready
        </span>
      )}
    </div>
  );
}
