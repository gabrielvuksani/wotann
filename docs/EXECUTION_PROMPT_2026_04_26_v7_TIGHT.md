# WOTANN — TIGHT EXECUTION PROMPT v7 (2026-04-26)

**Paste into a fresh Claude Code session running Opus 4.7 (1M ctx) with auto + bypass mode.**

---

## TASK

You are Claude Opus 4.7 (1M ctx) executing WOTANN V9 GA brutal-honesty post-correction. The PREVIOUS session shipped 63 commits claiming V9 GA was "shippable for solo / dogfood / friends-and-family". A v7 BRUTAL meta-audit (4 parallel deep audits) revealed 12 NEW SHIP-BLOCKERS that the previous session MISSED, including: `wotann run` always crashes (1-line ESM bug), `WOTANN_DEFAULT_PROVIDER` env silently ignored, Ollama hardcoded to `qwen3.5`, 5 SQLite stores secretly in-memory only, iOS LiveActivity restoration shipped-but-never-invoked, 14,500 LOC theatrical scaffolding, 80 of 222 RPC handlers (36%) theatrical, 6 critical security defenses dead, "142 skills" claim is FALSE (actual: 89).

**TIER 0 — Half-day: 25 LOC of fixes makes V9 GA actually shippable. THESE ARE TODAY.**
**TIER 1+ — Multi-week cleanup follows.**

