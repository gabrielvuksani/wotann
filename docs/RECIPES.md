# WOTANN Recipes

Recipes are reusable agent task pipelines. Author once, run any time.
WOTANN's format is **Goose-compatible** at the YAML level — a recipe
written for Goose loads in WOTANN unchanged, and vice versa.

This document is the canonical format spec plus six worked examples.

---

## Where recipes live

| Location | When |
|---|---|
| `.wotann/recipes/*.yaml` | Project-scoped recipes — committed (or git-ignored) per project |
| `~/.wotann/recipes/*.yaml` | User-scoped recipes — apply across every project |
| `templates/wotann-init/recipes/*.yaml` | Starter pack copied into every new project on `wotann init` |

Each `.yaml` file declares one recipe. The filename has no semantic
meaning — the `id` field inside the file is the canonical handle.

## Discovery + invocation

```
wotann recipe list                       # list all recipes
wotann recipe inspect <id>               # show parsed structure
wotann recipe run <id> [args...]         # execute a recipe
```

Recipes are loaded from all three locations above; conflicts on `id`
resolve in this order: project > user > starter.

---

## File format (canonical schema)

```yaml
version: 1                       # always 1 — bumped on schema breaks
id: my-recipe                    # unique handle; kebab-case, alphanumeric
title: Human-readable title      # shown in `wotann recipe list`
author: Optional author name
description: |                   # multi-line description; shown in inspect
  What this recipe does.
  Why a user would invoke it.

instructions: |                  # multi-line system prompt the agent runs under
  You are a <role>. Your goal is <goal>.
  Honor these constraints: <constraints>.

required_extensions:             # optional: declares the runtime capabilities the recipe needs
  - git
  - npm

parameters:                      # optional: typed parameters the caller supplies
  - name: target
    type: string                 # string | number | boolean
    required: true
    description: What this parameter is for.
  - name: dry_run
    type: boolean
    required: false
    default: false

retry:                           # optional: per-step retry policy
  max_attempts: 3
  strategy: exponential          # fixed | exponential
  base_delay_ms: 200             # only used by exponential

cron:                            # optional: schedule for unattended runs
  expression: "0 3 * * *"        # standard 5-field cron
  label: nightly-3am

steps:                           # ordered list of steps the agent executes
  - type: read                   # read a file into a variable
    path: "{{target}}"
    into: source

  - type: prompt                 # invoke the model with a prompt
    text: |
      Analyze the source above. Produce <output>.
    into: analysis

  - type: bash                   # run a shell command
    cmd: npm test
    expect: "passed"             # optional: substring required in stdout

  - type: write                  # write content to a file
    path: out.txt
    content: "{{analysis}}"

  - type: subrecipe              # invoke another recipe
    ref: another-recipe-id
    with:
      key: value
```

### Step types

| Type        | Purpose | Required fields |
|-------------|---------|-----------------|
| `read`      | Read a file into a context variable | `path`; optional `into` |
| `write`     | Write content to a file | `path`, `content` |
| `bash`      | Run a shell command, capture stdout/stderr | `cmd`; optional `expect` |
| `prompt`    | Run a model prompt; capture the response | `text`; optional `into` |
| `subrecipe` | Invoke another recipe | `ref`; optional `with` (params) |

### Variable interpolation

`{{name}}` interpolates a parameter or a previously-captured `into:`
output. Interpolation is shell-safe — values pass through `execFile`-style
argv, never through a shell.

### Discriminated step union

The format is a discriminated union on `type`. The loader rejects
unknown step types with a precise error message — no silent fallthrough.

### Honest stub envelope

Every load and run returns a result envelope:

```ts
type RecipeLoadResult =
  | { ok: true; recipe: Recipe }
  | { ok: false; error: string };

type RecipeRunResult =
  | { ok: true; outputs: RecipeStepOutput[]; variables: Record<string, unknown> }
  | { ok: false; error: string; outputs: RecipeStepOutput[] };
```

Failures never throw — caller branches on `ok`. Errors point at the
exact field that failed validation (e.g. `parameters[2].name missing`,
not `validation failed`).

---

## Six worked examples

