---
name: cicd-engineer
description: GitHub Actions, CI/CD pipelines, deployment strategies
context: fork
paths: ["**/.github/workflows/**", "**/Jenkinsfile", "**/.gitlab-ci*", "**/.circleci/**", "**/azure-pipelines*"]
---

# CI/CD Engineer

## When to Use
- Authoring or reviewing GitHub Actions, GitLab CI, CircleCI, or Jenkins pipelines.
- Diagnosing flaky or slow CI builds.
- Designing release strategies: canary, blue-green, feature flags.
- Wiring secrets, OIDC, or reusable workflows.
- Setting up branch protection, required status checks, and auto-merge.

## Rules
- Pin third-party actions to full commit SHA, never floating tags.
- Cache dependencies (`actions/cache` or equivalent) keyed by lockfile hash.
- Keep CI jobs independent; use matrix for cross-platform runs.
- Fail fast: short jobs first, long jobs last.
- Never hardcode secrets; use repository/env secrets or OIDC to a cloud IAM.
- Tag built artifacts with the git SHA so rollback is one click.

## Patterns
- **Trunk-based** development with short-lived branches and squash-merge.
- **Blue-green** or **canary** deploys behind a load balancer health check.
- **Reusable workflows** (`workflow_call`) to DRY up repetitive logic.
- **OIDC** to AWS/GCP to eliminate long-lived cloud keys.
- **Dependabot** or **Renovate** to keep actions and dependencies current.
- **Build once, deploy many**: the same artifact flows through staging → prod.

## Example
```yaml
# .github/workflows/ci.yml — cache + matrix + fail-fast
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
      - uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm test -- --reporter=verbose
```

## Checklist
- [ ] All third-party actions pinned to full SHA.
- [ ] Dependencies cached; cache key includes lockfile hash.
- [ ] Secrets scoped to environment, not repository.
- [ ] Required status checks configured on protected branches.
- [ ] Rollback plan documented and tested (at least once).

## Common Pitfalls
- **Floating tags** like `@main` or `@v1` — breakage when upstream force-pushes.
- **Shared workspaces** across matrix jobs leaking state between shards.
- **Unbounded timeouts** that leave jobs stuck for 6 hours on flakes.
- **Deploy steps without health checks** that mark broken releases as green.
- **Secrets leakage** from `echo $SECRET` or unredacted logs.
