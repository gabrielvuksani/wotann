/**
 * Surfaces prompt module — connected devices and their capabilities.
 * WOTANN runs across 5 surfaces: CLI, Desktop, iOS, Watch, CarPlay.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const surfacesPromptModule: PromptModuleEntry = {
  name: "surfaces",
  priority: 85,
  build(ctx: PromptContext): readonly string[] {
    const surfaces = ctx.connectedSurfaces;
    if (!surfaces || surfaces.length === 0) {
      return ["Connected surfaces: CLI only."];
    }

    const parts: string[] = [`Connected surfaces: ${surfaces.join(", ")}.`];

    if (surfaces.includes("desktop")) {
      parts.push("Desktop: Monaco editor, file tree, terminal, split-pane chat, agent dashboard, exploit workspace.");
    }
    if (surfaces.includes("ios")) {
      parts.push("iOS companion: relay tasks, voice input, receive notifications, approve actions remotely, dispatch from phone.");
    }
    if (surfaces.includes("watch")) {
      parts.push("Apple Watch: approve/reject agent actions from wrist, view task status, cost tracking.");
    }
    if (surfaces.includes("carplay")) {
      parts.push("CarPlay: voice-only agent interface for hands-free coding questions.");
    }

    return parts;
  },
};
