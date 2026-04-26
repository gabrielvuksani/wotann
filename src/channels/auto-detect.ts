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
 * COVERAGE (13 adapters, all implementing the `ChannelAdapter` contract from
 * adapter.ts so they can be wrapped by `wrapLegacyAdapter` for gateway use):
 *   - Telegram, Discord, Slack, WhatsApp (original four)
 *   - Matrix, Teams, SMS (already implemented in src/channels, previously
 *     undetected — now wired here so Lane 8 audit reports them correctly)
 *   - Mastodon, WeChat (Work), LINE, Viber, DingTalk, Feishu (new in Phase D)
 *
 * ENV VAR MAPPING:
 * - Telegram:  TELEGRAM_BOT_TOKEN
 * - Discord:   DISCORD_BOT_TOKEN
 * - Slack:     SLACK_BOT_TOKEN + SLACK_APP_TOKEN
 * - WhatsApp:  WHATSAPP_SESSION or WHATSAPP_SESSION_DIR or WHATSAPP_PHONE_NUMBER
 * - Matrix:    MATRIX_HOMESERVER_URL + MATRIX_ACCESS_TOKEN
 * - Teams:     TEAMS_APP_ID + TEAMS_APP_PASSWORD
 * - SMS:       TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER
 * - Mastodon:  MASTODON_INSTANCE_URL + MASTODON_ACCESS_TOKEN
 * - WeChat:    WECHAT_WEBHOOK_URL *or* (WECHAT_CORP_ID + WECHAT_CORP_SECRET + WECHAT_AGENT_ID)
 * - LINE:      LINE_CHANNEL_ACCESS_TOKEN (+ optional LINE_CHANNEL_SECRET)
 * - Viber:     VIBER_AUTH_TOKEN
 * - DingTalk:  DINGTALK_WEBHOOK_URL (+ optional DINGTALK_SECRET)
 * - Feishu:    FEISHU_APP_ID + FEISHU_APP_SECRET (+ optional FEISHU_DOMAIN)
 *
 * CONFIG FILE (~/.wotann/channels.json) — keys mirror the credential shape
 * of each resolver. See `ChannelsConfig` below.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import type { ChannelType } from "./channel-types.js";
import type { ChannelAdapter } from "./adapter.js";
import { TelegramAdapter } from "./telegram.js";
import { DiscordAdapter } from "./discord.js";
import { SlackAdapter } from "./slack.js";
import { WhatsAppAdapter } from "./whatsapp.js";
import { MatrixAdapter } from "./matrix.js";
import { TeamsAdapter } from "./teams.js";
import { SMSAdapter } from "./sms.js";
import { MastodonAdapter } from "./mastodon.js";
import { WeChatAdapter } from "./wechat.js";
import { LineAdapter } from "./line.js";
import { ViberAdapter } from "./viber.js";
import { DingTalkAdapter } from "./dingtalk.js";
import { FeishuAdapter } from "./feishu.js";

// ── Types ────────────────────────────────────────────────

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

export interface AdapterCreationResult {
  readonly type: ChannelType;
  readonly adapter: ChannelAdapter | null;
  readonly reason: string;
}

export type CredentialSource = "config-file" | "env-var" | "none";

export interface ChannelStatusEntry {
  readonly type: ChannelType;
  readonly configured: boolean;
  readonly credentialSource: CredentialSource;
  readonly reason: string;
}

export interface ChannelStatusSummary {
  readonly configFileFound: boolean;
  readonly configFilePath: string;
  readonly channels: readonly ChannelStatusEntry[];
}

// ── Config File Shape ────────────────────────────────────

export interface ChannelsConfig {
  readonly telegram?: { readonly token: string };
  readonly discord?: { readonly token: string };
  readonly slack?: { readonly botToken: string; readonly appToken: string };
  readonly whatsapp?: { readonly sessionDir: string };
  readonly matrix?: { readonly homeserverUrl: string; readonly accessToken: string };
  readonly teams?: { readonly appId: string; readonly appPassword: string };
  readonly sms?: {
    readonly accountSid: string;
    readonly authToken: string;
    readonly phoneNumber: string;
  };
  readonly mastodon?: { readonly instanceUrl: string; readonly accessToken: string };
  readonly wechat?: {
    readonly corpId?: string;
    readonly corpSecret?: string;
    readonly agentId?: string;
    readonly webhookUrl?: string;
  };
  readonly line?: {
    readonly channelAccessToken: string;
    readonly channelSecret?: string;
  };
  readonly viber?: {
    readonly authToken: string;
    readonly senderName?: string;
    readonly senderAvatar?: string;
  };
  readonly dingtalk?: { readonly webhookUrl: string; readonly secret?: string };
  readonly feishu?: {
    readonly appId: string;
    readonly appSecret: string;
    readonly domain?: string;
  };
}

