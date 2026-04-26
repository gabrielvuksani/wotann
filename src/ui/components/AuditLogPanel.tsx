/**
 * Audit log panel — last 50 audit entries with type filter.
 *
 * Mirrors the `audit.query` RPC handler in src/daemon/kairos-rpc.ts. The
 * TUI runs in-process, so we open the AuditTrail SQLite directly using
 * the same dbPath the handler uses (`~/.wotann/audit.db`). Uses the
 * AuditTrail.query() API so filters stay consistent with the RPC.
 *
 * Filter UX: pressing F enters filter mode where typed characters
 * accumulate into a `tool=` filter; Enter applies it, Esc cancels filter
 * mode (or closes the panel when not filtering). The filter is plumbed
 * through AuditQuery so SQL stays parameterized — no string concat.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Card, KeyHintBar, Notification } from "./primitives/index.js";
import type { AuditEntry, AuditQuery } from "../../telemetry/audit-trail.js";

interface AuditLogPanelProps {
  readonly onClose: () => void;
  /** Hard cap on how many rows we render. Mirrors the RPC default. */
  readonly limit?: number;
}

interface AuditState {
  readonly entries: readonly AuditEntry[];
  readonly totalCount: number;
  readonly notice: { readonly kind: "info" | "warning" | "danger"; readonly text: string } | null;
}

const EMPTY_STATE: AuditState = { entries: [], totalCount: 0, notice: null };
const MAX_VISIBLE = 14;
const DEFAULT_LIMIT = 50;

const FOOTER_HINTS = [
  { keys: "j/k", description: "scroll" },
  { keys: "F", description: "filter by tool" },
  { keys: "C", description: "clear filter" },
  { keys: "R", description: "refresh" },
  { keys: "Esc", description: "close" },
];

const FILTER_HINTS = [
  { keys: "Enter", description: "apply filter" },
  { keys: "Esc", description: "cancel" },
  { keys: "Backspace", description: "delete char" },
];

/**
 * Open the audit trail at `~/.wotann/audit.db` (the daemon's path) and
 * return the last `limit` entries. The trail is closed before returning
 * so SQLite handles don't leak across panel mounts.
 */
async function loadAuditEntries(filter: string, limit: number): Promise<AuditState> {
  try {
    const homeMod = await import("../../utils/wotann-home.js");
    const dbPath = homeMod.resolveWotannHomeSubdir("audit.db");
    const fsMod = await import("node:fs");
    if (!fsMod.existsSync(dbPath)) {
      return {
        entries: [],
        totalCount: 0,
        notice: { kind: "info", text: `No audit DB at ${dbPath} — nothing recorded yet.` },
      };
    }
    const trailMod = await import("../../telemetry/audit-trail.js");
    const trail = new trailMod.AuditTrail(dbPath);
    try {
      const filters: AuditQuery = { limit };
      if (filter.length > 0) {
        // The task asked for "filter by type" — `tool` is the closest
        // analogue in AuditQuery. Keep it parameterized via the API.
        Object.assign(filters as Record<string, unknown>, { tool: filter });
      }
      const entries = trail.query(filters);
      const totalCount = trail.getCount();
      return { entries, totalCount, notice: null };
    } finally {
      trail.close();
    }
  } catch (err) {
    return {
      entries: [],
      totalCount: 0,
      notice: {
        kind: "danger",
        text: `Audit query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

function formatTimestamp(ts: string): string {
  // ISO 8601 — show date + HH:MM:SS, drop the year + ms for readability
  if (ts.length < 19) return ts;
  return `${ts.slice(5, 10)} ${ts.slice(11, 19)}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function AuditLogPanel({
  onClose,
  limit = DEFAULT_LIMIT,
}: AuditLogPanelProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [state, setState] = useState<AuditState>(EMPTY_STATE);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [draftFilter, setDraftFilter] = useState("");

  const refresh = useCallback(
    (activeFilter: string): void => {
      void loadAuditEntries(activeFilter, limit).then((next) => {
        setState(next);
        setScrollOffset(0);
      });
    },
    [limit],
  );

  useEffect(() => {
    refresh(filter);
  }, [refresh, filter]);

  const entries = state.entries;
  const visibleEntries = entries.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

  useInput((input, key) => {
    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setDraftFilter("");
        return;
      }
      if (key.return) {
        setFilter(draftFilter.trim());
        setFilterMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setDraftFilter((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setDraftFilter((prev) => prev + input);
      }
      return;
    }
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || input === "k") {
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setScrollOffset((prev) => Math.min(Math.max(0, entries.length - MAX_VISIBLE), prev + 1));
      return;
    }
    if (input === "f" || input === "F") {
      setFilterMode(true);
      setDraftFilter(filter);
      return;
    }
    if (input === "c" || input === "C") {
      setFilter("");
      return;
    }
    if (input === "r" || input === "R") {
      refresh(filter);
      return;
    }
  });

  return (
    <Card
      tone={tone}
      title="Audit Log"
      meta={`${entries.length}/${state.totalCount}`}
      accent="primary"
    >
      <Box flexDirection="column">
        {filterMode ? (
          <Box gap={1}>
            <Text color={tone.warning} bold>
              filter tool=
            </Text>
            <Text color={tone.text}>{draftFilter}</Text>
            <Text color={tone.primary}>{glyph.cursorBlock}</Text>
          </Box>
        ) : filter.length > 0 ? (
          <Box gap={1}>
            <Text color={tone.muted}>filter:</Text>
            <Text color={tone.warning}>tool={filter}</Text>
          </Box>
        ) : (
          <Text color={tone.muted}>showing last {limit} entries (no filter)</Text>
        )}

        <Box flexDirection="column" marginTop={1}>
          {visibleEntries.length === 0 && (
            <Text color={tone.muted}>No matching audit entries.</Text>
          )}
          {visibleEntries.map((entry) => (
            <Box key={entry.id} gap={1}>
              <Text color={tone.muted}>{formatTimestamp(entry.timestamp)}</Text>
              <Text color={tone.primary}>{truncate(entry.tool, 14).padEnd(14)}</Text>
              <Text color={tone.warning}>{entry.riskLevel.padEnd(8)}</Text>
              <Text color={entry.success ? tone.success : tone.danger}>
                {entry.success ? glyph.statusOk : glyph.statusFail}
              </Text>
              <Text color={tone.text}>{truncate(entry.input ?? "", 40)}</Text>
            </Box>
          ))}
        </Box>

        {state.notice !== null && (
          <Box marginTop={1}>
            <Notification tone={tone} kind={state.notice.kind} title={state.notice.text} />
          </Box>
        )}

        <Box marginTop={1}>
          <KeyHintBar bindings={filterMode ? FILTER_HINTS : FOOTER_HINTS} tone={tone} />
        </Box>
      </Box>
    </Card>
  );
}
