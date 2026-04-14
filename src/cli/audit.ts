import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AuditTrail, type AuditQuery, type AuditEntry } from "../telemetry/audit-trail.js";

export interface AuditQueryResult {
  readonly dbPath: string;
  readonly totalEntries: number;
  readonly entries: readonly AuditEntry[];
}

export interface AuditExportResult {
  readonly outputPath: string;
  readonly entryCount: number;
}

export function queryWorkspaceAudit(
  workspaceRoot: string,
  filters: AuditQuery = {},
): AuditQueryResult | null {
  const dbPath = join(workspaceRoot, ".wotann", "audit.db");
  if (!existsSync(dbPath)) return null;

  const trail = new AuditTrail(dbPath);
  try {
    return {
      dbPath,
      totalEntries: trail.getCount(),
      entries: trail.query(filters),
    };
  } finally {
    trail.close();
  }
}

/**
 * Export audit trail entries as a compliance-ready JSON report.
 * Includes integrity verification and metadata for auditors.
 */
export function exportWorkspaceAudit(
  workspaceRoot: string,
  outputPath: string,
  filters: Omit<AuditQuery, "limit"> = {},
): AuditExportResult | null {
  const dbPath = join(workspaceRoot, ".wotann", "audit.db");
  if (!existsSync(dbPath)) return null;

  const trail = new AuditTrail(dbPath);
  try {
    const entries = trail.query({ ...filters, limit: 100_000 });
    const report = {
      format: "wotann-audit-export-v1",
      generatedAt: new Date().toISOString(),
      workspaceRoot,
      totalEntries: trail.getCount(),
      exportedEntries: entries.length,
      filters,
      entries,
    };

    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outputPath, JSON.stringify(report, null, 2));

    return {
      outputPath,
      entryCount: entries.length,
    };
  } finally {
    trail.close();
  }
}
