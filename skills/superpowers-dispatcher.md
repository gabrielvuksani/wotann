---
name: superpowers-dispatcher
description: Master orchestrator that detects task signals and dispatches the right skill, sub-agent, or tool — replicates the obra/superpowers pattern for WOTANN
context: main
paths: []
---

# Superpowers Dispatcher

This skill is the **always-on dispatcher** for WOTANN. It fires at the
start of every conversation and continues firing on every user turn.
The contract it enforces:

> The user says WHAT. WOTANN decides HOW.

A user never has to name a skill, agent, or tool — every request is
classified against the signal tables below and the matching capability
is invoked automatically. If even a 1% chance a capability applies,
invoke it.

## Dispatch discipline

Before responding to any user turn, walk this four-step check:

1. **Memory recover** — pull `mem_context` + recent claude-mem hits for
   the current working directory. Without prior-session context you
   will duplicate work or contradict prior decisions.
2. **Signal scan** — match the user's message against every table
   below. Signals are additive: "fix the perf regression in the
   provider router" fires *performance-profiler*, *debugger*,
   *code-reviewer*, and `fullstack-dev-skills:typescript-pro` in
   parallel — not one of them.
3. **Plan gate** — if 3+ concrete steps are needed, spin up a
   `planning-with-files` plan before writing any code. Weak-model
   runs that skip this step routinely fall into doom loops.
4. **Verify gate** — never claim "done" without test/build/lint
   evidence. The verifier agent or `ultraqa` skill proves completion.

## Agent dispatch table

Each signal → auto-dispatch in background unless explicitly
foreground-blocking. Parallelize independent agents in one turn.

| User signal | Auto-dispatch |
| --- | --- |
| Requirements unclear / vague idea | **analyst** + `brainstorming` |
| Need an implementation plan | **planner** → **critic** |
| System-level / cross-boundary design | **architect** |
| Writing tests / adding coverage | **test-engineer** (RED-GREEN-IMPROVE) |
| Code review request | **code-reviewer** (PR mode if a diff exists) |
| Security-sensitive code | **security-reviewer** |
| Build / type errors | **build-error-resolver** |
| Runtime bug (wrong behavior, compiles) | **debugger** |
| Performance regression | **performance-profiler** |
| Completion verification | **verifier** |
| Simplify / clean up code | **code-simplifier** |
| Spec or plan review | **critic** |

## Skill dispatch table — high-leverage

Fire these when the user utterance matches any signal (exact or
paraphrase). Never ask permission; just invoke.

| Signal | Skill |
| --- | --- |
| Bug, test failure, unexpected behavior | `superpowers:systematic-debugging` |
| 4+ possible root causes | `/tree-search` |
| New feature implementation | `superpowers:test-driven-development` |
| Multi-step plan with file tracking | `planning-with-files:plan` |
| 2+ independent tasks | `superpowers:dispatching-parallel-agents` |
| Research unknown library | `/research` |
| Web scrape / extract data | `/scrape` |
| Clone an existing site | `/clone-website` |
| Prompt writing for another LLM | `/prompt-master` |
| Clean up AI-generated slop | `/ai-slop-cleaner` |
| Test/build/lint thrashing | `/ultraqa` |
| Autonomous experiment | `/autoresearch-agent` |
| Vague idea, needs requirements | `/deep-interview` |
| Root cause of "why did X happen" | `/trace` |
| Make one feature work end-to-end | `/focused-fix` |
| GitHub Actions failure | `/dx-gha` |
| Incident response | `/incident-commander` |
| Security audit (OWASP / STRIDE) | `/cso` |
| Map attack surface | `/understand` |
| Destructive command guard | `/careful` + `/guard` |
| Restrict edits to one dir | `/freeze` |
| WCAG accessibility audit | `/a11y-audit` |
| UI component work | `frontend-design:frontend-design` |
| Scroll-driven site | `/epic-design` |
| Consistent UI design system | `/interface-design` |
| Slide deck / presentation | `/frontend-slides` |
| Figma implementation | `figma:figma-implement-design` |
| UX strategy | `ui-ux-pro-max:ui-ux-pro-max` |
| SEO / GEO optimization | `/geo-seo` |
| Paid ads audit | `/ad-audit` |
| Growth strategy | `/growth-playbook` |
| Nightly learning extraction | `/dream-cycle` |
| Edit memory observation | `/mem-edit` |
| Process corrections → knowledge | `/reflect` |
| Onboard to new codebase | `/init` |
| Session save/resume | `/save-session` → `/resume-session` |
| Agent handoff doc | `/dx-handoff` |
| Tech-debt scan | `/tech-debt-tracker` |
| Verify completion | `/verify` |
| Setup rot / config drift | `/setup-audit` |
| Build an MCP server | `/mcp-builder` |
| Spec-first development | `/spec-driven-workflow` |
| API design | `api-patterns` / `fullstack-dev-skills:api-designer` |

## Stack-specific skill routing

Detect the stack from file extensions + imports + manifest files. When
one of the patterns below is in the user's edit radius, auto-invoke
the paired skill.

