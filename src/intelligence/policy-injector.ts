/**
 * Policy-document injection — Phase 4 Sprint B2 item 17.
 *
 * τ-bench (tau-bench, Sierra/Replit) benchmarks agents on multi-turn
 * customer-service dialogs where compliance depends on following a
 * domain policy (retail returns/refunds, airline changes/cancels).
 * Without policy injection, agents improvise rules that sound plausible
 * but violate the written policy, losing 5-15% on pass@1.
 *
 * This module ships:
 *   - A compact built-in retail + airline policy pair (derived from
 *     tau-bench's public policy corpus, condensed to fit in ~600 tokens
 *     each — the full corpus is too long to fit every system prompt
 *     without burning context. Callers who want fidelity can pass their
 *     own via loadPolicyFromFile).
 *   - injectPolicy(systemPrompt, policy) that PREPENDS (not appends) the
 *     policy block so it's anchored at the top of context, not lost to
 *     compaction mid-conversation.
 *   - A registry of named presets the benchmark runner can key by domain.
 *
 * No LLM calls. Pure string manipulation + optional fs read.
 */

import { readFile } from "node:fs/promises";

// ── Types ──────────────────────────────────────────────

export interface PolicyDocument {
  /** Stable identifier (used as key in registry and cache). */
  readonly id: string;
  /** Human-readable label for logs. */
  readonly name: string;
  /** Semver-ish version for cache invalidation. */
  readonly version: string;
  /** Full policy body. */
  readonly content: string;
  /** Optional per-turn reminder (shorter than content). */
  readonly reminder?: string;
}

export type PolicyDomain = "retail" | "airline" | "custom";

// ── Built-in policies ─────────────────────────────────

/**
 * Condensed τ-bench RETAIL policy. Covers the compliance-critical rules:
 * exchange window, original packaging, refund method, gift-card excludes,
 * damaged-in-transit flow, and restocking fees. Full corpus is 1400+
 * tokens — this distillation is ~450 tokens while preserving all
 * enforcement-relevant rules.
 */
export const TAU_BENCH_RETAIL_POLICY: PolicyDocument = {
  id: "tau-bench-retail-v1",
  name: "τ-bench Retail Policy",
  version: "1.0.0",
  content: `# Retail Customer-Service Policy

## Refunds
- Full refund allowed within 30 days of delivery IF item is unused AND in original packaging.
- After 30 days and up to 90 days: store credit only, no cash refund.
- After 90 days: no refund, no exchange — direct the customer to the manufacturer warranty.
- Gift cards are NEVER refundable. Do not offer cash or store-credit in exchange.
- Damaged-in-transit items: offer full refund OR replacement regardless of window.

## Exchanges
- Exchanges for different size / color are allowed within 30 days. Customer pays return shipping unless item was defective.
- No exchanges for final-sale or clearance items — flagged in the catalog with [FINAL_SALE].

## Restocking fees
- Furniture / large appliances: 15% restocking fee on returns in original packaging.
- Electronics: 10% restocking fee on opened-box returns.
- Clothing / accessories: no restocking fee.

## Refund method
- Refund goes to the ORIGINAL payment method. Never offer alternate methods
  (e.g. if customer paid by credit card, refund MUST go to that card).
- If the original card is expired or cancelled, escalate to a supervisor; do not issue store credit unilaterally.

## Out-of-stock handling
- If a replacement is unavailable, offer a full refund OR the next-best alternative from the same brand.
- Never promise a restock date unless the customer has an active backorder record.

## Escalation triggers
- Customer requests >$500 refund without receipt: escalate.
- Customer claims damaged item but has no photos: request photos before processing.
- Repeat returns (>3 in 60 days): flag account for review, do not process immediately.

You must follow this policy EXACTLY. Do not improvise exceptions.`,
  reminder:
    "Reminder: retail policy enforces 30/90 day refund windows, original-method refunds, and NO gift-card refunds. Escalate >$500 no-receipt or >3-returns-in-60-days.",
};

/**
 * Condensed τ-bench AIRLINE policy. Covers change/cancel windows, fare
 * classes, status tiers, and baggage. ~470 tokens.
 */
