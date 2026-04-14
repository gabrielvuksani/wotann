---
name: postgres-pro
description: PostgreSQL query tuning, indexing, partitioning, replication
context: fork
paths: ["**/*.sql", "**/migrations/**", "**/postgresql.conf", "**/postgres*", "**/pg*"]
---

# Postgres Pro

## When to Use
- Designing or reviewing PostgreSQL schemas, indexes, or migrations.
- Tuning slow queries or diagnosing lock contention.
- Planning partitioning, replication, or HA topology.
- Multi-tenant design with RLS, schema-per-tenant, or app-level isolation.
- Upgrading across major versions.

## Rules
- `EXPLAIN (ANALYZE, BUFFERS)` every new query before merging.
- Use `jsonb` for flexible fields; avoid `json` (text) in OLTP.
- Run migrations transactionally where possible; `CREATE INDEX CONCURRENTLY` outside.
- Set `search_path` explicitly in functions; never rely on session defaults.
- Every foreign key has explicit `ON DELETE` + `ON UPDATE` clauses.
- Partial and expression indexes beat wider indexes where selectivity is high.

## Patterns
- **BRIN** for huge append-only tables (time-series).
- **GIN** on `jsonb` + `tsvector` for full-text and flexible search.
- **Partitioning** by range (time) or list (tenant) past ~100M rows.
- **Logical replication** for zero-downtime major-version upgrades.
- **PgBouncer** transaction mode in front of high-cardinality clients.
- **Row-level security** for multi-tenant apps needing strong isolation.

## Example
```sql
-- Monthly partitions + BRIN index for cheap append-only analytics.
CREATE TABLE events (
  event_id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL
) PARTITION BY RANGE (occurred_at);

CREATE TABLE events_2026_04 PARTITION OF events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE INDEX events_occurred_brin
  ON events USING brin (occurred_at) WITH (pages_per_range = 32);
```

## Checklist
- [ ] `EXPLAIN` shows index scan or bitmap scan on every OLTP query.
- [ ] No queries return > 1000 rows without pagination.
- [ ] `autovacuum` tuned for write-heavy tables (cost limit, naptime).
- [ ] `shared_buffers`, `work_mem`, `effective_cache_size` sized to the instance.
- [ ] Replica lag monitored, alerting on > 30s.

## Common Pitfalls
- **Sequential scans on large tables** — missing index or wrong predicate type.
- **`OFFSET` for pagination** — O(offset). Use keyset pagination.
- **Implicit type coercion** defeating indexes (`WHERE user_id = '42'` vs bigint).
- **Long transactions** that block `VACUUM` and bloat tables.
- **`SELECT *`** in production paths — fragile to schema change.
