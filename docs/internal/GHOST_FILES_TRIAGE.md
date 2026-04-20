# Ghost File Triage (11 files, 2026-04-20)

**Triage agent:** Opus 4.7 (1M context)
**Discipline:** Quality Bar #14 — verify zero value before delete
**Repo:** `/Users/gabrielvuksani/Desktop/agent-harness/wotann`
**Scope:** read-only; no source modification, no git mutation

All 11 ghosts use the `<basename> 2.ts` suffix (a common artifact of macOS
Finder duplication or an IDE "Duplicate" command). None are referenced by
any `import … from "…<name> 2"` anywhere in `src/` or `tests/` — a
full-repo grep confirmed zero consumers.

## Summary table

| # | Ghost path | Size ratio (ghost/original) | Classification | Recommendation | Security-critical? |
|---|---|---|---|---|---|
| 1 | `src/connectors/connector-writes 2.ts` | 22K / 46K (48%) | STALE-SNAPSHOT | DELETE | no |
| 2 | `src/connectors/connector-tools 2.ts` | 20K / 35K (57%) | STALE-SNAPSHOT | DELETE | no |
| 3 | `src/core/runtime 2.ts` | 190K / 252K (75%) | STALE-SNAPSHOT | DELETE | no |
| 4 | `src/memory/store 2.ts` | 83K / 89K (93%) | STALE-SNAPSHOT | DELETE | no |
| 5 | `src/security/ssrf-guard 2.ts` | 10K / 5K (192%) | **UNMERGED-WORK** | **MERGE-FORWARD** | **YES — stricter IP coverage** |
| 6 | `src/lsp/agent-tools 2.ts` | 25K / 25K (100%) | STALE-SNAPSHOT | DELETE | no |
| 7 | `src/browser/browser-tools 2.ts` | 9K / 9K (100%) | STALE-SNAPSHOT | DELETE | no |
| 8 | `src/orchestration/autonomous 2.ts` | 47K / 55K (85%) | STALE-SNAPSHOT | DELETE | no |
| 9 | `src/orchestration/coordinator 2.ts` | 8K / 10K (80%) | STALE-SNAPSHOT | DELETE | no |
| 10 | `src/acp/protocol 2.ts` | 18K / 21K (86%) | STALE-SNAPSHOT | DELETE | no |
| 11 | `tests/providers/health-check.test 2.ts` | 19K / 21K (90%) | STALE-SNAPSHOT | DELETE | no |

Size ratios are from `ls -l`. None of the ghost files is referenced by any
import statement in the repo — they are all truly orphaned on disk.

---

## Per-file findings

### 1. src/connectors/connector-writes 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none — the ghost's 12 exports are a strict subset of the live file.
**Unique symbols in original (not in ghost):**
- `updateJiraIssue`, `commentJiraIssue`, `transitionJiraIssue`
- `updateLinearIssue`, `setLinearAssignee`, `readLinearIssue`
- `readNotionPage`, `appendNotionBlock`, `deleteNotionBlock`
- `updateConfluencePage`, `readConfluencePage`, `commentConfluencePage`
- `shareDrive`, `createDriveFolder`
- `createSlackChannel`, `uploadSlackFile`, `reactSlackMessage`
- Typed helpers: `jiraAuth`, `jiraHeaders`, `toAdf`, `httpErr`, `catchErr`, `basicAuth`
**Git last-touched-original:** `f8fb49b feat(telemetry+tools): Wave 4G observability` (preceded by `ec36ed2 feat(connectors/tools): register jira/linear/notion/confluence/drive/slack as agent tools`).
**Recommendation:** DELETE
**Rationale:** The ghost's entire 12-export surface is present verbatim (with enriched error detail and `fix` hints) in the live 28-export file. The ghost predates the Wave-4C "complete surface" work. Its helper functions (`doFetch`, `httpErrorToEnvelope`) are older, less factored shapes of the live `sendGuarded`+`httpErr`. No unique business logic, no callers. Safe to delete.