const CHANNELS_CONFIG_PATH = resolveWotannHomeSubdir("channels.json");

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

// ── Detector Table (single source of truth) ──────────────

/**
 * A detector encapsulates all knowledge about one channel type:
 *   - which env vars and config keys supply its credentials,
 *   - how to resolve those into a concrete value,
 *   - how to build a live adapter, and
 *   - the human-readable reason shown in diagnostics.
 *
 * Adding a new channel means adding one entry here and nothing else.
 */
interface ChannelDetector {
  readonly type: ChannelType;
  readonly envVars: readonly string[];
  readonly setupHint: string;
  /** Returns a detection envelope built from env vars alone. */
  detect(): DetectedChannel;
  /** Returns an adapter instance when credentials are resolved, else null. */
  resolve(config: ChannelsConfig | null): AdapterCreationResult;
  /** Returns the credential-source status for the settings UI. */
  status(config: ChannelsConfig | null): ChannelStatusEntry;
}

const DETECTORS: readonly ChannelDetector[] = [
  telegramDetector(),
  discordDetector(),
  slackDetector(),
  whatsappDetector(),
  matrixDetector(),
  teamsDetector(),
  smsDetector(),
  mastodonDetector(),
  wechatDetector(),
  lineDetector(),
  viberDetector(),
  dingtalkDetector(),
  feishuDetector(),
];

// ── Public API ────────────────────────────────────────────

/**
 * Detect which channels are available based on env vars only.
 * Returns detection results for every known channel with reasons.
 */
export function detectPriorityChannels(): ChannelDetectionResult {
  const channels = DETECTORS.map((d) => d.detect());
  const available = channels.filter((c) => c.available);

  return {
    channels,
    availableCount: available.length,
    availableTypes: available.map((c) => c.type),
  };
}

/**
 * Create adapter instances for every channel that has valid credentials.
 * Reads from ~/.wotann/channels.json first, then falls back to env vars.
 */
export function createAvailableAdapters(configPath?: string): readonly AdapterCreationResult[] {
  const config = loadChannelsConfig(configPath);
  return DETECTORS.map((d) => d.resolve(config));
}

/**
 * Status summary for the desktop Settings > Channels section.
 */
export function getChannelStatus(configPath?: string): ChannelStatusSummary {
  const resolvedPath = configPath ?? CHANNELS_CONFIG_PATH;
  const config = loadChannelsConfig(resolvedPath);
  const configExists = existsSync(resolvedPath);

  return {
    configFileFound: configExists,
    configFilePath: resolvedPath,
    channels: DETECTORS.map((d) => d.status(config)),
  };
}

// ── Backwards-compatible legacy API ──────────────────────

/**
 * @deprecated Retained for callers that depend on the old shape. New code
 * should resolve credentials through {@link createAvailableAdapters}.
 */
export interface ResolvedCredentials {
  readonly telegram: { readonly token: string } | null;
  readonly discord: { readonly token: string } | null;
  readonly slack: { readonly botToken: string; readonly appToken: string } | null;
  readonly whatsapp: { readonly sessionDir: string } | null;
}

/**
 * @deprecated See {@link ResolvedCredentials}.
 */
export function resolveCredentials(configPath?: string): ResolvedCredentials {
  const config = loadChannelsConfig(configPath);

  const telegramToken = config?.telegram?.token ?? process.env["TELEGRAM_BOT_TOKEN"];
  const discordToken = config?.discord?.token ?? process.env["DISCORD_BOT_TOKEN"];
  const slackBot = config?.slack?.botToken ?? process.env["SLACK_BOT_TOKEN"];
  const slackApp = config?.slack?.appToken ?? process.env["SLACK_APP_TOKEN"];
  const waSession =
    config?.whatsapp?.sessionDir ??
    process.env["WHATSAPP_SESSION"] ??
    process.env["WHATSAPP_SESSION_DIR"];

  return {
    telegram: telegramToken ? { token: telegramToken } : null,
    discord: discordToken ? { token: discordToken } : null,
    slack: slackBot && slackApp ? { botToken: slackBot, appToken: slackApp } : null,
    whatsapp: waSession ? { sessionDir: waSession } : null,
  };
}

