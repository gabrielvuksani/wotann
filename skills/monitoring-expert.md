---
name: monitoring-expert
description: Observability, metrics, logs, traces, SLOs, alerting
context: fork
paths: ["**/prometheus*", "**/grafana*", "**/alertmanager*", "**/telemetry/**"]
---

# Monitoring Expert

## When to Use
- Instrumenting a new service with metrics, logs, and traces.
- Defining SLOs and error budgets.
- Reviewing and reducing alert fatigue.
- Building a dashboard for a new feature.
- Investigating a production incident.

## Rules
- Instrument **RED** signals (Rate, Errors, Duration) for every public endpoint.
- Instrument **USE** signals (Utilization, Saturation, Errors) for every resource.
- Every alert must be actionable — otherwise it is not an alert.
- Log structured JSON; always include a `trace_id`.
- Trace IDs propagate via W3C `traceparent` across processes.
- Never alert on a symptom without a backing metric.

## Patterns
- **Four golden signals** (Google SRE): latency, traffic, errors, saturation.
- **SLO + error budget** with burn-rate alerts, not raw thresholds.
- **OpenTelemetry** for unified metrics + logs + traces.
- **Sampling**: 1-10% of traces under load, 100% on errors.
- **Runbook link** in every alert payload so on-call reaches context fast.

## Example
```ts
// OpenTelemetry — custom span + counter.
import { trace, metrics } from "@opentelemetry/api";
const tracer = trace.getTracer("billing");
const meter = metrics.getMeter("billing");
const invoiceCounter = meter.createCounter("invoices_created_total");

export async function createInvoice(payload: InvoiceInput) {
  return tracer.startActiveSpan("createInvoice", async (span) => {
    try {
      const invoice = await db.insert(payload);
      invoiceCounter.add(1, { tier: payload.tier });
      span.setAttribute("invoice.id", invoice.id);
      return invoice;
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

## Checklist
- [ ] SLOs written down with explicit targets (e.g. 99.9% over 30 days).
- [ ] Every alert has a runbook link and a named owner.
- [ ] p50, p95, p99 latency tracked — not just average.
- [ ] Logs are structured and sampled appropriately.
- [ ] Dashboards load in < 5s and surface the most important first.

## Common Pitfalls
- **Alerting on CPU** — rarely maps to user-visible impact.
- **Raw thresholds** instead of burn-rate alerts.
- **40-panel dashboards** that nobody reads.
- **Logs without trace IDs** — impossible to correlate a request journey.
- **Tracing only the happy path** — errors lose all context.
