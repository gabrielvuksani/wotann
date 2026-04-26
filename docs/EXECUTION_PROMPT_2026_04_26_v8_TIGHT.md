# WOTANN — TIGHT EXECUTION PROMPT v8 (2026-04-26)

**Paste into a fresh Claude Code session running Opus 4.7 (1M ctx) with auto + bypass mode.**

---

## TASK

You are Claude Opus 4.7 (1M ctx) executing WOTANN V9 GA brutal-honesty post-correction round 2. The PREVIOUS session shipped a v7 brutal meta-audit (12 SHIP-BLOCKERS) + a v8 verification round (4 parallel meta-audits E/F/G/H). v8 confirmed 11 of 12 v7 SBs reproduce empirically, REFUTED 1 (visual-verifier flake), promoted 2 deferred items to SHIP-BLOCKERS, and discovered 1 new convergently-confirmed SHIP-BLOCKER (Tauri DMG ships without bundled daemon — desktop UI dead-on-arrival for download users). v8 also CORRECTED v7's "6 dead security defenses" claim — 5/6 ARE wired in production; only `embedWatermark` truly orphan.

**TIER 0 — Full day: ~70 LOC of fixes across 12 files makes V9 GA actually shippable. THESE ARE TODAY.**
**TIER 1+ — Multi-week cleanup follows.**

**Working directory**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann`
**HEAD baseline**: `1b37857` (v7 prompt + Engram saves + working-tree integrator state — confirm via `git log -1`)

---

## STEP 0 — RECOVERY (5 min)

Run in parallel:

```
mem_context project=wotann limit=40
mem_search project=wotann query="v8 brutal meta audit ship blockers tauri daemon bundling"
mem_search project=wotann query="JSON-RPC error codes tests codify bug -32603"
mem_search project=wotann query="wireGateway orphan single-fix unblocks 6 channels"
mem_search project=wotann query="META-AUDIT-F dead defenses correction 5 of 6 wired"
mem_search project=wotann query="Tailscale 6 users Unlimited devices keytar archived"
```

**READ THESE FILES IN FULL** (priority order — TIER 0 PRIMARY CONTEXT):

1. **`/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_26_BRUTAL_v8.md`** ← **PRIMARY EXECUTION CONTEXT** (~700 lines, single source of truth, supersedes v7)
2. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_26_BRUTAL_v7.md` (referenced for v7 SB-NEW-1..12 detail; v8 §1 abbreviates)
3. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md` (Quality Bars #1-16 + provider-neutrality directive)
4. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md`
5. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/RELEASE_INFRA.md`
6. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs`

**Optional reference (only if needed)**:
- `docs/EXECUTION_PROMPT_2026_04_26_v7_TIGHT.md` (v7 prompt — superseded by this v8)

---

## STEP 1 — PRE-FLIGHT (5 min)

```bash
git status --short              # confirm clean working tree (or known integrator state)
git log --oneline -5            # confirm HEAD = 1b37857 (or descendant)
npx tsc --noEmit 2>&1 | tail -5 # expect rc=0 for src/
cd desktop-app && npm run build 2>&1 | tail -5 ; cd ..  # expect rc=0
node scripts/v9-drift-check.mjs # expect 6/6 OK
npx vitest run --reporter=default 2>&1 | tail -5  # expect 9552 passing / 0 failing / 7 skipped
gh run list --limit 3 --json conclusion,displayTitle  # check CI state
find . -name '* 2.*' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | wc -l  # expect 0
npm audit --omit=dev 2>&1 | tail -3   # expect 0 vulns
cd desktop-app && npm audit 2>&1 | tail -5 ; cd ..
cd desktop-app/src-tauri && cargo audit 2>&1 | tail -5 ; cd ../..  # expect 0 active
```

If anything UNEXPECTED appears, STOP and report.

**Then run TIER 0 reproducers BEFORE fixing** (confirm bugs exist):

