# MASTER_PLAN_V9 — WOTANN Comprehensive Execution Blueprint

**Created**: 2026-04-21
**Supersedes**: MASTER_PLAN_V8.md (docs/)
**Authoritative trio**: this document + AUTONOMOUS_SPRINT_SUMMARY.md + AUDIT_CLOSED_2026-04-20.md
**Ground truth source**: source code at HEAD `c7d64a9`, not prior MDs

---

## Preamble — How to Read This Plan

1. **Trust source over docs.** Every claim in this plan cites a file:line or grep result. If a prior MD contradicts source, source wins (Quality Bar #15).
2. **Tiers are ordered by strategic dependency, not chronology.** Tier 0 must ship before Tier 1. Tier 5+ can parallelize after Tiers 0–4 land.
3. **FINAL TIER is genuinely last.** Supabase rotation + god-file splits + Android native are scheduled only after all prior tiers are green.
4. **Tiers 0–7 and Tier 12 have full WHAT / WHY / WHERE / HOW / VERIFICATION per sub-item (post-A+ closure 2026-04-21).** Tier 12's 21 competitor-port items were expanded in the 3rd-pass audit. Tiers 8–11 and 13–14 + FINAL still use abbreviated structure (headers + prose + file list) — they are narrow-scope enough that cold-read Claude can reconstruct missing subsections from the primary research source linked in each tier. When a Tier 8–11/13–14 item needs full structure for execution, expand it in-place during execution (mark with `[EXPAND-BEFORE-EXEC]` comment in the tier body). **Every tier now has an Integration Test Matrix** (A+ closure) listing concrete scenarios per sub-item — happy path + failure modes + edge cases with file:line / command / assertion.
5. **Grey-zone framing dropped.** Claude Pro/Max subscription access is achieved via Claude Agent SDK — an Anthropic-sanctioned path, not evasion. See Tier 3.

---

## Source-Verified Baseline (as of 2026-04-21 HEAD c7d64a9)

| Claim | Verification | Status |
|---|---|---|
| LOC | `find src -name '*.ts' \| xargs wc -l` | **231,924 LOC** (MASTER_PLAN_V8's 195,358 is STALE) |
| Providers | `src/providers/` directory count | **19 confirmed** (CLAUDE.md's "11" is STALE) |
| Subdirs in src/ | `ls src/ \| wc -l` | **50** (CLAUDE.md's "22" is STALE) |
| Hooks | `src/hooks/built-in.ts` registrations | **23 registered, 19 distinct** (CLAUDE.md's "21" rounded down) |
| NEXUS V4 impl | `docs/SPEC_VS_IMPL_DIFF.md` | **23.3% DONE / 50.2% PARTIAL / 26.0% MISSING** (MASTER_SYNTHESIS's "85% implemented" conflates done+partial) |
| Test suite | `npx vitest run` | **7590 pass / 7 skipped / 7597 total** at HEAD c7d64a9 (previously-reported 7367 in `AUTONOMOUS_SPRINT_SUMMARY.md` was the earlier same-day count; +223 landed over the afternoon) |
| tsc | `npx tsc --noEmit` | **rc=0** throughout |
| CI | `gh run list --limit 3` | **GREEN on c7d64a9** (fix committed today) |
| Supabase key | `git cat-file -e dbaf1225 && echo still-reachable` | **STILL REACHABLE from 7 refs** (Tier: FINAL) |
| runtime.ts LOC | `wc -l src/core/runtime.ts` | **6939** (Tier: FINAL) |
| kairos-rpc.ts LOC | `wc -l src/daemon/kairos-rpc.ts` | **7629** (Tier: FINAL) |
| index.ts LOC | `wc -l src/index.ts` | **6158** (Tier: FINAL) |
| App.tsx LOC | `wc -l src/ui/App.tsx` | **3185** (Tier: FINAL) |

**Critical correction from wire-audit (2026-04-21)**: ~45% of audited modules are genuinely WIRED. ~20% are FATAL orphans (getter-only, zero external callers). Pattern to grep for: `getX()` method with zero callers outside same-file + lib.ts + tests. See Tier 1 for the 14 FATAL orphans uncovered.

**Critical correction from iOS audit**: `.glassEffect()` is iOS **26**, not iOS 18 (prior audit had this wrong). `@GenerativeIntent` doesn't exist as API — actual API is `@AssistantIntent(schema:)`. Writing Tools integrate via `.writingToolsBehavior(.complete)` modifier on `TextEditor`/`TextField`, NOT via App Intent.

---

## Tier 0 — Legal Hygiene (ship FIRST, blocks all other work) — 4 hours

### T0.1 — Refactor Claude subscription pattern to match OpenClaw's documented-sanctioned approach

**WHAT**: Update `src/providers/anthropic-subscription.ts` to match the pattern OpenClaw documents as Anthropic-sanctioned (per docs.openclaw.ai/concepts/oauth + FAQ).

**WHY — ARCHITECTURAL FIX (not just TOS question)**:

Source-verified via OpenClaw@main repo analysis 2026-04-21. Current WOTANN code is broken in 7 specific ways INDEPENDENT of TOS:

| Issue | Current WOTANN | OpenClaw pattern (MIT-licensed, copy verbatim) |
|---|---|---|
| Credential path | `~/.claude/credentials`, `~/.claude/auth.json`, `~/.claude-code/auth.json` — **ALL WRONG** (2024 paths, current CLI uses `.credentials.json` with leading dot) | `~/.claude/.credentials.json` + macOS Keychain `Claude Code-credentials` |
| Token usage | `writeFileSync(~/.wotann/anthropic-oauth.json, ...)` at line 103 — implies WOTANN sends token as Authorization header | Read credential for expiry-display only; NEVER ship as Authorization; let `claude -p` handle its own auth |
| Env scrub | None | 38-var `CLAUDE_CLI_CLEAR_ENV` stripping ambient API keys + host-managed marker + telemetry |
| `--setting-sources` | Not pinned | Forced to `user` (isolates from project settings) |
| `--permission-mode` | Not pinned | Forced to `bypassPermissions` (WOTANN is trust authority) |
| `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` | Not deleted | Explicitly deleted — else runs route to host-managed billing tier instead of subscription quota |
| MCP + skills | Not wired | `bundleMcp: true` + temp `--plugin-dir` filtered skill set |

**Policy framing (reproduce OpenClaw's hedged wording verbatim, do NOT strengthen)**:
- OpenClaw docs state 3× in `concepts/oauth.md:74`, `providers/anthropic.md:15`, `gateway/cli-backends.md:151`: "Anthropic staff told us OpenClaw-style Claude CLI usage is allowed again, so OpenClaw treats Claude CLI reuse and `claude -p` usage as sanctioned for this integration unless Anthropic publishes a new policy."
- This "Anthropic staff told us" claim is **unverifiable from Anthropic's public sources**. Only OpenClaw's docs reference it.
- WOTANN's docs should say "follows pattern OpenClaw documents as sanctioned" — NEVER "Anthropic-sanctioned" (that's OpenClaw's claim, not ours to repeat).
- OpenClaw hedges adjacent `claude-max-api-proxy` path (their HTTP shim) with `<Warning>`. **WOTANN ships direct-spawn ONLY, not a proxy shim.**
- Structural-compliance argument: WOTANN spawns `claude` the same way shell invocation does — the binary is the legitimate credential holder, WOTANN doesn't impersonate it.

**Source-verified pre-change**: `src/providers/anthropic-subscription.ts:103` calls `writeFileSync(ANTHROPIC_OAUTH_FILE, ...)` — DELETE this.

**WHERE** (FULL list — 13 files reference the anthropic-subscription pattern, source-verified via `grep -rln "anthropic-subscription\|anthropic-oauth\|ANTHROPIC_OAUTH_FILE" src --include='*.ts'`):

Files to DELETE or substantially refactor:
- `src/providers/anthropic-subscription.ts` (323 LOC) — self-token-using antipattern; DELETE entirely
- `src/auth/login.ts:74,91` — writes `~/.wotann/anthropic-oauth.json` in `runAnthropicLogin`; REMOVE write path; rewrite to detect-only + `claude setup-token` instructions display

Files to UPDATE references:
- `src/core/claude-sdk-bridge.ts` — replace import
- `src/core/config-discovery.ts` — replace import
- `src/providers/provider-service.ts:359` — currently `readFileSync(ANTHROPIC_OAUTH_FILE)` — replace with `readClaudeCliCredentials()` call
- `src/providers/model-defaults.ts` — replace import
- `src/providers/usage-intelligence.ts` — replace import
- `src/providers/registry.ts` — rename provider type `"anthropic-subscription"` → `"anthropic-cli"`
- `src/providers/discovery.ts` — use correct credential path, for expiry-display only (no copy)
- `src/providers/agent-bridge.ts` — route `type: "anthropic-cli"` through new subprocess backend
- `src/intent/byoa-detector.ts` — replace import
- `src/daemon/kairos-rpc.ts` — replace import (RPC surface)
- `src/prompt/modules/capabilities.ts` — replace import
- `src/telemetry/cost-tracker.ts` — replace cost-tracking hooks
- `src/lib.ts` — update exports

NEW file:
- `src/providers/claude-cli-backend.ts` (~150 LOC) — subprocess pattern using WOTANN's `execFileNoThrow` safe-exec utility

**MIGRATION PLAN** (for existing users with `~/.wotann/anthropic-oauth.json` from prior versions):
1. On first Claude CLI invocation post-upgrade, `src/providers/claude-cli-backend.ts` calls new `migrateLegacyCredentialFile()`:
   - Detect legacy `~/.wotann/anthropic-oauth.json`
   - Move to `~/.wotann/.legacy/anthropic-oauth.json.bak` with timestamp
   - Log warning: "Legacy credential file archived at .legacy/; WOTANN now reads your Claude CLI session directly. Run `claude login` if not authenticated."
   - Verify user's `~/.claude/.credentials.json` (or Keychain on macOS) is readable via `readClaudeCliCredentials()` — if not, print `claude login` instructions
2. On Windows/Linux users without Keychain: fall through to file-only path; print warning about reduced security vs macOS
3. Preserve a 30-day grace period where legacy file is archived not deleted, so users can roll back if needed

**HOW** (concrete implementation, all user-supplied inputs parameterized, no shell interpretation):

```typescript
// src/providers/claude-cli-backend.ts (NEW, ~150 LOC)

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
// Codebase-canonical safe exec (no shell, prevents command injection).
import { execFileNoThrow } from "../utils/execFileNoThrow.js";

const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_KEYCHAIN_ACCOUNT = "Claude Code";

// 38 env vars scrubbed before spawn. Source: OpenClaw@main
// extensions/anthropic/cli-shared.ts:50-89 (MIT). Prevents ambient API keys
// from redirecting provider and strips host-managed marker so runs count
// against normal subscription quota.
const CLAUDE_CLI_CLEAR_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_OLD", "ANTHROPIC_API_TOKEN",
  "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_UNIX_SOCKET",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES", "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_PLUGIN_CACHE_DIR", "CLAUDE_CODE_PLUGIN_SEED_DIR",
  "CLAUDE_CODE_REMOTE",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_COWORK_PLUGINS",
  // Host-managed marker — MUST delete so runs count on normal sub quota.
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  // OTEL telemetry vars — prevent cross-contamination with WOTANN telemetry.
  "OTEL_SERVICE_NAME", "OTEL_RESOURCE_ATTRIBUTES",
  "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_TIMEOUT",
  "OTEL_TRACES_EXPORTER", "OTEL_METRICS_EXPORTER", "OTEL_LOGS_EXPORTER",
  "OTEL_TRACES_SAMPLER", "OTEL_TRACES_SAMPLER_ARG",
  "OTEL_METRIC_EXPORT_INTERVAL", "OTEL_METRIC_EXPORT_TIMEOUT",
  "OTEL_LOG_LEVEL", "OTEL_PROPAGATORS",
  "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
] as const;

export interface ClaudeCredential {
  readonly type: "oauth" | "token";
  readonly accessTokenPreview?: string; // NEVER ship to network; for expiry-display + hash-matching only
  readonly expiresAt?: number;          // unix ms
  readonly source: "keychain" | "file";
}

// Read credential for DISPLAY ONLY — expiry badge in onboarding.
// The `claude` binary reads its own credentials when spawned;
// WOTANN never sends them as Authorization header anywhere.
export async function readClaudeCliCredentials(): Promise<ClaudeCredential | null> {
  if (platform() === "darwin") {
    // macOS Keychain first — execFileNoThrow uses execFile (no shell) so
    // all args are passed as argv, not interpolated into a shell string.
    const result = await execFileNoThrow("security", [
      "find-generic-password",
      "-s", CLAUDE_KEYCHAIN_SERVICE,
      "-a", CLAUDE_KEYCHAIN_ACCOUNT,
      "-w",
    ]);
    if (result.status === 0 && result.stdout?.trim().length > 0) {
      try {
        const parsed = JSON.parse(result.stdout.trim()) as {
          claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
        };
        const oauth = parsed.claudeAiOauth;
        if (oauth?.accessToken) {
          return {
            type: oauth.refreshToken ? "oauth" : "token",
            accessTokenPreview: oauth.accessToken.slice(0, 8) + "...", // last-4 pattern
            expiresAt: oauth.expiresAt,
            source: "keychain",
          };
        }
      } catch { /* fall through to file */ }
    }
  }

  // File fallback: ~/.claude/.credentials.json (leading dot — CURRENT path).
  if (existsSync(CLAUDE_CREDENTIALS_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(CLAUDE_CREDENTIALS_PATH, "utf8")) as {
        claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
      };
      const oauth = parsed.claudeAiOauth;
      if (oauth?.accessToken) {
        return {
          type: oauth.refreshToken ? "oauth" : "token",
          accessTokenPreview: oauth.accessToken.slice(0, 8) + "...",
          expiresAt: oauth.expiresAt,
          source: "file",
        };
      }
    } catch { /* malformed; return null */ }
  }

  return null;
}

export interface ClaudeInvokeOptions {
  prompt: string;
  model: "opus" | "sonnet" | "haiku";
  systemPrompt?: string;
  sessionId?: string;
  mcpConfigPath?: string;
  pluginDir?: string;
}

export function scrubClaudeEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...parent };
  for (const key of CLAUDE_CLI_CLEAR_ENV) delete scrubbed[key];
  return scrubbed;
}

export async function invokeClaudeCli(opts: ClaudeInvokeOptions): Promise<AsyncIterable<unknown>> {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--setting-sources", "user",
    "--permission-mode", "bypassPermissions",
    "--model", opts.model,
    ...(opts.sessionId ? ["--session-id", opts.sessionId] : []),
    ...(opts.systemPrompt ? ["--append-system-prompt", opts.systemPrompt] : []),
    ...(opts.mcpConfigPath ? ["--mcp-config", opts.mcpConfigPath] : []),
    ...(opts.pluginDir ? ["--plugin-dir", opts.pluginDir] : []),
  ];
  const env = scrubClaudeEnv(process.env);
  const child = spawn("claude", args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(opts.prompt);
  return parseStreamJson(child.stdout);
}

async function* parseStreamJson(stdout: NodeJS.ReadableStream): AsyncIterable<unknown> {
  let buf = "";
  for await (const chunk of stdout) {
    buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        try { yield JSON.parse(line); } catch { /* skip malformed */ }
      }
    }
  }
  if (buf.trim().length > 0) {
    try { yield JSON.parse(buf.trim()); } catch { /* skip */ }
  }
}
```

**Key architectural invariant**: WOTANN never sends a Claude subscription access token to `api.anthropic.com` itself. Only the `claude` binary does — same as shell-invoked `claude -p`. WOTANN is a launcher + parser, not an authentication broker. This is the structural reason OpenClaw treats the pattern as sanctioned.

**Separate `setup-token` path**: For long-lived gateway hosts, users may prefer Anthropic's `setup-token` (a 1-year programmatic token, `sk-ant-oat-*`) sent directly to `api.anthropic.com` as a bearer. This is Anthropic's own documented programmatic auth path. Keep as a secondary option in `src/providers/anthropic-adapter.ts` alongside BYOK API key, under the explicit user-choice "I want token-auth for server use."

**VERIFICATION** (expanded per 2nd audit — catches readFileSync + imports too):
```bash
# Zero writes AND zero reads of the legacy path
grep -rn "writeFileSync.*anthropic-oauth\|readFileSync.*anthropic-oauth\|ANTHROPIC_OAUTH_FILE" src/ | wc -l  # Expect: 0

# Zero remaining imports of the deleted module
grep -rln "anthropic-subscription" src/ --include='*.ts' | wc -l  # Expect: 0

# Legacy user file moved to .legacy/ (if existed pre-upgrade) + runtime warning printed
ls ~/.wotann/.legacy/ 2>/dev/null | grep anthropic-oauth  # archived if was present
test ! -f ~/.wotann/anthropic-oauth.json && echo "live path clean"

# Credential READ works (display only — never shipped)
node -e "import('./dist/providers/claude-cli-backend.js').then(m => m.readClaudeCliCredentials()).then(c => console.log('cred source:', c?.source, 'expires:', c?.expiresAt))"

# tsc + tests
npx tsc --noEmit  # rc=0
npx vitest run 2>&1 | tail -3  # expect 7590+ passing
```

### T0.2 — Delete Codex independent-PKCE flow (3 files, not 1)

**WHAT**: Remove the PKCE flow that uses Codex's public `client_id` to hit `auth.openai.com` directly. Keep only the read-existing-`~/.codex/auth.json` detector.

**WHY**: Running our own PKCE with Codex's client_id masquerades as Codex CLI. Source-verified: `src/providers/codex-oauth.ts:40-42` declares `CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"`, `AUTH_URL`, `TOKEN_URL`.

**WHERE** (FULL list — 3 files contain the leak, not 1; source-verified via `grep -rln "app_EMoamEEZ73f0CkXaXp7hrann\|auth.openai.com/oauth" src --include='*.ts'`):
- `src/providers/codex-oauth.ts:40-42` (primary) — delete independent PKCE flow (~180 LOC of 359 total)
- `src/auth/oauth-server.ts:463-465` — `clientId "app_EMoamEEZ73f0CkXaXp7hrann"` + `authorizationUrl`/`tokenUrl` to `auth.openai.com`; same pattern, different file
- `src/providers/codex-adapter.ts:119,123` — direct POST to `auth.openai.com/oauth/token` with same client_id

**WHERE** (keep):
- `src/providers/codex-oauth.ts` → rename to `src/providers/codex-detector.ts` and keep ONLY `detectExistingCodexCredential()` + `importCodexCliCredential()` (read-existing-file-only)

**HOW** (3 files in single commit to avoid partial state):
1. Edit `codex-oauth.ts`: remove `CLIENT_ID`, `AUTH_URL`, `TOKEN_URL`, `REDIRECT_URI`, `runOAuthFlow()`, `refreshToken()`, any function touching `auth.openai.com`
2. Edit `src/auth/oauth-server.ts` — remove the Codex-branded OAuth config block at lines 463-465 (likely the registration of Codex as an OAuth provider); keep generic OAuth infrastructure for legitimate providers (GitHub, Google for Gemini sign-in, etc.)
3. Edit `src/providers/codex-adapter.ts` — remove lines 119+123 POST to auth.openai.com; replace with "token must come from `~/.codex/auth.json` which user populates by running `codex login` themselves"
4. Keep: `detectExistingCodexCredential()`, `importCodexCliCredential()`
5. `git mv src/providers/codex-oauth.ts src/providers/codex-detector.ts`
6. Update all imports across the 3 files + any downstream consumers
7. Add migration helper `migrateLegacyCodexCredential()` for users whose `~/.codex/auth.json` was written by WOTANN's old independent PKCE (different shape than Codex CLI's own); if shape mismatch, archive + prompt user to re-auth via `codex login`
8. Verify tsc clean + tests green

**VERIFICATION** (strictened — 3-file scope):
```bash
# Zero references to Codex client_id or auth.openai.com/oauth across ALL of src/
grep -rn "app_EMoamEEZ73f0CkXaXp7hrann\|auth.openai.com/oauth" src/ | wc -l  # Expect: 0

# codex-oauth.ts renamed
test ! -f src/providers/codex-oauth.ts && test -f src/providers/codex-detector.ts && echo "renamed"

# Migration helper present
grep -n "migrateLegacyCodexCredential" src/providers/codex-detector.ts  # expect: present

# tsc + tests
npx tsc --noEmit  # rc=0
npx vitest run 2>&1 | tail -3  # expect 7590+ passing
```

### T0.3 — Add experimental banner to Copilot adapter

**WHAT**: Flag `src/providers/copilot-adapter.ts` as experimental. Plan migration to `@github/copilot-sdk` when GA.

**WHY**: GitHub Community Discussion #178117 confirms GH_TOKEN → `/copilot_internal/v2/token` → `api.githubcopilot.com` is TOS-violating for non-Microsoft IDE clients. Not banned yet but clearly unofficial.

**WHERE**: `src/providers/copilot-adapter.ts` header comment + runtime warning

**HOW**:
1. Add comment block at top flagging experimental status
2. Add `console.warn("[copilot] experimental — migrate to @github/copilot-sdk when GA")` on first use
3. Track `@github/copilot-sdk` release via `/monitor-repos` skill

### T0.4 — Publish SECURITY.md addendum

**WHAT**: Document WOTANN's stance: "WOTANN never stores or uses third-party subscription OAuth tokens."

**WHERE**: `SECURITY.md` (root)

**HOW**: Append section:
```markdown
## Subscription Provider Access Policy

WOTANN never reads, stores, or replays OAuth tokens issued to official
third-party CLIs (Claude Code, Codex, Gemini CLI). Subscription providers
are accessed via Anthropic's Claude Agent SDK which spawns the official
`claude` binary with the user's own authenticated session. Tokens remain
inside the official CLI's credential store at all times.

For paid providers (Anthropic Console, OpenAI, Gemini API, etc.), users
provide API keys that are stored with 0600 permissions in
`~/.wotann/secrets.json` and never committed to git.
```

### T0.5 — Fix Finder ghost artifacts in .git/refs

**WHAT**: Delete `.git/refs/*\ 2` files (macOS Finder duplication artifacts).

**WHY**: These break `git rev-list --all` and can cause tool hangs.

**HOW**:
```bash
cd /Users/gabrielvuksani/Desktop/agent-harness/wotann
find .git/refs -name '* 2' -type f -delete
find .git -name '* 2' 2>/dev/null  # Expect: empty
```

**Tier 0 commit message** (single commit, atomic):
```
fix(security): T0 legal hygiene — remove TOS-violating sub-OAuth paths

- DELETE src/providers/anthropic-subscription.ts (copied Claude credential
  to ~/.wotann/anthropic-oauth.json — matches exact pattern Anthropic
  enforced against Feb 20 / April 4 2026)
- DELETE independent PKCE flow in codex-oauth.ts; RENAME to
  codex-detector.ts (keep only read-existing-~/.codex/auth.json)
- ADD experimental banner to copilot-adapter.ts; plan @github/copilot-sdk
  migration when GA
- ADD SECURITY.md subscription-provider-access policy
- CLEAN .git/refs Finder artifacts
```

**Tier 0 exit criteria**: `grep -rn "writeFileSync.*oauth\|auth.openai.com/oauth" src/ | wc -l` returns 0; tsc rc=0; 7589/7597 tests still pass.

**Tier 0 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T0.1 | migration — legacy oauth file present | user has `~/.wotann/anthropic-oauth.json` pre-upgrade; run first Claude invocation | file archived to `~/.wotann/.legacy/anthropic-oauth.json.bak`; warning logged |
| T0.1 | missing creds — no Claude CLI login | no `~/.claude/.credentials.json`; invoke | prompt user to run `claude login`; no crash |
| T0.1 | macOS Keychain path | Keychain has Claude creds | `readClaudeCliCredentials()` returns `{source: "keychain", ...}` |
| T0.1 | malformed creds file | `~/.claude/.credentials.json` has invalid JSON | returns `null`, no throw |
| T0.1 | linux file fallback | Keychain unavailable, file exists | returns `{source: "file", ...}` |
| T0.1 | env scrub | `ANTHROPIC_API_KEY=x`, invoke Claude | scrubbed from env before `spawn`; `claude -p` doesn't see it |
| T0.1 | stream-json auth_expired | Claude emits `{type: "error", subtype: "auth_expired"}` | WOTANN emits `claude.auth.expired` event, no silent retry |
| T0.1 | stream-json rate_limit | Claude emits `{type: "error", subtype: "rate_limit"}` | user sees ETA, offered BYOK fallback |
| T0.1 | spawn ENOENT | `claude` binary missing | user-facing message "Claude CLI not found. Install from..."; no crash |
| T0.1 | network partition mid-stream | `claude` subprocess killed mid-response | `stream.truncated` event, partial buffer flushed |
| T0.1 | `--permission-mode bypassPermissions` pinned | invoke `claude -p` | args array contains `--permission-mode bypassPermissions` |
| T0.1 | `--setting-sources user` pinned | invoke `claude -p` | args array contains `--setting-sources user`, not `project` |
| T0.2 | PKCE flow absent | grep for `app_EMoamEEZ73f0CkXaXp7hrann` | 0 matches |
| T0.2 | codex-oauth renamed | both old path missing + new path exists | `src/providers/codex-detector.ts` exists; `src/providers/codex-oauth.ts` does not |
| T0.2 | legacy codex cred migration | user has `~/.codex/auth.json` written by old WOTANN | shape mismatch triggers archive + `codex login` prompt |
| T0.2 | oauth-server Codex block removed | grep `auth.openai.com/oauth` in src | 0 matches |
| T0.2 | codex-adapter no direct POST | grep `auth.openai.com/oauth/token` | 0 matches |
| T0.3 | Copilot experimental banner | run Copilot adapter | `[copilot] experimental` warning printed on first use |
| T0.3 | no adapter deletion | Copilot adapter still functional | BYOK GH_TOKEN path works |
| T0.4 | SECURITY.md updated | read `SECURITY.md` | "Subscription Provider Access Policy" section present |
| T0.5 | Finder artifact cleanup | `find .git/refs -name '* 2'` | empty result after cleanup |

---

---

## Tier 1 — Top-10 Wire-Audit Closures — 1-2 weeks / ~400 LOC high-impact unlock

### Context (source-verified)

Wire-audit (Engram topic_key `wire-audit-reality-2026-04-21`) found 14 FATAL orphans total. This tier ships the top 10 by damage×ease. Remaining 4 (RLEnvironment, CloudSyncEngine, Miprov2/GEPA/Darwinian, KGBuilder) are `STUDY-THEN-DECIDE` or `DELETE-SAFE` per audit — handled in Tier 14's DEAD-SAFE deletion list. ~45% of audited modules are genuinely wired, ~20% FATAL orphans. Pattern to grep for: `getX()` method with zero callers outside same-file + lib.ts + tests.

### T1.1 — Route `computer.session.step` RPC → `ComputerUseAgent.dispatch()`

**WHAT**: KEYSTONE FIX. `kairos-rpc.ts:5389` handler `computer.session.step` currently only calls `computerSessionStore.step()` (state-machine op), never invokes `ComputerUseAgent.dispatch()` (actual execution). Every F-series RPC is a dead endpoint as a result.

**WHY**: Source-verified — `grep -n "computer.session.step" src/daemon/kairos-rpc.ts` shows the handler calls `step()` only. `grep -rn "computer\.session\." desktop-app/src ios/WOTANN` returns **0 matches** — zero frontend consumers anywhere. Unblocks the entire phone↔desktop workflow.

**WHERE**: `src/daemon/kairos-rpc.ts:5389` handler body + import `ComputerUseAgent` if not present

**HOW**:
```typescript
// Before (pseudo):
this.handlers.set("computer.session.step", async (params) => {
  const session = this.computerSessionStore.step({ sessionId, deviceId, step });
  return session;  // NEVER EXECUTES
});

// After:
this.handlers.set("computer.session.step", async (params) => {
  const session = this.computerSessionStore.step({ sessionId, deviceId, step });
  if (session.status === "claimed" && this.computerUseAgent) {
    // Actually execute the step
    const result = await this.computerUseAgent.dispatch({
      action: step.action,
      args: step.args,
      sessionId,
    });
    this.computerSessionStore.recordStepResult(sessionId, result);
    return { ...session, result };
  }
  return session;
});
```

**VERIFICATION**:
- Integration test in `tests/integration/f-series-wire.test.ts`: call RPC, assert `ComputerUseAgent.dispatch` was called (spy)
- End-to-end: iOS app sends `computer.session.step` → daemon dispatches → action executes → result returns

### T1.2 — Desktop-app SSE consumer for F1 stream

**WHAT**: Add React hook `useComputerSessionStream()` that connects to `computer.session.stream` SSE endpoint and renders live cursor + action feed in Workshop tab.

**WHERE**:
- NEW `desktop-app/src/hooks/useComputerSessionStream.ts` (~80 LOC)
- NEW `desktop-app/src/components/workshop/ComputerSessionPanel.tsx` (~120 LOC)
- MODIFY `desktop-app/src/components/workshop/WorkshopView.tsx` — wire panel

**HOW**: Standard EventSource connection, SWR-style state, render session events as timeline.

**VERIFICATION**: Start session from CLI, open desktop-app Workshop, see cursor move + events stream in real-time.

### T1.3 — Wire sqlite-vec into TEMPR vector channel

**WHAT**: `src/memory/sqlite-vec-backend.ts` is FATAL orphan. TEMPR's vector channel currently uses heuristic fallback. Wire sqlite-vec as the real backend.

**WHERE**: `src/memory/store.ts:2366` (TEMPR vector channel construction)

**HOW**:
```typescript
// In MemoryStore constructor after db setup:
import { createSqliteVecBackend, isSqliteVecAvailable } from "./sqlite-vec-backend.js";

if (isSqliteVecAvailable()) {
  this.vectorBackend = createSqliteVecBackend(this.db, {
    dimension: 384,  // MiniLM dimension
    tableName: "memory_vectors",
  });
  console.log("[memory] sqlite-vec backend active");
} else {
  this.vectorBackend = null;
  console.log("[memory] sqlite-vec not available, heuristic fallback");
}
```

Then in `temprSearch()` (store.ts ~2400): route vector channel through `this.vectorBackend` when non-null.

**VERIFICATION**: `tests/memory/tempr.test.ts` with real sqlite-vec installed passes with real cosine similarity, not heuristic scores.

### T1.4 — Wire ONNX cross-encoder into TEMPR rerank

**WHAT**: `src/memory/onnx-cross-encoder.ts` is FATAL orphan. TEMPR uses heuristic cross-encoder. Wire ONNX as real reranker.

**WHERE**: `src/memory/store.ts:2532` (where `createHeuristicCrossEncoder` is called)

**HOW**:
```typescript
import { createOnnxCrossEncoder, isOnnxRuntimeAvailable, isMiniLmModelAvailable } from "./onnx-cross-encoder.js";

this.crossEncoder = (isOnnxRuntimeAvailable() && isMiniLmModelAvailable())
  ? createOnnxCrossEncoder({ modelPath: resolveMiniLmPath() })
  : createHeuristicCrossEncoder();
```

**VERIFICATION**: LongMemEval benchmark score jumps from projected 55-68% (heuristic) to projected 82-91% (real ONNX + real sqlite-vec).

### T1.5 — Wire `warmupCache()` after `buildStablePrefix`

**WHAT**: `src/providers/prompt-cache-warmup.ts:210 warmupCache()` FATAL orphan. Stable-prefix is emitted but cache warmup requests never fire. Mastra paper: 4-10× cache savings when warmup fires.

**WHERE**: `src/core/runtime.ts:4329` (just after `this.systemPrompt = buildStablePrefix(...)`)

**HOW**:
```typescript
// PREREQUISITE: add config flag first in src/core/types.ts (same commit)
// readonly enablePromptCacheWarmup?: boolean;  // default: true, env: WOTANN_PROMPT_CACHE_WARMUP=0 disables

this.systemPrompt = buildStablePrefix(this.memoryStore, ...);

const warmupEnabled =
  this.config.enablePromptCacheWarmup !== false &&
  process.env["WOTANN_PROMPT_CACHE_WARMUP"] !== "0";

if (warmupEnabled) {
  // Fire-and-forget warmup request; doesn't block main loop
  warmupCache({
    provider: this.activeProvider,
    systemPrompt: this.systemPrompt,
    sessionId: this.session.id,
  }).catch((err) => console.warn("[cache-warmup] failed:", err.message));
}
```

**PREREQUISITE in same commit**: add `enablePromptCacheWarmup?: boolean` to `WotannConfig` in `src/core/types.ts` with JSDoc noting default behavior + env override. Cold-read Claude will otherwise hit tsc error `Property 'enablePromptCacheWarmup' does not exist on type 'WotannConfig'`.

**VERIFICATION**: Run 2 identical queries back-to-back; measure token cost — second should hit cached prefix.

### T1.6 — HMAC signature verification on 6 channel adapters

**WHAT**: 13 of 14 channel adapters lack HMAC signature verification (only github-bot/line/viber have `verifySignature`). Security gap — any attacker who knows the webhook URL can impersonate Slack/Telegram/Discord/WhatsApp/Teams/SMS.

**WHERE** (verified 2026-04-21 — flat adapter files, not `adapter-*.ts` pattern):
- `src/channels/slack.ts`
- `src/channels/telegram.ts`
- `src/channels/discord.ts`
- `src/channels/whatsapp.ts`
- `src/channels/teams.ts`
- `src/channels/sms.ts` (Twilio)

**EXCLUDED** (already have `verifySignature`): `github-bot.ts`, `line.ts`, `viber.ts`

**HOW**: Each adapter implements `verifySignature(req, signingSecret)` using provider-specific HMAC scheme:
- Slack: `v0=<hex>` header, SHA256 of `v0:<timestamp>:<body>`
- Telegram: no HMAC, use `allowed_updates` allowlist + IP allowlist
- Discord: Ed25519 sig in `X-Signature-Ed25519` header
- WhatsApp: `X-Hub-Signature-256` SHA256 HMAC
- Teams: Bot Framework JWT validation
- SMS (Twilio): `X-Twilio-Signature` HMAC-SHA1

~100 LOC total across 6 files.

### T1.7 — Wire `resolvePermission()` into sandbox-audit middleware

**WHAT**: `src/sandbox/security.ts:353 resolvePermission(mode, risk)` FATAL orphan, zero external callers. Permission decisions made inline via other paths. Unification.

**WHERE**: `src/middleware/sandbox-audit.ts`

**HOW**: ~15 LOC — call `resolvePermission(runtime.permissionMode, classified.risk)` before allowing tool execution.

### T1.8 — Wire `SelfHealingPipeline.heal()` from AutonomousExecutor failure paths

**WHAT**: `SelfHealingPipeline` has `classifyError` wired via slash-command, but full `heal()` loop never invoked. WOTANN's "self-healing" moat is marketing without this.

**WHERE**: `src/orchestration/autonomous.ts` failure branches

**HOW**: ~50 LOC — in catch blocks of cycle execution, call `this.selfHealingPipeline?.heal({ error, cycleResult, context })` and retry if heal returns a recovery plan.

### T1.9 — Expose `searchUnifiedKnowledge` via RPC + active-memory fabric fallback

**WHAT**: Runtime method `searchUnifiedKnowledge` has zero external callers. Fabric-level fan-out retrieval sits unused.

**WHERE**:
- `src/daemon/kairos-rpc.ts`: add `memory.searchUnified` handler
- `src/memory/active-memory.ts`: when FTS5 returns low-confidence, fall through to fabric

**HOW**: ~40 LOC

### T1.10 — Preventive `.wotann/` startup sweep for future tmp artifacts

**WHAT**: Add defensive startup sweep in case atomic-writes are ever interrupted. Not fixing existing corruption (verified 2026-04-21: zero `*.tmp.*` files, 2 WAL/SHM pairs are normal SQLite journal files).

**WHY CORRECTED**: Prior claim ("30+ zombie tmp files + 6 orphan WAL/SHM pairs") was WRONG. Verified empirically:
- `find .wotann -name "*.tmp*" | wc -l` → **0**
- `ls .wotann/*.db-wal .wotann/*.db-shm` → 2 active pairs (`memory.db`, `plans.db`) — normal runtime journal files

**WHERE**: `src/daemon/kairos.ts` startup path + `src/memory/store.ts` close-path

**HOW** (defensive, not remedial):
- On startup: sweep `.wotann/` for `*.tmp.*` older than 1h, delete (~10 LOC safety net)
- On close: ensure all atomic writes complete-and-rename or roll back
- Do NOT touch `*.db-wal` / `*.db-shm` — those are active SQLite journal files, not orphans

**Tier 1 exit criteria**: All 10 wires verified via integration tests; full suite 7600+ tests pass; tsc rc=0.

**Tier 1 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T1.1 | happy path | iOS sends `computer.session.step` | `ComputerUseAgent.dispatch` called (spy), action executes, result stored |
| T1.1 | session not claimed | `step()` returns non-claimed status | dispatch skipped, only state-machine advances |
| T1.1 | dispatch error | action fails | `recordStepResult(sessionId, {ok: false, error})`, session status = "failed" |
| T1.1 | computerUseAgent null | dependency not wired | graceful skip, logs warning, no crash |
| T1.2 | SSE connect | open Workshop tab | `ComputerSessionPanel` shows live events |
| T1.2 | SSE disconnect + reconnect | network drop | EventSource reconnects, no duplicate events |
| T1.2 | Workshop tab without session | no active session | empty state shown, not crash |
| T1.3 | sqlite-vec available | native module loaded | `this.vectorBackend` non-null, TEMPR uses real cosine |
| T1.3 | sqlite-vec unavailable | module load fails | `this.vectorBackend = null`, heuristic fallback active |
| T1.3 | real cosine similarity | insert 10 embeddings, query | top-3 results are closest by cosine, not heuristic ranking |
| T1.4 | ONNX model present | model + runtime loaded | `this.crossEncoder = OnnxCrossEncoder` |
| T1.4 | ONNX model missing | file absent | falls back to `HeuristicCrossEncoder` |
| T1.4 | LongMemEval score jump | run benchmark pre+post | projected 55-68% → 82-91% |
| T1.5 | warmup fires | session start | `warmupCache()` called within 500ms of `buildStablePrefix` |
| T1.5 | warmup disabled via config | `enablePromptCacheWarmup: false` | warmup never fires |
| T1.5 | warmup disabled via env | `WOTANN_PROMPT_CACHE_WARMUP=0` | warmup never fires |
| T1.5 | cache savings measured | 2 identical queries back-to-back | second query ≥40% cheaper in tokens |
| T1.6 | Slack HMAC valid | `v0=<hex>` signature matches | request accepted |
| T1.6 | Slack HMAC invalid | wrong signature | 401, request rejected |
| T1.6 | Telegram IP allowlist | allowed IP | accepted; disallowed IP rejected |
| T1.6 | Discord Ed25519 | valid sig | accepted; invalid rejected |
| T1.6 | WhatsApp X-Hub-Signature-256 | valid HMAC | accepted |
| T1.6 | Teams JWT | valid JWT | accepted; expired JWT rejected |
| T1.6 | SMS/Twilio X-Twilio-Signature | valid sig | accepted |
| T1.7 | sandbox-audit uses resolvePermission | any tool call | single unified code path |
| T1.7 | permission mode `ask` | high-risk tool | user prompt shown |
| T1.7 | permission mode `bypassPermissions` | high-risk tool | executes without prompt |
| T1.8 | self-heal on cycle failure | autonomous error | `heal()` called with recovery plan |
| T1.8 | heal returns no plan | unrecoverable | no retry, original error surfaces |
| T1.8 | heal succeeds | retry plan works | cycle resumes from point of failure |
| T1.9 | searchUnified via RPC | `memory.searchUnified` call | returns fabric fan-out result |
| T1.9 | FTS5 low-confidence fallthrough | query returns <0.3 confidence | fabric-level searched, merged |
| T1.10 | startup sweep | `.wotann/*.tmp.*` older than 1h present | deleted on startup |
| T1.10 | WAL preserved | `.wotann/memory.db-wal` exists | NEVER deleted, SQLite needs it |

---

---

## Tier 2 — Memory SOTA Activation — 2-3 days / ~100 LOC

### T2.1 — Download LongMemEval corpus

**WHAT**: `.wotann/benchmarks/longmemeval/` is empty. The runner at `src/memory/evals/longmemeval/runner.ts` is code-complete but has no corpus.

**WHERE**: `scripts/download-longmemeval.mjs` (referenced in corpus.ts:208 — may need creation)

**HOW**:
```javascript
// scripts/download-longmemeval.mjs
import { mkdirSync, writeFileSync } from "node:fs";
const CORPUS_URL = "https://huggingface.co/datasets/longmemeval/longmemeval-s/resolve/main/dataset.json";
const res = await fetch(CORPUS_URL);
mkdirSync(".wotann/benchmarks/longmemeval", { recursive: true });
writeFileSync(".wotann/benchmarks/longmemeval/dataset.json", await res.text());
```

### T2.2 — Replace rule-based scorer with LLM-judge

**WHAT**: Current scorer is rule-based. Mastra's 94.87% LongMemEval score uses gpt-5-mini judge. WOTANN needs equivalent for real scoring.

**WHERE**: `src/memory/evals/longmemeval/scorer.ts`

**HOW**: Add `LlmJudgeScorer` class that takes an `LlmQuery` callback; sends reference answer + hypothesis to judge model; parses pass/fail.

### T2.3 — Default-on OMEGA + TEMPR gates

**WHAT**: Both gated OFF by default. Per research: if all opt-in flags flipped + real corpus downloaded + MiniLM downloaded + Claude Haiku judge → projected 82-91% (Mastra-level).

**WHERE**: `src/core/runtime.ts` config defaults

**HOW**: ~3 LOC — change default from `|| env === "1"` to `!== false && env !== "0"` semantic.

### T2.4 — Publish benchmark page

**WHAT**: Run nightly, push to leaderboard. OMEGA/Mastra/Supermemory all have benchmark pages; WOTANN has zero public evidence memory works.

**WHERE**: `.github/workflows/benchmark-nightly.yml` + `docs/BENCHMARKS.md`

**HOW**: GitHub Action cron; commits results to `docs/BENCHMARKS.md` with sparkline.

**Tier 2 exit criteria**: LongMemEval-500 runs end-to-end; WOTANN publishes a real number; that number is within 2-5% of Mastra (94.87%).

**Tier 2 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T2.1 | corpus downloaded | run `scripts/download-longmemeval.mjs` | `.wotann/benchmarks/longmemeval/dataset.json` exists, 500 items |
| T2.1 | download network failure | unreachable URL | script exits 1 with clear error; no partial write |
| T2.1 | corpus re-download skipped | file exists | script exits 0 without re-fetching |
| T2.2 | LLM judge agrees with rule-based on simple | clear-correct answer | both score 1.0 |
| T2.2 | LLM judge on ambiguous | gray-area answer | judge score reflects nuance, rule-based binary |
| T2.2 | judge model unavailable | 500 error | falls back to rule-based; score tagged as fallback |
| T2.3 | defaults flipped | fresh config | OMEGA + TEMPR enabled out of box |
| T2.3 | env override off | `WOTANN_OMEGA=0` | OMEGA disabled |
| T2.3 | env override on | `WOTANN_OMEGA=1` | OMEGA enabled (same as default) |
| T2.4 | benchmark runs nightly | GHA cron fires | commit to `docs/BENCHMARKS.md` with timestamp |
| T2.4 | benchmark page renders | open `docs/BENCHMARKS.md` | sparkline + latest score + historical trend |
| T2.4 | benchmark regression alert | score drops >5% | CI comment on PR flagging regression |

---

---

## Tier 3 — Claude Sub Max Power (SDK-in-process stack) — 5-7 weeks / ~5300 LOC

**See detailed PRD in max-power agent output (Engram topic_key: research/max-power-claude-sub-final).**

### Architecture (achieved stack)

```
WOTANN TUI / iOS / Slack / phone channels
  → WOTANN daemon (TS/Node)
  → WOTANN middleware 16 layers
  → Claude Agent SDK (in-process library import)
    ├─ customSystemPrompt: WOTANN persona (not Claude Code's)
    ├─ mcpServers: createSdkMcpServer WOTANN tools in-process
    ├─ hooks: 26 events (SessionStart, UserPromptSubmit, PreToolUse,
    │         PostToolUse, Stop, PreCompact, ...) wired to WOTANN
    ├─ canUseTool: WOTANN permission dispatch (async, with arg rewrite)
    ├─ agents: wotann-primary / council-member / arena-judge / exploit-lane
    ├─ allowedTools: ["mcp__wotann__*"]   // force through WOTANN
    ├─ tools: []                            // disable ALL built-ins
    ├─ permissionMode: "dontAsk"
    ├─ settingSources: []                   // don't load user's global CC config
    └─ model: "claude-opus-4-7"
    → spawns `claude` binary with user's subscription auth
```

**User's subscription pays Anthropic for Claude inference. WOTANN drives everything else.**

### T3.1 — Wave 0: Proof of life (1-2 days)

**WHAT**: WOTANN daemon spawns `claude -p --input-format stream-json --output-format stream-json --print --system-prompt "<wotann>"`. Pipe WOTANN TUI user input → Claude stdin; render Claude assistant messages in WOTANN UI.

**WHERE**: NEW `src/claude/bridge.ts` (400 LOC), `src/claude/stream.ts` (150 LOC), `src/claude/config.ts` (80 LOC), `src/claude/system-prompt.ts` (150 LOC)

**HOW**: `child_process.spawn("claude", ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--system-prompt", assembleWotannSystemPrompt(state)])`. Pipe stdin/stdout as line-delimited JSON.

### T3.2 — Wave 1: MCP tool universe (1 week)

**WHAT**: Build `createSdkMcpServer` with WOTANN's first 10 tools. Launch Claude with `--tools "" --mcp-config ./wotann-mcp.json --strict-mcp-config --allowedTools "mcp__wotann__*"`. Claude Code now has NO built-in tools — every action routes through WOTANN MCP.

**WHERE**:
- NEW `src/claude/mcp/server.ts` (100 LOC)
- NEW `src/claude/mcp/tools/*.ts` — 10 initial WOTANN tools: memory_search, skill_load, shadow_git_status, council_vote, arena_run, exploit_lane, workshop_dispatch, session_end, approval_request, fleet_view

### T3.3 — Wave 2: 26 hook events (1 week)

**WHAT**: Install 5 load-bearing hooks via HTTP transport to WOTANN daemon (low latency).

**WHERE**:
- NEW `src/claude/hooks/session-start.ts` (80 LOC)
- NEW `src/claude/hooks/user-prompt-submit.ts` (120 LOC)
- NEW `src/claude/hooks/pre-tool-use.ts` (200 LOC) — includes `defer` routing to council/arena
- NEW `src/claude/hooks/post-tool-use.ts` (150 LOC) — Observer + shadow-git + output filter
- NEW `src/claude/hooks/stop.ts` (100 LOC) — Reflector + verify-before-done
- NEW `src/claude/hooks/pre-compact.ts` (60 LOC) — WAL save

**Mapping middleware → hooks**:
- InputGuard → PreToolUse(Bash|Edit|Write) with `updatedInput`
- MemoryInjector → UserPromptSubmit with `additionalContext`
- SkillDispatcher → UserPromptExpansion with `additionalContext`
- Observer → PostToolUse + SessionEnd
- Reflector → Stop with `decision: "block"` + `additionalContext`
- ShadowGit writer → PostToolUse(Edit|Write)
- Council/Arena → PreToolUse `defer` for routing decisions

### T3.4 — Wave 3: Custom agents via `--agents` (1-2 weeks)

**WHAT**: Define WOTANN subagents with own prompts/tools/hooks/MCP/permissions.

**WHERE**: NEW `src/claude/agents/definitions.ts` (200 LOC) — generates `--agents` JSON from state

**HOW**: Per `code.claude.com/docs/en/sub-agents`:
```json
{
  "wotann-primary": {
    "description": "WOTANN-orchestrated main session",
    "prompt": "<full WOTANN system prompt>",
    "tools": ["mcp__wotann__*", "Read", "Grep", "Glob"],
    "disallowedTools": ["Write", "Edit"],
    "model": "claude-opus-4-7",
    "permissionMode": "dontAsk",
    "maxTurns": 200,
    "skills": ["wotann-core", "wotann-safety"],
    "mcpServers": [{"wotann": {...}}],
    "hooks": { "PreToolUse": [...], "Stop": [...] },
    "memory": "user",
    "effort": "max",
    "initialPrompt": "<auto-submitted boot sequence>",
    "isolation": "worktree",
    "color": "purple"
  },
  "wotann-council-member": { ... },
  "wotann-arena-judge": { ... },
  "wotann-exploit-lane": { ... }
}
```

### T3.5 — Wave 4: Channels (1 week)

**WHAT**: WOTANN iMessage/Slack/phone channels as `claude/channel` MCP plugins. Unsolicited event injection into live session.

**WHERE**: NEW `src/claude/channels/wotann-channel.ts` (250 LOC)

**HOW**: MCP server with `claude/channel` capability; launches with `--channels plugin:wotann-ios@local --dangerously-load-development-channels` during dev.

### T3.6 — Wave 5: Hardening (ongoing)

Full test coverage (1200 LOC), fallback paths, telemetry, `/monitor-repos` tracks `anthropics/claude-code` + `claude-agent-sdk-typescript` for flag deltas.

**Tier 3 exit criteria**: WOTANN drives a Claude Pro/Max session end-to-end; user's subscription pays for inference; zero WOTANN-side token reads; all 16 middleware layers fire via hooks + canUseTool.

**Tier 3 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T3.1 | proof of life — user input | TUI user types "hi" | spawns `claude -p`, sees response streamed in TUI |
| T3.1 | stream-json parse — malformed | `claude` emits junk | skip malformed line, continue parsing next |
| T3.1 | spawn with custom system prompt | WOTANN config has persona | `--system-prompt "<wotann>"` in args |
| T3.2 | WOTANN MCP tools registered | Claude session | `mcp__wotann__memory_search` + 9 others discoverable |
| T3.2 | Built-in tools disabled | --tools "" | Claude cannot Read/Write/Bash directly |
| T3.2 | allowedTools filter | only `mcp__wotann__*` allowed | tool calls outside prefix rejected |
| T3.3 | SessionStart hook fires | new session | hook URL called at `POST /wotann/hooks/session-start` |
| T3.3 | UserPromptSubmit injection | MemoryInjector hook | `additionalContext` appears in prompt |
| T3.3 | PreToolUse approval | Bash tool call | hook evaluates, approves or `defer`s |
| T3.3 | Stop hook blocks premature | Reflector says incomplete | `decision: "block"` + `additionalContext` |
| T3.3 | PreCompact WAL save | compaction imminent | state saved to Engram before compaction |
| T3.4 | wotann-primary agent launched | `--agents` JSON includes primary | agent runs with `prompt`, `tools`, `model: claude-opus-4-7` |
| T3.4 | wotann-council-member spawned | council-voting scenario | agent dispatched in isolated worktree |
| T3.4 | agent with disallowedTools | Write not permitted | agent cannot call Write tool |
| T3.5 | iMessage channel event | inject during live session | event surfaces as user-message-equivalent |
| T3.5 | Slack channel reply | send outbound | posted to thread via MCP |
| T3.5 | phone channel disconnect | network drop | reconnect with replay buffer (T12.18) |
| T3.6 | error handling — spawn ENOENT | Claude CLI missing | user-facing install hint, no crash |
| T3.6 | error handling — auth_expired | stream-json error subtype | `claude.auth.expired` event, prompt re-login |
| T3.6 | error handling — rate_limit | stream-json rate_limit | ETA shown, BYOK fallback offered |
| T3.6 | error handling — network partition | child `close` without final JSON | `stream.truncated` error, buffer flushed |
| T3.6 | cost telemetry — quota probe | session start | `claude /usage` parsed, displayed in StatusRibbon |
| T3.6 | cost telemetry — per-turn counter | token usage in stream | counter increments, drift check passes |
| T3.6 | cost telemetry — threshold | 90% of monthly | cost.warning event emitted, banner shown |
| T3.6 | rollback feature flag | `WOTANN_SUBSCRIPTION_SDK_ENABLED=0` | falls back to BYOK, user notified |

---

---

## Tier 4 — MCP Apps Support (ecosystem floor) — 3-5 days / ~900 LOC

### Context

MCP Apps spec shipped Jan 26 2026, SEP-1865, ratified by Anthropic + OpenAI + MCP-UI community. Already renders in Claude, ChatGPT, VS Code, Goose, Postman, MCPJam. Launch partners: Amplitude, Asana, Box, Canva, Figma, Slack, Salesforce. **WOTANN has zero support — every launch-partner app is invisible in WOTANN.**

### T4.1 — Server side: WOTANN-as-MCP-host exposes UI resources

**WHERE**: `src/mcp/mcp-server.ts` (modify `resources/list` + `resources/read` handlers currently returning `[]`)

**HOW**: Add `_meta.ui.resourceUri = "ui://wotann/memory-browser"` etc. to WOTANN tools. Expose HTML via `resources/read` with `text/html;profile=mcp-app` MIME.

**NEW FILE**: `src/mcp/ui-resources.ts` (~250 LOC) — resource registry for WOTANN's native UIs (memory browser, cost preview, editor diff).

### T4.2 — Client side: WOTANN renders external MCP Apps

**WHERE**:
- NEW `desktop-app/src/mcp-app-host.tsx` (~300 LOC) — React component wrapping each tool result in sandboxed iframe when `_meta.ui.resourceUri` present
- NEW `src/desktop/mcp-app-bridge.ts` (~200 LOC) — iframe + postMessage JSON-RPC
- MODIFY `desktop-app/src-tauri/tauri.conf.json` CSP allowlist

**HOW**: Install `@mcp-ui/client` OR ship in-house AppBridge. Tauri v2 WebView2/WKWebView supports sandboxed iframes natively.

**TUI fallback**: Show `[Interactive app available — open in Desktop]` for MCP Apps (TUI can't render iframes).

**Tier 4 exit criteria**: Launch-partner apps (Canva, Figma, Slack) render inside WOTANN desktop. TUI shows fallback text.

**Tier 4 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T4.1 | resources/list | WOTANN MCP server queried | returns UI resources with `_meta.ui.resourceUri` |
| T4.1 | resources/read valid | URI `ui://wotann/memory-browser` | returns HTML with `text/html;profile=mcp-app` |
| T4.1 | resources/read invalid | bogus URI | 404-equivalent error |
| T4.2 | Canva app renders | tool returns `_meta.ui.resourceUri` | iframe rendered in desktop-app, sandboxed |
| T4.2 | Figma app renders | same | iframe + postMessage JSON-RPC works |
| T4.2 | Slack app renders | same | iframe; click through round-trips |
| T4.2 | TUI fallback | running in terminal | "[Interactive app available — open in Desktop]" shown |
| T4.2 | CSP restricts dangerous | iframe tries eval/unsafe | blocked by tauri.conf.json CSP |
| T4.2 | iframe postMessage RPC | app calls back to host | JSON-RPC round-trips correctly |
| T4.2 | tauri CSP allowlist | origin in allowlist | loads; unlisted origin blocked |

---

---

## Tier 5 — F-series Frontend Consumers (phone↔desktop actually works) — 35-40 days / cross-surface

### Context

Wire-audit KEYSTONE finding: all 15 F-series RPC handlers exist in `kairos-rpc.ts` BACKEND. **Grep for F-series method names in desktop-app + ios returns 0 matches.** Entire "cross-surface" pillar is dead in practice.

### T5.1 — F1 Computer Session consumer (iOS + desktop)

**WHERE**:
- `ios/WOTANN/Services/ComputerSessionService.swift` (NEW, ~300 LOC)
- `desktop-app/src/hooks/useComputerSession.ts` (already in T1.2)

**HOW**: iOS connects via existing RPCClient, subscribes to `computer.session.events`, renders in RemoteDesktopView which ALREADY EXISTS (1125 LOC). Just wire the data.

### T5.2 — F2 Cursor Stream Consumer
- **WHERE**: `ios/WOTANN/Views/RemoteDesktop/RemoteDesktopView.swift` (exists 1125 LOC — the cursor overlay is rendered inline here, no separate `CursorOverlayView.swift`; add cursor.stream RPC subscription hooks), `desktop-app/src/components/workshop/CursorTrailOverlay.tsx` (new ~100 LOC)
- **RPC**: subscribe to `cursor.stream` SSE; render 30fps cursor trail
- **VERIFICATION**: open session on desktop → iOS app shows live cursor within 50ms p50

### T5.3 — F3 Live Activity Consumer (depends on T7.1 Live Activity registration fix)
- **WHERE**: `ios/WOTANNLiveActivity/TaskProgressActivity.swift` (exists) + subscribe to `live.activity.subscribe` in `ios/WOTANN/Services/LiveActivityManager.swift`
- **VERIFICATION**: Dynamic Island lights up on autopilot start; progress updates live

### T5.4 — F5 Creations Browser
- **WHERE**: `desktop-app/src/components/creations/CreationsBrowser.tsx` + `ios/WOTANN/Views/Creations/CreationsView.swift`
- **RPC**: `creations.list` / `creations.watch`
- **VERIFICATION**: files agent emits appear in both surfaces

### T5.5 — F6 Approvals Sheet (iOS phone)
- **WHERE**: `ios/WOTANN/Views/Approvals/ApprovalSheetView.swift`
- **RPC**: `approval.queue.subscribe` + `approval.decide`
- **VERIFICATION**: destructive tool call on desktop triggers approval sheet on phone

### T5.6 — F7 iOS ShareLink for creations
- **WHERE**: `ios/WOTANN/Views/Creations/ShareLink.swift`
- **VERIFICATION**: long-press creation → share → iMessage/mail

### T5.7 — F9 Delivery Notifications
- **WHERE**: `ios/WOTANN/Services/NotificationService.swift` (extend) + `desktop-app/src/components/Delivery.tsx`
- **RPC**: `delivery.subscribe`
- **VERIFICATION**: long-running task completion notifies both surfaces

### T5.8 — F11 Surface Subscribers (generic fan-out)
- **WHERE**: `src/session/surface-subscribers.ts` (exists) + consumers on each surface
- **VERIFICATION**: dispatching an event on daemon fans to all subscribed surfaces

### T5.9 — F12 Watch Dispatch
- **WHERE**: `ios/WOTANNWatch/DispatchView.swift`
- **RPC**: `watch.dispatch.subscribe` + Smart Stack relevance
- **VERIFICATION**: Watch shows active agent status; tap launches iPhone app

### T5.10 — F13 CarPlay Voice Migration
- **WHERE**: `ios/WOTANN/Services/CarPlayService.swift:348` (exists) — wire RPC subscription
- **RPC**: `carplay.voice.subscribe`
- **VERIFICATION**: CarPlay conversation updates live during drive session

### T5.11 — F14 Handoff UI Signals
- **WHERE**: `ios/WOTANN/Views/Handoff/HandoffView.swift` (new)
- **RPC**: `session.handoff.subscribe`
- **VERIFICATION**: desktop session seamlessly resumes on phone via handoff

### T5.12 — F15 Fleet Dashboard
- **WHERE**: `desktop-app/src/components/fleet/FleetDashboard.tsx` (new ~200 LOC)
- **RPC**: `fleet.view` / `fleet.watch`
- **VERIFICATION**: see all parallel agent sessions with live cost + progress

### T5.13 — F10 ExploitView + CouncilView + pairing-skip (iOS)
- **WHERE**: `ios/WOTANN/Views/Exploit/ExploitView.swift` (missing — create) + `ios/WOTANN/Views/Council/CouncilView.swift` (missing — create) + add "Continue without pairing" to pairing flow
- **VERIFICATION**: all 3 views render in standalone iOS; can use Exploit workshop via phone

### T5.14 — F4 iOS Computer Use Overlay (reserved)
iOS does NOT currently have programmatic screen control. F4 is a MIRROR of desktop session, not iOS-controlling-iOS. Use existing `RemoteDesktopView.swift`. Likely already covered by T5.2 cursor stream + existing infrastructure.

### T5.15 — Reserved F-slot
Audit during Tier 5 execution — if any F-handler in `kairos-rpc.ts` isn't covered by T5.1-T5.14, add here.

**Global rule**: never two agents on the same file. Dispatch serially if files overlap; parallelize whenever scopes are strictly disjoint. Whole-file ownership.

**Tier 5 exit criteria**: iOS actually receives + renders cursor stream, approval sheets appear on phone, creations browsable, Live Activity Dynamic Island lights up for task progress.

**Tier 5 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T5.1 | iOS subscribes to `computer.session.events` | pair phone + desktop, start computer session | events flow, `RemoteDesktopView` renders frames |
| T5.1 | session claim request | agent sends `claim` | iOS shows claim prompt, approve → session status = claimed |
| T5.1 | session release | agent disconnects | iOS detects + shows "session ended" |
| T5.2 | cursor stream | desktop agent moves cursor | iOS `CursorTrailOverlay` renders within 50ms p50 |
| T5.2 | cursor stream backpressure | iOS slow | events dropped; latest cursor position prioritized |
| T5.2 | cursor stream disconnect | network drop | overlay fades; reconnect resumes |
| T5.3 | Live Activity start | autopilot begins | Dynamic Island appears with progress |
| T5.3 | Live Activity update | task progresses | activity updates live (progress bar) |
| T5.3 | Live Activity end | task completes | activity dismisses cleanly |
| T5.3 | Live Activity not registered | T7.1 not done | fallback notification (no Dynamic Island) |
| T5.4 | creation emitted | agent writes file | both iOS + desktop `CreationsBrowser` show it live |
| T5.4 | creation deletion | agent deletes file | both surfaces remove entry |
| T5.4 | creation offline | iOS offline during emit | queued; syncs when back online |
| T5.5 | approval appears on phone | destructive tool call on desktop | `ApprovalSheetView` slides up on iOS |
| T5.5 | approval timeout | user ignores 30s | auto-denied, desktop notified |
| T5.5 | approval on multiple devices | 2 phones paired | only 1 can approve, others dismissed |
| T5.6 | long-press ShareLink | user long-presses creation | share sheet shows iMessage/Mail |
| T5.6 | share unsupported type | creation is binary no preview | share still shows with filename |
| T5.7 | delivery notification | task completion | both iOS push + desktop banner |
| T5.7 | notification respects DND | user in Do-Not-Disturb | silent delivery, visible in tray |
| T5.8 | fan-out subscription | event published to daemon | all surface subscribers receive |
| T5.8 | fan-out with 0 subscribers | no one subscribed | event dropped gracefully |
| T5.9 | Watch dispatch | send dispatch | Watch app shows status, tap → iPhone launches |
| T5.9 | Smart Stack relevance | Watch idle | relevance signal updated |
| T5.10 | CarPlay voice | drive session | convo updates live |
| T5.10 | CarPlay disconnect | exit car | CarPlay disconnects cleanly |
| T5.11 | Handoff desktop → phone | user starts on desktop | phone picks up session via handoff |
| T5.12 | Fleet Dashboard | 3 concurrent agents | all 3 visible with live cost + progress |
| T5.12 | Fleet agent click | click one | navigates to that session |
| T5.13 | ExploitView renders | iOS app | standalone view loads |
| T5.13 | CouncilView renders | iOS app | standalone view loads |
| T5.13 | pairing-skip | "Continue without pairing" | standalone mode works, no crash |
| T5.14 | F4 iOS overlay | reuses RemoteDesktopView | already covered by T5.2 |
| T5.15 | reserved slot | during execution, if new F handler appears | added here |

---

---

## Tier 6 — Onboarding v2 (subscription-first, hardware-aware) — 31 hours / ~1840 LOC

### Context

`src/cli/onboarding.ts` is 185 lines of `console.log` + chalk — NOT a wizard. No default model (correct — source-verified `src/core/default-provider.ts` returns null). No hardware detection. No LM Studio detection.

### T6.1 — Hardware detector

**NEW FILE**: `src/core/hardware-detect.ts` (220 LOC)

Uses `systeminformation` package. Returns `HardwareProfile` with tier: cloud-only / low / medium / high / extreme.

### T6.2 — Ink TUI wizard (5 screens)

**NEW FILE**: `src/cli/onboarding-screens.tsx` (600 LOC)

```
╔══════════════════════════════════════════════════════════╗
║                    Welcome to WOTANN                     ║
╚══════════════════════════════════════════════════════════╝

Detected: MacBook Pro M3, 36 GB RAM
Local-model tier: HIGH (can run 26B models)

How do you want WOTANN to talk to a model?

 [1] Connect an official AI app I already have (compliant, free)
     • Claude Code [detected]
     • OpenAI Codex [not installed]
 [2] Paste an API key I already have (BYOK)
 [3] Sign up for a free tier in 30 seconds (guided)
     • Groq, Cerebras, DeepSeek, Mistral, Gemini Flash
 [4] Run a local model (fully private)
     • Recommended: gemma4:e4b for your 16GB Mac
 [5] I'll configure later (demo mode, 10 free queries)
```

### T6.3 — LM Studio detection

**NEW FILE**: `src/providers/lm-studio-adapter.ts` (150 LOC) — probes `localhost:1234/v1/models`, reuses openai-compat adapter.

### T6.4 — Provider ladder with priority order

Default priority when nothing configured:
1. Claude subscription via Agent SDK (if `claude` CLI + T3 done)
2. Codex subscription via detector (read-only)
3. GitHub Copilot (if `GH_TOKEN`)
4. Groq free (1K req/day, 315 tok/s Llama 3.3 70B) — no CC
5. Gemini free (1.5K req/day, 1M ctx) — no CC
6. Cerebras free (60K TPM)
7. DeepSeek ($0.14/M cached, 500K free/day)
8. Anthropic BYOK
9. OpenAI BYOK
10. Ollama local
11. OpenRouter free tier
12+. Advanced flag: Mistral/xAI/Perplexity/Together/Fireworks/SambaNova/HuggingFace/Azure/Bedrock/Vertex

### T6.5 — Config migration

**NEW FILE**: `src/core/config-migration.ts` (120 LOC) — for users with pre-0.2 configs assuming bundled Gemma default. Back up, warn, offer re-onboard.

### T6.6 — First-run success

**NEW FILE**: `src/cli/first-run-success.ts` (150 LOC) — post-setup "try your first prompt" screen with immediate roundtrip test.

**Tier 6 exit criteria**: Time-to-first-token <90s p50 from `wotann init` to streamed output. Hardware detection ≥99% accurate on tested devices.

**Tier 6 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T6.1 | MacBook Pro M3 | detect | returns tier `high`, RAM/CPU detected |
| T6.1 | 8GB Intel Mac | detect | returns tier `low` |
| T6.1 | Linux cloud VM | detect | returns tier `cloud-only` |
| T6.1 | Windows desktop with GPU | detect | returns correct tier + GPU info |
| T6.1 | detection failure | no systeminformation | returns `{tier: "unknown", reason: "..."}`, never crashes |
| T6.2 | wizard entry | `wotann init` fresh | 5 screens rendered |
| T6.2 | skip wizard | `wotann init --skip-wizard` | launches with defaults |
| T6.2 | arrow keys | navigate between options | highlights update |
| T6.2 | enter select | pick option | transitions to next screen |
| T6.2 | resize terminal mid-wizard | shrink terminal | Ink re-renders without crash |
| T6.3 | LM Studio running | `localhost:1234` up | detected + offered as local option |
| T6.3 | LM Studio not running | port closed | not offered; no false positive |
| T6.3 | LM Studio unreachable | wrong port | timeout after 500ms, no wizard block |
| T6.4 | subscription-first priority | Claude CLI present | Claude ranked #1 by default |
| T6.4 | fallback ladder | primary fails | next in ladder tried |
| T6.4 | env override | `WOTANN_PROVIDER_PRIORITY` set | honored over default |
| T6.5 | legacy config migration | pre-0.2 config present | backed up, re-onboarding offered |
| T6.5 | no legacy | fresh install | skipped silently |
| T6.6 | post-setup test | after config | first-prompt streams through in <90s p50 |
| T6.6 | post-setup failure | test fails | actionable fix hint shown |

---

---

## Tier 7 — iOS 18 Polish (ADA 7.5+ composite target) — 11.5 hours / ~960 LOC + audio asset

### Ordering (risk-inverted ROI)

### T7.1 — Live Activity registration fix (15 min, 10 LOC)

**WHAT**: `TaskProgressLiveActivity` is fully implemented at `ios/WOTANNLiveActivity/TaskProgressActivity.swift` but NOT in `WOTANNWidgetBundle.swift`. Also currently compiled into wrong target (main app, not widgets extension).

**WHERE**:
- `ios/project.yml`: move `WOTANNLiveActivity/` from main target to `WOTANNWidgets` target
- `ios/WOTANNWidgets/WOTANNWidgetBundle.swift`: add `TaskProgressLiveActivity()`
- `ios/WOTANN/Info.plist`: add `NSSupportsLiveActivities: YES`

### T7.2 — `.writingToolsBehavior(.complete)` modifier (5 min, 4 LOC)

**WHERE**: `ios/WOTANN/Views/Input/ChatInputBar.swift` (NOTE: Input/, not Chat/) + `ios/WOTANN/Views/Chat/Composer.swift`

**HOW**: Add `.writingToolsBehavior(.complete)` to TextEditor/TextField. Zero-risk, zero-LOC cost, instant Apple Intelligence Writing Tools integration.

### T7.3 — `.wLiquidGlass()` wrapper + sweep (2h, 70 LOC)

**IMPORTANT CORRECTION**: `.glassEffect()` is iOS **26**, not 18. Current `.ultraThinMaterial` IS the correct iOS 18 path.

**WHERE**: `ios/WOTANN/DesignSystem/ViewModifiers.swift`

**HOW**:
```swift
extension View {
    @ViewBuilder
    func wLiquidGlass<S: Shape>(
        in shape: S = RoundedRectangle(cornerRadius: 16, style: .continuous),
        interactive: Bool = false,
        tint: Color? = nil
    ) -> some View {
        if #available(iOS 26.0, macOS 26.0, watchOS 26.0, *) {
            self.glassEffect(liquidGlass(interactive, tint), in: shape)
        } else {
            self
                .background(shape.fill(.ultraThinMaterial))
                .overlay(shape.stroke(.white.opacity(0.12), lineWidth: 0.5))
        }
    }
}
```

Then sweep ~15 call sites (not audit's 40-50): MainShell tab bar, ChatInputBar, ArenaView divider, FloatingAsk, StatusRibbon, RemoteDesktopView toolbars.

**Where NOT to use**: message bubbles, cost charts, code blocks (legibility cost), OLED-intent black canvases.

### T7.4 — 4 Control Widgets (3h, 240 LOC)

**NEW FILE**: `ios/WOTANNWidgets/ControlWidgets.swift`

- `WOTANNAutopilotControl` — toggle with `SetValueIntent`
- `WOTANNVoiceAskControl` — button with `OpenVoiceAskIntent` (foregrounds app)
- `WOTANNRelayControl` — button → relay clipboard to desktop
- `WOTANNCostControl` — button → today's cost dialog

Target-membership critical: `OpenIntent` must be in BOTH widgets extension AND main app.

### T7.5 — 3 Assistant Intents for Writing Tools (2h, 240 LOC)

**IMPORTANT CORRECTION**: `@GenerativeIntent` doesn't exist. Actual API is `@AssistantIntent(schema:)`. But today's closest schema is domain-specific (email/text/messages) — awkward fit. Ship plain `AppIntent`s with `categoryName: "Writing"` + AppShortcut. Revisit `@AssistantIntent(schema:)` at WWDC 2026 when generic schema likely ships.

**NEW FILES**:
- `ios/WOTANNIntents/RewriteWithWOTANNIntent.swift` (80 LOC)
- `ios/WOTANNIntents/SummarizeWithWOTANNIntent.swift` (80 LOC)
- `ios/WOTANNIntents/ExpandWithWOTANNIntent.swift` (80 LOC)

Each sends text to paired desktop (superior to on-device Apple Intelligence for code/technical rewrites).

### T7.6 — Signature motif + haptics + Dynamic Type cleanup (4h, 100 LOC)

**NEW FILE**: `ios/WOTANN/DesignSystem/WHaptics.swift` (60 LOC)

5-verb haptic vocabulary:
- `strike` (.impact(.rigid)) — agent action committed
- `pulse` (.impact(.soft) ×2, 200ms apart) — streaming token arrived
- `summon` (.impact(.heavy) + .notification(.success)) — relay delivered
- `warn` (.notification(.warning)) — cost threshold
- `rune` (full 2-tier strike) — task success

**Signature motif**: "Rune-flash" — on any action complete, 2-tier haptic + runic glyph on glass capsule, 200ms slide-in + 800ms hold + 200ms slide-out. 3-rune alphabet: ᚠ Ask, ᚱ Relay, ᛉ Autopilot.

**Signature color**: cyan 0x06B6D4 (not generic Apple Blue) from existing `Theme.swift:313`.

**Audio sting**: 6-note Wotann signature mark (≤400ms), plays once per session on first unlock. New asset `ios/WOTANN/Assets.xcassets/wotann_sting.caf`.

**Dynamic Type cleanup**: 4 remaining `Font.system(size:)` call sites (8 total, 4 are fixable per audit) — switch to `Font.wotannScaled(size:)`.

**Tier 7 exit criteria**: Dynamic Island lights up with task progress (Live Activity finally registered), 4 Control Widgets in Control Center, Writing Tools shows "Rewrite with WOTANN" in any text selection context menu.

**Tier 7 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T7.1 | Live Activity in correct target | build + install | TaskProgressLiveActivity in `WOTANNWidgets`, not main |
| T7.1 | `NSSupportsLiveActivities` | Info.plist | `YES` value present |
| T7.1 | Dynamic Island on iPhone 14+ | start task | expanded view renders |
| T7.1 | fallback notification pre-iOS-16.1 | older iOS | notification shown instead |
| T7.2 | Writing Tools appear | select text in ChatInputBar | "Rewrite with WOTANN" in context menu |
| T7.2 | modifier active | TextEditor/TextField instances | both have `.writingToolsBehavior(.complete)` |
| T7.2 | Writing Tools on non-iOS-18 | iOS 17 device | no crash, modifier no-op |
| T7.3 | `.wLiquidGlass()` on iOS 26 | device running iOS 26 | `glassEffect()` applied |
| T7.3 | `.wLiquidGlass()` on iOS 18 | iOS 18 device | falls back to `.ultraThinMaterial` |
| T7.3 | sweep reach | 15 call sites updated | grep `glassEffect\|ultraThinMaterial\|wLiquidGlass` finds updated sites |
| T7.3 | message bubble unchanged | chat | bubbles do NOT use glass (legibility preserved) |
| T7.4 | Autopilot Control widget | add to Control Center | SetValueIntent fires on toggle |
| T7.4 | VoiceAsk Control | tap | OpenVoiceAskIntent foregrounds app |
| T7.4 | Relay Control | tap | clipboard relayed to desktop |
| T7.4 | Cost Control | tap | today's cost dialog |
| T7.5 | Rewrite AppIntent | long-press any text, AppShortcut menu | "Rewrite with WOTANN" present |
| T7.5 | Summarize | same | "Summarize with WOTANN" present |
| T7.5 | Expand | same | "Expand with WOTANN" present |
| T7.5 | AppIntents call desktop | invoke + paired desktop | text sent, response returned, replaces selection |
| T7.6 | haptic `strike` | agent action commits | rigid impact felt |
| T7.6 | haptic `pulse` | streaming token | soft impact ×2 |
| T7.6 | haptic `summon` | relay delivered | heavy impact + success notification |
| T7.6 | haptic `warn` | cost threshold | warning notification |
| T7.6 | haptic `rune` | task success | full 2-tier strike |
| T7.6 | audio sting plays | first unlock | ≤400ms cue |
| T7.6 | audio sting once | subsequent unlocks | no re-play |
| T7.6 | Dynamic Type cleanup | text scaling | `Font.wotannScaled(size:)` used, no fixed sizes |

---

---

## Tier 8 — Design Bridge (Claude Design competitor) — 4 weeks / ~800 LOC

### Context (source-verified)

`src/design/` has 15 files total (11 top-level + 4 in `token-emitters/` subdir), 3737 LOC. `handoff-receiver.ts` is 200 LOC reverse-engineering Claude Design's DTCG v6.3 bundle format day-of-launch. `tokens.ts` is 295 LOC canonical source. `extractor.ts` is 705 LOC codebase → design-system extractor.

Claude Design shipped 2026-04-17 at claude.ai/design, Opus 4.7 powered. Handoff bundle format is public W3C DTCG v6.3: manifest.json + design-system.json + components.json + tokens/*.json. WOTANN is premier consumer and producer.

### T8.1 — DTCG emitter (180 LOC)

**NEW FILE**: `src/design/dtcg-emitter.ts`

Extends `extractor.ts` output with full DTCG v6.3 ($type, $value, $description, aliases).

### T8.2 — Bundle writer (150 LOC)

**NEW FILE**: `src/design/bundle-writer.ts`

Mirror image of `handoff-receiver.ts`. Writes manifest + design-system + components + tokens + scaffold.

### T8.3 — Bundle diff (200 LOC)

**NEW FILE**: `src/design/bundle-diff.ts`

Tree-diff two bundles; report tokens added/removed/changed with source-location trail.

### T8.4 — CLI commands (350 LOC)

- `src/cli/commands/design-export.ts` (80 LOC) — `wotann design export --format=dtcg --out ./design-system/`
- `src/cli/commands/design-verify.ts` (80 LOC) — `wotann design verify --against bundle.zip`
- `src/cli/commands/design-apply.ts` (100 LOC) — `wotann design apply <bundle.zip>` through ApprovalQueue
- `src/cli/commands/design-preview.ts` (90 LOC) — Ink TUI palette/spacing/type render

### T8.5 — TUI + tests + docs (360 LOC)

- `src/ui/components/DesignPreview.tsx` (120 LOC)
- `tests/design/bridge.test.ts` (180 LOC) — round-trip identity tests
- `docs/internal/DESIGN_BRIDGE.md` (80 LOC)

### T8.6 — Design Bridge MCP server (200 LOC)

**NEW FILE**: `src/mcp/servers/design-bridge.ts`

Expose `wotann design extract/apply/verify` as MCP tools. Claude Code / Cursor / Zed can invoke WOTANN as tool.

### T8.7 — GitHub Action for design drift (100 LOC)

**NEW FILE**: `.github/actions/wotann-design-verify/action.yml`

Comments on PRs with token drift. Zero-UX team adoption.

**Tier 8 exit criteria**: User prompts Claude Design → exports bundle → `wotann design apply bundle.zip` → tokens land in repo → CSS regenerates → component emission works.

**Tier 8 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T8.1 | DTCG emit — colors | extract + emit | `{ "$type": "color", "$value": "#06B6D4" }` shape |
| T8.1 | DTCG emit — typography | font size | `$type: "typography"` with correct fields |
| T8.1 | DTCG aliases | token refs another token | `$value: "{colors.primary}"` alias syntax |
| T8.2 | bundle write | emit to disk | manifest.json + design-system.json + components.json + tokens/*.json |
| T8.2 | bundle zip | archive | valid zip, extractable |
| T8.3 | bundle diff — added tokens | 2 bundles | diff lists added under additions |
| T8.3 | bundle diff — removed | 2 bundles | diff lists removed under deletions |
| T8.3 | bundle diff — changed | token changed value | diff shows old → new |
| T8.4 | design export CLI | `wotann design export --format=dtcg --out ./ds/` | bundle written to `./ds/` |
| T8.4 | design verify | `wotann design verify --against bundle.zip` | pass/fail report |
| T8.4 | design apply | `wotann design apply bundle.zip` | goes through ApprovalQueue, tokens land |
| T8.4 | design preview TUI | `wotann design preview` | palette + typography rendered in Ink |
| T8.5 | round-trip identity | extract → emit → re-import | identical bundle |
| T8.5 | TUI preview handles huge system | 500 tokens | renders without OOM |
| T8.6 | Design MCP server up | external Claude invokes `wotann design extract` | tool returns bundle |
| T8.7 | design drift CI | PR with token drift | GHA comment on PR with diff |

---

---

## Tier 9 — `wotann build` (Full-stack builder) — 8 weeks / ~1500 LOC

### Scaffold-registry (300 LOC)

**NEW FILE**: `src/build/scaffold-registry.ts`

4 base scaffolds: Next.js App Router, Hono+React (edge), Astro, Expo. Content-addressed template archives, compile+boot tests.

### DB-provisioner (200 LOC)

**NEW FILE**: `src/build/db-provisioner.ts`

3 providers: local-sqlite (default), Turso, Supabase. Unified Drizzle schema emission.

### Auth-provisioner (150 LOC)

**NEW FILE**: `src/build/auth-provisioner.ts`

Lucia default (zero-cloud), Clerk/Supabase-auth/Auth.js/WorkOS via skills.

### Deploy-adapter (250 LOC)

**NEW FILE**: `src/build/deploy-adapter.ts`

4 targets: Cloudflare Pages (default free-tier), Vercel, Fly, self-host (Caddy+systemd).

### CLI + tests + docs (600 LOC)

- `src/cli/commands/build.ts` (150 LOC) — `wotann build [spec]` with `--variants=N --design-system=<path>`
- `src/cli/commands/deploy.ts` (100 LOC) — `wotann deploy --to=<target>`
- Template archives (300 LOC, content-addressed)
- `tests/build/golden.test.ts` (200 LOC) — top-8 blessed combos must compile+boot+serve
- `docs/internal/WOTANN_BUILD.md` (100 LOC)

### Composes existing infra

`PhasedExecutor`, `Jean 4-registry`, `KairosDaemon`, `C6 worktrees + best-of-n`, `LivingSpec`, `ArchitectEditor`, `ApprovalQueue`, `B4 PreCompletionVerifier`, `B12 ProgressiveBudget`, 19-provider router, Observer/Reflector, M7 KG.

**Quality tiers**: 144 combos is too many. **Tier 1 (8 blessed combos)** get golden tests; others ship with "experimental" banner. Users pick from matrix.

**Tier 9 exit criteria**: `wotann build "Todo app with auth, team collab, Stripe billing"` → scaffold picks best base → scaffolds → deploys → user gets live URL.

**Tier 9 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| Scaffold | Next.js App Router pick | spec mentions "server components + streaming" | registry returns `nextjs-app-router` |
| Scaffold | Hono+React pick | spec mentions "edge + minimal" | `hono-react-edge` |
| Scaffold | Astro pick | spec mentions "static content site" | `astro-static` |
| Scaffold | Expo pick | spec mentions "iOS + Android" | `expo` |
| Scaffold | compile+boot test | picked template | boots locally, serves HTTP 200 |
| DB | Turso provisioned | spec picks Turso | `drizzle.config.ts` generated |
| DB | Supabase provisioned | spec picks Supabase | schema + RLS policies |
| DB | local-sqlite default | no provider specified | `.wotann/db.sqlite` created |
| Auth | Lucia default | zero-cloud | Lucia scaffolded |
| Auth | Clerk skill | user asks Clerk | skill loads + scaffolds |
| Deploy | Cloudflare Pages | default free-tier | `wrangler.toml` + `wotann deploy` deploys |
| Deploy | Vercel | explicit | `vercel.json` + deploys |
| CLI | `wotann build` flag parsing | 3 flags | picks correct base, deploys |
| Golden tests | top-8 combos | each compiles + boots + serves | 8/8 green |

---

---

## Tier 10 — Agentic Browser Mode — 8 weeks / ~1480 LOC + 820 LOC P0 security gate

### Context

**REJECT approach A** (Tauri-webview new browser, Chromium CEF ~200MB), **REJECT C** (managed overlay Chrome).

**ACCEPT hybrid D+B**: extend WOTANN's 4-layer CU to be browser-aware (D) + optional MV3 companion extension for sites that block CDP (B).

WOTANN already has: `src/browser/chrome-bridge.ts` (CDP bridge to user's Chrome), `src/browser/browser-tools.ts` (5 ops with SSRF guards), `src/computer-use/computer-agent.ts` (4-layer perception), `src/session/cursor-stream.ts` (30fps agent-cursor stream), `src/session/approval-queue.ts` (typed payloads + fan-out). **~80% already built.**

### T10.P0 — MANDATORY security gate (820 LOC, BEFORE any public beta)

### T10.P0.1 — Prompt-injection quarantine (280 LOC)

**NEW FILE**: `src/security/prompt-injection-quarantine.ts`

CaMeL dual-LLM + XML tag wrapping with HMAC boundary markers. Privileged/Quarantined split: small local classifier reads untrusted first, emits `{injection_detected, confidence, category}`. If confidence > 0.3, turn halts + approval-queue emits `injection-suspected`.

### T10.P0.2 — Hidden-text detector (220 LOC)

**NEW FILE**: `src/security/hidden-text-detector.ts`

Flags: `display:none`, `visibility:hidden`, `opacity<0.1`, off-screen positioning (`left/top < -9999px`), `font-size<2px`, color within 10% ΔE of background (Brave low-contrast), `aria-hidden="true"` on script blocks, canvas bitmap text (OCR diff vs visible-text pass). Dropped text drops before model context.

### T10.P0.3 — URL-instruction guard (180 LOC)

**NEW FILE**: `src/security/url-instruction-guard.ts`

CometJacking defense. Decode URL params (Base64/ROT13), pattern-match imperatives ("ignore previous", "summarize", "send"), refuse navigation if encoded instructions found. Flag `?prompt=` / `?q=` / `?cmd=` / `?agent=` params >200 chars or with injection tokens.

### T10.P0.4 — Trifecta guard middleware (140 LOC)

**NEW FILE**: `src/middleware/trifecta-guard.ts`

Willison's lethal trifecta: untrusted page content + tool with external-comm capability + private data access = mandatory approval. Plugs into 16-layer middleware pipeline.

### T10.1 — Agentic browser orchestrator (600 LOC)

**NEW FILE**: `src/browser/agentic-browser.ts`

Top-level: task → plan → multi-tab dispatch → security → approval → cursor-stream.

### T10.2 — Tab registry (160 LOC)

**NEW FILE**: `src/browser/tab-registry.ts`

Per-target ownership map (`user` | `agent:<taskId>`), enforces `maxAgentTabs=3`.

### T10.3 — Browse tab in desktop-app (300 LOC)

**NEW FILE**: `desktop-app/src/components/browse/BrowseTab.tsx`

5th tab after Chat/Editor/Workshop/Exploit. Live screenshot of active agent tab, DOM tree with highlighted interactive elements, chat box, plan steps, approval queue.

**Critical UX decision**: sidebar lives in WOTANN desktop (Tauri), NOT in browser window. Keeps UI trust boundary at OS level, not DOM level. A compromised browser cannot spoof approval dialogs.

### T10.4 — Surgical mods to existing files

- `src/browser/browser-tools.ts` (+60 LOC): add `browser.plan`, `browser.spawn_tab`, `browser.approve_action`
- `src/browser/chrome-bridge.ts` (+40 LOC): `subscribeTabEvents()` via CDP `Target.attachedToTarget`
- `src/computer-use/computer-agent.ts` (+25 LOC): extend `browseUrl` to call `agentic-browser.ts` when `agentic: true`
- `src/session/approval-queue.ts` (+30 LOC): new `BrowserActionPayload` variant
- `src/session/computer-session-store.ts` (+20 LOC): new event types
- `src/middleware/*` (+15 LOC): register trifecta-guard

### T10.5 — Tier plan

- **MVP (2 weeks)**: single-tab agent + P0.1+P0.2 security + Always-Ask approval
- **Phase 2 (4 weeks)**: P0.3+P0.4 + multi-tab (N=3) + iOS cursor overlay + Skills + MV3 companion extension
- **Full (8 weeks)**: autonomous multi-step + monitor-LLM + delegation modes + 10s undo

**Adversarial eval gate** (operationalized):
- **Test-case source**: OWASP LLM Top 10 v2 (LLM01: Prompt Injection, indirect subclass) + Anthropic Claude-for-Chrome public red-team corpus (referenced in Anthropic's Aug 2025 disclosure) + Brave's Oct 2025 CometJacking reproductions + Simon Willison's "unseeable prompt injections" (2025-10-21 disclosure) + LayerX's public CometJacking samples. Assemble ≥100 unique cases into `tests/security/prompt-injection-eval/cases/*.json` — each with `{payload, attack_vector, expected_block}`.
- **Attack-success metric**: percentage of cases where `injection_detected === false` AND a restricted tool call would have fired without human approval. Calculated across all 4 P0 guards.
- **Exit criteria**: `<2%` attack success rate (matches Anthropic Claude-for-Chrome post-mitigation bar).
- **Test harness**: new `scripts/run-prompt-injection-eval.mjs` runs all cases sequentially against a mock browser session, aggregates the metric, exits nonzero if >=2%.
- **CI gate**: same script runs in `.github/workflows/agentic-browser-security.yml` on every PR touching `src/browser/` or `src/security/prompt-injection-*`.
- **Regression forbidden**: any single case flipping from block → no-block fails CI even if aggregate stays <2%.

**Effort re-calibration**: MVP scope bumped from 2 weeks to **4 weeks** — 820 LOC P0 security + single-tab agent + Always-Ask UI in 2 weeks was 2x optimistic per audit.

**Tier 10 exit criteria**: `wotann browse "find cheapest USB-C cable >4 stars on Amazon, add to cart"` → agent drives tab → shows cursor trail → requests approval at checkout → ships safely.

**Tier 10 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T10.P0.1 | injection confidence > 0.3 | payload contains "ignore previous" | turn halts, approval event emitted |
| T10.P0.1 | injection confidence ≤ 0.3 | benign text | turn continues |
| T10.P0.1 | classifier unavailable | local model fails | defaults to halt + approval (fail-safe) |
| T10.P0.2 | `display:none` text | page has hidden content | content dropped from model context |
| T10.P0.2 | low-contrast text | color within 10% ΔE | dropped |
| T10.P0.2 | canvas text | canvas bitmap | OCR'd; if mismatch, dropped |
| T10.P0.3 | Base64-encoded URL instruction | `?prompt=<base64>` with "ignore previous" | refused |
| T10.P0.3 | legitimate long URL | >200 chars but benign | allowed |
| T10.P0.4 | trifecta trigger | untrusted content + tool with external-comm + private data | mandatory approval |
| T10.P0.4 | 2 of 3 | missing one element | proceeds without approval |
| T10.1 | top-level orchestrator | task → plan → dispatch | ends with cursor-stream + approval flow |
| T10.2 | tab registry — 3 agent tabs | 4th creation attempt | rejected with "max agent tabs exceeded" |
| T10.3 | desktop Browse tab | opens | shows screenshot + DOM tree + chat + plan + queue |
| T10.3 | sidebar in OS-level WOTANN | not in browser | trust boundary preserved |
| T10.4 | `browser.plan` call | RPC | returns plan |
| T10.4 | `browser.spawn_tab` | RPC | new tab created, registered in map |
| T10.4 | trifecta-guard middleware | wires into pipeline | fires on every browser tool |
| T10.5 | MVP — single tab | 2-week scope | approval at every action |
| T10.5 | Phase 2 — multi-tab | 4-week | max 3 agent tabs |
| T10.5 | Full — autonomous | 8-week | monitor-LLM + delegation + 10s undo |
| Adversarial eval | <2% attack success | ≥100 unique cases | overall rate <2% |
| Adversarial eval | regression forbidden | single case flip block→no-block | CI fails |
| CI gate | PR touches `src/browser/` | GHA runs eval | pass/fail reflected in status |

---

---

## Tier 11 — Virtual-cursor + Sleep-time compute + Cloud-offload — 4-6 weeks / ~3000 LOC

### T11.1 — Virtual-cursor sandbox (600-900 LOC, 4-6 days)

**WHAT**: Codex-BG-CU parallel-cursor pattern. Multiple agent sessions + per-session cursors simultaneously.

**WHERE**:
- `src/computer-use/virtual-cursor-pool.ts` (400 LOC) — session manager, input arbiter @50Hz, K-means wallpaper color extraction
- `src/computer-use/cursor-sprite.ts` (150 LOC) — wiggle + Bezier overlay
- `src/computer-use/session-scoped-perception.ts` (200 LOC) — per-session screenshot regions
- `desktop-app/cursor-overlay.html` (+100 LOC) — multi-cursor rendering

**Architecture**: single-threaded input arbiter serializes concurrent input (OS sees sequential events at rate apps behave normally). Each session has independent perception + color + position. Copies Codex's Apr 16 2026 macOS pattern.

**Roll-out**: macOS → Linux X11 → Windows.

### T11.2 — Sleep-time compute (400-600 LOC, 2-3 days)

**WHAT**: Per Letta's research paper "Sleep-time Compute: Beyond Inference Scaling at Test-time" ([arxiv.org/html/2504.13171v1](https://arxiv.org/html/2504.13171v1), corroborated by [letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute)), sleep-time compute measured 2.5× cost savings / 5× compute / 18% accuracy improvements vs baseline. WOTANN's `autodream.ts` is 80% of this.

**WHERE**:
- NEW `src/learning/sleep-time-agent.ts` (400 LOC)
- NEW `src/context/sleep-summarizer.ts` (200 LOC)
- MODIFY `src/learning/autodream.ts` (minor)

**HOW**: Between turns, fire background summarization + memory consolidation on accumulated context. Reduces active context size for next turn; recalls precomputed insights.

### T11.3 — Cloud-offload adapters (1200-1800 LOC, 5-8 days)

**NEW FILES in `src/providers/cloud-offload/`**:
- `anthropic-managed.ts` (350 LOC) — Anthropic Managed Agents ($0.08/active-hour + tokens, public beta Apr 8 2026)
- `fly-sprites.ts` (450 LOC) — Fly.io Firecracker VMs with Claude preinstalled
- `cloudflare-agents.ts` (400 LOC) — Cloudflare Agents SDK (Durable Objects, $0 idle)
- `adapter.ts` (150 LOC) — shared trait + registry
- `snapshot.ts` (200 LOC) — cwd tarball, git HEAD, env allowlist (no secrets), memory export
- `session-handle.ts` (150 LOC) — metering, cost tracker

**CLI**: `wotann offload [--provider managed|fly|cf]`

**Rule**: ship 3 adapters, NOT 1 (quality bar: no vendor bias). Proves neutrality vs Anthropic Managed Agents' $58/mo.

**Tier 11 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T11.1 | virtual cursor pool — 2 sessions | 2 parallel agents | 2 cursors on screen, each independent |
| T11.1 | input arbiter @50Hz | concurrent input | sequential events at normal rate |
| T11.1 | wallpaper color extract | K-means | cursor color contrasts with wallpaper |
| T11.1 | sprite wiggle | mouse idle | micro-motion visible |
| T11.1 | Bezier overlay | pathing | smooth curve to target |
| T11.1 | macOS roll-out | macOS first | works; linux/windows skip |
| T11.2 | sleep-time agent | between turns | summarization + memory-consolidation fire |
| T11.2 | next-turn context smaller | after sleep-time | context reduced vs baseline |
| T11.2 | 2.5× cost savings | measured | matches paper's claim |
| T11.3 | Modal offload | `wotann offload --provider managed` | runs on Anthropic Managed Agents |
| T11.3 | Fly offload | `--provider fly` | Fly machine boots, runs |
| T11.3 | Cloudflare offload | `--provider cf` | Durable Object runs |
| T11.3 | snapshot — cwd | tarball | reproducible on target |
| T11.3 | snapshot — secrets excluded | env allowlist | no secrets in snapshot |
| T11.3 | session-handle metering | cost tracked | shown in StatusRibbon |

---

## Tier 12 — Competitor Port Backlog — ongoing / ~8000 LOC

**NOTE on executability**: Tier 12 was originally a **BACKLOG** with 1-4 sentence summaries per item. The A+ audit (3rd pass, 2026-04-21) required FULL decomposition of every T12.x port with WHAT/WHY/WHERE/HOW/VERIFICATION blocks so Claude Code can execute without guesswork. That decomposition is below. Reference Engram `research/oss-ecosystem-sweep` + `research/tier-b-strategic-moat` for additional context per item. `[EXPAND-BEFORE-EXEC]` no longer applies — every item is exec-ready.

**Cross-cutting quality bars for T12**:
- QB #15: every LOC estimate is a REFERENCE target. Verify current file sizes via `wc -l` before claiming "expands existing file by N".
- QB #11: sibling-site scan before wiring — use `grep -rn "newFunctionName" src/` to find all call sites that need updating in the same commit.
- QB #7: per-session state, not module-global — every port that holds state holds it per session.
- QB #6: honest stubs — if the port can't be activated on current platform (macOS/Linux/Windows), emit `{ok: false, reason: "..."}`, never silent success.

Priority-ordered by (leverage × proven-impact / effort). Each item is exec-ready — cold-read Claude Code in 6 months can execute without additional research.

---

### T12.1 — Meta-Harness environment bootstrap (400 LOC, 2 days) — +3-5 pts TB2

**WHAT**: Expand WOTANN's existing `src/core/bootstrap-snapshot.ts` to match Stanford IRIS Meta-Harness's richer signal set + inject into initial system prompt + emit an "environment manifest" entry to Engram at session start. IRIS Meta-Harness (950★) demonstrates +3-5 TerminalBench 2.0 points by reducing first-10-turn discovery overhead. Current WOTANN bootstrap-snapshot captures 6 fields; extend to 10 + make default-on.

**WHY**: Without upfront environment capture the agent wastes 8-15 turns running `ls`, `git status`, `cat package.json`, `node --version`, etc. before doing useful work. TerminalBench 2.0 scoring discounts these "context-establishing" turns. Source-verified: `src/core/bootstrap-snapshot.ts` exists (~30 LOC scaffold in head block), called from `src/core/runtime.ts` system-prompt assembly at approximately line 1762 (check before edit). The port doubles the captured signal set and makes bootstrap default-enabled.

**WHERE** (files to EDIT, no NEW files — extend existing):
- EDIT `src/core/bootstrap-snapshot.ts` (~+250 LOC over current size; target ~400 LOC) — add 4 fields (installed language toolchains via `which node/python/go/cargo/uv`, `docker ps --format`, active port listeners via `lsof -iTCP -sTCP:LISTEN -P -n` on macOS/Linux, shell-history last 20 cmds via `$HISTFILE` parse if readable)
- EDIT `src/core/runtime.ts` (~+40 LOC) — wire `captureBootstrapSnapshot()` default-on + ensure `formatForPrompt(snapshot)` is inserted into system prompt before existing `localContextPrompt` block
- EDIT `src/core/types.ts` (~+10 LOC) — add `skipBootstrapSnapshot?: boolean` to `RuntimeConfig` (default false for production, true for benchmark smoke runs where 50ms overhead matters)
- EDIT `src/memory/store.ts` — after session init, upsert `{topic_key: "env-manifest", content: JSON.stringify(snapshot), type: "reference"}` (~+30 LOC at session-init hook)
- NEW `tests/core/bootstrap-snapshot.test.ts` (~200 LOC) — unit tests for 10-field capture, scrub verification, failure-mode stubs
- NEW `tests/integration/bootstrap-prompt-injection.test.ts` (~80 LOC) — assert snapshot is in system prompt at first turn

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (IRIS-meta-harness subsection).

**HOW**:
```typescript
// src/core/bootstrap-snapshot.ts — new fields
export interface BootstrapSnapshot {
  tree: TreeField;
  git: GitField;
  env: EnvField;
  services: ServicesField;
  logs: LogsField;
  lockfiles: LockfilesField;
  toolchains: ToolchainsField;   // NEW: node/python/go/cargo/uv/ruby/java versions + paths
  docker: DockerField;            // NEW: `docker ps --format '{{json .}}'` output or {captured: false, reason: "docker not installed"}
  ports: PortsField;              // NEW: listening sockets with pid+cmd where available
  shellHistory: ShellHistoryField; // NEW: last 20 cmds, PII-scrubbed (no passwords/tokens in args)
}

async function captureToolchains(): Promise<ToolchainsField> {
  const binaries = ["node", "python3", "go", "cargo", "uv", "ruby", "java", "rustc", "deno", "bun"];
  const out: Record<string, { path: string; version: string } | null> = {};
  for (const bin of binaries) {
    const { status, stdout } = await execFileNoThrow("which", [bin]);
    if (status !== 0) { out[bin] = null; continue; }
    const path = stdout.trim();
    const versionProbe = await execFileNoThrow(path, ["--version"]);
    out[bin] = { path, version: (versionProbe.stdout ?? versionProbe.stderr ?? "").trim().slice(0, 80) };
  }
  return { captured: true, toolchains: out };
}

// In src/core/runtime.ts, around the localContextPrompt assembly:
if (this.config.skipBootstrapSnapshot !== true) {
  const snapshot = await captureBootstrapSnapshot({ rootDir: this.session.cwd });
  const block = formatForPrompt(snapshot);
  this.localContextPrompt = block + "\n\n" + this.localContextPrompt;
  // Also upsert into memory for later cross-session recall
  await this.memoryStore.upsertObservation({
    topic_key: "env-manifest",
    type: "reference",
    content: JSON.stringify(snapshot),
    tags: ["bootstrap", this.session.id],
  });
}
```

**VERIFICATION**:
```bash
# Bootstrap snapshot module expanded (~400 LOC)
wc -l src/core/bootstrap-snapshot.ts  # Expect: 380-420

# All 10 fields captured in snapshot output
node -e 'import("./dist/core/bootstrap-snapshot.js").then(m => m.captureBootstrapSnapshot({rootDir: "."})).then(s => { const keys = Object.keys(s); console.log(keys); if (!["tree","git","env","services","logs","lockfiles","toolchains","docker","ports","shellHistory"].every(k => keys.includes(k))) process.exit(1); })'

# Runtime injects snapshot into system prompt
grep -n "formatForPrompt(snapshot)" src/core/runtime.ts  # Expect: 1+ match

# Default-on gate: skipBootstrapSnapshot defaults false
grep -n "skipBootstrapSnapshot" src/core/types.ts  # Expect: defined with default false

# Test suite passes
npx vitest run tests/core/bootstrap-snapshot.test.ts tests/integration/bootstrap-prompt-injection.test.ts 2>&1 | tail -3

# TB2 smoke: before/after diff
# Save 10-turn transcript pre-wire + post-wire; count turns until first non-discovery action
node scripts/bootstrap-impact-probe.mjs  # NEW probe; target: -5 to -8 discovery turns median
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| happy path — all 10 fields capture | `node dist/core/bootstrap-snapshot.js` in WOTANN repo | JSON with all 10 field keys present, `captured: true` on most |
| macOS + no docker | spawn `DOCKER_HOST=invalid node dist/core/bootstrap-snapshot.js` | `docker: {captured: false, reason: "docker daemon unreachable"}` (NOT silent empty) |
| permission denied on logs | chmod 000 `.wotann/engine.log`; run capture | `logs: {captured: false, reason: "EACCES"}` |
| env scrub skips secrets | set `API_KEY=foo` in env, run capture | `env.filtered` does NOT contain "API_KEY" literal or "foo" value |
| snapshot is per-session | Run 2 sessions, inspect `env-manifest` topic_key observations | 2 observations, each tagged with its session.id |
| benchmark bypass | Run with `skipBootstrapSnapshot: true` | Snapshot field absent in system prompt; faster startup measurable |

---

### T12.2 — Terminus-KIRA 6 tricks (260 LOC, 4 days) — +4-7 pts TB2

**WHAT**: Port Terminus-KIRA's 6 TerminalBench-2-winning optimizations to WOTANN. Terminus-KIRA is the OSS snapshot of `terminus-agent` with +4-7 point gains on TB2. WOTANN already has tool parsers and prompt caching infrastructure; this port fills the last 6 gaps: (1) native tool-calling across all providers (not just string-parse), (2) marker-based command polling in terminal tool, (3) image_read action in terminal for visual verification, (4) smart completion checklist prepended to completion-verification agent, (5) ephemeral prompt caching verified on Opus/Sonnet/Haiku, (6) tmux "pull" mechanism for bg commands.

**WHY**: WOTANN's terminal tool currently uses fixed-wait heuristics (`sleep 0.3 && cat output`) which races with real terminal output. Marker-based polling ("end_of_command_output_reached") drops false-positive "command still running" rates by 80%+. Native tool calling cuts parsing overhead by ~50ms/call. `image_read` unlocks visual-UI terminal workflows (vim, tmux, matplotlib plots in terminal). The 6 tricks compound.

**WHERE** (6 surgical mods + 2 NEW):
- EDIT `src/providers/tool-parsers/parsers.ts` (~+30 LOC) — verify native tool mode paths for all 19 providers; add `nativeToolMode: true` flag where API supports (Anthropic, OpenAI chat-completions with tools, Gemini function-calling, Groq tool-use, Cerebras tool-use, Mistral tool-use)
- EDIT `src/tools/aux-tools.ts` OR create `src/tools/terminal-run.ts` if not present (~+80 LOC) — inject `echo '__WOTANN_END_OF_CMD_$$__'` marker after user command; poll stdout until marker seen or timeout
- NEW `src/tools/image-read.ts` (~120 LOC) — reads PNG/JPG/GIF by path, returns base64+mime for model consumption; register as tool `image_read`
- EDIT `src/verification/pre-commit.ts` OR NEW `src/verification/completion-checklist.ts` (~+40 LOC) — prepend 6-item checklist ("tests green? typecheck green? lint clean? PR description filled? commit message conventional? no TODOs added?")
- EDIT `src/providers/prompt-cache-warmup.ts` (~+20 LOC) — add ephemeral cache hints for Opus/Sonnet/Haiku (`cache_control: {type: "ephemeral"}`); verify via rate-limit headers
- NEW `src/tools/tmux-pull.ts` (~60 LOC) — `tmux capture-pane -pJ -S -` pull pattern for bg sessions; exposes `tmux_pull(session_name)` tool

**Cross-reference**: Engram wire-audit topic_keys (Tier 12 wave), `research/tier-b-strategic-moat` (Terminus-KIRA subsection).

**HOW**:
```typescript
// src/tools/terminal-run.ts — marker polling
const MARKER_PREFIX = "__WOTANN_END_OF_CMD_";

export async function runTerminalCommandWithMarker(
  cmd: string,
  opts: { timeoutMs: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number; markerHit: boolean }> {
  const marker = `${MARKER_PREFIX}${process.pid}_${Date.now()}__`;
  const wrapped = `(${cmd}); echo '${marker}:exit='$?`;
  // ...spawn, poll for marker, slice off marker line...
}

// src/tools/image-read.ts
export async function readImage(absPath: string): Promise<{ base64: string; mimeType: "image/png" | "image/jpeg" | "image/gif" }> {
  const buf = await readFile(absPath);
  const ext = extname(absPath).toLowerCase().slice(1);
  const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
  return { base64: buf.toString("base64"), mimeType };
}

// src/verification/completion-checklist.ts — the 6-item checklist
export const COMPLETION_CHECKLIST = [
  "Did you run `npx tsc --noEmit` and get rc=0?",
  "Did you run `npx vitest run` and no new failures?",
  "Did you run lint (`npm run lint` or eslint)?",
  "Is the PR description / commit message filled out?",
  "Did you scrub TODO/FIXME/XXX added to changed files?",
  "Did you update docs (README / CHANGELOG / inline JSDoc) for public API changes?",
] as const;
```

**VERIFICATION**:
```bash
# Native tool calling enabled on 6+ providers
grep -n "nativeToolMode.*true" src/providers/*.ts | wc -l  # Expect: 6+

# Marker polling present in terminal tool
grep -n "__WOTANN_END_OF_CMD_" src/tools/ src/core/ | wc -l  # Expect: 1+ (in terminal-run.ts)

# image_read tool registered
grep -rn "image_read" src/tools/ src/core/runtime-tools.ts  # Expect: file + registration

# Checklist present in completion-verify path
grep -n "COMPLETION_CHECKLIST\|completion-checklist" src/verification/ src/intelligence/pre-completion-verifier.ts  # Expect: 1+

# Ephemeral cache flag emitted
grep -n "ephemeral" src/providers/prompt-cache-warmup.ts src/providers/anthropic-adapter.ts  # Expect: 1+

# tmux pull tool
test -f src/tools/tmux-pull.ts && grep -n "tmux capture-pane" src/tools/tmux-pull.ts  # Expect: file exists + pattern

# Tests pass
npx vitest run tests/tools/terminal-run.test.ts tests/tools/image-read.test.ts 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| marker polling — fast command | `runTerminalCommandWithMarker("echo hi", {timeoutMs: 1000})` | `{stdout: "hi\n", markerHit: true, exitCode: 0}` |
| marker polling — timeout | `runTerminalCommandWithMarker("sleep 10", {timeoutMs: 200})` | `{markerHit: false, exitCode: null}`, process killed |
| image_read happy | PNG file exists | `{base64: "...", mimeType: "image/png"}` with valid base64 |
| image_read missing file | path does not exist | throws with path in error message |
| image_read unsupported ext | `.bmp` file | throws `Unsupported image type: bmp` |
| checklist injection | pre-completion verifier runs | system prompt contains all 6 checklist questions |
| tmux_pull no session | tmux not running | `{ok: false, reason: "no tmux server"}` honest stub |

---

### T12.3 — WarpGrep parallel search subagent (180 LOC, 3 days) — +2-3 pts across TB/SWE/Aider

**WHAT**: New subagent-mode tool `parallel_search` that fans out 8 concurrent grep queries, each targeting a different slice of the repo (glob pattern + file-type filter + directory restriction). Returns **only matching spans** (10-line context windows), never full-file dumps. Shields the main session from rejected files (node_modules, dist, .git, lockfiles). WOTANN already has `src/intelligence/parallel-search.ts` (401 LOC, Perplexity-style multi-source search) and `src/tools/parallel-grep.ts` (211 LOC); this is the agent-invokable wrapper that glues those together with a WarpGrep-style budget controller.

**WHY**: SWE-bench + TerminalBench tasks regularly burn 10-30 turns on "where is X defined?" grep sequences. 8 parallel queries + span-only response reduces this to 1-2 turns. WarpGrep's pattern: main agent dispatches a SUBAGENT that owns the search budget (max 200 hits, max 30KB output, max 3s wall time), returns a ranked list, and never pollutes main context with file listings.

**WHERE**:
- NEW `src/intelligence/parallel-search-agent.ts` (~180 LOC) — subagent wrapper, budget controller, span-extractor, ranker
- EDIT `src/intelligence/parallel-search.ts` (existing 401 LOC; ~+40 LOC) — expose `runParallelGrepQueries(queries: GrepQuery[]): Promise<GrepHit[]>` as low-level primitive
- EDIT `src/tools/parallel-grep.ts` (existing 211 LOC; ~+30 LOC) — add span-only output format (never full-file)
- EDIT `src/core/runtime-tools.ts` — register `parallel_search` tool with subagent dispatch
- EDIT `src/tools/task-tool.ts` — add `parallel_search` as a preset subagent prompt
- NEW `tests/intelligence/parallel-search-agent.test.ts` (~150 LOC)

**Cross-reference**: Engram wire-audit topic_keys (Tier 12 wave) + Engram `research/oss-ecosystem-sweep` (WarpGrep/WarpDrive subsection).

**HOW**:
```typescript
// src/intelligence/parallel-search-agent.ts
export interface GrepQuery {
  readonly pattern: string;
  readonly glob?: string;       // e.g., "**/*.ts"
  readonly type?: string;       // rg --type preset
  readonly path?: string;       // dir restriction
  readonly caseInsensitive?: boolean;
  readonly maxMatchesPerFile?: number;
}

export interface GrepHit {
  readonly file: string;
  readonly line: number;
  readonly contextBefore: readonly string[];  // 5 lines
  readonly match: string;
  readonly contextAfter: readonly string[];    // 5 lines
  readonly score: number;  // rank by match-density / recency / importance
}

export interface ParallelSearchBudget {
  readonly maxHits: number;        // default 200
  readonly maxOutputBytes: number; // default 30 * 1024
  readonly timeoutMs: number;      // default 3000
}

export async function dispatchParallelSearch(
  queries: readonly GrepQuery[],
  budget: ParallelSearchBudget = DEFAULT_BUDGET,
  context: RunCtx
): Promise<{ hits: readonly GrepHit[]; truncated: boolean; reason?: string }> {
  if (queries.length > 8) {
    return { hits: [], truncated: true, reason: "Too many queries (max 8 parallel)" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget.timeoutMs);
  try {
    const results = await Promise.all(
      queries.map((q) => runSingleGrep(q, controller.signal, budget))
    );
    const merged = mergeAndRank(results.flat(), budget);
    return {
      hits: merged.hits,
      truncated: merged.truncated,
      reason: merged.truncated ? "Budget exceeded" : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Tool registration in src/core/runtime-tools.ts:
// name: "parallel_search"
// input schema: { queries: GrepQuery[], budget?: Partial<ParallelSearchBudget> }
// output: { hits, truncated, reason? }
// permission: "Read"  (no writes)
```

**VERIFICATION**:
```bash
# Subagent module exists
test -f src/intelligence/parallel-search-agent.ts && wc -l src/intelligence/parallel-search-agent.ts  # Expect: 160-220 LOC

# Registered as tool
grep -n "parallel_search" src/core/runtime-tools.ts  # Expect: registration entry

# Test passes (fan-out correctness, budget enforcement, span-only output)
npx vitest run tests/intelligence/parallel-search-agent.test.ts 2>&1 | tail -3

# tsc clean
npx tsc --noEmit  # rc=0

# Budget enforcement sanity: 9-query input returns error
node -e 'import("./dist/intelligence/parallel-search-agent.js").then(m => m.dispatchParallelSearch(Array(9).fill({pattern: "foo"}), undefined, {})).then(r => { if (!r.truncated) process.exit(1); })'
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| 4 parallel queries, small results | dispatch 4 patterns returning <50 hits total | `{hits: [...], truncated: false}` with all hits |
| budget exceeded (many matches) | pattern with >200 hits | `{truncated: true, reason: "Budget exceeded"}` + first 200 hits |
| timeout mid-search | pattern against giant dir, timeout: 10ms | `{truncated: true, reason: "..."}`, no hang |
| 9 queries (over cap) | 9 queries | `{hits: [], truncated: true, reason: "Too many queries (max 8 parallel)"}` |
| span-only output | query returns 10 hits | each hit has `contextBefore.length === 5` + `contextAfter.length === 5`, never full file |
| rejected files shielded | pattern matches inside node_modules/ | result hits do NOT include node_modules/ paths |

---

### T12.4 — Goose Recipe YAML system (~800 LOC, 1 week)

**WHAT**: Port Goose's recipe YAML format as WOTANN's community-shareable workflow definition. Goose recipes are declarative task templates with `instructions + required_extensions + parameters + retry + sub_recipes + cron`. WOTANN adds `wotann recipe run <path-or-name>`, `wotann recipe share`, and a community index browser. Recipes become the ubiquitous "scripts" for AI agents — each published recipe is a portable task pipeline.

**WHY**: OpenClaw has skills, Claude Code has slash commands, Jean has Magic Commands, Goose has recipes. WOTANN needs a NAMED format for "how do I accomplish Task X" to unlock community virality. Recipes compound: a recipe for "extract Postgres schema → generate Zod validators" composes with a recipe for "run Zod fuzzer" to form a complete test-generation pipeline. Every published recipe is distributed knowledge that makes WOTANN smarter per user.

**WHERE**:
- NEW `src/recipes/` module (~600 LOC):
  - `src/recipes/types.ts` (~80 LOC) — `Recipe`, `RecipeStep`, `RecipeParams`, `RecipeRetry`, `RecipeCron`, `RecipeSubRecipe` types
  - `src/recipes/loader.ts` (~150 LOC) — YAML file parse, schema validate (Zod), resolve `$include` sub-recipes
  - `src/recipes/runner.ts` (~250 LOC) — runtime: takes Recipe + params, executes steps (tool calls, prompts, bash), handles retry + sub-recipe invocation
  - `src/recipes/cron-bridge.ts` (~120 LOC) — bridges `recipe.cron` to existing `src/scheduler/cron-scheduler.ts`
- NEW `src/cli/commands/recipe.ts` (~150 LOC) — verbs: `run`, `list`, `share`, `install`, `inspect`
- NEW `.wotann/recipes/` (filesystem convention, user+project)
- NEW `docs/RECIPES.md` (~200 LOC) — format spec + 6 examples
- EDIT `src/index.ts` — wire `wotann recipe` verb dispatch (in thin CLI dispatcher)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (Goose/Goose-recipes subsection).

**HOW**:
```yaml
# Example .wotann/recipes/refactor-for-tests.yaml
version: 1
id: refactor-for-tests
title: "Refactor file for testability + add tests"
author: community
instructions: |
  Given a TypeScript file, refactor it to be testable: extract pure functions,
  inject dependencies, then write vitest tests covering 80%+ branches.
required_extensions: [typescript, vitest]
parameters:
  - name: filePath
    type: string
    required: true
    description: Path to file to refactor
  - name: targetCoverage
    type: number
    default: 80
retry:
  maxAttempts: 2
  strategy: exponential
steps:
  - type: read
    path: "{{filePath}}"
  - type: prompt
    text: |
      Refactor {{filePath}} for testability. Target: {{targetCoverage}}% coverage.
      Use vitest. Output: (1) refactored file (2) new test file.
  - type: bash
    cmd: "npx vitest run --coverage"
    expect: "passing"
sub_recipes:
  - ref: code-review/typescript
    with:
      file: "{{filePath}}"
```

```typescript
// src/recipes/types.ts
export interface Recipe {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly instructions: string;
  readonly requiredExtensions?: readonly string[];
  readonly parameters: readonly RecipeParam[];
  readonly retry?: RecipeRetry;
  readonly steps: readonly RecipeStep[];
  readonly subRecipes?: readonly RecipeSubRecipe[];
  readonly cron?: RecipeCron;
}

// src/recipes/runner.ts signature:
export async function runRecipe(
  recipe: Recipe,
  params: Readonly<Record<string, unknown>>,
  runtime: WotannRuntime,
): Promise<{ ok: boolean; outputs: readonly RecipeStepOutput[]; error?: string }>;
```

**VERIFICATION**:
```bash
# Recipes module scaffolded
ls src/recipes/ | wc -l  # Expect: 4+ files

# CLI command wired
grep -n "recipe" src/index.ts src/cli/commands/  # Expect: dispatch in index.ts, commands/recipe.ts

# Example recipes present in repo
ls .wotann/recipes/*.yaml 2>/dev/null | wc -l  # Expect: 3+ seed recipes

# Schema validation works
node -e 'import("./dist/recipes/loader.js").then(m => m.loadRecipe(".wotann/recipes/refactor-for-tests.yaml")).then(r => console.log("OK:", r.id))'

# Runner end-to-end
wotann recipe run refactor-for-tests --param filePath=src/foo.ts --dry-run  # Expect: plan printed, no exec

# Cron bridge
grep -n "runRecipe\|recipe-runner" src/scheduler/cron-scheduler.ts  # Expect: cron hook

# Tests pass
npx vitest run tests/recipes/ 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| YAML parse happy | valid `refactor-for-tests.yaml` | parsed Recipe object, no errors |
| missing required param | run without `filePath` | `{ok: false, error: "Missing required param: filePath"}` |
| sub-recipe resolution | recipe with `subRecipes: [{ref: "code-review/typescript"}]` | sub-recipe loaded + executed in sequence |
| retry on flake | step fails once, succeeds on retry #2 | `{ok: true}`, attempts recorded |
| cron wiring | recipe with `cron: "0 * * * *"` installed | entry present in `.wotann/schedule.db` |
| invalid YAML | malformed file | `{ok: false, error: "YAML parse error: ..."}` |
| unknown extension | `required_extensions: [fake-ext]` | `{ok: false, error: "Required extension fake-ext not available"}` |

---

### T12.5 — Continue.dev PR-as-status-check (~900 LOC, 2 weeks)

**WHAT**: `.wotann/checks/*.md` files declare markdown-described checks (e.g., "API routes must have OpenAPI schema", "No new TODO comments", "All public functions have JSDoc"). On PR, a GitHub Action runs each check via a WOTANN subagent that posts PASS/FAIL as a status check. Continue.dev shipped this pattern 2026-03; competitive moat vs Claude Code (which has no such feature).

**WHY**: Teams want AI-enforced review policies that live in-repo as Markdown. Current alternatives (CodeRabbit, Greptile) are SaaS-gated and $20-40/user/mo. `.wotann/checks/*.md` is in-repo, free, and checked-in as code policy — every PR reviewer sees the same rules enforced.

**WHERE**:
- NEW `src/pr-checks/` module (~500 LOC):
  - `src/pr-checks/types.ts` (~60 LOC) — `PrCheck`, `PrCheckResult`, `PrCheckDef` types
  - `src/pr-checks/loader.ts` (~100 LOC) — read `.wotann/checks/*.md`, parse frontmatter + body
  - `src/pr-checks/runner.ts` (~240 LOC) — invokes subagent per check with PR diff + check description; parses PASS/FAIL from response
  - `src/pr-checks/github-reporter.ts` (~100 LOC) — posts via GitHub API; status = success/failure/neutral
- NEW `.github/actions/wotann-pr-checks/action.yml` (~50 LOC) — composite action that installs WOTANN + runs checks
- NEW `.github/workflows/pr-checks.yml` (~40 LOC) — workflow dispatching action on `pull_request`
- NEW `src/cli/commands/pr-check.ts` (~100 LOC) — `wotann pr-check run` local verb for dev loop
- NEW `.wotann/checks/` + `docs/PR_CHECKS.md` (~150 LOC) — format spec + 5 seed checks
- EDIT `src/index.ts` — wire `wotann pr-check` verb

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (Continue.dev PR-as-check subsection).

**HOW**:
```markdown
<!-- .wotann/checks/no-hardcoded-secrets.md -->
---
id: no-hardcoded-secrets
severity: blocking
provider: anthropic
model: sonnet
---

# No Hardcoded Secrets

Review this diff for hardcoded API keys, passwords, tokens, or connection strings.

PASS if: no hardcoded credentials found.
FAIL if: any credential-looking string (sk-*, AKIA*, xoxb-*, etc.) is committed.

Respond with exactly one line starting with `PASS:` or `FAIL: <short reason>`.
```

```typescript
// src/pr-checks/runner.ts
export async function runPrCheck(
  check: PrCheckDef,
  prDiff: string,
  runtime: WotannRuntime
): Promise<PrCheckResult> {
  const subagent = runtime.createSubagent({
    provider: check.provider ?? "anthropic",
    model: check.model ?? "sonnet",
    maxTurns: 3,
    tools: [],  // diff-only, no repo access
    systemPrompt: check.body,
  });
  const response = await subagent.query(`\`\`\`diff\n${prDiff}\n\`\`\``);
  const first = response.text.split("\n")[0]?.trim() ?? "";
  if (first.startsWith("PASS:") || first === "PASS") {
    return { id: check.id, status: "pass", message: first };
  }
  if (first.startsWith("FAIL:")) {
    return { id: check.id, status: "fail", message: first.slice(5).trim() };
  }
  return { id: check.id, status: "neutral", message: `Unparseable: ${first.slice(0, 80)}` };
}
```

**VERIFICATION**:
```bash
# Checks module scaffolded
ls src/pr-checks/*.ts | wc -l  # Expect: 4+

# Workflow + action present
test -f .github/workflows/pr-checks.yml && test -f .github/actions/wotann-pr-checks/action.yml

# Seed checks
ls .wotann/checks/*.md | wc -l  # Expect: 5+

# Local `wotann pr-check run` works
wotann pr-check run --against main  # Expect: table of check results

# Tests
npx vitest run tests/pr-checks/ 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| PASS response | check that passes clean diff | `{status: "pass", message: "PASS:"}` |
| FAIL response | check that finds issue | `{status: "fail", message: "<reason>"}` |
| unparseable response | model ignores format | `{status: "neutral"}` + log warning |
| check loader missing frontmatter | `.md` without YAML frontmatter | loader rejects with clear error |
| GitHub API reporter fails | 503 on status-post | retries 3x, returns `{ok: false, error}` after |
| blocking severity + fail | any FAIL blocks merge | GitHub status `failure` reflecting |
| neutral severity + fail | `severity: advisory` + FAIL | GitHub status `neutral`, merge allowed |

---

### T12.6 — Agentless localize→repair→validate mode (~700 LOC, 1 week)

**WHAT**: Port CMU/SWE-research "Agentless" paper pattern. Instead of autonomous loops, run 3 discrete phases: LOCALIZE (find the buggy file/function via grep + rank), REPAIR (generate fix from localized context), VALIDATE (run tests). Paper reports $0.34/issue vs $2-12 for autonomous agents. `wotann --mode=agentless` dispatches this flow; matches WOTANN's free-tier-first bar by minimizing inference spend.

**WHY**: Autonomous agents burn tokens on exploration. On SWE-bench Lite, Agentless gets 32% with $0.34/issue; autonomous gets 45-60% with $3-12/issue. For cost-sensitive users (free-tier providers), Agentless wins on $/success-ratio by ~10x.

**WHERE**:
- NEW `src/modes/agentless/` module (~600 LOC):
  - `src/modes/agentless/types.ts` (~40 LOC) — `LocalizeResult`, `RepairResult`, `ValidateResult`
  - `src/modes/agentless/localize.ts` (~200 LOC) — grep + symbol-rank, rank top-5 candidate files
  - `src/modes/agentless/repair.ts` (~200 LOC) — given issue description + 5 candidate files, produce unified diff
  - `src/modes/agentless/validate.ts` (~160 LOC) — apply diff in `tmp-branch`, run `npm test`, revert if fail
- NEW `src/cli/commands/agentless.ts` (~100 LOC) — `wotann agentless <issue-url-or-text>` verb
- EDIT `src/index.ts` — wire verb; EDIT existing `--mode` flag parser to accept `agentless`
- NEW `tests/modes/agentless/` (~200 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (Agentless CMU paper subsection).

**HOW**:
```typescript
// src/modes/agentless/localize.ts
export async function localizeIssue(
  issue: { title: string; body: string },
  runtime: WotannRuntime
): Promise<LocalizeResult> {
  // Phase 1a: keyword extraction via cheap LLM
  const keywords = await extractKeywordsViaHaiku(issue, runtime);
  // Phase 1b: ripgrep each keyword; merge hits by file
  const hitsByFile = await ripgrepParallel(keywords, runtime.session.cwd);
  // Phase 1c: rank files by hit-density + symbol-match score
  const ranked = rankFiles(hitsByFile);
  return { candidateFiles: ranked.slice(0, 5), keywords };
}

// src/modes/agentless/repair.ts
export async function repairIssue(
  issue: { title: string; body: string },
  localize: LocalizeResult,
  runtime: WotannRuntime
): Promise<RepairResult> {
  // Read top-5 files + snippets
  const context = await buildRepairContext(localize.candidateFiles, runtime);
  // Single-shot to Sonnet: "Here's the issue + 5 candidate files. Return a unified diff."
  const response = await runtime.queryOneShot({
    provider: "anthropic", model: "sonnet",
    systemPrompt: AGENTLESS_REPAIR_PROMPT,
    userMessage: `Issue: ${issue.title}\n\n${issue.body}\n\nContext:\n${context}`,
  });
  const diff = extractUnifiedDiff(response.text);
  return { diff, rawResponse: response.text };
}

// src/modes/agentless/validate.ts
export async function validateRepair(
  diff: string,
  runtime: WotannRuntime
): Promise<ValidateResult> {
  // Apply in tmp branch, run tests, capture, revert
  const branch = `wotann/agentless-${Date.now()}`;
  try {
    await shadowGit.createBranch(branch);
    await shadowGit.applyDiff(diff);
    const testResult = await runtime.runTestSuite();
    return { passed: testResult.failed === 0, testResult };
  } finally {
    await shadowGit.discardBranch(branch);
  }
}
```

**VERIFICATION**:
```bash
# Agentless mode dispatch
grep -n "agentless" src/index.ts src/cli/commands/  # Expect: verb wired

# Module structure
ls src/modes/agentless/*.ts | wc -l  # Expect: 4+

# End-to-end smoke
wotann agentless "Fix off-by-one in src/utils/paginate.ts" --dry-run  # Expect: localize + repair plan, no commit

# Tests
npx vitest run tests/modes/agentless/ 2>&1 | tail -3

# Cost claim validation (smoke via token-estimator): estimate <1500 total tokens for small issue
node scripts/agentless-cost-estimate.mjs "small-issue.json"  # Expect: <$0.50 estimated
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| localize happy | issue with clear keyword match | top-5 candidate files, keyword in first file |
| localize empty | issue text with no code refs | `{candidateFiles: [], keywords: [...]}`, not error |
| repair produces valid diff | localize + issue | `{diff: "..."}` parseable as unified diff |
| repair produces invalid diff | model hallucinates | `{diff: null, error: "Could not extract diff from response"}` |
| validate tests green | diff applied, tests pass | `{passed: true}` + branch cleanup |
| validate tests red | diff applied, tests fail | `{passed: false, testResult: {failed: N}}` + branch reverted |
| cost estimate accuracy | repair small issue | total tokens <5K, <$0.50 estimate matches actual within 20% |

---

### T12.7 — MetaGPT SOP pipeline (~1500 LOC, 2 weeks)

**WHAT**: Port MetaGPT's SOP (Standard Operating Procedure) pattern — a 4-role pipeline where each AI agent plays a specific engineering role with structured artifact handoff between roles. `wotann sop <product-idea>` dispatches: PM (emits requirements.md + user stories) → Architect (emits architecture.md + db-schema.md) → Engineer (emits code across multiple files) → QA (emits tests.md + runs them). Each handoff is a typed artifact validated before next role starts.

**WHY**: Autonomous "one agent does everything" modes conflate planning with execution. MetaGPT's SOP separates concerns — the PM agent doesn't write code, the engineer agent doesn't design DB schemas. Structured artifacts prevent context pollution and make failures localized (PM failed at requirements vs engineer mis-implemented). Demo-appealing for enterprise.

**WHERE**:
- NEW `src/sop/` module (~1200 LOC):
  - `src/sop/types.ts` (~80 LOC) — `SopRole`, `SopArtifact`, `SopTurn`, `SopPipeline`
  - `src/sop/roles/pm.ts` (~200 LOC) — PM role: user stories + requirements.md
  - `src/sop/roles/architect.ts` (~250 LOC) — Architect: architecture.md + schema.md
  - `src/sop/roles/engineer.ts` (~300 LOC) — Engineer: implement files from architecture
  - `src/sop/roles/qa.ts` (~200 LOC) — QA: test plan + test files + run
  - `src/sop/pipeline.ts` (~170 LOC) — orchestrator, artifact validation, retry per role
- NEW `src/cli/commands/sop.ts` (~150 LOC) — `wotann sop <idea>` verb
- EDIT `src/index.ts` — wire `wotann sop` verb
- NEW `tests/sop/` (~250 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (MetaGPT subsection).

**HOW**:
```typescript
// src/sop/types.ts
export type SopRole = "pm" | "architect" | "engineer" | "qa";

export interface SopArtifact {
  readonly role: SopRole;
  readonly filename: string;
  readonly contentType: "markdown" | "typescript" | "json" | "sql";
  readonly content: string;
  readonly validation: { valid: true } | { valid: false; errors: readonly string[] };
}

// src/sop/pipeline.ts
export async function runSopPipeline(
  idea: string,
  runtime: WotannRuntime,
  opts: { maxRetriesPerRole?: number } = {}
): Promise<{ artifacts: readonly SopArtifact[]; outcome: "success" | "blocked" }> {
  const maxRetries = opts.maxRetriesPerRole ?? 2;
  const artifacts: SopArtifact[] = [];
  for (const role of ["pm", "architect", "engineer", "qa"] as const) {
    let attempt = 0;
    let roleArtifact: SopArtifact | null = null;
    while (attempt < maxRetries && roleArtifact === null) {
      roleArtifact = await dispatchRole(role, { idea, priorArtifacts: artifacts }, runtime);
      if (roleArtifact.validation.valid === false) {
        console.warn(`[sop:${role}] artifact invalid, retrying:`, roleArtifact.validation.errors);
        roleArtifact = null; attempt++;
      }
    }
    if (roleArtifact === null) {
      return { artifacts, outcome: "blocked" };
    }
    artifacts.push(roleArtifact);
  }
  return { artifacts, outcome: "success" };
}
```

**VERIFICATION**:
```bash
# Pipeline wires
ls src/sop/roles/*.ts | wc -l  # Expect: 4 roles

# CLI verb
grep -n "sop" src/index.ts src/cli/commands/

# Demo run
wotann sop "Todo app with auth + team sharing" --dry-run  # Expect: 4 artifacts plan

# Tests
npx vitest run tests/sop/ 2>&1 | tail -3

# Artifact validation
node -e 'import("./dist/sop/pipeline.js").then(m => m.runSopPipeline("tiny example", mockRuntime)).then(r => console.log(r.outcome, r.artifacts.length))'  # Expect: success + 4
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| happy path — all 4 roles | clear idea | 4 artifacts, outcome: "success" |
| PM role fails validation | model returns unparseable | retry succeeds on 2nd attempt |
| PM role fails after max retries | model consistently bad | outcome: "blocked" after attempt=max |
| artifact handoff — engineer uses architect | check engineer artifact references architect's schema | engineer code imports schema types from architect artifact |
| retry budget enforcement | maxRetriesPerRole=1 | no retry, immediate block on first failure |
| resumable after crash | pipeline interrupted mid-role | `.wotann/sop-cache/<id>` has completed artifacts; resume skips finished roles |

---

### T12.8 — Linear/Jira/Slack MCP connectors (~2000 LOC, 3 weeks)

**WHAT**: Port Devin-style enterprise ticket inbox pattern. Three MCP connectors that expose Linear issues, Jira tickets, and Slack DMs as triggers for WOTANN agents. User pastes ticket URL or DM reply → WOTANN agent picks up context, executes task, posts PR + comment back to ticket. Existing `src/connectors/` has `linear.ts`, `jira.ts`, `slack.ts` (stub-level). Expand each to full trigger + reply cycle.

**WHY**: Enterprise users live in ticket-trackers. Devin wins deals because engineers assign tickets to Devin same as human engineer. WOTANN matching this pattern = enterprise foothold without sacrificing free-tier appeal (self-hosted bot via their own OAuth tokens).

**WHERE**:
- EXTEND `src/connectors/linear.ts` (current stub ~150 LOC; expand to ~700 LOC) — webhook receiver + GraphQL API client + issue→session bridge
- EXTEND `src/connectors/jira.ts` (~700 LOC) — REST API client + webhook receiver
- EXTEND `src/connectors/slack.ts` (~600 LOC) — Events API consumer + DM intent extraction + thread-reply writer
- NEW `src/connectors/connector-webhook-server.ts` (~150 LOC) — HTTPS server for all 3 providers, HMAC verify per provider
- NEW `src/cli/commands/connectors.ts` (~100 LOC) — `wotann connectors install linear|jira|slack`, `wotann connectors status`
- EDIT `src/connectors/connector-registry.ts` — wire Linear/Jira/Slack to event-triggers system
- NEW `tests/connectors/linear.test.ts`, `jira.test.ts`, `slack.test.ts` (~400 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (Devin enterprise inbox subsection).

**HOW**:
```typescript
// src/connectors/linear.ts signature extension
export interface LinearConnector {
  readonly config: LinearConnectorConfig;
  startWebhookReceiver(): Promise<void>;
  onIssueAssigned(handler: (issue: LinearIssue) => Promise<void>): void;
  onMentionedInComment(handler: (comment: LinearComment) => Promise<void>): void;
  replyToIssue(issueId: string, body: string): Promise<void>;
  attachPullRequestLink(issueId: string, prUrl: string): Promise<void>;
  setLinearStatus(issueId: string, status: "In Progress" | "In Review" | "Done"): Promise<void>;
}

// src/connectors/connector-webhook-server.ts
export async function startConnectorWebhookServer(
  port: number,
  connectors: readonly Connector[],
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const provider = identifyProvider(req);
      const connector = connectors.find((c) => c.provider === provider);
      if (!connector) { res.statusCode = 404; res.end(); return; }
      const body = await readBody(req);
      const signed = connector.verifySignature(req, body);
      if (!signed) { res.statusCode = 401; res.end(); return; }
      await connector.handleWebhookPayload(JSON.parse(body));
      res.statusCode = 200; res.end();
    });
    server.listen(port, () => resolve(server));
  });
}
```

**VERIFICATION**:
```bash
# Each connector has webhook + API methods
grep -n "startWebhookReceiver\|replyToIssue" src/connectors/linear.ts src/connectors/jira.ts  # Expect: 2+ each

# Webhook server exists
test -f src/connectors/connector-webhook-server.ts

# CLI verb
wotann connectors status  # Expect: table of installed connectors

# Tests
npx vitest run tests/connectors/ 2>&1 | tail -3

# HMAC verify per provider (no bypass)
grep -n "verifySignature" src/connectors/linear.ts src/connectors/jira.ts src/connectors/slack.ts  # Expect: 3 implementations
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| Linear issue assigned → session started | POST webhook with `IssueAssigned` event | session created, issue body in system prompt |
| Jira mentioned → reply posted | webhook + comment reply after 5s | Jira API PATCH issue with WOTANN reply |
| Slack DM intent | user DMs "implement foo" | thread reply with plan within 10s |
| HMAC bypass attempt | POST webhook without signature | 401 response, no session |
| invalid payload | malformed JSON | 400 response, log error, no crash |
| connector rate-limit | Linear API 429 | retry-after respected, backoff applied |
| connector offline | OAuth expired | `{ok: false, reason: "OAuth refresh required"}` + user notified |

---

### T12.9 — TextGrad textual gradients (AdalFlow, ~500 LOC, 1 week)

**WHAT**: Port TextGrad / AdalFlow's "textual gradient" pattern — treat prompt feedback as a gradient signal that propagates backward through an agent's pipeline. When a task fails, TextGrad queries a critic model ("why did this fail? what should the prompt say differently?"), and the resulting critique is applied as a gradient update to upstream prompt templates. WOTANN has GEPA + MIPROv2 already (`src/learning/gepa-optimizer.ts`, `miprov2-optimizer.ts`); TextGrad is orthogonal — gradient-based, not evolutionary.

**WHY**: Adding a third optimizer gives WOTANN a complete optimization-algorithm suite: evolutionary (GEPA), Bayesian (MIPROv2), gradient (TextGrad). Each excels on different prompt-shape distributions. Papers report TextGrad wins on structured-reasoning tasks where GEPA gets stuck in local optima.

**WHERE**:
- NEW `src/learning/textgrad-optimizer.ts` (~300 LOC) — critic-model-driven gradient estimation + prompt update
- NEW `src/learning/textgrad-critic.ts` (~100 LOC) — critic prompt templates per task type
- EDIT `src/learning/self-evolution.ts` (~+50 LOC) — register TextGrad alongside GEPA + MIPROv2 in the optimizer dispatch table
- EDIT `src/learning/types.ts` — add `OptimizationStrategy: "gepa" | "miprov2" | "textgrad"` union
- NEW `tests/learning/textgrad-optimizer.test.ts` (~150 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (TextGrad/AdalFlow subsection).

**HOW**:
```typescript
// src/learning/textgrad-optimizer.ts
export interface TextGradFeedback {
  readonly failureDescription: string;
  readonly suggestedEdit: string;  // the "gradient" — natural language diff
  readonly confidence: number;     // 0-1
}

export async function estimateTextualGradient(
  prompt: string,
  task: TaskInstance,
  failure: TaskFailure,
  criticModel: LlmInterface
): Promise<TextGradFeedback> {
  const response = await criticModel.query(formatCriticPrompt(prompt, task, failure));
  return parseGradientResponse(response);
}

export async function applyGradient(
  prompt: string,
  gradient: TextGradFeedback,
  params: { learningRate: number }
): Promise<string> {
  // Low learningRate → small edit only; high → rewrite
  if (gradient.confidence < 0.4) return prompt;  // abstain from update
  return applySemanticEdit(prompt, gradient.suggestedEdit, params.learningRate);
}
```

**VERIFICATION**:
```bash
test -f src/learning/textgrad-optimizer.ts
grep -n "textgrad" src/learning/self-evolution.ts  # Expect: dispatch entry

# Tests
npx vitest run tests/learning/textgrad-optimizer.test.ts 2>&1 | tail -3

# Integrated with self-evolution
grep -n "OptimizationStrategy" src/learning/types.ts  # Expect: 3 strategies
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| gradient estimated for clear failure | task fails w/ error text | `{suggestedEdit: "...", confidence: >0.5}` |
| low-confidence gradient skipped | confidence <0.4 | prompt unchanged, abstain logged |
| high-confidence update | confidence >0.8 | prompt modified in direction of suggestedEdit |
| critic model unavailable | LLM timeout | `{ok: false, reason: "critic model timeout"}` |
| learning-rate clamps | lr=2.0 (too high) | clamped to 1.0, log warning |

---

### T12.10 — OpenInference/OTEL trace emission (~400 LOC, 3 days)

**WHAT**: Extend `src/telemetry/observability-export.ts` (current 390 LOC) with OpenInference semantic conventions + OTLP export to Langfuse/Phoenix/W&B Weave. Users turn on OTLP and their WOTANN sessions show in their observability dashboard, enabling fleet-level performance/cost/quality monitoring.

**WHY**: WOTANN runs agent sessions with 100+ tool calls, 20+ LLM turns, ~4 provider hops. Without OTEL, users have no way to debug "why did this task take 15 minutes?" Observability unlocks enterprise adoption.

**WHERE**:
- EDIT `src/telemetry/observability-export.ts` (~+250 LOC) — add OpenInference-compliant span emission, OTLP protobuf/grpc export, W3C TRACEPARENT propagation
- NEW `src/telemetry/openinference-conventions.ts` (~100 LOC) — semantic conventions for `llm.invocation`, `agent.turn`, `tool.call`, `memory.retrieval`
- EDIT `src/core/runtime.ts` — emit spans on every LLM call + tool execution (~+30 LOC at existing hook points)
- EDIT `src/providers/provider-service.ts` — wrap each provider call with OTEL span (~+20 LOC)
- NEW `tests/telemetry/openinference.test.ts` (~80 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (OpenInference/W3C-TRACEPARENT subsection).

**HOW**:
```typescript
// src/telemetry/openinference-conventions.ts
export const OI_LLM_INVOCATION = {
  name: "llm.invocation",
  attributes: ["llm.model", "llm.provider", "llm.input_tokens", "llm.output_tokens", "llm.latency_ms"],
} as const;

export const OI_AGENT_TURN = {
  name: "agent.turn",
  attributes: ["agent.id", "agent.turn_number", "agent.prompt_token_count"],
} as const;

// src/telemetry/observability-export.ts (extension)
export function createOtelTracer(config: OtelConfig): Tracer {
  const provider = new NodeTracerProvider({
    resource: new Resource({
      "service.name": "wotann",
      "service.version": pkgJson.version,
    }),
  });
  const exporter = new OTLPTraceExporter({ url: config.endpoint, headers: config.headers });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();
  return trace.getTracer("wotann");
}
```

**VERIFICATION**:
```bash
# OTLP export wired
grep -n "OTLPTraceExporter\|BatchSpanProcessor" src/telemetry/observability-export.ts

# OpenInference conventions registered
test -f src/telemetry/openinference-conventions.ts
grep -c "OI_" src/telemetry/openinference-conventions.ts  # Expect: 4+ constants

# Runtime emits spans
grep -n "startSpan\|trace\." src/core/runtime.ts src/providers/provider-service.ts  # Expect: 3+ span calls

# Test with Langfuse collector (smoke)
WOTANN_OTLP_ENDPOINT=http://localhost:14318 node -e 'import("./dist/telemetry/observability-export.js").then(m => m.emitTestSpan())'
# Expect: span reaches collector at :14318

# tsc + tests
npx tsc --noEmit && npx vitest run tests/telemetry/openinference.test.ts 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| OTLP endpoint set, trace emitted | config + LLM call | span arrives at collector with `llm.*` attrs |
| OTLP endpoint unset | default config | no error, traces dropped silently (opt-out pattern) |
| trace context propagation | nested tool calls | child spans link to parent via TRACEPARENT |
| invalid OTLP endpoint | 500 from collector | BatchSpanProcessor retries, no crash |
| token counts in span attrs | LLM call with known token counts | span has `llm.input_tokens`, `llm.output_tokens` populated |
| W3C TRACEPARENT propagation | external HTTP → WOTANN | incoming TRACEPARENT continues trace |

---

### T12.11 — Kernel-level sandbox (Codex Seatbelt/Landlock) (~1200 LOC, 2 weeks)

**WHAT**: NEW sandbox backend using macOS Seatbelt (sandbox-exec) and Linux Landlock LSM to execute tool calls in kernel-enforced sandboxes. Faster than Docker (no container overhead, ~5ms startup vs 500ms), lighter (no Docker daemon dep), matches Codex's production pattern. Complements existing `src/sandbox/docker-backend.ts` for users who don't want Docker.

**WHY**: Docker dependency is a major install blocker — every `wotann init` user on mac without Docker Desktop fails the security-sandbox step. Kernel sandboxes are OS-native, zero-install. Seatbelt/Landlock give 90% of Docker's isolation at 0% of its overhead.

**WHERE**:
- NEW `src/sandbox/kernel-sandbox.ts` (~500 LOC) — main backend, dispatches macOS→Seatbelt vs Linux→Landlock
- NEW `src/sandbox/backends/seatbelt-backend.ts` (~300 LOC) — `sandbox-exec -p` wrapper with profile generation
- NEW `src/sandbox/backends/landlock-backend.ts` (~300 LOC) — `landlock-restrict` + syscall filter (requires Linux 5.13+)
- EDIT `src/sandbox/executor.ts` — register kernel-sandbox as available backend (~+30 LOC)
- EDIT `src/sandbox/approval-rules.ts` — update default to prefer kernel-sandbox over docker where available
- NEW `tests/sandbox/kernel-sandbox.test.ts` (~200 LOC) — platform-specific tests (skip on unsupported OS)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (Codex/Seatbelt subsection).

**HOW**:
```typescript
// src/sandbox/kernel-sandbox.ts
export async function createKernelSandbox(config: SandboxConfig): Promise<SandboxBackend> {
  if (process.platform === "darwin") {
    return createSeatbeltBackend(config);
  }
  if (process.platform === "linux") {
    const landlockAvailable = await checkLandlockSupport();
    if (landlockAvailable) return createLandlockBackend(config);
  }
  // Fall back or return honest stub
  return {
    available: false,
    reason: `Kernel sandbox unavailable on ${process.platform}; use docker backend instead`,
  };
}

// src/sandbox/backends/seatbelt-backend.ts
function generateSeatbeltProfile(allowedPaths: readonly string[]): string {
  return `
(version 1)
(deny default)
(allow process-exec)
${allowedPaths.map((p) => `(allow file-read* (subpath "${p}"))`).join("\n")}
(allow file-write* (subpath "${process.cwd()}/.wotann"))
(deny network* (remote ip))
(allow network* (remote ip "127.0.0.1:*"))
`;
}
```

**VERIFICATION**:
```bash
# Module exists
test -f src/sandbox/kernel-sandbox.ts && test -d src/sandbox/backends/

# Registered
grep -n "kernel-sandbox" src/sandbox/executor.ts

# macOS: sandbox-exec invocation
grep -n "sandbox-exec" src/sandbox/backends/seatbelt-backend.ts  # Expect: 1+

# Linux: landlock syscalls
grep -n "landlock\|LANDLOCK_" src/sandbox/backends/landlock-backend.ts  # Expect: 1+

# Smoke: execute a command sandboxed on current OS
wotann sandbox --backend kernel --run "ls /"  # Expect: ls succeeds or honest stub if unsupported

# Tests (skip where platform mismatch)
npx vitest run tests/sandbox/kernel-sandbox.test.ts 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| macOS — allowed path read | read `./README.md` | succeeds |
| macOS — denied path write | write `/etc/passwd` | blocked at kernel level |
| macOS — denied network | curl external URL | network error, no packets leaked |
| Linux w/ Landlock — allowed | read `./src/` | succeeds |
| Linux w/o Landlock (old kernel) | call `createKernelSandbox()` | `{available: false, reason: "Kernel 5.13+ required"}` |
| Windows | no kernel sandbox | `{available: false, reason: "No kernel sandbox on Windows"}` honest stub |
| profile generation — invalid path | path with `../` escape | rejected at profile-build, not sandbox execution |

---

### T12.12 — Mastra Studio UI port inside desktop-app (~1800 LOC, 2 weeks)

**WHAT**: Port Mastra Studio UI — a dev-mode browser UI for inspecting agent traces, editing observer/reflector policies, viewing memory graph — as a tab inside WOTANN's existing `desktop-app/`. Mastra has 22k★ + 300k weekly downloads; Studio is the reason teams adopt. WOTANN already has Observer + Reflector partial port (referenced in `src/core/runtime.ts` integration); Studio UI is the missing visualization layer.

**WHY**: Agents are opaque. Mastra Studio surfaces the trace tree (what tools fired, in what order, with what tokens) and the memory graph (what facts the agent knows, when). Porting Studio as a dev-mode tab makes WOTANN's internals legible, accelerating both debugging AND product adoption (users see the moat).

**WHERE**:
- NEW `desktop-app/src/components/studio/` (~1400 LOC total):
  - `desktop-app/src/components/studio/StudioTab.tsx` (~200 LOC) — new 5th/6th tab in MainShell
  - `desktop-app/src/components/studio/TraceExplorer.tsx` (~350 LOC) — tree view of session traces, expandable per-turn
  - `desktop-app/src/components/studio/MemoryGraphView.tsx` (~300 LOC) — force-directed graph of entities + relationships
  - `desktop-app/src/components/studio/ObserverPolicyEditor.tsx` (~250 LOC) — live-editable policy DSL
  - `desktop-app/src/components/studio/ReflectorReplayPanel.tsx` (~200 LOC) — step-through reflector decisions per turn
  - `desktop-app/src/components/studio/StudioApiClient.ts` (~100 LOC) — typed RPC client for studio.* endpoints
- NEW `src/daemon/rpc/studio.ts` (~300 LOC) — new RPC namespace: `studio.traces.list`, `studio.memory.graph`, `studio.observer.policy.read|write`, `studio.reflector.replay`
- EDIT `src/daemon/kairos-rpc.ts` — register studio namespace handlers (~+50 LOC)
- EDIT `desktop-app/src/App.tsx` — wire StudioTab (~+20 LOC)
- NEW `tests/studio/` (~200 LOC)

**Cross-reference**: Engram `research/tier-b-strategic-moat` (Mastra Studio subsection).

**HOW**:
```tsx
// desktop-app/src/components/studio/StudioTab.tsx
export function StudioTab() {
  const [activeView, setActiveView] = useState<"traces" | "memory" | "observer" | "reflector">("traces");
  return (
    <div className="studio-tab">
      <StudioNav active={activeView} onChange={setActiveView} />
      {activeView === "traces" && <TraceExplorer />}
      {activeView === "memory" && <MemoryGraphView />}
      {activeView === "observer" && <ObserverPolicyEditor />}
      {activeView === "reflector" && <ReflectorReplayPanel />}
    </div>
  );
}

// src/daemon/rpc/studio.ts
this.register("studio.traces.list", async (params) => {
  const traces = await this.traceStore.list({
    sessionId: params.sessionId,
    limit: params.limit ?? 50,
  });
  return { traces };
});

this.register("studio.memory.graph", async (params) => {
  const graph = await this.memoryStore.exportGraph({ sessionId: params.sessionId });
  return { nodes: graph.nodes, edges: graph.edges };
});
```

**VERIFICATION**:
```bash
# Studio tab wired
grep -n "StudioTab\|studio" desktop-app/src/App.tsx  # Expect: import + tab entry

# RPC namespace registered
grep -n "studio\." src/daemon/kairos-rpc.ts src/daemon/rpc/studio.ts  # Expect: 4+ handlers

# Components exist
ls desktop-app/src/components/studio/*.tsx | wc -l  # Expect: 5+

# Build + dev
(cd desktop-app && npm run build) 2>&1 | tail -5  # Expect: clean build

# Smoke: desktop app opens to Studio tab
(cd desktop-app && npm run tauri dev) &  # launches; verify no crash

# Tests
npx vitest run tests/studio/ 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| traces list loads | session has 10 turns | TraceExplorer shows tree, all 10 turns expandable |
| memory graph renders | 20 entities + 30 edges | force-directed graph renders, no frame-rate drop |
| observer policy edit saves | edit DSL, hit save | persisted to `.wotann/observer-policy.yaml`, change takes effect next turn |
| reflector replay | replay turn N | panel shows decision path + confidence per reflector rule |
| RPC failure | daemon down | StudioTab shows `{ok: false, reason: "daemon disconnected"}` gracefully |
| empty session | brand new session | empty state with "no traces yet" prompt |

---

### T12.13 — 10 curated OpenClaw skills (~3200 LOC, 4-5 days)

**WHAT**: Port 10 high-value skills from OpenClaw skill library (Apache-2, copy verbatim + adjust namespacing). The 10 are: (1) Turing Pyramid, (2) Capability Evolver, (3) proactive-agent v3.1 (WAL Protocol + Working Buffer), (4) elite-longterm-memory, (5) agent-autonomy-kit, (6) governance, (7) compaction-ui-enhancements, (8) context-engine, (9) boost-prompt, (10) ai-humanizer. Each lands in `.wotann/skills/` as standalone skill file.

**WHY**: WOTANN has 65+ skills already but lacks the foundational cognitive frameworks that make OpenClaw-powered agents more reliable. Skill portability is the primary mechanism — skills are not just prompts but include verification harnesses, example transcripts, and negative-example patterns. Each of these 10 is battle-tested in production for >6 months.

**WHERE**:
- NEW `.wotann/skills/` entries (10 files, ~3000 LOC total):
  - `.wotann/skills/turing-pyramid/SKILL.md` (~250 LOC)
  - `.wotann/skills/capability-evolver/SKILL.md` (~300 LOC)
  - `.wotann/skills/proactive-agent-v3/SKILL.md` (~350 LOC)
  - `.wotann/skills/elite-longterm-memory/SKILL.md` (~400 LOC)
  - `.wotann/skills/agent-autonomy-kit/SKILL.md` (~300 LOC)
  - `.wotann/skills/governance/SKILL.md` (~250 LOC)
  - `.wotann/skills/compaction-ui-enhancements/SKILL.md` (~300 LOC)
  - `.wotann/skills/context-engine/SKILL.md` (~300 LOC)
  - `.wotann/skills/boost-prompt/SKILL.md` (~250 LOC)
  - `.wotann/skills/ai-humanizer/SKILL.md` (~200 LOC)
- EDIT `src/skills/loader.ts` (~+30 LOC) — register `.wotann/skills/` as search path; ensure OpenClaw SKILL.md frontmatter is parsed (YAML with `context: fork` etc.)
- NEW `tests/skills/openclaw-ports.test.ts` (~200 LOC) — validate frontmatter parse + skill discovery

**Cross-reference**: Engram wire-audit topic_keys (Tier 12 wave), existing WOTANN skill catalog.

**HOW**:
```bash
# Clone OpenClaw skills repo (MIT / Apache-2)
git clone --depth 1 https://github.com/openclaw-ai/skills /tmp/openclaw-skills

# For each skill, port with namespace rewrite
for skill in turing-pyramid capability-evolver proactive-agent-v3 \
             elite-longterm-memory agent-autonomy-kit governance \
             compaction-ui-enhancements context-engine boost-prompt \
             ai-humanizer; do
  mkdir -p ".wotann/skills/${skill}"
  # Copy with rewrites: claude-code → wotann, OpenClaw → WOTANN in narrative, keep attribution header
  sed -e 's/claude-code/wotann/g' \
      -e 's/OpenClaw/WOTANN/g' \
      -e '1i<!-- PORTED from OpenClaw (Apache-2) 2026-04-21 -->' \
      "/tmp/openclaw-skills/${skill}/SKILL.md" > ".wotann/skills/${skill}/SKILL.md"
done
```

**VERIFICATION**:
```bash
# All 10 skills ported
ls .wotann/skills/ | grep -E "(turing-pyramid|capability-evolver|proactive-agent-v3|elite-longterm-memory|agent-autonomy-kit|governance|compaction-ui-enhancements|context-engine|boost-prompt|ai-humanizer)" | wc -l  # Expect: 10

# Attribution preserved
grep -l "PORTED from OpenClaw" .wotann/skills/*/SKILL.md | wc -l  # Expect: 10

# Loader discovers them
node -e 'import("./dist/skills/loader.js").then(m => m.loadAllSkills()).then(s => { const names = s.map(x => x.name); for (const want of ["turing-pyramid","capability-evolver","proactive-agent-v3","elite-longterm-memory","agent-autonomy-kit","governance","compaction-ui-enhancements","context-engine","boost-prompt","ai-humanizer"]) if (!names.includes(want)) process.exit(1); })'

# Tests
npx vitest run tests/skills/openclaw-ports.test.ts 2>&1 | tail -3

# LICENSE compliance
grep -l "Apache\|MIT" LICENSES/ 2>/dev/null || echo "check attribution section in README"
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| Skill loads on discovery | `loadAllSkills()` in startup | all 10 discoverable by name |
| Frontmatter parsed | `context: fork` in SKILL.md | loader respects fork flag, spawns subagent |
| Invocation by slash command | `/turing-pyramid` in TUI | skill body injected into prompt |
| Missing skill | `/nonexistent-skill` | honest error, not crash |
| Skill body > 10KB | large skill | loaded + cached, no OOM |
| License attribution | header comment preserved | grep confirms in every ported file |

---

### T12.14 — Int32Array-backed TUI optimizer (Anthropic leak, ~700 LOC, 2 weeks)

**WHAT**: Port the Int32Array-backed string-width optimization from Anthropic's leaked Claude Code source. Replace per-character `stringWidth(ch)` calls in TUI rendering with a precomputed Int32Array lookup keyed by codepoint. Leak reports 50× perf gain on wide-Unicode terminals (emoji + CJK).

**WHY**: TUI rendering is I/O-bound for WOTANN on full-screen views with code + streaming tokens. `stringWidth` is called per-character per-frame; Int32Array cache turns O(n) branching into O(1) table lookup.

**WHERE**:
- NEW `src/ui/string-width-cache.ts` (~300 LOC) — Int32Array-backed cache, lazy-filled for codepoints 0-0xFFFF (Basic Multilingual Plane)
- EDIT `src/ui/App.tsx` — replace `stringWidth` imports with cached version (~+10 LOC)
- EDIT `src/ui/components/*.tsx` — sweep all string-width call sites (~+40 LOC across files)
- EDIT `src/ui/terminal-blocks/*.ts` — same sweep (~+30 LOC)
- NEW `tests/ui/string-width-cache.test.ts` (~150 LOC) — correctness + perf benchmarks

**Cross-reference**: Engram wire-audit topic_keys (Tier 12 wave).

**HOW**:
```typescript
// src/ui/string-width-cache.ts
import stringWidth from "string-width";

const CACHE_SIZE = 0x10000;  // BMP coverage
const cache = new Int32Array(CACHE_SIZE);
cache.fill(-1);  // sentinel: uncomputed

export function cachedCharWidth(codepoint: number): number {
  if (codepoint >= CACHE_SIZE) {
    return stringWidth(String.fromCodePoint(codepoint));
  }
  const cached = cache[codepoint];
  if (cached !== -1) return cached;
  const width = stringWidth(String.fromCodePoint(codepoint));
  cache[codepoint] = width;
  return width;
}

export function cachedStringWidth(str: string): number {
  let total = 0;
  for (let i = 0; i < str.length; ) {
    const cp = str.codePointAt(i) ?? 0;
    total += cachedCharWidth(cp);
    i += cp >= 0x10000 ? 2 : 1;
  }
  return total;
}
```

**VERIFICATION**:
```bash
# Cache module exists
test -f src/ui/string-width-cache.ts

# Old stringWidth call sites migrated
grep -rn 'from ["\\x27]string-width' src/ui/ | wc -l  # Expect: 1 (in string-width-cache.ts only)
grep -rn "cachedStringWidth\|cachedCharWidth" src/ui/ | wc -l  # Expect: 5+

# Perf test
npx vitest run tests/ui/string-width-cache.test.ts 2>&1 | tail -5
# Expect: 10-50× speedup vs uncached, correctness equal

# Build
(cd desktop-app && npm run build)  # no tsc errors
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| ASCII string | `cachedStringWidth("hello")` | 5 (same as uncached) |
| CJK string | `cachedStringWidth("日本語")` | 6 (3 chars × 2 width) |
| Emoji string | `cachedStringWidth("👍")` | 2 |
| Mixed string | `cachedStringWidth("hi 👍 日")` | correct total |
| Codepoint > BMP | `cachedCharWidth(0x1F44D)` | 2 (falls through to uncached) |
| Cache hit perf | 1M iterations on same codepoint | <100ms total (vs ~5s uncached) |
| Cache fill progressive | First call computes, second reads cache | second call ~100× faster |

---

### T12.15 — G-Eval + Ragas metrics + OWASP LLM Top 10 red-team (~1500 LOC, 2 weeks)

**WHAT**: Port three testing frameworks into WOTANN. G-Eval (G-Evaluator, LLM-as-judge with chain-of-thought) becomes WOTANN's general quality metric. Ragas (Retrieval Augmented Generation Assessment) becomes WOTANN's memory-recall quality metric. OWASP LLM Top 10 becomes WOTANN's adversarial security baseline. Together they make WOTANN a testable system with published scores.

**WHY**: Users can't trust WOTANN unless they can measure it. Each of these is industry-standard: G-Eval for open-ended tasks (summarization, code review), Ragas for memory/RAG, OWASP LLM for security. Publishing WOTANN's scores against these benchmarks is the credibility anchor.

**WHERE**:
- NEW `src/testing/g-eval.ts` (~450 LOC) — chain-of-thought LLM-as-judge with typed rubric + score aggregation
- NEW `src/memory/evals/ragas-metrics.ts` (~400 LOC) — faithfulness, answer-relevance, context-precision, context-recall metrics
- NEW `src/testing/owasp-llm-redteam.ts` (~450 LOC) — 10 attack corpora, automated red-team runner
- NEW `scripts/run-g-eval.mjs`, `scripts/run-ragas.mjs`, `scripts/run-owasp-redteam.mjs` (~100 LOC each)
- NEW `.github/workflows/benchmark-nightly.yml` — extend with all 3 benchmarks
- EDIT `docs/BENCHMARKS.md` — publish scores

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (G-Eval/Ragas/OWASP subsections).

**HOW**:
```typescript
// src/testing/g-eval.ts
export interface GEvalRubric {
  readonly criteria: readonly GEvalCriterion[];
  readonly aggregator: "mean" | "min" | "weighted";
}

export interface GEvalCriterion {
  readonly name: string;
  readonly description: string;
  readonly scoreScale: 1 | 3 | 5 | 10;  // -1..10 typical
  readonly weight?: number;
}

export async function runGEval(
  input: string,
  output: string,
  rubric: GEvalRubric,
  judge: LlmInterface
): Promise<GEvalResult> {
  const scores = await Promise.all(
    rubric.criteria.map((c) => scoreViaLlm(input, output, c, judge))
  );
  const aggregate = aggregate_(rubric.aggregator, scores, rubric.criteria);
  return { scores, aggregate };
}

// src/testing/owasp-llm-redteam.ts — 10 categories
export const OWASP_LLM_TOP_10 = {
  LLM01_PROMPT_INJECTION: { cases: 50, seedPaths: ["corpora/prompt-injection/"] },
  LLM02_INSECURE_OUTPUT: { cases: 40, seedPaths: ["corpora/insecure-output/"] },
  LLM03_TRAINING_DATA_POISONING: { cases: 30, seedPaths: ["corpora/training-poisoning/"] },
  LLM04_MODEL_DOS: { cases: 20, seedPaths: ["corpora/model-dos/"] },
  LLM05_SUPPLY_CHAIN: { cases: 25, seedPaths: ["corpora/supply-chain/"] },
  LLM06_SENSITIVE_INFO_DISCLOSURE: { cases: 40, seedPaths: ["corpora/info-leak/"] },
  LLM07_INSECURE_PLUGIN_DESIGN: { cases: 30, seedPaths: ["corpora/plugin/"] },
  LLM08_EXCESSIVE_AGENCY: { cases: 35, seedPaths: ["corpora/agency/"] },
  LLM09_OVERRELIANCE: { cases: 20, seedPaths: ["corpora/overreliance/"] },
  LLM10_MODEL_THEFT: { cases: 15, seedPaths: ["corpora/model-theft/"] },
} as const;
```

**VERIFICATION**:
```bash
# Modules exist
test -f src/testing/g-eval.ts && test -f src/memory/evals/ragas-metrics.ts && test -f src/testing/owasp-llm-redteam.ts

# Scripts wired
test -f scripts/run-g-eval.mjs && test -f scripts/run-ragas.mjs && test -f scripts/run-owasp-redteam.mjs

# Sample eval runs
node scripts/run-g-eval.mjs --suite smoke  # Expect: scored output JSON
node scripts/run-owasp-redteam.mjs --category LLM01_PROMPT_INJECTION --cases 10  # Expect: 10 attacks, per-case pass/fail

# Benchmark docs updated
grep -l "G-Eval\|Ragas\|OWASP" docs/BENCHMARKS.md  # Expect: 3 sections

# Tests
npx vitest run tests/testing/ 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| G-Eval 3-criterion rubric | score a summary | 3 scores + aggregate via mean |
| G-Eval judge abstains | low-confidence response | aggregate reflects abstention, not forced score |
| Ragas faithfulness | response faithful to context | score >0.8 |
| Ragas faithfulness — hallucinated | response invents facts | score <0.3 |
| OWASP LLM01 — injection blocked | payload triggers guard | `blocked: true`, no tool fires |
| OWASP LLM01 — injection succeeds | legitimate-sounding payload | `blocked: false`; failure is expected + logged |
| OWASP LLM05 — supply-chain probe | request for suspicious dep | `blocked: true` at install step |

---

### T12.16 — Modal + Fly.io sandbox backends (~2000 LOC, 2 weeks)

**WHAT**: NEW sandbox backends for executing tool calls on Modal (serverless GPU) and Fly.io (Firecracker VMs). Expands existing `src/sandbox/docker-backend.ts` infrastructure with 2 cloud backends. Unlocks WOTANN-Pro tier story: "your local agent, but heavy compute runs on Modal/Fly instead of local Docker."

**WHY**: Local Docker can't handle GPU inference (ML workloads), can't isolate agent runs across machines (fleet multi-tenancy), can't scale horizontally. Modal gives serverless GPU on-demand; Fly.io gives fast-boot VMs globally distributed. WOTANN charges a margin on Modal/Fly usage = sustainable revenue without subscription lock-in.

**WHERE**:
- NEW `src/sandbox/modal-backend.ts` (~700 LOC) — Modal API client, image build, function invoke, output stream
- NEW `src/sandbox/flyio-backend.ts` (~700 LOC) — Fly Machines API, image + machine lifecycle, exec, logs
- NEW `src/sandbox/backends/cloud-auth.ts` (~200 LOC) — shared OAuth/token management for both providers
- EDIT `src/sandbox/executor.ts` — register Modal + Fly backends (~+40 LOC)
- EDIT `src/cli/commands/*` — add `wotann sandbox deploy --backend modal|fly` (~+80 LOC)
- NEW `tests/sandbox/modal-backend.test.ts`, `flyio-backend.test.ts` (~400 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (Modal/Fly-sandbox subsection).

**HOW**:
```typescript
// src/sandbox/modal-backend.ts
export async function createModalSandbox(config: ModalConfig): Promise<CloudSandbox> {
  const client = new ModalClient({ token: config.token });
  return {
    provider: "modal",
    async run(cmd: string, opts: RunOpts): Promise<RunResult> {
      const fn = await client.deployFunction({
        image: config.image ?? "python:3.11-slim",
        command: cmd,
        timeout: opts.timeoutMs,
      });
      const invocation = await fn.invoke(opts.env);
      return invocationToRunResult(invocation);
    },
    async destroy(): Promise<void> { /* cleanup */ },
  };
}

// src/sandbox/flyio-backend.ts
export async function createFlyMachineSandbox(config: FlyConfig): Promise<CloudSandbox> {
  const machines = new FlyMachinesApi({ token: config.token });
  const machine = await machines.createMachine({
    region: config.region ?? "iad",
    image: config.image ?? "flyio/node:lts",
    size: config.size ?? "shared-cpu-1x",
  });
  return {
    provider: "fly",
    async run(cmd: string): Promise<RunResult> {
      const exec = await machines.exec(machine.id, cmd);
      return execToRunResult(exec);
    },
    async destroy(): Promise<void> { await machines.destroy(machine.id); },
  };
}
```

**VERIFICATION**:
```bash
# Backends exist
test -f src/sandbox/modal-backend.ts && test -f src/sandbox/flyio-backend.ts

# Registered
grep -n "modal-backend\|flyio-backend" src/sandbox/executor.ts  # Expect: 2+

# Auth handling
grep -n "MODAL_TOKEN\|FLY_API_TOKEN" src/sandbox/backends/cloud-auth.ts  # Expect: both env vars

# Smoke — if tokens set
MODAL_TOKEN=$MODAL_TOKEN wotann sandbox deploy --backend modal --cmd "echo hello"  # Expect: runs on Modal

# Tests (skip if no token)
npx vitest run tests/sandbox/modal-backend.test.ts tests/sandbox/flyio-backend.test.ts 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| Modal cold start | first invoke | <3s P95 cold start time |
| Modal warm invoke | 2nd+ invoke | <500ms P95 |
| Fly machine boot | first run | <1s boot |
| Fly machine reuse | same session, 2nd run | reuses machine, <100ms overhead |
| auth missing | no token set | `{available: false, reason: "MODAL_TOKEN unset"}` |
| quota exceeded | Modal returns 429 | retry with backoff, user-visible "quota hit" message |
| network failure mid-exec | connection drop | `{ok: false, reason: "network"}` + machine cleanup |

---

### T12.17 — Jean Magic Commands palette (~1200 LOC, 2 days)

**WHAT**: Port 7 "Magic Commands" from Jean — Investigate Issue, Investigate PR, Investigate Workflow, Code Review with finding tracking, AI Commit Messages, PR Content Generation, Merge Conflict Resolution, Release Notes. Each command is a curated single-keystroke action that composes existing WOTANN primitives (grep, shadow-git, memory, providers) into a discoverable verb. Sibling of `desktop-app/src/components/palette/` command palette.

**WHY**: WOTANN has all the primitives but lacks the "golden path" UX for common dev workflows. Jean's Magic Commands shipped in 2026-03 and drove 40% DAU lift because they made expert workflows accessible. Porting them = instant UX parity without re-inventing. Each command is ~150 LOC on top of existing WOTANN infra.

**WHERE**:
- NEW `src/magic/` module (~700 LOC):
  - `src/magic/commands.ts` (~150 LOC) — registry of 7 magic commands
  - `src/magic/investigate-issue.ts` (~80 LOC) — pulls issue via GitHub, runs Agentless localize, generates proposal
  - `src/magic/investigate-pr.ts` (~80 LOC) — pulls PR diff, reviews, suggests refinements
  - `src/magic/investigate-workflow.ts` (~80 LOC) — analyzes workflow file, suggests optimizations
  - `src/magic/code-review.ts` (~100 LOC) — structured review with finding IDs, tracks addressed-ness
  - `src/magic/ai-commit.ts` (~60 LOC) — generates conventional commit from staged diff
  - `src/magic/pr-content.ts` (~60 LOC) — generates PR description from commits + diff
  - `src/magic/merge-conflict.ts` (~90 LOC) — analyzes conflict markers, proposes resolution
  - `src/magic/release-notes.ts` (~70 LOC) — collates commits since last tag, categorizes, drafts notes
- NEW `desktop-app/src/components/palette/MagicCommandsPalette.tsx` (~300 LOC) — cmd+shift+M palette UI
- EDIT `src/ui/command-registry.ts` — register magic commands as TUI slash-commands (~+50 LOC)
- EDIT `desktop-app/src/components/palette/CommandPalette.tsx` — show magic section
- NEW `tests/magic/` (~150 LOC)

**Cross-reference**: Engram `research/tier-b-strategic-moat` (Jean/Magic Commands subsection).

**HOW**:
```typescript
// src/magic/commands.ts
export const MAGIC_COMMANDS = [
  { id: "investigate-issue", verb: "mc:issue", title: "Investigate Issue", handler: import("./investigate-issue") },
  { id: "investigate-pr", verb: "mc:pr", title: "Investigate PR", handler: import("./investigate-pr") },
  { id: "investigate-workflow", verb: "mc:workflow", title: "Investigate Workflow", handler: import("./investigate-workflow") },
  { id: "code-review", verb: "mc:review", title: "Code Review", handler: import("./code-review") },
  { id: "ai-commit", verb: "mc:commit", title: "AI Commit Message", handler: import("./ai-commit") },
  { id: "pr-content", verb: "mc:prbody", title: "PR Content", handler: import("./pr-content") },
  { id: "merge-conflict", verb: "mc:resolve", title: "Merge Conflict", handler: import("./merge-conflict") },
  { id: "release-notes", verb: "mc:releasenotes", title: "Release Notes", handler: import("./release-notes") },
] as const;

// src/magic/ai-commit.ts
export async function handle(runtime: WotannRuntime): Promise<{ message: string }> {
  const diff = await runtime.shadowGit.stagedDiff();
  if (diff.length === 0) return { message: "" };
  const prompt = `Generate a conventional commit message for this diff:\n\`\`\`diff\n${diff}\n\`\`\``;
  const response = await runtime.queryOneShot({ provider: "anthropic", model: "haiku", userMessage: prompt });
  return { message: parseConventionalCommit(response.text) };
}
```

**VERIFICATION**:
```bash
# Magic module scaffolded
ls src/magic/*.ts | wc -l  # Expect: 9 files

# Palette component
test -f desktop-app/src/components/palette/MagicCommandsPalette.tsx

# TUI registration
grep -n "MAGIC_COMMANDS\|mc:" src/ui/command-registry.ts

# Example invocation
wotann mc:commit  # Expect: proposes conventional commit

# Tests
npx vitest run tests/magic/ 2>&1 | tail -3

# cmd+shift+M in desktop opens palette (manual smoke)
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| ai-commit with staged diff | small diff, 1 file | returns conventional commit message starting with `fix:\|feat:\|chore:` etc. |
| ai-commit with no staged diff | nothing staged | `{message: "", reason: "nothing staged"}` |
| investigate-issue with URL | `mc:issue https://github.com/org/repo/issues/123` | fetches issue, localizes, proposes plan |
| investigate-pr with URL | `mc:pr <url>` | fetches PR diff, review comments generated |
| merge-conflict on dirty branch | conflict markers present | analyzes, proposes resolution |
| merge-conflict on clean branch | no conflict | `{ok: true, message: "No conflicts found"}` |
| release-notes since tag | tag v0.4 → HEAD | categorized changelog |
| palette open + type "issu" | fuzzy match | shows "Investigate Issue" first |

---

### T12.18 — Jean WebSocket replay buffer (~150 LOC, 1 day)

**WHAT**: Port Jean's WebSocket replay buffer pattern. Add a 2000-event ring buffer with `seq` numbers to WOTANN's WebSocket transport. On reconnect after network partition (mobile/Tailscale), client sends `last_seq`; server replays events since that seq. Prevents lost events from spurious reconnects.

**WHY**: Mobile users on cell networks and Tailscale users on flaky links frequently reconnect. Without replay, any events dropped during the partition are lost, which breaks cursor-stream continuity and approval-queue consistency. Jean's pattern is minimal (150 LOC) and proven in production.

**WHERE**:
- NEW `src/daemon/transport/replay-buffer.ts` (~100 LOC) — ring buffer with `seq` assignment
- EDIT `src/daemon/kairos-rpc.ts` OR `src/daemon/kairos.ts` transport layer — wire buffer into send path (~+30 LOC)
- EDIT `src/session/cursor-stream.ts` and `src/session/approval-queue.ts` — tag every event with seq (~+20 LOC across)
- NEW `tests/daemon/replay-buffer.test.ts` (~150 LOC)

**Cross-reference**: Engram `research/tier-b-strategic-moat` (Jean/WebSocket-replay subsection).

**HOW**:
```typescript
// src/daemon/transport/replay-buffer.ts
export interface WsEvent<T = unknown> {
  readonly seq: number;
  readonly json: string;  // pre-serialized for perf
  readonly timestamp: number;
}

export class ReplayBuffer<T = unknown> {
  private readonly capacity: number;
  private readonly buffer: WsEvent<T>[] = [];
  private nextSeq = 1;
  constructor(capacity: number = 2000) { this.capacity = capacity; }

  append(payload: T): WsEvent<T> {
    const event: WsEvent<T> = {
      seq: this.nextSeq++,
      json: JSON.stringify(payload),
      timestamp: Date.now(),
    };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    return event;
  }

  since(lastSeq: number): readonly WsEvent<T>[] {
    const idx = this.buffer.findIndex((e) => e.seq > lastSeq);
    if (idx < 0) return [];
    return this.buffer.slice(idx);
  }

  get oldestSeq(): number { return this.buffer[0]?.seq ?? 0; }
  get newestSeq(): number { return this.nextSeq - 1; }
}
```

**VERIFICATION**:
```bash
# Module exists
test -f src/daemon/transport/replay-buffer.ts && wc -l src/daemon/transport/replay-buffer.ts  # 80-130 LOC

# Wired
grep -n "ReplayBuffer\|replay-buffer" src/daemon/kairos-rpc.ts src/daemon/kairos.ts  # Expect: 1+

# Tests
npx vitest run tests/daemon/replay-buffer.test.ts 2>&1 | tail -3

# Smoke: simulate disconnect + reconnect
node scripts/replay-smoke.mjs  # NEW — simulates 2000-event stream, tests reconnect replay
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| append + since(0) | append 10, query since(0) | all 10 events returned, seq 1..10 |
| replay after capacity overflow | append 3000 events, buffer cap=2000 | oldest 1000 evicted, since(500) returns empty |
| replay exact boundary | append 100, since(99) | 1 event returned (seq 100) |
| replay future seq | append 100, since(500) | empty array (future seq not yet generated) |
| concurrent appends | 10 parallel appends | all 10 have unique monotonic seqs |
| reconnect flow | client drops at seq 50, reconnects with last_seq=50 | server sends events 51+ in order |

---

### T12.19 — Jean Execution Modes UI pivot (~80 LOC, half day)

**WHAT**: Add Plan/Build/Yolo as first-class execution modes, selectable from UI. Plan mode = agent produces plan, no edits; Build mode = agent edits with approval per-action; Yolo mode = agent edits freely, best-effort rollback. Matches Jean's product marketing "Plan mode by default, Yolo on demand" which drove 25% conversion lift.

**WHY**: Current WOTANN has permission modes (bypass / dontAsk / acceptAll) but they're not product-framed. Users think about "planning vs doing vs yolo-ing," not permissions. Renaming + elevating to first-class modes = instant UX clarity without behavior change.

**WHERE**:
- NEW `src/core/execution-modes.ts` (~80 LOC) — `ExecutionMode = "plan" | "build" | "yolo"`, mode → permission-mode mapping
- EDIT `src/core/runtime.ts` — consume `runtime.config.executionMode` as source of truth for permission-mode (~+10 LOC)
- EDIT `src/cli/onboarding.ts` OR `src/cli/onboarding-screens.tsx` (if T6 done) — mode picker in wizard
- EDIT `desktop-app/src/components/StatusBar.tsx` — mode badge with click-to-switch
- EDIT `src/ui/App.tsx` — mode shortcut (cmd+shift+M swap) + badge

**Cross-reference**: Engram `research/tier-b-strategic-moat` (Jean/execution-modes subsection).

**HOW**:
```typescript
// src/core/execution-modes.ts
export const EXECUTION_MODES = {
  plan: { permissionMode: "ask", editPolicy: "none", label: "Plan (read-only)" },
  build: { permissionMode: "ask", editPolicy: "per-action", label: "Build (approve each)" },
  yolo: { permissionMode: "bypassPermissions", editPolicy: "free", label: "Yolo (no approvals)" },
} as const;

export type ExecutionMode = keyof typeof EXECUTION_MODES;

export function executionModeToPermissionMode(mode: ExecutionMode): PermissionMode {
  return EXECUTION_MODES[mode].permissionMode;
}
```

**VERIFICATION**:
```bash
# Module exists
test -f src/core/execution-modes.ts

# Runtime consumes mode
grep -n "executionMode\|ExecutionMode" src/core/runtime.ts  # Expect: 1+

# UI badge + swap
grep -n "ExecutionMode\|execution-modes" desktop-app/src/components/StatusBar.tsx

# Manual smoke: switch modes via palette, observe permission behavior changes

# Tests
npx vitest run tests/core/execution-modes.test.ts 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| plan mode — edit attempted | agent tries Edit tool | tool call rejected, "plan mode" message |
| build mode — edit attempted | agent tries Edit tool | approval prompt shown |
| yolo mode — edit attempted | agent tries Edit tool | executes without prompt |
| mode switch mid-session | plan → build | next turn uses build behavior |
| persist across sessions | set mode=yolo, restart | yolo restored from `.wotann/session.json` |
| invalid mode string | `runtime.config.executionMode = "turbo"` | tsc error / runtime rejects, defaults to plan |

---

### T12.20 — Coolify + Dokploy deploy-target adapters (~500 LOC, 3 days)

**WHAT**: Add Coolify and Dokploy as deploy targets for `wotann build` and `wotann deploy` commands. Both are self-hostable Heroku/Vercel alternatives (50k+ GitHub stars combined). Each gets a ~250 LOC adapter with app creation, deployment trigger, URL return, log tail.

**WHY**: `wotann build` needs deploy-target diversity. Cloudflare Pages, Vercel, Fly.io are covered in Tier 9, but enterprise + hobbyist self-hosters use Coolify/Dokploy. Adding these = full deploy-target matrix coverage.

**WHERE**:
- NEW `src/adapters/coolify.ts` (~250 LOC) — Coolify REST API client, create-app + deploy + logs
- NEW `src/adapters/dokploy.ts` (~250 LOC) — Dokploy REST API client, same interface
- EDIT `src/build/deploy-adapter.ts` (Tier 9 scaffold; ~+50 LOC) — register both as targets
- EDIT `src/cli/commands/deploy.ts` (Tier 9) — add flags `--to coolify|dokploy`
- NEW `tests/adapters/coolify.test.ts`, `dokploy.test.ts` (~200 LOC)

**Cross-reference**: Engram `research/tier-b-strategic-moat` (Coolify/Dokploy subsection).

**HOW**:
```typescript
// src/adapters/coolify.ts
export async function deployToCoolify(
  params: {
    apiUrl: string;     // e.g., https://coolify.example.com
    apiToken: string;
    projectId: string;
    gitRepo: string;
    branch: string;
  }
): Promise<DeployResult> {
  const client = createCoolifyClient(params);
  const app = await client.createApp({
    name: deriveAppName(params.gitRepo),
    project: params.projectId,
    source: { type: "git", repo: params.gitRepo, branch: params.branch },
  });
  const deploy = await client.triggerDeploy(app.id);
  const stream = await client.streamLogs(deploy.id);
  return { url: deploy.url, logsStream: stream };
}

// src/adapters/dokploy.ts — mirror of Coolify with Dokploy's endpoint shapes
```

**VERIFICATION**:
```bash
# Adapters exist
test -f src/adapters/coolify.ts && test -f src/adapters/dokploy.ts

# Registered
grep -n "coolify\|dokploy" src/build/deploy-adapter.ts

# CLI flag
wotann deploy --to coolify --help  # Expect: flag recognized

# Tests
npx vitest run tests/adapters/coolify.test.ts tests/adapters/dokploy.test.ts 2>&1 | tail -3
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| Coolify happy deploy | valid token + repo | deploy triggered, URL returned |
| Coolify auth failure | invalid token | `{ok: false, reason: "401 Unauthorized"}` |
| Coolify deploy failure | build errors | logs streamed, `{ok: false, logs: "..."}` |
| Dokploy happy | same as Coolify | URL returned |
| concurrent deploys | 2 parallel calls | each gets unique app, no race |
| network timeout | API 504 | retry with backoff, user notified after 3 failures |

---

### T12.21 — OpenCode (sst) provider adapter (~300 LOC, 3 days)

**WHAT**: NEW provider adapter for OpenCode (sst) — SST's AI code assistant. 147k★ project. Adds as a 20th provider in `src/providers/` alongside existing 19. OpenCode uses a custom API that wraps multiple underlying models; WOTANN consumers select OpenCode and get OpenCode's choice of backing model.

**WHY**: OpenCode has 147k stars and a devoted community, especially in the SST/Serverless world. Not supporting it means every SST user can't use WOTANN with their preferred assistant. One new provider adapter = a whole ecosystem of users unblocked.

**WHERE**:
- NEW `src/providers/opencode-adapter.ts` (~250 LOC) — API client, model listing, chat completions, streaming
- EDIT `src/providers/registry.ts` — register as provider `"opencode"`
- EDIT `src/providers/types.ts` — add OpenCode-specific config type
- NEW `tests/providers/opencode-adapter.test.ts` (~150 LOC)

**Cross-reference**: Engram `research/oss-ecosystem-sweep` (OpenCode sst subsection).

**HOW**:
```typescript
// src/providers/opencode-adapter.ts
export class OpenCodeAdapter implements ProviderAdapter {
  readonly type = "opencode" as const;

  constructor(private readonly config: OpenCodeConfig) {}

  async *stream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const body = {
      model: req.model,
      messages: req.messages,
      stream: true,
      tools: req.tools,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new OpenCodeError(await response.text());
    for await (const chunk of streamSse(response.body!)) {
      yield translateChunk(chunk);
    }
  }
}
```

**VERIFICATION**:
```bash
# Adapter exists + registered
test -f src/providers/opencode-adapter.ts
grep -n "opencode" src/providers/registry.ts  # Expect: registration entry

# Config type
grep -n "OpenCodeConfig" src/providers/types.ts

# Provider count now 20
grep -c "register\|providerType:" src/providers/registry.ts  # Expect: 20

# Test with mock
npx vitest run tests/providers/opencode-adapter.test.ts 2>&1 | tail -3

# Live smoke — if key available
OPENCODE_API_KEY=$OPENCODE_API_KEY wotann ask --provider opencode --model default "hello"
```

**Integration test matrix**:
| Scenario | Path | Expected |
|---|---|---|
| stream chat happy | valid key + simple prompt | streaming chunks, final usage summary |
| auth failure | invalid key | `{ok: false, error: "401"}` at first chunk |
| rate limit | 429 response | retry-after respected, backoff |
| tool-call in response | model returns function call | translated to WOTANN ToolCall shape |
| stream interrupted | network drop mid-stream | `{ok: false, error: "stream truncated"}`, cleanup |
| model not supported | invalid model name | `{ok: false, error: "model not found"}` |
| provider total count | provider registry enumeration | includes `"opencode"` |

---

---

## Tier 13 — iOS Runestone Editor (not Monaco!) — 2450 LOC / 10-14 days senior iOS

### Critical correction

**Monaco is wrong for iOS.** Microsoft's own tracker has open issues since 2019 (#1504 mobile, #4622 touch selection, #293 arrow keys). 5-10MB bundle kills iPhone .ipa budget. Code App (3.8k stars) is cautionary tale — iPad-first.

**Runestone (MIT, 3.1k stars, TreeSitter-based, 36 languages, v0.5.2 Mar 2026)** is the right choice:
- Native UIKit text loupe/magnifier/grab-handles — works like Notes.app
- Sub-16ms reparse on 10k-line files
- iOS 14 minimum

### T13.1 — Tier 1 MVP (1100 LOC, weeks 1-2)

- `EditorView.swift` (250 LOC) — full-screen modal
- `RunestoneRepresentable.swift` (180 LOC) — UIViewRepresentable wrapper
- `EditorViewModel.swift` (300 LOC) — ObservableObject state + RPC
- `EditorLanguageMap.swift` (100 LOC) — ext → TreeSitterLanguage
- `EditorTheme.swift` (140 LOC) — WTheme.Colors → Runestone.Theme bridge
- `EditorKeyboardBar.swift` (220 LOC) — inputAccessoryView with 12 symbol chips + "Ask WOTANN"

### T13.2 — Tier 2 polish (850 LOC, weeks 3-4)

- `EditorFindBar.swift` (180 LOC)
- `EditorStatusBar.swift` (90 LOC)
- `EditorInlineAIMenu.swift` (150 LOC) — Explain/Refactor/Add tests/Docstring
- `EditorDiffGutterView.swift` (200 LOC) — via desktop shadow-git RPC
- `EditorDocumentPicker.swift` (110 LOC) — iCloud Drive, Files app
- `UIKeyCommand` set for external keyboard (iPad)

### T13.3 — Tier 3 LSP + minimap (500 LOC, weeks 5-7)

- `EditorLSPBridge.swift` (250 LOC) — debounced RPC to desktop LSP (SourceKit/tsserver/pyright already running)
- `EditorHoverCard.swift` (120 LOC) — popover markdown
- `EditorCompletionList.swift` (160 LOC) — ghost-text inline
- Minimap port from CodeEditorView's TextKit 2 impl (~300 LOC)

### Integration

- `ChatView.swift:96` — add Editor sheet to + menu (parallel to CodePlayground)
- `Composer.swift` — wire `@file:` mentions via `onMention` closure
- `ArtifactEditorView.swift` — demote to read-only artifact viewer
- `FileSearchView.swift:80` — reuse files.search RPC

**iOS doesn't need local LSP** — daemon-side LSP is the win. Battery + RAM friendly.

**Tier 13 exit criteria**: `@file:/path/to/code.ts` tap in chat → opens EditorView → edit → "Ask WOTANN" sends back to chat → diff accept/reject.

**Tier 13 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T13.1 | EditorView opens | tap `@file:` in chat | full-screen modal with Runestone renders |
| T13.1 | text loupe | long-press text | native loupe shows |
| T13.1 | UIKit grab handles | select region | native grab-handles |
| T13.1 | language syntax | open `.ts` file | TypeScript TreeSitter highlighting |
| T13.1 | unknown extension | open `.weirdext` | plain-text fallback, no crash |
| T13.1 | keyboard accessory bar | open keyboard | 12 symbol chips + "Ask WOTANN" visible |
| T13.1 | large file (10k lines) | load | <16ms reparse measured |
| T13.2 | find bar | cmd+F equivalent | shows find/replace |
| T13.2 | status bar | bottom of editor | shows line:col, file info |
| T13.2 | inline AI menu | tap icon | Explain/Refactor/Tests/Docstring |
| T13.2 | diff gutter | shadow-git modified file | gutter markers visible |
| T13.2 | document picker | open from iCloud | file loads correctly |
| T13.2 | UIKeyCommand | external keyboard cmd+S | save fires |
| T13.3 | LSP hover | hover symbol | popover markdown |
| T13.3 | LSP completion | type `.` | ghost-text completions appear |
| T13.3 | LSP timeout | daemon slow | cancels after 500ms, no UI freeze |
| T13.3 | minimap | large file | minimap updates on scroll |
| Integration | `@file:` mention in Composer | tap | opens EditorView |
| Integration | "Ask WOTANN" button | inside editor | edits sent back to chat |
| Integration | ArtifactEditorView demoted | read-only | no edit capability; points to Editor |

---

---

## FINAL TIER — Supabase Rotation + God-File Splits + Android Native

**Per user directive: these are LAST. All prior tiers must complete before starting.**

### FT.1 — Supabase Key Rotation (user action, not dev work)

**WHAT**: Rotate Supabase publishable key. Scrub git history.

**WHY**: Blob `dbaf1225` still reachable from 7 refs per `docs/internal/SECURITY_SUPABASE_TRIPLE_CHECK_2026-04-20.md`. Public via GitHub Blob API.

**HOW (user action required)**:
1. Go to supabase.com/dashboard → project `djrgxboeofafvfgegvri` → Settings → API
2. Rotate publishable key. Update `src/providers/supabase-*` consumers with new key.
3. `git filter-repo --path CREDENTIALS_NEEDED.md --invert-paths --force`
4. Force-push to origin (only on main or feature branches you own — never published branches other devs track)
5. Delete v0.1.0 and v0.4.0 tags (they carry the old blob)
6. Delete 5 git stashes (all carry the blob)
7. Remove broken `.git/refs/stash 2` artifact
8. File GitHub Support ticket requesting cached-blob purge
9. Redact Supabase strings from `docs/internal/AUDIT_LANE_4_INFRA_SECURITY.md:116` + `AUDIT_CURRENT_STATE_VERIFICATION.md` BEFORE next push (else re-leak with new SHA)

### FT.2 — God-File Splits

**Source-verified LOC**:
- `src/core/runtime.ts` = **6939 LOC** — split by strategy (query-pipeline / session-lifecycle / provider-gates / memory-wires / autonomous-wires)
- `src/daemon/kairos-rpc.ts` = **7629 LOC** — split by namespace (computer/creations/approvals/fleet/cursor/live-activity/watch/carplay/voice/handoff/file/git/lsp)
- `src/index.ts` = **6158 LOC** — split by command (one file per CLI verb)
- `src/ui/App.tsx` = **3185 LOC** — split into 15 focused components

**God-split strategy extraction per-file** (A+ patch — each split is its own PR, serial within file but parallelizable across files):

### FT.2.1 runtime.ts (6939 LOC → ~5 files of 800-1500 LOC each)

Extraction order (least-coupled first):
1. **`src/core/runtime/provider-gates.ts`** (~800 LOC) — all `config.enableX / process.env.WOTANN_X` gate logic. Identify via `grep -n "process.env\[\"WOTANN_\|config\.enable" src/core/runtime.ts`. Lowest coupling; extract first. Test: run full provider-adapter tests, expect zero delta.
2. **`src/core/runtime/memory-wires.ts`** (~1200 LOC) — OMEGA, TEMPR, Observer/Reflector, stable-prefix, session-ingestion, abstention. Identify via `grep -n "memoryStore\.\|observer\.\|reflector\." src/core/runtime.ts`. Test: run `tests/memory/` suite.
3. **`src/core/runtime/autonomous-wires.ts`** (~800 LOC) — goal-drift, PreCompletionVerifier, ProgressiveBudget, verify-before-done. Test: `tests/core/runtime-wire-invocation.test.ts`.
4. **`src/core/runtime/session-lifecycle.ts`** (~1500 LOC) — session init, close, resume, handoff, cursor-stream, approval-queue. Highest coupling; extract later.
5. **`src/core/runtime/query-pipeline.ts`** (remains in `runtime.ts` or ~2500 LOC file) — the core query() loop, tool dispatch, middleware chain. Final extraction; keep the class shell referencing extracted strategies.

Per-extraction PR pattern:
- Pre-split baseline: `npx vitest run --coverage > /tmp/pre-split-cov.txt`
- Extract: move methods, update imports, preserve public API
- Post-split: `npx vitest run --coverage > /tmp/post-split-cov.txt`
- Diff: `diff /tmp/pre-split-cov.txt /tmp/post-split-cov.txt` — expect zero coverage change
- PR size: aim <800 LOC diff; if larger, sub-split

### FT.2.2 kairos-rpc.ts (7629 LOC → 13 namespace files)

Split by RPC namespace (each namespace has ~500-700 handlers/LOC):
- `src/daemon/rpc/computer.ts` — computer.session.* (11 handlers per T1.1)
- `src/daemon/rpc/creations.ts` — creations.*
- `src/daemon/rpc/approvals.ts` — approval.queue, approval.decide
- `src/daemon/rpc/fleet.ts` — fleet.view, fleet.watch
- `src/daemon/rpc/cursor.ts` — cursor.stream
- `src/daemon/rpc/live-activity.ts` — liveActivity.*
- `src/daemon/rpc/watch.ts` — watch.dispatch
- `src/daemon/rpc/carplay.ts` — carplay.*
- `src/daemon/rpc/voice.ts` — voice.intent
- `src/daemon/rpc/handoff.ts` — session.handoff
- `src/daemon/rpc/file.ts` — file.get, file.delivery, files.search, files.write
- `src/daemon/rpc/git.ts` — git.status, git.branches, git.log, git.diff
- `src/daemon/rpc/lsp.ts` — lsp.hover, lsp.definition, lsp.completion

Keep `kairos-rpc.ts` as shell that imports + registers each namespace module. Order: extract lowest-traffic namespaces first (lsp, voice, carplay), highest-traffic last (computer, file, git).

### FT.2.3 index.ts (6158 LOC → one file per CLI verb)

115 commands per prior audit. Split into `src/cli/commands/<verb>.ts` one file per command group:
- `src/cli/commands/init.ts`, `start.ts`, `chat.ts`, `ask.ts`, `memory.ts`, `relay.ts`, `voice.ts`, `compare.ts`, `review.ts`, `link.ts`, `build.ts`, `autopilot.ts`, `engine.ts`, `enhance.ts`, `skills.ts`, `cost.ts`, `schedule.ts`, `channels.ts`, `doctor.ts`, `grep.ts`, `worktree.ts`, `best-of-n.ts`, `exploit.ts`, `intent.ts`, `design-*.ts`, etc.
- Keep `src/index.ts` as a thin dispatcher that imports + registers each command file.
- Each command file: <300 LOC typical, <800 LOC max.

### FT.2.4 App.tsx (3185 LOC → 15 focused components)

Already partially-componentized per `desktop-app/src/components/`. Full split moves command-handler logic out of `App.tsx` into:
- Route-handlers: `RouteChat.tsx`, `RouteEditor.tsx`, `RouteWorkshop.tsx`, `RouteExploit.tsx`, `RouteBrowse.tsx`
- Top-level menus: `CommandPalette.tsx` (already exists — deepen), `SettingsShell.tsx`, `KeyboardShortcuts.tsx`
- Global providers: `ProvidersShell.tsx` (Zustand + SWR + Tauri event bridge)
- Smaller split files per feature

Target: `App.tsx` becomes ~400 LOC shell with imports + routing.

**Strategy extraction**:
- Extract cohesive feature clusters into their own files
- Preserve public API: what other code imports from these god-files stays working
- Use strategy pattern where behavior varies by flag (e.g., `TemprStrategy` vs `FtsStrategy`)
- Add tests per extracted file

**Split preserves everything** — no functional changes, just organization.

### FT.3 — Android Native App

**Strategy**: 3-tier ladder per research agent verdict.

### FT.3.1 — Termux CLI (2 days, guaranteed safety net)

**HOW**:
```bash
# F-Droid Termux (not Play Store — that version ships Node 12)
pkg update && pkg upgrade -y
pkg install nodejs-lts git sqlite openssl
npm install -g wotann
termux-wake-lock
wotann
```

**Gotchas**:
- `better-sqlite3` will NOT build on Termux. Ship with storage-adapter interface: Android tier uses `node-sqlite3` (has Termux package) OR `sql.js` pure-WASM OR `pkg install sqlite` + JSON-serialized fallback
- Termux:API provides clipboard/notifications/TTS/battery/sensors (pkg install termux-api)
- Per-OEM wake-lock whitelist documentation needed (Xiaomi/Oppo/Vivo/Huawei aggressive battery managers)
- F-Droid only (Play Store Termux abandoned with Node 12)

### FT.3.2 — Tauri Mobile Android AAB (4-6 weeks MVP)

**HOW**: `tauri android build --aab` — reuses existing `desktop-app/` React codebase.

**Week-by-week**:
- Week 1: Bake-off — does Tauri Mobile build desktop-app/ cleanly? If yes proceed. If blocked by WebView IME/plugin capability bugs, pivot to FT.3.3.
- Week 2: Core shell — 4-tab NavigationSuiteScaffold, Chat tab end-to-end
- Week 3: Pairing wizard (QR + PIN + NSD discovery) + WebSocket + BiometricPrompt + Keychain
- Week 4: Cost dashboard + 3 Glance widgets + QS Tile + Share intent
- Week 5: Offline queue (Room + WorkManager) + Settings
- Week 6: Polish + Material 3 Expressive + Haze glass + Play Store internal testing

### FT.3.3 — Kotlin + Jetpack Compose native (12 weeks full-parity)

Material 3 Expressive, Glance widgets, Quick Settings TileService, Android Auto (androidx.car.app), Wear OS (Compose for Wear), Health Connect, NFC HCE, foreground services (Android 15 6h cap + UIDT jobs), AccessibilityService + MediaProjection for Desktop Control.

**File structure**:
```
android/
├── app/
│   ├── build.gradle.kts (target=36, min=26, compose=true)
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── kotlin/com/wotann/android/
│           ├── WotannApplication.kt (@HiltAndroidApp)
│           ├── MainActivity.kt (single-activity Compose host)
│           ├── ui/ (theme, shell, chat, editor, workshop, exploit, pairing, settings, cost, components)
│           ├── domain/ (agents, providers, conversations, offline)
│           ├── data/ (db, network, security, discovery)
│           ├── services/ (AgentForegroundService, LiveUpdateManager, Voice, HealthConnect, NFC)
│           ├── widgets/ (Glance: CostWidget, AgentStatusWidget, QuickLaunchWidget)
│           ├── tile/WotannTileService.kt
│           ├── intents/ (shortcuts.xml + App Actions)
│           └── share/ShareActivity.kt
├── wear/ (Tier 3)
├── auto/ (Tier 3)
└── benchmark/ (Macrobenchmark)
```

**REJECT**: Flutter (Dart breaks Swift parity), React Native (third stack), Compose Multiplatform as iOS rewrite (30k Swift LOC already shipped).

**CRITICAL Google sideloading clampdown Sept 2026**: developer verification mandatory in BR/ID/SG/TH. $25 fee. Register NOW for org WOTANN.

**iOS → Android feature parity** (~70% ports easily):
- Live Activities → Live Updates (Android 16 ProgressStyle)
- SwiftUI → Jetpack Compose NavigationSuiteScaffold
- WOTANNIntents → App Actions + Quick Settings TileService
- CarPlay → Android Auto
- Apple Watch → Wear OS
- HealthKit → Health Connect
- NFC → HCE + NfcAdapter

**Final tier exit criteria**: Supabase rotated, god-files split (runtime.ts < 800 LOC per file), Android shipping on F-Droid (Termux) + Play Store (Tauri Mobile AAB) + native Kotlin polish.

**FINAL TIER integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| FT.1 | Supabase rotation — new key active | dashboard rotate + update src | new key works, old key invalid |
| FT.1 | git history scrubbed | `git cat-file -e dbaf1225` | returns non-zero (blob unreachable) |
| FT.1 | v0.1.0 + v0.4.0 tags deleted | `git tag` | tags removed |
| FT.1 | GitHub cached-blob purge | ticket filed | acknowledgement received |
| FT.1 | doc redaction | AUDIT_LANE_4 / AUDIT_CURRENT_STATE | Supabase string redacted before push |
| FT.2.1 | runtime — extract provider-gates | split | `src/core/runtime/provider-gates.ts` ~800 LOC, tests still pass |
| FT.2.1 | runtime — extract memory-wires | split | `src/core/runtime/memory-wires.ts`, zero coverage delta |
| FT.2.1 | runtime — extract autonomous-wires | split | `src/core/runtime/autonomous-wires.ts` |
| FT.2.1 | runtime — extract session-lifecycle | split | `src/core/runtime/session-lifecycle.ts` |
| FT.2.1 | runtime — query-pipeline final | split | `src/core/runtime/query-pipeline.ts` OR shell file ~2500 LOC |
| FT.2.1 | PR per extraction | size | each <800 LOC diff; if larger, sub-split |
| FT.2.1 | coverage delta | pre vs post | 0% change |
| FT.2.2 | kairos-rpc — 13 namespace files | split | each ~500-700 LOC |
| FT.2.2 | kairos-rpc shell | remaining | only registers each namespace module |
| FT.2.2 | lowest traffic first | extract order | lsp, voice, carplay before computer, file, git |
| FT.2.3 | index.ts — one file per CLI verb | split | `src/cli/commands/<verb>.ts` pattern |
| FT.2.3 | thin dispatcher | `src/index.ts` | <400 LOC after split |
| FT.2.3 | command file sizes | typical | <300 LOC, <800 max |
| FT.2.4 | App.tsx — 15 components | split | each feature cluster own file |
| FT.2.4 | App.tsx shell | remaining | ~400 LOC routing + imports |
| FT.2.4 | route handlers | RouteChat / RouteEditor etc. | separate files |
| FT.3.1 | Termux install | F-Droid Termux + steps | `wotann start` runs on Android |
| FT.3.1 | sqlite on Termux | `better-sqlite3` fails | `node-sqlite3` fallback works |
| FT.3.1 | wake-lock | Termux:API | phone doesn't sleep during session |
| FT.3.2 | Tauri Mobile AAB build | `tauri android build --aab` | AAB produced, installable |
| FT.3.2 | 4 tabs render | NavigationSuiteScaffold | Chat/Editor/Workshop/Exploit all work |
| FT.3.2 | pairing wizard | QR + PIN + NSD | desktop pairs with phone |
| FT.3.2 | WebSocket + BiometricPrompt | paired device | biometric unlocks WOTANN |
| FT.3.2 | Glance widgets | Android home screen | cost + agent + launch widgets render |
| FT.3.2 | QS Tile | quick settings | tile fires intent |
| FT.3.2 | offline queue | no network | queue + sync on reconnect |
| FT.3.3 | Kotlin + Compose — 5-tab shell | run | Material 3 Expressive visible |
| FT.3.3 | Glance CostWidget | widget picker | adds + updates |
| FT.3.3 | Wear OS app | paired watch | runs independently |
| FT.3.3 | Android Auto | AAOS emulator | shows driving UI |
| FT.3.3 | Health Connect | opt-in | reads steps/sleep for context |
| FT.3.3 | NFC HCE | tap NFC | pairs with external device |

---

---

## Cross-Cutting Risk + Resilience (added per 2nd-audit)

### Tier 3 error handling for `claude -p` subprocess failures

The subprocess pattern has 4 failure modes Claude Code must handle explicitly (not "Wave 5 hardening"):

1. **`claude` binary not installed (ENOENT)** → `spawn()` emits `error` event. Catch via `child.on('error')`. Surface to user: "Claude CLI not found. Install from https://docs.claude.com/cli/install OR use an API key (`wotann init --byok`)."
2. **Authentication expired** → stream-json emits `{type: "error", subtype: "auth_expired"}`. Detect in `parseStreamJson`, emit WOTANN event `claude.auth.expired`, prompt user to re-run `claude login`. Do NOT retry silently.
3. **Rate limit** → stream-json emits `{type: "error", subtype: "rate_limit", resetAt: <unix>}`. Surface ETA to user; offer fallback to BYOK path if user has API key.
4. **Network partition mid-stream** → `parseStreamJson` buffer holds incomplete JSON. Flush on child `close` event; if final buffer has incomplete JSON, emit `stream.truncated` error with hint "network issue mid-response — check internet and retry."

**Spec**: add `src/claude/error-handling.ts` (~200 LOC) as part of Wave 0 proof-of-life, NOT Wave 5. Every stream-json parser consumer wraps with these 4 error categories. Test via stubbed `claude` binary emitting each error shape.

### Tier 3 cost telemetry

User's Claude subscription pays Anthropic directly. WOTANN must surface sub-quota burn:

1. **Usage probe**: on session start, spawn `claude /usage --json` once (read-only), parse monthly-used/monthly-limit, display in StatusRibbon
2. **Per-turn estimate**: track token counts in stream-json chunks (`{type: "result", usage: {input_tokens, output_tokens}}`), add to in-memory session counter
3. **Threshold warnings**: at 75% / 90% / 95% of monthly quota, emit `cost.warning` event; desktop shows banner, CLI prints yellow line
4. **Daily drift check**: compare WOTANN's counted usage vs `claude /usage` probe weekly; alert on >10% drift (indicates missing turns)

**Spec**: extend `src/telemetry/cost-tracker.ts` (exists) with Claude-sub-specific branch. Wave 1 scope, not deferred.

### Tier 3 rollback feature flag

If Anthropic tightens subscription-SDK policy post-launch:

1. **Env flag**: `WOTANN_SUBSCRIPTION_SDK_ENABLED=0` disables Tier 3 path entirely
2. **Graceful fallback**: when disabled, WOTANN config-discovery prefers (a) BYOK Anthropic API key if present, (b) free-tier Groq/Gemini/DeepSeek, (c) local Ollama
3. **User notification**: first run after flag-set displays one-time "Claude subscription path disabled — using fallback providers" message
4. **Monitoring**: `src/providers/claude-cli-backend.ts` wraps first `invokeClaudeCli()` call with feature-flag check; if disabled, throw `FeatureDisabledError` with fallback guidance

**Spec**: 50 LOC addition to Wave 0.

### Documentation drift prevention

V9 itself will drift as the codebase grows. Self-correcting mechanism:

**NEW FILE**: `scripts/v9-drift-check.mjs` (100 LOC)
- Reads V9 Baseline table + every `wc -l` claim + every file:line citation
- Re-runs each check against HEAD
- Diffs; prints `v9-drift-check FAIL: X claims stale`
- Runs in CI as advisory (not blocking) — flags when V9 drifts >5% from reality

**NEW GITHUB ACTION**: `.github/workflows/v9-drift-check.yml` — weekly cron + on-push for `docs/MASTER_PLAN_V9.md` changes. Comments on PR if V9 drifts.

## Cross-Cutting Quality Bars

1. **QB #15 (new, 2026-04-21)**: Synthesis claims carry `[verified file:line:git-ref]` citations. No uncited MD paraphrases.
2. **QB #14**: Commit messages are claims needing runtime verification. Grep for invocation, not just getter.
3. **QB #11**: Sibling-site scan — grep for parallel firing sites before claiming wired.
4. **QB #7**: Per-session state, not module-global.
5. **QB #6**: Honest stubs over silent success — `{ok: false, error: "..."}` not `{ok: true}`.
6. **Ecosystem precedent over novel invention**: Zed/Jean/Goose subprocess pattern, Anthropic-sanctioned extension surface — use documented flags as intended.
7. **Auto mode discipline**: execute low-risk wires immediately. Confirm before destructive ops. Tier 0 blocks all other tiers.

---

## Tier 14 — Items Missing From Initial V9 Draft (added 2026-04-21 PM brutal audit)

### T14.1 — Claude Code parity features (port from CC v2.1.x changelog)

Each is a small-to-medium port. All documented as sanctioned by Anthropic.

| Feature | CC Version | Effort | WOTANN File |
|---|---|---|---|
| Opus 4.7 xhigh effort level in model-router | v2.1.111 | 1h | `src/providers/model-router.ts` |
| Computer Use `computer_20251124` GA + ROI zoom | Oct 2024 beta → GA | 2w | `src/computer-use/perception-engine.ts` — add ROI+zoom action |
| `ENABLE_PROMPT_CACHING_1H` 1h TTL | v2.1.108 | 2h | `src/providers/prompt-cache-warmup.ts` — 1h TTL variant |
| Monitor tool for background scripts | v2.1.98 | 3d | NEW `src/tools/monitor-bg.ts` |
| `/team-onboarding` equivalent | v2.1.101 | 1w | `src/cli/team-onboarding.ts` (extend existing) |
| Session recap on return | v2.1.108 | 2d | `src/cli/first-run-success.ts` — add returning-user variant |
| `/tui` flicker-free mode + `CLAUDE_CODE_NO_FLICKER=1` | v2.1.110 | 1w | `src/ui/App.tsx` (minor) |
| Plugin bin/executables | v2.1.91 | 1w | `src/marketplace/plugin-loader.ts` |
| PreToolUse `defer` + conditional `if:` fields | v2.1.89 / v2.1.85 | 1w | `src/hooks/engine.ts` — add defer + if support |
| MCP Elicitation + ElicitationResult hooks | v2.1.76+ | 1w | `src/hooks/engine.ts` + `src/mcp/elicitation.ts` |
| Memory tool shim adapter (Anthropic's `memory` tool contract) | memory tool GA | 3d | `src/mcp/memory-tool-shim.ts` |
| `/ultrareview`-equivalent `wotann review --cloud` | v2.1.111 | 1w | NEW `src/cli/commands/review.ts` |
| Channels push-inversion (MCP→session) | v2.1.80 | 3d | `src/channels/push-inversion.ts` |
| W3C OTEL TRACEPARENT propagation | v2.1.98 | 1w | `src/telemetry/observability-export.ts` |

**Total T14.1**: ~12 weeks spread across items. Prioritize by user-visible impact.

### T14.2 — Memory SOTA deep patterns (beyond T2 activation)

| Pattern | Source | Effort | WOTANN File |
|---|---|---|---|
| Supermemory ASMR 99% pattern (8-12 variant voter ensemble) | LongMemEval leader | 2d | NEW `src/memory/asmr-voter.ts` — run same query through 3-5 recall modes, majority-vote top-K |
| Graph community detection (Zep/Graphiti Louvain) | Zep research | 2d | NEW `src/memory/community-detection.ts` over bi-temporal edges |
| Persona abstraction layer (TiMem TMT) | TiMem research | 3d | NEW `src/memory/persona-tree.ts` — hierarchical persona over episodic |

### T14.3 — iOS additional polish items (beyond T7)

| Item | Source | Effort | File |
|---|---|---|---|
| Full-duplex voice (ChatGPT parity) | iOS audit | 6h | NEW `ios/WOTANN/Services/DuplexVoiceSession.swift` (350 LOC) |
| Push notifications (APNs + VoIP-push for Handoff resume) | iOS audit | 4h | `ios/WOTANN/Services/NotificationService.swift` (wire APNs in wireServices) |
| Siri suggestion donation (AppIntent.donate after every sendPrompt) | iOS audit | 1h | 20 LOC of donation calls |
| iOS `@Observable` migration (215 @ObservableObject sites) | iOS audit | 1w | codebase-wide refactor |

### T14.4 — Session_10 orphan UI items (Norse signature motifs)

Per docs/MASTER_PLAN_SESSION_10.md — 5 unique UI concepts that never made V8. Sessional UX that gives WOTANN a signature visual language.

| Item | Effort | File |
|---|---|---|
| Huginn & Muninn twin-raven split pane (⌘⇧2) | 1w | `desktop-app/src/components/layout/TwinRavenSplit.tsx` |
| Raven's Flight dispatch animation (parabolic arc iOS↔desktop) | 1w | iOS + desktop-app + F-series events |
| Sigil Stamp (gold underline per modified file) | 2d | `desktop-app/src/components/editor/SigilStamp.tsx` |
| Conversation Braids (⌘⇧B multi-thread canvas) | 2w | `desktop-app/src/components/chat/ConversationBraids.tsx` |
| Patron Summoning onboarding (4 cards: Thor/Odin/Loki/Freya) | 1w | `src/cli/onboarding-screens.tsx` variant + desktop |
| Cost Glint (paid-key specular sheen) | 1d | CSS tokens + desktop-app cost display |
| Sound design (4 WAV cues: Rune-tap, Well-hum, Wax-seal, Wood-knock, 48kHz/24-bit) | 1w | `assets/sounds/` + audio playback layer |

### T14.5 — Runtime Lane-6 audit (explicit, not implicit)

**WHAT**: Runtime output verification — confirm that what the code claims is actually what runs.

**Specific Lane-6 checks**:
1. `memory_entries` table fills in fresh sessions (not just `auto_capture`)
2. `token-stats.json` non-zero after each session
3. `knowledge-graph.json` populates when `autoPopulateKG=1`
4. Dreams process actual entries (not zero every run)
5. USER.md learns across sessions (not template)
6. session_start / session_end ratio reasonable (not 1:600)

**Effort**: 1-2 days
**File**: NEW `scripts/runtime-lane6-audit.mjs` — scripted post-session snapshot compared against pre-session

### T14.6 — Benchmark wire-up (real-mode, not smoke)

**WHAT**: The 5 benchmark runners are all hardcoded `mode: "simple"`. None produce leaderboard-comparable numbers.

**Specific fixes**:
1. Fix `src/intelligence/benchmark-runners/terminal-bench.ts:135` broken URL (`tbench-ai` → `laude-institute`)
2. Wire `WOTANN_TB_REAL=1` env var to `tb run-agent` subprocess
3. `scripts/terminal-bench-extract.mjs` + sibling extraction scripts
4. Download real LongMemEval 500-item corpus (T2.1)
5. Replace rule-based scorer with LLM-judge (T2.2)
6. SWE-bench Verified/Live real runner
7. BFCL + GAIA + WebArena runners

**Effort**: 1-2w total

### T14.7 — Tier-B follow-ups already specced but scheduled

| Item | Effort | File |
|---|---|---|
| Cowork multi-agent (Anthropic Cowork GA Apr 9) | 3-4d, 500-700 LOC | `src/orchestration/cowork.ts` — extends coordinator.ts |
| Time-travel / replay (`wotann replay/fork`) | 2-3d, 400 LOC | `src/autopilot/trajectory-recorder.ts` extend + `src/cli/replay.ts` + `src/cli/fork.ts` |
| AAIF badge in README + Goose-compat mode test | 0.5d | README.md + test file |
| Android/Termux (moved to FINAL TIER per user) | — | See FT.3 |
| iOS Monaco → Runestone (T13) | 10-14d | See T13 |
| Agentic browser (T10) | 8w | See T10 |

### T14.8 — Langfuse-competitive SaaS (separate business line)

Note: this is not a harness feature. Separate `obs.wotann.com` product that ingests OpenTelemetry from WOTANN sessions. 3000+ LOC as standalone service. Tracked as business initiative, not engineering tier.

### T14.9 — Cline `.wotannrules` marketplace pattern

**WHAT**: `.wotann/rules/*.md` community file format + `wotann rules search` command that browses a community index hosted as static JSON on GitHub Pages.

**WHERE**: `src/cli/commands/rules.ts` + `.wotann/rules/` convention

**EFFORT**: 200 LOC, 2 days

### T14.10 — DEAD-SAFE deletions (per wire-audit)

These 6 modules are confirmed dead, zero external callers, no resurrection value. Delete to reduce maintenance surface.

- `src/utils/logger.ts`
- `src/utils/platform.ts`
- `src/cli/history-picker.ts`
- `src/cli/incognito.ts`
- `src/cli/pipeline-mode.ts`
- `src/desktop/desktop-store.ts`

**Effort**: 1h
**Risk**: zero — wire-audit confirmed zero callers

### T14.11 — Documentation hygiene (cross-reference to Document Hygiene Directives)

See the **Document Hygiene Directives** section below for the canonical list. This entry kept as cross-reference only; the imperative list lives in one place to avoid drift.

### T14.12 — Google Sideloading Sept 2026 compliance prep

**WHAT**: Pre-register WOTANN Android developer identity before the Sept 2026 developer-verification enforcement begins in BR/ID/SG/TH.

**WHY**: $25 one-time fee + org business registration + verified website. Free hobbyist tier has 20-device cap. Blocking future Android distribution if not done now.

**WHEN**: Even if Android native ships in FINAL TIER, registration can start NOW.

**Effort**: 1h (user-only: form submission)

**Tier 14 integration test matrix**:
| Sub-item | Scenario | Path | Expected |
|---|---|---|---|
| T14.1 | Opus 4.7 xhigh | model-router picks effort=xhigh | request params include xhigh flag |
| T14.1 | ROI zoom in perception engine | perception sees small element | ROI + zoom action fires |
| T14.1 | 1h TTL cache | `ENABLE_PROMPT_CACHING_1H=1` | 1h TTL applied; request header includes flag |
| T14.1 | Monitor tool for bg scripts | start bg script via Monitor | each stdout line surfaces as event |
| T14.1 | `/team-onboarding` equivalent | run `wotann onboard team` | team.md + org skill catalog scaffolded |
| T14.1 | Session recap on return | user returns after 24h | recap with summary + unfinished tasks |
| T14.1 | `/tui` flicker-free | `CLAUDE_CODE_NO_FLICKER=1` | UI updates without flicker |
| T14.1 | Plugin bin/executables | plugin ships a binary | invocable from skill dispatch |
| T14.1 | PreToolUse `defer` + `if:` | hook with `if: "Write"` | fires only on Write; defer-routes to council |
| T14.1 | MCP Elicitation | server emits ElicitationRequest | hook responds with ElicitationResult |
| T14.1 | memory tool shim | Claude calls `memory` tool | WOTANN memory serves via shim |
| T14.1 | `/ultrareview` equivalent | `wotann review --cloud <PR>` | cloud agent reviews PR, comments in-line |
| T14.1 | Channels push-inversion | MCP server initiates event | session receives message |
| T14.1 | W3C TRACEPARENT | external trace → WOTANN | trace continues across services |
| T14.2 | ASMR voter ensemble | same query through 5 recall modes | majority-vote top-K |
| T14.2 | graph community detection | bi-temporal edges | Louvain assigns communities |
| T14.2 | persona tree | hierarchical | persona abstractions over episodic mem |
| T14.3 | Full-duplex voice | push-to-talk + streaming | no barge-in issue, ChatGPT parity |
| T14.3 | APNs push | deliver in background | shown as notification, resume on tap |
| T14.3 | Siri donation | after every sendPrompt | AppIntent.donate called |
| T14.3 | `@Observable` migration | 215 sites | zero tsc errors after migration |
| T14.4 | Huginn & Muninn twin-raven split | `cmd+shift+2` | side-by-side pane opens |
| T14.4 | Raven's Flight dispatch | trigger iOS↔desktop dispatch | parabolic-arc animation plays |
| T14.4 | Sigil Stamp | modified file | gold underline shown |
| T14.4 | Conversation Braids | `cmd+shift+B` | multi-thread canvas opens |
| T14.4 | Patron Summoning onboarding | 4-cards | Thor/Odin/Loki/Freya visible |
| T14.4 | Cost Glint | paid-key | specular sheen on cost display |
| T14.4 | 4 sound cues | runtime event | Rune-tap / Well-hum / Wax-seal / Wood-knock play |
| T14.5 | Lane-6 `memory_entries` | fresh session | fills, not empty |
| T14.5 | token-stats.json | after session | non-zero |
| T14.5 | knowledge-graph.json | `autoPopulateKG=1` | populates |
| T14.5 | dreams process entries | cron fires | entries processed, non-zero |
| T14.5 | USER.md learns | 3 sessions | content grows, not template |
| T14.5 | session_start/end ratio | normal session | close to 1:1, not 1:600 |
| T14.6 | `tb run-agent` wired | `WOTANN_TB_REAL=1` | real runner produces leaderboard number |
| T14.6 | URL fixed | grep `tbench-ai` | 0 matches; `laude-institute` present |
| T14.6 | LongMemEval 500-item | T2.1 corpus present | 500 items loaded |
| T14.6 | LLM-judge scorer | T2.2 active | real scores emitted |
| T14.6 | SWE-bench Verified/Live | real runner | leaderboard-comparable number |
| T14.6 | BFCL / GAIA / WebArena | runners present | each produces score |
| T14.7 | Cowork multi-agent | 3 workers | parallel execution via Cowork |
| T14.7 | Time-travel replay | `wotann replay <session>` | trajectory replays deterministically |
| T14.7 | AAIF badge | README.md | present |
| T14.9 | `.wotannrules` search | `wotann rules search auth` | community index queried, results shown |
| T14.9 | rule install | `wotann rules install <id>` | rule placed in `.wotann/rules/` |
| T14.10 | DEAD-SAFE deletes | 6 modules removed | grep for imports = 0 |
| T14.10 | build after delete | tsc + tests | still green |
| T14.12 | Google verification | registration submitted | confirmation received |

---

## Document Hygiene Directives

1. Archive 10+ stale MDs to `docs/archive/`: MASTER_AUDIT_2026-04-14.md, DEEP_AUDIT_2026-04-13.md, MASTER_PLAN_PHASE_2.md, MASTER_PLAN_V5.md, V6.md, SESSION_10.md + ADDENDUM, AUTONOMOUS_EXECUTION_PLAN_V1-V4, FINAL_VERIFICATION_AUDIT_2026-04-19.md, MARKDOWN_CORPUS_AUDIT_2026-04-03.md, root Apr-2/Apr-3 files.
2. Update CLAUDE.md stale claims: 11→19 providers, 22→50 subdirs, 21→23 hooks, "85% implemented"→"23% DONE / 50% PARTIAL / 26% MISSING"
3. Sync Formula/wotann.rb version with package.json
4. Reconcile test-count drift
5. Add v0.5.0 CHANGELOG.md

---

## Known Gaps / Pending Dependencies (transparent blockers)

1. **T0.1 OpenClaw pattern**: resolved 2026-04-21 via OpenClaw agent `aa26b8cf40a9ee894` output. Concrete code recipe + env scrub list + safe-exec pattern now inline in T0.1.
2. **T0.1 policy claim**: "Anthropic staff told us" is OpenClaw's unverifiable claim. WOTANN docs must reproduce verbatim as "follows pattern OpenClaw documents as sanctioned" — NEVER strengthen.
3. **T3 `assembleWotannSystemPrompt()`**: function referenced in Tier 3 T3.1 code snippet is NEW — implementation spec lives in `src/claude/system-prompt.ts` (150 LOC) per T3's file-list table. It composes WOTANN persona + session state + skill catalog + memory context.
4. **TESTS_SUSPECT.md inventory**: docs/TESTS_SUSPECT.md lists flaky tests beyond the 1 Ink TUI flake. Tier 1 should reconcile this list before asserting "7590/7597 passing" as regression baseline.
5. **docs/internal/TIER1_P0_6_STALE_CLAIM.md + TIER1_COMMIT_RACE_ERRATA.md**: cite these two audits inside Tier 1 as concrete examples of the grep-before-claim discipline (Quality Bar #11 + #14).
6. **Handoff-receiver.ts status**: Tier 8 T8.x assumes `src/design/handoff-receiver.ts` (200 LOC) is ALREADY DONE and runnable. T8 schedules the bundle-writer + dtcg-emitter + diff + CLI around it. If handoff-receiver needs updates for format drift, add as explicit T8.0 prerequisite.
7. **45 OSS projects in research, 21 ports in T12**: the other 24 are (a) rejected as redundant with existing WOTANN infra (e.g., Marqo wrong-domain, Helicone dead, SuperAGI stalled), (b) studied for ideas-only (e.g., AutoGen actor model noted in DECISIONS.md), (c) already partially ported in prior sprints (e.g., DSPy MIPROv2). T12 focuses on net-new ports. Full competitive inventory lives in Engram topic_key `research/oss-ecosystem-sweep`.

## Execution Protocol for Claude Code

When executing this plan:

1. **Always start with `mem_context project=wotann`** — recover session state
2. **Verify Tier prerequisites before starting a tier** — grep + tsc + test run
3. **One tier at a time for destructive changes** (T0 first, then T1-9 can parallelize on disjoint files)
4. **Every commit sources via `git commit -- <path>`** to avoid sweeping concurrent-agent work
5. **Whole-file ownership for parallel agents** — never two agents on same file
6. **Save to Engram after each tier completion** with `topic_key: "wotann-v9-tier-N"`
7. **Update this document at end of each tier** — mark items ✓ with commit SHAs
8. **NEVER start FINAL TIER until all other tiers green**
9. **Opus 4.7 max effort for every agent dispatched**
10. **Quality Bars #1-15 apply universally**

### Tooling + skill dispatch (auto-invoke these when signals match)

- **Debugging 4+ possible causes** → `/tree-search` (agentic BFTS)
- **Complex single hypothesis** → `superpowers:systematic-debugging`
- **Why did X happen? root cause** → `/trace`
- **Make feature work e2e** → `/focused-fix`
- **Tests/build/lint failing in cycles** → `/ultraqa`
- **Parallel code review** → `agent-teams:team-review`
- **Parallel feature dev** → `agent-teams:team-feature`
- **Multi-step task with file tracking** → `planning-with-files:plan`
- **Long task continuity** → `/save-session` → next turn `/resume-session`
- **Recurring prompt** → `/loop` (e.g., `/loop 5m /ultraqa`)
- **Scheduled remote agents** → `/schedule`
- **GitHub Actions failures** → `/dx-gha`
- **Research question or unknown library** → Context7 (`resolve-library-id` → `query-docs`)

### Pre-flight checklist (run BEFORE touching any tier)

```bash
# 1. Recover context
mem_context project=wotann
# 2. Verify current state
git status --short
git log --oneline -5
npx tsc --noEmit 2>&1 | tail -5
npx vitest run 2>&1 | grep -E "Tests|Test Files" | tail -3
# 3. Check CI status
gh run list --limit 3 --json conclusion,displayTitle
# 4. Disk space for model downloads / builds
df -h /System/Volumes/Data | tail -1
# 5. Finder artifact cleanup (recurring)
find . -name '* 2.ts' -not -path './node_modules/*' 2>/dev/null | head -5  # expect: 0
find .git/refs -name '* 2' -type f -delete 2>/dev/null
```

### Post-tier verification checklist

```bash
# Every tier should pass:
npx tsc --noEmit  # expect: rc=0
npx vitest run    # expect: no new failures vs baseline
grep -c "TODO(v9)" docs/MASTER_PLAN_V9.md  # decreasing over time
git log --oneline origin/main..HEAD  # atomic commits per sub-item
```

---

## Summary for Cold-Read Context

**WOTANN IS**: a universal AI agent harness (231,924 LOC TS + Tauri desktop + iOS 30k Swift LOC + KAIROS daemon) that amplifies any AI model while matching or exceeding every single surface competitor has shipped.

**WHAT'S SHIPPED**: 19 providers, 14+ channel adapters, 65-87 skills, FTS5+sqlite-vec+ONNX memory, Mastra Observer+Reflector dyad, TEMPR 4-channel retrieval, Mem0 v3 ADD-only, bi-temporal edges, supersession detection, AutonomousExecutor+Ralph+PWR+Graph DSL+Waves, 23 hooks, 16-layer middleware, 4-layer Desktop Control, shadow-git, Production iOS with Desktop Control + CarPlay + ECDH RPC.

**WHAT'S NOT WIRED** (V9 closes): 14 FATAL orphans including sqlite-vec/ONNX/CredentialPool/KGBuilder/JeanOrchestrator/F-series-FE-consumers/OMEGA-getter-unused/Perception-engine-unused/CloudSync-unused.

**WHAT'S LEGALLY WRONG** (V9 T0 fixes): `anthropic-subscription.ts` token-copy + `codex-oauth.ts` independent-PKCE both violate current Anthropic/OpenAI TOS.

**KEYSTONE STRATEGIC UNLOCK** (V9 T3): Claude Agent SDK in-process gives WOTANN full harness control while Pro/Max subscription pays for inference. 26 hooks, --agents JSON, --tools "" to disable all built-ins, --strict-mcp-config for WOTANN-only tools, canUseTool async interception. WOTANN drives. Claude Code inferences.

**NEW FEATURES PLANNED** (V9 T8-10): Design Bridge (Claude Design competitor, 4w), `wotann build` (full-stack builder, 8w), Agentic Browser (with mandatory prompt-injection security gate, 8w).

**FINAL TIER** (per user directive, last): Supabase rotation + god-file splits + Android native (Termux-now, Tauri Mobile MVP, Kotlin-native full 12w).

---

## Source Verification Inventory

Every claim in V9 traces to one of:

- **Grep result** at HEAD c7d64a9
- **File:line citation** in committed source
- **Web-grounded research agent** output with URL citations (Engram topic_keys: research/*)
- **Official documentation** (code.claude.com, developer.apple.com, github.com/modelcontextprotocol)

No claims from prior MDs without independent verification (Quality Bar #15).

---

**END MASTER_PLAN_V9.md**
