/**
 * Canonical ChannelType and ChannelCategory definitions.
 *
 * This is the single source of truth for channel type unions across the
 * entire harness. All channel modules import from here instead of
 * defining their own ChannelType.
 *
 * Superset of every channel type previously defined in:
 *   - adapter.ts
 *   - gateway.ts
 *   - unified-router.ts
 *   - route-policies.ts
 */

export type ChannelType =
  | "telegram" | "slack" | "discord" | "signal" | "whatsapp"
  | "email" | "sms" | "matrix" | "teams" | "irc" | "mattermost"
  | "webchat" | "webhook" | "voice" | "cli"
  | "desktop-app" | "mobile-app" | "ide" | "api"
  | "google-chat" | "line"
  // Legacy aliases retained for backward compatibility with existing adapters
  | "web" | "imessage";

export type ChannelCategory =
  | "messaging" | "email" | "voice" | "developer" | "web" | "desktop" | "mobile" | "iot" | "knowledge";
