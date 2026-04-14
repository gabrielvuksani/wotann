/**
 * Local OAuth callback server for browser-based authentication.
 *
 * PORT STRATEGY (from OpenClaude research):
 * Uses `server.listen(0)` to let the OS assign any available port.
 * This is atomic — no TOCTOU race between checking and binding.
 * Eliminates all port-conflict issues entirely.
 *
 * FALLBACK: If the browser can't be opened (headless, SSH, WSL),
 * falls back to manual auth code paste or device code flow.
 *
 * CROSS-PLATFORM: macOS (open), Linux (xdg-open), Windows (start).
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { platform } from "node:os";

// ── Types ──────────────────────────────────────────────────

export interface OAuthConfig {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly redirectUri?: string;
  readonly usePKCE?: boolean;
  /** Additional query params to include in the auth URL */
  readonly extraParams?: Record<string, string>;
}

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly idToken?: string;
  readonly expiresIn?: number;
  readonly scope?: string;
  readonly accountId?: string;
}

export interface OAuthResult {
  readonly success: boolean;
  readonly tokens?: OAuthTokens;
  readonly error?: string;
  readonly method: "browser" | "device-code" | "manual";
  readonly port?: number;
}

// ── PKCE Helpers ───────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ── Browser Opening ────────────────────────────────────────

function openBrowser(url: string): boolean {
  try {
    const os = platform();
    if (os === "darwin") {
      execFileSync("open", [url], { stdio: "pipe" });
    } else if (os === "linux") {
      execFileSync("xdg-open", [url], { stdio: "pipe" });
    } else if (os === "win32") {
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "pipe" });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── OAuth Browser Flow ─────────────────────────────────────

/**
 * Run a full OAuth authorization code flow with PKCE.
 *
 * Uses OS-assigned port via listen(0) — eliminates all port conflicts.
 * (Pattern from OpenClaude: AuthCodeListener uses listen(0, 'localhost'))
 *
 * Flow:
 * 1. Start local callback server on OS-assigned port
 * 2. Open browser to authorization URL
 * 3. Wait for callback with auth code
 * 4. Exchange code for tokens
 * 5. Return tokens
 */
export async function runOAuthBrowserFlow(
  config: OAuthConfig,
  timeoutMs: number = 120_000,
): Promise<OAuthResult> {
  const state = randomBytes(16).toString("hex");
  const codeVerifier = config.usePKCE !== false ? generateCodeVerifier() : undefined;
  const codeChallenge = codeVerifier ? generateCodeChallenge(codeVerifier) : undefined;

  return new Promise<OAuthResult>((resolve) => {
    let server: Server | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout>;
    let assignedPort = 0;

    // Timeout handler
    timeoutHandle = setTimeout(() => {
      cleanup();
      resolve({
        success: false,
        error: "OAuth flow timed out. Please try again or use manual auth.",
        method: "browser",
      });
    }, timeoutMs);

    // Success page HTML
    const successHtml = `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;background:#0f0f1a;color:#e0e0e0;margin:0">
<div style="text-align:center;max-width:500px">
<div style="font-size:48px;margin-bottom:16px">&#10003;</div>
<h1 style="color:#00d4aa;margin:0 0 8px">WOTANN</h1>
<h2 style="font-weight:normal;color:#a0a0b0;margin:0 0 24px">Authentication Successful</h2>
<p style="color:#808090">You can close this tab and return to the terminal.</p>
</div></body></html>`;

    const errorHtml = (msg: string) => `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;background:#0f0f1a;color:#e0e0e0;margin:0">
<div style="text-align:center"><h1 style="color:#ff4444">Authentication Failed</h1><p>${msg}</p></div></body></html>`;

    function cleanup() {
      clearTimeout(timeoutHandle);
      if (server) {
        server.close();
        server = null;
      }
    }

    // Start callback server
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${assignedPort}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(error));
        cleanup();
        resolve({ success: false, error: `OAuth error: ${error}`, method: "browser" });
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml("Invalid callback — state mismatch or missing code"));
        cleanup();
        resolve({ success: false, error: "State mismatch or missing code", method: "browser" });
        return;
      }

      // Exchange code for tokens
      const redirectUri = `http://127.0.0.1:${assignedPort}/callback`;
      try {
        const tokens = await exchangeCodeForTokens(config.tokenUrl, {
          code,
          clientId: config.clientId,
          redirectUri,
          codeVerifier,
        });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(successHtml);
        cleanup();
        resolve({ success: true, tokens, method: "browser", port: assignedPort });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Token exchange failed";
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorHtml(msg));
        cleanup();
        resolve({ success: false, error: msg, method: "browser" });
      }
    });

    // Use listen(0) for OS-assigned port — no port conflicts possible.
    // (Pattern from OpenClaude: AuthCodeListener.start() uses listen(port ?? 0))
    server.listen(0, "127.0.0.1", () => {
      const addr = server?.address();
      if (!addr || typeof addr === "string") {
        cleanup();
        resolve({ success: false, error: "Failed to get server address", method: "browser" });
        return;
      }
      assignedPort = addr.port;

      // Build redirect URI with the actual assigned port
      const redirectUri = config.redirectUri ?? `http://127.0.0.1:${assignedPort}/callback`;

      // Build authorization URL
      const authParams = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        state,
        scope: config.scopes.join(" "),
      });
      if (codeChallenge) {
        authParams.set("code_challenge", codeChallenge);
        authParams.set("code_challenge_method", "S256");
      }
      // Include any extra params (e.g., codex_cli_simplified_flow, originator)
      if (config.extraParams) {
        for (const [key, value] of Object.entries(config.extraParams)) {
          authParams.set(key, value);
        }
      }

      const authUrl = `${config.authorizationUrl}?${authParams.toString()}`;

      const opened = openBrowser(authUrl);
      if (!opened) {
        // Can't open browser — show URL for manual paste
        console.log(`\n  Visit this URL to authenticate:\n  ${authUrl}\n`);
        // Keep server running — user might paste the URL in a browser
      }
    });

    server.on("error", (err) => {
      cleanup();
      resolve({ success: false, error: `Server error: ${err.message}`, method: "browser" });
    });
  });
}

