/**
 * UserPromptSubmit hook that injects the rendered guidance whisper
 * (block memory + queued whispers) as `contextPrefix`. Wired into the
 * built-in registration so every fresh install gets letta-style core
 * memory by default. Disable with `WOTANN_DISABLE_WHISPER=1`.
 */

import type { HookHandler, HookPayload, HookResult } from "../hooks/engine.js";
import { renderWhisper, WhisperChannel } from "./guidance-whisper.js";

export function createWhisperHook(channel?: WhisperChannel): HookHandler {
  const ch = channel ?? WhisperChannel.create();
  return {
    name: "GuidanceWhisper",
    event: "UserPromptSubmit",
    profile: "minimal",
    priority: 50,
    handler(_payload: HookPayload): HookResult {
      if (process.env.WOTANN_DISABLE_WHISPER === "1") {
        return { action: "allow" };
      }
      const rendered = renderWhisper(ch);
      if (!rendered) return { action: "allow" };
      return { action: "allow", contextPrefix: rendered };
    },
  };
}

/**
 * Convenience helper used by tests: returns the channel + the hook so
 * tests can enqueue whispers and observe the resulting contextPrefix
 * without having to know the channel-binding plumbing.
 */
export function createWhisperHookWithChannel(): {
  hook: HookHandler;
  channel: WhisperChannel;
} {
  const channel = WhisperChannel.create();
  return { hook: createWhisperHook(channel), channel };
}
