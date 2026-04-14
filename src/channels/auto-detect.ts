/**
 * Channel auto-detection from environment variables and ~/.wotann/channels.json.
 *
 * Provides a single source of truth for which channels are available
 * based on env var credentials or config file. Used by KAIROS daemon
 * and any other consumer that needs to know which adapters can be registered.
 *
 * RESOLUTION ORDER (per channel):
 * 1. ~/.wotann/channels.json credentials (if file exists and channel is configured)
 * 2. Environment variables (fallback)
 *
 * ENV VAR MAPPING:
 * - Telegram:  TELEGRAM_BOT_TOKEN
 * - Discord:   DISCORD_BOT_TOKEN
 * - Slack:     SLACK_BOT_TOKEN + SLACK_APP_TOKEN
 * - WhatsApp:  WHATSAPP_SESSION or WHATSAPP_SESSION_DIR or WHATSAPP_PHONE_NUMBER
 *
 * CONFIG FILE (~/.wotann/channels.json):
 * {
 *   "telegram": { "token": "..." },
 *   "discord": { "token": "..." },
 *   "slack": { "botToken": "...", "appToken": "..." },
 *   "whatsapp": { "sessionDir": "..." }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChannelType } from "./channel-types.js";

export interface DetectedChannel {
  readonly type: ChannelType;
  readonly available: boolean;
  readonly reason: string;
  readonly envVars: readonly string[];
}

export interface ChannelDetectionResult {
  readonly channels: readonly DetectedChannel[];
  readonly availableCount: number;
  readonly availableTypes: readonly ChannelType[];
}

/**
 * Detect which of the 4 priority channels are available based on env vars.
 * Returns detection results for each channel with reasons.
 */
export function detectPriorityChannels(): ChannelDetectionResult {
  const channels: DetectedChannel[] = [
    detectTelegram(),
    detectDiscord(),
    detectSlack(),
    detectWhatsApp(),
  ];

  const available = channels.filter((c) => c.available);

  return {
    channels,
    availableCount: available.length,
    availableTypes: available.map((c) => c.type),
  };
}

// ── Config File Types ───────────────────────────────────

export interface ChannelsConfig {
  readonly telegram?: { readonly token: string };
  readonly discord?: { readonly token: string };
  readonly slack?: { readonly botToken: string; readonly appToken: string };
  readonly whatsapp?: { readonly sessionDir: string };
}

const CHANNELS_CONFIG_PATH = join(homedir(), ".wotann", "channels.json");

/**
 * Load channel credentials from ~/.wotann/channels.json.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function loadChannelsConfig(
  configPath: string = CHANNELS_CONFIG_PATH,
): ChannelsConfig | null {
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ChannelsConfig;
  } catch {
    return null;
  }
}

// ── Credential Resolution ───────────────────────────────

export interface ResolvedCredentials {
  readonly telegram: { readonly token: string } | null;
  readonly discord: { readonly token: string } | null;
  readonly slack: { readonly botToken: string; readonly appToken: string } | null;
  readonly whatsapp: { readonly sessionDir: string } | null;
}

/**
 * Resolve credentials from config file, falling back to env vars.
 * Config file takes priority when both are present.
 */
export function resolveCredentials(
  configPath?: string,
): ResolvedCredentials {
  const config = loadChannelsConfig(configPath);

  return {
    telegram: resolveTelegramCreds(config),
    discord: resolveDiscordCreds(config),
    slack: resolveSlackCreds(config),
    whatsapp: resolveWhatsAppCreds(config),
  };
}

function resolveTelegramCreds(
  config: ChannelsConfig | null,
): { readonly token: string } | null {
  const token = config?.telegram?.token ?? process.env["TELEGRAM_BOT_TOKEN"];
  return token ? { token } : null;
}

function resolveDiscordCreds(
  config: ChannelsConfig | null,
): { readonly token: string } | null {
  const token = config?.discord?.token ?? process.env["DISCORD_BOT_TOKEN"];
  return token ? { token } : null;
}

function resolveSlackCreds(
  config: ChannelsConfig | null,
): { readonly botToken: string; readonly appToken: string } | null {
  const botToken = config?.slack?.botToken ?? process.env["SLACK_BOT_TOKEN"];
  const appToken = config?.slack?.appToken ?? process.env["SLACK_APP_TOKEN"];
  return botToken && appToken ? { botToken, appToken } : null;
}