These ship as the starter pack at
`templates/wotann-init/recipes/` and get copied into `.wotann/recipes/`
on `wotann init`.

### 1. `code-review.yaml` — structured code review

A senior-engineer code reviewer that groups findings under
Critical / High / Medium / Style and ends with a single PASS/FAIL line.

Parameters:
- `target` (string, required) — file path or `HEAD` for staged diff
- `base` (string, optional, default `main`) — base branch for diffing

Steps: verify git working tree → render the diff → prompt the reviewer.

### 2. `release-cut.yaml` — version + tag + publish

Bumps the package version, regenerates the changelog, runs the test
suite, builds, tags, and publishes. Fails fast on any gate. Supports
`dry_run: true` for rehearsal.

Parameters:
- `bump` (string, required) — `patch | minor | major`
- `dry_run` (boolean, optional, default `false`)

Notable: every step is a hard gate. No "force-publish" path exists.

### 3. `nightly-bench.yaml` — perf regression watchdog

Runs the benchmark suite, persists JSON to `.wotann/benchmarks/<date>.json`,
and surfaces metrics that regressed beyond a threshold from the
baseline. Has a `cron` block so it can be scheduled.

Parameters:
- `regression_threshold_pct` (number, optional, default `5`)
- `output_dir` (string, optional, default `.wotann/benchmarks`)

Notable: never modifies the baseline file. Baseline updates are a
human decision.

### 4. `refactor-for-tests.yaml` — extract helpers + add tests

The V9 spec example. Refactors a target module to be testable in
isolation: extracts pure helpers, adds injection seams for
side-effects, then writes the unit tests and runs them.

Parameters:
- `module_path` (string, required)
- `test_framework` (string, optional, default `vitest`)

Notable: uses `retry: exponential` with `max_attempts: 3` because the
test loop sometimes needs a second pass to settle.

### 5. `security-audit.yaml` — STRIDE security audit

Scans a target directory for OWASP Top 10 issues, hardcoded secrets,
vulnerable dependencies, and missing input validation. Findings are
grouped under STRIDE categories with file:line citations and severity
ratings.

Parameters:
- `target_dir` (string, optional, default `src`)
- `include_deps` (boolean, optional, default `true`)

### 6. (illustrative) `subrecipe` composition

Recipes can call other recipes via `subrecipe` steps:

```yaml
steps:
  - type: subrecipe
    ref: code-review
    with:
      target: HEAD
      base: develop

  - type: subrecipe
    ref: security-audit
    with:
      target_dir: src
```

Use this to compose larger workflows from smaller, single-purpose
recipes. Each invocation gets its own context — variables don't leak
between sub-recipe scopes.

---

## Authoring guidelines

1. **One recipe = one outcome.** Don't bundle "review + test + deploy"
   into one mega-recipe. Compose them via `subrecipe`.
2. **Use `expect:` on `bash` steps** when stdout matters — without it,
   exit code 0 is the only success criterion.
3. **Default to `dry_run: false` only when the recipe is non-destructive.**
   Anything that pushes, deletes, or publishes should accept a
   `dry_run` parameter and default it to `true`.
4. **Honest failure messages.** Don't `|| true` errors away. The
   recipe should fail loudly when a step legitimately fails.
5. **Pin tool versions in `required_extensions:` when the recipe
   relies on specific behavior** (e.g. `git@2.40+` for a flag added
   in 2.40). The runner surfaces missing extensions before any step runs.

## Goose round-trip

A recipe authored in Goose loads in WOTANN unchanged. The loader maps
Goose's `snake_case` YAML to camelCase TypeScript automatically:

| Goose YAML            | WOTANN TS               |
|-----------------------|-------------------------|
| `required_extensions` | `requiredExtensions`    |
| `max_attempts`        | `maxAttempts`           |
| `base_delay_ms`       | `baseDelayMs`           |
| `sub_recipes`         | `subRecipes`            |

Sources:
- WOTANN format: `src/recipes/recipe-types.ts` and `src/recipes/recipe-loader.ts`
- Starter pack: `templates/wotann-init/recipes/`
- V9 spec section: T12.4 (Goose Recipe YAML system)
