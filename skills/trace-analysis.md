---
name: trace-analysis
description: Evidence-driven causal tracing to find the real root cause
context: main
paths: []
---

# Trace Analysis

## When to Use
- Something broke and the cause is not obvious from the error.
- The easy explanation feels too easy; you suspect a deeper cause.
- Reviewing an incident post-mortem before sign-off.
- Multiple independent symptoms appear together.
- A "working code" suddenly stops working after no apparent change.

## Rules
- Separate **observation** from **interpretation** — write symptoms as plain facts first.
- Generate at least three competing hypotheses before committing to any one.
- Each hypothesis needs both confirming AND disconfirming evidence.
- Follow the data, not the control flow. Where did the wrong value come from?
- Trace from symptom to cause, then back forward once to confirm the chain.
- If every hypothesis survives, you lack evidence — collect more, don't guess.

## Patterns
- **Five whys**: ask "why" five times, but stop when you reach a system-level cause.
- **Bisection**: git bisect across commits, binary search over configuration.
- **Differential analysis**: compare a working and a broken case, observe the delta.
- **Fault-tree analysis**: top-down decomposition of a failure into component faults.
- **Post-mortem format**: timeline → detection → contributing factors → root cause → action items.

## Example
```markdown
# Trace: WebSocket reconnect storm

## Observation
At 14:02 UTC, 3,200 clients reconnected within 10s after daemon restart.

## Hypotheses
1. Clients lack exponential backoff → all hit at t+1s.
2. LB stickiness expired and redirected → reconnect cascade.
3. JWT expiry aligned with restart window → all refreshed simultaneously.

## Evidence
- (1) confirmed: client code uses fixed 1s retry (git blame L42).
- (2) disconfirmed: LB logs show no rebalance event.
- (3) disconfirmed: token logs show staggered issuance.

## Root cause
Fixed 1s retry on clients. Ship v1.3 with exponential backoff + jitter.
```

## Checklist
- [ ] Symptoms recorded with timestamps and quantities.
- [ ] At least three hypotheses considered.
- [ ] Each hypothesis has both supporting and opposing evidence.
- [ ] Root cause is system-level, not "developer X made a typo".
- [ ] Action items are specific, owned, and dated.

## Common Pitfalls
- **Blaming a person** — the system let the person do the wrong thing.
- **Stopping at the first plausible cause** — almost always wrong.
- **Confirmation bias** — looking only for evidence that fits.
- **Vague root cause** ("flakiness") that doesn't point to a fix.
- **Skipping the timeline** — order of events matters.