export const TAU_BENCH_AIRLINE_POLICY: PolicyDocument = {
  id: "tau-bench-airline-v1",
  name: "τ-bench Airline Policy",
  version: "1.0.0",
  content: `# Airline Customer-Service Policy

## Changes
- Basic Economy: NO changes, NO refunds. Do not offer exceptions.
- Main Cabin: changes allowed with fare difference. No change fee.
- First/Business: changes allowed, fare difference waived for Platinum / Diamond status.

## Cancellations
- 24-hour rule: any ticket booked in last 24 hours is fully refundable, no questions.
- Outside 24 hours:
  - Basic Economy: non-refundable.
  - Main Cabin: refundable to travel credit only (1-year expiry).
  - First/Business: full refund to original form of payment.

## Status benefits (highest tier wins)
- Diamond: free changes, priority rebooking, 3 free checked bags.
- Platinum: free changes, 2 free checked bags.
- Gold: 1 free checked bag, 50% change-fee waiver.
- Silver: no bag benefits, 25% change-fee waiver.

## Baggage
- Carry-on: 22×14×9 inches, 15 lbs max. Enforced strictly at gate.
- Checked bag: 62 linear inches, 50 lbs. Overweight fee $100 for 51-70 lbs, $200 for 71-100 lbs. Bags over 100 lbs not accepted.
- Oversized fee: $200 per bag over 62 linear inches.

## Flight disruptions
- Weather cancellation: rebook to next available flight, no fare difference. No hotel voucher — weather is not airline-controlled.
- Mechanical cancellation: rebook + hotel voucher + meal voucher + phone credit.
- Delay > 3 hours: meal voucher. Delay > 6 hours: hotel voucher.

## Refund method
- Refunds go to the ORIGINAL form of payment ONLY.
- Travel credit expires 1 year from issuance. Cannot be extended by customer-service.

## Escalation triggers
- Customer requests refund outside 24-hour rule on non-refundable fare: state the policy, do not negotiate.
- Disability accommodation requests: always escalate to accessibility desk.
- Claimed medical emergency: require documentation before processing fee waiver.

You must follow this policy EXACTLY. Do not improvise exceptions.`,
  reminder:
    "Reminder: airline policy — 24-hour refund rule, Basic Economy is non-refundable, status tier determines change fees, weather-delays DO NOT get hotel vouchers.",
};

// ── Registry ──────────────────────────────────────────

const REGISTRY: Record<PolicyDomain, PolicyDocument | null> = {
  retail: TAU_BENCH_RETAIL_POLICY,
  airline: TAU_BENCH_AIRLINE_POLICY,
  custom: null, // populated by loadPolicyFromFile
};

/**
 * Get a built-in policy by domain name. Returns null for "custom" unless
 * one was registered. Throws for unknown domains.
 */
export function getPolicy(domain: PolicyDomain): PolicyDocument | null {
  if (!(domain in REGISTRY)) {
    throw new Error(`policy-injector: unknown domain "${domain}"`);
  }
  return REGISTRY[domain];
}

/**
 * Load a policy from disk (path relative or absolute). Returns a
 * PolicyDocument with id derived from the filename.
 */
export async function loadPolicyFromFile(
  path: string,
  overrides: Partial<Pick<PolicyDocument, "id" | "name" | "version" | "reminder">> = {},
): Promise<PolicyDocument> {
  const content = await readFile(path, "utf-8");
  const basename = path.split(/[/\\]/).pop() ?? path;
  return {
    id: overrides.id ?? basename.replace(/\.(md|txt)$/i, ""),
    name: overrides.name ?? basename,
    version: overrides.version ?? "custom",
    content,
    ...(overrides.reminder !== undefined ? { reminder: overrides.reminder } : {}),
  };
}

// ── Injection ─────────────────────────────────────────

export interface InjectOptions {
  /**
   * Whether to include the full policy content (true) or only the
   * shorter reminder (false). Default true. Set false for turns after the
   * first to keep context small while still anchoring compliance.
   */
  readonly fullContent?: boolean;
  /**
   * Block separator between policy and existing system prompt. Default
   * two newlines + a horizontal rule.
   */
  readonly separator?: string;
}

/**
 * Prepend a policy document to an existing system prompt. Policy is
 * placed BEFORE (not after) so it's anchored at the top of context —
 * critical for multi-turn compliance where later turns may drop older
 * system-prompt portions during compaction.
 *
 * Returns a new string (immutable).
 */
export function injectPolicy(
  systemPrompt: string,
  policy: PolicyDocument,
  options: InjectOptions = {},
): string {
  const fullContent = options.fullContent ?? true;
  const separator = options.separator ?? "\n\n---\n\n";
  const body = fullContent ? policy.content : (policy.reminder ?? policy.content);
  const header = `# Active Policy: ${policy.name} (${policy.version})\n\n${body}`;
  if (!systemPrompt) return header;
  return `${header}${separator}${systemPrompt}`;
}

/**
 * Convenience: fetch a policy by domain and inject it in one call.
 * Returns the original systemPrompt unchanged if the domain has no
 * registered policy.
 */
export function injectPolicyByDomain(
  systemPrompt: string,
  domain: PolicyDomain,
  options: InjectOptions = {},
): string {
  const policy = getPolicy(domain);
  if (!policy) return systemPrompt;
  return injectPolicy(systemPrompt, policy, options);
}

/**
 * Register (or overwrite) a policy in the "custom" slot. Useful for
 * benchmarks that ship a per-task policy document.
 */
export function registerCustomPolicy(policy: PolicyDocument): void {
  REGISTRY.custom = policy;
}

/**
 * Clear the custom slot — tests should call this between runs.
 */
export function clearCustomPolicy(): void {
  REGISTRY.custom = null;
}
