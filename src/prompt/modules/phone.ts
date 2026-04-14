/**
 * Phone prompt module -- iOS companion device capabilities.
 * When phone is connected, tells the model what phone features are available.
 * Enables "node.invoke" RPC calls to access camera, GPS, contacts, etc.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const phonePromptModule: PromptModuleEntry = {
  name: "phone",
  priority: 82,
  build(ctx: PromptContext): readonly string[] {
    if (!ctx.phoneConnected) return [];
    const capabilities: string[] = [];
    const available = ctx.phoneCapabilities ?? [];

    if (available.length === 0) {
      // Default capabilities when phone is connected but no capability list provided
      return [
        "iPhone connected via Bridge. Available device capabilities:",
        "- camera.snap: Take photo, return as base64",
        "- location.get: Current GPS coordinates",
        "- clipboard.get/set: Read/write phone clipboard",
        "- contacts.search: Search contacts (read-only)",
        "- calendar.events: Upcoming events",
        "- notification.local: Schedule local notification",
        "Use node.invoke({capability, params}) to access these.",
      ];
    }

    capabilities.push("iPhone connected. Available capabilities:");
    for (const cap of available.slice(0, 12)) {
      capabilities.push(`- ${cap}`);
    }
    capabilities.push("Use node.invoke({capability, params}) to access these.");
    return capabilities;
  },
};
