/**
 * Decision Ledger — cross-session decision tracking with rationale.
 *
 * Records architectural and design decisions, searches past decisions,
 * retrieves decisions by file/module, and exports as markdown.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomicSyncBestEffort } from "../utils/atomic-io.js";

// ── Types ─��───────────────────────────────────────────────

export interface Decision {
  readonly id: string;
  readonly timestamp: string;
  readonly title: string;
  readonly description: string;
  readonly rationale: string;
  readonly alternatives: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly tags: readonly string[];
  readonly status: "active" | "superseded" | "reverted";
  readonly supersededBy?: string;
}

export type DecisionInput = Omit<Decision, "id" | "timestamp" | "status">;

// ── Ledger ───────��────────────────────────────────────────

export class DecisionLedger {
  private readonly decisions: Map<string, Decision> = new Map();

  /**
   * Record a new decision with rationale.
   * Returns the generated ID.
   */
  recordDecision(input: DecisionInput): string {
    const id = randomUUID();
    const decision: Decision = {
      ...input,
      id,
      timestamp: new Date().toISOString(),
      status: "active",
    };
    this.decisions.set(id, decision);
    return id;
  }

  /**
   * Search past decisions by query string.
   * Matches against title, description, rationale, and tags.
   */
  searchDecisions(query: string): readonly Decision[] {
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

    if (keywords.length === 0) {
      return [...this.decisions.values()];
    }

    return [...this.decisions.values()]
      .filter((d) => {
        const searchable = [
          d.title,
          d.description,
          d.rationale,
          ...d.tags,
          ...d.alternatives,
        ]
          .join(" ")
          .toLowerCase();

        return keywords.some((kw) => searchable.includes(kw));
      })
      .sort((a, b) => {
        // More recent first
        return b.timestamp.localeCompare(a.timestamp);
      });
  }

  /**
   * Get all decisions affecting a specific file path.
   */
  getDecisionsForFile(filePath: string): readonly Decision[] {
    const normalizedPath = filePath.replace(/\\/g, "/");

    return [...this.decisions.values()].filter((d) =>
      d.affectedFiles.some((f) => {
        const normalized = f.replace(/\\/g, "/");
        return (
          normalized === normalizedPath ||
          normalizedPath.includes(normalized) ||
          normalized.includes(normalizedPath)
        );
      }),
    );
  }

  /**
   * Get a single decision by ID.
   */
  getDecision(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  /**
   * Mark a decision as superseded by another.
   */
  supersedeDecision(id: string, supersededById: string): boolean {
    const existing = this.decisions.get(id);
    if (!existing) return false;

    this.decisions.set(id, {
      ...existing,
      status: "superseded",
      supersededBy: supersededById,
    });
    return true;
  }

  /**
   * Mark a decision as reverted.
   */
  revertDecision(id: string): boolean {
    const existing = this.decisions.get(id);
    if (!existing) return false;

    this.decisions.set(id, {
      ...existing,
      status: "reverted",
    });
    return true;
  }

  /**
   * Get all decisions.
   */
  getAllDecisions(): readonly Decision[] {
    return [...this.decisions.values()].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
  }

  /**
   * Get count of decisions.
   */
  getCount(): number {
    return this.decisions.size;
  }

  /**
   * Get count by status.
   */
  getCountByStatus(): Record<Decision["status"], number> {
    const counts: Record<Decision["status"], number> = {
      active: 0,
      superseded: 0,
      reverted: 0,
    };

    for (const d of this.decisions.values()) {
      counts[d.status]++;
    }

    return counts;
  }

  /**
   * Export all decisions as markdown.
   */
  exportMarkdown(): string {
    const decisions = this.getAllDecisions();
    const lines: string[] = [];

    lines.push("# Decision Ledger");
    lines.push("");
    lines.push(
      `Generated: ${new Date().toISOString()} | Total: ${decisions.length}`,
    );
    lines.push("");

    if (decisions.length === 0) {
      lines.push("No decisions recorded.");
      return lines.join("\n");
    }

    for (const d of decisions) {
      const statusBadge =
        d.status === "active"
          ? "[ACTIVE]"
          : d.status === "superseded"
            ? "[SUPERSEDED]"
            : "[REVERTED]";

      lines.push(`## ${statusBadge} ${d.title}`);
      lines.push("");
      lines.push(`**Date:** ${d.timestamp}`);
      lines.push(`**ID:** ${d.id}`);
      if (d.tags.length > 0) {
        lines.push(`**Tags:** ${d.tags.join(", ")}`);
      }
      lines.push("");
      lines.push(`**Decision:** ${d.description}`);
      lines.push("");
      lines.push(`**Rationale:** ${d.rationale}`);
      lines.push("");

      if (d.alternatives.length > 0) {
        lines.push("**Alternatives Considered:**");
        for (const alt of d.alternatives) {
          lines.push(`- ${alt}`);
        }
        lines.push("");
      }

      if (d.affectedFiles.length > 0) {
        lines.push("**Affected Files:**");
        for (const file of d.affectedFiles) {
          lines.push(`- ${file}`);
        }
        lines.push("");
      }

      if (d.supersededBy) {
        lines.push(`**Superseded by:** ${d.supersededBy}`);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Serialize all decisions to JSON for persistence.
   */
  serialize(): string {
    return JSON.stringify([...this.decisions.values()]);
  }

  /**
   * Restore from serialized JSON.
   */
  restore(serialized: string): void {
    try {
      const entries = JSON.parse(serialized) as Decision[];
      for (const entry of entries) {
        this.decisions.set(entry.id, entry);
      }
    } catch {
      // Ignore invalid data
    }
  }

  /**
   * Persist all decisions to a JSON file on disk.
   *
   * SECURITY (B6): uses atomic write + advisory lock so that a crash or
   * concurrent writer cannot leave the ledger in a half-written state. The
   * typical call pattern is: hydrate on startup via loadFromDisk(), then
   * persistToDisk() after each recordDecision/supersede/revert call.
   */
  persistToDisk(path: string): void {
    writeFileAtomicSyncBestEffort(
      path,
      this.serialize(),
      { encoding: "utf-8", mode: 0o600 },
    );
  }

  /**
   * Hydrate the ledger from a JSON file on disk. Idempotent and forgiving —
   * missing or malformed files leave the ledger unchanged.
   */
  loadFromDisk(path: string): void {
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf-8");
      this.restore(raw);
    } catch {
      // Ignore read/parse errors — preserve current in-memory state
    }
  }
}
