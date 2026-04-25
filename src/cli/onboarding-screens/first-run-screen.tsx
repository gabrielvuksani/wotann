/**
 * FirstRunScreen — Onboarding wizard screen 5.
 *
 * Streams `runFirstRunSuccess` into a live viewport. Renders a banner,
 * an incrementally-built streamed body, and a terminal success/failure
 * card. Extracted from src/cli/onboarding-screens.tsx during the V9
 * onboarding-screens split (>800 LOC ceiling enforcement).
 *
 * QB #6 honest failures: roundtrip-failed renders as a distinct visual
 * branch with the reason + a retry hint.
 * QB #7 per-mount state: all state lives in React hooks; no module-
 * level caches.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ProviderRung } from "../../providers/provider-ladder.js";
import type { FirstRunEvent, FirstRunQueryRunner } from "../first-run-success.js";
import { runFirstRunSuccess } from "../first-run-success.js";

export interface FirstRunScreenProps {
  readonly rung: ProviderRung;
  readonly modelLabel: string;
  readonly runner: FirstRunQueryRunner;
  readonly onFinish: (outcome: { ok: boolean; reason?: string }) => void;
}

export function FirstRunScreen({
  rung,
  modelLabel,
  runner,
  onFinish,
}: FirstRunScreenProps): React.ReactElement {
  const [events, setEvents] = React.useState<readonly FirstRunEvent[]>([]);
  const [streamed, setStreamed] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        for await (const evt of runFirstRunSuccess({
          selectedRung: rung,
          modelLabel,
          runner,
        })) {
          if (cancelled) return;
          setEvents((prev) => [...prev, evt]);
          if (evt.type === "roundtrip-chunk") {
            setStreamed((prev) => prev + evt.text);
          }
          if (evt.type === "roundtrip-done") {
            onFinish({ ok: true });
          } else if (evt.type === "roundtrip-failed") {
            onFinish({ ok: false, reason: evt.reason });
          }
        }
      } catch (err) {
        if (!cancelled) {
          onFinish({
            ok: false,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rung, modelLabel, runner, onFinish]);

  const banner = events.find((e) => e.type === "banner");
  const done = events.find((e) => e.type === "roundtrip-done");
  const failed = events.find((e) => e.type === "roundtrip-failed");

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {banner && banner.type === "banner" && (
        <Box flexDirection="column">
          {banner.lines.map((line, i) => (
            <Text key={`banner-${i}`} color={i < 3 ? "cyan" : undefined}>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {streamed && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text>{streamed}</Text>
        </Box>
      )}
      {done && done.type === "roundtrip-done" && (
        <Box marginTop={1}>
          <Text color="green">
            ✔ Success · {done.durationMs}ms · {done.tokensUsed} tokens
          </Text>
        </Box>
      )}
      {failed && failed.type === "roundtrip-failed" && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="red"
          paddingX={1}
        >
          <Text color="red" bold>
            ✗ Roundtrip failed
          </Text>
          <Text>Reason: {failed.reason}</Text>
          <Text dimColor>Duration: {failed.durationMs}ms</Text>
          <Text dimColor>
            Tip: re-run `wotann init` once you've confirmed your provider is reachable.
          </Text>
        </Box>
      )}
    </Box>
  );
}
