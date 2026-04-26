# Rule: No TODO Comments in Shipped Code

Do not commit `TODO`, `FIXME`, `XXX`, or `HACK` comments to the
codebase. Open an issue or write a real ticket instead.

## Why

A `TODO` in source is a promise to a future maintainer that the
person making the promise will not keep. They accumulate. They never
get done. They become noise that obscures real signal during code
review. They leak into customer-facing strings when someone forgets
to strip them.

## Approved alternatives

When you discover work that needs doing later:

1. Open a GitHub issue with the context
2. Reference the issue number in a code comment if the location matters:
   ```ts
   // Issue #1234: revisit the rate limiter after the new SDK lands
   ```
3. For known limitations a user might hit, document them in the
   README or the relevant doc — not the source

## Approved markers

A small set of structured markers is allowed because they document
a real constraint, not a postponed task:

- `// SAFETY: <invariant>` — explains a non-obvious safety guarantee
- `// PERF: <reason>` — explains an unusual perf-driven choice
- `// SECURITY: <reason>` — explains a security-driven choice
- `// SPEC: <link>` — points at the spec section a piece of code implements

## Pre-commit gate

The repo's pre-commit hook greps for `TODO|FIXME|XXX|HACK` in staged
files. Commits with these markers are rejected. To override (rare, e.g.
during an in-progress refactor on a branch), use `--no-verify` and
explain in the PR description.
