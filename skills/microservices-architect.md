---
name: microservices-architect
description: Service boundaries, communication patterns, saga, CQRS, resilience
context: fork
paths: []
---

# Microservices Architect

## When to Use
- Decomposing a monolith into services.
- Designing a new service boundary or its API contract.
- Choosing between sync (REST/gRPC) and async (events) communication.
- Introducing distributed transactions, saga, or CQRS.
- Reviewing an existing microservice estate for fragility.

## Rules
- Services own their data — no shared databases across services.
- APIs are versioned and backward-compatible; consumers should never break.
- Prefer async (events) over sync where eventual consistency is acceptable.
- Each service deploys independently; no lock-step releases.
- Every inter-service call has timeout, retry with jitter, and a circuit breaker.
- Observability is not optional — every hop logs trace ID + latency.

## Patterns
- **Strangler Fig** for monolith-to-microservices migration.
- **Saga** (orchestrated or choreographed) for multi-service transactions.
- **CQRS + Event Sourcing** where read and write shapes diverge.
- **API Gateway** + **BFF** (Backend-for-Frontend) for edge composition.
- **Outbox pattern** to avoid dual-write inconsistencies.
- **Circuit breaker + bulkhead** for fault isolation.

## Example
```ts
// Outbox pattern — DB and message bus stay consistent via one transactional write.
await db.transaction(async (tx) => {
  const order = await tx.orders.insert(payload);
  await tx.outbox.insert({
    aggregate: "order",
    type: "OrderCreated",
    payload: order,
    createdAt: new Date(),
  });
});
// A separate dispatcher polls `outbox` and publishes to Kafka, marking rows sent.
```

## Checklist
- [ ] Each service has a clear, documented bounded context.
- [ ] APIs versioned (URL or header) with deprecation path.
- [ ] All inter-service calls wrapped with timeout + retry + circuit breaker.
- [ ] Events are idempotent on the consumer side.
- [ ] End-to-end trace ID propagates across every boundary.

## Common Pitfalls
- **Distributed monolith** — microservices that must deploy together.
- **Chatty APIs** — N+1 calls across services for one user action.
- **Shared DB** — breaks service autonomy.
- **Dual writes** without outbox — inconsistencies leak.
- **Over-splitting early** — microservices before you know the real boundaries.
