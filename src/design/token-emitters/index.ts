/**
 * Barrel export for design-token emitters.
 *
 * Each emitter takes the canonical `WotannTokens` object and produces a
 * surface-specific representation. The generator script in
 * `scripts/generate-tokens.mjs` wires them up to write files on disk.
 */

export { emitTui, type TuiEmission } from "./tui.js";
export { emitDesktop, type DesktopEmission } from "./desktop.js";
export { emitIos, type IosEmission } from "./ios.js";
export { emitW3cTokens, emitW3cTokensJson, type W3cTokenTree } from "./w3c-tokens.js";
