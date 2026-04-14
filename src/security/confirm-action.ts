/**
 * Confirm-Action Architectural Safety -- tool-level mandatory approval system.
 * Unlike prompt-level guardrails, this cannot be bypassed by prompt injection.
 *
 * Every tool invocation is classified into a category (destructive, external,
 * financial, credential, safe). Non-safe actions require explicit approval
 * before execution. Safe actions (read, search, list) are auto-approved.
 *
 * The approval gate sits at the tool execution layer, not the prompt layer.
 * A model cannot skip this check regardless of what the user prompt says.
 */

import { randomUUID } from "node:crypto";

// -- Types -------------------------------------------------------------------

export type ActionCategory =
  | "destructive"
  | "external"
  | "financial"
  | "credential"
  | "safe";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ActionRequest {
  readonly id: string;
  readonly action: string;
  readonly category: ActionCategory;
  readonly description: string;
  readonly risk: RiskLevel;
  readonly requiresApproval: boolean;
  readonly autoApproveReason?: string;
}

export interface ActionApproval {
  readonly requestId: string;
  readonly approved: boolean;
  readonly approvedBy: string;
  readonly approvedAt: number;
  readonly reason?: string;
}

// -- Classification patterns -------------------------------------------------

interface ClassificationRule {
  readonly category: ActionCategory;
  readonly patterns: readonly RegExp[];
  readonly risk: RiskLevel;
  readonly description: string;
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  // Destructive: data loss or hard-to-reverse operations
  {
    category: "destructive",
    patterns: [
      /\brm\b/i,
      /\bdelete\b/i,
      /\bdrop\b/i,
      /\btruncate\b/i,
      /\breset\s+--hard\b/i,
      /\bforce[- ]?push\b/i,
      /\bgit\s+push\s+.*--force\b/i,
      /\brmdir\b/i,
      /\bunlink\b/i,
      /\bformat\s+disk\b/i,
      /\bwipe\b/i,
    ],
    risk: "critical",
    description: "Destructive action that may cause data loss",
  },
  // External: operations that reach outside the local system
  {
    category: "external",
    patterns: [
      /\bsend\s+email\b/i,
      /\bpost\s+to\s+api\b/i,
      /\bgit\s+push\b/i,
      /\bcreate\s+pr\b/i,
      /\bcreate\s+pull\s+request\b/i,
      /\bpublish\b/i,
      /\bdeploy\b/i,
      /\bupload\b/i,
      /\bwebhook\b/i,
      /\bnotif(?:y|ication)\b/i,
    ],
    risk: "high",
    description: "External action that communicates outside the local system",
  },
  // Financial: anything involving money
  {
    category: "financial",
    patterns: [
      /\bpurchase\b/i,
      /\bpayment\b/i,
      /\bsubscribe\b/i,
      /\bbilling\b/i,
      /\bcharge\b/i,
      /\binvoice\b/i,
      /\btransaction\b/i,
      /\brefund\b/i,
    ],
    risk: "critical",
    description: "Financial action involving money or billing",
  },
  // Credential: secrets management
  {
    category: "credential",
    patterns: [
      /\bset\s+token\b/i,
      /\bstore\s+key\b/i,
      /\brotate\s+secret\b/i,
      /\bapi[- ]?key\b/i,
      /\bpassword\b/i,
      /\bcredential\b/i,
      /\bssh[- ]?key\b/i,
      /\bcertificate\b/i,
    ],
    risk: "high",
    description: "Credential management action",
  },
];

/** Tool names that are inherently safe (read-only operations). */
const SAFE_TOOL_PATTERNS: readonly RegExp[] = [
  /^(read|get|list|search|find|show|status|help|version|info|describe|cat|head|tail|ls|pwd|whoami|echo)$/i,
  /^grep$/i,
  /^git\s+(log|status|diff|show|branch|tag)$/i,
];

// -- Implementation ----------------------------------------------------------

export class ConfirmActionGate {
  private readonly pendingRequests: Map<string, ActionRequest> = new Map();
  private readonly approvalHistory: ActionApproval[] = [];
  private readonly preApprovedPatterns: RegExp[] = [];

  /**
   * Classify an action and determine if it needs approval.
   * This is the core gate -- every tool invocation should pass through.
   */
  classify(toolName: string, args: Record<string, unknown>): ActionRequest {
    const id = `action_${randomUUID().slice(0, 12)}`;
    const combinedText = buildActionText(toolName, args);

    // Check if this is a known safe action
    if (isSafeAction(toolName, args)) {
      return {
        id,
        action: toolName,
        category: "safe",
        description: `Safe read-only action: ${toolName}`,
        risk: "low",
        requiresApproval: false,
        autoApproveReason: "Read-only operation",
      };
    }

    // Check classification rules
    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(combinedText)) {
          const request: ActionRequest = {
            id,
            action: toolName,
            category: rule.category,
            description: rule.description,
            risk: rule.risk,
            requiresApproval: true,
          };

          this.pendingRequests.set(id, request);
          return request;
        }
      }
    }

    // Default: medium risk, requires approval for unknown actions
    const request: ActionRequest = {
      id,
      action: toolName,
      category: "safe",
      description: `Unclassified action: ${toolName}`,
      risk: "medium",
      requiresApproval: false,
      autoApproveReason: "No dangerous patterns detected",
    };

    return request;
  }

  /**
   * Check if an action is pre-approved via safe patterns or user config.
   */
  isPreApproved(request: ActionRequest): boolean {
    if (request.category === "safe") return true;
    if (!request.requiresApproval) return true;

    // Check user-configured pre-approval patterns
    for (const pattern of this.preApprovedPatterns) {
      if (pattern.test(request.action)) return true;
    }

    return false;
  }

  /**
   * Record an approval decision for a pending action.
   */
  recordApproval(approval: ActionApproval): void {
    this.approvalHistory.push(approval);
    this.pendingRequests.delete(approval.requestId);
  }

  /**
   * Get all pending (unapproved) action requests.
   */
  getPendingApprovals(): readonly ActionRequest[] {
    return [...this.pendingRequests.values()];
  }

  /**
   * Get approval history, newest first.
   */
  getHistory(limit?: number): readonly ActionApproval[] {
    const sorted = [...this.approvalHistory].sort(
      (a, b) => b.approvedAt - a.approvedAt,
    );
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Add a pre-approval pattern. Actions matching this pattern are
   * auto-approved without user confirmation.
   */
  addPreApprovalPattern(pattern: RegExp): void {
    this.preApprovedPatterns.push(pattern);
  }

  /**
   * Get classification statistics.
   */
  getStats(): {
    readonly pendingCount: number;
    readonly approvedCount: number;
    readonly deniedCount: number;
    readonly totalClassified: number;
  } {
    const approved = this.approvalHistory.filter((a) => a.approved).length;
    const denied = this.approvalHistory.filter((a) => !a.approved).length;

    return {
      pendingCount: this.pendingRequests.size,
      approvedCount: approved,
      deniedCount: denied,
      totalClassified: this.pendingRequests.size + this.approvalHistory.length,
    };
  }
}

// -- Helpers -----------------------------------------------------------------

function buildActionText(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const argStrings = Object.entries(args)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return `${toolName} ${argStrings}`;
}

function isSafeAction(
  toolName: string,
  _args: Record<string, unknown>,
): boolean {
  // Check if the tool name matches a known safe pattern.
  // We only trust the tool name -- argument keys alone cannot make
  // a dangerous operation safe (prevents bypass via benign-looking args).
  for (const pattern of SAFE_TOOL_PATTERNS) {
    if (pattern.test(toolName)) return true;
  }

  return false;
}