```bash
# SB-NEW-1: wotann run crashes (v7 carry — F-confirmed)
npx tsx src/index.ts run "test" 2>&1 | grep -i "require is not defined"
# Expect: ReferenceError: require is not defined at runtime.ts:5542

# SB-NEW-3: WOTANN_DEFAULT_PROVIDER ignored (v7 carry — F-confirmed)
WOTANN_DEFAULT_PROVIDER=ollama npx tsx -e "(async()=>{const{createRuntime}=await import('./src/core/runtime.ts');const rt=await createRuntime(process.cwd());console.log(rt.getStatus().activeProvider);})()"
# Expect: anthropic (NOT ollama — bug confirmed)

# SB-NEW-4: SQLite tables don't exist for the 5 stores (v7 carry)
ls ~/.wotann/*.db 2>/dev/null && sqlite3 ~/.wotann/memory.db ".tables" 2>/dev/null | tr ' ' '\n' | grep -E "^(approvals|sessions|deliveries|live_activities)$"
# Expect: NO matches (bug confirmed — stores silently in-memory only)

# SB-NEW-5: iOS restoreActivities never called (v7 carry)
grep -rn "restoreActivities" ios/ | grep -v "func restoreActivities\|//"
# Expect: NO matches outside definition

# SB-N1 (v8 NEW): wotann trust CLI not registered
grep -nE '"trust"|command\("trust' src/index.ts
# Expect: 0 hits (bug confirmed — function exists but no CLI registration)

# SB-N2 (v8 NEW): JSON-RPC error code violations
grep -n 'expect(parsed.error.code).toBe(-32603)' tests/mcp/mcp-server.test.ts
# Expect: hits at lines 131-138 (test ENCODES the bug)

# SB-N3 (v8 NEW): Tauri DMG no daemon bundling
grep -n "externalBin\|sidecar\|resources" desktop-app/src-tauri/tauri.conf.json
# Expect: 0 hits (no daemon bundling configured)

# NB-5 (v8 NEW): wireGateway itself orphan
grep -rn "wireGateway\b" src/ | grep -v "function wireGateway\|//"
# Expect: NO matches outside definition (single-fix unblocks 6 channel adapters)
```

---

## STEP 2 — TIER 0 EXECUTION (FULL DAY MAX)

These 9 fixes are blocking V9 GA shippability. Total ~70 LOC across 12 files.

### SB-NEW-1 fix: `wotann run` ESM crash (1 line)

**File**: `src/core/runtime.ts:5542`

**Before**:
```typescript
private knowledgeGraphPath(): string {
  const path = require("node:path") as typeof import("node:path");
  return path.join(this.config.workingDir, ".wotann", "knowledge-graph.json");
}
```

**After**:
```typescript
private knowledgeGraphPath(): string {
  // V7 SB-NEW-1 fix: package.json type:module — require is undefined.
  return join(this.config.workingDir, ".wotann", "knowledge-graph.json");
}
```

**Verify**: `npx tsx src/index.ts run "test" 2>&1 | grep -c "require is not defined"` → expect 0

### SB-NEW-2 fix: Ollama hardcoded `qwen3.5` (~10 LOC)

**Files**: `src/providers/ollama-adapter.ts:200` + `src/providers/model-router.ts:47-48`

**Strategy**: Replace literal default with `discoverOllamaModels()` first-result OR `PROVIDER_DEFAULTS["ollama"].defaultModel`.

**Verify**: `grep -n '"qwen3.5"\|"qwen3-coder-next"' src/providers/ollama-adapter.ts src/providers/model-router.ts` → expect NO matches (or only comments)

### SB-NEW-3 fix: Runtime overrides bootstrap provider (~5 LOC)

**File**: `src/core/runtime.ts:1953-1956`

**Before**:
```typescript
const firstProvider = providers[0];
if (firstProvider) {
  this.session = createSession(firstProvider.provider, firstProvider.models[0] ?? "auto");
  this.contextIntelligence.adaptToProvider(this.session.provider, this.session.model);
}
```

**After**:
```typescript
// V7 SB-NEW-3 fix: only override session when bootstrap had no resolution.
// Otherwise honor WOTANN_DEFAULT_PROVIDER / YAML / explicit env.
const bootstrapResolved = this.session.provider !== "" && this.session.provider !== "none";
const firstProvider = providers[0];
if (firstProvider && !bootstrapResolved) {
  this.session = createSession(firstProvider.provider, firstProvider.models[0] ?? "auto");
  this.contextIntelligence.adaptToProvider(this.session.provider, this.session.model);
}
```

**Verify**: 
```bash
WOTANN_DEFAULT_PROVIDER=ollama npx tsx -e "(async()=>{const{createRuntime}=await import('./src/core/runtime.ts');const rt=await createRuntime(process.cwd());console.log('activeProvider:',rt.getStatus().activeProvider);})()"
# Expect: activeProvider: ollama
```

