# Tracked Repo Updates -- 2026-04-09

Cutoff: changes since 2026-03-29

---

## Biweekly Tier (11 repos)

### 1. github/spec-kit -- ACTIVE
- **v0.5.1** released 2026-04-08; v0.5.0 on 2026-04-02
- `aa2282e` 2026-04-08 -- chore: release 0.5.1, begin 0.5.2.dev0 development
- `1c41aac` 2026-04-08 -- fix: pin typer>=0.24.0 and click>=8.2.1 to fix import crash
- `cb0d961` 2026-04-08 -- feat: update fleet extension to v1.1.0
- **WOTANN note**: Fleet extension v1.1.0 could be relevant if using spec-kit for spec generation.

### 2. D4Vinci/Scrapling -- ACTIVE
- **v0.4.5** released 2026-04-07; v0.4.4 on 2026-04-05
- `2046527` 2026-04-08 -- docs: adding a new sponsor
- `cb449af` 2026-04-07 -- v0.4.5
- Two patch releases in one week -- active maintenance.

### 3. hkuds/lightrag -- ACTIVE
- **v1.4.13** released 2026-04-02
- `32b6f4d` 2026-04-07 -- fix(auth): prevent JWT algorithm confusion attack (GHSA-8ffj-4hx4-9pgf)
- `bd1ae3e` 2026-04-07 -- fix(auth): show friendly error on startup misconfiguration
- **WOTANN note**: Critical security fix -- JWT alg=none bypass. If WOTANN integrates LightRAG, ensure you are on >=1.4.13 or have the GHSA patch.

### 4. letta-ai/claude-subconscious -- ACTIVE
- **v2.1.1** released 2026-03-30; v2.1.0 same day
- `382a283` 2026-03-31 -- feat: add letta/auto and minimax/MiniMax-M2.7 to model fallback list
- `7c57b13` 2026-03-30 -- fix: three bugs -- silent worker resolution, TTY crash, plugin root fallback
- **WOTANN note**: MiniMax M2.7 added to fallback list; TTY crash fix relevant if using Letta in non-interactive environments.

### 5. BayramAnnakov/claude-reflect -- NO CHANGE
- Last commit 2026-03-16 (before cutoff). No new activity.

### 6. LeoYeAI/openclaw-master-skills -- ACTIVE
- **v0.7.0** released 2026-03-31
- `8611c68` 2026-04-06 -- feat(v0.8.0): weekly update -- 560 total skills, fix CHANGELOG
- `1d82874` 2026-03-31 -- feat(v0.7.0): expand to 560+ skills (+173 new from alirezarezvani, steipete)
- **WOTANN note**: 173 new enterprise-grade skills (C-Suite advisors, senior engineers, product management). Worth scanning for skills that could augment WOTANN's agent capabilities.

### 7. bmad-code-org/BMAD-METHOD -- VERY ACTIVE
- No new release (latest v6.2.2 from 2026-03-26)
- `3ba51e1` 2026-04-09 -- feat(quick-dev): add epic context compilation to step-01
- `59b07c3` 2026-04-08 -- feat(bmad-help): llms.txt support for general questions
- `f9925eb` 2026-04-08 -- feat(quick-dev): improve checkpoint 1 UX
- **WOTANN note**: llms.txt support and epic context compilation are interesting patterns for WOTANN's planning/spec workflow.

### 8. blader/taskmaster -- NO CHANGE
- Last commit 2026-03-11 (before cutoff). No new activity.

### 9. blader/Claudeception -- NO CHANGE
- Last commit 2026-02-21 (before cutoff). No new activity.

### 10. haddock-development/claude-reflect-system -- NO CHANGE
- Last commit 2026-01-17 (before cutoff). No new activity.

### 11. lightpanda-io/browser -- VERY ACTIVE
- **0.2.8** released 2026-04-02
- `689fb90` 2026-04-08 -- cache: add log filter to garbage file test
- `795b0af` 2026-04-08 -- Use encoding_rs on non-UTF-8 html to convert to utf-8
- **WOTANN note**: Non-UTF-8 encoding support fix -- important for web scraping/rendering pipelines.

---

## Monthly Tier (20 repos)

### 1. karpathy/autoresearch -- NO CHANGE
- Last commit 2026-03-26 (before cutoff). No new activity.

