/**
 * Automations panel — list, toggle, create, delete event-driven automations.
 *
 * Mirrors the `automations.list / .create / .update / .delete` RPC handlers
 * in src/daemon/kairos-rpc.ts. The TUI runs in-process, so we instantiate
 * an AutomationEngine directly. The engine reads/writes the same on-disk
 * config (`~/.wotann/automations.json`) the daemon's engine uses, so any
 * automation created here is picked up by the daemon on its next start
 * (and vice versa).
 *
 * UX model:
 *   - List view shows id, name, trigger type, enabled state, run count.
 *   - j/k or Up/Down to navigate; T toggles enabled; D deletes (single
 *     press; the on-disk file is the source of truth and a re-create is
 *     a single C+name+trigger sequence so a confirm prompt would be
 *     overkill for the common case).
 *   - C enters create mode: prompt for name, then for trigger type
 *     (cron|file_changed). Trigger params get sane defaults so the
 *     panel can finish a creation in two prompts; users tune the
 *     details by editing automations.json or via the daemon.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PALETTES } from "../themes.js";
import { buildTone, glyph } from "../theme/tokens.js";
import { Card, KeyHintBar, Notification } from "./primitives/index.js";
import type { AutomationConfig, AutomationEngine } from "../../daemon/automations.js";

interface AutomationsPanelProps {
  readonly onClose: () => void;
}

interface AutomationsState {
  readonly automations: readonly AutomationConfig[];
  readonly notice: {
    readonly kind: "info" | "success" | "warning" | "danger";
    readonly text: string;
  } | null;
}

const EMPTY_STATE: AutomationsState = { automations: [], notice: null };
const MAX_VISIBLE = 10;

const FOOTER_HINTS = [
  { keys: "j/k", description: "navigate" },
  { keys: "T", description: "toggle enabled" },
  { keys: "C", description: "create" },
  { keys: "D", description: "delete" },
  { keys: "R", description: "refresh" },
  { keys: "Esc", description: "close" },
];

const CREATE_NAME_HINTS = [
  { keys: "Enter", description: "next: trigger type" },
  { keys: "Esc", description: "cancel" },
];

const CREATE_TRIGGER_HINTS = [
  { keys: "1", description: "cron (5min)" },
  { keys: "2", description: "file_changed (**/*)" },
  { keys: "Esc", description: "cancel" },
];

type CreateStep = { readonly kind: "name" } | { readonly kind: "trigger"; readonly name: string };

/**
 * Lazy-load the AutomationEngine class and instantiate a fresh engine.
 * Each call creates a new instance — the engine is cheap (no daemon
 * background work happens unless start() is called) and reads its
 * config from the same JSON file as the daemon.
 */
async function makeEngine(): Promise<AutomationEngine> {
  const mod = await import("../../daemon/automations.js");
  const engine = new mod.AutomationEngine();
  engine.loadConfig();
  return engine;
}

