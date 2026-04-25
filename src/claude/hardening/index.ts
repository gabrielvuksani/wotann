/**
 * Wave 5 barrel — V9 T3.6.
 */

export { createCostLedger, getQuotaProbe, isQuotaThresholdCrossed } from "./telemetry.js";
export type { CostLedger } from "./telemetry.js";

export { classify, renderUserHint, isRetriable } from "./error-handler.js";
export type { RawProcessFailure } from "./error-handler.js";

export { decideSubscriptionFlag, describeSubscriptionFlag } from "./feature-flag.js";
export type { SubscriptionFlagDecision } from "./feature-flag.js";