### 2. Significant-Gravitas/AutoGPT -- VERY ACTIVE
- **autogpt-platform-beta-v0.6.54** released 2026-04-08
- `ef477ae` 2026-04-08 -- fix(backend): convert AttributeError to ValueError in _generate_schema
- `705bd27` 2026-04-08 -- fix(backend): wrap PlatformCostLog metadata in SafeJson to fix silent DataError
- `fa6ea36` 2026-04-08 -- fix(backend): make User RPC model forward-compatible during rolling deploys
- Production hardening: schema validation, cost logging, rolling deploy compatibility.

### 3. gadievron/raptor -- ACTIVE
- `bfab59a` 2026-04-08 -- Fix --target in lifecycle docs, fix sys.path in understand map skill
- `731c713` 2026-04-08 -- Fix project tests
- `97b8a21` 2026-04-08 -- Fix understand bridge: boundary matching, shape validation, API cleanup

### 4. Dammyjay93/interface-design -- NO CHANGE
- Last commit 2026-02-10 (before cutoff). No new activity.

### 5. nidhinjs/prompt-master -- ACTIVE
- `4b39961` 2026-03-31 -- feat: add Cline (formerly Claude Dev) tool profile
- Cline VS Code extension profile added to SKILL.md.

### 6. zubair-trabzada/geo-seo-claude -- NO CHANGE
- Last commit 2026-03-27 (before cutoff). No new activity.

### 7. AgriciDaniel/claude-ads -- ACTIVE
- **v1.3.0** released 2026-04-01
- `c2ca51f` 2026-04-01 -- feat(v1.4.0): banana integration, creative pipeline overhaul, ecom templates
- Major update: banana-claude as default image provider, voice-to-style mapping, AIDA/PAS/BAB copy frameworks, e-commerce playbooks.
- **WOTANN note**: The copy frameworks (AIDA, PAS, BAB, 4P, FAB, Star-Story-Solution) and e-commerce templates could be relevant reference material.

### 8. HKUDS/ClawTeam -- ACTIVE
- `a268d1b` 2026-04-04 -- fix: stabilize harness contract ordering
- `0d4b8c4` 2026-04-04 -- fix: tighten worker task assignment and resume flow
- `680c02e` 2026-04-03 -- fix: sync project skill links to clawteam

### 9. centminmod/my-claude-code-setup -- ACTIVE
- `d02832b` 2026-04-05 -- update readme
- `ed55d7f` 2026-04-05 -- update ai-image-creator skill for .env in Claude Desktop/Cowork sandbox
- `43c83c2` 2026-04-03 -- Add --analyze image analysis mode to ai-image-creator skill
- **WOTANN note**: Image analysis mode via multimodal models (gemini, gpt5) -- interesting pattern for WOTANN's multimodal capabilities.

### 10. JCodesMore/ai-website-cloner-template -- ACTIVE
- **v0.3.1** released 2026-03-30; v0.3.0 same day
- `25dc8ef` 2026-03-30 -- chore: align repo baseline to Node 24
- `16ca665` 2026-03-30 -- add Docker support with multi-stage production builds
- Node 24 baseline + Docker multi-stage builds added.

### 11. Fission-AI/OpenSpec -- VERY ACTIVE
- No new release (latest v1.2.0 from 2026-02-23)
- `ea6f380` 2026-04-09 -- feat: add ForgeCode tool support
- `765df47` 2026-04-09 -- fix(init): prevent false GitHub Copilot auto-detection from bare .github/ directory
- `fd7ad27` 2026-04-09 -- Fix formatting in concepts.md
- **WOTANN note**: ForgeCode tool support added -- new code generation tool integration to evaluate.

### 12. f/prompts.chat -- ACTIVE
- `9e93f16` 2026-04-09 -- Add prompt: Add AI protection
- `df49ad3` 2026-04-09 -- Add prompt: pdfcount
- `cf636d5` 2026-04-09 -- Add prompt: Tr
- Steady stream of community prompt additions.

### 13. x1xhlol/system-prompts-and-models-of-ai-tools -- NO CHANGE
- Last commit 2026-03-28 (before cutoff). No new activity since cutoff.

### 14. SakanaAI/AI-Scientist-v2 -- NO CHANGE
- Last commit 2025-12-19. Dormant for 4+ months.

### 15. ryoppippi/ccusage -- ACTIVE
- `291cddb` 2026-04-06 -- chore(nix): .envrc
- `61ee04d` 2026-03-28 -- chore: upgrade vitest to v4.1 + workspace config with GitHub integration
- Minor maintenance: nix envrc, vitest v4.1 upgrade.