// ── Detector Implementations ──────────────────────────────

function telegramDetector(): ChannelDetector {
  const type: ChannelType = "telegram";
  const envVars = ["TELEGRAM_BOT_TOKEN"] as const;
  const setupHint = "Set TELEGRAM_BOT_TOKEN (create bot via @BotFather on Telegram)";

  function resolveToken(config: ChannelsConfig | null): string | undefined {
    return config?.telegram?.token ?? process.env["TELEGRAM_BOT_TOKEN"];
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const token = process.env["TELEGRAM_BOT_TOKEN"];
      return {
        type,
        available: Boolean(token),
        reason: token ? "TELEGRAM_BOT_TOKEN is set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const token = resolveToken(config);
      if (!token) return { type, adapter: null, reason: "No Telegram credentials found" };
      return {
        type,
        adapter: new TelegramAdapter(token),
        reason: "Telegram credentials resolved",
      };
    },
    status(config) {
      const fromConfig = config?.telegram?.token;
      const fromEnv = process.env["TELEGRAM_BOT_TOKEN"];
      return {
        type,
        configured: Boolean(fromConfig || fromEnv),
        credentialSource: fromConfig ? "config-file" : fromEnv ? "env-var" : "none",
        reason: fromConfig
          ? "Token loaded from channels.json"
          : fromEnv
            ? "Token loaded from TELEGRAM_BOT_TOKEN"
            : "Not configured",
      };
    },
  };
}

function discordDetector(): ChannelDetector {
  const type: ChannelType = "discord";
  const envVars = ["DISCORD_BOT_TOKEN"] as const;
  const setupHint =
    "Set DISCORD_BOT_TOKEN (create bot at https://discord.com/developers/applications)";

  function resolveToken(config: ChannelsConfig | null): string | undefined {
    return config?.discord?.token ?? process.env["DISCORD_BOT_TOKEN"];
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const token = process.env["DISCORD_BOT_TOKEN"];
      return {
        type,
        available: Boolean(token),
        reason: token ? "DISCORD_BOT_TOKEN is set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const token = resolveToken(config);
      if (!token) return { type, adapter: null, reason: "No Discord credentials found" };
      return {
        type,
        adapter: new DiscordAdapter(token),
        reason: "Discord credentials resolved",
      };
    },
    status(config) {
      const fromConfig = config?.discord?.token;
      const fromEnv = process.env["DISCORD_BOT_TOKEN"];
      return {
        type,
        configured: Boolean(fromConfig || fromEnv),
        credentialSource: fromConfig ? "config-file" : fromEnv ? "env-var" : "none",
        reason: fromConfig
          ? "Token loaded from channels.json"
          : fromEnv
            ? "Token loaded from DISCORD_BOT_TOKEN"
            : "Not configured",
      };
    },
  };
}

function slackDetector(): ChannelDetector {
  const type: ChannelType = "slack";
  const envVars = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"] as const;
  const setupHint =
    "Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN (create app at https://api.slack.com/apps)";

  function resolve(config: ChannelsConfig | null): { botToken: string; appToken: string } | null {
    const botToken = config?.slack?.botToken ?? process.env["SLACK_BOT_TOKEN"];
    const appToken = config?.slack?.appToken ?? process.env["SLACK_APP_TOKEN"];
    return botToken && appToken ? { botToken, appToken } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
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
        reason = setupHint;
      }
      return { type, available: hasBoth, reason, envVars };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) return { type, adapter: null, reason: "No Slack credentials found" };
      return {
        type,
        adapter: new SlackAdapter(creds.botToken, creds.appToken),
        reason: "Slack credentials resolved",
      };
    },
    status(config) {
      const botFromConfig = config?.slack?.botToken;
      const appFromConfig = config?.slack?.appToken;
      const botFromEnv = process.env["SLACK_BOT_TOKEN"];
      const appFromEnv = process.env["SLACK_APP_TOKEN"];
      const configured = Boolean((botFromConfig || botFromEnv) && (appFromConfig || appFromEnv));
      const credentialSource: CredentialSource =
        botFromConfig && appFromConfig
          ? "config-file"
          : botFromEnv && appFromEnv
            ? "env-var"
            : "none";
      return {
        type,
        configured,
        credentialSource,
        reason:
          botFromConfig && appFromConfig
            ? "Tokens loaded from channels.json"
            : botFromEnv && appFromEnv
              ? "Tokens loaded from SLACK_BOT_TOKEN + SLACK_APP_TOKEN"
              : "Not configured (need both bot and app tokens)",
      };
    },
  };
}

