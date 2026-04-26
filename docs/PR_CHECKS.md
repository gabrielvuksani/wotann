# WOTANN PR Checks

PR Checks are markdown-described pre-merge gates. Each one is a model
that reads a PR diff and emits a single line — `PASS` or
`FAIL: <reason>` — which becomes a GitHub Check Run on the PR.

Inspired by Continue.dev's PR-as-Status-Check pattern (V9 §T12.5).

---

## Where checks live

| Location | When |
|---|---|
| `.wotann/checks/*.md` | Project-scoped checks — the canonical location |
| `templates/wotann-init/checks/*.md` | Starter pack copied into every new project on `wotann init` |

The runner discovers every `.md` file in the configured checks dir,
parses YAML frontmatter, and runs each check against the PR diff.

## Discovery + invocation

```
wotann pr-check                          # run every check against current diff
wotann pr-check --ref main               # diff against a specific ref
wotann pr-check --checks-dir ./gates     # use a different checks dir
```

Run from CI on every PR. The runner exits non-zero if any blocking
check fails — gate your `merge-blocking` rule on that exit code.

---

## File format

A check is one Markdown file. The frontmatter declares metadata; the
body is the system prompt the model runs under.

```markdown
---
id: my-check                # unique check id, must match filename minus `.md`
severity: blocking          # blocking | advisory
provider: anthropic         # optional — model provider (default: anthropic)
model: sonnet               # optional — model id (default: sonnet)
---

You are a <role>. Read the supplied PR diff. Check for <criteria>.

OUTPUT FORMAT (strict — single line):
- If the diff is clean: `PASS`
- If a finding exists: `FAIL: <file>:<line> — <one-sentence summary>`

<additional guidance for the model>
```

### Frontmatter fields

| Field      | Required | Allowed values                              |
|------------|----------|---------------------------------------------|
| `id`       | yes      | kebab-case, `[a-z0-9][a-z0-9-]*`            |
| `severity` | no       | `blocking` (default) or `advisory`          |
| `provider` | no       | any provider id WOTANN knows (default: `anthropic`) |
| `model`    | no       | any model id (default: `sonnet`)            |

### Severity semantics

| Severity   | GitHub Check conclusion on FAIL |
|------------|---------------------------------|
| `blocking` | `failure` — blocks merge if branch protection enforces it |
| `advisory` | `neutral` — annotated, doesn't block merge |

A check with no `severity:` defaults to `advisory` — opt in to blocking
explicitly.

### Output format the body must enforce

The model's reply MUST start with one of:

- `PASS` — the diff is clean for this check
- `PASS: <note>` — clean, with an optional informational note
- `FAIL: <one-line reason>` — the diff fails this check

Anything else is parsed as `neutral` (the model didn't follow format).
The check still runs but the conclusion is `neutral` regardless of
severity.

### Aggregate run conclusion

The runner returns one overall conclusion per PR:

- Any blocking `FAIL` → overall `failure`
- Any advisory `FAIL` or any `neutral` → overall `neutral`
- Otherwise → overall `success`

---

## Five worked examples

These ship as the starter pack at `templates/wotann-init/checks/` and
get copied into `.wotann/checks/` on `wotann init`.

### 1. `no-hardcoded-secrets.md` — blocking

Scans the diff for hardcoded API keys, OAuth secrets, private keys,
DB connection strings with embedded passwords. Knows the common
patterns (Stripe `sk_live_`, AWS `AKIA*`, GitHub `ghp_*`, etc.)
and the common false-positive patterns (test fixtures, placeholders).

```
PASS                                       # clean
FAIL: src/auth.ts:42 — Stripe live key     # finding
```

### 2. `breaking-api.md` — blocking

Detects unflagged breaking changes to the public API. A change is
breaking when it removes/renames an exported symbol, narrows a
return type, requires a previously-optional parameter, etc.

A change with `BREAKING CHANGE:` in the PR description AND a major
version bump passes. Anything else fails.

```
PASS                                              # additive only
FAIL: src/api.ts:88 — exported `createSession` — removed
```

### 3. `coverage-drop.md` — advisory

For every newly-added or modified function in the diff, verifies that
the same diff also adds or modifies a test that exercises it. Catches
the "I'll add tests later" anti-pattern at PR time.

```
PASS                                                       # tests track code
FAIL: src/parser.ts:42 — parseConfig — added without test  # gap
```

Marked advisory because not every change needs new tests (pure
refactors, docs-only changes). Promote to blocking once the team
agrees on the threshold.

### 4. `security-review.md` — advisory

Reviews the diff for OWASP Top 10 issues across injection (SQL,
shell, path), authn/authz, data exposure, cryptography, and resource
handling. Surfaces the highest-severity finding per invocation.

```
PASS                                                                       # clean
FAIL: src/db.ts:14 — Injection — SQL via string concat instead of bind     # finding
```

Marked advisory so the gate runs on every PR without blocking
benign changes; promote to blocking on services that handle PII or
financial data.

### 5. `pr-description-fill.md` — advisory

Verifies the PR description is reviewer-ready: a real summary, a
test plan, and (when the change touches infra/security/billing) a
risk paragraph. Catches the "title-only PR" anti-pattern.

```
PASS                                                                # complete
FAIL: empty body — no summary, no test plan                         # too thin
FAIL: change touches src/auth/ but no risk paragraph or rollback plan
```

---

## Authoring guidelines

1. **One check = one criterion.** Don't bundle "secrets + breaking
   API + coverage" into one check. Compose via separate files.
2. **Strict output format.** The body MUST instruct the model to emit
   exactly `PASS` or `FAIL: <reason>` as the first line. Multi-line
   essays are parsed as `neutral`.
3. **Cite file and line.** `FAIL: <file>:<line> — <reason>` is the
   canonical format. The runner surfaces these as inline annotations
   on the PR.
4. **Default to advisory.** New checks land as advisory. Promote to
   blocking after 2–4 weeks of clean signal.
5. **Keep the body terse.** A check is a focused scan, not a code
   review. Aim for ~30 lines of body — the longer the prompt, the
   slower the run and the higher the FP rate.
6. **Watch the FP rate.** If a check fires `FAIL` on > 10% of clean
   PRs, tune the prompt — false positives erode trust faster than
   false negatives.

## Suggested checks to add over time

- `no-console-log` — block `console.log` in committed source (advisory)
- `licenses` — verify any newly-added dependency has an allowed license
- `image-budget` — block PRs that add images > 100KB without a
  compression flag
- `migration-safety` — block schema migrations without a backward-compat
  shim or a stated downtime window
- `dep-pin` — verify newly-added deps have a pinned version (no `^` or `~`)

Sources:
- Runner: `src/pr-checks/pr-runner.ts`
- Types: `src/pr-checks/pr-types.ts`
- CLI verb: `wotann pr-check`
- Starter pack: `templates/wotann-init/checks/`
- V9 spec section: T12.5 (Continue.dev PR-as-status-check)