### 2. src/connectors/connector-tools 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** `ConnectorToolErrCode` type, all 40 Zod schemas (`JiraSearchSchema` … `SlackReactSchema`), `errEnvelope`, plus a significantly expanded `CONNECTOR_TOOL_NAMES` (34 tools vs ~20) and the `fix?` field on every error envelope.
**Git last-touched-original:** `fd9a186 fix(lint): unblock npm run lint`, preceded by `f8fb49b` and `ec36ed2` that added the full 34-tool surface.
**Recommendation:** DELETE
**Rationale:** Old snapshot before the connector-tools surface was expanded from ~20 operations to the full 34-tool Wave-4C surface, before Zod-schema validation was added, and before `fix` hints + `ConnectorToolErrCode` were added. The ghost also imports `isSafeUrl` directly (older guard pattern) whereas the live file delegates to `guardedFetch`/`assertOutboundUrl` via `connector-writes`. No unique logic. Safe to delete.

### 3. src/core/runtime 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none observed.
**Unique symbols in original (not in ghost):** The diff missing in the ghost covers at minimum all Phase-13 wave-3A wiring:
- Imports: `injectPolicyByDomain`, `enforceDeterministicSchema`, `calibrateConfidence`, `chainOfVerification`, `PatternDetector`, `createDefaultWebSearchProvider`, `ReflectionBuffer`
- Imports: `LanguageServerRegistry`, `AGENT_LSP_TOOL_NAMES`, `buildLspToolsForAgent`, `loadToolsWithOptions`, `VisualDiffTheater`
- Imports: `hybridSearchV2`, `createBm25Retriever`, `createDenseRetriever`
- Imports: `sandboxScrubPaths`, `makeSandboxVirtualPathConfig`, `VirtualPathsConfig`, `performHandoff`, `ProviderBrain`
- Imports: `selfConsistencyVote`, `SelfConsistencyResult`, `SelfConsistencyOptions`, `evaluateCompletionFromEvidence`
- Imports: Tier-2B tools `spawnMonitor`, `MONITOR_MAX_DURATION_MS`, `MONITOR_MAX_EVENTS_PER_RESULT`, `SteeringServer`
- Imports: Phase-H library-only modules `guardReview`, `maybeBuildCidIndexForProvider`, `renderCidAnnotation`, `shouldAbstain`, `scheduleSessionIngestion`, `detectSupersession`, `parseAssertionAsFact`, `ProgressiveContextLoader`
- Imports: `ToolTimingLogger`, `ToolTimingBaseline`, `AutoCaptureEntry`, `UnifiedKnowledgeFabric`, `Retriever`, `KnowledgeSource`, `KnowledgeQuery`, `KnowledgeResult`, `ContextTreeManager`, `ContextEntry`
- Imports: `wrapPromptWithThinkInCode` (from prompt engine)
- Config fields: `enableGuardian`, `enableContextualAbstention`, `progressiveContextTier`, `enableLspAgentTools`, `enableSteering`, `useHybridV2`, `virtualPathsEnabled`
- Plus all the corresponding constructor/initialize() wires
**Git last-touched-original:** recent blast of Phase-13 commits — `777e515 feat(dead-caller-sweep)`, `f963269 feat(orphan-sweep)`, `cad9ea3 feat(autopilot/completion-oracle)`, `4ce5c7b feat(runtime/search-providers)`, `1734167 feat(runtime/chain-of-verification)`, `959d439 feat(runtime/confidence-calibrator)`, `8cf0a92 feat(runtime/tool-pattern-detector+strict-schema)`, `dad73ac feat(runtime/policy-injector+reflection-buffer)`, and ~10 more recent Phase-13 wires.
**Recommendation:** DELETE
**Rationale:** Ghost is a pre-Phase-13 snapshot (Apr 19 12:55) before the orphan-sweep + Phase-13 wiring wave. The live file is a superset with hundreds of additional lines of behavior. The ghost would silently revert Phase-13 work if restored. No unique logic.