function whatsappDetector(): ChannelDetector {
  const type: ChannelType = "whatsapp";
  const envVars = ["WHATSAPP_SESSION", "WHATSAPP_SESSION_DIR", "WHATSAPP_PHONE_NUMBER"] as const;
  const setupHint =
    "Set WHATSAPP_SESSION (path to auth state) or WHATSAPP_PHONE_NUMBER. Requires @whiskeysockets/baileys";

  function resolveSession(config: ChannelsConfig | null): string | undefined {
    return (
      config?.whatsapp?.sessionDir ??
      process.env["WHATSAPP_SESSION"] ??
      process.env["WHATSAPP_SESSION_DIR"]
    );
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const session = process.env["WHATSAPP_SESSION"];
      const sessionDir = process.env["WHATSAPP_SESSION_DIR"];
      const phone = process.env["WHATSAPP_PHONE_NUMBER"];
      const hasAny = Boolean(session || sessionDir || phone);
      return {
        type,
        available: hasAny,
        reason: hasAny
          ? `WhatsApp configured via ${
              session
                ? "WHATSAPP_SESSION"
                : sessionDir
                  ? "WHATSAPP_SESSION_DIR"
                  : "WHATSAPP_PHONE_NUMBER"
            }`
          : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const sessionDir = resolveSession(config);
      if (!sessionDir) {
        return { type, adapter: null, reason: "No WhatsApp credentials found" };
      }
      return {
        type,
        adapter: new WhatsAppAdapter(sessionDir),
        reason: "WhatsApp credentials resolved",
      };
    },
    status(config) {
      const fromConfig = config?.whatsapp?.sessionDir;
      const fromEnv = process.env["WHATSAPP_SESSION"] ?? process.env["WHATSAPP_SESSION_DIR"];
      return {
        type,
        configured: Boolean(fromConfig || fromEnv),
        credentialSource: fromConfig ? "config-file" : fromEnv ? "env-var" : "none",
        reason: fromConfig
          ? "Session dir loaded from channels.json"
          : fromEnv
            ? "Session dir loaded from env var"
            : "Not configured (requires @whiskeysockets/baileys)",
      };
    },
  };
}

function matrixDetector(): ChannelDetector {
  const type: ChannelType = "matrix";
  const envVars = ["MATRIX_HOMESERVER_URL", "MATRIX_ACCESS_TOKEN"] as const;
  const setupHint =
    "Set MATRIX_HOMESERVER_URL and MATRIX_ACCESS_TOKEN (get an access token from Element settings)";

  function resolve(
    config: ChannelsConfig | null,
  ): { homeserverUrl: string; accessToken: string } | null {
    const homeserverUrl = config?.matrix?.homeserverUrl ?? process.env["MATRIX_HOMESERVER_URL"];
    const accessToken = config?.matrix?.accessToken ?? process.env["MATRIX_ACCESS_TOKEN"];
    return homeserverUrl && accessToken ? { homeserverUrl, accessToken } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const url = process.env["MATRIX_HOMESERVER_URL"];
      const token = process.env["MATRIX_ACCESS_TOKEN"];
      const hasBoth = Boolean(url && token);
      return {
        type,
        available: hasBoth,
        reason: hasBoth ? "MATRIX_HOMESERVER_URL and MATRIX_ACCESS_TOKEN are set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No Matrix credentials found" };
      }
      return {
        type,
        adapter: new MatrixAdapter(creds.homeserverUrl, creds.accessToken),
        reason: "Matrix credentials resolved",
      };
    },
    status(config) {
      const hsFromConfig = config?.matrix?.homeserverUrl;
      const tokenFromConfig = config?.matrix?.accessToken;
      const hsFromEnv = process.env["MATRIX_HOMESERVER_URL"];
      const tokenFromEnv = process.env["MATRIX_ACCESS_TOKEN"];
      const configured = Boolean((hsFromConfig || hsFromEnv) && (tokenFromConfig || tokenFromEnv));
      const credentialSource: CredentialSource =
        hsFromConfig && tokenFromConfig
          ? "config-file"
          : hsFromEnv && tokenFromEnv
            ? "env-var"
            : "none";
      return {
        type,
        configured,
        credentialSource,
        reason:
          hsFromConfig && tokenFromConfig
            ? "Credentials loaded from channels.json"
            : hsFromEnv && tokenFromEnv
              ? "Credentials loaded from MATRIX_HOMESERVER_URL + MATRIX_ACCESS_TOKEN"
              : "Not configured (need homeserver URL and access token)",
      };
    },
  };
}