function resolveWhatsAppCreds(
  config: ChannelsConfig | null,
): { readonly sessionDir: string } | null {
  const sessionDir =
    config?.whatsapp?.sessionDir
    ?? process.env["WHATSAPP_SESSION"]
    ?? process.env["WHATSAPP_SESSION_DIR"];
  return sessionDir ? { sessionDir } : null;
}

// ── Detection (env-var based, legacy) ───────────────────

function detectTelegram(): DetectedChannel {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  return {
    type: "telegram",
    available: Boolean(token),
    reason: token
      ? "TELEGRAM_BOT_TOKEN is set"
      : "Set TELEGRAM_BOT_TOKEN (create bot via @BotFather on Telegram)",
    envVars: ["TELEGRAM_BOT_TOKEN"],
  };
}

function detectDiscord(): DetectedChannel {
  const token = process.env["DISCORD_BOT_TOKEN"];
  return {
    type: "discord",
    available: Boolean(token),
    reason: token
      ? "DISCORD_BOT_TOKEN is set"
      : "Set DISCORD_BOT_TOKEN (create bot at https://discord.com/developers/applications)",
    envVars: ["DISCORD_BOT_TOKEN"],
  };
}

function detectSlack(): DetectedChannel {
  const botToken = process.env["SLACK_BOT_TOKEN"];
  const appToken = process.env["SLACK_APP_TOKEN"];
  const hasBoth = Boolean(botToken && appToken);
  let reason: string;

  if (hasBoth) {
    reason = "SLACK_BOT_TOKEN and SLACK_APP_TOKEN are set";
  } else if (botToken) {
    reason = "SLACK_APP_TOKEN is missing (enable Socket Mode at https://api.slack.com/apps)";
  } else if (appToken) {
    reason = "SLACK_BOT_TOKEN is missing (add Bot Token Scopes at https://api.slack.com/apps)";
  } else {
    reason = "Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN (create app at https://api.slack.com/apps)";
  }

  return {
    type: "slack",
    available: hasBoth,
    reason,
    envVars: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
  };
}

function detectWhatsApp(): DetectedChannel {
  const session = process.env["WHATSAPP_SESSION"];
  const sessionDir = process.env["WHATSAPP_SESSION_DIR"];
  const phone = process.env["WHATSAPP_PHONE_NUMBER"];
  const hasAny = Boolean(session || sessionDir || phone);

  return {
    type: "whatsapp",
    available: hasAny,
    reason: hasAny
      ? `WhatsApp configured via ${session ? "WHATSAPP_SESSION" : sessionDir ? "WHATSAPP_SESSION_DIR" : "WHATSAPP_PHONE_NUMBER"}`
      : "Set WHATSAPP_SESSION (path to auth state) or WHATSAPP_PHONE_NUMBER. Requires @whiskeysockets/baileys",
    envVars: ["WHATSAPP_SESSION", "WHATSAPP_SESSION_DIR", "WHATSAPP_PHONE_NUMBER"],
  };
}

// ── Adapter Factory ─────────────────────────────────────

import type { ChannelAdapter } from "./adapter.js";
import { TelegramAdapter } from "./telegram.js";
import { DiscordAdapter } from "./discord.js";
import { SlackAdapter } from "./slack.js";
import { WhatsAppAdapter } from "./whatsapp.js";

export interface AdapterCreationResult {
  readonly type: ChannelType;
  readonly adapter: ChannelAdapter | null;
  readonly reason: string;
}

/**
 * Create adapter instances for all channels that have valid credentials.
 * Reads from ~/.wotann/channels.json first, then falls back to env vars.
 */