**Working directory**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann`
**HEAD baseline**: `90a69e7` (63 commits ahead of origin/main from `84bf741`; not yet pushed)

---

## STEP 0 — RECOVERY (5 min)

Run in parallel:

```
mem_context project=wotann limit=40
mem_search project=wotann query="v7 brutal meta audit 12 ship blockers theatrical"
mem_search project=wotann query="ollama-adapter qwen3.5 hardcoded runtime override"
mem_search project=wotann query="iOS LiveActivity restoreActivities not wired"
mem_search project=wotann query="5 SQLite stores persistPath missing"
```

**READ THESE FILES IN FULL** (priority order — TIER 0 PRIMARY CONTEXT):

1. **`/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_26_BRUTAL_v7.md`** ← **PRIMARY EXECUTION CONTEXT** (~700 lines, single source of truth, supersedes all prior audits)
2. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md` (Quality Bars #1-16 + provider-neutrality directive)
3. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md`
4. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/RELEASE_INFRA.md`
5. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs`

**Optional reference (only if needed)**:
- `docs/EXECUTION_PROMPT_2026_04_26_TIGHT.md` (v6 prompt — superseded by this v7)
- v6 + v5 SYNTHESIZED audits (gitignored, on disk only)

---

## STEP 1 — PRE-FLIGHT (5 min)

```bash
git status --short              # confirm clean working tree (or known integrator state)
git log --oneline -5            # confirm HEAD = 90a69e7
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

**Then run TIER 0 reproducers BEFORE fixing** (verify the bugs are real):

```bash
# SB-NEW-1: wotann run crashes
npx tsx src/index.ts run "test" 2>&1 | grep -i "require is not defined"
# Expect: ReferenceError: require is not defined at runtime.ts:5542

# SB-NEW-3: WOTANN_DEFAULT_PROVIDER ignored
WOTANN_DEFAULT_PROVIDER=ollama npx tsx -e "(async()=>{const{createRuntime}=await import('./src/core/runtime.ts');const rt=await createRuntime(process.cwd());console.log(rt.getStatus().activeProvider);})()"
# Expect: anthropic (NOT ollama — bug confirmed)

# SB-NEW-4: SQLite tables don't exist for the 5 stores
ls ~/.wotann/*.db 2>/dev/null && sqlite3 ~/.wotann/memory.db ".tables" 2>/dev/null | tr ' ' '\n' | grep -E "^(approvals|sessions|deliveries|live_activities)$"
# Expect: NO matches (bug confirmed — stores silently in-memory only)

# SB-NEW-5: iOS restoreActivities never called
grep -rn "restoreActivities" ios/ | grep -v "func restoreActivities\|//"
# Expect: NO matches (only definition, no callers — bug confirmed)
```

---

## STEP 2 — TIER 0 EXECUTION (HALF-DAY MAX)

These 5 fixes are blocking V9 GA shippability. Total ~25 LOC across 7 files.

### SB-NEW-1 fix: `wotann run` ESM crash (1 line)

**File**: `src/core/runtime.ts:5542`

**Before**:
```typescript
private knowledgeGraphPath(): string {
  // Late-require node:path to avoid a top-level import churn.
  // Safe inside WotannRuntime methods (always runs in Node).
  const path = require("node:path") as typeof import("node:path");
  return path.join(this.config.workingDir, ".wotann", "knowledge-graph.json");
}
```

**After**:
```typescript
private knowledgeGraphPath(): string {
  // V7 SB-NEW-1 fix: package.json type:module — require is undefined.
  // Use the `join` already imported at runtime.ts:103.
  return join(this.config.workingDir, ".wotann", "knowledge-graph.json");
}
```

**Verify**:
```bash
npx tsx src/index.ts run "test" 2>&1 | grep -c "require is not defined"
# Expect: 0
```

### SB-NEW-2 fix: Ollama hardcoded `qwen3.5` (~10 LOC)

**Files**: `src/providers/ollama-adapter.ts:200` + `src/providers/model-router.ts:47-48`

**Strategy**: Replace literal default with `discoverOllamaModels()` first-result OR `PROVIDER_DEFAULTS["ollama"].defaultModel = "gemma4:e4b"`.

**Verify**:
```bash
grep -n '"qwen3.5"\|"qwen3-coder-next"' src/providers/ollama-adapter.ts src/providers/model-router.ts
# Expect: NO matches (or only comments)
```

### SB-NEW-3 fix: Runtime overrides bootstrap provider (~5 LOC)

**File**: `src/core/runtime.ts:1953-1956`

**Strategy**: Only call `createSession(firstProvider.provider, ...)` when `bootstrapProvider` resolution returned null (i.e., the constructor already gave up). Otherwise honor the bootstrap.

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

**Pattern**: `new XStore()` → `new XStore({ persistPath: resolveWotannHomeSubdir("xstore.db") })`

Specific edits:
- `kairos-rpc.ts:930` `new ComputerSessionStore()` → `new ComputerSessionStore({ persistPath: resolveWotannHomeSubdir("sessions.db") })`
- `kairos-rpc.ts:1005` `new ApprovalQueue()` → `new ApprovalQueue(undefined, resolveWotannHomeSubdir("approvals.db"))` (signature is `(maxSize?, persistPath?)`)
- `kairos-rpc.ts:1021` `new FileDelivery()` → `new FileDelivery({ persistPath: resolveWotannHomeSubdir("deliveries.db") })`
- `kairos-rpc.ts:1046` `new LiveActivityManager({ store: this.computerSessionStore })` → `new LiveActivityManager({ store: this.computerSessionStore, persistPath: resolveWotannHomeSubdir("live_activities.db") })`
- `companion-server.ts:841` `new LiveActivityHandler()` → `new LiveActivityHandler({ persistPath: resolveWotannHomeSubdir("live_activity_handler.db") })`

**Verify**:
```bash
# Start daemon, then check SQLite tables exist:
wotann daemon start && sleep 2 && sqlite3 ~/.wotann/sessions.db ".tables" && sqlite3 ~/.wotann/approvals.db ".tables" && wotann daemon stop
# Expect: each shows the expected table name
```

### SB-NEW-5 fix: iOS LiveActivity restoration unwired (1-3 LOC)

**File**: `ios/WOTANN/WOTANNApp.swift:147-163`

**Add** to `wireServices()`:
```swift
private func wireServices() {
    clipboardService.startMonitoring()
    connectionManager.autoDiscover()
    maybePresentDiagnosticDumpAtLaunch()
    // V7 SB-NEW-5 fix: rehydrate LiveActivity registry on cold-launch.
    Task { @MainActor in
        await LiveActivityManager.shared.restoreActivities(client: connectionManager.rpcClient)
    }
}
```

**Verify** (compile + grep):
```bash
xcodebuild -list -project ios/WOTANN.xcodeproj 2>&1 | grep -E "Targets|Schemes" | head -5
grep -A 1 "wireServices" ios/WOTANN/WOTANNApp.swift | grep restoreActivities
# Expect: line shows the new call
```

### After all 5 TIER 0 fixes — VERIFY:

```bash
npx tsc --noEmit 2>&1 | tail -5      # rc=0
npx vitest run --reporter=default 2>&1 | tail -5  # 9552+ passing
WOTANN_DEFAULT_PROVIDER=ollama npx tsx -e "..."  # activeProvider=ollama
npx tsx src/index.ts run "test" 2>&1 | head -3   # no require error
```

**Commit atomically per fix** (5 commits) so revert is surgical.

---

## STEP 3 — TIER 1 (1-2 weeks after TIER 0)

Per v7 audit §9 priority list:

### TIER 1 — Cross-network Tailscale wave (~1-2 days)

Per v6 prompt + connectivity research roadmap (audit synthesized doc §2.C):
- Phase 1: NEW `src/desktop/tailscale-detector.ts` (~80 LOC) + companion-server bind to 0.0.0.0 when Tailscale detected
- Phase 2: DELETE `ios/WOTANN/Networking/SupabaseRelay.swift` (555 LOC) + remove ConnectionManager observers
- Phase 3: DELETE `src/desktop/supabase-relay.ts` (405 LOC) + remove kairos.ts wires
- Phase 4: NEW `src/desktop/cross-network-hint.ts` + `wotann remote-setup` CLI
- Phase 5 (optional): Cloudflare Tunnel sidecar
- Phase 6: tests + manual cellular smoke

### TIER 1 — TUI v2 Phase 1+2 integration into App.tsx (~5 days)

Wave 6-NN+OO built ~1900 LOC of TUI v2 components, NONE imported by App.tsx (3413 LOC). Wire:
- `motif moments` (animations.ts) — trigger at session-start/end/error/success
- `Sparkline` — render in StatusBar line 2
- `accessibility` — gate decorative animations
- `mouse OSC 1006` — useMouseEvents hook
- `RavensFlight` — render during long ops
- `SigilStamp` — render at session events
- `sound cues` — optional BEL
- `colorblind palette` — verify env detection

### TIER 1 — iOS app-launch wiring (~1 day, in addition to TIER 0 SB-NEW-5)

- OfflineQueue.flushOnBackground in `handleScenePhaseChange(.background)`
- Push notification handler for `appState.deepLinkDestination = "approvals"`

### TIER 1 — `wotann trust [path]` CLI (~1 hour)

Per v6 prompt — register the command in src/index.ts using existing trustWorkspace() API.

### TIER 1 — Remaining provider-neutrality fixes:
- SB-NEW-6: fallback chain model-preserve (`agent-bridge.ts:179-183`, ~20 LOC)
- SB-NEW-7: CANONICAL_FALLBACK fix or `index.ts:5523` providerHint (~5 LOC)
- SB-NEW-8: cost-table coverage for azure/bedrock/sambanova/cerebras (~30 LOC)
- SB-NEW-10: `wotann run` cascading-fallback exit code (~10 LOC)

---

## STEP 4 — TIER 2 (theatrical code cleanup, ~3 days)

Per v7 audit §2:

### Delete ~14,500 LOC theatrical (after security-team sign-off):

**TS src/ (~9,000 LOC)**:
- `src/intelligence/kg-builder.ts` (1005)
- `src/observability/{openinference,otel-exporter}.ts` (997)
- `src/optimize/textgrad-{optimizer,critic,types}.ts` (~940)
- `src/orchestration/meta-harness.ts` (715)
- `src/orchestration/jean-orchestrator.ts` + jean-registries (~600)
- `src/connectors/{notion,jira,linear,google-drive,connector-webhook-server}.ts` (1699)
- `src/ui/{accessibility,string-width-cache,animations}.ts` (1068) **OR wire into App.tsx — TIER 1**
- `src/tools/{aux-tools,hashline-edits}.ts` (1091)
- `src/core/wotann-yml.ts` (410)
- `src/evals/ragas-metrics.ts` (259)
- `src/daemon/auto-update.ts` (211)

**iOS Swift (~1,882 LOC)**:
- `ios/WOTANN/Services/CarPlayService.swift` (674)
- `ios/WOTANN/Services/DuplexVoiceSession.swift` (514)
- `ios/WOTANN/Services/EditorLSPService.swift` (341)
- `ios/WOTANN/Views/Pairing/PairingProviderConfig.swift` (353)

**6 unwired channel adapters (1518 LOC)**:
- Mastodon, WeChat, Line, Viber, DingTalk, Feishu

### WIRE 6 critical security defenses (or delete with sign-off):

- `PluginScanner.scanPlugin()` — call from src/plugins/manager.ts before each plugin load
- `HashAuditChain.append()` — call from every privileged action in RPC handlers
- `sanitizeUrlForPrompt` — wire into all paths putting URLs into LLM prompts
- `decodeAndScanForInjection` — wire into prompt-injection-quarantine.ts
- `PrivacyRouter.*` methods — invoke from provider selection in core/runtime.ts
- `embedWatermark` — wire into LLM completion path if anti-distillation is real product req

### Delete 80 theatrical RPC handlers (audit each against V9 master plan first)

---

## STEP 5 — TIER 3 (test coverage to 80%, ~3-5 days)

Per v7 audit §4:

- Cover `src/agents` (6.79% lines) — security/business-critical
- Cover `src/auth` (9.16% lines) — security review priority
- Cover `src/voice` (30.36% lines) — mock heavy IO
- Cover `src/desktop` (46.98% lines) — Tauri integration
- Cover `src/daemon` (37.44% lines) — daemon lifecycle
- 18 source files at 0% — easy wins (~1500 LOC combined)
- Mock visual-verifier subprocess to fix coverage flake (SB-NEW-12)
- Add Top-10 owed integration tests per v6 §5.C

---

## STEP 6 — TIER 4 (polish, ~1 day)

- SB-NEW-9: fix "142 skills" → "89 skills" in mcp-server.ts:60 + Engram update
- SB-NEW-12: visual-verifier mock or 15s timeout
- mkdir 0o700 in 4 non-owned files
- bridge-deps.ts:253 explicit shouldZeroForSubscription
- 30+ docs stale numbers sweep

---

## HARD SAFETY RULES (NON-NEGOTIABLE)

1. **OPUS 4.7 for every subagent** — never Sonnet, never Haiku
2. **Whole-file ownership** — never two agents touching same file
3. **Never `git commit --amend` in parallel-agent contexts**
4. **Never `git add .`** — always `git commit -- <path>`
5. **Never skip hooks** (`--no-verify` forbidden)
6. **Never force-push** to origin/main
7. **Never modify tests to make them pass** UNLESS H-37b co-conspirator pattern
8. **QB#15**: verify source before claiming
9. **QB#14**: commit message claims need runtime verification
10. **QB#6**: honest stubs not silent success
11. **QB#7**: per-instance state, not module-global
12. **QB#11**: sibling-site scan before claiming wired
13. **QB#16 (NEW v6)**: persistence layers default to test-isolation
14. **Provider neutrality (Gabriel directive)**: nothing should be hardcoded claude
15. **Verify after each agent before continuing** (Gabriel directive)
16. **NEW v7**: EMPIRICALLY EXERCISE the runtime to verify design holds end-to-end. Structural audits are insufficient. Run integration smokes per provider.
17. **NEW v7**: Track "deferred integration" items in a separate todo list during agent dispatch; integrator wave at end of each wave-batch must close them.
18. **NEW v7**: Every commit-message numerical claim must be backed by `grep`/`wc -l` evidence in commit body.

---

## STOP CONDITIONS

STOP and ask user if:
- TIER 0 fix breaks an existing test (could be H-37b co-conspirator OR real regression)
- Disk <5Gi mid-phase
- Test regresses after 3 different fix approaches
- Security finding requires product-level decision
- Anthropic publishes new policy affecting Tier 3 Claude sub path
- Any destructive operation needed (rm -rf outside well-known artifacts, force-push)
- API rate-limit ceiling hit (5-hour cap) — harvest partials, wait for reset
- 14,500 LOC deletion needs security-team sign-off (do not blanket-delete defenses without explicit OK)
- Cross-network Tailscale wave needs decision: ALSO build Cloudflare Tunnel, or defer Phase 5?
- iOS testing needs real cellular device (per `feedback_device_awareness.md`)

---

## SUCCESS CRITERIA

V9 GA SHIPPABLE = ALL TIER 0 closed:
- [ ] SB-NEW-1: `wotann run` succeeds (or fails with provider-config message, not require error)
- [ ] SB-NEW-2: Ollama uses installed model, not hardcoded qwen3.5
- [ ] SB-NEW-3: `WOTANN_DEFAULT_PROVIDER=ollama` → activeProvider=ollama
- [ ] SB-NEW-4: 5 SQLite tables present after daemon restart cycle
- [ ] SB-NEW-5: iOS LiveActivity restoreActivities called on cold-launch (verified via grep)
- [ ] tsc rc=0 + 9552+ tests passing + drift-check 6/6 OK

V9 GA + Tailscale = TIER 0 + TIER 1 closed.

V9 GA + cleanup = TIER 0 + 1 + 2 closed (deletes ~14,500 LOC).

V9 GA + 80% coverage = all TIERs closed.

---

## TL;DR ONE-LINER

```
mem_context project=wotann && \
node scripts/v9-drift-check.mjs && \
Read docs/AUDIT_2026_04_26_BRUTAL_v7.md && \
Execute TIER 0 (SB-NEW-1 through SB-NEW-5; ~25 LOC across 7 files; half-day) FIRST. \
Verify each fix EMPIRICALLY (run the reproducer commands in STEP 1). \
Commit atomically per fix. THEN execute TIER 1+ per v7 audit §9.
```

The v7 BRUTAL audit (~700 lines) is the single source of truth. v6, v5, v4, v3 are all SUPERSEDED. Trust v7 over earlier audits.

— Generated 2026-04-26 after 4 parallel meta-audits surfaced 12 NEW SHIP-BLOCKERS the previous session missed. TIER 0 is half-day; full TIER 0+1 is 2 weeks; full TIER 0-4 is 4-5 weeks.