### 16. getsentry/sentry-mcp -- VERY ACTIVE
- No new release (latest 0.31.0 from 2026-03-27)
- `0941c50` 2026-04-08 -- test(client): add real stdio smoke coverage for agent CLIs (Claude Code + Codex)
- `8b21ab5` 2026-04-08 -- feat: add replay summaries to issue details
- `98d3a44` 2026-04-08 -- fix(cloudflare): Stabilize MCP OAuth refresh reuse
- **WOTANN note**: Replay summaries in issue details and stdio smoke tests for Claude Code/Codex are directly relevant for MCP integration patterns.

### 17. luongnv89/claude-howto -- VERY ACTIVE
- **v2.3.0** released 2026-04-07
- `63a1416` 2026-04-09 -- fix(docs): correct Claude Code version to 2.1.97
- `e015f39` 2026-04-09 -- fix: apply 2026-04-09 documentation accuracy updates
- Key changes: /vim removed in v2.1.92, claude-sonnet-4-5 -> claude-sonnet-4-6 model ID update, WebSocket MCP transport not supported (only stdio/sse/http), # memory shortcut discontinued.
- **WOTANN note**: Model ID update (claude-sonnet-4-6) and MCP transport clarification (no WebSocket) are directly relevant.

### 18. builderz-labs/mission-control -- ACTIVE
- No new release (latest v2.0.1 from 2026-03-18)
- `7128058` 2026-04-04 -- feat: gateway control panel -- start, stop, restart, diagnose
- `a0a4d60` 2026-04-03 -- fix: remove OpenClaw-specific branding from gateway UI strings
- `3bd1eb7` 2026-04-03 -- feat: add runtime_type to agents + Hermes multi-agent profile provisioning
- **WOTANN note**: Multi-runtime agent support (hermes, openclaw, claude, codex, custom) and gateway control panel are interesting patterns for WOTANN's agent orchestration.

### 19. mem0ai/mem0 -- VERY ACTIVE
- **v1.0.11** released 2026-04-06; ts-v2.4.6 same day
- `081eca6` 2026-04-08 -- fix: guard temp_uuid_mapping lookups against LLM-hallucinated IDs
- `2434b9d` 2026-04-08 -- docs: add ChatDev integration guide
- `3ffea55` 2026-04-08 -- fix(azure_openai): forward response_format to Azure OpenAI API
- **WOTANN note**: LLM-hallucinated ID guard fix is a good defensive pattern for any memory system. Azure OpenAI response_format fix relevant if using Azure.

### 20. VoltAgent/awesome-agent-skills -- ACTIVE
- `c22c8fe` 2026-04-04 -- Add qdrant skills
- `27592de` 2026-04-04 -- Add Resend skills
- `5682442` 2026-04-04 -- Add Courier skills
- New skill collections: Qdrant (vector DB), Resend (email), Courier (notifications).

---

## Summary

| Status | Count | Repos |
|--------|-------|-------|
| VERY ACTIVE | 7 | spec-kit, lightrag, BMAD-METHOD, lightpanda, AutoGPT, sentry-mcp, mem0, claude-howto, OpenSpec |
| ACTIVE | 14 | Scrapling, letta-ai, openclaw-skills, prompt-master, claude-ads, ClawTeam, centminmod, ai-website-cloner, prompts.chat, ccusage, mission-control, awesome-agent-skills, raptor, ryoppippi/ccusage |
| NO CHANGE | 10 | claude-reflect, taskmaster, Claudeception, claude-reflect-system, interface-design, geo-seo-claude, system-prompts, AI-Scientist-v2, autoresearch, x1xhlol/system-prompts |

### Key WOTANN-Relevant Changes
1. **LightRAG JWT security fix** (GHSA-8ffj-4hx4-9pgf) -- critical if integrating
2. **claude-sonnet-4-6 model ID** -- update any hardcoded model references
3. **MCP transport: only stdio/sse/http** -- no WebSocket support confirmed
4. **Sentry MCP replay summaries** -- pattern for enriching issue context
5. **Mission Control multi-runtime agents** -- pattern for runtime_type enum (hermes/openclaw/claude/codex/custom)
6. **mem0 hallucinated ID guard** -- defensive pattern for memory UUID lookups
7. **OpenSpec ForgeCode support** -- new tool integration to evaluate
8. **OpenClaw 560+ skills** -- enterprise skill catalog expansion