### 4. src/memory/store 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** `contextGenerator` field + `setContextGenerator`, `searchPalace(query, palace, limit)`, `searchExtended(query, options)`, plus the associated imports (`clampContextTokens`, `cleanContext`, `palaceFromStoreFields`, `palaceToStoreFields`, `palaceIsUnder`, `MemPalacePath`, `MemPalaceQuery`, `rrfFusion`, `temporalFiltered`, `metadataOnly`, `summaryOnly`, `SearchHit`, `SearchableEntry`, `TemporalFilter`). Also the `insert()` hook that prepends a contextual-retrieval chunk-context to the FTS-indexed value when a generator is installed.
**Git last-touched-original:** `af33f5d feat(memory): wire extended-search-types modes into store.searchExtended`, `8372010 feat(memory): wire mem-palace searchPalace gated by MEMORY_PALACE=1`, `0f886ca feat(memory): wire contextual-embeddings into store.insert`.
**Recommendation:** DELETE
**Rationale:** Ghost is a pre-Phase-13C snapshot (Apr 19 14:34) from before the mem-palace / contextual-embeddings / extended-search-types wires landed. Restoring would silently undo Anthropic-style contextual retrieval (+30-50% recall), the palace-aware search route, and all extended search modes.

### 5. src/security/ssrf-guard 2.ts  ⚠️  SECURITY-CRITICAL
**Classification:** **UNMERGED-WORK** (anomalously larger than live file)
**Unique symbols in ghost (not in original):**
- Types: `SSRFBlockedDetails`, `SSRFBlockReason` (with 6 categories: includes `"protocol"`, `"deny-list"`), `SSRFGuardOptions` (adds `allowedProtocols` field), `ValidateOutboundUrlResult`
- Constants: `DEFAULT_PROTOCOLS`, `METADATA_IPV6_PATTERNS`, `PRIVATE_IPV4_PATTERNS` (with many more ranges — see below), `PRIVATE_IPV6_PATTERNS`, `LOCALHOST_PATTERNS`
- Helpers: `stripBrackets`, `isIpv4Literal`, `isIpv6`, `matchesPrivateIpv4`
- Error constructor accepts `SSRFBlockedDetails` object (different API shape)

**Unique symbols in original (not in ghost):**
- `SSRFRejectionReason` (5-category type — live is narrower), `SSRFCheckOptions`, `SSRFCheckResult`, `checkUrl`, `isSafeUrl`, `requireSafeUrl`, `assertOutboundUrl` (exported as alias), `validateOutboundUrl` (different shape than ghost)
- `isPrivateHost` helper with `.internal` suffix rejection (live file wins on this edge case — ghost does not reject `*.internal`)
- Different error-class constructor shape: `new SSRFBlockedError(url, reason, detail)` vs ghost's `new SSRFBlockedError({url, reason, category})`

**Git last-touched-original:** single commit `234803c feat(security/ssrf-guard): universal outbound-URL validator for agent tools` — the live file IS the first and only commit of this module.

**⚠️ Security-critical gaps in the LIVE file that the GHOST catches:**

| Check | Ghost (2.ts) | Live (.ts) | Impact |
|---|---|---|---|
| IPv4 `192.0.0/24` | rejects | **passes** | reserved block, RFC-6890 |
| IPv4 `192.0.2/24` (TEST-NET-1) | rejects | **passes** | RFC-5737 test range |
| IPv4 `198.18-19/15` (Benchmarking) | rejects | **passes** | RFC-2544 |
| IPv4 `198.51.100/24` (TEST-NET-2) | rejects | **passes** | RFC-5737 |
| IPv4 `203.0.113/24` (TEST-NET-3) | rejects | **passes** | RFC-5737 |
| IPv4 multicast `224-239.x.x.x` | rejects | **passes** | RFC-5771 |
| IPv4 reserved `240-254.x.x.x` | rejects | **passes** | class E reserved |
| IPv4 broadcast `255.x.x.x` | rejects | **passes** | broadcast |
| IPv6 multicast `ff00::/8` | rejects | **passes** | RFC-4291 |
| IPv4-mapped IPv6 `::ffff:<priv-v4>` | rejects (recurses into v4 check) | **passes** | **bypasses RFC-1918 guard** |
| AWS IMDS IPv6 `fd00:ec2::/8` | rejects | **passes** | AWS-specific metadata route |
| AWS IMDS IPv6 `fe80::a9fe:a9fe` | rejects | **passes** | alt link-local metadata |
| `metadata.goog` (GCP alt) | rejects | **passes** | GCE alternate metadata host |

**Conversely, the LIVE file catches things the GHOST misses:**