### SB-NEW-4 fix: 5 SQLite store wires missing persistPath (5 LOC)

**Files**: `src/daemon/kairos-rpc.ts:930, 1005, 1021, 1046` + `src/desktop/companion-server.ts:841`

Specific edits:
- `kairos-rpc.ts:930` `new ComputerSessionStore()` → `new ComputerSessionStore({ persistPath: resolveWotannHomeSubdir("sessions.db") })`
- `kairos-rpc.ts:1005` `new ApprovalQueue()` → `new ApprovalQueue(undefined, resolveWotannHomeSubdir("approvals.db"))`
- `kairos-rpc.ts:1021` `new FileDelivery()` → `new FileDelivery({ persistPath: resolveWotannHomeSubdir("deliveries.db") })`
- `kairos-rpc.ts:1046` `new LiveActivityManager({ store: this.computerSessionStore })` → `new LiveActivityManager({ store: this.computerSessionStore, persistPath: resolveWotannHomeSubdir("live_activities.db") })`
- `companion-server.ts:841` `new LiveActivityHandler()` → `new LiveActivityHandler({ persistPath: resolveWotannHomeSubdir("live_activity_handler.db") })`

**Verify**:
```bash
wotann daemon start && sleep 2 && sqlite3 ~/.wotann/sessions.db ".tables" && sqlite3 ~/.wotann/approvals.db ".tables" && wotann daemon stop
# Expect: each shows the expected table name
```

### SB-NEW-5 fix: iOS LiveActivity restoration unwired (1-3 LOC)

**File**: `ios/WOTANN/WOTANNApp.swift:147-163`

**Add** to `wireServices()`:
```swift
// V7 SB-NEW-5 fix: rehydrate LiveActivity registry on cold-launch.
Task { @MainActor in
    await LiveActivityManager.shared.restoreActivities(client: connectionManager.rpcClient)
}
```

**Verify**: `grep -rn "restoreActivities" ios/ | grep -v "func restoreActivities\|//"` → expect 1+ caller in wireServices

---

### SB-N1 (v8 NEW): `wotann trust` CLI registration (~10 LOC)

**File**: `src/index.ts` (after other top-level command registrations)

**Add**:
```typescript
program
  .command("trust [path]")
  .description("Mark a workspace as trusted so CLAUDE.md / AGENTS.md / .cursorrules / .wotann/rules/* will load")
  .option("--list", "list currently trusted workspaces")
  .option("--revoke", "revoke trust for the given path")
  .action(async (path: string | undefined, opts: { list?: boolean; revoke?: boolean }) => {
    const { trustWorkspace, revokeWorkspaceTrust, listTrustedWorkspaces } = await import("./utils/trusted-workspaces.js");
    const target = path ?? process.cwd();
    if (opts.list) {
      const all = await listTrustedWorkspaces();
      console.log(JSON.stringify(all, null, 2));
      return;
    }
    if (opts.revoke) {
      await revokeWorkspaceTrust(target);
      console.log(`Trust revoked for ${target}`);
      return;
    }
    await trustWorkspace(target);
    console.log(`Workspace trusted: ${target}`);
  });
```

