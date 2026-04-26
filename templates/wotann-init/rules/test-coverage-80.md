# Rule: Minimum 80% Test Coverage

Every shipped feature carries unit, integration, and (for critical
flows) end-to-end tests. The repo enforces an 80% line + branch
coverage floor.

## Test categories

- **Unit tests** — exercise a single function in isolation. Mock at
  module boundaries. Fast (sub-millisecond), deterministic, never touch
  network or fs.
- **Integration tests** — exercise the seams between modules. Real
  database, real cache, real subprocess. Slower but more realistic.
- **E2E tests** — drive the full user-facing surface. Run sparingly
  on critical flows (auth, payment, primary user journey).

## Test-Driven Development

The expected workflow:

1. **RED** — Write the failing test first. Run it. Confirm it fails for
   the right reason (not a typo or import error).
2. **GREEN** — Write the minimum code to pass the test. Resist the urge
   to "while I'm here, also fix...".
3. **REFACTOR** — Clean up. Tests still green.

## What 80% means in practice

- Every public function has at least one happy-path test
- Every public function has at least one error-path test
- Every conditional branch is exercised
- Every state machine transition is exercised
- The 20% that's untested is the obvious-and-trivial wiring (e.g., a
  one-line getter), never the business logic

## What does NOT count toward coverage

- Smoke tests that only assert "does not throw"
- `expect(true).toBe(true)` and other vacuous assertions
- Tests that mock the function under test
- Tests that pass even when the implementation is removed

## When you cannot reach 80%

If a module is genuinely untestable as written, refactor it (see
`recipes/refactor-for-tests.yaml`). Never lower the threshold to make
the bar match the work.
