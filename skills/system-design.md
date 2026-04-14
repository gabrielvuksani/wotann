---
name: system-design
description: Scalability, trade-offs, distributed systems, C4 diagrams
context: fork
paths: []
---

# System Design

## When to Use
- Designing a new system or a major component of an existing one.
- Reviewing a design doc before implementation.
- Capacity planning for a growth milestone.
- Choosing between competing architectures for a capability.
- Interview-style whiteboarding of a well-known system.

## Rules
- Start with requirements (functional AND non-functional). No requirements = no design.
- Estimate scale before choosing technology — numbers drive architecture.
- Name the trade-off for every choice; no design is free.
- Draw the data flow, not the wiring diagram.
- Consider failure modes upfront: partition, latency spike, capacity loss.
- Keep the initial design simple; add complexity only when justified.

## Patterns
- **C4 diagrams** (Context, Container, Component, Code) for progressive disclosure.
- **USE/RED** metrics built into the design.
- **CAP** trade-off stated explicitly for stateful components.
- **Idempotency keys** on writes; retries are expected, not exceptional.
- **Backpressure** via bounded queues, not dropping arbitrary requests.

## Example (whiteboard layout)
```
Req → CDN → API GW → [Auth] → App Fleet (stateless)
                                   │
                                   ├─► Cache (Redis; TTL, LRU)
                                   ├─► Primary DB (Postgres; single writer)
                                   └─► Queue (SQS) ──► Worker fleet → Analytics DB

SLO:        p95 < 200ms, 99.9% availability over 30 days
Scale:      ~50k QPS read, ~2k QPS write, ~1TB hot data, 5x growth/yr
Trade-off:  strong consistency on primary DB; async projections are eventual
Failure:    primary DB AZ loss → promote replica (RTO 60s, RPO 1s)
```

## Checklist
- [ ] Functional requirements listed and prioritized.
- [ ] Non-functional targets quantified (QPS, latency, availability).
- [ ] Each component's failure behavior is named.
- [ ] Bottleneck identified explicitly (DB write, network, etc.).
- [ ] Capacity estimate shown for 1x and 10x load.

## Common Pitfalls
- **Designing without numbers** — hand-wavy conclusions.
- **Single-region "HA"** where an AZ loss takes everything down.
- **Ignoring the read-to-write ratio** — caches solve the wrong tier.
- **Over-decomposition** into services before the monolith is painful.
- **Perfect consistency** requirements that block the design from scaling.
