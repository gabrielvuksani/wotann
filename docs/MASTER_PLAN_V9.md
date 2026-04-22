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
4. **Tiers 0–7 have full WHAT / WHY / WHERE / HOW / VERIFICATION per sub-item.** Tiers 8–14 use abbreviated structure (headers + prose + file list) — they are narrow-scope enough that cold-read Claude can reconstruct the missing subsections from the primary research source linked in each tier. When a Tier 8+ item needs full structure for execution, expand it in-place during execution (mark with `[EXPAND-BEFORE-EXEC]` comment in the tier body).
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

---

## Tier 12 — Competitor Port Backlog — ongoing / ~8000 LOC

**NOTE on executability**: Tier 12 is explicitly a **BACKLOG**, not a ready-to-execute blueprint. Each T12.x is a 1-4 sentence summary with file path + LOC estimate. Claude Code executing T12 items **MUST** expand the chosen item to full WHAT/WHY/WHERE/HOW/VERIFICATION structure before writing code — use the `[EXPAND-BEFORE-EXEC]` convention from the preamble. Reference Engram `research/oss-ecosystem-sweep` for additional context per item.

Priority-ordered by (leverage × proven-impact / effort):

### T12.1 — Meta-Harness environment bootstrap (400 LOC, 2 days) — +3-5 pts TB2

Stanford IRIS OPEN SOURCE (950★). ENV + git + processes + memory snapshot at session start, injected into initial prompt. `src/intelligence/environment-snapshot.ts`.

### T12.2 — Terminus-KIRA 6 tricks (260 LOC, 4 days) — +4-7 pts TB2

Native tool calling (already have `tool-parsers/`, verify all providers), marker-based command polling (~80 LOC in terminal tool), image_read tool in terminal context (~120 LOC), smart completion verification checklist (~40 LOC), ephemeral prompt caching (verify + enable), tmux pull mechanism (~60 LOC).

### T12.3 — WarpGrep parallel search subagent (180 LOC, 3 days) — +2-3 pts across TB/SWE/Aider

8 parallel tool calls, returns spans only, shield main from rejected files. `src/intelligence/parallel-search-agent.ts`.

### T12.4 — Goose Recipe YAML system (1 week)

NEW `recipes/` module. Goose's format: instructions + required_extensions + parameters + retry + sub_recipes + cron. Community virality flywheel.

### T12.5 — Continue.dev PR-as-status-check (2 weeks)

`.wotann/checks/*.md` runs on PR as GitHub status check. Competitive moat vs Claude Code (no such feature).

### T12.6 — Agentless localize→repair→validate mode (1 week)

`wotann --mode=agentless`. $0.34/issue per paper. Matches free-tier-first bar.

### T12.7 — MetaGPT SOP pipeline (2 weeks)

`wotann sop <product-idea>` → PM → Architect → Eng → QA with structured artifact handoff.

### T12.8 — Linear/Jira/Slack MCP connectors (3 weeks, 1 week each)

Devin-style enterprise ticket inbox. `src/connectors/{linear,jira,slack}.ts` each ~1 week.

### T12.9 — TextGrad textual gradients (AdalFlow, 1 week)

`src/learning/textgrad-optimizer.ts`. Orthogonal to existing GEPA/MIPROv2.

### T12.10 — OpenInference/OTEL trace emission (3 days)

`src/telemetry/observability-export.ts` extension. Unlocks Langfuse/Phoenix/W&B Weave for users.

### T12.11 — Kernel-level sandbox (Codex Seatbelt/Landlock) (2 weeks)

`src/sandbox/kernel-sandbox.ts` NEW backend. Faster, lighter, no Docker dep.

### T12.12 — Mastra Studio UI port inside desktop-app (2 weeks)

Mastra has 22k stars + 300k weekly downloads. WOTANN already has partial port (Observer/Reflector). Gap is Studio UI — port as dev-mode inside desktop-app.

### T12.13 — 10 curated OpenClaw skills (3200 LOC, 4-5 days)

Turing Pyramid, Capability Evolver, proactive-agent v3.1 (WAL Protocol + Working Buffer), elite-longterm-memory, agent-autonomy-kit, governance, compaction-ui-enhancements, context-engine, boost-prompt, ai-humanizer.

### T12.14 — Int32Array-backed TUI optimizer (Anthropic leak, 2 weeks)

50× perf win on `stringWidth` calls per leaked source.

### T12.15 — G-Eval + Ragas metrics + OWASP LLM Top 10 red-team (2 weeks)

`testing/g-eval.ts`, `memory/evals/ragas-metrics.ts`, `testing/owasp-llm-redteam.ts`. Makes WOTANN testable system.

### T12.16 — Modal + Fly.io sandbox backends (2 weeks)

`sandbox/modal-backend.ts` + `sandbox/flyio-backend.ts`. Cloud-sandbox WOTANN-Pro tier story.

### T12.17 — Jean Magic Commands palette (1200 LOC, 2 days)

Port 7 magic commands: Investigate Issue/PR/Workflow, Code Review with finding tracking, AI Commit Messages, PR Content Generation, Merge Conflict Resolution, Release Notes. WOTANN has primitives; curate as action palette.

### T12.18 — Jean WebSocket replay buffer (150 LOC, 1 day)

`daemon/src/transport/replay-buffer.ts`. 2000-event ring buffer with `seq` numbers. Mobile/Tailscale reconnect win. Their pattern: `WsEvent { json: Arc<str>, seq: u64 }`.

### T12.19 — Jean Execution Modes UI pivot (80 LOC, half day)

Plan/Build/Yolo as first-class modes. `execution-modes.ts`. Product-marketing win: "Plan mode by default, Yolo on demand."

### T12.20 — Coolify + Dokploy deploy-target adapters (3 days, 250 LOC each)

`src/adapters/coolify.ts` + `src/adapters/dokploy.ts`. Enables `wotann build → deploy` story.

### T12.21 — OpenCode (sst) provider adapter (300 LOC, 3 days)

Symmetric with existing 19 provider adapters. 147k★ project — too big to ignore.

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
