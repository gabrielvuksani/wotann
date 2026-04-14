---
name: sql-pro
description: SQL optimization, indexing, migrations, and query design
context: fork
paths: ["**/*.sql", "**/migrations/**"]
---

# SQL Pro

## Query Optimization
- ALWAYS use parameterized queries (never string concatenation).
- SELECT only needed columns (never `SELECT *` in production).
- Use EXPLAIN ANALYZE to understand query plans.
- Add indexes for WHERE, JOIN, and ORDER BY columns.
- Use CTEs for readability, but check if they hurt performance.

## Indexing Strategy
- Primary keys get automatic indexes.
- Foreign keys should have indexes.
- Composite indexes: put high-cardinality columns first.
- Use partial indexes for filtered queries.
- Monitor unused indexes and remove them.

## Migrations
- Every schema change is a migration file.
- Migrations must be reversible (up + down).
- Never drop columns in the same deploy as code changes.
- Use pg_stat_statements to find slow queries.

## Anti-Patterns
- N+1 queries — use JOIN or batch loading.
- Missing WHERE on UPDATE/DELETE — always have a condition.
- Storing JSON blobs instead of normalized tables.
- Using ORM without understanding generated SQL.
