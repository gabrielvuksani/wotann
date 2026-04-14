---
name: integration-testing
description: API integration tests, database fixtures, network contracts
context: fork
paths: ["**/integration/**", "**/*.integration.test.*", "**/*.integration.spec.*"]
---

# Integration Testing

## When to Use
- Exercising a service end-to-end against real dependencies (DB, queue, HTTP).
- Validating a contract between two services (producer + consumer).
- Regression-testing a module that wraps infrastructure primitives.
- Smoke-testing a deployed environment before cutover.

## Rules
- Tests must be hermetic — each run cleans up what it created.
- No shared mutable state between tests; fresh fixtures per test.
- Run against an ephemeral environment in CI (docker-compose, testcontainers).
- Prefer contract tests (Pact) for cross-service boundaries.
- Integration tests are a second line; unit tests carry the bulk.

## Patterns
- **Testcontainers** for real Postgres/Redis per suite.
- **Pact** consumer-driven contracts published to a broker.
- **Snapshot testing** on HTTP response shape with a diff review tool.
- **Builder pattern** for fixtures: `UserBuilder().withEmail(...).build()`.
- **Retry budget**: 2 retries for network flakes, then fail loud.

## Example
```ts
// Vitest + testcontainers — real Postgres per suite.
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

describe("UserRepository", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let repo: UserRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").start();
    repo = new UserRepository(container.getConnectionUri());
    await repo.migrate();
  });

  afterAll(async () => { await container.stop(); });

  it("persists and retrieves a user", async () => {
    const u = await repo.create({ email: "a@b.co" });
    expect(await repo.findById(u.id)).toEqual(u);
  });
});
```

## Checklist
- [ ] Every test is independent and can run in any order.
- [ ] Fixtures live in code, not in SQL dumps that drift.
- [ ] CI uses the same container images as local dev.
- [ ] Flaky tests quarantined within 48h, fixed within a week.
- [ ] Failure output surfaces the failed assertion, not just the stack.

## Common Pitfalls
- **Shared DB** across parallel tests creating race conditions.
- **Hardcoded ports** that conflict on CI runners.
- **Tests that depend on yesterday's data** still being present.
- **Unmocked external APIs** making tests slow and flaky.
- **Tests that assert on wall-clock time** or timezone.
