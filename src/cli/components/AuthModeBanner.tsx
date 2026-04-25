/**
 * AuthModeBanner — Ink banner for V9 SB-07 dual-auth surface.
 *
 * Renders the active auth mode (personal-oauth / business-api-key)
 * in a coloured box, OR — when no mode has been picked yet — a red
 * call-to-action telling the user to choose before any model call.
 *
 * Shape mirrors the existing onboarding screens (round border, bold
 * heading, dim subtext) so the banner drops into the wizard without
 * a visual seam. Owned exclusively by the SB-07 wave; safe to mount
 * standalone (e.g. by `wotann doctor`) without the wizard around it.
 *
 * Quality bars honoured:
 *   - QB#3 honest stubs: the "no-mode" branch is a distinct error
 *     state, not a silent fall-through to "personal".
 *   - QB#7 per-call state: pure rendering, no module-level cache.
 *   - QB#13 env-guard friendly: takes the mode as a prop; never
 *     reads ~/.wotann itself.
 */

import React from "react";
import { Box, Text } from "ink";
import {
  bannerLabelForMode,
  bannerTextForMode,
  bannerToneForMode,
  type AuthMode,
} from "../../auth/auth-mode.js";

export interface AuthModeBannerProps {
  /**
   * Current mode. Pass `null` when the user hasn't chosen yet — the
   * banner renders a red "must pick" prompt instead of the regular
   * coloured card. Callers SHOULD NOT default this to a mode value
   * to avoid silent vendor lock-in.
   */
  readonly mode: AuthMode | null;
  /**
   * Optional compact form — single-line label only, no description.
   * Useful in dense surfaces (HUD, status bar) where the full
   * banner would dominate. Defaults to false (full card).
   */
  readonly compact?: boolean;
}

/**
 * Render the banner. Exported as a named function (not default) so
 * tests can import it directly without dealing with module-default
 * gymnastics.
 */
export function AuthModeBanner({ mode, compact }: AuthModeBannerProps): React.ReactElement {
  // Undecided state — red box prompting the user to pick before any
  // model call lands. This is a hard ask, not a hint, because both
  // paths have policy implications (personal = no business work,
  // business = paid API key).
  if (mode === null) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Box gap={1}>
          <Text color="red" bold>
            !
          </Text>
          <Text color="red" bold>
            Auth mode not selected
          </Text>
        </Box>
        {!compact && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>WOTANN must know how you intend to use Anthropic models.</Text>
            <Text dimColor>
              Run <Text color="cyan">wotann login --mode personal</Text> for personal/Claude Pro
              use,
            </Text>
            <Text dimColor>
              or <Text color="cyan">wotann login --mode business</Text> for product/business use.
            </Text>
            <Text dimColor>
              See https://docs.anthropic.com for the full TOS — non-Claude-Code OAuth tokens are
              rejected server-side since 2026-01-09.
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Decided state — coloured card with the mode label + long-form
  // copy. Tone comes from the auth-mode helper so colour stays in
  // sync with the rest of the codebase.
  const tone = bannerToneForMode(mode);
  const label = bannerLabelForMode(mode);
  const description = bannerTextForMode(mode);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1}>
      <Box gap={1}>
        <Text color={tone} bold>
          {tone === "green" ? "✓" : "•"}
        </Text>
        <Text color={tone} bold>
          Auth mode: {label}
        </Text>
      </Box>
      {!compact && (
        <Box marginTop={1}>
          <Text dimColor>{description}</Text>
        </Box>
      )}
    </Box>
  );
}
