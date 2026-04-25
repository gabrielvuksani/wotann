/**
 * Wave 2 barrel — V9 T3.3.
 *
 * Re-exports:
 *   - 6 handler factories (one per event)
 *   - HTTP server start/close
 *   - Hook config builder for the `claude --hooks-config` flag
 */

export { createSessionStartHandler } from "./session-start.js";
export { createUserPromptSubmitHandler } from "./user-prompt-submit.js";
export { createPreToolUseHandler } from "./pre-tool-use.js";
export { createPostToolUseHandler } from "./post-tool-use.js";
export { createStopHandler } from "./stop.js";
export { createPreCompactHandler } from "./pre-compact.js";

export { startHookServer, getHookRoutes } from "./server.js";
export type { HookServerOptions, HookServerHandle } from "./server.js";

export { buildHookConfig, writeHookConfigFile } from "./config-builder.js";
export type { HookConfigJson, HookEntry } from "./config-builder.js";