// ── Token Exchange ─────────────────────────────────────────

async function exchangeCodeForTokens(
  tokenUrl: string,
  params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  },
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  });

  if (params.codeVerifier) {
    body.set("code_verifier", params.codeVerifier);
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Extract account ID from JWT if present (Codex pattern)
  let accountId: string | undefined;
  const idToken = data["id_token"] ? String(data["id_token"]) : undefined;
  if (idToken) {
    accountId = extractAccountIdFromJWT(idToken);
  }

  return {
    accessToken: String(data["access_token"] ?? ""),
    refreshToken: data["refresh_token"] ? String(data["refresh_token"]) : undefined,
    idToken,
    expiresIn: typeof data["expires_in"] === "number" ? data["expires_in"] : undefined,
    scope: data["scope"] ? String(data["scope"]) : undefined,
    accountId,
  };
}

/**
 * Extract chatgpt_account_id from a JWT's payload.
 * Looks in multiple claim locations (from OpenClaude's providerConfig.ts).
 */
function extractAccountIdFromJWT(jwt: string): string | undefined {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf-8")) as Record<string, unknown>;

    return (
      payload["https://api.openai.com/auth.chatgpt_account_id"] ??
      payload["chatgpt_account_id"] ??
      payload["chatgpt_account_user_id"] ??
      payload["chatgpt_user_id"]
    ) as string | undefined;
  } catch {
    return undefined;
  }
}

// ── Token Refresh ─────────────────────────────────────────

/**
 * Refresh an OAuth token using a refresh token.
 * Works for both Codex (auth.openai.com) and Anthropic.
 */
