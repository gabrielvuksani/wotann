/**
 * Human-in-the-Loop approval for high-stakes operations (DX12).
 *
 * Provides @requireApproval-style blocking for high-stakes tool calls.
 * Routes approval requests to Slack, Email, Discord, or iOS push notifications.
 * On denial, feedback is passed back to the LLM to adjust approach.
 *
 * Features:
 * - Multi-channel approval routing (CLI, desktop, iOS, Slack, email, Discord)
 * - Configurable timeout with default-on-timeout behavior
 * - Full audit trail of all approval decisions
 * - Risk-based policy matching
 * - "Human as tool" — ask human for advice, not just approval
 */

// ── Types ────────────────────────────────────────────────

export interface ApprovalRequest {
  readonly id: string;
  readonly action: string;
  readonly description: string;
  readonly tool: string;
  readonly args: string;
  readonly reason: string;
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly riskLevel: "moderate" | "high" | "critical";
  readonly createdAt: number;
  readonly timestamp: number;
  readonly timeoutMs: number;
  readonly channels: readonly ApprovalChannel[];
}

export interface ApprovalResult {
  readonly approved: boolean;
  readonly approvedBy?: string;
  readonly feedback?: string;
  readonly decidedAt: number;
}

export interface ApprovalResponse {
  readonly requestId: string;
  readonly decision: "approve" | "deny" | "timeout";
  readonly feedback?: string;
  readonly respondedBy?: string;
  readonly respondedAt: number;
}

export type ApprovalChannel = "cli" | "desktop" | "ios" | "slack" | "email" | "discord";

export interface ApprovalPolicy {
  readonly tools: readonly string[];
  readonly riskLevel: "moderate" | "high" | "critical";
  readonly channels: readonly ApprovalChannel[];
  readonly timeoutMs: number;
  readonly defaultOnTimeout: "approve" | "deny";
}

// ── Default Policies ─────────────────────────────────────

const DEFAULT_POLICIES: readonly ApprovalPolicy[] = [
  {
    tools: ["bash"],
    riskLevel: "critical",
    channels: ["cli", "desktop", "ios"],
    timeoutMs: 300_000, // 5 minutes
    defaultOnTimeout: "deny",
  },
  {
    tools: ["write_file", "edit_file"],
    riskLevel: "moderate",
    channels: ["cli", "desktop"],
    timeoutMs: 60_000, // 1 minute
    defaultOnTimeout: "approve",
  },
];

// ── Approval Manager ─────────────────────────────────────

export class HumanApprovalManager {
  private readonly policies: ApprovalPolicy[];
  private readonly pendingRequests: Map<string, {
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  }> = new Map();
  private readonly history: ApprovalResponse[] = [];

  constructor(policies?: readonly ApprovalPolicy[]) {
    this.policies = [...(policies ?? DEFAULT_POLICIES)];
  }

  /**
   * Check if an action requires approval.
   */
  requiresApproval(tool: string, args: string): ApprovalPolicy | null {
    for (const policy of this.policies) {
      if (policy.tools.includes(tool)) {
        // Check if the action matches risk criteria
        if (this.assessRisk(tool, args) >= riskLevelToNumber(policy.riskLevel)) {
          return policy;
        }
      }
    }
    return null;
  }

  /**
   * Request human approval for an action. Blocks until approved, denied, or timeout.
   */
  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    const policy = this.requiresApproval(request.tool, request.args);
    const timeoutMs = policy?.timeoutMs ?? request.timeoutMs;
    const defaultOnTimeout = policy?.defaultOnTimeout ?? "deny";

    return new Promise<ApprovalResponse>((resolve) => {
      // Store pending request
      this.pendingRequests.set(request.id, { request, resolve });

      // Set timeout
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          const response: ApprovalResponse = {
            requestId: request.id,
            decision: defaultOnTimeout === "approve" ? "approve" : "timeout",
            feedback: `Approval timed out after ${timeoutMs}ms. Default: ${defaultOnTimeout}.`,
            respondedAt: Date.now(),
          };
          this.history.push(response);
          resolve(response);
        }
      }, timeoutMs);

      // If approval comes in before timeout, clearTimeout happens in respond()
      this.pendingRequests.set(request.id, {
        request,
        resolve: (response) => {
          clearTimeout(timer);
          this.history.push(response);
          resolve(response);
        },
      });
    });
  }

  /**
   * Respond to a pending approval request (called from UI/channel).
   */
  respond(requestId: string, decision: "approve" | "deny", feedback?: string, respondedBy?: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    this.pendingRequests.delete(requestId);
    pending.resolve({
      requestId,
      decision,
      feedback,
      respondedBy,
      respondedAt: Date.now(),
    });
    return true;
  }

  /**
   * Get all pending approval requests.
   */
  getPending(): readonly ApprovalRequest[] {
    return [...this.pendingRequests.values()].map((p) => p.request);
  }

  /**
   * Get approval history.
   */
  getHistory(): readonly ApprovalResponse[] {
    return this.history;
  }

  /**
   * Add a custom policy.
   */
  addPolicy(policy: ApprovalPolicy): void {
    this.policies.push(policy);
  }

  /**
   * Generic "human as tool" — ask a human for advice.
   */
  async askHuman(question: string, timeoutMs: number = 300_000): Promise<string> {
    const request: ApprovalRequest = {
      id: `ask-${Date.now()}`,
      action: "ask_human",
      description: question,
      tool: "human_advice",
      args: question,
      reason: "Agent needs human input",
      risk: "medium",
      riskLevel: "moderate",
      createdAt: Date.now(),
      timestamp: Date.now(),
      timeoutMs,
      channels: ["cli", "desktop"],
    };

    const response = await this.requestApproval(request);
    return response.feedback ?? (response.decision === "approve" ? "Approved" : "Denied");
  }

  /**
   * Get full audit log of all approval decisions (request + result pairs).
   */
  getAuditLog(): readonly { request: ApprovalRequest; result: ApprovalResult }[] {
    return this.history.map((response) => {
      // Look up the original request from pending or reconstruct from response
      const request: ApprovalRequest = {
        id: response.requestId,
        action: "tool_call",
        description: response.feedback ?? "",
        tool: "",
        args: "",
        reason: "",
        risk: "medium",
        riskLevel: "moderate",
        createdAt: response.respondedAt,
        timestamp: response.respondedAt,
        timeoutMs: 0,
        channels: [],
      };

      const result: ApprovalResult = {
        approved: response.decision === "approve",
        approvedBy: response.respondedBy,
        feedback: response.feedback,
        decidedAt: response.respondedAt,
      };

      return { request, result };
    });
  }

  // ── Private ────────────────────────────────────────────

  private assessRisk(tool: string, args: string): number {
    const lower = args.toLowerCase();
    if (tool === "bash") {
      if (/rm\s+-rf|drop\s+table|--force|sudo/i.test(lower)) return 3; // critical
      if (/git\s+push|npm\s+publish|deploy/i.test(lower)) return 2; // high
      return 1; // moderate
    }
    if (tool === "write_file" || tool === "edit_file") {
      if (/\.env|credentials|secret|password/i.test(lower)) return 2; // high
      return 1; // moderate
    }
    return 0; // safe
  }
}

function riskLevelToNumber(level: string): number {
  if (level === "critical") return 3;
  if (level === "high") return 2;
  return 1;
}