| Check | Live (.ts) | Ghost (2.ts) |
|---|---|---|
| `*.internal` suffix rejection | rejects | passes |
| `metadata.azure.com` as named host | rejects | passes (only 169.254.169.254 covered) |

**Callers affected by the gap:**
- `src/connectors/guarded-fetch.ts` → `assertOutboundUrl` (Jira, Linear, Notion, Confluence, Drive, Slack all route through this — a user could supply a TEST-NET `domain` or `::ffff:127.0.0.1` credential and exfiltrate to localhost)
- `src/marketplace/acp-agent-registry.ts` → `requireSafeUrl`
- `src/browser/browser-tools.ts` → `isSafeUrl` (agent-driven browser navigation)
- `src/tools/aux-tools.ts` → `isSafeUrl`
- `src/connectors/connector-writes.ts` → `SSRFBlockedError` type-check

**Mitigating context:**
- `src/tools/web-fetch.ts` independently implements `isPrivateHost` WITH TEST-NET + IPv6 multicast + `::ffff:` handling at its own transport-level layer (see web-fetch.ts:181-217). That means the web-fetch path is already defended.
- `guarded-fetch.ts` does **not** use the transport-level pin — it only runs `assertOutboundUrl` and then calls `fetch()`. Every connector write path inherits the structural gap from `ssrf-guard.ts`.

**Recommendation:** **MERGE-FORWARD — port the ghost's stricter IP coverage into the live file.**

