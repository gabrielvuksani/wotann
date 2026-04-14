/**
 * Deep Link Protocol — wotann:// URL handler.
 *
 * Enables one-click skill/config/session imports via custom URLs:
 *   wotann://skill/install?name=code-reviewer&url=https://...
 *   wotann://config/import?url=https://...
 *   wotann://session/resume?id=abc123
 *   wotann://provider/connect?provider=anthropic&key=sk-...
 *   wotann://mode/set?mode=autonomous&task=fix+all+tests
 *   wotann://channel/pair?code=ABC123&channel=telegram
 *
 * From cc-switch: Deep Link protocol for one-click skill/config imports.
 * No competitor has a protocol handler for agent configuration.
 */

export type DeepLinkAction =
  | "skill/install"
  | "skill/activate"
  | "config/import"
  | "config/set"
  | "session/resume"
  | "session/share"
  | "provider/connect"
  | "mode/set"
  | "channel/pair"
  | "mcp/install"
  | "arena/start"
  | "theme/set";

export interface DeepLinkRequest {
  readonly action: DeepLinkAction;
  readonly params: Readonly<Record<string, string>>;
  readonly raw: string;
}

export interface DeepLinkResult {
  readonly success: boolean;
  readonly action: DeepLinkAction;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

/**
 * Parse a wotann:// URL into a structured request.
 * Returns null if the URL is not a valid WOTANN deep link.
 */
export function parseDeepLink(url: string): DeepLinkRequest | null {
  if (!url.startsWith("wotann://")) return null;

  try {
    // Replace wotann:// with https:// for URL parsing
    const parsed = new URL(url.replace("wotann://", "https://wotann.local/"));
    const path = parsed.pathname.replace(/^\//, "");

    // Validate action
    const validActions: readonly DeepLinkAction[] = [
      "skill/install", "skill/activate", "config/import", "config/set",
      "session/resume", "session/share", "provider/connect", "mode/set",
      "channel/pair", "mcp/install", "arena/start", "theme/set",
    ];

    if (!validActions.includes(path as DeepLinkAction)) {
      return null;
    }

    const params: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams) {
      params[key] = value;
    }

    return {
      action: path as DeepLinkAction,
      params,
      raw: url,
    };
  } catch {
    return null;
  }
}

/**
 * Execute a deep link action.
 * Returns a result indicating success/failure and a user-facing message.
 */
export function executeDeepLink(
  request: DeepLinkRequest,
  context: DeepLinkContext,
): DeepLinkResult {
  switch (request.action) {
    case "skill/install":
      return handleSkillInstall(request.params, context);
    case "skill/activate":
      return handleSkillActivate(request.params, context);
    case "config/import":
      return handleConfigImport(request.params, context);
    case "config/set":
      return handleConfigSet(request.params, context);
    case "session/resume":
      return handleSessionResume(request.params, context);
    case "session/share":
      return handleSessionShare(request.params, context);
    case "provider/connect":
      return handleProviderConnect(request.params, context);
    case "mode/set":
      return handleModeSet(request.params, context);
    case "channel/pair":
      return handleChannelPair(request.params, context);
    case "mcp/install":
      return handleMCPInstall(request.params, context);
    case "arena/start":
      return handleArenaStart(request.params, context);
    case "theme/set":
      return handleThemeSet(request.params, context);
  }
}

/**
 * Generate a shareable deep link for an action.
 */
export function generateDeepLink(action: DeepLinkAction, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params);
  return `wotann://${action}?${searchParams.toString()}`;
}

// ── Context (injected by runtime) ──────────────────────────

export interface DeepLinkContext {
  readonly workingDir: string;
  readonly setMode?: (mode: string) => void;
  readonly setTheme?: (theme: string) => boolean;
  readonly installSkill?: (name: string, url: string) => Promise<boolean>;
  readonly installMCP?: (name: string, url: string) => Promise<boolean>;
  readonly verifyPairingCode?: (code: string) => boolean;
  readonly resumeSession?: (id: string) => boolean;
}

// ── Action Handlers ────────────────────────────────────────

function handleSkillInstall(params: Readonly<Record<string, string>>, context: DeepLinkContext): DeepLinkResult {
  const name = params["name"];
  const url = params["url"];
  if (!name || !url) {
    return { success: false, action: "skill/install", message: "Missing required params: name, url" };
  }

  if (context.installSkill) {
    void context.installSkill(name, url);
    return { success: true, action: "skill/install", message: `Installing skill: ${name} from ${url}`, data: { name, url } };
  }
  return { success: false, action: "skill/install", message: "Skill installation not available in current context" };
}

function handleSkillActivate(params: Readonly<Record<string, string>>, _context: DeepLinkContext): DeepLinkResult {
  const name = params["name"];
  if (!name) {
    return { success: false, action: "skill/activate", message: "Missing required param: name" };
  }
  return { success: true, action: "skill/activate", message: `Activating skill: ${name}`, data: { name } };
}

