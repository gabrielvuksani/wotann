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

---

Last updated: 2026-04-14
