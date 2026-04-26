# WOTANN — Tight Execution Prompt v6 (2026-04-26)

**Paste this into a fresh Claude Code session running Opus 4.7 (1M ctx) with auto + bypass mode.**

---

## TASK

You are Claude Opus 4.7 (1M ctx) continuing WOTANN V9 GA hardening. V9 GA implementation is COMPLETE per `docs/AUDIT_2026_04_26_SYNTHESIZED.md` (v6). The codebase shipped 63 commits last session covering 12 waves + DEHARDCODE + Skills→MCP-prompts + integrator fixes. This session focuses on the Tier-1 follow-ups + Tailscale wave (single biggest functional gap).

**Working directory**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann`
**HEAD baseline**: `d53e1a6` (63 commits ahead of origin/main from `84bf741`; not yet pushed)

---

## STEP 0 — RECOVERY (5 min)

Run in parallel:

```
mem_context project=wotann limit=40
mem_search project=wotann query="V9 GA wave 6 6.5 6.7 6.9 6.99 dehardcode complete"
mem_search project=wotann query="cross-network supabase relay theatrical tailscale"
mem_search project=wotann query="skills mcp prompts wave 6.9 drop"
```

Then **READ THESE FILES IN FULL** (priority order):

1. **`/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUDIT_2026_04_26_SYNTHESIZED.md`** ← **PRIMARY EXECUTION CONTEXT** (~600 lines, single source of truth, deduplicated from v5 + session deltas)
2. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md` (Quality Bars #1-16, project rules)
3. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md` (AAIF compliance)
4. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/RELEASE_INFRA.md` (USER ACTION checklist)
5. `/Users/gabrielvuksani/Desktop/agent-harness/wotann/scripts/v9-drift-check.mjs`

**Optional reference (only if needed)**: previous session's audit at `docs/AUDIT_2026_04_25_SYNTHESIZED.md` (v5, accretive — do NOT use as primary)

---

## STEP 1 — PRE-FLIGHT (5 min)

```bash
git status --short              # confirm clean working tree (or known integrator state)
git log --oneline -5            # confirm HEAD = d53e1a6
npx tsc --noEmit 2>&1 | tail -5 # expect rc=0 for src/
cd desktop-app && npm run build 2>&1 | tail -5 ; cd ..  # expect rc=0
node scripts/v9-drift-check.mjs # expect 6/6 OK
npx vitest run --reporter=default 2>&1 | tail -5  # expect 9544+ passing / 1 flaky / 7 skipped
gh run list --limit 3 --json conclusion,displayTitle  # check CI state on origin
find . -name '* 2.*' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | wc -l  # expect 0 (Wave 0 sweep)
npm audit --omit=dev 2>&1 | tail -3   # expect 0 vulns
cd desktop-app && npm audit 2>&1 | tail -5 ; cd ..  # expect 0 vulns (Wave 3-T closed via dompurify override + npm audit fix)
cd desktop-app/src-tauri && cargo audit 2>&1 | tail -5 ; cd ../..  # expect 0 active (rustls-webpki 0.103.13 closed)
npx tsx src/index.ts doctor      # expect 7/9 green; daemon not running + stale PID typical
```

If anything UNEXPECTED appears, STOP and report.

---

## STEP 2 — TIER-ORDERED EXECUTION

Per the v6 synthesized audit §8 next-session pointers, execute in priority order. Tier 1 first; do not start Tier 2 until Tier 1 is fully green-and-committed.

### TIER 1 — Cross-network (SB-23 Tailscale wave) — ~1-2 days

**Why first**: closes the biggest functional gap. Phone-on-cellular currently shows green "Remote Bridge" status pill while data plane has zero flow (Supabase Relay is theatrical — 0 production callers in 405 LOC TS + 555 LOC Swift).

**Investigation report (delivered last session, key findings):**
- Supabase Realtime free tier: 200 concurrent / 100 msg/s / 256 KB payload / 5 GB monthly egress shared with project
- Tailscale Personal: 6 users / unlimited devices / unmetered bandwidth / 95% direct P2P via STUN, DERP fallback
- WOTANN's own internal docs already named Tailscale: `MASTER_PLAN_V9.md:3083-3085`, `ANDROID_TAURI.md:156`, `archive/COMPETITOR_APP_RESEARCH_2026-04-03.md:663-672`

**Implementation roadmap** (from investigation report):

#### Phase 1 — Auto-detection and CompanionServer binding (~4-6 hours)
1. NEW `src/desktop/tailscale-detector.ts` (~80 LOC):
   - `detectTailscale(): { installed: boolean; ip: string | null; magicDnsHostname: string | null }`
   - macOS: `tailscale ip -4` + `tailscale status --json`
   - Linux/Windows: similar + interface enumeration probing 100.64.0.0/10
   - Cached for 60s
2. EDIT `src/desktop/companion-server.ts:782-820`:
   - When Tailscale detected and `WOTANN_COMPANION_HOST` unset: default to `0.0.0.0` (instead of `127.0.0.1`)
   - Log: `"Tailscale detected — binding to all interfaces; phone can reach via <magicdns-hostname>"`
   - Update line 810 security warning to NOT fire when broader binding is justified by Tailscale presence
3. EDIT `src/desktop/companion-server.ts:550 generateQRData`:
   - Include MagicDNS hostname when available
   - Fallback to LAN IP otherwise
   - iOS tries Tailscale hostname first → falls back to LAN

#### Phase 2 — iOS RPCClient cleanup (~2-4 hours)
4. DELETE `ios/WOTANN/Networking/SupabaseRelay.swift` (555 LOC)
5. DELETE Supabase fields/observers from `ios/WOTANN/Networking/ConnectionManager.swift` (lines 45, 102-138, 154-164, 274, 289, 422, 446) — about 60 LOC
6. EDIT `ConnectionManager.swift:47-55`: remove `.relay = "Remote Bridge"` enum or rename to `.tailscale = "Tailscale"`
7. EDIT `ios/WOTANN/Security/KeychainManager.swift:13`: remove `.relayConfig` slot
8. EDIT `ios/WOTANN/Views/Settings/SettingsView.swift:168`: remove manual Supabase paste UI

#### Phase 3 — Desktop cleanup (~1 hour)
9. DELETE `src/desktop/supabase-relay.ts` (405 LOC)
10. EDIT `src/daemon/kairos.ts:30, 234, 671-677, 1256-1258`: remove SupabaseRelay import, field, instantiation, getter
11. EDIT `src/desktop/companion-server.ts:73, 1875-1916, 1939`: remove RelayConfig import + `relay:` block from config.sync RPC

#### Phase 4 — UX hint and onboarding (~2-3 hours)
12. NEW `src/desktop/cross-network-hint.ts` (~50 LOC): if phone IP not in any local subnet AND Tailscale not detected → surface actionable hint: "Phone is not on your local network. Install [Tailscale](https://tailscale.com/download/ios) on phone and desktop for free remote access — no router config needed."
13. EDIT `src/index.ts` CLI: add `wotann remote-setup` command — print Tailscale install URL + one-liner curl install for desktop + Tailscale auth key for QR pairing

#### Phase 5 — Optional Cloudflare Tunnel sidecar (defer if Phase 1-4 ships fast) (~3-5 days)
14-17. Bundle cloudflared as Tauri sidecar; new RPC method companion.tunnel.create; persist tunnel UUID to ~/.wotann/tunnel.json; UI toggle for "Allow remote access via Cloudflare"

#### Phase 6 — Verification (mandatory before claiming done — QB #15)
18. NEW `tests/desktop/tailscale-detector.test.ts`: mock interface enumeration
19. NEW integration test: spin up CompanionServer with `0.0.0.0` binding, connect from second WS client over localhost, assert RPC round-trip
20. Manual cross-network test from real iOS device on cellular (per `feedback_device_awareness.md` — never assume simulator)
21. Update `docs/MASTER_PLAN_V9.md` Tier 11: Tailscale DONE, Supabase relay DELETED
22. Save lessons to Engram under `topic_key: cases/cross-network-connectivity` per WAL Protocol

**Total Tailscale wave: ~2 days** (defer Cloudflare Tunnel sidecar to Phase 5+ if needed).

---

### TIER 1 — TUI v2 Phase 1 + 2 integration into App.tsx (~5 days)

Wave 6-NN built motif moments + Sparkline + accessibility helpers. Wave 6-OO built mouse OSC 1006 + RavensFlight + SigilStamp + sound + colorblind palette. ALL exported but NOT consumed by `src/ui/App.tsx` (3413 LOC).

**Files to wire:**
- `src/ui/App.tsx` — import + use:
  * `motif moments`: trigger at session-start/end/error/success
  * `Sparkline`: render in StatusBar line 2 (cost-per-hour or tokens-per-minute)
  * `accessibility`: gate decorative animations on `WOTANN_SCREEN_READER` / `WOTANN_REDUCE_MOTION`
  * `mouse OSC 1006`: useMouseEvents hook for click-to-focus
  * `RavensFlight`: render during long-running operations
  * `SigilStamp`: render at session-start, success, error
  * `sound cues`: optional BEL on key events (gated by `WOTANN_SOUND_CUES=1`)
  * `colorblind palette`: ThemeManager already wires; verify env detection

**Approach**: dispatch ≤4 Opus agents in parallel; each owns one or two components' integration. App.tsx is large; use Edit tool with targeted old_string anchors.

---

### TIER 1 — iOS app-launch wiring (~1 day)

Wave 6-LL built LiveActivity restoration + OfflineQueue background flush. Wave 6-KK built deepLink consumer for "approvals". All ready but not connected.

**Files to wire (ios/WOTANN/WOTANNApp.swift):**
1. In `wireServices()` (or equivalent app-launch method): call `liveActivityManager.restoreActivities(client: rpcClient)`
2. In `handleScenePhaseChange(.background)`: call `offlineQueueService.flushOnBackground(using: rpcClient)`
3. Push notification handler: when notification.category == "approvals.notify", set `appState.deepLinkDestination = "approvals"` (the consumer at MainShell.swift:114-125 will then auto-open the sheet)

---

### TIER 2 — `wotann trust [path]` CLI (~1 hour)

Wave 6.5-XX created `trustWorkspace()` API at `src/utils/trusted-workspaces.ts` but the CLI command is STUB. Production users have no UX to trust their workspace; only env override (WOTANN_WORKSPACE_TRUST_OFF=1) works.

**Edit `src/index.ts`** — add command (similar pattern to existing commands):
```typescript
program
  .command("trust [path]")
  .description("Trust this workspace for auto-loading instruction files (CLAUDE.md, AGENTS.md, .cursorrules)")
  .option("--remove", "Remove from trusted list")
  .action(async (path: string | undefined, opts: { remove?: boolean }) => {
    const target = resolve(path ?? process.cwd());
    if (opts.remove) {
      await untrustWorkspace(target);
      console.log(chalk.green(`✓ Removed trust for ${target}`));
    } else {
      await trustWorkspace(target);
      console.log(chalk.green(`✓ Trusted ${target}`));
      console.log(chalk.dim("  Workspace instruction files (CLAUDE.md, AGENTS.md, .cursorrules) will now auto-load."));
    }
  });
```

Update `docs/RELEASE_INFRA.md` to mention this command.

---

### TIER 2 — Coverage baseline (~2 hours)

Wave 6.99-AP added `"coverage": "vitest run --coverage"` script. Never run. Run it now:

```bash
npm install --save-dev @vitest/coverage-v8  # if not installed
npm run coverage
```

Establish baseline %. Surface in README's "By the Numbers" section. Identify lowest-coverage modules + add to TIER 3 as "owed coverage".

---

### TIER 2 — SB-22 mcp.add validation (~80 LOC)

`src/daemon/kairos-rpc.ts:4419-4445` — `mcp.add` accepts arbitrary `{name, command, args, transport}` and writes to `wotann.yaml` with `enabled:true`. Zero validation.

**Fix:**
- Allowlist for `command`: must be in PATH OR absolute path under `/usr/local/bin`/`/opt/homebrew/bin`
- Allowlist for `transport`: must be enum value (`"stdio"` | `"sse"` | `"http"` etc.)
- Sanitize `name`: reject `__proto__`, `constructor`, `prototype`, `..`, `/`, etc.
- Default `enabled: false`; require explicit user opt-in via separate `mcp.enable` RPC

---

### TIER 2 — SB-21 wotann cost preview CLI (~120 LOC)

`predictCost()` exists in `src/telemetry/cost-tracker.ts`. CLI surface owed:

```typescript
program
  .command("cost preview <prompt...>")
  .description("Preview cost of a prompt before executing")
  .option("--model <model>", "Model to use (default: tier 'strong')")
  .option("--provider <provider>", "Provider (default: active)")
  .action(async (prompt: string[], opts) => {
    const text = prompt.join(" ");
    const tracker = new CostTracker();
    const prediction = tracker.predictCost(text, opts.provider, opts.model);
    console.log(`Predicted: ${prediction.estimatedTokens} tokens, $${prediction.estimatedCost.toFixed(4)}`);
    console.log(prediction.recommendation);
  });
```

---

### TIER 3 — Wave 3-S follow-up symlink sites (~3 days)

7 sites flagged for safeWriteFile pattern (per v6 audit §2.D):
- src/tools/hashline-edits.ts:396, 435 (parent-only realpath gap, leaf still vulnerable)
- src/connectors/connector-writes.ts:973
- src/learning/skill-forge.ts:393, 536
- src/learning/self-evolution.ts:161
- src/lsp/symbol-operations.ts:679
- src/ui/canvas.ts:170
- src/ui/diff-engine.ts:356
- src/core/runtime.ts:6935

Pattern: replace `writeFileSync(path, content)` with `safeWriteFile(path, content)` from `src/utils/path-realpath.ts` (Wave 3-S helper).

---

### TIER 3 — mkdir 0o700 in 4 non-owned files (~1 hour)

Per v6 audit §2.E. Files: src/auth/login.ts, src/core/workspace.ts, src/daemon/start.ts, src/learning/dream-runner.ts. Add `{ mode: 0o700 }` to mkdirSync sites that create wotann-home or sensitive dirs.

---

### TIER 3 — Top-10 owed integration tests (~3 days)

Per v6 audit §5.C. Closes audit H-38a partially. Highest priority: companion-pair-local-auth (closes SB-1 explicitly).

---

### TIER 4 — Stale numbers in 30+ docs (~2 hours)

Per v6 audit §3.A. Bulk sed + manual verify in CHANGELOG.md, design-brief/, docs/AUDIT_*, docs/MASTER_PLAN_V*, docs/SESSION_*, docs/POST_COMPACTION_HANDOFF_*.

---

### TIER 4 — bridge-deps.ts:253 explicit shouldZeroForSubscription wrap (~10 min)

Per v6 audit §2.F. `tracker.record("anthropic", "claude-subscription", ...)` already $0 by accident; wrap with explicit `shouldZeroForSubscription("anthropic", "subscription")` call.

---

## STEP 3 — HARD SAFETY RULES (NON-NEGOTIABLE — same as v5)

1. **OPUS 4.7 for every subagent dispatched** — never Sonnet, never Haiku
2. **Whole-file ownership** — never two agents touching same file concurrently
3. **Never `git commit --amend` in parallel-agent contexts**
4. **Never `git add .` or `git add -A`** — always `git commit -- <path>`
5. **Never skip hooks** (`--no-verify` forbidden)
6. **Never force-push** to origin/main
7. **Never modify tests to make them pass** UNLESS the test pinned an OLD contract that source intentionally moved forward (H-37b co-conspirator pattern; document in commit message)
8. **Quality Bar #15**: verify source before claiming
9. **Quality Bar #14**: commit message claims need runtime verification
10. **Quality Bar #6**: honest stubs not silent success
11. **Quality Bar #7**: per-instance state, not module-global
12. **Quality Bar #11**: sibling-site scan before claiming wired
13. **Quality Bar #16 (NEW from session 2026-04-25)**: persistence layers default to test-isolation, NOT user-real data. Production callers opt in via explicit path.
14. **Provider neutrality (Gabriel directive)**: nothing should be hardcoded claude. Use PROVIDER_DEFAULTS / resolveAgentModel(tier, {providerHint}) for cross-cutting consumers. Per-provider adapters keep their own const blocks at top of file (extracted to single line for future bumps).
15. **Verify after each agent before continuing** (Gabriel directive 2026-04-25)

---

## STEP 4 — STOP CONDITIONS (same as v5 + 2 new)

STOP and ask user if:
- Disk <5Gi mid-phase
- Test regresses after 3 different fix approaches → use `tree-search` skill, then ask
- Security finding requires product-level decision
- Anthropic publishes new policy affecting Tier 3 Claude sub path
- Any destructive operation needed (git reset --hard, branch -D, force-push, rm -rf outside well-known artifacts)
- API rate-limit ceiling hit during a wave (5-hour cap) — harvest partials from JSONL, wait for reset, re-dispatch with stagger
- Tailscale wave needs decision: should we ALSO build Cloudflare Tunnel sidecar, or defer Phase 5?
- Cross-network testing needs real iOS device (per feedback_device_awareness.md)
- **NEW**: User-action items reach a head (e.g., requires Apple Developer account creation, requires GitHub repo settings change)

---

## STEP 5 — KNOWN GOTCHAS (Wave-by-wave hard-won lessons)

(All v5 gotchas remain valid. Adding new ones from session 2026-04-25.)

- **NEW (Wave 6-KK PairingManager bug)**: persistence layers must default to `:memory:` for bare construction; production wrappers (CompanionServer) explicitly pass home-dir path. Bare `new PairingManager()` defaulting to `~/.wotann/X.db` polluted user prod data + broke test isolation. Quality Bar #16.
- **NEW (Wave 5-DD test contract drift)**: stronger QB#6 capability gating (advertise only when wired) BREAKS old tests that asserted always-advertised contract. H-37b co-conspirator pattern: update test in same commit as source.
- **NEW (Wave 6.9-AG MCP prompts theatrical drop)**: dropping a capability is OK if it's truly theatrical, but the BETTER path was wiring it (which Skills→MCP-prompts wave did). Don't reflex-drop; ask "is there a real backing?"
- **NEW (Connectivity research finding)**: Supabase Relay was 960 LOC of theatrical scaffolding. ALWAYS grep for `.publish()` / `.send()` callers before assuming a relay-style module is functional. Quality Bar #14 + #15.
- **NEW (Wave 9 dehardcode lesson)**: bumping a model literal `claude-opus-4-6` → `claude-opus-4-7` is NOT the same as "dehardcoding". Dehardcoding means routing through PROVIDER_DEFAULTS so the choice is provider-neutral. The DEHARDCODE wave was the proper fix.
- **NEW (Wave 7 audit-numbers lesson)**: 5 of 7 audit metrics were WRONG vs live counts. Always run the actual count (find/grep) before trusting an audit-stated number. QB#15.
- **NEW (Wave 8 dead-code lesson)**: 5 of 8 dead-code claims were STALE. Modules listed as "dead" had real production importers. QB#15 mandatory before deletion.

---

## STEP 6 — SUCCESS CRITERIA

V9 GA + Tailscale wave ship criteria:
- [ ] Tailscale wave Tier-1 complete (Phase 1-4 minimum)
- [ ] Supabase Relay deleted (~960 LOC removed)
- [ ] TUI v2 Phase 1+2 wired into App.tsx
- [ ] iOS app-launch wiring complete
- [ ] `wotann trust [path]` CLI command registered
- [ ] Coverage baseline established (and reported in README)
- [ ] SB-22 mcp.add validation closed
- [ ] SB-21 wotann cost preview CLI surface live
- [ ] All 7 Wave 3-S follow-up symlink sites patched
- [ ] 4 mkdir 0o700 sites patched
- [ ] Top-10 owed integration tests written
- [ ] tsc rc=0 (src/ AND desktop-app)
- [ ] All tests green (or only pre-existing flaky ones noted)
- [ ] Drift-check 6/6 OK
- [ ] Push to origin/main once all green

---

## STEP 7 — AUTO-DETECT + AUTO-DISPATCH (Gabriel's Prime Directive)

"The user says WHAT. You decide HOW."

- Multi-step task → planner agent + /plan skill
- Bug with 4+ causes → /tree-search
- Tests failing in cycles → /ultraqa
- Need web info → WebFetch / WebSearch
- Unknown library → Context7 (resolve-library-id → query-docs)
- Auto-save to Engram after every decision/bugfix/discovery/convention
- Use max-effort thinking for architectural decisions

**Dispatch pattern for parallel agents** (rate-limit-aware):
```
Agent({
  description: "short task desc",
  subagent_type: "general-purpose",
  model: "opus",
  run_in_background: true,
  prompt: "self-contained brief — agent has NO session context"
})
```
Max 4 concurrent Opus agents per batch. Pause 60s between batches if rate-limit risk.

---

## STEP 8 — COMPLETION REPORT

When ALL Tier-1 + Tier-2 items complete:

1. Run final verification:
   ```bash
   npx tsc --noEmit
   cd desktop-app && npm run build && cd ..
   npx vitest run
   node scripts/v9-drift-check.mjs
   gh run list --limit 5 --json conclusion,displayTitle
   npx tsx src/index.ts doctor
   npm run coverage
   ```

2. Save final session summary to Engram with `topic_key="wotann-v9-ga-plus-tailscale-COMPLETE-2026-04-26"`

3. Push final state to origin/main (preserving 63+ commits)

4. Return to user with:
   - Final commit SHA
   - Test pass/fail count
   - Coverage % baseline
   - Tailscale wave status (Phase 1-4 done, Phase 5 deferred?)
   - V9 GA + cross-network shippability verdict
   - Required user actions (per docs/RELEASE_INFRA.md)

---

## TL;DR ONE-LINER

```
mem_context project=wotann && \
node scripts/v9-drift-check.mjs && \
Read docs/AUDIT_2026_04_26_SYNTHESIZED.md && \
Execute Tier 1 (Tailscale + TUI v2 wiring + iOS app-launch) per §STEP 2 \
in priority order with ≤4 Opus parallel + 60s pause between batches. \
Trust the v6 synthesized doc over earlier audits. \
Verify against HEAD before patching. Save to Engram after every decision. Push often.
```

The v6 synthesized doc is comprehensive (12-wave V9 GA results + DEHARDCODE + skills→prompts + connectivity research). Just execute it.

— Generated 2026-04-26, designed for autonomous Opus 4.7 (1M ctx) execution. Tier-1 alone is ~3-4 days; full Tier-1+2+3 is ~2 weeks.
