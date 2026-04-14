/**
 * Incognito Mode — `--incognito` flag disables all persistence.
 *
 * When active:
 * - No memory capture (conversation is not saved)
 * - No session persistence (session state is ephemeral)
 * - No learning extraction (no corrections or patterns saved)
 * - No cost tracking (usage is not recorded)
 *
 * This is useful for sensitive conversations, quick experiments,
 * or when the user does not want any side effects from the interaction.
 */

// ── Types ────────────────────────────────────────────────

export interface IncognitoConfig {
  readonly disableMemory: boolean;
  readonly disableSessionPersistence: boolean;
  readonly disableLearning: boolean;
  readonly disableCostTracking: boolean;
}

/**
 * Runtime-like interface for applying incognito settings.
 * Typed as a structural interface rather than `unknown` so that
 * consuming code can verify the shape.
 */
export interface IncognitoTarget {
  readonly setIncognito?: (enabled: boolean) => void;
  readonly disableMemory?: () => void;
  readonly disableSessionPersistence?: () => void;
  readonly disableLearning?: () => void;
  readonly disableCostTracking?: () => void;
}

// ── Factory ──────────────────────────────────────────────

/**
 * Create the standard incognito configuration.
 * All persistence features are disabled.
 */
export function createIncognitoConfig(): IncognitoConfig {
  return {
    disableMemory: true,
    disableSessionPersistence: true,
    disableLearning: true,
    disableCostTracking: true,
  };
}

/**
 * Create a partial incognito configuration that only disables
 * specific features. Useful for selective privacy.
 */
export function createSelectiveIncognitoConfig(
  overrides: Partial<IncognitoConfig>,
): IncognitoConfig {
  return {
    disableMemory: overrides.disableMemory ?? false,
    disableSessionPersistence: overrides.disableSessionPersistence ?? false,
    disableLearning: overrides.disableLearning ?? false,
    disableCostTracking: overrides.disableCostTracking ?? false,
  };
}

// ── Application ──────────────────────────────────────────

/**
 * Apply incognito configuration to a runtime target.
 * Calls each disable method if the config flag is set and the
 * method exists on the target.
 */
export function applyIncognito(
  target: IncognitoTarget,
  config: IncognitoConfig,
): void {
  // Master toggle if available
  const anyDisabled = config.disableMemory
    || config.disableSessionPersistence
    || config.disableLearning
    || config.disableCostTracking;

  if (anyDisabled && target.setIncognito) {
    target.setIncognito(true);
  }

  // Individual feature toggles
  if (config.disableMemory && target.disableMemory) {
    target.disableMemory();
  }

  if (config.disableSessionPersistence && target.disableSessionPersistence) {
    target.disableSessionPersistence();
  }

  if (config.disableLearning && target.disableLearning) {
    target.disableLearning();
  }

  if (config.disableCostTracking && target.disableCostTracking) {
    target.disableCostTracking();
  }
}

// ── Query ────────────────────────────────────────────────

/**
 * Check whether an incognito config has any features disabled.
 */
export function isIncognitoActive(config: IncognitoConfig): boolean {
  return (
    config.disableMemory
    || config.disableSessionPersistence
    || config.disableLearning
    || config.disableCostTracking
  );
}

/**
 * Get a human-readable summary of what incognito mode disables.
 */
export function describeIncognito(config: IncognitoConfig): string {
  const disabled: string[] = [];
  if (config.disableMemory) disabled.push("memory capture");
  if (config.disableSessionPersistence) disabled.push("session persistence");
  if (config.disableLearning) disabled.push("learning extraction");
  if (config.disableCostTracking) disabled.push("cost tracking");

  if (disabled.length === 0) return "Incognito mode is not active.";
  return `Incognito mode: disabled ${disabled.join(", ")}.`;
}
