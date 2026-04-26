import type { ProviderAuth, ProviderName, ProviderStatus } from "../core/types.js";
import type { WotannRuntime } from "../core/runtime.js";
import type { WotannMode } from "../core/mode-cycling.js";
import { createRuntime } from "../core/runtime.js";
import { discoverProviders, formatFullStatus } from "../providers/discovery.js";

export interface InteractiveBootstrapOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly mode?: string;
}

export interface InteractiveBootstrapDependencies {
  readonly discoverProvidersFn?: () => Promise<readonly ProviderAuth[]>;
  readonly createRuntimeFn?: (
    workingDir: string,
    initialMode?: WotannMode,
  ) => Promise<WotannRuntime>;
}

export interface InteractiveBootstrapResult {
  readonly providers: readonly ProviderStatus[];
  readonly initialModel: string;
  readonly initialProvider: ProviderName;
  readonly runtime: WotannRuntime;
}

/**
 * Build the interactive TUI state around a fully initialized WotannRuntime.
 * If runtime initialization fails, callers must surface that failure instead
 * of silently degrading into a direct-provider or no-runtime code path.
 */
export async function bootstrapInteractiveSession(
  workingDir: string,
  options: InteractiveBootstrapOptions = {},
  dependencies: InteractiveBootstrapDependencies = {},
): Promise<InteractiveBootstrapResult> {
  const discover = dependencies.discoverProvidersFn ?? discoverProviders;
  const create = dependencies.createRuntimeFn ?? createRuntime;

  const detectedProviders = await discover();
  const providers = formatFullStatus(detectedProviders);
  const activeProvider = detectedProviders[0];
  const runtime = await create(workingDir, normalizeMode(options.mode));

  // Resolution order: explicit option → first detected provider's first
  // model → empty sentinel. The previous fallback ("gemma4:e4b" + "ollama")
  // hard-pinned every fresh launch with no env to a model the user might
  // not have pulled (Ollama silently 404s if the model isn't local) AND
  // pretended Ollama was the configured provider when it wasn't. The
  // empty sentinel surfaces the no-provider state to App.tsx so it can
  // route the user into the onboarding wizard rather than firing a
  // phantom request.
  const initialProvider = (options.provider ?? activeProvider?.provider ?? "") as ProviderName | "";
  const initialModel = options.model ?? activeProvider?.models[0] ?? "";

  return {
    providers,
    initialModel,
    initialProvider: initialProvider as ProviderName,
    runtime,
  };
}

function normalizeMode(mode?: string): WotannMode | undefined {
  if (!mode) return undefined;

  const supportedModes: readonly WotannMode[] = [
    "default",
    "plan",
    "acceptEdits",
    "auto",
    "bypass",
    "autonomous",
    "guardrails-off",
    "focus",
    "interview",
    "teach",
    "review",
    "exploit",
  ];

  return supportedModes.includes(mode as WotannMode) ? (mode as WotannMode) : undefined;
}