Specifically, merge into the live `isPrivateHost` function the following additional regex rules (from ghost's `PRIVATE_IPV4_PATTERNS` and `PRIVATE_IPV6_PATTERNS`):

```
// IPv4 — add to isPrivateHost after existing checks
if (/^192\.0\.0\./.test(h)) return true;
if (/^192\.0\.2\./.test(h)) return true;        // TEST-NET-1
if (/^198\.(1[89])\./.test(h)) return true;     // Benchmarking
if (/^198\.51\.100\./.test(h)) return true;     // TEST-NET-2
if (/^203\.0\.113\./.test(h)) return true;      // TEST-NET-3
if (/^22[4-9]\./.test(h)) return true;          // multicast
if (/^23\d\./.test(h)) return true;             // multicast
if (/^24\d\./.test(h)) return true;             // reserved
if (/^25[0-5]\./.test(h)) return true;          // reserved + broadcast

// IPv6 — add to isPrivateHost
if (/^ff[0-9a-f]{2}:/i.test(h)) return true;    // multicast
if (h.startsWith("::ffff:")) {
  // IPv4-mapped — unwrap and recurse into v4 check
  return isPrivateHost(h.slice("::ffff:".length));
}

// Metadata IPv6 patterns — add to METADATA_HOSTS-equivalent check
if (/^fd00:ec2:/i.test(h)) return true;
if (/^fe80::a9fe:a9fe/i.test(h)) return true;

// Named hosts — add to METADATA_HOSTS set
METADATA_HOSTS += { "metadata.goog" }
```

Do **not** adopt the ghost's different function/type shape (`validateOutboundUrl` returning `{valid, parsed}`, `SSRFBlockedError` taking an options-object) — the live file's backward-compatible API (`checkUrl` / `isSafeUrl` / `requireSafeUrl` / `assertOutboundUrl` / `validateOutboundUrl`) is already consumed by 5 callers. Breaking those signatures would be scope creep.

Also keep the live file's `.internal` suffix rejection (the ghost lacks it).

After the merge, the live file should also gain a test suite entry covering each newly-rejected range so Quality Bar #14 ("verify via runtime path, not just commit message") is satisfied.

**Rationale for classification as UNMERGED-WORK (not STALE-SNAPSHOT):**
- The live file mtime (Apr 19 16:33) post-dates the ghost (Apr 19 16:20) by 13 minutes, so this is likely a "simplification pass" where the author de-scoped the stricter checks as the file was refactored to match a narrower options type — possibly without realising TEST-NET/multicast/IPv6-metadata coverage was lost in the process.
- The ghost's extra coverage is **security-positive** — it closes real bypasses that callers rely on.
- The ghost cannot simply be swapped in because the call-site API shape changed; this is a true merge, not a copy.

### 6. src/lsp/agent-tools 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none (the 10-line diff is purely one redundant `import { lspNotInstalled }` that the ghost added but never uses in any new code — `lspNotInstalled` is used only as a field-name and property-key in the original; ghost does not add a call site for it).
**Unique symbols in original (not in ghost):** none — the files are effectively identical.
**Git last-touched-original:** `4d12d11 chore(repo+lint): fix CI lint failure`, preceded by `c1beefd feat(lsp/agent-tools): expose find_symbol/references/rename/hover/definition as agent-callable`.
**Recommendation:** DELETE
**Rationale:** Near-identical file. The 1-line import delta in the ghost is dead (no call site added). No unique logic.

### 7. src/browser/browser-tools 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** none — 95-line diff is purely cosmetic (comment re-wording, brace placement, removal of explicit single-line `if`-block braces). No behavioral change.
**Git last-touched-original:** `112db5a feat(browser/tools): register chrome-bridge+camoufox as agent browser tools`.
**Recommendation:** DELETE
**Rationale:** Stylistic-only diff. The ghost predates a minor formatting pass on the live file. No unique logic or symbols.

### 8. src/orchestration/autonomous 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** entire Phase-13 autonomous wiring —
- Imports: `scorePatch`, `PatchDescriptor`, `PatchScore`
- Imports: `runAdversarialTests`, `AdversarialContext`, `AdversarialTestGenerator`, `AdversarialRunResult`
- Imports: `voteOnPatches`, `VoteResult`, `VotingOptions`
- Imports: `TrajectoryRecorder`, `saveTrajectory`, `FrameKind`
- Imports: `saveCheckpoint`, `checkpointFilename`, `CHECKPOINT_VERSION`, `AutopilotCheckpoint`
- Callback-shape fields on the `run()` method: `getPatchForScoring`, `onPatchScore`, `getAdversarialContext`, `onAdversarialFindings`, `getMultiPatchCandidates`, `onMultiPatchVote`, `saveCheckpointPath`, `trajectoryPath`, `resumeCheckpoint`
- Runtime logic: trajectory recording, checkpoint save per iteration, WOTANN_PATCH_SCORE gate, WOTANN_MULTI_PATCH gate, WOTANN_ADV_TESTS gate, patch-scorer retry
**Git last-touched-original:** `777e515 feat(dead-caller-sweep)`, `c3b231f feat(autonomous/trajectory-recorder): persist frames to disk`, `ca574f1 feat(autonomous/checkpoint): autopilot-checkpoint save per iteration + patch-scorer retry gate`, `4a1389f feat(autonomous/adversarial-test-generator)`, `a7e02b3 feat(autonomous/patch-scorer+multi-patch-voter)`, `c420f17 feat(autonomous/trajectory-recorder+checkpoint)`.
**Recommendation:** DELETE
**Rationale:** Ghost is a pre-Phase-13 snapshot (Apr 19 12:52) before the autonomous + autopilot wiring work landed. No unique logic — just an old version.

### 9. src/orchestration/coordinator 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** `executeParallel()` method, `getStrategy()` method, `config.strategy` field, imports of `coordinateParallel`, `defaultSynthesizer`, `ParallelAgentTask`, `CoordinatedOutcome`, `Synthesizer`. Also handles `config.worktreeRoot` conditionally.
**Git last-touched-original:** `2d811e5 feat(orchestration/parallel-coordinator): wire into Coordinator`.
**Recommendation:** DELETE
**Rationale:** Ghost (Apr 12) predates the parallel-coordinator wire commit `2d811e5`. The live file added the dispatch-strategy dual-path (graph vs parallel) and the fan-out+synthesize executor. Ghost would revert that feature.

### 10. src/acp/protocol 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** Zed 0.3 parity surface —
- `AcpClientProvidedMcp` interface
- `AcpInitializeParams.clientProvidedMcp` field
- Method constants `ToolsList: "tools/list"`, `ToolsInvoke: "tools/invoke"`
- Types: `AcpToolDefinition`, `AcpToolsListParams`, `AcpToolsListResult`, `AcpToolsInvokeParams`, `AcpToolsInvokeResult`
**Git last-touched-original:** `353c9b8 feat(acp/server): add tools/list + tools/invoke methods (Zed 0.3 parity)`.
**Recommendation:** DELETE
**Rationale:** Ghost (Apr 19 12:55) predates the Zed 0.3 parity commit `353c9b8`. Restoring would remove the tools/list + tools/invoke surface and the `clientProvidedMcp` handshake, i.e., silently regress to ACP v1 minimum.

### 11. tests/providers/health-check.test 2.ts
**Classification:** STALE-SNAPSHOT
**Unique symbols in ghost (not in original):** none.
**Unique symbols in original (not in ghost):** the live mock's `query` callback switches response shape based on whether `opts.tools` was passed — simple_query (no tools) → text+stop, tool_call (with tools) → tool_use+tool_calls. The ghost always returns a fixed shape regardless, which would either spuriously flag `simple_query` as failing OR spuriously flag `tool_call` as passing, depending on the test.
**Git last-touched-original:** `45c6a9c feat(providers/health-check): per-provider smoke-test system + wotann health CLI`.
**Recommendation:** DELETE
**Rationale:** The ghost mock is correctness-broken — it cannot accurately represent Bug #5 (the Ollama `stopReason: "stop"` vs `"tool_calls"` regression) because it doesn't distinguish tool-calling vs text-only requests. The live file's conditional shape is the correct fix. No unique test cases exist in the ghost.

---

## Overall recommendation

### Can delete now (10 of 11):
Files 1, 2, 3, 4, 6, 7, 8, 9, 10, 11 are pure STALE-SNAPSHOT with zero unique business logic, zero callers, and zero unique tests. Delete with confidence.

```
src/connectors/connector-writes 2.ts
src/connectors/connector-tools 2.ts
src/core/runtime 2.ts
src/memory/store 2.ts
src/lsp/agent-tools 2.ts
src/browser/browser-tools 2.ts
src/orchestration/autonomous 2.ts
src/orchestration/coordinator 2.ts
src/acp/protocol 2.ts
tests/providers/health-check.test 2.ts
```

### Needs merge forward (1 of 11):
**File 5 (`src/security/ssrf-guard 2.ts`) is security-critical.** The live file is missing structural-URL rejection rules for:
- IPv4 TEST-NET-1/2/3 (RFC-5737): `192.0.2/24`, `198.51.100/24`, `203.0.113/24`
- IPv4 Benchmarking (RFC-2544): `198.18-19/15`
- IPv4 multicast + reserved + broadcast: `224-239.x.x.x`, `240-254.x.x.x`, `255.x.x.x`
- IPv4 RFC-6890 reserved `192.0.0/24`
- IPv6 multicast `ff00::/8`
- IPv4-mapped IPv6 `::ffff:` with private-IPv4 embedded (RFC-1918 bypass)
- AWS IMDS IPv6 patterns `fd00:ec2::/8`, `fe80::a9fe:a9fe`
- GCE alt-metadata host `metadata.goog`

These rules exist today in `src/tools/web-fetch.ts::isPrivateHost` (so the web-fetch path is safe) but **not** in the shared `ssrf-guard.ts` that `guarded-fetch.ts` routes every connector through. A user who configures a connector with a TEST-NET domain or a `::ffff:127.0.0.1` IPv4-mapped IPv6 hostname can today drive outbound requests that bypass the guard.

Do **not** adopt the ghost's changed function signatures (`validateOutboundUrl({valid, parsed, reason, category})`, `SSRFBlockedError({url, reason, category})`) — those would break the 5 existing callers. Only merge the **rule set** into the live `isPrivateHost()` + `METADATA_HOSTS` + a new IPv6 metadata-pattern list.

Add test coverage in `tests/unit/` for each newly-rejected range before marking the merge "done" (Quality Bar #14).

### Needs human judgment (0 of 11):
None of the ghosts diverged enough to require a judgement call — the classification is unambiguous in every case.

---

## Notes on methodology

- Every diff was run with `diff -u` and reviewed fully, not skimmed.
- Every ghost was grep'd for consumer imports: zero consumers found.
- Git history was read for the live file of every pair to confirm the ghost is older than the most recent behavior-adding commit.
- For the ssrf-guard pair, both files were read in full (157 and 344 lines respectively) to enumerate security-relevant rules line by line.
- Size ratios are from `ls -l` byte counts.
- No source files were modified, no git commands were mutated, no commits were made.

REPORT READY
