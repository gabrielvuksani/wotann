/**
 * Middleware types for the 16-layer pipeline.
 * Each middleware layer enriches the context on the way in (before)
 * and can modify results on the way out (after).
 */

import type { AgentMessage, RiskLevel } from "../core/types.js";

export interface MiddlewareContext {
  readonly sessionId: string;
  readonly userMessage: string;
  readonly recentHistory: readonly AgentMessage[];
  readonly workingDir: string;
  readonly filePath?: string;

  // Layer 1: IntentGate
  resolvedIntent?: IntentResult;
  taskType?: string;
  complexity?: "low" | "medium" | "high";
  behavioralMode?: string;

  // Layer 2: ThreadData
  threadDir?: string;

  // Layer 3: Uploads
  injectedFiles?: readonly string[];

  // Layer 4: Sandbox
  sandboxActive?: boolean;
  sandboxError?: string;

  // Layer 5: Guardrail
  guardrailTriggered?: boolean;

  // Layer 7: Summarization
  contextUtilization?: number;
  needsSummarization?: boolean;

  // Layer 10: Clarification
  ambiguityScore?: number;
  needsClarification?: boolean;

  // Layer 11: Cache
  cacheHitRate?: number;

  // Layer 12: Autonomy
  riskLevel?: RiskLevel;

  // Layer 13: LSP
  lspAvailable?: boolean;

  // Layer 14: FileTrack
  trackedFiles?: Set<string>;

  // Layer 16: Frustration
  frustrationDetected?: boolean;
  frustrationPatterns?: readonly string[];

  // Layer 5.7: TrifectaGuard (T10.4)
  trifectaVerdict?: {
    readonly verdict: "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";
    readonly approved?: boolean;
    readonly reason: string;
  };

  // Generic extension point
  cachedResponse?: string;
}

export interface IntentResult {
  readonly type: string;
  readonly category: string;
  readonly complexity: "low" | "medium" | "high";
  readonly suggestedMode?: string;
  readonly keywords: readonly string[];
  readonly confidence: number;
}

export interface AgentResult {
  readonly toolName?: string;
  readonly filePath?: string;
  readonly content: string;
  readonly success: boolean;
  readonly followUp?: string;
  readonly tokensUsed?: number;

  // Layer 8: Memory extraction hint
  readonly memoryCandidate?: {
    readonly tool: string;
    readonly file?: string;
    readonly sessionId: string;
    readonly timestamp: number;
  };

  // Cache tracking
  readonly cacheHit?: boolean;
}

export interface Middleware {
  readonly name: string;
  readonly order: number;
  before?(ctx: MiddlewareContext): Promise<MiddlewareContext> | MiddlewareContext;
  after?(ctx: MiddlewareContext, result: AgentResult): Promise<AgentResult> | AgentResult;
}