function teamsDetector(): ChannelDetector {
  const type: ChannelType = "teams";
  const envVars = ["TEAMS_APP_ID", "TEAMS_APP_PASSWORD"] as const;
  const setupHint =
    "Set TEAMS_APP_ID and TEAMS_APP_PASSWORD (register a bot at https://dev.botframework.com)";

  function resolve(config: ChannelsConfig | null): { appId: string; appPassword: string } | null {
    const appId = config?.teams?.appId ?? process.env["TEAMS_APP_ID"];
    const appPassword = config?.teams?.appPassword ?? process.env["TEAMS_APP_PASSWORD"];
    return appId && appPassword ? { appId, appPassword } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const appId = process.env["TEAMS_APP_ID"];
      const pwd = process.env["TEAMS_APP_PASSWORD"];
      const hasBoth = Boolean(appId && pwd);
      return {
        type,
        available: hasBoth,
        reason: hasBoth ? "TEAMS_APP_ID and TEAMS_APP_PASSWORD are set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No Teams credentials found" };
      }
      return {
        type,
        adapter: new TeamsAdapter(creds.appId, creds.appPassword),
        reason: "Teams credentials resolved",
      };
    },
    status(config) {
      const fromConfigId = config?.teams?.appId;
      const fromConfigPwd = config?.teams?.appPassword;
      const fromEnvId = process.env["TEAMS_APP_ID"];
      const fromEnvPwd = process.env["TEAMS_APP_PASSWORD"];
      const configured = Boolean((fromConfigId || fromEnvId) && (fromConfigPwd || fromEnvPwd));
      const credentialSource: CredentialSource =
        fromConfigId && fromConfigPwd
          ? "config-file"
          : fromEnvId && fromEnvPwd
            ? "env-var"
            : "none";
      return {
        type,
        configured,
        credentialSource,
        reason:
          fromConfigId && fromConfigPwd
            ? "Credentials loaded from channels.json"
            : fromEnvId && fromEnvPwd
              ? "Credentials loaded from TEAMS_APP_ID + TEAMS_APP_PASSWORD"
              : "Not configured (need both app id and password)",
      };
    },
  };
}

function smsDetector(): ChannelDetector {
  const type: ChannelType = "sms";
  const envVars = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"] as const;
  const setupHint =
    "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER (sign up at https://www.twilio.com)";

  function resolve(
    config: ChannelsConfig | null,
  ): { accountSid: string; authToken: string; phoneNumber: string } | null {
    const accountSid = config?.sms?.accountSid ?? process.env["TWILIO_ACCOUNT_SID"];
    const authToken = config?.sms?.authToken ?? process.env["TWILIO_AUTH_TOKEN"];
    const phoneNumber = config?.sms?.phoneNumber ?? process.env["TWILIO_PHONE_NUMBER"];
    return accountSid && authToken && phoneNumber ? { accountSid, authToken, phoneNumber } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const sid = process.env["TWILIO_ACCOUNT_SID"];
      const token = process.env["TWILIO_AUTH_TOKEN"];
      const phone = process.env["TWILIO_PHONE_NUMBER"];
      const hasAll = Boolean(sid && token && phone);
      return {
        type,
        available: hasAll,
        reason: hasAll ? "All Twilio credentials are set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No SMS (Twilio) credentials found" };
      }
      return {
        type,
        adapter: new SMSAdapter(creds.accountSid, creds.authToken, creds.phoneNumber),
        reason: "SMS (Twilio) credentials resolved",
      };
    },
    status(config) {
      const cSid = config?.sms?.accountSid;
      const cTok = config?.sms?.authToken;
      const cPhone = config?.sms?.phoneNumber;
      const eSid = process.env["TWILIO_ACCOUNT_SID"];
      const eTok = process.env["TWILIO_AUTH_TOKEN"];
      const ePhone = process.env["TWILIO_PHONE_NUMBER"];
      const configured = Boolean((cSid || eSid) && (cTok || eTok) && (cPhone || ePhone));
      const credentialSource: CredentialSource =
        cSid && cTok && cPhone ? "config-file" : eSid && eTok && ePhone ? "env-var" : "none";
      return {
        type,
        configured,
        credentialSource,
        reason:
          cSid && cTok && cPhone
            ? "Credentials loaded from channels.json"
            : eSid && eTok && ePhone
              ? "Credentials loaded from Twilio env vars"
              : "Not configured (need account SID, auth token, and phone number)",
      };
    },
  };
}

