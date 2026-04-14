# WOTANN Authentication Convention

This document explains how the WOTANN daemon authenticates RPC clients
(desktop app, iOS app, CLI, external automations) and how to bypass
authentication safely during local development.

## TL;DR

- Production: the daemon requires a session token on every RPC call.
- Development convenience: set `WOTANN_AUTH_BYPASS=1` to skip auth checks.
- Never set `WOTANN_AUTH_BYPASS=1` on a machine reachable from the network.

## Session token model

On first start, the daemon writes a random 256-bit token to:

```
~/.wotann/session-token.json
```

File structure:

```json
{
  "token": "<hex>",
  "issuedAt": "<iso-timestamp>",
  "rotations": 0
}
```

Only the current user should have read access. The daemon creates the file
with mode `0600`; do not commit this file or expose it via shared
filesystems.

## Using the token

### Desktop app (Tauri)

The desktop app reads `~/.wotann/session-token.json` at startup and
includes the token in the initial WebSocket handshake:

```jsonc
// First message on the WS channel:
{ "type": "auth", "token": "<hex>" }
```

The daemon validates the token and upgrades the connection. Once
authenticated, subsequent messages are plain RPC payloads.

### iOS app

On pairing, the iOS app receives a one-time code from the desktop that maps
to the current session token in the desktop-side pairing cache. After
pairing, the iOS app stores the derived session token in the secure
keychain and sends it on each reconnect:

```jsonc
{ "type": "auth", "token": "<hex>", "deviceId": "<uuid>" }
```

### CLI

The `wotann` CLI reads the token from `~/.wotann/session-token.json`
automatically. No environment variable is required for local use.

## Development bypass

When iterating on the daemon, logging into the token store from every
panel gets tedious. Set:

```bash
export WOTANN_AUTH_BYPASS=1
```

before starting the daemon. All RPC methods become callable without a
token. This flag is for developer machines only.

### Why the bypass exists

Faster inner loop for daemon + bridge development, integration tests
that run the daemon in-process, and reproducing user-reported bugs
without issuing real tokens.

### Security warning

Setting `WOTANN_AUTH_BYPASS=1`:

- Exposes every RPC method, including shell-executing tools, to any
  caller that can reach the daemon socket.
- Disables origin checks on the WebSocket listener.
- Disables rate limiting on unauthenticated clients.

Therefore:

1. Never set this in production, staging, or any shared environment.
2. Never set this on a machine with port-forwarding, SSH tunnels, or a
   publicly routable daemon socket.
3. Never enable it inside a container image that ships to end users.
4. Treat a leaked bypass flag as equivalent to a leaked root credential:
   rotate the session token, review recent RPC logs, and rebuild.

The daemon logs a prominent warning on every startup where bypass is
enabled, so unintended activation is visible in logs.

## Rotating the token

Delete the token file and restart the daemon:

```bash
rm ~/.wotann/session-token.json
wotann engine restart
```

All paired clients must re-authenticate after rotation. The iOS app will
prompt for a new pairing code on next launch.

## Related

- `src/identity/` — token issuance and pairing flow.
- `src/security/` — origin checks, rate limiting, audit trail.
- `src/daemon/kairos-rpc.ts` — the RPC surface that auth guards.