async function loadAutomations(): Promise<AutomationsState> {
  try {
    const engine = await makeEngine();
    const automations = engine.listAutomations();
    return { automations, notice: null };
  } catch (err) {
    return {
      automations: [],
      notice: {
        kind: "danger",
        text: `Failed to load automations: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/**
 * Default agent config used when the user creates an automation through
 * the panel. Honest stub: model/maxTurns are sensible but real users
 * will edit the JSON to tune. Matches the shape AutomationConfig demands.
 */
const DEFAULT_AGENT_CONFIG = Object.freeze({
  model: "claude-sonnet-4-5",
  systemPrompt: "You are a WOTANN automation agent.",
  maxTurns: 5,
  maxCost: 1.0,
});

export function AutomationsPanel({ onClose }: AutomationsPanelProps): React.ReactElement {
  const tone = buildTone(PALETTES.dark);
  const [state, setState] = useState<AutomationsState>(EMPTY_STATE);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [createStep, setCreateStep] = useState<CreateStep | null>(null);
  const [draftName, setDraftName] = useState("");

  const refresh = useCallback((): void => {
    void loadAutomations().then(setState);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const automations = state.automations;
  const clampedIndex = Math.min(selectedIndex, Math.max(0, automations.length - 1));

  const toggleSelected = useCallback(async (): Promise<void> => {
    const target = automations[clampedIndex];
    if (!target) return;
    try {
      const engine = await makeEngine();
      const updated = engine.updateAutomation(target.id, { enabled: !target.enabled });
      if (!updated) {
        setState((prev) => ({
          ...prev,
          notice: { kind: "warning", text: `Automation not found: ${target.id}` },
        }));
        return;
      }
      const next = await loadAutomations();
      setState({
        automations: next.automations,
        notice: {
          kind: "success",
          text: `${updated.enabled ? "Enabled" : "Disabled"}: ${updated.name}`,
        },
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        notice: {
          kind: "danger",
          text: `Toggle failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      }));
    }
  }, [automations, clampedIndex]);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const target = automations[clampedIndex];
    if (!target) return;
    try {
      const engine = await makeEngine();
      const ok = engine.deleteAutomation(target.id);
      if (!ok) {
        setState((prev) => ({
          ...prev,
          notice: { kind: "warning", text: `Not found: ${target.id}` },
        }));
        return;
      }
      const next = await loadAutomations();
      setState({
        automations: next.automations,
        notice: { kind: "success", text: `Deleted: ${target.name}` },
      });
      setSelectedIndex((prev) => Math.max(0, Math.min(prev, next.automations.length - 1)));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        notice: {
          kind: "danger",
          text: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      }));
    }
  }, [automations, clampedIndex]);

  const createWithTrigger = useCallback(
    async (name: string, triggerKind: "cron" | "file_changed"): Promise<void> => {
      try {
        const engine = await makeEngine();
        const trigger =
          triggerKind === "cron"
            ? { type: "cron" as const, schedule: "*/5 * * * *" }
            : { type: "file_changed" as const, patterns: ["**/*"], debounceMs: 1000 };
        const created = engine.createAutomation({
          name,
          enabled: true,
          trigger,
          agentConfig: { ...DEFAULT_AGENT_CONFIG },
          memoryScope: "isolated",
        });
        const next = await loadAutomations();
        setState({
          automations: next.automations,
          notice: { kind: "success", text: `Created: ${created.name}` },
        });
        setCreateStep(null);
        setDraftName("");
      } catch (err) {
        setState((prev) => ({
          ...prev,
          notice: {
            kind: "danger",
            text: `Create failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        }));
        setCreateStep(null);
        setDraftName("");
      }
    },
    [],
  );

  useInput((input, key) => {
    if (createStep !== null) {
      if (key.escape) {
        setCreateStep(null);
        setDraftName("");
        return;
      }
      if (createStep.kind === "name") {
        if (key.return) {
          if (draftName.trim().length === 0) {
            setState((prev) => ({
              ...prev,
              notice: { kind: "warning", text: "Name required." },
            }));
            return;
          }
          setCreateStep({ kind: "trigger", name: draftName.trim() });
          return;
        }
        if (key.backspace || key.delete) {
          setDraftName((prev) => prev.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setDraftName((prev) => prev + input);
        }
        return;
      }
      // trigger step
      if (input === "1") {
        void createWithTrigger(createStep.name, "cron");
        return;
      }
      if (input === "2") {
        void createWithTrigger(createStep.name, "file_changed");
        return;
      }
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(Math.max(0, automations.length - 1), prev + 1));
      return;
    }
    if (input === "t" || input === "T") {
      void toggleSelected();
      return;
    }
    if (input === "d" || input === "D") {
      void deleteSelected();
      return;
    }
    if (input === "c" || input === "C") {
      setCreateStep({ kind: "name" });
      setDraftName("");
      return;
    }
    if (input === "r" || input === "R") {
      refresh();
      return;
    }
  });

  const visibleStart = Math.max(0, clampedIndex - Math.floor(MAX_VISIBLE / 2));
  const visibleEntries = automations.slice(visibleStart, visibleStart + MAX_VISIBLE);

  const renderCreateStep = (): React.ReactElement | null => {
    if (createStep === null) return null;
    if (createStep.kind === "name") {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text color={tone.warning} bold>
              Create — name:
            </Text>
            <Text color={tone.text}>{draftName}</Text>
            <Text color={tone.primary}>{glyph.cursorBlock}</Text>
          </Box>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color={tone.warning} bold>
            Trigger for "{createStep.name}":
          </Text>
        </Box>
        <Box gap={2} marginTop={0}>
          <Text color={tone.primary}>1) cron (every 5 min)</Text>
          <Text color={tone.primary}>2) file_changed (** / *)</Text>
        </Box>
      </Box>
    );
  };

  return (
    <Card
      tone={tone}
      title="Automations"
      meta={`${automations.length} configured`}
      accent="primary"
    >
      <Box flexDirection="column">
        {automations.length === 0 && createStep === null && (
          <Text color={tone.muted}>No automations yet. Press C to create one.</Text>
        )}

        {createStep === null &&
          visibleEntries.map((entry, displayIdx) => {
            const absoluteIdx = visibleStart + displayIdx;
            const isSelected = absoluteIdx === clampedIndex;
            return (
              <Box key={entry.id} gap={1}>
                <Text color={isSelected ? tone.primary : tone.border}>
                  {isSelected ? glyph.pointer : " "}
                </Text>
                <Text color={entry.enabled ? tone.success : tone.muted}>
                  {entry.enabled ? glyph.statusActive : glyph.statusIdle}
                </Text>
                <Text color={tone.text} bold={isSelected}>
                  {entry.name}
                </Text>
                <Text color={tone.muted}>[{entry.trigger.type}]</Text>
                <Text color={tone.muted}>runs={entry.runCount}</Text>
              </Box>
            );
          })}

        {renderCreateStep()}

        {state.notice !== null && (
          <Box marginTop={1}>
            <Notification tone={tone} kind={state.notice.kind} title={state.notice.text} />
          </Box>
        )}

        <Box marginTop={1}>
          <KeyHintBar
            bindings={
              createStep === null
                ? FOOTER_HINTS
                : createStep.kind === "name"
                  ? CREATE_NAME_HINTS
                  : CREATE_TRIGGER_HINTS
            }
            tone={tone}
          />
        </Box>
      </Box>
    </Card>
  );
}