function mastodonDetector(): ChannelDetector {
  const type: ChannelType = "mastodon";
  const envVars = ["MASTODON_INSTANCE_URL", "MASTODON_ACCESS_TOKEN"] as const;
  const setupHint =
    "Set MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN (Settings > Development > New Application)";

  function resolve(
    config: ChannelsConfig | null,
  ): { instanceUrl: string; accessToken: string } | null {
    const instanceUrl = config?.mastodon?.instanceUrl ?? process.env["MASTODON_INSTANCE_URL"];
    const accessToken = config?.mastodon?.accessToken ?? process.env["MASTODON_ACCESS_TOKEN"];
    return instanceUrl && accessToken ? { instanceUrl, accessToken } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const url = process.env["MASTODON_INSTANCE_URL"];
      const token = process.env["MASTODON_ACCESS_TOKEN"];
      const hasBoth = Boolean(url && token);
      return {
        type,
        available: hasBoth,
        reason: hasBoth ? "MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN are set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No Mastodon credentials found" };
      }
      return {
        type,
        adapter: new MastodonAdapter(creds.instanceUrl, creds.accessToken),
        reason: "Mastodon credentials resolved",
      };
    },
    status(config) {
      const cUrl = config?.mastodon?.instanceUrl;
      const cTok = config?.mastodon?.accessToken;
      const eUrl = process.env["MASTODON_INSTANCE_URL"];
      const eTok = process.env["MASTODON_ACCESS_TOKEN"];
      const configured = Boolean((cUrl || eUrl) && (cTok || eTok));
      const credentialSource: CredentialSource =
        cUrl && cTok ? "config-file" : eUrl && eTok ? "env-var" : "none";
      return {
        type,
        configured,
        credentialSource,
        reason:
          cUrl && cTok
            ? "Credentials loaded from channels.json"
            : eUrl && eTok
              ? "Credentials loaded from MASTODON_INSTANCE_URL + MASTODON_ACCESS_TOKEN"
              : "Not configured (need instance URL and access token)",
      };
    },
  };
}

function wechatDetector(): ChannelDetector {
  const type: ChannelType = "wechat";
  const envVars = [
    "WECHAT_WEBHOOK_URL",
    "WECHAT_CORP_ID",
    "WECHAT_CORP_SECRET",
    "WECHAT_AGENT_ID",
  ] as const;
  const setupHint =
    "Set WECHAT_WEBHOOK_URL (group robot) or WECHAT_CORP_ID + WECHAT_CORP_SECRET + WECHAT_AGENT_ID (app)";

  /**
   * WeChat Work has two mutually acceptable paths; the adapter enforces
   * exactly this rule. We mirror the same logic here so diagnostics don't
   * disagree with the adapter on what "configured" means.
   */
  function resolve(config: ChannelsConfig | null): {
    webhookUrl?: string;
    corpId?: string;
    corpSecret?: string;
    agentId?: string;
  } | null {
    const webhookUrl = config?.wechat?.webhookUrl ?? process.env["WECHAT_WEBHOOK_URL"];
    const corpId = config?.wechat?.corpId ?? process.env["WECHAT_CORP_ID"];
    const corpSecret = config?.wechat?.corpSecret ?? process.env["WECHAT_CORP_SECRET"];
    const agentId = config?.wechat?.agentId ?? process.env["WECHAT_AGENT_ID"];

    const hasWebhook = Boolean(webhookUrl);
    const hasApp = Boolean(corpId && corpSecret && agentId);
    if (!hasWebhook && !hasApp) return null;

    return { webhookUrl, corpId, corpSecret, agentId };
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const hasWebhook = Boolean(process.env["WECHAT_WEBHOOK_URL"]);
      const hasApp = Boolean(
        process.env["WECHAT_CORP_ID"] &&
        process.env["WECHAT_CORP_SECRET"] &&
        process.env["WECHAT_AGENT_ID"],
      );
      const available = hasWebhook || hasApp;
      return {
        type,
        available,
        reason: hasWebhook
          ? "WECHAT_WEBHOOK_URL is set (group robot mode)"
          : hasApp
            ? "WECHAT_CORP_ID + secret + agent are set (app mode)"
            : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No WeChat credentials found" };
      }
      return {
        type,
        adapter: new WeChatAdapter(creds),
        reason: "WeChat credentials resolved",
      };
    },
    status(config) {
      const creds = resolve(config);
      const hasConfig = Boolean(
        config?.wechat?.webhookUrl ||
        (config?.wechat?.corpId && config?.wechat?.corpSecret && config?.wechat?.agentId),
      );
      const credentialSource: CredentialSource = hasConfig
        ? "config-file"
        : creds
          ? "env-var"
          : "none";
      return {
        type,
        configured: Boolean(creds),
        credentialSource,
        reason: hasConfig
          ? "Credentials loaded from channels.json"
          : creds
            ? "Credentials loaded from WeChat env vars"
            : "Not configured (need webhook URL or corp+secret+agent)",
      };
    },
  };
}

