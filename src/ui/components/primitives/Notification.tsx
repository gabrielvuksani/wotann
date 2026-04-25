/**
 * Notification — inline banner used to surface transient state
 * (incognito mode, ROE warnings, success toasts).
 *
 * Replaces ad-hoc `<Box paddingX=1><Text color="yellow" bold>X</Text></Box>`
 * patterns with a structured, semantically-named primitive.
 */

import React from "react";
import { Box, Text } from "ink";
import type { Tone } from "../../theme/tokens.js";
import { glyph } from "../../theme/tokens.js";

export type NotificationKind = "info" | "success" | "warning" | "danger";

interface KindStyle {
  readonly accent: keyof Tone;
  readonly icon: string;
}

const KIND_STYLES: Readonly<Record<NotificationKind, KindStyle>> = {
  info: { accent: "primary", icon: glyph.statusActive },
  success: { accent: "success", icon: glyph.statusOk },
  warning: { accent: "warning", icon: glyph.statusQueued },
  danger: { accent: "error", icon: glyph.statusFail },
};

export interface NotificationProps {
  readonly tone: Tone;
  readonly kind: NotificationKind;
  readonly title: string;
  /** Optional body text — printed dimmed below the title. */
  readonly body?: string;
  /** Render inside a rounded card (default: false — flat banner). */
  readonly framed?: boolean;
}

/**
 * Notification — render a one or two-line banner using kind-derived
 * coloring. Use `framed=true` for full-attention surfaces (modal-ish);
 * leave it false for status strips that flow inline with chat.
 */
export function Notification({
  tone,
  kind,
  title,
  body,
  framed = false,
}: NotificationProps): React.ReactElement {
  const style = KIND_STYLES[kind];
  const color = tone[style.accent];

  const content = (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={color} bold>
          {style.icon}
        </Text>
        <Text color={color} bold>
          {title}
        </Text>
      </Box>
      {body !== undefined && (
        <Box paddingLeft={2}>
          <Text color={tone.muted}>{body}</Text>
        </Box>
      )}
    </Box>
  );

  if (!framed) {
    return <Box paddingX={1}>{content}</Box>;
  }

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} flexDirection="column">
      {content}
    </Box>
  );
}
