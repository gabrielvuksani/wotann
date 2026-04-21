/**
 * TUI token emitter (Ink/terminal).
 *
 * The TUI consumes palette values directly as hex strings (Ink's `<Text
 * color="#...">`), so the emitter is a thin pass-through. Still useful
 * because it: (a) returns only the keys Ink needs, and (b) is the
 * idiomatic way for TUI code to reach into the unified token graph.
 */

import type { CanonicalPaletteName, Palette, WotannTokens } from "../tokens.js";

export interface TuiEmission {
  readonly palettes: Readonly<Record<CanonicalPaletteName, Palette>>;
  readonly severity: {
    readonly green: string;
    readonly yellow: string;
    readonly orange: string;
    readonly red: string;
    readonly accent: string;
    readonly accentMuted: string;
  };
}

export function emitTui(tokens: WotannTokens): TuiEmission {
  const dark = tokens.palettes.dark;
  return {
    palettes: tokens.palettes,
    severity: {
      green: dark.hudGreen,
      yellow: dark.hudYellow,
      orange: dark.hudOrange,
      red: dark.hudRed,
      accent: dark.accent,
      accentMuted: dark.accentMuted,
    },
  };
}