function lineDetector(): ChannelDetector {
  const type: ChannelType = "line";
  const envVars = ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"] as const;
  const setupHint =
    "Set LINE_CHANNEL_ACCESS_TOKEN (+ optional LINE_CHANNEL_SECRET for HMAC verification)";

  function resolve(
    config: ChannelsConfig | null,
  ): { channelAccessToken: string; channelSecret?: string } | null {
    const channelAccessToken =
      config?.line?.channelAccessToken ?? process.env["LINE_CHANNEL_ACCESS_TOKEN"];
    const channelSecret = config?.line?.channelSecret ?? process.env["LINE_CHANNEL_SECRET"];
    return channelAccessToken ? { channelAccessToken, channelSecret } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const token = process.env["LINE_CHANNEL_ACCESS_TOKEN"];
      return {
        type,
        available: Boolean(token),
        reason: token ? "LINE_CHANNEL_ACCESS_TOKEN is set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No LINE credentials found" };
      }
      return {
        type,
        adapter: new LineAdapter(creds.channelAccessToken, creds.channelSecret),
        reason: "LINE credentials resolved",
      };
    },
    status(config) {
      const fromConfig = config?.line?.channelAccessToken;
      const fromEnv = process.env["LINE_CHANNEL_ACCESS_TOKEN"];
      return {
        type,
        configured: Boolean(fromConfig || fromEnv),
        credentialSource: fromConfig ? "config-file" : fromEnv ? "env-var" : "none",
        reason: fromConfig
          ? "Token loaded from channels.json"
          : fromEnv
            ? "Token loaded from LINE_CHANNEL_ACCESS_TOKEN"
            : "Not configured",
      };
    },
  };
}

function viberDetector(): ChannelDetector {
  const type: ChannelType = "viber";
  const envVars = ["VIBER_AUTH_TOKEN", "VIBER_SENDER_NAME", "VIBER_SENDER_AVATAR"] as const;
  const setupHint = "Set VIBER_AUTH_TOKEN (create a Public Account at https://partners.viber.com)";

  function resolve(
    config: ChannelsConfig | null,
  ): { authToken: string; senderName?: string; senderAvatar?: string } | null {
    const authToken = config?.viber?.authToken ?? process.env["VIBER_AUTH_TOKEN"];
    const senderName = config?.viber?.senderName ?? process.env["VIBER_SENDER_NAME"];
    const senderAvatar = config?.viber?.senderAvatar ?? process.env["VIBER_SENDER_AVATAR"];
    return authToken ? { authToken, senderName, senderAvatar } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const token = process.env["VIBER_AUTH_TOKEN"];
      return {
        type,
        available: Boolean(token),
        reason: token ? "VIBER_AUTH_TOKEN is set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No Viber credentials found" };
      }
      return {
        type,
        adapter: new ViberAdapter(creds.authToken, creds.senderName, creds.senderAvatar),
        reason: "Viber credentials resolved",
      };
    },
    status(config) {
      const fromConfig = config?.viber?.authToken;
      const fromEnv = process.env["VIBER_AUTH_TOKEN"];
      return {
        type,
        configured: Boolean(fromConfig || fromEnv),
        credentialSource: fromConfig ? "config-file" : fromEnv ? "env-var" : "none",
        reason: fromConfig
          ? "Token loaded from channels.json"
          : fromEnv
            ? "Token loaded from VIBER_AUTH_TOKEN"
            : "Not configured",
      };
    },
  };
}