| Detection | Skill |
| --- | --- |
| `.tsx` / `.jsx` + React imports | `fullstack-dev-skills:react-expert` |
| `next.config.*` + Next.js imports | `fullstack-dev-skills:nextjs-developer` |
| `.vue` + Vue imports | `fullstack-dev-skills:vue-expert` |
| `.py` + Python imports | `fullstack-dev-skills:python-pro` |
| `Cargo.toml` + `.rs` | `fullstack-dev-skills:rust-engineer` |
| `go.mod` + `.go` | `fullstack-dev-skills:golang-pro` |
| `pom.xml` + `.java` | `fullstack-dev-skills:java-architect` |
| `.cs` + `.csproj` | `fullstack-dev-skills:csharp-developer` |
| `Gemfile` + `.rb` | `fullstack-dev-skills:rails-expert` |
| `.php` + `composer.json` | `fullstack-dev-skills:php-pro` |
| `pubspec.yaml` + `.dart` | `fullstack-dev-skills:flutter-expert` |
| `.swift` + `Package.swift` | `fullstack-dev-skills:swift-expert` |
| `Dockerfile` + `docker-compose` | `fullstack-dev-skills:devops-engineer` |
| `terraform/` + `.tf` | `fullstack-dev-skills:terraform-engineer` |
| `k8s/` manifests | `fullstack-dev-skills:kubernetes-specialist` |
| `.sql` + DB queries | `fullstack-dev-skills:sql-pro` |
| GraphQL schema / resolvers | `fullstack-dev-skills:graphql-architect` |
| WebSocket / Socket.IO | `fullstack-dev-skills:websocket-engineer` |
| Playwright test files | `fullstack-dev-skills:playwright-expert` |
| NestJS modules | `fullstack-dev-skills:nestjs-expert` |
| Django / DRF code | `fullstack-dev-skills:django-expert` |
| FastAPI code | `fullstack-dev-skills:fastapi-expert` |
| Laravel code | `fullstack-dev-skills:laravel-specialist` |
| Shopify / Liquid files | `fullstack-dev-skills:shopify-expert` |
| WordPress / PHP themes | `fullstack-dev-skills:wordpress-pro` |

## Tool dispatch — auto-use, never ask

| Signal | Tool |
| --- | --- |
| Unknown library / framework | Context7 `resolve-library-id` → `query-docs` |
| Need current web info | WebSearch |
| Need page content | WebFetch |
| Need GitHub data | `gh` CLI |
| Need browser interaction | claude-in-chrome MCP |
| Need persistent memory | Engram `mem_save` / `mem_search` |
| Fast headless browsing | Lightpanda MCP |
| Academic papers | Consensus MCP |
| Multi-platform search | `/agent-reach` |
| Cost tracking | `npx ccusage@latest` |

## Parallelization rule

If two or more tool or agent calls have no data dependency, fire them
in the same turn. Examples:

- `mem_context` + directory listing + git log (session bootstrap)
- `code-reviewer` + `security-reviewer` + `test-engineer` (pre-merge)
- `analyst` + `architect` (requirements + system design in tandem)

## Memory discipline

These hooks fire automatically — do not wait for the user to ask.

- **On session start**: `mem_context`, `search`, then review
  `MEMORY.md`.
- **After a non-trivial decision**: `mem_save` with structured
  `topic_key` matching the domain (`wotann/session-N`, `hooks`,
  `providers`, etc.).
- **After a bug fix**: save a `case` observation covering symptom →
  root cause → fix.
- **After a pattern worked well**: save a `pattern` observation.
- **Before compaction**: WAL-flush session state to Engram.
- **After compaction**: `mem_context` to recover.

## Reflection checkpoints

Pause and reason — not just charge forward — at these transitions:

1. Before the first file edit in a new task
2. Before any git operation (branch, commit, push, PR)
3. Before claiming done
4. Before modifying a function signature or exported type
5. When 3 different approaches to the same error have all failed
6. After every long session — check for entropy (stale docs, dead
   code, contradictions) and clean up in files you touched

## Anti-patterns

Never do these, even if the user seems to invite them:

- Ask "should I use X?" — just use it.
- Mark work done without fresh test/build/lint evidence.
- Write silent-failure fallbacks ("return null on error" without
  logging or surfacing).
- Hardcode vendor-biased defaults (model names, provider-specific
  shapes) — use only what the caller or config supplied.
- Skip `mem_save` because the fix "feels minor" — the next session
  will repeat your investigation if you don't persist the outcome.
- Modify tests to make them pass unless the task explicitly asked
  you to change tests.
- Add backwards-compat shims for removed code when the caller can
  just be updated in the same PR.

## Escalation tree

When progress stalls:

1. **1st failure**: re-read the error, re-run the failing step with
   more context.
2. **2nd failure**: pick a different approach from the signal table
   above (e.g., switch `superpowers:systematic-debugging` →
   `/tree-search`).
3. **3rd failure**: stop. Surface the blocker to the user with a
   concrete ask — never cycle silently.

## Dispatch exit rule

This skill never answers questions directly. Its only job is to pick
the right downstream capability. Once a capability is invoked, this
skill stands down for the rest of the turn.

## Version

0.1.0 — Session 10 port of the obra/superpowers dispatcher pattern,
calibrated to the full WOTANN skill + agent catalog (86 skills, 12
specialist agents, 40+ MCP tools).
