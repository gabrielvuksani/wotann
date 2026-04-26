/**
 * GDPR panel — Export My Data + Delete Everything.
 *
 * Mirrors the `gdpr.export` and `gdpr.delete` RPC handlers in
 * src/daemon/kairos-rpc.ts. The TUI runs in-process, so we replicate the
 * same logic (tar of `~/.wotann` for export; recursive rm for delete)
 * locally rather than going through JSON-RPC.
 *
 * Destructive operation gating:
 *   - Export is one-shot, no confirmation needed (read-only).
 *   - Delete requires a two-step confirm — the user must press D twice
 *     within the panel. The first press flips the confirm flag and
 *     paints a danger banner; the second press fires the rm and shows
 *     the result. Esc resets the confirmation.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone } from "../theme/tokens.js";
import { Card, KeyHintBar, Notification } from "./primitives/index.js";

interface GdprPanelProps {
  readonly onClose: () => void;
}

interface GdprState {
  readonly busy: boolean;
  readonly confirmDelete: boolean;
  readonly notice: {
    readonly kind: "info" | "success" | "warning" | "danger";
    readonly title: string;
    readonly body?: string;
  } | null;
}

const INITIAL_STATE: GdprState = { busy: false, confirmDelete: false, notice: null };

const FOOTER_HINTS = [
  { keys: "E", description: "export" },
  { keys: "D", description: "delete (2x to confirm)" },
  { keys: "Esc", description: "close / cancel" },
];

/**
 * Run the same export logic the daemon's `gdpr.export` handler uses:
 * tar -czf ~/wotann-export-<ts>.tar.gz of `~/.wotann`. Returns the
 * resulting artifact path or an error message.
 */
async function runExport(): Promise<
  { ok: true; path: string; sizeBytes: number } | { ok: false; error: string }
> {
  try {
    const homeMod = await import("../../utils/wotann-home.js");
    const wotannHome = homeMod.resolveWotannHome();
    const fsMod = await import("node:fs");
    if (!fsMod.existsSync(wotannHome)) {
      return { ok: false, error: "no WOTANN home — nothing to export" };
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = process.env["TMPDIR"] ?? "/tmp";
    const pathMod = await import("node:path");
    const outPath = pathMod.join(outDir, `wotann-export-${ts}.tar.gz`);
    const execMod = await import("../../utils/execFileNoThrow.js");
    const result = await execMod.execFileNoThrow("tar", [
      "-czf",
      outPath,
      "-C",
      pathMod.dirname(wotannHome),
      pathMod.basename(wotannHome),
    ]);
    if (result.exitCode !== 0) {
      return { ok: false, error: `tar exited ${result.exitCode}: ${result.stderr.trim()}` };
    }
    const fsAsync = await import("node:fs/promises");
    const stat = await fsAsync.stat(outPath);
    return { ok: true, path: outPath, sizeBytes: stat.size };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run the same delete logic the daemon's `gdpr.delete` handler uses:
 * `fs.rm(~/.wotann, { recursive: true, force: true })`.
 */
async function runDelete(): Promise<{ ok: true; deleted: string } | { ok: false; error: string }> {
  try {
    const homeMod = await import("../../utils/wotann-home.js");
    const wotannHome = homeMod.resolveWotannHome();
    const fsMod = await import("node:fs");
    if (!fsMod.existsSync(wotannHome)) {
      return { ok: false, error: "no WOTANN home — nothing to delete" };
    }
    const fsAsync = await import("node:fs/promises");
    await fsAsync.rm(wotannHome, { recursive: true, force: true });
    return { ok: true, deleted: wotannHome };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function GdprPanel({ onClose }: GdprPanelProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [state, setState] = useState<GdprState>(INITIAL_STATE);

  const handleExport = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, busy: true, notice: null }));
    const result = await runExport();
    if (result.ok) {
      setState({
        busy: false,
        confirmDelete: false,
        notice: {
          kind: "success",
          title: "Export complete",
          body: `${result.path} (${(result.sizeBytes / 1024).toFixed(1)} KiB)`,
        },
      });
    } else {
      setState({
        busy: false,
        confirmDelete: false,
        notice: { kind: "danger", title: "Export failed", body: result.error },
      });
    }
  }, []);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!state.confirmDelete) {
      setState((prev) => ({
        ...prev,
        confirmDelete: true,
        notice: {
          kind: "warning",
          title: "Press D again to confirm — this deletes ~/.wotann",
          body: "Esc cancels.",
        },
      }));
      return;
    }
    setState((prev) => ({ ...prev, busy: true, notice: null }));
    const result = await runDelete();
    if (result.ok) {
      setState({
        busy: false,
        confirmDelete: false,
        notice: {
          kind: "success",
          title: "Deleted",
          body: result.deleted,
        },
      });
    } else {
      setState({
        busy: false,
        confirmDelete: false,
        notice: { kind: "danger", title: "Delete failed", body: result.error },
      });
    }
  }, [state.confirmDelete]);

  useInput((input, key) => {
    if (state.busy) return;
    if (key.escape) {
      if (state.confirmDelete) {
        setState((prev) => ({ ...prev, confirmDelete: false, notice: null }));
        return;
      }
      onClose();
      return;
    }
    if (input === "e" || input === "E") {
      void handleExport();
      return;
    }
    if (input === "d" || input === "D") {
      void handleDelete();
      return;
    }
  });

  return (
    <Card tone={tone} title="GDPR Tools" accent="primary">
      <Box flexDirection="column">
        <Text color={tone.muted}>
          Export gathers ~/.wotann into a tar.gz under your TMPDIR. Delete removes ~/.wotann
          recursively — there is no recovery.
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Box gap={1}>
            <Text color={tone.primary} bold>
              [E]
            </Text>
            <Text color={tone.text}>Export My Data</Text>
            {state.busy && <Text color={tone.muted}>(running…)</Text>}
          </Box>
          <Box gap={1}>
            <Text color={state.confirmDelete ? tone.danger : tone.primary} bold>
              [D]
            </Text>
            <Text color={tone.text}>Delete Everything</Text>
            {state.confirmDelete && <Text color={tone.danger}>(press D again to confirm)</Text>}
          </Box>
        </Box>

        {state.notice !== null && (
          <Box marginTop={1}>
            <Notification
              tone={tone}
              kind={state.notice.kind}
              title={state.notice.title}
              {...(state.notice.body !== undefined ? { body: state.notice.body } : {})}
            />
          </Box>
        )}

        <Box marginTop={1}>
          <KeyHintBar bindings={FOOTER_HINTS} tone={tone} />
        </Box>
      </Box>
    </Card>
  );
}