export async function refreshOAuthToken(
  tokenUrl: string,
  clientId: string,
  refreshToken: string,
): Promise<OAuthTokens | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    if (!data["access_token"]) return null;

    return {
      accessToken: String(data["access_token"]),
      refreshToken: data["refresh_token"] ? String(data["refresh_token"]) : refreshToken,
      idToken: data["id_token"] ? String(data["id_token"]) : undefined,
      expiresIn: typeof data["expires_in"] === "number" ? data["expires_in"] : undefined,
    };
  } catch {
    return null;
  }
}

// ── Device Code Flow ──────────────────────────────────────

export interface DeviceCodeConfig {
  readonly deviceCodeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

export interface DeviceCodeResponse {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number;
}

/**
 * Run a device code flow — displays a code for the user to enter in browser.
 * Used for GitHub Copilot and as fallback when browser can't be opened.
 */
export async function runDeviceCodeFlow(
  config: DeviceCodeConfig,
  onUserCode: (response: DeviceCodeResponse) => void,
  timeoutMs: number = 300_000,
): Promise<OAuthResult> {
  const codeResponse = await fetch(config.deviceCodeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      scope: config.scopes.join(" "),
    }),
  });

  if (!codeResponse.ok) {
    return { success: false, error: `Device code request failed: ${codeResponse.status}`, method: "device-code" };
  }

  const codeData = (await codeResponse.json()) as Record<string, unknown>;
  const deviceResponse: DeviceCodeResponse = {
    deviceCode: String(codeData["device_code"] ?? ""),
    userCode: String(codeData["user_code"] ?? ""),
    verificationUri: String(codeData["verification_uri"] ?? codeData["verification_url"] ?? ""),
    expiresIn: Number(codeData["expires_in"] ?? 600),
    interval: Number(codeData["interval"] ?? 5),
  };

  onUserCode(deviceResponse);
  openBrowser(deviceResponse.verificationUri);

  const startTime = Date.now();
  const pollInterval = Math.max(deviceResponse.interval, 5) * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        device_code: deviceResponse.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    const error = tokenData["error"] as string | undefined;

    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (error) {
      return { success: false, error: `Device flow error: ${error}`, method: "device-code" };
    }

    return {
      success: true,
      method: "device-code",
      tokens: {
        accessToken: String(tokenData["access_token"] ?? ""),
        refreshToken: tokenData["refresh_token"] ? String(tokenData["refresh_token"]) : undefined,
        expiresIn: typeof tokenData["expires_in"] === "number" ? tokenData["expires_in"] : undefined,
        scope: tokenData["scope"] ? String(tokenData["scope"]) : undefined,
      },
    };
  }

  return { success: false, error: "Device code flow timed out", method: "device-code" };
}

// ── Provider-Specific Login Configs ────────────────────────

/**
 * Codex/ChatGPT OAuth config.
 * Client ID from the official Codex CLI source (codex-rs/login/src/auth/manager.rs).
 * Scopes from the same source.
 */
export function getCodexOAuthConfig(): OAuthConfig {
  return {
    authorizationUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scopes: ["openid", "profile", "email", "offline_access"],
    usePKCE: true,
    extraParams: {
      codex_cli_simplified_flow: "true",
      originator: "wotann_cli",
    },
  };
}

/**
 * GitHub Copilot device code flow config.
 * Client ID: Iv1.b507a08c87ecfe98 (GitHub's public Copilot client ID).
 * Scope: read:user (from OpenClaw research — allows token exchange for Copilot API).
 */
export function getGitHubDeviceCodeConfig(): DeviceCodeConfig {
  return {
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientId: "Iv1.b507a08c87ecfe98",
    scopes: ["read:user"],
  };
}

/**
 * Anthropic OAuth config for direct browser-based login.
 * Client ID from OpenClaude source (constants/oauth.ts): the production Claude Code client.
 * Scopes from the same source.
 */
export function getAnthropicOAuthConfig(): OAuthConfig {
  return {
    authorizationUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    scopes: [
      "org:create_api_key",
      "user:profile",
      "user:inference",
      "user:sessions:claude_code",
    ],
    usePKCE: true,
  };
}