(If `revokeWorkspaceTrust` / `listTrustedWorkspaces` don't exist yet in trusted-workspaces.ts, add them — this is part of the SB-N1 fix.)

**Verify**:
```bash
npx tsx src/index.ts trust . && cat ~/.wotann/trusted-workspaces.json
# Expect: workspace path listed in JSON
npx tsx src/index.ts trust --list
# Expect: array including current dir
```

---

### SB-N2 (v8 NEW): JSON-RPC error code spec compliance (~30 LOC + tests)

**Files**: `src/mcp/mcp-server.ts` + `src/daemon/kairos-rpc.ts` + `tests/mcp/mcp-server.test.ts:131-163`

**Strategy**: Differentiate error categories at dispatch. Per JSON-RPC 2.0 spec:
- `-32700` parse error (existing)
- `-32600` invalid request (existing)
- `-32601` method-not-found (existing in kairos-rpc; ADD to mcp-server `default` arm)
- `-32602` invalid params (NEW — for missing/wrong param types)
- `-32603` internal error (RESERVED for true internal failures, NOT generic catch-all)
- `-32000..-32099` server-defined application errors (NEW — for handler-thrown exceptions)

**mcp-server.ts changes** (around lines 360-401, 465, 602-603):
1. `default` arm of dispatch (line 602-603): throw with code `-32601`, message `"Method not found: ${method}"`
2. `tools/call` missing `name` (line 465): throw with code `-32602`, message `"tools/call: name is required"`
3. Catch-all that currently uses `-32603`: introspect Error.code; if it's a JSON-RPC code, propagate; else use `-32000` for app errors and reserve `-32603` for true internal failures

**kairos-rpc.ts changes** (around lines 503-506, 1494-1499):
1. Add constant `RPC_INVALID_PARAMS = -32602`
2. Catch around `handler(...)` (line 1494-1499): differentiate validation errors (`-32602`) from app errors (`-32000`) from true internal (`-32603`)

**tests/mcp/mcp-server.test.ts changes** (lines 131-138 and 156-163):
- Update line 138: `expect(parsed.error.code).toBe(-32602)` (was -32603)
- Update line 156-163: add `expect(parsed.error.code).toBe(-32601)` (currently silent on code)
- Add new test for app-level handler errors expecting `-32000..-32099`

**Verify**:
```bash
# Method-not-found:
echo '{"jsonrpc":"2.0","id":1,"method":"unknown.method"}' | npx tsx src/mcp/mcp-server.ts 2>&1 | grep -o '"code":-32601'
# Expect: match

# Invalid params:
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{}}' | npx tsx src/mcp/mcp-server.ts 2>&1 | grep -o '"code":-32602'
# Expect: match

# Test suite:
npx vitest run tests/mcp/mcp-server.test.ts --reporter=default 2>&1 | tail -5
# Expect: passing
```

---

### SB-N3 (v8 NEW): Tauri DMG bundle daemon (Tauri config + sidecar.rs)

**Files**: `desktop-app/src-tauri/tauri.conf.json` + `desktop-app/src-tauri/src/sidecar.rs:73-117, 181-187`

**Strategy** — pick ONE of two paths:

**Option A (recommended)** — Compile daemon to single binary via `bun build --compile` or Node SEA, declare as `externalBin`:
```json
"bundle": {
  "active": true,
  "targets": ["dmg", "app"],
  "externalBin": ["binaries/wotann-daemon"],
  ...
}
```
Build pipeline: `bun build src/daemon/start.ts --compile --outfile=desktop-app/src-tauri/binaries/wotann-daemon-aarch64-apple-darwin` (and x86_64 variant). Tauri's `externalBin` requires platform-suffixed binaries.

Then update `sidecar.rs:source_dir`:
```rust
// V8 SB-N3 fix: prefer bundled sidecar binary first.
fn bundled_daemon_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve("binaries/wotann-daemon", BaseDirectory::Resource)
        .ok()
}
```
Call `bundled_daemon_path(&app)` BEFORE the existing source-dir resolution chain. If found, spawn the bundled binary directly; otherwise fall through to dev-mode source resolution.

**Option B (simpler, larger DMG)** — bundle raw `dist/daemon/` JS via `resources`:
```json
"bundle": {
  "active": true,
  "targets": ["dmg", "app"],
  "resources": ["../dist/daemon/**/*"],
  ...
}
```
Then update `sidecar.rs:source_dir` to look in `tauri::path::resource_dir()` first.

**Either way**: keep the dev-mode source-walk as a fallback for `npm run dev` workflows.

**Verify**:
```bash
cd desktop-app && npm run tauri build 2>&1 | tail -10
# Expect: bundle creation succeeds
ls -la src-tauri/target/release/bundle/macos/*.app/Contents/Resources/ 2>/dev/null | grep -E "daemon|binaries"
# Expect: bundled artifact present
```

Then install the .app to a clean Applications dir (no source clone) and verify it spawns the daemon successfully.

---

### NB-5 (v8 NEW): wireGateway registration unblocks 6 channel adapters (~5 LOC)

**File**: likely `src/daemon/kairos.ts` or wherever channel gateway is constructed

**Strategy**: Find the `wireGateway(...)` function definition and grep for its callers. If the function is genuinely orphan (never invoked), invoke it during gateway/channel-bus construction with the registry of 6 adapters: MastodonAdapter, WeChatAdapter, LineAdapter, ViberAdapter, DingTalkAdapter, FeishuAdapter.

**Verify**:
```bash
grep -rn "wireGateway\b" src/ | grep -v "function wireGateway\|//"
# Expect: 1+ caller after fix
# Then test channel listing:
npx tsx src/index.ts channels list 2>&1 | grep -E "mastodon|wechat|line|viber|dingtalk|feishu"
# Expect: at least one of these adapters appears in registered list
```

---

## STEP 3 — VERIFICATION (30 min)

After all 9 TIER 0 fixes:

```bash
# Type-check + build:
npx tsc --noEmit
cd desktop-app && npm run build && cd ..

# Full test suite:
npx vitest run --reporter=default 2>&1 | tail -5
# Expect: at minimum, no NEW failures vs baseline 9552

# Drift check:
node scripts/v9-drift-check.mjs

# Provider neutrality smoke (proves SB-NEW-1/2/3/6 all fixed):
for prov in anthropic ollama claude-cli openai; do
  echo "--- Testing $prov ---"
  WOTANN_DEFAULT_PROVIDER=$prov npx tsx -e "(async()=>{const{createRuntime}=await import('./src/core/runtime.ts');const rt=await createRuntime(process.cwd());console.log('  active:',rt.getStatus().activeProvider);})()"
done

# Daemon stores persist (proves SB-NEW-4 fixed):
rm -f ~/.wotann/sessions.db ~/.wotann/approvals.db ~/.wotann/deliveries.db ~/.wotann/live_activities.db ~/.wotann/live_activity_handler.db
wotann daemon start && sleep 2 && ls -la ~/.wotann/*.db && wotann daemon stop

# JSON-RPC compliance (proves SB-N2 fixed):
# Use the verifier scripts in /tmp/wotann-verify-2026-04-26/_verify_pass*.mts (left from META-AUDIT-H if present)

# Tauri bundle has daemon (proves SB-N3 fixed):
cd desktop-app && npm run tauri build 2>&1 | tail -5
ls -la src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null

# wireGateway wires adapters (proves NB-5 fixed):
npx tsx src/index.ts channels list 2>&1
```

If any verification fails, STOP and fix before proceeding.

---

## STEP 4 — COMMIT + PUSH (10 min)

```bash
git status --short
git add -p src/core/runtime.ts src/providers/ollama-adapter.ts src/providers/model-router.ts \
          src/daemon/kairos-rpc.ts src/desktop/companion-server.ts ios/WOTANN/WOTANNApp.swift \
          src/index.ts src/utils/trusted-workspaces.ts \
          src/mcp/mcp-server.ts src/daemon/kairos-rpc.ts tests/mcp/mcp-server.test.ts \
          desktop-app/src-tauri/tauri.conf.json desktop-app/src-tauri/src/sidecar.rs \
          src/daemon/kairos.ts

git commit -m "$(cat <<'EOF'
fix(v9): close 9 v8 SHIP-BLOCKERS — TIER 0 closure

v7 surfaced 12 SHIP-BLOCKERS. v8 confirmed 11 reproduce, REFUTED 1 (visual-verifier flake),
promoted 2 deferred items to SHIP-BLOCKER (trust CLI, JSON-RPC codes), discovered 1 NEW
convergently-confirmed SHIP-BLOCKER (Tauri DMG no daemon — desktop UI dead-on-arrival).

This commit closes 9 of the 14 v8 SHIP-BLOCKERS:
- SB-NEW-1: ESM require crash in runtime.ts:5542 → use `join` already imported
- SB-NEW-2: Ollama qwen3.5 hardcode → discoverOllamaModels OR PROVIDER_DEFAULTS
- SB-NEW-3: runtime overrides bootstrapProvider unconditionally → conditional override
- SB-NEW-4: 5 SQLite stores instantiated without persistPath → wire all 5 sites
- SB-NEW-5: iOS LiveActivity restoreActivities never invoked → wire in WOTANNApp.wireServices
- SB-N1: `wotann trust` CLI not registered → add program.command("trust [path]")
- SB-N2: JSON-RPC error codes spec violations → -32601/-32602/-32000-99 categorization
- SB-N3: Tauri DMG ships without bundled daemon → externalBin OR resources + sidecar.rs update
- NB-5: wireGateway orphan single-fix → wires 6 channel adapters

Verification: provider-neutrality smoke (4 providers), daemon stores persist as SQLite,
JSON-RPC malformed requests return correct codes, Tauri DMG includes daemon binary,
channel list includes 6 newly-wired adapters.

Carryover SBs (TIER 1): SB-NEW-6, SB-NEW-7, SB-NEW-8, SB-NEW-9, SB-NEW-10, SB-NEW-11.
META-AUDIT-E HIGH (TIER 1): H-E14..H-E18.
META-AUDIT-G web corrections (TIER 1): G-2 keytar archived → @napi-rs/keyring.
EOF
)"

git push origin HEAD
```

If push fails on hooks, FIX root cause (do not bypass with `--no-verify`).

---

## STEP 5 — TIER 1 BACKLOG (multi-day)

After TIER 0 closure:

1. **Cross-network Tailscale wave** (~1-2 days; v6/v7 carryover; v8 G-1 confirms 6 users / **Unlimited devices**)
2. **TUI v2 Phase 1+2 integration into App.tsx** (~5 days; v6/v7 carryover; Wave 6-NN+OO handed-off)
3. **iOS app-launch wiring batch 2**:
   - H-E14: `flushOnBackground` wire in `WOTANNApp.handleScenePhaseChange` `.background` case (~5 LOC)
   - H-E15: OfflineQueueDLQ Settings surface (~30 LOC view)
   - deepLink "approvals" PRODUCER (Wave 6-KK flagged; v6 carryover)
4. **SB-NEW-6 fallback chain model-preserve** (~20 LOC)
5. **SB-NEW-7 CANONICAL_FALLBACK fix** (~5 LOC)
6. **SB-NEW-8 cost-table coverage** azure/bedrock/sambanova/cerebras (~30 LOC)
7. **SB-NEW-10 cascading-fallback exit code** (~10 LOC)
8. **H-E16 watchOS DispatchView wire** (1 LOC NavigationLink in `WatchHomeView`)
9. **G-2 keytar → @napi-rs/keyring migration** (~50 LOC + tests; keytar archived 4+ years ago)
10. **NB-1 + NB-2 backend payload limits**: claude-cli E2BIG via stdin pipe; Codex 4.7MB single-call budget enforcement

## STEP 6 — TIER 2 THEATRICAL CLEANUP (multi-day)

11. **Delete 769 LOC confirmed dead code**:
    - `src/claude/channels/wotann-channel.ts` (343)
    - `src/claude/hardening/error-handler.ts` (183)
    - `src/marketplace/manifest.ts` (243; NOT `src/acp/manifest.ts` which is tested)
12. **Delete `src/ui/components/Sparkline.tsx`** (dead component despite Wave 6-NN landing)
13. **Resolve EditorLSPService duplicate** — delete `ios/WOTANN/Services/EditorLSPService.swift` (341 LOC); `EditorViewModel` already uses `EditorLSPBridge`
14. **4 ViewModel scaffolds decision** (Cost/Dispatch/Settings/TaskMonitor; ~364 LOC) — wire OR delete
15. **22 Tauri command orphans** (per L-E25; entire `remote_control` module + auxiliary commands)
16. **7 desktop-app component orphans** (per H-E24/M-E24; 2,291 LOC) — wire to AppShell or delete
17. **CrossDeviceService** — wire OR remove env injection (114 LOC; `WOTANNApp.swift:42,59`)
18. **Reduce v7 14,500 LOC theatrical claim by 2400 LOC** (5/6 dead defenses are actually wired per META-AUDIT-F; only `embedWatermark` truly orphan)
19. **NB-6 TOOL_CATALOG/dispatcher mismatch** — fix HashlineEdits surface declaration

## STEP 7 — TIER 3 TEST COVERAGE (multi-day)

20. Cover `src/agents` (6.79%), `src/auth` (9.16%), `src/voice` (30.36%) — security/business-critical
21. Add tests for 3 untested-but-live files: `loop-command.ts`, `self-improve.ts`, `config-migration.ts`
22. **NB-7**: regenerate `coverage/index.html` and commit fresh artifact summary

## STEP 8 — TIER 4 POLISH (1 day)

23. SB-NEW-9: fix "142 skills" claim in `src/mcp/mcp-server.ts:60` + commit log notes
24. NB-4 / G-4: cleanup `src/claude/types.ts:10` SDK v0.5.x stale reference
25. `mkdir 0o700` in 4 non-owned files (v6/v7 carryover)

## USER ACTIONS (parallel, no dev needed)
- Branch protection on main
- Apple signing secrets + NPM_TOKEN
- **Tauri auto-updater pubkey: G-7 confirms must inline PEM CONTENT (not file path)**

---

## QUALITY BARS (cumulative #1-18 — read these BEFORE coding)

#1: No vendor-biased `??` fallbacks — every default per-provider via PROVIDER_DEFAULTS
#2: Opt-in caps, not implicit limits
#3: Sonnet not Haiku for routine work; Opus for audits
#4: Never skip tasks — partial = honest stub > silent success
#5: Honest stubs over silent success (extends #4)
#6: Capability gating: advertise feature only when actually wired (Wave 5-DD pattern)
#7: Per-session state, not module-global
#8: HookResult.contextPrefix as injection channel
#9: Don't modify tests to make them pass; if test wrong, document why and fix in same commit
#10: Honest stub > silent success (CLI exit codes especially)
#11: Sibling-site scan: when fixing one usage, grep for parallel firing sites
#12: Singleton threading not parallel construction (ShadowGit pattern)
#13: Environment-dependent TEST-GATE logic breaks production code path coverage. Use strict string equality + mandatory NODE_ENV guard
#14: Commit messages are CLAIMS that need runtime verification — grep for real implementation BEFORE asserting "wired/fixed/implemented"
#15: H-37b co-conspirator pattern — when fixing source bug, update tests in SAME commit if they encode the bug
#16: Persistence test-isolation — default `persistPath = ":memory:"` for production-only data; explicit caller passes `~/.wotann/...`
#17 (NEW v8): Two-pass theatrical inventory — pass 1 grep, pass 2 trace-call from feature entry; pure-grep over-counts (5/6 v7 "dead defenses" were wired)
#18 (NEW v8): Convergent confirmation = highest confidence — when 2+ different audit methodologies surface the same finding, prioritize it over single-source claims

---

## EXECUTION DISCIPLINE

- **No more than 4 concurrent Opus 4.7 agents** (rate limit)
- **Every claim verified empirically** — no inference; QB#14 + #18
- **Honest stubs > silent success** — QB#5/#10
- **Sibling-site scan after every fix** — QB#11
- **Tests in SAME commit as source fix** — QB#15
- **Save progress to Engram with topic_key="wotann-v8-tier0-closure-2026-04-26"** after every TIER 0 fix
- **If a TIER 0 fix surfaces a NEW SHIP-BLOCKER**, document it in `docs/AUDIT_2026_04_26_BRUTAL_v8.md` §1 and continue
- **AUTO MODE active**: do not ask for clarification on TIER 0 spec; v8 audit is the spec
- **At end of session: append session-summary to v8 audit + write Engram session_summary**

---

## SUCCESS CRITERIA (TIER 0 done)

After STEP 4 commit pushed:
- [ ] `npx tsx src/index.ts run "test"` exits cleanly (SB-NEW-1)
- [ ] `WOTANN_DEFAULT_PROVIDER=ollama` produces `activeProvider: ollama` (SB-NEW-3)
- [ ] No `qwen3.5` literal in ollama-adapter.ts or model-router.ts (SB-NEW-2)
- [ ] All 5 SQLite store DB files exist after daemon startup (SB-NEW-4)
- [ ] `grep -rn "restoreActivities" ios/` shows caller in WOTANNApp.wireServices (SB-NEW-5)
- [ ] `npx tsx src/index.ts trust .` adds workspace to `~/.wotann/trusted-workspaces.json` (SB-N1)
- [ ] JSON-RPC method-not-found returns `-32601`, invalid-params returns `-32602`, app errors return `-32000..-32099` (SB-N2)
- [ ] tests/mcp/mcp-server.test.ts updated to assert correct codes (SB-N2 + QB#15)
- [ ] Tauri DMG bundle includes daemon artifact (SB-N3)
- [ ] `npx tsx src/index.ts channels list` includes 6+ new channel adapters (NB-5)
- [ ] Full vitest suite passes (no new failures vs 9552 baseline)
- [ ] Build green (TS + desktop-app + Tauri)

If ALL checkboxes pass: V9 GA is **shippable for solo / dogfood / friends-and-family use including DMG distribution**. Production-grade for non-Anthropic users still requires TIER 1 SB-NEW-6/7/8.

---

**END OF v8 PROMPT.** Generated 2026-04-26. Trust this v8 prompt over v7. Read `docs/AUDIT_2026_04_26_BRUTAL_v8.md` IN FULL before STEP 1.
