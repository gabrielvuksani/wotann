/**
 * Channels prompt module -- active messaging channels.
 * Tells the model which communication channels are connected
 * (Telegram, Slack, Discord, etc.) so it can route responses.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const channelsPromptModule: PromptModuleEntry = {
  name: "channels",
  priority: 50,
  build(ctx: PromptContext): readonly string[] {
    const channels = ctx.activeChannels;
    if (!channels || channels.length === 0) return [];
    return [
      `Active channels: ${channels.join(", ")}.`,
      "Messages from channels are prefixed with [channel:name]. Reply to the correct channel.",
    ];
  },
};
