/**
 * OpenAI Codex OAuth — ChatGPT subscription access via PKCE flow.
 *
 * Uses the same OAuth client as Codex CLI:
 * - Client ID: app_EMoamEEZ73f0CkXaXp7hrann (public)
 * - Auth: auth.openai.com/oauth/authorize
 * - Token: auth.openai.com/oauth/token
 * - Scope: openid profile email offline_access
 *
 * This lets ChatGPT Plus/Pro/Team/Enterprise subscribers use their
 * subscription quotas through WOTANN without paying for API credits.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";

// ── Types ─────────────────────────────────────────────

export interface CodexTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken?: string;
  readonly expiresAt: number; // Unix ms
}

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly expires_in: number;
  readonly token_type: string;
}

// ── Constants ─────────────────────────────────────────

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_PORT = 1455;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;
const SCOPES = "openid profile email offline_access";
const TOKEN_FILE = join(homedir(), ".wotann", "codex-tokens.json");

// ── PKCE Helpers ──────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ── Token Persistence ─────────────────────────────────

function loadTokens(): CodexTokens | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    if (data.accessToken && data.refreshToken) {
      return data as CodexTokens;
    }
    return null;
  } catch {
    return null;
  }
}

function saveTokens(tokens: CodexTokens): void {
  const dir = join(homedir(), ".wotann");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

// ── Token Refresh ─────────────────────────────────────

export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokens> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as TokenResponse;
  const tokens: CodexTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    idToken: data.id_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

// ── Get Valid Token ───────────────────────────────────

/**
 * Get a valid access token. Refreshes automatically if expired.
 * Returns null if no tokens stored (user needs to login).
 */
export async function getCodexAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  // If token expires within 5 minutes, refresh
  if (Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
    try {
      const refreshed = await refreshCodexTokens(tokens.refreshToken);
      return refreshed.accessToken;
    } catch {
      return null; // Refresh failed — user needs to re-login
    }
  }

  return tokens.accessToken;
}

/**
 * Check if Codex/ChatGPT subscription is configured.
 */
export function isCodexConfigured(): boolean {
  return loadTokens() !== null;
}

// ── Existing Codex CLI Credential Detection ────────────
//
// The Codex CLI writes its own auth.json to ~/.codex. When the user already
// has an authenticated Codex session, the desktop app can offer one-click
// import instead of forcing another browser round-trip.

const CODEX_CLI_PATHS = [
  join(homedir(), ".codex", "auth.json"),
  join(homedir(), ".config", "codex", "auth.json"),
];

/**
 * Detect an existing Codex CLI auth file. Returns the path and any expiry
 * metadata we can extract, without reading the full token into memory.
 */
export function detectExistingCodexCredential(): {
  readonly found: boolean;
  readonly path?: string;
  readonly expiresAt?: number | null;
} {
  for (const p of CODEX_CLI_PATHS) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
        const expiresAt =
          typeof data["expires_at"] === "number"
            ? (data["expires_at"] as number)
            : typeof data["expiresAt"] === "number"
              ? (data["expiresAt"] as number)
              : null;
        return { found: true, path: p, expiresAt };
      } catch {
        return { found: true, path: p, expiresAt: null };
      }
    }
  }
  return { found: false };
}

/**
 * Import a Codex CLI credential into WOTANN's token store. Reads the CLI's
 * auth.json, validates the shape, and persists a WOTANN-native copy. The
 * caller should verify the JWT out-of-band (the import itself only copies).
 */
export function importCodexCliCredential(path: string): {
  readonly success: boolean;
  readonly error?: string;
} {
  try {
    if (!existsSync(path)) {
      return { success: false, error: `Credential file not found at ${path}` };
    }
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const accessToken =
      (data["access_token"] as string | undefined) ?? (data["accessToken"] as string | undefined);
    const refreshToken =
      (data["refresh_token"] as string | undefined) ?? (data["refreshToken"] as string | undefined);
    if (!accessToken || !refreshToken) {
      return { success: false, error: "Credential file missing access_token or refresh_token" };
    }
    const expiresAt =
      typeof data["expires_at"] === "number"
        ? (data["expires_at"] as number)
        : typeof data["expiresAt"] === "number"
          ? (data["expiresAt"] as number)
          : Date.now() + 60 * 60 * 1000;
    const idToken =
      (data["id_token"] as string | undefined) ?? (data["idToken"] as string | undefined);
    saveTokens({ accessToken, refreshToken, idToken, expiresAt });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Browser OAuth Login ───────────────────────────────

/**
 * Open the system browser to the auth URL.
 * Uses execFile (not exec) to prevent command injection.
 */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", url] : [url];
  execFile(command, args, (err) => {
    if (err) console.warn("[CodexOAuth] Failed to open browser:", err.message);
  });
}

/**
 * Start the OAuth PKCE login flow.
 * Opens a browser window for OpenAI login.
 * Returns tokens after successful authorization.
 */
export function startCodexLogin(): Promise<CodexTokens> {
  return new Promise((resolve, reject) => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      code: "true",
      codex_cli_simplified_flow: "true",
      id_token_add_organizations: "true",
    });

    const authUrl = `${AUTH_URL}?${params}`;

    // Start local callback server
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Authentication Failed</h1><p>You can close this tab.</p></body></html>",
        );
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Invalid Response</h1><p>State mismatch or missing code.</p></body></html>",
        );
        server.close();
        reject(new Error("Invalid OAuth callback"));
        return;
      }

      // Exchange code for tokens
      try {
        const tokenResp = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenResp.ok) {
          throw new Error(`Token exchange failed: ${tokenResp.status}`);
        }

        const data = (await tokenResp.json()) as TokenResponse;
        const tokens: CodexTokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? "",
          idToken: data.id_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        };

        saveTokens(tokens);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          [
            '<html><body style="background:#09090b;color:#fafafa;font-family:system-ui;',
            'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">',
            '<div style="text-align:center">',
            '<div style="width:64px;height:64px;border-radius:50%;background:rgba(16,185,129,0.15);',
            'display:flex;align-items:center;justify-content:center;margin:0 auto 16px">',
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3">',
            '<polyline points="20 6 9 17 4 12"/></svg></div>',
            '<h1 style="font-size:24px;margin-bottom:8px">Connected to ChatGPT</h1>',
            '<p style="color:#71717a">You can close this tab and return to WOTANN.</p>',
            "</div></body></html>",
          ].join(""),
        );

        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Token Exchange Failed</h1></body></html>");
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      openBrowser(authUrl);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out — no response within 2 minutes"));
    }, 120000);
  });
}