function dingtalkDetector(): ChannelDetector {
  const type: ChannelType = "dingtalk";
  const envVars = ["DINGTALK_WEBHOOK_URL", "DINGTALK_SECRET"] as const;
  const setupHint = "Set DINGTALK_WEBHOOK_URL (+ optional DINGTALK_SECRET for 加签 signed mode)";

  function resolve(config: ChannelsConfig | null): { webhookUrl: string; secret?: string } | null {
    const webhookUrl = config?.dingtalk?.webhookUrl ?? process.env["DINGTALK_WEBHOOK_URL"];
    const secret = config?.dingtalk?.secret ?? process.env["DINGTALK_SECRET"];
    return webhookUrl ? { webhookUrl, secret } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const url = process.env["DINGTALK_WEBHOOK_URL"];
      return {
        type,
        available: Boolean(url),
        reason: url ? "DINGTALK_WEBHOOK_URL is set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No DingTalk credentials found" };
      }
      return {
        type,
        adapter: new DingTalkAdapter(creds.webhookUrl, creds.secret),
        reason: "DingTalk credentials resolved",
      };
    },
    status(config) {
      const fromConfig = config?.dingtalk?.webhookUrl;
      const fromEnv = process.env["DINGTALK_WEBHOOK_URL"];
      return {
        type,
        configured: Boolean(fromConfig || fromEnv),
        credentialSource: fromConfig ? "config-file" : fromEnv ? "env-var" : "none",
        reason: fromConfig
          ? "Webhook loaded from channels.json"
          : fromEnv
            ? "Webhook loaded from DINGTALK_WEBHOOK_URL"
            : "Not configured",
      };
    },
  };
}

function feishuDetector(): ChannelDetector {
  const type: ChannelType = "feishu";
  const envVars = ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_DOMAIN"] as const;
  const setupHint =
    "Set FEISHU_APP_ID and FEISHU_APP_SECRET (optional FEISHU_DOMAIN for larksuite.com)";

  function resolve(
    config: ChannelsConfig | null,
  ): { appId: string; appSecret: string; domain?: string } | null {
    const appId = config?.feishu?.appId ?? process.env["FEISHU_APP_ID"];
    const appSecret = config?.feishu?.appSecret ?? process.env["FEISHU_APP_SECRET"];
    const domain = config?.feishu?.domain ?? process.env["FEISHU_DOMAIN"];
    return appId && appSecret ? { appId, appSecret, domain } : null;
  }

  return {
    type,
    envVars,
    setupHint,
    detect(): DetectedChannel {
      const id = process.env["FEISHU_APP_ID"];
      const secret = process.env["FEISHU_APP_SECRET"];
      const hasBoth = Boolean(id && secret);
      return {
        type,
        available: hasBoth,
        reason: hasBoth ? "FEISHU_APP_ID and FEISHU_APP_SECRET are set" : setupHint,
        envVars,
      };
    },
    resolve(config) {
      const creds = resolve(config);
      if (!creds) {
        return { type, adapter: null, reason: "No Feishu credentials found" };
      }
      return {
        type,
        adapter: new FeishuAdapter(creds.appId, creds.appSecret, creds.domain),
        reason: "Feishu credentials resolved",
      };
    },
    status(config) {
      const cId = config?.feishu?.appId;
      const cSec = config?.feishu?.appSecret;
      const eId = process.env["FEISHU_APP_ID"];
      const eSec = process.env["FEISHU_APP_SECRET"];
      const configured = Boolean((cId || eId) && (cSec || eSec));
      const credentialSource: CredentialSource =
        cId && cSec ? "config-file" : eId && eSec ? "env-var" : "none";
      return {
        type,
        configured,
        credentialSource,
        reason:
          cId && cSec
            ? "Credentials loaded from channels.json"
            : eId && eSec
              ? "Credentials loaded from FEISHU_APP_ID + FEISHU_APP_SECRET"
              : "Not configured (need both app id and secret)",
      };
    },
  };
}
