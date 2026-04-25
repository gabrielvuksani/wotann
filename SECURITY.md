# Security Policy

## Supported Versions

WOTANN is in active development on `main`. All security fixes land on `main` and are released in the next tagged version. Older tags receive security backports only on a best-effort basis.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| Tagged releases ≥ 0.2.0 | ✅ best-effort backports |
| < 0.2.0 | ❌ |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Email: **security@wotann.com** (or, if that's unavailable, DM `@gabrielvuksani` on GitHub and request a private channel).

Include in your report:

1. **Vector** — what surface (daemon RPC, sandbox escape, Tauri command, iOS pairing, channel adapter)
2. **Repro steps** — minimal reproduction with expected vs actual behavior
3. **Affected versions** — branch SHA or tag
4. **Impact** — what an attacker could achieve
5. **Suggested mitigation** — optional but appreciated

## Response Timeline

- **24 hours** — acknowledgement that we received the report
- **7 days** — initial triage and severity assessment
- **30 days** — fix landed on `main` for HIGH/CRITICAL; coordinated disclosure timing for everything else

If we confirm the issue, you'll receive credit in the release notes (or anonymously, as you prefer).

## Scope

In scope:

- The KAIROS daemon's RPC surface (`src/daemon/kairos-rpc.ts`)
- Session-token authentication (`src/daemon/kairos-ipc.ts`, `~/.wotann/session-token.json`)
- The 4-layer Computer Use stack (screen capture → perception → action → permission)
- The Tauri 2 desktop app's command surface and CSP
- iOS↔Desktop pairing (ECDH key exchange, keychain storage, Supabase relay)
- Sandbox isolation (`src/sandbox/`) and risk classification
- Provider credential handling (`src/providers/credential-pool.ts`)
- Channel adapters that accept inbound messages (Telegram, Slack, Discord, ...)

Out of scope:

- Issues that require root/admin on the host machine to exploit
- Self-XSS in the desktop UI when the user pastes attacker-controlled content
- Vulnerabilities in third-party dependencies — please report those upstream and let us know so we can pin/upgrade
- Social engineering of WOTANN maintainers
- Physical access attacks

## Hardening Defaults

- Session-token auth is **on by default** — set `WOTANN_AUTH_BYPASS=1` only on trusted dev machines.
- Daemon socket lives in `~/.wotann/kairos.sock` (user-only by FS permissions).
- Computer Use requires explicit per-app approval (`approve_cu_app` flow).
- All file edits go through the sandbox's path-traversal guard (`realpathSync` + `normalize(relative())`).
- Web fetches block private hosts (`isPrivateHost()` SSRF guard).
- Memory queries are parameterized (no SQL injection surface).
- Anti-distillation injects 3 fake tool definitions per request to poison training data extraction.

See [`docs/AUTH.md`](docs/AUTH.md) for the auth convention in detail.

## Cryptography

- iOS↔Desktop: P-256 ECDH via Apple CryptoKit, exponential backoff over a 30-second budget.
- Session tokens: 256-bit random, file mode `0600`, never logged.
- Watermarks: zero-width Unicode in responses for downstream training-data detection (D15).

## Disclosure Coordination

For vulnerabilities affecting upstream projects (Tauri, better-sqlite3, vitest, etc.), we coordinate with their maintainers before public disclosure.

## Subscription Provider Access Policy

WOTANN does not read, store, copy, or replay OAuth tokens issued to
official third-party CLIs (Claude Code, Codex, Gemini CLI). Subscription
providers are accessed by spawning the official vendor CLI as a
subprocess with the user's own authenticated session — WOTANN is a
launcher + stream-json parser, not an authentication broker.

Specifically:

- **Claude Max/Pro**: WOTANN spawns `claude -p` (the Claude Code CLI)
  with 41 environment variables scrubbed (see
  `src/providers/claude-cli-backend.ts` — `CLAUDE_CLI_CLEAR_ENV`). The
  `claude` binary reads its own credentials from
  `~/.claude/.credentials.json` or macOS Keychain service
  `Claude Code-credentials`. WOTANN never sends the user's Claude
  access token as an Authorization header anywhere.
- **ChatGPT Plus/Pro/Team (Codex)**: WOTANN reads the token value from
  `~/.codex/auth.json` (written by `codex login`, which the user runs
  themselves) and sends it ONLY to `chatgpt.com/backend-api/codex` — the
  same endpoint the Codex CLI uses. WOTANN does not refresh tokens
  against `auth.openai.com/oauth/token`; if a request returns 401, the
  user is asked to run `codex login` again. Masquerading as the Codex
  CLI by running our own PKCE flow is explicitly forbidden.
- **GitHub Copilot**: flagged as experimental (see
  `src/providers/copilot-adapter.ts`). Uses user-supplied `GH_TOKEN` to
  exchange for a short-lived Copilot API session token — a non-official
  pattern that will be replaced by `@github/copilot-sdk` when GA.
- **Gemini**: handled via `GEMINI_API_KEY`; no OAuth.

For paid providers (Anthropic Console, OpenAI, Gemini API, etc.), users
provide API keys that are stored with 0600 permissions in
`~/.wotann/secrets.json` and never committed to git.

This policy is implemented via V9 Tier 0 (T0.1 and T0.2). The prior
`src/providers/anthropic-subscription.ts` — which copied the Claude
OAuth token into `~/.wotann/anthropic-oauth.json` — and
`src/providers/codex-oauth.ts` — which ran an independent PKCE flow
against `auth.openai.com` with Codex CLI's public client_id — have
been deleted.

---

Last updated: 2026-04-23