export function createAvailableAdapters(
  configPath?: string,
): readonly AdapterCreationResult[] {
  const creds = resolveCredentials(configPath);
  const results: AdapterCreationResult[] = [];

  if (creds.telegram) {
    results.push({
      type: "telegram",
      adapter: new TelegramAdapter(creds.telegram.token),
      reason: "Telegram credentials resolved",
    });
  } else {
    results.push({
      type: "telegram",
      adapter: null,
      reason: "No Telegram credentials found",
    });
  }

  if (creds.discord) {
    results.push({
      type: "discord",
      adapter: new DiscordAdapter(creds.discord.token),
      reason: "Discord credentials resolved",
    });
  } else {
    results.push({
      type: "discord",
      adapter: null,
      reason: "No Discord credentials found",
    });
  }

  if (creds.slack) {
    results.push({
      type: "slack",
      adapter: new SlackAdapter(creds.slack.botToken, creds.slack.appToken),
      reason: "Slack credentials resolved",
    });
  } else {
    results.push({
      type: "slack",
      adapter: null,
      reason: "No Slack credentials found",
    });
  }

  if (creds.whatsapp) {
    results.push({
      type: "whatsapp",
      adapter: new WhatsAppAdapter(creds.whatsapp.sessionDir),
      reason: "WhatsApp credentials resolved",
    });
  } else {
    results.push({
      type: "whatsapp",
      adapter: null,
      reason: "No WhatsApp credentials found",
    });
  }

  return results;
}

/**
 * Status summary for the desktop Settings > Channels section.
 */
export interface ChannelStatusSummary {
  readonly configFileFound: boolean;
  readonly configFilePath: string;
  readonly channels: readonly {
    readonly type: ChannelType;
    readonly configured: boolean;
    readonly credentialSource: "config-file" | "env-var" | "none";
    readonly reason: string;
  }[];
}

/**
 * Get a status summary of all channel configurations.
 * Used by the desktop Settings UI to show which channels are wired.
 */
export function getChannelStatus(configPath?: string): ChannelStatusSummary {
  const resolvedPath = configPath ?? CHANNELS_CONFIG_PATH;
  const config = loadChannelsConfig(resolvedPath);
  const configExists = existsSync(resolvedPath);

  const channels: ChannelStatusSummary["channels"][number][] = [];

  // Telegram
  const telegramConfig = config?.telegram?.token;
  const telegramEnv = process.env["TELEGRAM_BOT_TOKEN"];
  channels.push({
    type: "telegram",
    configured: Boolean(telegramConfig || telegramEnv),
    credentialSource: telegramConfig ? "config-file" : telegramEnv ? "env-var" : "none",
    reason: telegramConfig
      ? "Token loaded from channels.json"
      : telegramEnv
        ? "Token loaded from TELEGRAM_BOT_TOKEN"
        : "Not configured",
  });

  // Discord
  const discordConfig = config?.discord?.token;
  const discordEnv = process.env["DISCORD_BOT_TOKEN"];
  channels.push({
    type: "discord",
    configured: Boolean(discordConfig || discordEnv),
    credentialSource: discordConfig ? "config-file" : discordEnv ? "env-var" : "none",
    reason: discordConfig
      ? "Token loaded from channels.json"
      : discordEnv
        ? "Token loaded from DISCORD_BOT_TOKEN"
        : "Not configured",
  });

  // Slack
  const slackBotConfig = config?.slack?.botToken;
  const slackAppConfig = config?.slack?.appToken;
  const slackBotEnv = process.env["SLACK_BOT_TOKEN"];
  const slackAppEnv = process.env["SLACK_APP_TOKEN"];
  const slackConfigured = Boolean((slackBotConfig || slackBotEnv) && (slackAppConfig || slackAppEnv));
  channels.push({
    type: "slack",
    configured: slackConfigured,
    credentialSource: slackBotConfig && slackAppConfig ? "config-file" : slackBotEnv && slackAppEnv ? "env-var" : "none",
    reason: slackBotConfig && slackAppConfig
      ? "Tokens loaded from channels.json"
      : slackBotEnv && slackAppEnv
        ? "Tokens loaded from SLACK_BOT_TOKEN + SLACK_APP_TOKEN"
        : "Not configured (need both bot and app tokens)",
  });

  // WhatsApp
  const waConfig = config?.whatsapp?.sessionDir;
  const waEnv = process.env["WHATSAPP_SESSION"] ?? process.env["WHATSAPP_SESSION_DIR"];
  channels.push({
    type: "whatsapp",
    configured: Boolean(waConfig || waEnv),
    credentialSource: waConfig ? "config-file" : waEnv ? "env-var" : "none",
    reason: waConfig
      ? "Session dir loaded from channels.json"
      : waEnv
        ? "Session dir loaded from env var"
        : "Not configured (requires @whiskeysockets/baileys)",
  });

  return {
    configFileFound: configExists,
    configFilePath: resolvedPath,
    channels,
  };
}