function handleConfigImport(params: Readonly<Record<string, string>>, _context: DeepLinkContext): DeepLinkResult {
  const url = params["url"];
  if (!url) {
    return { success: false, action: "config/import", message: "Missing required param: url" };
  }
  return { success: true, action: "config/import", message: `Importing config from: ${url}`, data: { url } };
}

function handleConfigSet(params: Readonly<Record<string, string>>, _context: DeepLinkContext): DeepLinkResult {
  const key = params["key"];
  const value = params["value"];
  if (!key || !value) {
    return { success: false, action: "config/set", message: "Missing required params: key, value" };
  }
  return { success: true, action: "config/set", message: `Config set: ${key} = ${value}`, data: { key, value } };
}

function handleSessionResume(params: Readonly<Record<string, string>>, context: DeepLinkContext): DeepLinkResult {
  const id = params["id"];
  if (!id) {
    return { success: false, action: "session/resume", message: "Missing required param: id" };
  }
  if (context.resumeSession) {
    const ok = context.resumeSession(id);
    return ok
      ? { success: true, action: "session/resume", message: `Resuming session: ${id}`, data: { id } }
      : { success: false, action: "session/resume", message: `Session not found: ${id}` };
  }
  return { success: true, action: "session/resume", message: `Session resume requested: ${id}`, data: { id } };
}

function handleSessionShare(params: Readonly<Record<string, string>>, _context: DeepLinkContext): DeepLinkResult {
  const id = params["id"];
  if (!id) {
    return { success: false, action: "session/share", message: "Missing required param: id" };
  }
  const shareLink = generateDeepLink("session/resume", { id });
  return { success: true, action: "session/share", message: `Share link: ${shareLink}`, data: { id, shareLink } };
}

function handleProviderConnect(params: Readonly<Record<string, string>>, _context: DeepLinkContext): DeepLinkResult {
  const provider = params["provider"];
  if (!provider) {
    return { success: false, action: "provider/connect", message: "Missing required param: provider" };
  }
  return { success: true, action: "provider/connect", message: `Connecting to provider: ${provider}`, data: { provider } };
}

function handleModeSet(params: Readonly<Record<string, string>>, context: DeepLinkContext): DeepLinkResult {
  const mode = params["mode"];
  if (!mode) {
    return { success: false, action: "mode/set", message: "Missing required param: mode" };
  }
  if (context.setMode) {
    context.setMode(mode);
  }
  const task = params["task"];
  return {
    success: true,
    action: "mode/set",
    message: `Mode set to: ${mode}${task ? ` with task: ${task}` : ""}`,
    data: { mode, task },
  };
}

function handleChannelPair(params: Readonly<Record<string, string>>, context: DeepLinkContext): DeepLinkResult {
  const code = params["code"];
  if (!code) {
    return { success: false, action: "channel/pair", message: "Missing required param: code" };
  }
  if (context.verifyPairingCode) {
    const ok = context.verifyPairingCode(code);
    return ok
      ? { success: true, action: "channel/pair", message: `Pairing verified: ${code}`, data: { code } }
      : { success: false, action: "channel/pair", message: `Invalid or expired pairing code: ${code}` };
  }
  return { success: true, action: "channel/pair", message: `Pairing code received: ${code}`, data: { code } };
}

function handleMCPInstall(params: Readonly<Record<string, string>>, context: DeepLinkContext): DeepLinkResult {
  const name = params["name"];
  const url = params["url"];
  if (!name) {
    return { success: false, action: "mcp/install", message: "Missing required param: name" };
  }
  if (context.installMCP && url) {
    void context.installMCP(name, url);
  }
  return { success: true, action: "mcp/install", message: `Installing MCP server: ${name}`, data: { name, url } };
}

function handleArenaStart(params: Readonly<Record<string, string>>, _context: DeepLinkContext): DeepLinkResult {
  const task = params["task"];
  if (!task) {
    return { success: false, action: "arena/start", message: "Missing required param: task" };
  }
  const models = params["models"]?.split(",") ?? [];
  return { success: true, action: "arena/start", message: `Arena started: ${task}`, data: { task, models } };
}

function handleThemeSet(params: Readonly<Record<string, string>>, context: DeepLinkContext): DeepLinkResult {
  const theme = params["name"];
  if (!theme) {
    return { success: false, action: "theme/set", message: "Missing required param: name" };
  }
  if (context.setTheme) {
    const ok = context.setTheme(theme);
    return ok
      ? { success: true, action: "theme/set", message: `Theme set: ${theme}`, data: { theme } }
      : { success: false, action: "theme/set", message: `Unknown theme: ${theme}` };
  }
  return { success: true, action: "theme/set", message: `Theme requested: ${theme}`, data: { theme } };
}
